import type { NormalizedEvent, EntityReference } from '@flowguard/adapter-sdk';

/**
 * Slack Normalizer — Converts raw Slack webhook payloads into NormalizedEvent[].
 *
 * Migrated from apps/api/src/routes/webhooks/slack.ts normalizeSlackEvent().
 * Preserves all existing business logic: message, thread_reply, thread_resolved,
 * reaction, channel_created, member_joined, message_changed (decision reversal detection).
 */

const RESOLUTION_REACTIONS = new Set(['white_check_mark', 'heavy_check_mark']);

const JIRA_KEY_REGEX = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const GITHUB_PR_URL_REGEX = /https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/g;

export function detectImpliedAction(text: string): boolean {
  if (!text) return false;
  return /\b(todo|action item|follow up|follow-up|please|we should|let's)\b/i.test(text);
}

export function hasLinkedJiraIssue(text: string): boolean {
  if (!text) return false;
  return /\b[A-Z][A-Z0-9]+-\d+\b/.test(text);
}

export function isSubstantiveEdit(previousText: string, newText: string): boolean {
  if (!previousText || !newText) return false;
  const delta = Math.abs(newText.length - previousText.length);
  if (delta > Math.max(previousText.length * 0.3, 50)) return true;
  return /\b(actually|never ?mind|scratch that|disregard|changed my mind|correction|update:|revised)\b/i.test(newText);
}

function slackTsToDate(ts: string | number | undefined): Date {
  if (!ts) return new Date();
  const seconds = typeof ts === 'number' ? ts : Number(ts.split('.')[0] || ts);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

/**
 * Detect cross-references in message text:
 * - Jira issue keys (e.g., PROJ-123)
 * - GitHub PR URLs
 */
function extractCrossReferences(text: string): EntityReference[] {
  const refs: EntityReference[] = [];
  if (!text) return refs;

  // Jira keys
  const jiraMatches = text.matchAll(JIRA_KEY_REGEX);
  for (const match of jiraMatches) {
    refs.push({
      provider: 'jira',
      entityType: 'issue',
      entityId: match[0],
    });
  }

  // GitHub PR URLs
  const ghMatches = text.matchAll(GITHUB_PR_URL_REGEX);
  for (const match of ghMatches) {
    refs.push({
      provider: 'github',
      entityType: 'pr',
      entityId: `${match[1]}#${match[2]}`,
      url: match[0],
    });
  }

  return refs;
}

export function normalizeSlackEvent(
  body: Record<string, any>,
  companyId: string,
): NormalizedEvent[] {
  const event = body.event || {};
  const teamId = body.team_id || event.team || 'unknown-team';
  const events: NormalizedEvent[] = [];

  // Regular message (not a subtype)
  if (event.type === 'message' && !event.subtype) {
    const text = typeof event.text === 'string' ? event.text : '';
    const channelId = event.channel || 'unknown-channel';
    const threadTs = event.thread_ts || event.ts;
    const isThreadReply = Boolean(event.thread_ts && event.thread_ts !== event.ts);
    const eventType = isThreadReply ? 'slack.thread_reply' : 'slack.message';

    events.push({
      provider: 'slack',
      eventType,
      entityId: `${channelId}:${threadTs}`,
      providerEventId: body.event_id || event.client_msg_id || `${teamId}:${event.ts}:${event.user || 'unknown'}`,
      timestamp: slackTsToDate(event.ts),
      companyId,
      metadata: {
        team_id: teamId,
        channel_id: channelId,
        thread_ts: threadTs,
        message_ts: event.ts,
        user_id: event.user || null,
        message_count_increment: 1,
        resolved_marker_present: false,
        implied_action: detectImpliedAction(text),
        linked_jira_issue: hasLinkedJiraIssue(text),
        participant_count: event.reply_users_count || undefined,
      },
      crossReferences: extractCrossReferences(text),
    });
    return events;
  }

  // Reaction added/removed
  if (event.type === 'reaction_added' || event.type === 'reaction_removed') {
    const channelId = event.item?.channel || event.channel || 'unknown-channel';
    const threadTs = event.item?.ts || event.ts;
    const isResolvedReaction = RESOLUTION_REACTIONS.has(event.reaction);

    let eventType: string;
    if (event.type === 'reaction_added') {
      eventType = isResolvedReaction ? 'slack.thread_resolved' : 'slack.reaction_added';
    } else {
      eventType = 'slack.reaction_removed';
    }

    events.push({
      provider: 'slack',
      eventType,
      entityId: `${channelId}:${threadTs}`,
      providerEventId: body.event_id || `${teamId}:${event.type}:${channelId}:${threadTs}:${event.reaction}`,
      timestamp: new Date(),
      companyId,
      metadata: {
        team_id: teamId,
        channel_id: channelId,
        thread_ts: threadTs,
        reaction: event.reaction,
        user_id: event.user || null,
        resolved_marker_present: isResolvedReaction,
      },
      crossReferences: [],
    });
    return events;
  }

  // Channel created
  if (event.type === 'channel_created') {
    events.push({
      provider: 'slack',
      eventType: 'slack.channel_created',
      entityId: event.channel?.id || 'unknown-channel',
      providerEventId: body.event_id || `${teamId}:channel_created:${event.channel?.id || 'unknown'}`,
      timestamp: new Date(),
      companyId,
      metadata: {
        team_id: teamId,
        channel_id: event.channel?.id || null,
        channel_name: event.channel?.name || null,
      },
      crossReferences: [],
    });
    return events;
  }

  // Member joined channel
  if (event.type === 'member_joined_channel') {
    events.push({
      provider: 'slack',
      eventType: 'slack.member_joined_channel',
      entityId: event.channel || 'unknown-channel',
      providerEventId: body.event_id || `${teamId}:member_joined:${event.channel || 'unknown'}:${event.user || 'unknown'}`,
      timestamp: new Date(),
      companyId,
      metadata: {
        team_id: teamId,
        channel_id: event.channel || null,
        user_id: event.user || null,
        inviter_id: event.inviter || null,
      },
      crossReferences: [],
    });
    return events;
  }

  // Message changed (decision reversal detection)
  if (event.type === 'message' && event.subtype === 'message_changed') {
    const channelId = event.channel || 'unknown-channel';
    const previousText = typeof event.previous_message?.text === 'string' ? event.previous_message.text : '';
    const newText = typeof event.message?.text === 'string' ? event.message.text : '';
    const threadTs = event.message?.thread_ts || event.message?.ts || event.ts;

    events.push({
      provider: 'slack',
      eventType: 'slack.message_changed',
      entityId: `${channelId}:${threadTs}`,
      providerEventId: body.event_id || `${teamId}:message_changed:${channelId}:${event.message?.ts || event.ts}`,
      timestamp: new Date(),
      companyId,
      metadata: {
        team_id: teamId,
        channel_id: channelId,
        thread_ts: threadTs,
        message_ts: event.message?.ts || event.ts,
        user_id: event.message?.user || null,
        previous_text_length: previousText.length,
        new_text_length: newText.length,
        edit_delta: Math.abs(newText.length - previousText.length),
        is_substantive_edit: isSubstantiveEdit(previousText, newText),
      },
      crossReferences: extractCrossReferences(newText),
    });
    return events;
  }

  // Unsupported event type — return empty
  return events;
}
