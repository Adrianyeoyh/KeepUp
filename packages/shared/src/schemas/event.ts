import { z } from 'zod';

// ============================================
// Event (append-only, normalized)
// ============================================

export const EventSourceSchema = z.enum([
  'slack',
  'jira',
  'github',
  'zendesk',
  'system', // internal events
]);

export type EventSource = z.infer<typeof EventSourceSchema>;

export const EventTypeSchema = z.enum([
  // Slack events
  'slack.message',
  'slack.thread_reply',
  'slack.reaction_added',
  'slack.reaction_removed',
  'slack.channel_created',
  'slack.thread_resolved',
  'slack.member_joined_channel',
  'slack.message_changed',
  // Jira events
  'jira.issue_created',
  'jira.issue_updated',
  'jira.issue_transitioned',
  'jira.issue_reopened',
  'jira.comment_added',
  // GitHub events
  'github.pr_opened',
  'github.pr_updated',
  'github.pr_merged',
  'github.pr_closed',
  'github.review_requested',
  'github.review_submitted',
  'github.comment_added',
  'github.deployment_status',
  'github.check_suite',
  'github.project_v2_item',
  // System events
  'system.digest_sent',
  'system.action_executed',
]);

export type EventType = z.infer<typeof EventTypeSchema>;

export const EvidenceLinkSchema = z.object({
  provider: EventSourceSchema,
  entity_type: z.string(), // thread, issue, pr, ticket, etc.
  entity_id: z.string(),
  url: z.string().url(),
  title: z.string().optional(),
});

export type EvidenceLink = z.infer<typeof EvidenceLinkSchema>;

export const EventSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  source: EventSourceSchema,
  entity_id: z.string(), // thread_ts, issue key, PR number, etc.
  event_type: EventTypeSchema,
  timestamp: z.coerce.date(),
  // Provider-specific raw metadata (JSONB)
  metadata: z.record(z.unknown()).default({}),
  // Idempotency key: provider_event_id + source scope
  provider_event_id: z.string(),
  created_at: z.coerce.date(),
});

export type Event = z.infer<typeof EventSchema>;

export const CreateEventSchema = EventSchema.omit({
  id: true,
  created_at: true,
});

export type CreateEvent = z.infer<typeof CreateEventSchema>;
