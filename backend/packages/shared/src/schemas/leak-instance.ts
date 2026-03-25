import { z } from 'zod';
import { EvidenceLinkSchema } from './event.js';

// ============================================
// LeakInstance (detected process leak)
// ============================================

export const LeakTypeSchema = z.enum([
  'decision_drift',           // Slack: thread > N messages, no resolution
  'unlogged_action_items',    // Slack: implied tasks with no ticket created
  'reopen_bounce_spike',      // Jira: reopen rate above threshold
  'cycle_time_drift',         // Jira: cycle time above baseline
  'pr_review_bottleneck',     // GitHub: PR review time above baseline
  'custom_jql',               // User-defined JQL-powered leak rule
]);

export type LeakType = z.infer<typeof LeakTypeSchema>;

export const LeakSeveritySchema = z.number().int().min(0).max(100);

export const LeakConfidenceSchema = z.number().min(0).max(1);

export const LeakStatusSchema = z.enum([
  'detected',    // just found
  'delivered',   // included in a digest
  'actioned',    // user took action (created commit, approved fix, etc.)
  'snoozed',     // user snoozed
  'suppressed',  // below confidence threshold or budget exceeded
  'resolved',    // underlying issue resolved
]);

export type LeakStatus = z.infer<typeof LeakStatusSchema>;

export const LeakInstanceSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  leak_type: LeakTypeSchema,
  severity: LeakSeveritySchema,
  confidence: LeakConfidenceSchema,
  status: LeakStatusSchema.default('detected'),
  detected_at: z.coerce.date(),
  // Evidence: links back to the original Slack thread, Jira issue, PR
  evidence_links: z.array(EvidenceLinkSchema).min(1),
  // Baseline vs current comparison
  metrics_context: z.object({
    current_value: z.number(),
    baseline_value: z.number(),
    metric_name: z.string(),
    delta_percentage: z.number(),
  }),
  // Structured fix recommendation
  recommended_fix: z.object({
    summary: z.string(),
    action_type: z.string(), // create_decision_commit, create_action_commit, propose_template, ping_reviewer, etc.
    details: z.record(z.unknown()).default({}),
  }),
  // Cost estimate (hours/week lost)
  cost_estimate_hours_per_week: z.number().optional(),
  // AI diagnosis (populated by AI orchestrator)
  ai_diagnosis: z.object({
    root_cause: z.string(),
    confidence: z.number().min(0).max(1),
    explanation: z.string(),
    fix_drafts: z.array(z.object({
      description: z.string(),
      action_type: z.string(),
      details: z.record(z.unknown()).default({}),
    })).default([]),
  }).optional(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export type LeakInstance = z.infer<typeof LeakInstanceSchema>;

export const CreateLeakInstanceSchema = LeakInstanceSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  ai_diagnosis: true,
});

export type CreateLeakInstance = z.infer<typeof CreateLeakInstanceSchema>;
