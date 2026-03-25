import type { EventPayloadMap, EventEnvelope } from '@flowguard/event-bus';
import { TOPICS } from '@flowguard/event-bus';
import { validateDraft } from '../services/ai-guardrails.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

type DraftPayload = EventPayloadMap[typeof TOPICS.AI_DRAFT_REQ];

/**
 * Handler for ai.draft.req topic.
 *
 * Generates AI drafts (user stories, decision summaries, sprint estimates).
 * Migrated from apps/worker/src/services/ai-recommendation-drafts.ts.
 */
export async function onDraftRequested(
  payload: DraftPayload,
  envelope: EventEnvelope<DraftPayload>,
): Promise<void> {
  logger.info(
    { draftType: payload.draftType, companyId: payload.companyId, traceId: envelope.traceId },
    'AI draft requested',
  );

  if (!config.LLM_API_KEY) {
    logger.warn('LLM API key not configured — skipping AI draft');
    return;
  }

  try {
    logger.debug({ draftType: payload.draftType, context: payload.context }, 'Processing draft request');
    // Draft generation logic — placeholder for full migration from worker services
  } catch (err) {
    logger.error({ err, draftType: payload.draftType }, 'AI draft generation failed');
  }
}
