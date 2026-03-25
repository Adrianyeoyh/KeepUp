import { query } from '@flowguard/db';
import { adapterRegistry } from '@flowguard/adapter-sdk';
import { logger } from '../logger.js';

/**
 * EntityLinkExtractor — Auto-creates entity_links from incoming events.
 *
 * Migrated from apps/api/src/services/entity-link-extractor.ts.
 * Key changes:
 *   - Uses `@flowguard/db` query() instead of local db client
 *   - Jira remote link write-back goes through `adapterRegistry.executeAction()`
 *     instead of directly calling the Jira SDK
 *
 * All business logic preserved from the original implementation.
 */

// Matches Jira-style keys: PROJECT-123
const JIRA_KEY_REGEX = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;

// Matches GitHub PR/issue URLs: github.com/owner/repo/pull/123
const GITHUB_URL_REGEX = /github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\/(pull|issues)\/(\d+)/g;

interface PendingLink {
  company_id: string;
  source_provider: string;
  source_entity_type: string;
  source_entity_id: string;
  target_provider: string;
  target_entity_type: string;
  target_entity_id: string;
  link_type: string;
  confidence: number;
  detected_by: string;
  metadata: Record<string, unknown>;
}

interface EventForExtraction {
  company_id: string;
  source: string;
  entity_id: string;
  event_type: string;
  metadata: Record<string, unknown>;
}

/**
 * Extract Jira issue keys from any text content.
 */
export function extractJiraKeys(text: string): string[] {
  const matches = new Set<string>();
  let match: RegExpExecArray | null;
  JIRA_KEY_REGEX.lastIndex = 0;
  while ((match = JIRA_KEY_REGEX.exec(text)) !== null) {
    matches.add(match[0]);
  }
  return Array.from(matches);
}

/**
 * Extract GitHub PR/issue URLs from text content.
 */
export function extractGitHubRefs(text: string): Array<{ repo: string; type: string; number: string }> {
  const refs: Array<{ repo: string; type: string; number: string }> = [];
  let match: RegExpExecArray | null;
  GITHUB_URL_REGEX.lastIndex = 0;
  while ((match = GITHUB_URL_REGEX.exec(text)) !== null) {
    refs.push({ repo: match[1], type: match[2] === 'pull' ? 'pr' : 'issue', number: match[3] });
  }
  return refs;
}

function extractFromSlackEvent(event: EventForExtraction): PendingLink[] {
  const links: PendingLink[] = [];
  const meta = event.metadata as Record<string, any>;
  const text = meta?.text || meta?.message_text || '';
  const entityId = event.entity_id;

  for (const jiraKey of extractJiraKeys(text)) {
    links.push({
      company_id: event.company_id,
      source_provider: 'slack',
      source_entity_type: 'thread',
      source_entity_id: entityId,
      target_provider: 'jira',
      target_entity_type: 'issue',
      target_entity_id: jiraKey,
      link_type: 'mentions',
      confidence: 1.0,
      detected_by: 'system',
      metadata: { extracted_from: 'slack_message_text' },
    });
  }

  for (const ghRef of extractGitHubRefs(text)) {
    links.push({
      company_id: event.company_id,
      source_provider: 'slack',
      source_entity_type: 'thread',
      source_entity_id: entityId,
      target_provider: 'github',
      target_entity_type: ghRef.type,
      target_entity_id: `${ghRef.repo}#${ghRef.number}`,
      link_type: 'discussed_in',
      confidence: 1.0,
      detected_by: 'system',
      metadata: { extracted_from: 'slack_message_text', github_repo: ghRef.repo },
    });
  }

  return links;
}

