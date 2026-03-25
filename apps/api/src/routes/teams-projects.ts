import { Router, Request, Response } from 'express';
import { query } from '../db/client.js';
import { logger } from '../logger.js';

const router = Router();

async function resolveCompanyId(companyIdFromBody: unknown): Promise<string | null> {
  if (typeof companyIdFromBody === 'string' && companyIdFromBody.trim().length > 0) {
    return companyIdFromBody;
  }
  const companiesResult = await query<{ id: string }>(
    `SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`,
  );
  return companiesResult.rows[0]?.id || null;
}

// ============================================
// TEAMS CRUD
// ============================================

/**
 * POST /api/teams — Create a new team
 */
router.post('/teams', async (req: Request, res: Response) => {
  try {
    const { company_id, name, slug, description, lead_user_id, color, icon } = req.body;
    const companyId = await resolveCompanyId(company_id);

    if (!companyId || !name || !slug) {
      res.status(400).json({ error: 'name and slug are required, and a company must exist' });
      return;
    }

    const result = await query(
      `INSERT INTO teams (company_id, name, slug, description, lead_user_id, color, icon)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [companyId, name, slug, description || null, lead_user_id || null, color || null, icon || null],
    );

    res.status(201).json({ team: result.rows[0] });
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'A team with this slug already exists in this company' });
      return;
    }
    logger.error({ err }, 'Create team error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/teams — List all teams with project/event counts
 */
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
       FROM teams t
       WHERE t.company_id = $1
       ORDER BY t.name ASC`,
      [companyId],
    );

    res.json({ teams: result.rows });
  } catch (err) {
    logger.error({ err }, 'List teams error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/teams/:id — Team detail with projects and stats
 */
router.get('/teams/:id', async (req: Request, res: Response) => {
  try {
    const [teamResult, projectsResult] = await Promise.all([
      query(`SELECT * FROM teams WHERE id = $1`, [req.params.id]),
      query(
        `SELECT id, name, slug, status, start_date, target_date, jira_project_keys, github_repos, slack_channel_ids
         FROM projects WHERE team_id = $1 ORDER BY name ASC`,
        [req.params.id],
      ),
    ]);

    if (!teamResult.rows[0]) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    res.json({
      team: teamResult.rows[0],
      projects: projectsResult.rows,
    });
  } catch (err) {
    logger.error({ err }, 'Team detail error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/teams/:id — Update team
 */
router.patch('/teams/:id', async (req: Request, res: Response) => {
  try {
    const { name, slug, description, lead_user_id, color, icon } = req.body;

    // Build SET clause dynamically from provided fields
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (name !== undefined) { setClauses.push(`name = $${idx++}`); params.push(name); }
    if (slug !== undefined) { setClauses.push(`slug = $${idx++}`); params.push(slug); }
    if (description !== undefined) { setClauses.push(`description = $${idx++}`); params.push(description); }
    if (lead_user_id !== undefined) { setClauses.push(`lead_user_id = $${idx++}`); params.push(lead_user_id); }
    if (color !== undefined) { setClauses.push(`color = $${idx++}`); params.push(color); }
    if (icon !== undefined) { setClauses.push(`icon = $${idx++}`); params.push(icon); }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await query(
      `UPDATE teams SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      params,
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    res.json({ team: result.rows[0] });
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'A team with this slug already exists in this company' });
      return;
    }
    logger.error({ err }, 'Update team error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/teams/:id — Delete (or archive) a team
 */
router.delete('/teams/:id', async (req: Request, res: Response) => {
  try {
    // Verify team belongs to current company (MVP: single-tenant)
    const companyResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companyResult.rows[0]?.id;
    if (!companyId) { res.status(404).json({ error: 'No company found' }); return; }

    const result = await query(
      `DELETE FROM teams WHERE id = $1 AND company_id = $2 RETURNING id`,
      [req.params.id, companyId],
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    logger.error({ err }, 'Delete team error');
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ============================================
// PROJECTS CRUD
// ============================================

/**
 * POST /api/projects — Create a new project
 */
router.post('/projects', async (req: Request, res: Response) => {
  try {
    const {
      company_id, team_id, name, slug, description,
      jira_project_keys, github_repos, slack_channel_ids,
      status, start_date, target_date,
    } = req.body;
    const companyId = await resolveCompanyId(company_id);

    if (!companyId || !name || !slug) {
      res.status(400).json({ error: 'name and slug are required, and a company must exist' });
      return;
    }

    const result = await query(
      `INSERT INTO projects (
        company_id, team_id, name, slug, description,
        jira_project_keys, github_repos, slack_channel_ids,
        status, start_date, target_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        companyId,
        team_id || null,
        name,
        slug,
        description || null,
        jira_project_keys || '{}',
        github_repos || '{}',
        slack_channel_ids || '{}',
        status || 'active',
        start_date || null,
        target_date || null,
      ],
    );

    res.status(201).json({ project: result.rows[0] });
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'A project with this slug already exists in this company' });
      return;
    }
    logger.error({ err }, 'Create project error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/projects — List projects (filterable by team_id)
 */
router.get('/projects', async (req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = req.query.company_id as string || companiesResult.rows[0]?.id;
    if (!companyId) { res.json({ projects: [] }); return; }

    let whereClause = 'WHERE p.company_id = $1';
    const params: unknown[] = [companyId];

    const teamId = req.query.team_id as string | undefined;
    if (teamId) {
      params.push(teamId);
      whereClause += ` AND p.team_id = $${params.length}`;
    }

    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) {
      params.push(statusFilter);
      whereClause += ` AND p.status = $${params.length}`;
    }

    const result = await query(
      `SELECT p.*,
        t.name AS team_name,
        t.color AS team_color,
        (SELECT COUNT(*) FROM events e WHERE e.project_id = p.id AND e.timestamp > NOW() - INTERVAL '7 days') AS event_count_7d,
        (SELECT COUNT(*) FROM leak_instances l WHERE l.project_id = p.id AND l.status = 'active') AS active_leak_count
       FROM projects p
       LEFT JOIN teams t ON p.team_id = t.id
       ${whereClause}
       ORDER BY p.name ASC`,
      params,
    );

    res.json({ projects: result.rows });
  } catch (err) {
    logger.error({ err }, 'List projects error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/projects/:id — Project detail with stats and connections
 */
router.get('/projects/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT p.*, t.name AS team_name, t.color AS team_color
       FROM projects p
       LEFT JOIN teams t ON p.team_id = t.id
       WHERE p.id = $1`,
      [req.params.id],
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Get recent activity counts
    const [eventCount, leakCount] = await Promise.all([
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM events WHERE project_id = $1 AND timestamp > NOW() - INTERVAL '7 days'`,
        [req.params.id],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM leak_instances WHERE project_id = $1 AND status = 'active'`,
        [req.params.id],
      ),
    ]);

    res.json({
      project: result.rows[0],
      stats: {
        events_7d: parseInt(eventCount.rows[0]?.count || '0', 10),
        active_leaks: parseInt(leakCount.rows[0]?.count || '0', 10),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Project detail error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/projects/:id/activity-graph — Cross-tool entity graph for a project
 * Returns nodes (events, leaks, entity_links) and edges for the project view
 */
router.get('/projects/:id/activity-graph', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));

    // Verify project exists
    const projectResult = await query<{ id: string; company_id: string }>(
      `SELECT id, company_id FROM projects WHERE id = $1`,
      [projectId],
    );
    if (!projectResult.rows[0]) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const companyId = projectResult.rows[0].company_id;

    // Fetch recent events for this project
    const [eventsResult, leaksResult, linksResult, metricsResult] = await Promise.all([
      query(
        `SELECT id, event_type, source, external_id, summary, timestamp, metadata
         FROM events
         WHERE project_id = $1 AND timestamp > NOW() - ($2::int * INTERVAL '1 day')
         ORDER BY timestamp DESC
         LIMIT 100`,
        [projectId, days],
      ),
      query(
        `SELECT id, leak_type, severity, status, detected_at, summary, metrics_context, jira_issue_key
         FROM leak_instances
         WHERE project_id = $1 AND detected_at > NOW() - ($2::int * INTERVAL '1 day')
         ORDER BY detected_at DESC
         LIMIT 50`,
        [projectId, days],
      ),
      query(
        `SELECT id, source_entity_type, source_entity_id, target_entity_type, target_entity_id,
                link_type, confidence, created_at
         FROM entity_links
         WHERE company_id = $1
           AND created_at > NOW() - ($3::int * INTERVAL '1 day')
           AND (
             source_entity_id IN (SELECT external_id FROM events WHERE project_id = $2 AND timestamp > NOW() - ($3::int * INTERVAL '1 day'))
             OR target_entity_id IN (SELECT external_id FROM events WHERE project_id = $2 AND timestamp > NOW() - ($3::int * INTERVAL '1 day'))
           )
         ORDER BY created_at DESC
         LIMIT 200`,
        [companyId, projectId, days],
      ),
      query(
        `SELECT metric_name, date, value
         FROM metric_snapshots
         WHERE company_id = $1 AND scope = 'project' AND scope_id = $2
           AND date > NOW() - ($3::int * INTERVAL '1 day')
         ORDER BY date DESC`,
        [companyId, projectId, days],
      ),
    ]);

    // Build nodes from events
    const nodes: Array<{
      id: string;
      type: 'event' | 'leak';
      source?: string;
      event_type?: string;
      leak_type?: string;
      severity?: string;
      summary: string;
      timestamp: string;
      external_id?: string;
    }> = [];

    for (const e of eventsResult.rows) {
      nodes.push({
        id: e.id,
        type: 'event',
        source: e.source,
        event_type: e.event_type,
        summary: e.summary || `${e.source}:${e.event_type}`,
        timestamp: e.timestamp,
        external_id: e.external_id,
      });
    }

    for (const l of leaksResult.rows) {
      nodes.push({
        id: l.id,
        type: 'leak',
        leak_type: l.leak_type,
        severity: l.severity,
        summary: l.summary || l.leak_type.replace(/_/g, ' '),
        timestamp: l.detected_at,
      });
    }

    // Build edges from entity_links
    const edges = linksResult.rows.map((l: any) => ({
      id: l.id,
      source: l.source_entity_id,
      target: l.target_entity_id,
      source_type: l.source_entity_type,
      target_type: l.target_entity_type,
      link_type: l.link_type,
      confidence: Number(l.confidence),
    }));

    // Health snapshot from metrics
    const healthMetrics: Record<string, number> = {};
    for (const m of metricsResult.rows) {
      if (!healthMetrics[m.metric_name]) {
        healthMetrics[m.metric_name] = Number(m.value);
      }
    }

    res.json({
      project_id: projectId,
      days,
      nodes,
      edges,
      health_metrics: healthMetrics,
      totals: {
        events: eventsResult.rows.length,
        leaks: leaksResult.rows.length,
        links: linksResult.rows.length,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Project activity-graph error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/projects/:id — Update project
 */
router.patch('/projects/:id', async (req: Request, res: Response) => {
  try {
    const {
      team_id, name, slug, description,
      jira_project_keys, github_repos, slack_channel_ids,
      status, start_date, target_date,
    } = req.body;

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (team_id !== undefined) { setClauses.push(`team_id = $${idx++}`); params.push(team_id); }
    if (name !== undefined) { setClauses.push(`name = $${idx++}`); params.push(name); }
    if (slug !== undefined) { setClauses.push(`slug = $${idx++}`); params.push(slug); }
    if (description !== undefined) { setClauses.push(`description = $${idx++}`); params.push(description); }
    if (jira_project_keys !== undefined) { setClauses.push(`jira_project_keys = $${idx++}`); params.push(jira_project_keys); }
    if (github_repos !== undefined) { setClauses.push(`github_repos = $${idx++}`); params.push(github_repos); }
    if (slack_channel_ids !== undefined) { setClauses.push(`slack_channel_ids = $${idx++}`); params.push(slack_channel_ids); }
    if (status !== undefined) { setClauses.push(`status = $${idx++}`); params.push(status); }
    if (start_date !== undefined) { setClauses.push(`start_date = $${idx++}`); params.push(start_date); }
    if (target_date !== undefined) { setClauses.push(`target_date = $${idx++}`); params.push(target_date); }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await query(
      `UPDATE projects SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      params,
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ project: result.rows[0] });
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'A project with this slug already exists in this company' });
      return;
    }
    logger.error({ err }, 'Update project error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/projects/:id — Delete (or archive) a project
 */
router.delete('/projects/:id', async (req: Request, res: Response) => {
  try {
    // Verify project belongs to current company (MVP: single-tenant)
    const companyResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companyResult.rows[0]?.id;
    if (!companyId) { res.status(404).json({ error: 'No company found' }); return; }

    const result = await query(
      `DELETE FROM projects WHERE id = $1 AND company_id = $2 RETURNING id`,
      [req.params.id, companyId],
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    logger.error({ err }, 'Delete project error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
