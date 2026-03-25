import type { NormalizedEvent, EntityReference } from '@flowguard/adapter-sdk';

/**
 * Jira Normalizer — Converts raw Jira webhook payloads into NormalizedEvent[].
 *
 * Migrated from apps/api/src/routes/webhooks/jira.ts normalizeJiraEvents().
 * Preserves all existing business logic: issue CRUD, status transitions,
 * reopen detection, comment events, cross-reference extraction.
 */

const REOPEN_STATUSES = new Set(['open', 'reopened', 'to do', 'todo']);
const DONE_STATUSES = new Set(['done', 'closed', 'resolved']);

const GITHUB_PR_URL_REGEX = /https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/g;
const SLACK_THREAD_REGEX = /https?:\/\/[a-z0-9-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d+)/g;

/**
 * Extract cross-references from Jira issue description and comments.
 */
function extractCrossReferences(body: Record<string, any>): EntityReference[] {
  const refs: EntityReference[] = [];

  const texts: string[] = [];
  const description = body.issue?.fields?.description;
  if (typeof description === 'string') texts.push(description);
  // ADF format — extract text from content blocks
  if (description && typeof description === 'object' && description.content) {
    const extractText = (node: any): void => {
      if (node.text) texts.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(extractText);
    };
    extractText(description);
  }

  const commentBody = body.comment?.body;
  if (typeof commentBody === 'string') texts.push(commentBody);
  if (commentBody && typeof commentBody === 'object' && commentBody.content) {
    const extractText = (node: any): void => {
      if (node.text) texts.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(extractText);
    };
    extractText(commentBody);
  }

  const fullText = texts.join(' ');

  // GitHub PR URLs
  const ghMatches = fullText.matchAll(GITHUB_PR_URL_REGEX);
  for (const match of ghMatches) {
    refs.push({
      provider: 'github',
      entityType: 'pr',
      entityId: `${match[1]}#${match[2]}`,
      url: match[0],
    });
  }

  // Slack thread URLs
  const slackMatches = fullText.matchAll(SLACK_THREAD_REGEX);
  for (const match of slackMatches) {
    refs.push({
      provider: 'slack',
      entityType: 'thread',
      entityId: `${match[1]}:${match[2]}`,
      url: match[0],
    });
  }

  return refs;
}

export function normalizeJiraEvents(
  body: Record<string, any>,
  companyId: string,
): NormalizedEvent[] {
  const webhookEvent = body.webhookEvent as string | undefined;
  const issue = body.issue || {};
  const issueId = issue.id || issue.key || 'unknown-issue';
  const issueKey = issue.key || issue.id || 'UNKNOWN-ISSUE';
  const projectKey = issue.fields?.project?.key;
  const updatedAt = issue.fields?.updated || body.timestamp || new Date().toISOString();
  const createdAt = issue.fields?.created || updatedAt;
  const changelogItems = Array.isArray(body.changelog?.items) ? body.changelog.items : [];

  const events: NormalizedEvent[] = [];
  const crossRefs = extractCrossReferences(body);

  if (webhookEvent === 'jira:issue_created') {
    events.push({
      provider: 'jira',
      eventType: 'jira.issue_created',
      entityId: issueKey,
      providerEventId: `${issueId}:created:${createdAt}`,
      timestamp: new Date(createdAt),
      companyId,
      metadata: {
        issue_id: issueId,
        issue_key: issueKey,
        project_key: projectKey,
        status: issue.fields?.status?.name,
        issue_type: issue.fields?.issuetype?.name,
      },
      crossReferences: crossRefs,
    });
  }

  if (webhookEvent === 'jira:issue_updated') {
    events.push({
      provider: 'jira',
      eventType: 'jira.issue_updated',
      entityId: issueKey,
      providerEventId: `${issueId}:updated:${updatedAt}`,
      timestamp: new Date(updatedAt),
      companyId,
      metadata: {
        issue_id: issueId,
        issue_key: issueKey,
        project_key: projectKey,
        status: issue.fields?.status?.name,
        issue_type: issue.fields?.issuetype?.name,
        assignee: issue.fields?.assignee?.accountId || null,
      },
      crossReferences: crossRefs,
    });

    const statusChange = changelogItems.find(
      (item: Record<string, any>) => item.field === 'status',
    );
    if (statusChange) {
      const toStatus = String(statusChange.toString || '').toLowerCase();

      events.push({
        provider: 'jira',
        eventType: 'jira.issue_transitioned',
        entityId: issueKey,
        providerEventId: `${issueId}:transition:${updatedAt}`,
        timestamp: new Date(updatedAt),
        companyId,
        metadata: {
          issue_id: issueId,
          issue_key: issueKey,
          project_key: projectKey,
          from_status: statusChange.fromString,
          to_status: statusChange.toString,
          is_done_transition: DONE_STATUSES.has(toStatus),
        },
        crossReferences: [],
      });

      if (REOPEN_STATUSES.has(toStatus)) {
        events.push({
          provider: 'jira',
          eventType: 'jira.issue_reopened',
          entityId: issueKey,
          providerEventId: `${issueId}:reopened:${updatedAt}`,
          timestamp: new Date(updatedAt),
          companyId,
          metadata: {
            issue_id: issueId,
            issue_key: issueKey,
            project_key: projectKey,
            from_status: statusChange.fromString,
            to_status: statusChange.toString,
          },
          crossReferences: [],
        });
      }
    }
  }

  if (webhookEvent === 'comment_created') {
    events.push({
      provider: 'jira',
      eventType: 'jira.comment_added',
      entityId: issueKey,
      providerEventId: `${issueId}:comment:${body.comment?.id || updatedAt}`,
      timestamp: new Date(updatedAt),
      companyId,
      metadata: {
        issue_id: issueId,
        issue_key: issueKey,
        project_key: projectKey,
        author: body.comment?.author?.accountId || null,
      },
      crossReferences: crossRefs,
    });
  }

  return events;
}
