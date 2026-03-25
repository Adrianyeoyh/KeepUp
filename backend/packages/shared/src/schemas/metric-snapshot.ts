import { z } from 'zod';

// ============================================
// MetricSnapshot (daily aggregates + baselines)
// ============================================

export const MetricNameSchema = z.enum([
  // Slack metrics
  'slack.unresolved_threads',
  'slack.thread_length_median',
  'slack.thread_length_p90',
  'slack.response_gap_median',
  'slack.decision_keyword_threads',
  // Jira metrics
  'jira.reopen_rate',
  'jira.cycle_time_median',
  'jira.cycle_time_p90',
  'jira.bounce_count',
  'jira.status_transition_count',
  // GitHub metrics
  'github.pr_review_latency_median',
  'github.pr_review_latency_p90',
  'github.pr_age_median',
  'github.stalled_prs',
  'github.reviewer_load_max',
]);

export type MetricName = z.infer<typeof MetricNameSchema>;

export const MetricScopeSchema = z.enum([
  'company',
  'team',
  'project',
  'channel',
  'repository',
]);

export type MetricScope = z.infer<typeof MetricScopeSchema>;

export const MetricSnapshotSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  metric_name: MetricNameSchema,
  scope: MetricScopeSchema.default('company'),
  scope_id: z.string().optional(), // team_id, project_key, channel_id, etc.
  value: z.number(),
  baseline_value: z.number().optional(), // rolling 14–28 day baseline
  date: z.coerce.date(),
  metadata: z.record(z.unknown()).default({}), // breakdown details
  created_at: z.coerce.date(),
});

export type MetricSnapshot = z.infer<typeof MetricSnapshotSchema>;

export const CreateMetricSnapshotSchema = MetricSnapshotSchema.omit({
  id: true,
  created_at: true,
});

export type CreateMetricSnapshot = z.infer<typeof CreateMetricSnapshotSchema>;
