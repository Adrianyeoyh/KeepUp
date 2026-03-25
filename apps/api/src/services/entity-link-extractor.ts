import { query } from '../db/client.js';
import { logger } from '../logger.js';
import type { CreateEvent } from '@flowguard/shared';
import { writeJiraRemoteLink } from './jira-writeback.js';

// ============================================
// EntityLinkExtractor — Auto-creates entity_links from incoming events.
//
// When events arrive via webhook, this service scans event metadata
// for cross-tool references:
//   - Slack message contains "PLAT-123"   → slack:thread → jira:issue (mentions)
//   - GitHub PR body mentions "AUTH-45"   → github:pr → jira:issue (fixes)
//   - Slack message contains GitHub URL   → slack:thread → github:pr (discussed_in)
//
// These links form the connected graph that the v2 evidence chain
// and semantic analysis rely on.
// ============================================

// Matches Jira-style keys: PROJECT-123
const JIRA_KEY_REGEX = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;

// Matches GitHub PR/issue URLs: github.com/owner/repo/pull/123
const GITHUB_URL_REGEX = /github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\/(pull|issues)\/(\d+)/g;

/** Represents a potential entity link to create */
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

/**
 * Extract Jira issue keys from any text content.
 */
function extractJiraKeys(text: string): string[] {
  const matches = new Set<string>();
  let match: RegExpExecArray | null;
  JIRA_KEY_REGEX.lastIndex = 0;
  while ((match = JIRA_KEY_REGEX.exec(text)) !== null) {
    matches.add(match[0]); // e.g. "PLAT-123"
  }
  return Array.from(matches);
}

/**
 * Extract GitHub PR/issue URLs from text content.
 */
function extractGitHubRefs(text: string): Array<{ repo: string; type: string; number: string }> {
  const refs: Array<{ repo: string; type: string; number: string }> = [];
  let match: RegExpExecArray | null;
  GITHUB_URL_REGEX.lastIndex = 0;
  while ((match = GITHUB_URL_REGEX.exec(text)) !== null) {
    refs.push({ repo: match[1], type: match[2] === 'pull' ? 'pr' : 'issue', number: match[3] });
  }
  return refs;
}

/**
 * Slack events: extract Jira keys and GitHub URLs from message text.
 */
function extractFromSlackEvent(event: CreateEvent): PendingLink[] {
  const links: PendingLink[] = [];
  const meta = event.metadata as Record<string, any>;
  const text = meta?.text || meta?.message_text || '';
  const entityId = event.entity_id; // thread_ts or channel based

  // Look for Jira keys in message text
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

  // Look for GitHub PR/issue URLs in message text
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

/**
 * GitHub events: extract Jira keys from PR body, title, and commit messages.
 */
function extractFromGitHubEvent(event: CreateEvent): PendingLink[] {
  const links: PendingLink[] = [];
  const meta = event.metadata as Record<string, any>;
  const entityId = event.entity_id; // e.g. "acme/api#142"
  const repoFullName = meta?.repo_full_name || '';

  // Combine PR title, body, commit messages into one search corpus
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
      confidence: 0.9, // convention-based, not guaranteed
      detected_by: 'system',
      metadata: { extracted_from: 'github_pr_metadata', repo: repoFullName },
    });
  }

  return links;
}

/**
 * Jira events: extract GitHub references from issue descriptions and links.
 */
function extractFromJiraEvent(event: CreateEvent): PendingLink[] {
  const links: PendingLink[] = [];
  const meta = event.metadata as Record<string, any>;
  const entityId = event.entity_id; // e.g. "PLAT-123" (issue key)
  const description = meta?.description || '';

  // Look for GitHub URLs in Jira issue description
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
 * Main entry point: extract and persist entity links from any incoming event.
 * Called in the webhook handler pipeline AFTER event insertion.
 *
 * Uses ON CONFLICT DO NOTHING for idempotent re-processing.
 */
export async function extractAndStoreLinks(event: CreateEvent): Promise<number> {
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

        // v2: Write remote link to Jira when a Jira issue is involved
        if (link.target_provider === 'jira') {
          void writeJiraRemoteLink({
            issueKey: link.target_entity_id,
            sourceProvider: link.source_provider,
            sourceEntityId: link.source_entity_id,
            linkType: link.link_type,
          }).catch((err) => {
            logger.warn({ err }, 'Jira remote link write-back failed — non-fatal');
          });
        } else if (link.source_provider === 'jira') {
          void writeJiraRemoteLink({
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
      // Never fail event ingestion due to link extraction errors
      logger.warn({ err, link }, 'Failed to create entity link — skipping');
    }
  }

  if (created > 0) {
    logger.info({ count: created, source: event.source, entity_id: event.entity_id }, 'Entity links extracted');
  }

  return created;
}

export const entityLinkExtractor = { extractAndStoreLinks, extractJiraKeys, extractGitHubRefs, extractAndStoreJiraIssueLinks };

// ============================================
// Jira Native Issue Links — Ingests the `issuelinks` array from Jira webhooks.
//
// Jira link types we care about:
//   "Blocks"    → blocks
//   "Duplicate" → duplicates
//   "Relates"   → related_to (mapped to 'mentions')
//   "Causes"    → caused_by
//   "Parent"    → parent_of
//   "Cloners"   → duplicates (clone is effectively a duplicate)
//
// Each issueLink has either an `inwardIssue` or `outwardIssue` field
// depending on direction. We normalize to source→target.
// ============================================

/** Map Jira's link type names to our entity_links.link_type enum */
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
 * Extract and persist Jira native issue links from the issuelinks field
 * in Jira webhook payloads. These represent structured relationships
 * between Jira issues (blocks, duplicates, parent_of, etc.).
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

      // Determine direction and target issue
      let targetIssueKey: string | null = null;
      let linkType: string | undefined;

      if (link.outwardIssue) {
        targetIssueKey = link.outwardIssue.key;
        // Use outward description for mapping (e.g. "blocks", "duplicates")
        linkType = JIRA_LINK_TYPE_MAP[outwardDesc] || JIRA_LINK_TYPE_MAP[linkTypeName];
      } else if (link.inwardIssue) {
        targetIssueKey = link.inwardIssue.key;
        // Use inward description for mapping (e.g. "is blocked by")
        linkType = JIRA_LINK_TYPE_MAP[inwardDesc] || JIRA_LINK_TYPE_MAP[linkTypeName];
      }

      if (!targetIssueKey || !linkType) {
        logger.debug({
          linkTypeName,
          inwardDesc,
          outwardDesc,
          sourceIssueKey,
        }, 'Unmapped Jira issue link type — skipping');
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
        logger.debug({
          link_type: linkType,
          source: sourceIssueKey,
          target: targetIssueKey,
        }, 'Jira native issue link created');
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
