import { query } from '@flowguard/db';
import { logger } from '../logger.js';

/**
 * LedgerService — Git-style memory anchor CRUD + state machine.
 *
 * Migrated from apps/api/src/services/ledger.ts.
 * All business logic preserved including auto-edge creation.
 *
 * State machine: draft -> proposed -> approved/rejected -> merged
 */
export class LedgerService {
  async create(commit: {
    company_id: string;
    commit_type: string;
    title: string;
    summary: string;
    rationale?: string | null;
    dri?: string | null;
    status?: string;
    branch_name?: string;
    parent_commit_id?: string | null;
    evidence_links?: unknown[];
    tags?: string[];
    leak_instance_id?: string | null;
    created_by?: string | null;
    team_id?: string | null;
    project_id?: string | null;
    scope_level?: string;
  }): Promise<Record<string, any>> {
    const result = await query(
      `INSERT INTO ledger_commits (
        company_id, commit_type, title, summary, rationale,
        dri, status, branch_name, parent_commit_id,
        evidence_links, tags, leak_instance_id, created_by,
        team_id, project_id, scope_level
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        commit.company_id,
        commit.commit_type,
        commit.title,
        commit.summary,
        commit.rationale || null,
        commit.dri || null,
        commit.status || 'draft',
        commit.branch_name || 'main',
        commit.parent_commit_id || null,
        JSON.stringify(commit.evidence_links || []),
        JSON.stringify(commit.tags || []),
        commit.leak_instance_id || null,
        commit.created_by || null,
        commit.team_id || null,
        commit.project_id || null,
        commit.scope_level || 'team',
      ],
    );

    const newCommit = result.rows[0];
    logger.info({ id: newCommit.id, type: commit.commit_type, title: commit.title }, 'Ledger commit created');

    // Auto-create edges
    await this.createAutoEdges(newCommit, commit);

    return newCommit;
  }

  private async createAutoEdges(commit: Record<string, any>, input: Record<string, any>): Promise<void> {
    try {
      const edges: Array<{ target_type: string; target_id: string; edge_type: string }> = [];

      if (commit.leak_instance_id) {
        edges.push({ target_type: 'leak_instance', target_id: commit.leak_instance_id, edge_type: 'triggered_by' });
      }
      if (commit.parent_commit_id) {
        edges.push({ target_type: 'ledger_commit', target_id: commit.parent_commit_id, edge_type: 'depends_on' });
      }

      // Supersedes edge
      if (commit.leak_instance_id) {
        const priorResult = await query<{ id: string }>(
          `SELECT id FROM ledger_commits WHERE company_id = $1 AND leak_instance_id = $2 AND id != $3 ORDER BY created_at DESC LIMIT 1`,
          [commit.company_id, commit.leak_instance_id, commit.id],
        );
        if (priorResult.rows[0]) {
          edges.push({ target_type: 'ledger_commit', target_id: priorResult.rows[0].id, edge_type: 'supersedes' });
        }
      }

      for (const edge of edges) {
        await query(
          `INSERT INTO ledger_edges (company_id, commit_id, target_type, target_id, edge_type) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [commit.company_id, commit.id, edge.target_type, edge.target_id, edge.edge_type],
        );
      }
    } catch (err) {
      logger.warn({ err, commit_id: commit.id }, 'Failed to create auto-edges');
    }
  }

  async transition(id: string, newStatus: string, userId?: string): Promise<Record<string, any> | null> {
    const validTransitions: Record<string, string[]> = {
      draft: ['proposed'],
      proposed: ['approved', 'rejected'],
      approved: ['merged'],
    };

    const current = await this.getById(id);
    if (!current) return null;

    const allowed = validTransitions[current.status] || [];
    if (!allowed.includes(newStatus)) {
      throw new Error(`Invalid transition: ${current.status} -> ${newStatus}. Allowed: ${allowed.join(', ')}`);
    }

    const result = await query(
      `UPDATE ledger_commits
       SET status = $1, approved_by = $2, approved_at = $3, updated_at = $4
       WHERE id = $5 RETURNING *`,
      [
        newStatus,
        (newStatus === 'approved' || newStatus === 'merged') ? (userId || null) : null,
        (newStatus === 'approved' || newStatus === 'merged') ? new Date() : null,
        new Date(),
        id,
      ],
    );

    logger.info({ id, from: current.status, to: newStatus, by: userId }, 'Ledger commit transitioned');
    return result.rows[0] || null;
  }

  async getById(id: string): Promise<Record<string, any> | null> {
    const result = await query('SELECT * FROM ledger_commits WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async listByCompany(
    companyId: string,
    options: { status?: string; commit_type?: string; limit?: number } = {},
  ): Promise<Record<string, any>[]> {
    const conditions: string[] = ['company_id = $1'];
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (options.status) { conditions.push(`status = $${paramIdx++}`); params.push(options.status); }
    if (options.commit_type) { conditions.push(`commit_type = $${paramIdx++}`); params.push(options.commit_type); }

    const limitVal = options.limit || 50;
    params.push(limitVal);

    const result = await query(
      `SELECT * FROM ledger_commits WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${paramIdx}`,
      params,
    );
    return result.rows;
  }

  async getEdges(commitId: string): Promise<Record<string, any>[]> {
    const result = await query(
      `SELECT * FROM ledger_edges WHERE commit_id = $1 ORDER BY edge_type, created_at`,
      [commitId],
    );
    return result.rows;
  }
}

export const ledgerService = new LedgerService();
