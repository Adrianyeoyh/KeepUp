import { Router, Request, Response } from 'express';
import { query } from '@flowguard/db';
import { logger } from '../logger.js';

/**
 * Teams and Projects CRUD routes.
 * Migrated from apps/api/src/routes/teams-projects.ts.
 * All business logic preserved.
 */
const router = Router();

async function resolveCompanyId(companyIdFromBody: unknown): Promise<string | null> {
  if (typeof companyIdFromBody === 'string' && companyIdFromBody.trim().length > 0) return companyIdFromBody;
  const result = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
  return result.rows[0]?.id || null;
}

// ---- TEAMS ----

router.post('/teams', async (req: Request, res: Response) => {
  try {
    const { company_id, name, slug, description, lead_user_id, color, icon } = req.body;
    const companyId = await resolveCompanyId(company_id);
    if (!companyId || !name || !slug) { res.status(400).json({ error: 'name and slug are required' }); return; }

    const result = await query(
      `INSERT INTO teams (company_id, name, slug, description, lead_user_id, color, icon) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [companyId, name, slug, description || null, lead_user_id || null, color || null, icon || null],
    );
    res.status(201).json({ team: result.rows[0] });
  } catch (err: any) {
    if (err?.code === '23505') { res.status(409).json({ error: 'Team slug already exists' }); return; }
    logger.error({ err }, 'Create team error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/teams', async (req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = req.query.company_id as string || companiesResult.rows[0]?.id;
    if (!companyId) { res.json({ teams: [] }); return; }

    const result = await query(
      `SELECT t.*,
        (SELECT COUNT(*) FROM projects p WHERE p.team_id = t.id AND p.status = 'active') AS project_count,
        (SELECT COUNT(*) FROM events e WHERE e.team_id = t.id AND e.timestamp > NOW() - INTERVAL '7 days') AS event_count_7d,
        (SELECT COUNT(*) FROM leak_instances l WHERE l.team_id = t.id AND l.status = 'active') AS active_leak_count
       FROM teams t WHERE t.company_id = $1 ORDER BY t.name ASC`,
      [companyId],
    );
    res.json({ teams: result.rows });
  } catch (err) {
    logger.error({ err }, 'List teams error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/teams/:id', async (req: Request, res: Response) => {
  try {
    const [teamResult, projectsResult] = await Promise.all([
      query(`SELECT * FROM teams WHERE id = $1`, [req.params.id]),
      query(`SELECT id, name, slug, status FROM projects WHERE team_id = $1 ORDER BY name ASC`, [req.params.id]),
    ]);
    if (!teamResult.rows[0]) { res.status(404).json({ error: 'Team not found' }); return; }
    res.json({ team: teamResult.rows[0], projects: projectsResult.rows });
  } catch (err) {
    logger.error({ err }, 'Team detail error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- PROJECTS ----

router.get('/projects', async (req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = req.query.company_id as string || companiesResult.rows[0]?.id;
    if (!companyId) { res.json({ projects: [] }); return; }

    const params: unknown[] = [companyId];
    let whereClause = 'WHERE p.company_id = $1';
    if (req.query.team_id) { params.push(req.query.team_id); whereClause += ` AND p.team_id = $${params.length}`; }

    const result = await query(
      `SELECT p.*, t.name AS team_name, t.color AS team_color
       FROM projects p LEFT JOIN teams t ON p.team_id = t.id ${whereClause} ORDER BY p.name ASC`,
      params,
    );
    res.json({ projects: result.rows });
  } catch (err) {
    logger.error({ err }, 'List projects error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
