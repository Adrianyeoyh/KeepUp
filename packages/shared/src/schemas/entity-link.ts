import { z } from 'zod';

// ============================================
// EntityLink
// Explicit cross-tool links between entities.
// e.g. Slack thread → Jira issue → GitHub PR
// Powers the connected graph and evidence chains.
// ============================================

export const EntityProviderSchema = z.enum(['slack', 'jira', 'github']);
export type EntityProvider = z.infer<typeof EntityProviderSchema>;

export const EntityLinkTypeSchema = z.enum([
  'mentions',       // Slack message mentions PROJ-123
  'fixes',          // PR fixes Jira issue (from commit/PR body)
  'blocks',         // Jira issue blocks another
  'caused_by',      // leak caused by this entity
  'results_in',     // decision resulted in this action
  'discussed_in',   // Jira issue discussed in Slack thread
  'reviewed_in',    // PR reviewed via GitHub
  'duplicates',     // Jira duplicate link (two teams reported same issue)
  'parent_of',      // Jira epic→story or parent→child relationship
  'auto_detected',  // system-detected relationship (ML/pattern matching)
  'manual',         // user-created link
]);
export type EntityLinkType = z.infer<typeof EntityLinkTypeSchema>;

export const EntityLinkDetectorSchema = z.enum(['system', 'user', 'ai']);
export type EntityLinkDetector = z.infer<typeof EntityLinkDetectorSchema>;

export const EntityLinkSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  // Source entity
  source_provider: EntityProviderSchema,
  source_entity_type: z.string(),   // thread, issue, pr, channel, commit
  source_entity_id: z.string(),
  // Target entity
  target_provider: EntityProviderSchema,
  target_entity_type: z.string(),
  target_entity_id: z.string(),
  // Link metadata
  link_type: EntityLinkTypeSchema,
  confidence: z.number().min(0).max(1).default(1.0),  // 1.0 = explicit, <1.0 = inferred
  detected_by: EntityLinkDetectorSchema.default('system'),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.coerce.date(),
});

export type EntityLink = z.infer<typeof EntityLinkSchema>;

export const CreateEntityLinkSchema = EntityLinkSchema.omit({
  id: true,
  created_at: true,
});

export type CreateEntityLink = z.infer<typeof CreateEntityLinkSchema>;
