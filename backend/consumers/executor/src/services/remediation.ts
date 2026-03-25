import { query } from '@flowguard/db';
import { logger } from '../logger.js';

/**
 * RemediationService — ProposedAction + ExecutedAction management.
 *
 * Migrated from apps/api/src/services/remediation.ts.
 * All business logic preserved.
 */
export class RemediationService {
  async createProposal(action: {
    company_id: string;
    leak_instance_id?: string | null;
    action_type: string;
    target_system: string;
    target_id: string;
    preview_diff: Record<string, unknown>;
    risk_level: string;
    blast_radius?: string | null;
    approval_status?: string;
    requested_by?: string | null;
  }): Promise<Record<string, any>> {
    const result = await query(
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

    logger.info({ id: result.rows[0].id, action_type: action.action_type }, 'Proposed action created');
    return result.rows[0];
  }

  async updateApproval(id: string, status: string, userId?: string): Promise<Record<string, any> | null> {
    const result = await query(
      `UPDATE proposed_actions SET approval_status = $1, approved_by = $2, approved_at = $3, updated_at = NOW() WHERE id = $4 RETURNING *`,
      [status, userId || null, status === 'approved' ? new Date() : null, id],
    );
    return result.rows[0] || null;
  }

  async getProposalById(id: string): Promise<Record<string, any> | null> {
    const result = await query('SELECT * FROM proposed_actions WHERE id = $1', [id]);
    return result.rows[0] || null;
  }
}

export const remediationService = new RemediationService();
