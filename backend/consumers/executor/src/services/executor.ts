import { adapterRegistry } from '@flowguard/adapter-sdk';
import type { RiskLevel } from '@flowguard/adapter-sdk';
import { query } from '@flowguard/db';
import { logger } from '../logger.js';

/**
 * Executor Service — Executes approved remediation actions.
 *
 * Migrated from apps/api/src/services/executor.ts.
 * Key change: uses adapterRegistry.executeAction() instead of direct SDK imports.
 * Adding a new target system requires ZERO changes here.
 */

const ALLOWED_RISK_LEVELS: RiskLevel[] = ['low', 'medium'];

interface ProposedAction {
  id: string;
  company_id: string;
  leak_instance_id?: string | null;
  action_type: string;
  target_system: string;
  target_id: string;
  preview_diff?: Record<string, any>;
  risk_level: RiskLevel;
  blast_radius?: string;
}

function enforceBlastRadius(action: ProposedAction): { allowed: boolean; reason?: string } {
  if (!ALLOWED_RISK_LEVELS.includes(action.risk_level)) {
    return { allowed: false, reason: `Risk level '${action.risk_level}' exceeds MVP blast-radius policy (max: medium)` };
  }

  if (action.blast_radius) {
    if (action.blast_radius.startsWith('workspace:') || action.blast_radius.startsWith('org:')) {
      return { allowed: false, reason: `Blast radius '${action.blast_radius}' too broad for automated execution` };
    }
  }

  return { allowed: true };
}

/**
 * Execute an approved action using the adapter registry.
 * This is the key architectural improvement — the executor is provider-agnostic.
 */
export async function executeApprovedAction(action: ProposedAction): Promise<void> {
  // Blast-radius enforcement
  const blastCheck = enforceBlastRadius(action);
  if (!blastCheck.allowed) {
    logger.warn({ actionId: action.id, reason: blastCheck.reason }, 'Action blocked by blast-radius policy');
    await recordExecution(action, 'failure', { reason: 'blast_radius_policy', detail: blastCheck.reason });
    return;
  }

  // Determine the provider from target_system
  const provider = action.target_system;

  if (!adapterRegistry.has(provider)) {
    logger.error({ provider, actionId: action.id }, 'No adapter registered for target system');
    await recordExecution(action, 'failure', { reason: 'no_adapter_registered', provider });
    return;
  }

  try {
    // Map legacy action types to adapter action types
    const actionType = mapActionType(action.action_type, provider);
    const text =
      (action.preview_diff?.after as string) ||
      (action.preview_diff?.description as string) ||
      'FlowGuard approved reminder.';

    const result = await adapterRegistry.executeAction({
      provider,
      actionType,
      targetId: action.target_id,
      companyId: action.company_id,
      payload: { text, ...action.preview_diff },
      riskLevel: action.risk_level,
      metadata: { proposed_action_id: action.id },
    });

    await recordExecution(
      action,
      result.success ? 'success' : 'failure',
      result.executionDetails,
      result.rollbackInfo,
    );

    if (result.success) {
      logger.info({ actionId: action.id, provider }, 'Action executed successfully');
    } else {
      logger.warn({ actionId: action.id, provider, error: result.error }, 'Action execution failed');
    }
  } catch (error) {
    logger.error({ error, actionId: action.id }, 'Action execution threw');
    await recordExecution(action, 'failure', {
      reason: 'execution_error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

function mapActionType(actionType: string, provider: string): string {
  // Map legacy executor action types to adapter-standard types
  if (provider === 'slack') return 'post_message';
  if (provider === 'jira') return 'add_comment';
  if (provider === 'github') return 'add_pr_comment';
  return actionType;
}

async function recordExecution(
  action: ProposedAction,
  result: 'success' | 'failure',
  executionDetails: Record<string, unknown>,
  rollbackInfo?: { canRollback: boolean; rollbackType?: string; rollbackData: Record<string, unknown> },
): Promise<void> {
  try {
    await query(
      `UPDATE proposed_actions SET approval_status = $1, updated_at = NOW() WHERE id = $2`,
      [result === 'success' ? 'executed' : 'failed', action.id],
    );

    await query(
      `INSERT INTO executed_actions (
        company_id, proposed_action_id, executed_at, result,
        execution_details, rollback_info, audit_log
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        action.company_id,
        action.id,
        new Date(),
        result,
        JSON.stringify(executionDetails),
        JSON.stringify(rollbackInfo || { can_rollback: false, rollback_data: {} }),
        JSON.stringify([{
          timestamp: new Date(),
          action: 'execute_proposed_action',
          actor: 'flowguard-system',
          details: { proposed_action_id: action.id, target_system: action.target_system, result },
        }]),
      ],
    );
  } catch (err) {
    logger.error({ err, actionId: action.id }, 'Failed to record execution');
  }
}
