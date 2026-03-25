import type { CreateLedgerCommit, LedgerCommit, CommitStatus } from '@flowguard/shared';
import { query } from '../db/client.js';
import { logger } from '../logger.js';

type LedgerCommitRow = LedgerCommit & {
  team_id: string | null;
  project_id: string | null;
  scope_level: string | null;
};

/**
 * LedgerService — Git-style memory anchor CRUD + state machine.
 *
 * Manages LedgerCommits (Decision Records, Action Items, Policy changes).
 * State machine: draft → proposed → approved/rejected → merged
 *
 * v2: Auto-creates ledger_edges after commit creation to build the graph.
 */
export class LedgerService {
  /**
   * Create a new ledger commit (memory anchor).
   * v2: Also creates typed ledger_edges automatically.
   */
  async create(
    commit: CreateLedgerCommit & { team_id?: string; project_id?: string; scope_level?: string },
  ): Promise<LedgerCommit> {
    const result = await query<LedgerCommitRow>(
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

    logger.info({
      id: newCommit.id,
      type: commit.commit_type,
      title: commit.title,
      team_id: commit.team_id || null,
    }, 'Ledger commit created');

    // v2: Auto-create ledger_edges
    await this.createAutoEdges(newCommit, commit);

    return newCommit;
  }

  /**
   * Auto-create ledger_edges from commit context.
   * - triggered_by: if commit was triggered by a leak
   * - references: for each evidence link event
   * - depends_on: for parent commit chain
   */
  private async createAutoEdges(
    commit: LedgerCommitRow,
    input: CreateLedgerCommit,
  ): Promise<void> {
    try {
      const edges: Array<{ target_type: string; target_id: string; edge_type: string }> = [];

      // Edge: commit was triggered by a leak
      if (commit.leak_instance_id) {
        edges.push({
          target_type: 'leak_instance',
          target_id: commit.leak_instance_id,
          edge_type: 'triggered_by',
        });
      }

      // Edge: commit depends on parent commit
      if (commit.parent_commit_id) {
        edges.push({
          target_type: 'ledger_commit',
          target_id: commit.parent_commit_id,
          edge_type: 'depends_on',
        });
      }

      // Edge: commit references evidence events
      const evidenceLinks = Array.isArray(input.evidence_links) ? input.evidence_links : [];
      const requestedEventIds = new Set<string>();
      for (const evidence of evidenceLinks) {
        if (!evidence || typeof evidence !== 'object' || !('event_id' in evidence)) {
          continue;
        }
        const eventId = (evidence as { event_id?: unknown }).event_id;
        if (typeof eventId === 'string' && eventId.trim().length > 0) {
          requestedEventIds.add(eventId.trim());
        }
      }

      if (requestedEventIds.size > 0) {
        const eventIdList = Array.from(requestedEventIds);
        const existingEvents = await query<{ id: string }>(
          `SELECT id::text AS id
           FROM events
           WHERE company_id = $1
             AND id::text = ANY($2::text[])`,
          [commit.company_id, eventIdList],
        );
        const existingEventIds = new Set(existingEvents.rows.map((row) => row.id));

        for (const eventId of eventIdList) {
          if (!existingEventIds.has(eventId)) {
            logger.warn(
              { commit_id: commit.id, event_id: eventId },
              'Skipped references edge: event not found in company scope',
            );
            continue;
          }
          edges.push({
            target_type: 'event',
            target_id: eventId,
            edge_type: 'references',
          });
        }
      }

      // Edge: measured_by — link commit to relevant metric snapshots
      // Auto-detects if there are recent metric snapshots for the same team/project
      if (commit.team_id) {
        const metricResult = await query<{ id: string }>(
          `SELECT id FROM metric_snapshots
           WHERE company_id = $1 AND scope = 'team' AND scope_id = $2
             AND date >= (CURRENT_DATE - INTERVAL '7 days')
           ORDER BY date DESC LIMIT 3`,
          [commit.company_id, commit.team_id],
        );
        for (const metric of metricResult.rows) {
          edges.push({
            target_type: 'metric_snapshot',
            target_id: metric.id,
            edge_type: 'measured_by',
          });
        }
      }

      // Edge: supersedes — newer commits on the same leak supersede prior ones
      if (commit.leak_instance_id) {
        const priorResult = await query<{ id: string }>(
          `SELECT id FROM ledger_commits
           WHERE company_id = $1
             AND leak_instance_id = $2
             AND id != $3
           ORDER BY created_at DESC LIMIT 1`,
          [commit.company_id, commit.leak_instance_id, commit.id],
        );
        if (priorResult.rows[0]) {
          edges.push({
            target_type: 'ledger_commit',
            target_id: priorResult.rows[0].id,
            edge_type: 'supersedes',
          });
        }
      }

      // Insert edges
      for (const edge of edges) {
        await query(
          `INSERT INTO ledger_edges (company_id, commit_id, target_type, target_id, edge_type)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [commit.company_id, commit.id, edge.target_type, edge.target_id, edge.edge_type],
        );
      }

      if (edges.length > 0) {
        logger.debug({ commit_id: commit.id, edge_count: edges.length }, 'Ledger edges auto-created');
      }
    } catch (err) {
      // Never fail commit creation due to edge errors
      logger.warn({ err, commit_id: commit.id }, 'Failed to create auto-edges — commit still saved');
    }
  }

  /**
   * Get all edges for a commit (full graph context).
   */
  async getEdges(commitId: string): Promise<Array<{
    id: string;
    commit_id: string;
    target_type: string;
    target_id: string;
    edge_type: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }>> {
    const result = await query(
      `SELECT * FROM ledger_edges WHERE commit_id = $1 ORDER BY edge_type, created_at`,
      [commitId],
    );
    return result.rows;
  }

  /**
   * Transition a commit to a new status (state machine).
   * Valid transitions:
   *   draft → proposed
   *   proposed → approved | rejected
   *   approved → merged
   */
  async transition(
    id: string,
    newStatus: CommitStatus,
    userId?: string,
  ): Promise<LedgerCommit | null> {
    const validTransitions: Record<string, string[]> = {
      draft: ['proposed'],
      proposed: ['approved', 'rejected'],
      approved: ['merged'],
    };

    // Get current commit
    const current = await this.getById(id);
    if (!current) return null;

    const allowed = validTransitions[current.status] || [];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid transition: ${current.status} → ${newStatus}. Allowed: ${allowed.join(', ')}`,
      );
    }

    const updates: Record<string, any> = {
      status: newStatus,
      updated_at: new Date(),
    };

    if (newStatus === 'approved' || newStatus === 'merged') {
      updates.approved_by = userId;
      updates.approved_at = new Date();
    }

    const result = await query<LedgerCommit>(
      `UPDATE ledger_commits
       SET status = $1, approved_by = $2, approved_at = $3, updated_at = $4
       WHERE id = $5
       RETURNING *`,
      [newStatus, updates.approved_by || null, updates.approved_at || null, updates.updated_at, id],
    );

    logger.info({
      id,
      from: current.status,
      to: newStatus,
      by: userId,
    }, 'Ledger commit transitioned');

    // Trigger writeback to originating threads/issues when approved or merged
    if (newStatus === 'approved' || newStatus === 'merged') {
      // Dynamic import to avoid circular dependency (executor → ledger → executor)
      void import('./executor.js').then(({ triggerLedgerWriteback }) => {
        triggerLedgerWriteback(id).catch((err) => {
          logger.error({ err, commitId: id }, 'Ledger writeback trigger failed');
        });
      });
    }

    return result.rows[0] || null;
  }

  /**
   * Get a commit by ID.
   */
  async getById(id: string): Promise<LedgerCommit | null> {
    const result = await query<LedgerCommit>(
      'SELECT * FROM ledger_commits WHERE id = $1',
      [id],
    );
    return result.rows[0] || null;
  }

  /**
   * List commits for a company (most recent first).
   */
  async listByCompany(
    companyId: string,
    options: { status?: CommitStatus; commit_type?: string; limit?: number } = {},
  ): Promise<LedgerCommit[]> {
    const conditions: string[] = ['company_id = $1'];
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (options.status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(options.status);
    }
    if (options.commit_type) {
      conditions.push(`commit_type = $${paramIdx++}`);
      params.push(options.commit_type);
    }

    const limitVal = options.limit || 50;
    params.push(limitVal);

    const result = await query<LedgerCommit>(
      `SELECT * FROM ledger_commits
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${paramIdx}`,
      params,
    );
    return result.rows;
  }
}

export const ledgerService = new LedgerService();
