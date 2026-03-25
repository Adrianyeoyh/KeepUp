import type { EventPayloadMap, EventEnvelope } from '@flowguard/event-bus';
import { TOPICS } from '@flowguard/event-bus';
import { triggerLedgerWriteback } from '../services/writeback.js';
import { logger } from '../logger.js';

type LedgerApprovedPayload = EventPayloadMap[typeof TOPICS.LEDGER_APPROVED];

/**
 * Handler for ledger.approved topic.
 * Triggers writeback to originating platforms when a commit is approved/merged.
 */
export async function onCommitApproved(
  payload: LedgerApprovedPayload,
  envelope: EventEnvelope<LedgerApprovedPayload>,
): Promise<void> {
  logger.info(
    { commitId: payload.commitId, newStatus: payload.newStatus, traceId: envelope.traceId },
    'Ledger commit approved — triggering writeback',
  );

  await triggerLedgerWriteback(payload.commitId);
}
