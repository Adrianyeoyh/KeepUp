import type { NormalizedEvent, EntityReference } from '@flowguard/adapter-sdk';

// ============================================
// Event Normalizer Template
// ============================================
//
// This file converts raw webhook payloads from your provider into
// NormalizedEvent[] — the universal event format that all consumers
// understand.
//
// TODO: Replace 'template' with your provider name in event types
// TODO: Implement normalization for each event type your provider sends
// TODO: Add cross-reference detection (Jira keys, GitHub PR URLs, etc.)
//
// See backend/publishers/slack/src/normalizer.ts for a complete example.

// ---- Cross-Reference Detection ----
//
// These regexes detect references to other platforms in text fields.
// Keep them consistent across all publishers.

const JIRA_KEY_REGEX = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const GITHUB_PR_URL_REGEX = /https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/g;
const SLACK_THREAD_URL_REGEX = /https?:\/\/[^/]+\.slack\.com\/archives\/([^/]+)\/p(\d+)/g;

/**
 * Extract cross-platform references from text content.
 *
 * TODO: Add detection patterns specific to your provider if needed.
 */
function extractCrossReferences(text: string): EntityReference[] {
  const refs: EntityReference[] = [];
  if (!text) return refs;

  // Jira issue keys (e.g., PROJ-123)
  for (const match of text.matchAll(JIRA_KEY_REGEX)) {
    refs.push({
      provider: 'jira',
      entityType: 'issue',
      entityId: match[0],
    });
  }

  // GitHub PR URLs
  for (const match of text.matchAll(GITHUB_PR_URL_REGEX)) {
    refs.push({
      provider: 'github',
      entityType: 'pr',
      entityId: `${match[1]}#${match[2]}`,
      url: match[0],
    });
  }

  // Slack thread URLs
  for (const match of text.matchAll(SLACK_THREAD_URL_REGEX)) {
    refs.push({
      provider: 'slack',
      entityType: 'thread',
      entityId: `${match[1]}:${match[2]}`,
      url: match[0],
    });
  }

  return refs;
}

/**
 * Normalize a raw webhook payload into NormalizedEvent[].
 *
 * TODO: Replace 'template' with your provider name.
 * TODO: Map each of your provider's event types to a NormalizedEvent.
 *
 * @param body - The raw webhook payload from your provider
 * @param companyId - The FlowGuard company UUID (resolved by the adapter)
 * @returns Array of normalized events (can be empty for ignored event types)
 */
export function normalizeTemplateEvent(
  body: Record<string, any>,
  companyId: string,
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];

  // TODO: Extract the event type from your provider's payload
  // const eventType = body.action || body.event_type || body.type;
  // const entityId = body.resource?.id || body.entity?.id;

  // TODO: Map provider events to NormalizedEvent[].
  //
  // Example for a project management tool:
  //
  // if (eventType === 'issue_created') {
  //   events.push({
  //     provider: 'template',
  //     eventType: 'template.issue_created',
  //     entityId: body.issue.id,
  //     providerEventId: body.delivery_id || `template:${body.issue.id}:${Date.now()}`,
  //     timestamp: new Date(body.issue.created_at || Date.now()),
  //     companyId,
  //     metadata: {
  //       title: body.issue.title,
  //       status: body.issue.status,
  //       assignee: body.issue.assignee?.id,
  //       priority: body.issue.priority,
  //       labels: body.issue.labels || [],
  //     },
  //     crossReferences: extractCrossReferences(
  //       `${body.issue.title} ${body.issue.description || ''}`,
  //     ),
  //   });
  //   return events;
  // }
  //
  // if (eventType === 'issue_updated') {
  //   events.push({
  //     provider: 'template',
  //     eventType: 'template.issue_updated',
  //     entityId: body.issue.id,
  //     providerEventId: body.delivery_id || `template:${body.issue.id}:updated:${Date.now()}`,
  //     timestamp: new Date(body.issue.updated_at || Date.now()),
  //     companyId,
  //     metadata: {
  //       title: body.issue.title,
  //       from_status: body.changes?.status?.from,
  //       to_status: body.changes?.status?.to,
  //       assignee: body.issue.assignee?.id,
  //     },
  //     crossReferences: extractCrossReferences(
  //       `${body.issue.title} ${body.issue.description || ''}`,
  //     ),
  //   });
  //   return events;
  // }
  //
  // if (eventType === 'comment_created') {
  //   events.push({
  //     provider: 'template',
  //     eventType: 'template.comment_created',
  //     entityId: body.issue.id,
  //     providerEventId: body.comment.id || `template:comment:${Date.now()}`,
  //     timestamp: new Date(body.comment.created_at || Date.now()),
  //     companyId,
  //     metadata: {
  //       issue_id: body.issue.id,
  //       comment_id: body.comment.id,
  //       author: body.comment.author?.id,
  //     },
  //     crossReferences: extractCrossReferences(body.comment.body || ''),
  //   });
  //   return events;
  // }

  // Return empty for unrecognized event types (they will be silently skipped)
  return events;
}
