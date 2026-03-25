import { z } from 'zod';

// ============================================
// Provider Names — extensible union
// ============================================
export const ProviderNameSchema = z.enum(['slack', 'jira', 'github']);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

// For custom providers (Linear, Zendesk, etc.)
export type ExtendedProviderName = ProviderName | (string & {});

// ============================================
// Adapter Capabilities
// ============================================
export const AdapterCapabilitySchema = z.enum([
  'webhook_ingest',    // Can receive webhooks
  'outbound_action',   // Can execute actions on the platform
  'entity_resolve',    // Can resolve cross-platform entity references
  'realtime_stream',   // Can stream events in realtime (future: WebSocket)
]);
export type AdapterCapability = z.infer<typeof AdapterCapabilitySchema>;

// ============================================
// Risk Levels
// ============================================
export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

// ============================================
// Webhook Request (platform-agnostic)
// ============================================
export type WebhookRequest = {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  rawBody: string;
  query?: Record<string, string>;
};

// ============================================
// Entity Reference (cross-platform link)
// ============================================
export const EntityReferenceSchema = z.object({
  provider: z.string(),
  entityType: z.string(),     // 'issue', 'pr', 'thread', 'channel', 'user'
  entityId: z.string(),
  url: z.string().optional(),
  title: z.string().optional(),
});
export type EntityReference = z.infer<typeof EntityReferenceSchema>;

// ============================================
// Normalized Event (what publishers emit)
// ============================================
export const NormalizedEventSchema = z.object({
  provider: z.string(),
  eventType: z.string(),
  entityId: z.string(),
  providerEventId: z.string(),
  timestamp: z.coerce.date(),
  companyId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()),
  rawPayload: z.unknown().optional(),
  crossReferences: z.array(EntityReferenceSchema).default([]),
});
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

// ============================================
// Outbound Action (what consumers send to publishers)
// ============================================
export const OutboundActionSchema = z.object({
  provider: z.string(),
  actionType: z.string(),
  targetId: z.string(),
  companyId: z.string().uuid(),
  payload: z.record(z.unknown()),
  riskLevel: RiskLevelSchema,
  metadata: z.record(z.unknown()).default({}),
});
export type OutboundAction = z.infer<typeof OutboundActionSchema>;

// ============================================
// Action Result (what publishers return after execution)
// ============================================
export const ActionResultSchema = z.object({
  success: z.boolean(),
  provider: z.string(),
  executionDetails: z.record(z.unknown()),
  rollbackInfo: z.object({
    canRollback: z.boolean(),
    rollbackType: z.string().optional(),
    rollbackData: z.record(z.unknown()).default({}),
  }),
  error: z.string().optional(),
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

// ============================================
// Rollback Result
// ============================================
export const RollbackResultSchema = z.object({
  success: z.boolean(),
  reason: z.string().optional(),
});
export type RollbackResult = z.infer<typeof RollbackResultSchema>;

// ============================================
// Resolved Entity (from entity resolution)
// ============================================
export const ResolvedEntitySchema = z.object({
  provider: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  url: z.string().optional(),
  title: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type ResolvedEntity = z.infer<typeof ResolvedEntitySchema>;

// ============================================
// Health Status
// ============================================
export const HealthStatusSchema = z.object({
  healthy: z.boolean(),
  provider: z.string(),
  latencyMs: z.number().optional(),
  lastEventAt: z.coerce.date().optional(),
  details: z.record(z.unknown()).default({}),
});
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

// ============================================
// Integration (credentials + config for a provider)
// ============================================
export type Integration = {
  id: string;
  companyId: string;
  provider: string;
  status: 'active' | 'inactive' | 'error';
  tokenData: Record<string, unknown>;
  installationData: Record<string, unknown>;
};
