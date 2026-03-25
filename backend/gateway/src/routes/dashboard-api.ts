import { Router, Request, Response } from 'express';
import { query } from '@flowguard/db';
import { logger } from '../logger.js';

/**
 * Dashboard API routes — direct DB queries for the dashboard UI.
 * Migrated from apps/api/src/routes/dashboard-api.ts.
 *
 * These routes query the shared database directly (not through consumers).
 */
const router = Router();

router.get('/dashboard/overview', async (req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string; name: string; settings: Record<string, unknown> }>(
      `SELECT id, name, settings FROM companies ORDER BY created_at ASC LIMIT 1`,
    );
    const company = companiesResult.rows[0];
    if (!company) {
      res.json({ company: null, leaks: { total: 0, by_status: {} }, events: { total: 0 }, integrations: [] });
      return;
    }

    const companyId = company.id;
    const teamId = req.query.team_id as string | undefined;
    const projectId = req.query.project_id as string | undefined;

    let scopeFragment = '';
    const scopeParams: unknown[] = [];
    if (teamId) {
      scopeParams.push(teamId);
      scopeFragment = ` AND team_id = $${scopeParams.length + 1}`;
    } else if (projectId) {
      scopeParams.push(projectId);
      scopeFragment = ` AND project_id = $${scopeParams.length + 1}`;
    }

    const leakScopeParams = [companyId, ...scopeParams];
    const eventScopeParams = [companyId, ...scopeParams];

    const [leakStats, eventStats, recentLeaks, integrations] = await Promise.all([
      query<{ status: string; count: string }>(
        `SELECT status, COUNT(*) as count FROM leak_instances WHERE company_id = $1${scopeFragment} GROUP BY status`,
        leakScopeParams,
      ),
      query<{ source: string; count: string }>(
        `SELECT source, COUNT(*) as count FROM events WHERE company_id = $1 AND timestamp > NOW() - INTERVAL '7 days'${scopeFragment} GROUP BY source`,
        eventScopeParams,
      ),
      query(
        `SELECT id, leak_type, severity, confidence, status, detected_at, cost_estimate_hours_per_week, evidence_links, metrics_context, recommended_fix, ai_diagnosis, team_id, project_id
         FROM leak_instances WHERE company_id = $1${scopeFragment}
         ORDER BY detected_at DESC LIMIT 5`,
        leakScopeParams,
      ),
      query(
        `SELECT id, provider, status, updated_at FROM integrations WHERE company_id = $1`,
        [companyId],
      ),
    ]);

    const leaksByStatus: Record<string, number> = {};
    let totalLeaks = 0;
    for (const row of leakStats.rows) {
      leaksByStatus[row.status] = parseInt(row.count, 10);
      totalLeaks += parseInt(row.count, 10);
    }

    const eventsBySource: Record<string, number> = {};
    let totalEvents = 0;
    for (const row of eventStats.rows) {
      eventsBySource[row.source] = parseInt(row.count, 10);
      totalEvents += parseInt(row.count, 10);
    }

    res.json({
      company: { id: company.id, name: company.name, settings: company.settings },
      leaks: { total: totalLeaks, by_status: leaksByStatus, recent: recentLeaks.rows },
      events: { total: totalEvents, by_source: eventsBySource },
      integrations: integrations.rows,
    });
  } catch (err) {
    logger.error({ err }, 'Dashboard overview error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/dashboard/leaks', async (req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string }>(
      `SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`,
    );
    const companyId = req.query.company_id as string || companiesResult.rows[0]?.id;
    if (!companyId) { res.json({ leaks: [] }); return; }

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const status = req.query.status as string | undefined;

    let whereClause = 'WHERE company_id = $1';
    const params: unknown[] = [companyId];

    if (status) { params.push(status); whereClause += ` AND status = $${params.length}`; }

    const result = await query(
      `SELECT * FROM leak_instances ${whereClause} ORDER BY detected_at DESC LIMIT $${params.length + 1}`,
      [...params, limit],
    );

    res.json({ leaks: result.rows });
  } catch (err) {
    logger.error({ err }, 'Dashboard leaks error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/leaks/:id/snooze', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE leak_instances SET status = 'snoozed', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Leak not found' }); return; }
    res.json({ leak: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Snooze leak error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/leaks/:id/dismiss', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE leak_instances SET status = 'dismissed', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Leak not found' }); return; }
    res.json({ leak: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Dismiss leak error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
