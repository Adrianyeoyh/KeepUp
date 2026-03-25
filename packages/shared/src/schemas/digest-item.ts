import { z } from 'zod';
import { EvidenceLinkSchema } from './event.js';
import { LeakTypeSchema, LeakSeveritySchema, LeakConfidenceSchema } from './leak-instance.js';

// ============================================
// DigestItem (individual insight in daily digest)
// ============================================

export const DigestItemSchema = z.object({
  leak_instance_id: z.string().uuid(),
  rank: z.number().int().min(1).max(3), // position in digest (max 3)
  leak_type: LeakTypeSchema,
  severity: LeakSeveritySchema,
  confidence: LeakConfidenceSchema,
  // Human-readable content
  title: z.string(),
  description: z.string(),
  cost_estimate: z.string().optional(), // e.g., "10–14 hrs/week"
  // Evidence
  evidence_links: z.array(EvidenceLinkSchema),
  // Metrics comparison
  baseline_comparison: z.string(), // e.g., "18% vs 10% baseline"
  // Draft fix summary
  recommended_fix_summary: z.string(),
  // Action button IDs (for Slack interactive message)
  actions: z.array(z.object({
    action_id: z.string(),
    label: z.string(),
    type: z.enum(['create_decision_commit', 'create_action_commit', 'propose_fix', 'approve_fix', 'snooze']),
  })),
});

export type DigestItem = z.infer<typeof DigestItemSchema>;

export const DigestSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  date: z.coerce.date(),
  items: z.array(DigestItemSchema).min(1).max(3),
  delivered_at: z.coerce.date().optional(),
  delivered_to: z.array(z.string()).default([]), // Slack user IDs
  created_at: z.coerce.date(),
});

export type Digest = z.infer<typeof DigestSchema>;
