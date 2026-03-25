import type { CreateProposedAction, ProposedAction, CreateExecutedAction, ExecutedAction, ApprovalStatus } from '@flowguard/shared';
import { query } from '../db/client.js';
import { logger } from '../logger.js';

/**
 * RemediationService — ProposedAction + ExecutedAction management.
 *
 * Handles the full lifecycle:
 *   pending → approved/rejected → executed → (optionally rolled_back)
 */
export class RemediationService {
  // ==========================================
  // Proposed Actions
  // ==========================================

  async createProposal(action: CreateProposedAction): Promise<ProposedAction> {
    const result = await query<ProposedAction>(
      `INSERT INTO proposed_actions (
        company_id, leak_instance_id, action_type, target_system,
        target_id, preview_diff, risk_level, blast_radius,
        approval_status, requested_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        action.company_id,
        action.leak_instance_id || null,
        action.action_type,
        action.target_system,
        action.target_id,
        JSON.stringify(action.preview_diff),
        action.risk_level,
        action.blast_radius || null,
        action.approval_status || 'pending',
        action.requested_by || null,
      ],
    );

    logger.info({
      id: result.rows[0].id,
      action_type: action.action_type,
      target: `${action.target_system}:${action.target_id}`,
    }, 'Proposed action created');

    return result.rows[0];
  }

  async updateApproval(
    id: string,
    status: ApprovalStatus,
    userId?: string,
  ): Promise<ProposedAction | null> {
    const result = await query<ProposedAction>(
      `UPDATE proposed_actions
       SET approval_status = $1, approved_by = $2, approved_at = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, userId || null, status === 'approved' ? new Date() : null, id],
    );

    if (result.rows[0]) {
      logger.info({ id, status, by: userId }, 'Proposed action updated');
    }

    return result.rows[0] || null;
  }

  async getProposalById(id: string): Promise<ProposedAction | null> {
    const result = await query<ProposedAction>(
      'SELECT * FROM proposed_actions WHERE id = $1',
      [id],
    );
    return result.rows[0] || null;
  }

  async listPendingByCompany(companyId: string): Promise<ProposedAction[]> {
    const result = await query<ProposedAction>(
      `SELECT * FROM proposed_actions
       WHERE company_id = $1 AND approval_status = 'pending'
       ORDER BY created_at DESC`,
      [companyId],
    );
    return result.rows;
  }

  // ==========================================
  // Executed Actions (audit trail)
  // ==========================================

  async recordExecution(action: CreateExecutedAction): Promise<ExecutedAction> {
    // Also update the proposed_action status
    await query(
      `UPDATE proposed_actions SET approval_status = $1, updated_at = NOW() WHERE id = $2`,
      [action.result === 'success' ? 'executed' : 'failed', action.proposed_action_id],
    );

    const result = await query<ExecutedAction>(
      `INSERT INTO executed_actions (
        company_id, proposed_action_id, executed_at, result,
        execution_details, rollback_info, audit_log
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        action.company_id,
        action.proposed_action_id,
        action.executed_at,
        action.result,
        JSON.stringify(action.execution_details),
        JSON.stringify(action.rollback_info),
        JSON.stringify(action.audit_log),
      ],
    );

    logger.info({
      id: result.rows[0].id,
      proposed_action_id: action.proposed_action_id,
      result: action.result,
    }, 'Action executed — audit recorded');

    // Auto-create resulted_in edge: link any related ledger commit to this execution
    if (action.result === 'success') {
      try {
        // Find ledger commits that triggered_by the same leak as this action
        const proposalResult = await query<{ leak_instance_id: string | null }>(
          `SELECT leak_instance_id FROM proposed_actions WHERE id = $1`,
          [action.proposed_action_id],
        );
        const leakId = proposalResult.rows[0]?.leak_instance_id;

        if (leakId) {
          const commitResult = await query<{ id: string }>(
            `SELECT lc.id FROM ledger_commits lc
             WHERE lc.leak_instance_id = $1 AND lc.company_id = $2
             ORDER BY lc.created_at DESC LIMIT 1`,
            [leakId, action.company_id],
          );

          if (commitResult.rows[0]) {
            await query(
              `INSERT INTO ledger_edges (company_id, commit_id, target_type, target_id, edge_type, metadata)
               VALUES ($1, $2, 'executed_action', $3, 'resulted_in', $4)
               ON CONFLICT DO NOTHING`,
              [action.company_id, commitResult.rows[0].id, result.rows[0].id, JSON.stringify({ result: action.result })],
            );
          }
        }
      } catch (edgeErr) {
        logger.warn({ edgeErr, executionId: result.rows[0].id }, 'resulted_in edge creation failed — non-fatal');
      }
    }

    return result.rows[0];
  }

  async getExecutionHistory(companyId: string, limit = 50): Promise<ExecutedAction[]> {
    const result = await query<ExecutedAction>(
      `SELECT * FROM executed_actions
       WHERE company_id = $1
       ORDER BY executed_at DESC
       LIMIT $2`,
      [companyId, limit],
    );
    return result.rows;
  }
}

export const remediationService = new RemediationService();
