import { Router, Request, Response } from 'express';
import { query } from '@flowguard/db';
import { ledgerService } from '../services/ledger.js';
import { logger } from '../logger.js';

/**
 * Ledger HTTP routes — mounted by the gateway.
 *
 * Migrated from apps/api/src/routes/ledger-routes.ts.
 * Preserves all CRUD + dispatch routes for ledger commits and routes.
 */
const router = Router();

async function resolvePrimaryCompanyId(): Promise<string | null> {
  const result = await query<{ id: string }>(
    `SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`,
  );
  return result.rows[0]?.id || null;
}

// ---- Ledger Commits ----

router.get('/ledger/commits', async (req: Request, res: Response) => {
  try {
    const companyId = (req.query.company_id as string) || await resolvePrimaryCompanyId();
    if (!companyId) { res.json({ commits: [] }); return; }

    const commits = await ledgerService.listByCompany(companyId, {
      status: req.query.status as string | undefined,
      commit_type: req.query.commit_type as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    });

    res.json({ commits });
  } catch (err) {
    logger.error({ err }, 'List ledger commits error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/ledger/commits', async (req: Request, res: Response) => {
  try {
    const companyId = req.body.company_id || await resolvePrimaryCompanyId();
    if (!companyId) { res.status(404).json({ error: 'No company found' }); return; }

    const commit = await ledgerService.create({
      company_id: companyId,
      ...req.body,
    });

    res.status(201).json({ commit });
  } catch (err) {
    logger.error({ err }, 'Create ledger commit error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/ledger/commits/:id', async (req: Request, res: Response) => {
  try {
    const commit = await ledgerService.getById(req.params.id);
    if (!commit) { res.status(404).json({ error: 'Commit not found' }); return; }

    const edges = await ledgerService.getEdges(req.params.id);
    res.json({ commit, edges });
  } catch (err) {
    logger.error({ err }, 'Get ledger commit error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/ledger/commits/:id/transition', async (req: Request, res: Response) => {
  try {
    const { status, user_id } = req.body;
    const commit = await ledgerService.transition(req.params.id, status, user_id);
    if (!commit) { res.status(404).json({ error: 'Commit not found' }); return; }
    res.json({ commit });
  } catch (err: any) {
    if (err?.message?.includes('Invalid transition')) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, 'Transition ledger commit error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Ledger Routes (graph exploration saves) ----

router.get('/ledger/routes', async (req: Request, res: Response) => {
  try {
    const companyId = await resolvePrimaryCompanyId();
    if (!companyId) { res.json({ routes: [] }); return; }

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 80));

    const result = await query(
      `SELECT * FROM ledger_routes WHERE company_id = $1 AND status = 'active' ORDER BY updated_at DESC LIMIT $2`,
      [companyId, limit],
    );

    res.json({ routes: result.rows });
  } catch (err) {
    logger.error({ err }, 'List ledger routes error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/ledger/routes', async (req: Request, res: Response) => {
  try {
    const companyId = await resolvePrimaryCompanyId();
    if (!companyId) { res.status(404).json({ error: 'No company found' }); return; }

    const { name, snapshot, team_id, project_id, solution_draft, dataset_signature, created_by } = req.body;

    if (!name || !snapshot) {
      res.status(400).json({ error: 'name and snapshot are required' });
      return;
    }

    const result = await query(
      `INSERT INTO ledger_routes (company_id, team_id, project_id, name, solution_draft, snapshot, dataset_signature, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING *`,
      [companyId, team_id || null, project_id || null, name, solution_draft || null, JSON.stringify(snapshot), dataset_signature || '', created_by || 'web_ui'],
    );

    res.status(201).json({ route: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Create ledger route error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