function extractFromGitHubEvent(event: EventForExtraction): PendingLink[] {
  const links: PendingLink[] = [];
  const meta = event.metadata as Record<string, any>;
  const entityId = event.entity_id;
  const repoFullName = meta?.repo_full_name || '';

  const corpus = [
    meta?.pr_title || '',
    meta?.pr_body || '',
    meta?.commit_message || '',
    meta?.head_branch || '',
  ].join(' ');

  for (const jiraKey of extractJiraKeys(corpus)) {
    links.push({
      company_id: event.company_id,
      source_provider: 'github',
      source_entity_type: 'pr',
      source_entity_id: entityId,
      target_provider: 'jira',
      target_entity_type: 'issue',
      target_entity_id: jiraKey,
      link_type: 'fixes',
      confidence: 0.9,
      detected_by: 'system',
      metadata: { extracted_from: 'github_pr_metadata', repo: repoFullName },
    });
  }

  return links;
}

function extractFromJiraEvent(event: EventForExtraction): PendingLink[] {
  const links: PendingLink[] = [];
  const meta = event.metadata as Record<string, any>;
  const entityId = event.entity_id;
  const description = meta?.description || '';

  for (const ghRef of extractGitHubRefs(description)) {
    links.push({
      company_id: event.company_id,
      source_provider: 'jira',
      source_entity_type: 'issue',
      source_entity_id: entityId,
      target_provider: 'github',
      target_entity_type: ghRef.type,
      target_entity_id: `${ghRef.repo}#${ghRef.number}`,
      link_type: 'reviewed_in',
      confidence: 1.0,
      detected_by: 'system',
      metadata: { extracted_from: 'jira_issue_description' },
    });
  }

  return links;
}

/**
 * Write-back a remote link to Jira via the adapter registry.
 * Uses adapterRegistry.executeAction() instead of direct Jira SDK import.
 */
async function writeJiraRemoteLinkViaAdapter(params: {
  companyId: string;
  issueKey: string;
  sourceProvider: string;
  sourceEntityId: string;
  linkType: string;
}): Promise<void> {
  if (!adapterRegistry.has('jira')) return;

  await adapterRegistry.executeAction({
    provider: 'jira',
    actionType: 'add_remote_link',
    targetId: params.issueKey,
    companyId: params.companyId,
    payload: {
      source_provider: params.sourceProvider,
      source_entity_id: params.sourceEntityId,
      link_type: params.linkType,
    },
    riskLevel: 'low',
    metadata: { source: 'entity-link-extractor' },
  });
}

/**
 * Main entry point: extract and persist entity links from any incoming event.
 * Uses ON CONFLICT DO NOTHING for idempotent re-processing.
 */
export async function extractAndStoreLinks(event: EventForExtraction): Promise<number> {
  let pendingLinks: PendingLink[] = [];

  switch (event.source) {
    case 'slack':
      pendingLinks = extractFromSlackEvent(event);
      break;
    case 'github':
      pendingLinks = extractFromGitHubEvent(event);
      break;
    case 'jira':
      pendingLinks = extractFromJiraEvent(event);
      break;
  }

  if (pendingLinks.length === 0) return 0;

  let created = 0;
  for (const link of pendingLinks) {
    try {
      const result = await query(
        `INSERT INTO entity_links (
          company_id, source_provider, source_entity_type, source_entity_id,
          target_provider, target_entity_type, target_entity_id,
          link_type, confidence, detected_by, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (company_id, source_provider, source_entity_id, target_provider, target_entity_id, link_type)
        DO NOTHING
        RETURNING id`,
        [
          link.company_id,
          link.source_provider, link.source_entity_type, link.source_entity_id,
          link.target_provider, link.target_entity_type, link.target_entity_id,
          link.link_type, link.confidence, link.detected_by,
          JSON.stringify(link.metadata),
        ],
      );

      if (result.rowCount && result.rowCount > 0) {
        created++;
        logger.debug({
          link_type: link.link_type,
          source: `${link.source_provider}:${link.source_entity_id}`,
          target: `${link.target_provider}:${link.target_entity_id}`,
        }, 'Entity link created');

        // Write-back remote link to Jira via adapter registry
        if (link.target_provider === 'jira') {
          void writeJiraRemoteLinkViaAdapter({
            companyId: link.company_id,
            issueKey: link.target_entity_id,
            sourceProvider: link.source_provider,
            sourceEntityId: link.source_entity_id,
            linkType: link.link_type,
          }).catch((err) => {
            logger.warn({ err }, 'Jira remote link write-back failed — non-fatal');
          });
        } else if (link.source_provider === 'jira') {
          void writeJiraRemoteLinkViaAdapter({
            companyId: link.company_id,
            issueKey: link.source_entity_id,
            sourceProvider: link.target_provider,
            sourceEntityId: link.target_entity_id,
            linkType: link.link_type,
          }).catch((err) => {
            logger.warn({ err }, 'Jira remote link write-back failed — non-fatal');
          });
        }
      }
    } catch (err) {
      logger.warn({ err, link }, 'Failed to create entity link — skipping');
    }
  }

  if (created > 0) {
    logger.info({ count: created, source: event.source, entity_id: event.entity_id }, 'Entity links extracted');
  }

  return created;
}

