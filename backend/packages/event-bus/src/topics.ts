import { z } from 'zod';
import { NormalizedEventSchema } from '@flowguard/adapter-sdk';

// ============================================
// Topic Constants
// ============================================
export const TOPICS = {
  // Publisher → Consumer: raw normalized events from integrations
  EVENTS_INGESTED: 'events.ingested',

  // Data Processor → Digest/Ledger: new leak detected
  LEAKS_DETECTED: 'leaks.detected',

  // Dashboard/API → Data Processor: leak status changed (snoozed, dismissed)
  LEAKS_UPDATED: 'leaks.updated',

  // Cron → Digest Consumer: time to build and send digest
  DIGEST_TICK: 'digest.tick',

  // Dashboard/API → Executor: human approved a proposed action
  ACTIONS_APPROVED: 'actions.approved',

  // Executor → Audit: action was executed
  ACTIONS_EXECUTED: 'actions.executed',

  // Ledger Consumer → Event Bus: new ledger commit created
  LEDGER_COMMITTED: 'ledger.committed',

  // Ledger Consumer → Executor: commit approved/merged, trigger writeback
  LEDGER_APPROVED: 'ledger.approved',

  // Consumer → AI Engine: request AI diagnosis for a leak
  AI_DIAGNOSIS_REQ: 'ai.diagnosis.req',

  // Consumer → AI Engine: request AI draft (user story, summary)
  AI_DRAFT_REQ: 'ai.draft.req',
} as const;

export type EventTopic = (typeof TOPICS)[keyof typeof TOPICS];

// ============================================
// Payload Schemas per Topic
// ============================================
export const EventPayloadSchemas = {
  [TOPICS.EVENTS_INGESTED]: NormalizedEventSchema,

  [TOPICS.LEAKS_DETECTED]: z.object({
    companyId: z.string().uuid(),
    leakId: z.string().uuid(),
    leakType: z.string(),
    severity: z.number(),
    confidence: z.number(),
    teamId: z.string().uuid().optional(),
  }),

  [TOPICS.LEAKS_UPDATED]: z.object({
    companyId: z.string().uuid(),
    leakId: z.string().uuid(),
    newStatus: z.string(),
    reason: z.string().optional(),
  }),

  [TOPICS.DIGEST_TICK]: z.object({
    companyId: z.string().uuid().optional(), // null = all companies
    digestType: z.enum(['daily', 'morning_pulse', 'nudges', 'decision_capture', 'sprint_retro']),
  }),

  [TOPICS.ACTIONS_APPROVED]: z.object({
    companyId: z.string().uuid(),
    proposedActionId: z.string().uuid(),
    approvedBy: z.string().optional(),
  }),

  [TOPICS.ACTIONS_EXECUTED]: z.object({
    companyId: z.string().uuid(),
    proposedActionId: z.string().uuid(),
    executedActionId: z.string().uuid(),
    result: z.enum(['success', 'failure']),
  }),

  [TOPICS.LEDGER_COMMITTED]: z.object({
    companyId: z.string().uuid(),
    commitId: z.string().uuid(),
    commitType: z.string(),
    title: z.string(),
  }),

  [TOPICS.LEDGER_APPROVED]: z.object({
    companyId: z.string().uuid(),
    commitId: z.string().uuid(),
    newStatus: z.enum(['approved', 'merged']),
    approvedBy: z.string().optional(),
  }),

  [TOPICS.AI_DIAGNOSIS_REQ]: z.object({
    companyId: z.string().uuid(),
    leakId: z.string().uuid(),
    leakType: z.string(),
    metricsContext: z.record(z.unknown()),
    evidenceLinks: z.array(z.record(z.unknown())),
  }),

  [TOPICS.AI_DRAFT_REQ]: z.object({
    companyId: z.string().uuid(),
    draftType: z.enum(['user_story', 'decision_summary', 'sprint_estimate']),
    context: z.record(z.unknown()),
  }),
} as const;

// ============================================
// Type-level payload map (for generics)
// ============================================
export type EventPayloadMap = {
  [K in EventTopic]: z.infer<(typeof EventPayloadSchemas)[K]>;
};
