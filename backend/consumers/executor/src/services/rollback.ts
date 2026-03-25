import { adapterRegistry } from '@flowguard/adapter-sdk';
import { query } from '@flowguard/db';
import { logger } from '../logger.js';

/**
 * Rollback Service — Rolls back executed actions via the adapter registry.
 *
 * Migrated from apps/api/src/services/executor.ts rollbackExecutedAction().
 * Key change: uses adapterRegistry instead of direct SDK imports.
 */
export async function rollbackExecutedAction(
  executedActionId: string,
  userId?: string,
): Promise<{ success: boolean; reason?: string }> {
  const result = await query<{
    id: string;
    company_id: string;
    proposed_action_id: string;
    rollback_info: any;
    audit_log: any[];
  }>(
    'SELECT * FROM executed_actions WHERE id = $1',
    [executedActionId],
  );

  const executed = result.rows[0];
  if (!executed) return { success: false, reason: 'Executed action not found' };

  const rollbackInfo = typeof executed.rollback_info === 'string'
    ? JSON.parse(executed.rollback_info)
    : executed.rollback_info;

  if (!rollbackInfo?.can_rollback && !rollbackInfo?.canRollback) {
    return { success: false, reason: 'Action does not support rollback' };
  }

  if (rollbackInfo.rolled_back_at) {
    return { success: false, reason: 'Action was already rolled back' };
  }

  // Get the original proposal to determine provider
  const proposal = await query<{ target_system: string }>(
    'SELECT target_system FROM proposed_actions WHERE id = $1',
    [executed.proposed_action_id],
  );

  const targetSystem = proposal.rows[0]?.target_system;
  if (!targetSystem || !adapterRegistry.has(targetSystem)) {
    return { success: false, reason: `No adapter for target system: ${targetSystem}` };
  }

  try {
    const rollbackData = rollbackInfo.rollback_data || rollbackInfo.rollbackData || {};

    const rollbackResult = await adapterRegistry.rollbackAction(
      {
        provider: targetSystem,
        actionType: 'rollback',
        targetId: '',
        companyId: executed.company_id,
        payload: rollbackData,
        riskLevel: 'low',
        metadata: { rollback: true },
      },
      executedActionId,
    );

    if (rollbackResult.success) {
      rollbackInfo.rolled_back_at = new Date();
      rollbackInfo.rolled_back_by = userId || 'system';

      await query(
        `UPDATE executed_actions SET rollback_info = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(rollbackInfo), executedActionId],
      );

      logger.info({ executedActionId, by: userId }, 'Action rolled back successfully');
      return { success: true };
    }

    return { success: false, reason: rollbackResult.reason || 'Rollback failed' };
  } catch (error) {
    logger.error({ error, executedActionId }, 'Rollback failed');
    return { success: false, reason: 'Rollback API call failed' };
  }
}