// ============================================
// Jira Native Issue Links
// ============================================

const JIRA_LINK_TYPE_MAP: Record<string, string> = {
  'blocks': 'blocks',
  'is blocked by': 'blocks',
  'duplicates': 'duplicates',
  'is duplicated by': 'duplicates',
  'causes': 'caused_by',
  'is caused by': 'caused_by',
  'relates to': 'mentions',
  'clones': 'duplicates',
  'is cloned by': 'duplicates',
  'is parent of': 'parent_of',
  'is child of': 'parent_of',
};

/**
 * Extract and persist Jira native issue links from the issuelinks field.
 */
export async function extractAndStoreJiraIssueLinks(
  companyId: string,
  sourceIssueKey: string,
  issueLinks: Array<Record<string, any>>,
): Promise<number> {
  let created = 0;

  for (const link of issueLinks) {
    try {
      const linkTypeName = link.type?.name?.toLowerCase() || '';
      const inwardDesc = (link.type?.inward || '').toLowerCase();
      const outwardDesc = (link.type?.outward || '').toLowerCase();

      let targetIssueKey: string | null = null;
      let linkType: string | undefined;

      if (link.outwardIssue) {
        targetIssueKey = link.outwardIssue.key;
        linkType = JIRA_LINK_TYPE_MAP[outwardDesc] || JIRA_LINK_TYPE_MAP[linkTypeName];
      } else if (link.inwardIssue) {
        targetIssueKey = link.inwardIssue.key;
        linkType = JIRA_LINK_TYPE_MAP[inwardDesc] || JIRA_LINK_TYPE_MAP[linkTypeName];
      }

      if (!targetIssueKey || !linkType) {
        logger.debug({ linkTypeName, inwardDesc, outwardDesc, sourceIssueKey }, 'Unmapped Jira issue link type — skipping');
        continue;
      }

      const result = await query(
        `INSERT INTO entity_links (
          company_id, source_provider, source_entity_type, source_entity_id,
          target_provider, target_entity_type, target_entity_id,
          link_type, confidence, detected_by, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (company_id, source_provider, source_entity_id, target_provider, target_entity_id, link_type)
        DO NOTHING
        RETURNING id`,
        [
          companyId,
          'jira', 'issue', sourceIssueKey,
          'jira', 'issue', targetIssueKey,
          linkType, 1.0, 'system',
          JSON.stringify({
            extracted_from: 'jira_issue_links',
            jira_link_type: linkTypeName,
            jira_link_id: link.id,
          }),
        ],
      );

      if (result.rowCount && result.rowCount > 0) {
        created++;
        logger.debug({ link_type: linkType, source: sourceIssueKey, target: targetIssueKey }, 'Jira native issue link created');
      }
    } catch (err) {
      logger.warn({ err, sourceIssueKey }, 'Failed to create Jira issue link — skipping');
    }
  }

  if (created > 0) {
    logger.info({ count: created, sourceIssueKey }, 'Jira native issue links extracted');
  }

  return created;
}

export const entityLinkExtractor = {
  extractAndStoreLinks,
  extractJiraKeys,
  extractGitHubRefs,
  extractAndStoreJiraIssueLinks,
};
