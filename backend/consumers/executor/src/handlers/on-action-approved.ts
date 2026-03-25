import type { EventPayloadMap, EventEnvelope } from '@flowguard/event-bus';
import { TOPICS } from '@flowguard/event-bus';
import { query } from '@flowguard/db';
import { executeApprovedAction } from '../services/executor.js';
import { logger } from '../logger.js';

type ActionApprovedPayload = EventPayloadMap[typeof TOPICS.ACTIONS_APPROVED];

/**
 * Handler for actions.approved topic.
 * Fetches the proposed action and executes it via the adapter registry.
 */
export async function onActionApproved(
  payload: ActionApprovedPayload,
  envelope: EventEnvelope<ActionApprovedPayload>,
): Promise<void> {
  logger.info(
    { proposedActionId: payload.proposedActionId, approvedBy: payload.approvedBy, traceId: envelope.traceId },
    'Action approved — executing',
  );

  // Fetch the proposed action from DB
  const result = await query<{
    id: string;
    company_id: string;
    leak_instance_id: string | null;
    action_type: string;
    target_system: string;
    target_id: string;
    preview_diff: Record<string, any>;
    risk_level: string;
    blast_radius: string | null;
  }>(
    'SELECT * FROM proposed_actions WHERE id = $1',
    [payload.proposedActionId],
  );

  const action = result.rows[0];
  if (!action) {
    logger.error({ proposedActionId: payload.proposedActionId }, 'Proposed action not found');
    return;
  }

  await executeApprovedAction({
    id: action.id,
    company_id: action.company_id,
    leak_instance_id: action.leak_instance_id,
    action_type: action.action_type,
    target_system: action.target_system,
    target_id: action.target_id,
    preview_diff: action.preview_diff,
    risk_level: action.risk_level as any,
    blast_radius: action.blast_radius || undefined,
  });
}
