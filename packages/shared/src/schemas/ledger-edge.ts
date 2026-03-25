import { z } from 'zod';

// ============================================
// LedgerEdge
// Typed relationships between ledger commits and other entities.
// Turns the flat commit list into a directed acyclic graph.
// Example: commit → leak_instance (triggered_by), commit → event (references)
// ============================================

export const LedgerEdgeTargetTypeSchema = z.enum([
  'leak_instance',
  'event',
  'metric_snapshot',
  'proposed_action',
  'executed_action',
  'ledger_commit',   // commit-to-commit dependencies
  'entity_link',     // cross-tool context
]);
export type LedgerEdgeTargetType = z.infer<typeof LedgerEdgeTargetTypeSchema>;

export const LedgerEdgeTypeSchema = z.enum([
  'triggered_by',    // this commit was triggered by a leak
  'references',      // this commit references an event as evidence
  'measured_by',     // metric that quantifies the impact
  'resulted_in',     // this commit caused an action
  'supersedes',      // this commit replaces a previous commit
  'depends_on',      // this commit depends on another being merged first
  'related_to',      // general association
  'promoted_to',     // team decision promoted to org policy
  'branched_from',   // one leak triggered multiple team decisions (fork point)
]);
export type LedgerEdgeType = z.infer<typeof LedgerEdgeTypeSchema>;

export const LedgerEdgeSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  commit_id: z.string().uuid(),       // source: always a ledger commit
  target_type: LedgerEdgeTargetTypeSchema,
  target_id: z.string().uuid(),
  edge_type: LedgerEdgeTypeSchema,
  metadata: z.record(z.unknown()).default({}),
  created_at: z.coerce.date(),
});

export type LedgerEdge = z.infer<typeof LedgerEdgeSchema>;

export const CreateLedgerEdgeSchema = LedgerEdgeSchema.omit({
  id: true,
  created_at: true,
});

export type CreateLedgerEdge = z.infer<typeof CreateLedgerEdgeSchema>;
