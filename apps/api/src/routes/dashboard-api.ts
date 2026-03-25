import { Router, Request, Response } from 'express';
import { query } from '../db/client.js';
import { logger } from '../logger.js';
import { handleProjectsV2Sync } from '../services/github-projects-v2.js';
import { syncJiraProjectComponents } from '../services/jira-component-sync.js';
import { getTeamLeakRules, upsertTeamLeakRule, deleteTeamLeakRule, validateJql, evaluateCustomLeakRules } from '../services/jql-custom-leak-rules.js';
import { getConnectedGraph } from '../services/entity-resolver.js';

const router = Router();

interface InferredLinkRow {
  id: string;
  source_provider: 'slack' | 'jira' | 'github';
  source_entity_type: string | null;
  source_entity_id: string;
  target_provider: 'slack' | 'jira' | 'github';
  target_entity_type: string | null;
  target_entity_id: string;
  confidence: number;
  inference_reason: unknown;
  status: 'suggested' | 'confirmed' | 'dismissed' | 'expired';
  team_id: string | null;
  created_at: string;
}

function toConfidenceTier(
  confidence: number,
  status: InferredLinkRow['status'],
): 'explicit' | 'strong' | 'medium' | 'weak' {
  if (status === 'confirmed') return 'explicit';
  if (confidence >= 0.85) return 'strong';
  if (confidence >= 0.6) return 'medium';
  return 'weak';
}

// ============================================
// GET /api/dashboard/overview
// Aggregated stats for the dashboard home page
// ============================================
router.get('/dashboard/overview', async (req: Request, res: Response) => {
  try {
    // Get first company (MVP: single-tenant)
    const companiesResult = await query<{ id: string; name: string; settings: Record<string, unknown> }>(
      `SELECT id, name, settings FROM companies ORDER BY created_at ASC LIMIT 1`
    );
    const company = companiesResult.rows[0];
    if (!company) {
      res.json({ company: null, leaks: { total: 0, by_status: {} }, events: { total: 0 }, integrations: [] });
      return;
    }

    const companyId = company.id;

    // v2: Optional team/project scope filters
    const teamId = req.query.team_id as string | undefined;
    const projectId = req.query.project_id as string | undefined;

    // Build scope WHERE fragments for scoped queries
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

    // Parallel queries for dashboard data
    const [leakStats, eventStats, recentLeaks, integrations, commitStats, actionStats] = await Promise.all([
      // Leak counts by status
      query<{ status: string; count: string }>(
        `SELECT status, COUNT(*) as count FROM leak_instances WHERE company_id = $1${scopeFragment} GROUP BY status`,
        leakScopeParams,
      ),
      // Event counts by source (last 7 days)
      query<{ source: string; count: string }>(
        `SELECT source, COUNT(*) as count FROM events WHERE company_id = $1 AND timestamp > NOW() - INTERVAL '7 days'${scopeFragment} GROUP BY source`,
        eventScopeParams,
      ),
      // Recent leaks (last 5)
      query(
        `SELECT id, leak_type, severity, confidence, status, detected_at, cost_estimate_hours_per_week, evidence_links, metrics_context, recommended_fix, ai_diagnosis, team_id, project_id
         FROM leak_instances WHERE company_id = $1${scopeFragment}
         ORDER BY detected_at DESC LIMIT 5`,
        leakScopeParams,
      ),
      // Integration statuses (always org-wide)
      query(
        `SELECT id, provider, status, updated_at FROM integrations WHERE company_id = $1`,
        [companyId],
      ),
      // Ledger commit stats
      query<{ status: string; count: string }>(
        `SELECT status, COUNT(*) as count FROM ledger_commits WHERE company_id = $1${scopeFragment} GROUP BY status`,
        [companyId, ...scopeParams],
      ),
      // Proposed action stats
      query<{ approval_status: string; count: string }>(
        `SELECT approval_status, COUNT(*) as count FROM proposed_actions WHERE company_id = $1${scopeFragment.replace('project_id', 'team_id')} GROUP BY approval_status`,
        [companyId, ...(teamId ? [teamId] : [])],
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

    const commitsByStatus: Record<string, number> = {};
    for (const row of commitStats.rows) {
      commitsByStatus[row.status] = parseInt(row.count, 10);
    }

    const actionsByStatus: Record<string, number> = {};
    for (const row of actionStats.rows) {
      actionsByStatus[row.approval_status] = parseInt(row.count, 10);
    }

    res.json({
      company: { id: company.id, name: company.name, settings: company.settings },
      scope: { team_id: teamId || null, project_id: projectId || null },
      leaks: { total: totalLeaks, by_status: leaksByStatus },
      events: { total: totalEvents, by_source: eventsBySource },
      recent_leaks: recentLeaks.rows,
      integrations: integrations.rows,
      commits: { by_status: commitsByStatus },
      actions: { by_status: actionsByStatus },
    });
  } catch (err) {
    logger.error({ err }, 'Dashboard overview error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/leaks
// Paginated leak instances with filters
// ============================================
router.get('/leaks', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;
    const leakType = req.query.leak_type as string | undefined;

    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companiesResult.rows[0]?.id;
    if (!companyId) { res.json({ leaks: [], total: 0, page, limit }); return; }

    let whereClause = 'WHERE company_id = $1';
    const params: unknown[] = [companyId];

    if (status) {
      params.push(status);
      whereClause += ` AND status = $${params.length}`;
    }
    if (leakType) {
      params.push(leakType);
      whereClause += ` AND leak_type = $${params.length}`;
    }

    // v2: Optional team/project scope filters
    const teamId = req.query.team_id as string | undefined;
    const projectId = req.query.project_id as string | undefined;
    if (teamId) {
      params.push(teamId);
      whereClause += ` AND team_id = $${params.length}`;
    }
    if (projectId) {
      params.push(projectId);
      whereClause += ` AND project_id = $${params.length}`;
    }

    // v2: Optional date range filter
    const daysFilter = parseInt(req.query.days as string) || 0;
    if (daysFilter > 0) {
      const safeDays = Math.min(90, daysFilter);
      params.push(safeDays);
      whereClause += ` AND detected_at > NOW() - ($${params.length}::int * INTERVAL '1 day')`;
    }

    const [countResult, leaksResult] = await Promise.all([
      query<{ count: string }>(`SELECT COUNT(*) as count FROM leak_instances ${whereClause}`, params),
      query(
        `SELECT * FROM leak_instances ${whereClause} ORDER BY detected_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);

    res.json({
      leaks: leaksResult.rows,
      total: parseInt(countResult.rows[0]?.count || '0', 10),
      page,
      limit,
    });
  } catch (err) {
    logger.error({ err }, 'Leaks list error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/approvals
// Pending + recent ProposedActions
// ============================================
router.get('/approvals', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;

    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companiesResult.rows[0]?.id;
    if (!companyId) { res.json({ actions: [], total: 0, page, limit }); return; }

    let whereClause = 'WHERE pa.company_id = $1';
    const params: unknown[] = [companyId];

    if (status) {
      params.push(status);
      whereClause += ` AND pa.approval_status = $${params.length}`;
    }

    // v2: Optional team scope filter
    const teamId = req.query.team_id as string | undefined;
    if (teamId) {
      params.push(teamId);
      whereClause += ` AND pa.team_id = $${params.length}`;
    }

    const [countResult, actionsResult] = await Promise.all([
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM proposed_actions pa ${whereClause}`,
        params,
      ),
      query(
        `SELECT pa.*, li.leak_type, li.severity as leak_severity
         FROM proposed_actions pa
         LEFT JOIN leak_instances li ON pa.leak_instance_id = li.id
         ${whereClause}
         ORDER BY
           CASE pa.approval_status
             WHEN 'pending' THEN 0
             WHEN 'approved' THEN 1
             ELSE 2
           END,
           pa.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);

    res.json({
      actions: actionsResult.rows,
      total: parseInt(countResult.rows[0]?.count || '0', 10),
      page,
      limit,
    });
  } catch (err) {
    logger.error({ err }, 'Approvals list error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// POST /api/approvals/:id/action
// Approve or reject from web UI
// ============================================
router.post('/approvals/:id/action', async (req: Request, res: Response) => {
  try {
    const actionId = req.params.id;
    const { action, actor } = req.body as { action: 'approve' | 'reject'; actor?: string };

    if (!['approve', 'reject'].includes(action)) {
      res.status(400).json({ error: 'Action must be "approve" or "reject"' });
      return;
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const result = await query(
      `UPDATE proposed_actions
       SET approval_status = $1, approved_by = $2, approved_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND approval_status = 'pending'
       RETURNING *`,
      [newStatus, actor || 'web_ui', actionId],
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Action not found or already processed' });
      return;
    }

    res.json({ action: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Approval action error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/ledger/tree
// Full commit graph with edges for tree visualization
// ============================================
router.get('/ledger/tree', async (req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companiesResult.rows[0]?.id;
    if (!companyId) {
      res.json({
        commits: [],
        teams: [],
        leaks: [],
        entities: [],
        inferred_links: [],
        availableFilters: { branches: [], jira_keys: [], github_prs: [], slack_channels: [], tags: [] },
      });
      return;
    }

    const commitLimitInput = Number.parseInt(req.query.commit_limit as string, 10);
    const leakLimitInput = Number.parseInt(req.query.leak_limit as string, 10);
    const commitLimit = Number.isFinite(commitLimitInput)
      ? Math.min(1200, Math.max(50, commitLimitInput))
      : 500;
    const leakLimit = Number.isFinite(leakLimitInput)
      ? Math.min(600, Math.max(20, leakLimitInput))
      : 220;

    let whereClause = 'WHERE lc.company_id = $1';
    const params: unknown[] = [companyId];

    const status = req.query.status as string | undefined;
    const commitType = req.query.commit_type as string | undefined;
    const teamId = req.query.team_id as string | undefined;
    const dateFrom = req.query.from as string | undefined;
    const dateTo = req.query.to as string | undefined;
    const branch = req.query.branch as string | undefined;
    const jiraKey = req.query.jira_key as string | undefined;
    const githubPr = req.query.pr as string | undefined;
    const slackChannel = req.query.slack_channel as string | undefined;
    const tagsParam = (req.query.tags as string | undefined) || (req.query.tag as string | undefined) || '';
    const tagFilters = tagsParam
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .slice(0, 20);

    if (status) {
      params.push(status);
      whereClause += ` AND lc.status = $${params.length}`;
    }
    if (commitType) {
      params.push(commitType);
      whereClause += ` AND lc.commit_type = $${params.length}`;
    }
    if (teamId) {
      params.push(teamId);
      whereClause += ` AND lc.team_id = $${params.length}`;
    }
    const projectId = req.query.project_id as string | undefined;
    if (projectId) {
      params.push(projectId);
      whereClause += ` AND lc.project_id = $${params.length}`;
    }
    if (dateFrom) {
      params.push(dateFrom);
      whereClause += ` AND lc.created_at >= $${params.length}::date`;
    }
    if (dateTo) {
      params.push(dateTo);
      whereClause += ` AND lc.created_at < ($${params.length}::date + INTERVAL '1 day')`;
    }
    if (branch) {
      params.push(branch);
      whereClause += ` AND lc.branch_name = $${params.length}`;
    }
    if (jiraKey) {
      params.push(JSON.stringify([{ provider: 'jira', entity_id: jiraKey }]));
      whereClause += ` AND lc.evidence_links @> $${params.length}::jsonb`;
    }
    if (githubPr) {
      params.push(JSON.stringify([{ provider: 'github', entity_id: githubPr }]));
      whereClause += ` AND lc.evidence_links @> $${params.length}::jsonb`;
    }
    if (slackChannel) {
      params.push(slackChannel);
      whereClause += ` AND EXISTS (
        SELECT 1
        FROM ledger_edges le
        JOIN events e ON e.id = le.target_id
        WHERE le.commit_id = lc.id
          AND le.target_type = 'event'
          AND e.metadata->>'channel_id' = $${params.length}
      )`;
    }
    if (tagFilters.length > 0) {
      params.push(tagFilters);
      whereClause += ` AND lc.tags && $${params.length}::text[]`;
    }

    let leakWhereClause = `WHERE company_id = $1 AND status IN ('detected', 'delivered', 'actioned')`;
    const leakParams: unknown[] = [companyId];

    if (teamId) {
      leakParams.push(teamId);
      leakWhereClause += ` AND team_id = $${leakParams.length}`;
    }
    if (projectId) {
      leakParams.push(projectId);
      leakWhereClause += ` AND project_id = $${leakParams.length}`;
    }
    if (dateFrom) {
      leakParams.push(dateFrom);
      leakWhereClause += ` AND detected_at >= $${leakParams.length}::date`;
    }
    if (dateTo) {
      leakParams.push(dateTo);
      leakWhereClause += ` AND detected_at < ($${leakParams.length}::date + INTERVAL '1 day')`;
    }

    const [commitsResult, teamsResult, leaksResult] = await Promise.all([
      query(
        `SELECT lc.*,
          COALESCE(
            (SELECT json_agg(json_build_object(
              'id', le.id,
              'edge_type', le.edge_type,
              'target_type', le.target_type,
              'target_id', le.target_id,
              'metadata', le.metadata,
              'target_data', CASE le.target_type
                WHEN 'leak_instance' THEN (SELECT row_to_json(l) FROM leak_instances l WHERE l.id = le.target_id)
                WHEN 'event' THEN (SELECT row_to_json(e) FROM events e WHERE e.id = le.target_id)
                WHEN 'proposed_action' THEN (SELECT row_to_json(pa) FROM proposed_actions pa WHERE pa.id = le.target_id)
                WHEN 'ledger_commit' THEN (SELECT row_to_json(lcc) FROM ledger_commits lcc WHERE lcc.id = le.target_id)
              END
            ) ORDER BY le.edge_type, le.created_at)
            FROM ledger_edges le WHERE le.commit_id = lc.id
          ), '[]'::json
        ) AS edges
        FROM ledger_commits lc
        ${whereClause}
        ORDER BY lc.created_at DESC
        LIMIT $${params.length + 1}`,
        [...params, commitLimit],
      ),
      query(
        `SELECT id, name, slug, color, icon FROM teams WHERE company_id = $1 ORDER BY name`,
        [companyId],
      ),
      query(
        `SELECT id, leak_type AS rule_key, leak_type AS title, severity, team_id, detected_at AS created_at, status
         FROM leak_instances
         ${leakWhereClause}
         ORDER BY detected_at DESC
         LIMIT $${leakParams.length + 1}`,
        [...leakParams, leakLimit],
      ),
    ]);

    const extractSlackChannelFromUrl = (url: string): string | null => {
      const match = /\/archives\/([A-Za-z0-9_-]+)/.exec(url);
      return match?.[1]?.toUpperCase() ?? null;
    };

    const commitsWithLinkedEntities = commitsResult.rows.map((commitRow) => {
      const evidenceLinks = Array.isArray(commitRow.evidence_links) ? commitRow.evidence_links : [];
      const linkedEntities = evidenceLinks
        .map((rawLink: unknown) => {
          if (!rawLink || typeof rawLink !== 'object') return null;

          const link = rawLink as Record<string, unknown>;
          const provider = typeof link.provider === 'string' ? link.provider : null;
          const entityType = typeof link.entity_type === 'string' ? link.entity_type : null;
          const entityId = typeof link.entity_id === 'string' ? link.entity_id : null;
          const url = typeof link.url === 'string' ? link.url : null;
          const title = typeof link.title === 'string' ? link.title : null;

          if (!provider || !entityId) return null;

          return {
            provider,
            entity_type: entityType,
            entity_id: entityId,
            url,
            title,
          };
        })
        .filter(
          (
            entity: { provider: string; entity_type: string | null; entity_id: string; url: string | null; title: string | null } | null,
          ): entity is { provider: string; entity_type: string | null; entity_id: string; url: string | null; title: string | null } => Boolean(entity),
        );

      const dedupe = new Map<string, { provider: string; entity_type: string | null; entity_id: string; url: string | null; title: string | null }>();
      for (const entity of linkedEntities) {
        const key = `${entity.provider}:${entity.entity_type ?? ''}:${entity.entity_id}`;
        if (!dedupe.has(key)) {
          dedupe.set(key, entity);
        }
      }

      return {
        ...commitRow,
        linked_entities: Array.from(dedupe.values()),
      };
    });

    const availableBranches = new Set<string>();
    const availableJiraKeys = new Set<string>();
    const availableGithubPrs = new Set<string>();
    const availableSlackChannels = new Set<string>();
    const availableTags = new Set<string>();
    const linkedEntityMap = new Map<string, {
      provider: string;
      entity_type: string | null;
      entity_id: string;
      url: string | null;
      title: string | null;
      commit_ids: Set<string>;
      team_ids: Set<string>;
    }>();

    for (const commit of commitsWithLinkedEntities) {
      if (typeof commit.branch_name === 'string' && commit.branch_name.trim().length > 0) {
        availableBranches.add(commit.branch_name.trim());
      }

      if (Array.isArray(commit.tags)) {
        for (const rawTag of commit.tags as unknown[]) {
          if (typeof rawTag !== 'string') continue;
          const normalizedTag = rawTag.trim();
          if (normalizedTag.length > 0) {
            availableTags.add(normalizedTag);
          }
        }
      }

      for (const entity of commit.linked_entities) {
        if (entity.provider === 'jira') {
          availableJiraKeys.add(entity.entity_id);
        }
        if (entity.provider === 'github') {
          availableGithubPrs.add(entity.entity_id);
        }
        if (entity.provider === 'slack') {
          const channelFromUrl = entity.url ? extractSlackChannelFromUrl(entity.url) : null;
          if (channelFromUrl) availableSlackChannels.add(channelFromUrl);
        }

        const key = `${entity.provider}:${entity.entity_type ?? ''}:${entity.entity_id}`;
        const existing = linkedEntityMap.get(key);
        if (!existing) {
          linkedEntityMap.set(key, {
            provider: entity.provider,
            entity_type: entity.entity_type,
            entity_id: entity.entity_id,
            url: entity.url,
            title: entity.title,
            commit_ids: new Set([commit.id]),
            team_ids: new Set(typeof commit.team_id === 'string' ? [commit.team_id] : []),
          });
        } else {
          existing.commit_ids.add(commit.id);
          if (typeof commit.team_id === 'string' && commit.team_id.length > 0) {
            existing.team_ids.add(commit.team_id);
          }
          if (!existing.url && entity.url) existing.url = entity.url;
          if (!existing.title && entity.title) existing.title = entity.title;
        }
      }

      const edges = Array.isArray(commit.edges) ? commit.edges : [];
      for (const rawEdge of edges) {
        if (!rawEdge || typeof rawEdge !== 'object') continue;
        const edge = rawEdge as Record<string, unknown>;
        if (edge.target_type !== 'event') continue;

        const targetData = edge.target_data;
        if (!targetData || typeof targetData !== 'object') continue;
        const metadata = (targetData as { metadata?: Record<string, unknown> }).metadata;
        const channelId = typeof metadata?.channel_id === 'string' ? metadata.channel_id : null;
        if (channelId) {
          availableSlackChannels.add(channelId);
        }
      }
    }

    const entities = Array.from(linkedEntityMap.values())
      .map((entity) => ({
        provider: entity.provider,
        entity_type: entity.entity_type,
        entity_id: entity.entity_id,
        url: entity.url,
        title: entity.title,
        commit_ids: Array.from(entity.commit_ids),
        team_ids: Array.from(entity.team_ids),
      }))
      .sort((a, b) => {
        const countDelta = b.commit_ids.length - a.commit_ids.length;
        if (countDelta !== 0) return countDelta;
        return `${a.provider}:${a.entity_id}`.localeCompare(`${b.provider}:${b.entity_id}`);
      });

    let inferredLinks: Array<{
      id: string;
      source_provider: 'slack' | 'jira' | 'github';
      source_entity_type: string | null;
      source_entity_id: string;
      target_provider: 'slack' | 'jira' | 'github';
      target_entity_type: string | null;
      target_entity_id: string;
      confidence: number;
      confidence_tier: 'explicit' | 'strong' | 'medium' | 'weak';
      inference_reason: unknown;
      status: 'suggested' | 'confirmed' | 'dismissed' | 'expired';
      team_id: string | null;
      created_at: string;
    }> = [];

    try {
      const inferredWhereParts = [
        `company_id = $1`,
        `status IN ('suggested', 'confirmed')`,
      ];
      const inferredParams: unknown[] = [companyId];

      if (teamId) {
        inferredParams.push(teamId);
        inferredWhereParts.push(`(team_id = $${inferredParams.length} OR team_id IS NULL)`);
      }

      const inferredLinksResult = await query<InferredLinkRow>(
        `SELECT
          id,
          source_provider,
          source_entity_type,
          source_entity_id,
          target_provider,
          target_entity_type,
          target_entity_id,
          confidence,
          inference_reason,
          status,
          team_id,
          created_at
         FROM inferred_links
         WHERE ${inferredWhereParts.join(' AND ')}
         ORDER BY confidence DESC, created_at DESC
         LIMIT 600`,
        inferredParams,
      );

      inferredLinks = inferredLinksResult.rows.map((row) => ({
        ...row,
        confidence: Number(row.confidence),
        confidence_tier: toConfidenceTier(Number(row.confidence), row.status),
      }));
    } catch (err: unknown) {
      const code = typeof err === 'object' && err && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
      if (code !== '42P01') {
        throw err;
      }
      logger.warn('inferred_links table not found yet; returning empty inferred links');
    }

    res.json({
      commits: commitsWithLinkedEntities,
      teams: teamsResult.rows,
      leaks: leaksResult.rows,
      entities,
      inferred_links: inferredLinks,
      availableFilters: {
        branches: Array.from(availableBranches).sort((a, b) => a.localeCompare(b)),
        jira_keys: Array.from(availableJiraKeys).sort((a, b) => a.localeCompare(b)),
        github_prs: Array.from(availableGithubPrs).sort((a, b) => a.localeCompare(b)),
        slack_channels: Array.from(availableSlackChannels).sort((a, b) => a.localeCompare(b)),
        tags: Array.from(availableTags).sort((a, b) => a.localeCompare(b)),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Ledger tree error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/ledger
// Paginated ledger commits
// ============================================
router.get('/ledger', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;
    const commitType = req.query.commit_type as string | undefined;

    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companiesResult.rows[0]?.id;
    if (!companyId) { res.json({ commits: [], total: 0, page, limit }); return; }

    let whereClause = 'WHERE company_id = $1';
    const params: unknown[] = [companyId];

    if (status) {
      params.push(status);
      whereClause += ` AND status = $${params.length}`;
    }
    if (commitType) {
      params.push(commitType);
      whereClause += ` AND commit_type = $${params.length}`;
    }

    // v2: Optional team/project scope filters
    const teamId = req.query.team_id as string | undefined;
    const projectId = req.query.project_id as string | undefined;
    if (teamId) {
      params.push(teamId);
      whereClause += ` AND team_id = $${params.length}`;
    }
    if (projectId) {
      params.push(projectId);
      whereClause += ` AND project_id = $${params.length}`;
    }

    const [countResult, commitsResult] = await Promise.all([
      query<{ count: string }>(`SELECT COUNT(*) as count FROM ledger_commits ${whereClause}`, params),
      query(
        `SELECT * FROM ledger_commits ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);

    res.json({
      commits: commitsResult.rows,
      total: parseInt(countResult.rows[0]?.count || '0', 10),
      page,
      limit,
    });
  } catch (err) {
    logger.error({ err }, 'Ledger list error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/ledger/:id
// Single commit with full details
// ============================================
router.get('/ledger/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM ledger_commits WHERE id = $1`,
      [req.params.id],
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Commit not found' });
      return;
    }

    res.json({ commit: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Ledger detail error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// POST /api/ledger/:id/promote
// Promote a team-scoped decision to org-level policy
// Creates a new org-level commit linked via promoted_from
// ============================================
router.post('/ledger/:id/promote', async (req: Request, res: Response) => {
  try {
    const sourceId = req.params.id;

    // Fetch the source commit
    const sourceResult = await query(
      `SELECT * FROM ledger_commits WHERE id = $1`,
      [sourceId],
    );
    if (!sourceResult.rows[0]) {
      res.status(404).json({ error: 'Source commit not found' });
      return;
    }

    const source = sourceResult.rows[0];

    if (source.scope_level === 'org') {
      res.status(400).json({ error: 'Commit is already org-level' });
      return;
    }

    if (source.status !== 'merged' && source.status !== 'approved') {
      res.status(400).json({ error: 'Only merged or approved commits can be promoted' });
      return;
    }

    const { title, rationale } = req.body;
    const promotedTitle = title || `[Org Policy] ${source.title}`;
    const promotedRationale = rationale || `Promoted from team decision: ${source.title}`;

    // Create org-level commit linked via promoted_from
    const result = await query(
      `INSERT INTO ledger_commits (
        company_id, commit_type, title, summary, rationale, dri,
        status, branch_name, parent_commit_id, evidence_links, tags,
        leak_instance_id, created_by, scope_level, promoted_from
      ) VALUES (
        $1, 'policy', $2, $3, $4, $5,
        'proposed', 'main', $6, $7, $8,
        $9, $10, 'org', $11
      ) RETURNING *`,
      [
        source.company_id,
        promotedTitle,
        source.summary,
        promotedRationale,
        source.dri,
        source.id,
        JSON.stringify(source.evidence_links || []),
        source.tags || [],
        source.leak_instance_id,
        source.created_by,
        sourceId,
      ],
    );

    res.status(201).json({ commit: result.rows[0], promoted_from: sourceId });
  } catch (err) {
    logger.error({ err }, 'Ledger promote error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/settings
// Company settings
// ============================================
router.get('/settings', async (_req: Request, res: Response) => {
  try {
    const companiesResult = await query(
      `SELECT id, name, slug, settings FROM companies ORDER BY created_at ASC LIMIT 1`
    );
    const company = companiesResult.rows[0];
    if (!company) {
      res.json({ company: null, integrations: [] });
      return;
    }

    const integrations = await query(
      `SELECT id, provider, status, installation_data, scopes, updated_at, created_at FROM integrations WHERE company_id = $1`,
      [company.id],
    );

    res.json({
      company,
      integrations: integrations.rows,
    });
  } catch (err) {
    logger.error({ err }, 'Settings error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// PATCH /api/settings
// Update company settings
// ============================================
router.patch('/settings', async (req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string; settings: Record<string, unknown> }>(
      `SELECT id, settings FROM companies ORDER BY created_at ASC LIMIT 1`
    );
    const company = companiesResult.rows[0];
    if (!company) {
      res.status(404).json({ error: 'No company found' });
      return;
    }

    const merged = { ...(company.settings || {}), ...req.body };
    const updated = await query(
      `UPDATE companies SET settings = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [JSON.stringify(merged), company.id],
    );

    res.json({ company: updated.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Settings update error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/settings/ai-budget
// AI budget & feature toggle settings
// ============================================
router.get('/settings/ai-budget', async (_req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string; settings: Record<string, unknown> }>(
      `SELECT id, settings FROM companies ORDER BY created_at ASC LIMIT 1`
    );
    const company = companiesResult.rows[0];
    if (!company) {
      res.status(404).json({ error: 'No company found' });
      return;
    }
    const s = company.settings || {};
    res.json({
      ai_budget_per_day: s.ai_budget_per_day ?? 20,
      ai_enabled_features: s.ai_enabled_features ?? [],
      digest_roles: s.digest_roles ?? {},
    });
  } catch (err) {
    logger.error({ err }, 'AI budget settings read error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// PATCH /api/settings/ai-budget
// Update AI budget & feature toggles
// ============================================
router.patch('/settings/ai-budget', async (req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string; settings: Record<string, unknown> }>(
      `SELECT id, settings FROM companies ORDER BY created_at ASC LIMIT 1`
    );
    const company = companiesResult.rows[0];
    if (!company) {
      res.status(404).json({ error: 'No company found' });
      return;
    }

    const allowedKeys = ['ai_budget_per_day', 'ai_enabled_features', 'digest_roles'];
    const patch: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }

    const merged = { ...(company.settings || {}), ...patch };
    const updated = await query(
      `UPDATE companies SET settings = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [JSON.stringify(merged), company.id],
    );

    res.json({ company: updated.rows[0] });
  } catch (err) {
    logger.error({ err }, 'AI budget settings update error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// POST /api/feedback
// Record a feedback signal (approve/reject rationale, dismissal, scope correction)
// ============================================
router.post('/feedback', async (req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string }>(
      `SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`
    );
    const company = companiesResult.rows[0];
    if (!company) {
      res.status(404).json({ error: 'No company found' });
      return;
    }

    const { feedback_type, entity_id, entity_type, actor_id, reason, team_id, metadata } = req.body;
    if (!feedback_type || !entity_id || !entity_type) {
      res.status(400).json({ error: 'Missing required fields: feedback_type, entity_id, entity_type' });
      return;
    }

    const allowedFeedbackTypes = ['approval_rationale', 'rejection_rationale', 'leak_dismissal', 'scope_correction'];
    if (!allowedFeedbackTypes.includes(feedback_type)) {
      res.status(400).json({ error: `Invalid feedback_type. Allowed: ${allowedFeedbackTypes.join(', ')}` });
      return;
    }

    const allowedEntityTypes = ['leak', 'proposed_action', 'ledger_commit', 'event', 'entity_link'];
    if (!allowedEntityTypes.includes(entity_type)) {
      res.status(400).json({ error: `Invalid entity_type. Allowed: ${allowedEntityTypes.join(', ')}` });
      return;
    }

    await query(
      `INSERT INTO events (
        company_id, source, entity_id, event_type, timestamp, metadata, provider_event_id, team_id
      ) VALUES ($1, 'feedback', $2, $3, NOW(), $4, $5, $6)
      ON CONFLICT (provider_event_id, source, company_id) DO NOTHING`,
      [
        company.id,
        entity_id,
        `feedback.${feedback_type}`,
        JSON.stringify({
          entity_type,
          actor_id: actor_id || null,
          reason: reason || null,
          team_id: team_id || null,
          ...metadata,
        }),
        `fb:${company.id}:${entity_type}:${entity_id}:${feedback_type}:${Date.now()}`,
        team_id || null,
      ],
    );

    // If it's a leak dismissal, also update the leak status
    if (feedback_type === 'leak_dismissal') {
      await query(
        `UPDATE leak_instances SET status = 'dismissed', updated_at = NOW() WHERE id = $1 AND company_id = $2`,
        [entity_id, company.id],
      );
    }

    // If it's a scope correction, update the entity_link confidence
    if (feedback_type === 'scope_correction' && metadata?.correct_scope) {
      await query(
        `UPDATE entity_links SET confidence = 0.1, updated_at = NOW()
         WHERE id = $1 AND company_id = $2`,
        [entity_id, company.id],
      );
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Feedback recording error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/health/detailed
// Detailed health with queue stats
// ============================================
router.get('/health/detailed', async (_req: Request, res: Response) => {
  try {
    let dbStatus = 'ok';
    try {
      await query('SELECT 1');
    } catch {
      dbStatus = 'error';
    }

    const [companyCount, eventCount, leakCount] = await Promise.all([
      query<{ count: string }>('SELECT COUNT(*) as count FROM companies'),
      query<{ count: string }>('SELECT COUNT(*) as count FROM events'),
      query<{ count: string }>('SELECT COUNT(*) as count FROM leak_instances'),
    ]);

    res.json({
      status: dbStatus === 'ok' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      database: dbStatus,
      counts: {
        companies: parseInt(companyCount.rows[0]?.count || '0', 10),
        events: parseInt(eventCount.rows[0]?.count || '0', 10),
        leaks: parseInt(leakCount.rows[0]?.count || '0', 10),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Health detailed error');
    res.status(500).json({ status: 'error', error: 'Internal server error' });
  }
});

// ============================================
// GET /api/metrics
// Recent metric snapshots for charts
// ============================================
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 14));
    const metricName = req.query.metric_name as string | undefined;

    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companiesResult.rows[0]?.id;
    if (!companyId) { res.json({ metrics: [] }); return; }

    let whereClause = 'WHERE company_id = $1 AND date > NOW() - $2::interval';
    const params: unknown[] = [companyId, `${days} days`];

    if (metricName) {
      params.push(metricName);
      whereClause += ` AND metric_name = $${params.length}`;
    }

    const result = await query(
      `SELECT * FROM metric_snapshots ${whereClause} ORDER BY date DESC, metric_name`,
      params,
    );

    res.json({ metrics: result.rows });
  } catch (err) {
    logger.error({ err }, 'Metrics list error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/overview  (summary view)
// ============================================
router.get('/overview', async (_req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string; name: string; settings: Record<string, unknown> }>(
      `SELECT id, name, settings FROM companies ORDER BY created_at ASC LIMIT 1`
    );
    const company = companiesResult.rows[0];
    if (!company) {
      res.json({ company: null, leaks: { total: 0 }, events: { total: 0 }, integrations: [] });
      return;
    }
    const companyId = company.id;

    const [leakStats, eventStats, integrations] = await Promise.all([
      query<{ count: string }>(`SELECT COUNT(*) as count FROM leak_instances WHERE company_id = $1`, [companyId]),
      query<{ count: string }>(`SELECT COUNT(*) as count FROM events WHERE company_id = $1 AND timestamp > NOW() - INTERVAL '7 days'`, [companyId]),
      query(`SELECT id, provider, status FROM integrations WHERE company_id = $1`, [companyId]),
    ]);

    res.json({
      company: { id: company.id, name: company.name },
      leaks: { total: parseInt(leakStats.rows[0]?.count || '0', 10) },
      events: { total: parseInt(eventStats.rows[0]?.count || '0', 10) },
      integrations: integrations.rows,
    });
  } catch (err) {
    logger.error({ err }, 'Overview error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/events
// Paginated event feed
// ============================================
router.get('/events', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const source = req.query.source as string | undefined;

    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companiesResult.rows[0]?.id;
    if (!companyId) { res.json({ events: [], total: 0, page, limit }); return; }

    let whereClause = 'WHERE company_id = $1';
    const params: unknown[] = [companyId];

    if (source) {
      params.push(source);
      whereClause += ` AND source = $${params.length}`;
    }

    const [countResult, eventsResult] = await Promise.all([
      query<{ count: string }>(`SELECT COUNT(*) as count FROM events ${whereClause}`, params),
      query(
        `SELECT id, source, entity_id, event_type, timestamp, metadata
         FROM events ${whereClause}
         ORDER BY timestamp DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);

    res.json({
      events: eventsResult.rows,
      total: parseInt(countResult.rows[0]?.count || '0', 10),
      page,
      limit,
    });
  } catch (err) {
    logger.error({ err }, 'Events list error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/executions
// Executed action history with rollback info
// ============================================
router.get('/executions', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companiesResult.rows[0]?.id;
    if (!companyId) { res.json({ executions: [], total: 0 }); return; }

    const [countResult, executionsResult] = await Promise.all([
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM executed_actions WHERE company_id = $1`,
        [companyId],
      ),
      query(
        `SELECT ea.*, pa.action_type, pa.target_system, pa.target_id, pa.risk_level
         FROM executed_actions ea
         LEFT JOIN proposed_actions pa ON ea.proposed_action_id = pa.id
         WHERE ea.company_id = $1
         ORDER BY ea.executed_at DESC
         LIMIT $2`,
        [companyId, limit],
      ),
    ]);

    res.json({
      executions: executionsResult.rows,
      total: parseInt(countResult.rows[0]?.count || '0', 10),
    });
  } catch (err) {
    logger.error({ err }, 'Executions list error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// POST /api/executions/:id/rollback
// Rollback an executed action
// ============================================
router.post('/executions/:id/rollback', async (req: Request, res: Response) => {
  try {
    const { rollbackExecutedAction } = await import('../services/executor.js');
    const actor = typeof req.body?.actor === 'string' ? req.body.actor : 'web_ui';
    const executedId = String(req.params.id);
    const result = await rollbackExecutedAction(executedId, actor);
    if (result.success) {
      res.json({ status: 'rolled_back' });
    } else {
      res.status(400).json({ error: result.reason });
    }
  } catch (err) {
    logger.error({ err }, 'Rollback error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/integrations
// List active integrations
// ============================================
router.get('/integrations', async (_req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companiesResult.rows[0]?.id;
    if (!companyId) { res.json({ integrations: [] }); return; }

    const result = await query(
      `SELECT id, provider, status, installation_data, scopes, updated_at, created_at
       FROM integrations WHERE company_id = $1 ORDER BY provider`,
      [companyId],
    );

    res.json({ integrations: result.rows });
  } catch (err) {
    logger.error({ err }, 'Integrations list error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/compare/metrics
// Multi-team metric comparison overlay
// ============================================
router.get('/compare/metrics', async (req: Request, res: Response) => {
  try {
    let teamIds = (req.query.team_ids as string || '').split(',').filter(Boolean);
    const metricName = req.query.metric_name as string;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 14));

    if (!metricName) {
      res.status(400).json({ error: 'metric_name is required' });
      return;
    }

    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companiesResult.rows[0]?.id;
    if (!companyId) { res.json({ series: [], org_baseline: [] }); return; }

    // If no team_ids provided, auto-fetch all teams
    if (teamIds.length === 0) {
      const allTeams = await query<{ id: string }>(`SELECT id FROM teams WHERE company_id = $1 ORDER BY name`, [companyId]);
      teamIds = allTeams.rows.map((t) => t.id);
    }

    const teams: Array<{
      team_id: string;
      team_name: string;
      team_color: string | null;
      series: Array<{ date: string; value: number }>;
    }> = [];

    for (const teamId of teamIds) {
      // Get team info
      const teamResult = await query<{ name: string; color: string | null }>(
        `SELECT name, color FROM teams WHERE id = $1`,
        [teamId],
      );

      if (!teamResult.rows[0]) continue;

      // Get metric series for this team
      const seriesResult = await query<{ snapshot_date: string; metric_value: number }>(
        `SELECT date as snapshot_date, AVG(value) as metric_value
         FROM metric_snapshots
         WHERE company_id = $1 AND metric_name = $2
           AND scope = 'team' AND scope_id = $3
           AND date > NOW() - ($4::int * INTERVAL '1 day')
         GROUP BY date
         ORDER BY snapshot_date ASC`,
        [companyId, metricName, teamId, days],
      );

      teams.push({
        team_id: teamId,
        team_name: teamResult.rows[0].name,
        team_color: teamResult.rows[0].color,
        series: seriesResult.rows.map((r) => ({
          date: r.snapshot_date,
          value: Number(r.metric_value),
        })),
      });
    }

    // Also get org-level baseline
    const baselineResult = await query<{ snapshot_date: string; metric_value: number }>(
      `SELECT date as snapshot_date, AVG(value) as metric_value
       FROM metric_snapshots
       WHERE company_id = $1 AND metric_name = $2
         AND scope = 'company'
         AND date > NOW() - ($3::int * INTERVAL '1 day')
       GROUP BY date
       ORDER BY snapshot_date ASC`,
      [companyId, metricName, days],
    );

    res.json({
      metric_name: metricName,
      days,
      series: teams,
      org_baseline: baselineResult.rows.map((r) => ({
        date: r.snapshot_date,
        value: Number(r.metric_value),
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Compare metrics error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/entity-links
// Connected graph: entity links for cross-tool tracing
// ============================================
router.get('/entity-links', async (req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companiesResult.rows[0]?.id;
    if (!companyId) { res.json({ links: [] }); return; }

    let whereClause = 'WHERE company_id = $1';
    const params: unknown[] = [companyId];

    const entityId = req.query.entity_id as string | undefined;
    if (entityId) {
      params.push(entityId);
      whereClause += ` AND (source_entity_id = $${params.length} OR target_entity_id = $${params.length})`;
    }

    const provider = req.query.provider as string | undefined;
    if (provider) {
      params.push(provider);
      whereClause += ` AND (source_provider = $${params.length} OR target_provider = $${params.length})`;
    }

    const linkType = req.query.link_type as string | undefined;
    if (linkType) {
      params.push(linkType);
      whereClause += ` AND link_type = $${params.length}`;
    }

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));

    const result = await query(
      `SELECT * FROM entity_links ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1}`,
      [...params, limit],
    );

    res.json({ links: result.rows });
  } catch (err) {
    logger.error({ err }, 'Entity links error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/ledger/:id/edges
// Ledger commit graph edges (connected entities)
// ============================================
router.get('/ledger/:id/edges', async (req: Request, res: Response) => {
  try {
    const commitId = req.params.id;

    // Get edges with resolved target data
    const edgesResult = await query(
      `SELECT le.*,
        CASE le.target_type
          WHEN 'leak_instance' THEN (SELECT row_to_json(l) FROM leak_instances l WHERE l.id::text = le.target_id)
          WHEN 'event' THEN (SELECT row_to_json(e) FROM events e WHERE e.id::text = le.target_id)
          WHEN 'proposed_action' THEN (SELECT row_to_json(pa) FROM proposed_actions pa WHERE pa.id::text = le.target_id)
          WHEN 'ledger_commit' THEN (SELECT row_to_json(lc) FROM ledger_commits lc WHERE lc.id::text = le.target_id)
        END AS target_data
       FROM ledger_edges le
       WHERE le.commit_id = $1
       ORDER BY le.edge_type, le.created_at`,
      [commitId],
    );

    res.json({ edges: edgesResult.rows });
  } catch (err) {
    logger.error({ err }, 'Ledger edges error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/ledger/:id/graph
// BFS-connected graph from a ledger commit — resolved targets
// ============================================
router.get('/ledger/:id/graph', async (req: Request<{ id: string }, unknown, unknown, { depth?: string }>, res: Response) => {
  try {
    const commitId = req.params.id;
    const maxDepth = Math.min(10, parseInt(req.query.depth as string) || 5);

    // Verify commit exists and get company
    const commitResult = await query<{ company_id: string }>(
      `SELECT company_id FROM ledger_commits WHERE id = $1`,
      [commitId],
    );
    if (!commitResult.rows[0]) {
      res.status(404).json({ error: 'Ledger commit not found' });
      return;
    }

    const graph = await getConnectedGraph(commitResult.rows[0].company_id, commitId, maxDepth);
    res.json(graph);
  } catch (err) {
    logger.error({ err }, 'Ledger graph error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/leaks/:id/context
// Full enriched context for a leak — related events, commits, entity links, metrics
// ============================================
router.get('/leaks/:id/context', async (req: Request, res: Response) => {
  try {
    const leakId = req.params.id;

    // Get the leak
    const leakResult = await query(
      `SELECT * FROM leak_instances WHERE id = $1`,
      [leakId],
    );
    if (!leakResult.rows[0]) {
      res.status(404).json({ error: 'Leak not found' });
      return;
    }
    const leak = leakResult.rows[0];

    // Parallel: related commits, entity links, recent metrics, evidence events
    const [commitsResult, linksResult, metricsResult, actionsResult] = await Promise.all([
      // Ledger commits triggered by this leak
      query(
        `SELECT id, title, summary, status, commit_type, created_at, dri
         FROM ledger_commits
         WHERE leak_instance_id = $1
         ORDER BY created_at DESC`,
        [leakId],
      ),
      // Entity links involving this leak's evidence
      query(
        `SELECT * FROM entity_links
         WHERE company_id = $1
           AND (source_entity_id = $2 OR target_entity_id = $2)
         ORDER BY created_at DESC LIMIT 20`,
        [leak.company_id, leakId],
      ),
      // Recent metric snapshots for this leak's team (context)
      leak.team_id
        ? query(
            `SELECT metric_name, date, value
             FROM metric_snapshots
             WHERE company_id = $1 AND scope = 'team' AND scope_id = $2
               AND date >= CURRENT_DATE - INTERVAL '14 days'
             ORDER BY date DESC`,
            [leak.company_id, leak.team_id],
          )
        : Promise.resolve({ rows: [] }),
      // Proposed actions for this leak
      query(
        `SELECT id, action_type, target_system, approval_status, risk_level, created_at
         FROM proposed_actions
         WHERE leak_instance_id = $1
         ORDER BY created_at DESC`,
        [leakId],
      ),
    ]);

    res.json({
      leak,
      related_commits: commitsResult.rows,
      entity_links: linksResult.rows,
      recent_metrics: metricsResult.rows,
      proposed_actions: actionsResult.rows,
    });
  } catch (err) {
    logger.error({ err }, 'Leak context error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/leaks/:id/trace
// Recursive causal chain: leak → commits → actions → results
// ============================================
router.get('/leaks/:id/trace', async (req: Request, res: Response) => {
  try {
    const leakId = req.params.id;

    // Get the leak itself
    const leakResult = await query(
      `SELECT * FROM leak_instances WHERE id = $1`,
      [leakId],
    );

    const leak = leakResult.rows[0];
    if (!leak) {
      res.status(404).json({ error: 'Leak not found' });
      return;
    }

    // Find all ledger commits triggered by this leak
    const commitsResult = await query(
      `SELECT lc.*, le.edge_type
       FROM ledger_edges le
       JOIN ledger_commits lc ON lc.id = le.commit_id
       WHERE le.target_type = 'leak_instance'
         AND le.target_id = $1
         AND le.edge_type = 'triggered_by'
       ORDER BY lc.created_at`,
      [leakId],
    );

    // For each commit, find resulting actions
    const commitIds = commitsResult.rows.map((c: any) => c.id);
    let actions: any[] = [];
    if (commitIds.length > 0) {
      const actionsResult = await query(
        `SELECT pa.*, le.edge_type, le.commit_id AS source_commit_id
         FROM ledger_edges le
         JOIN proposed_actions pa ON pa.id::text = le.target_id
         WHERE le.target_type = 'proposed_action'
           AND le.edge_type = 'resulted_in'
           AND le.commit_id = ANY($1)
         ORDER BY pa.created_at`,
        [commitIds],
      );
      actions = actionsResult.rows;
    }

    // Find evidence events referenced by these commits
    let evidenceEvents: any[] = [];
    if (commitIds.length > 0) {
      const eventsResult = await query(
        `SELECT e.id, e.source, e.event_type, e.entity_id, e.timestamp,
                le.commit_id AS source_commit_id
         FROM ledger_edges le
         JOIN events e ON e.id::text = le.target_id
         WHERE le.target_type = 'event'
           AND le.edge_type = 'references'
           AND le.commit_id = ANY($1)
         ORDER BY e.timestamp`,
        [commitIds],
      );
      evidenceEvents = eventsResult.rows;
    }

    // Find metric impact (snapshots since leak detection)
    const metricsResult = await query(
      `SELECT metric_name, value, baseline_value, date
       FROM metric_snapshots
       WHERE company_id = $1
         AND metric_name = $2
         AND date >= $3::date
       ORDER BY date`,
      [
        (leak as any).company_id,
        (leak as any).metrics_context?.metric_name || 'unknown',
        (leak as any).detected_at,
      ],
    );

    res.json({
      leak,
      commits: commitsResult.rows,
      actions,
      evidence_events: evidenceEvents,
      metric_trend: metricsResult.rows,
      trace_summary: {
        total_commits: commitsResult.rows.length,
        total_actions: actions.length,
        total_evidence: evidenceEvents.length,
        actions_executed: actions.filter((a: any) => a.status === 'executed').length,
        actions_pending: actions.filter((a: any) => a.status === 'pending').length,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Leak trace error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/entities/:provider/:id/connections
// All cross-tool connections for an entity
// ============================================
router.get('/entities/:provider/:id/connections', async (req: Request, res: Response) => {
  try {
    const { provider, id: entityId } = req.params;

    // Find all entity links where this entity is source or target
    const linksResult = await query(
      `SELECT *
       FROM entity_links
       WHERE (source_provider = $1 AND source_entity_id = $2)
          OR (target_provider = $1 AND target_entity_id = $2)
       ORDER BY created_at DESC`,
      [provider, entityId],
    );

    // Collect all connected entity IDs for context
    const connectedEntities: Array<{
      provider: string;
      entityType: string;
      entityId: string;
      linkType: string;
      direction: 'outgoing' | 'incoming';
    }> = [];

    for (const link of linksResult.rows as any[]) {
      if (link.source_provider === provider && link.source_entity_id === entityId) {
        connectedEntities.push({
          provider: link.target_provider,
          entityType: link.target_entity_type,
          entityId: link.target_entity_id,
          linkType: link.link_type,
          direction: 'outgoing',
        });
      } else {
        connectedEntities.push({
          provider: link.source_provider,
          entityType: link.source_entity_type,
          entityId: link.source_entity_id,
          linkType: link.link_type,
          direction: 'incoming',
        });
      }
    }

    res.json({
      entity: { provider, entityId },
      connections: connectedEntities,
      total: connectedEntities.length,
      raw_links: linksResult.rows,
    });
  } catch (err) {
    logger.error({ err }, 'Entity connections error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/teams/health
// Per-team health data for overview comparison grid
// ============================================
router.get('/teams/health', async (req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string }>(
      `SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`
    );
    const company = companiesResult.rows[0];
    if (!company) {
      res.json({ teams: [], company_health_score: 0 });
      return;
    }

    const companyId = company.id;

    // Get all teams with recent metrics
    const teamsResult = await query<{
      id: string;
      name: string;
      slug: string;
      color: string;
      leak_count: string;
      active_leak_count: string;
      event_count_7d: string;
    }>(
      `SELECT
        t.id,
        t.name,
        t.slug,
        t.color,
        COALESCE((SELECT COUNT(*) FROM leak_instances li WHERE li.team_id = t.id), 0)::text AS leak_count,
        COALESCE((SELECT COUNT(*) FROM leak_instances li WHERE li.team_id = t.id AND li.status IN ('detected', 'delivered')), 0)::text AS active_leak_count,
        COALESCE((SELECT COUNT(*) FROM events e WHERE e.team_id = t.id AND e.timestamp >= NOW() - INTERVAL '7 days'), 0)::text AS event_count_7d
       FROM teams t
       WHERE t.company_id = $1
       ORDER BY t.name`,
      [companyId],
    );

    // For each team, get latest metric snapshots
    const teamHealth = await Promise.all(
      teamsResult.rows.map(async (team) => {
        const metricsResult = await query<{
          metric_name: string;
          value: string;
          baseline_value: string;
          date: string;
        }>(
          `SELECT DISTINCT ON (metric_name)
            metric_name, value::text, baseline_value::text, date::text
           FROM metric_snapshots
           WHERE company_id = $1
             AND scope = 'team'
             AND scope_id = $2
           ORDER BY metric_name, date DESC`,
          [companyId, team.id],
        );

        const metrics: Record<string, { value: number; baseline: number }> = {};
        for (const row of metricsResult.rows) {
          metrics[row.metric_name] = {
            value: Number(row.value),
            baseline: Number(row.baseline_value),
          };
        }

        // Compute a simple health score (0-100)
        // Lower is better for: cycle_time, review_latency, unresolved_threads, pr_age, reopen_rate
        // Score = penalize each metric that is above baseline
        let score = 100;
        const penalties: Record<string, number> = {
          'jira.cycle_time_median': 15,
          'github.pr_review_latency_median': 15,
          'slack.unresolved_threads': 10,
          'github.pr_age_median': 10,
          'jira.reopen_rate': 10,
          'slack.thread_length_median': 5,
        };

        for (const [metric, penalty] of Object.entries(penalties)) {
          const m = metrics[metric];
          if (m && m.baseline > 0) {
            const ratio = m.value / m.baseline;
            if (ratio > 1.5) score -= penalty;
            else if (ratio > 1.2) score -= Math.round(penalty * 0.5);
          }
        }

        // bonus for active leaks
        const activeLeaks = Number(team.active_leak_count);
        if (activeLeaks > 0) score -= Math.min(activeLeaks * 5, 20);

        return {
          id: team.id,
          name: team.name,
          slug: team.slug,
          color: team.color,
          leakCount: Number(team.leak_count),
          activeLeaks,
          eventCount7d: Number(team.event_count_7d),
          metrics,
          healthScore: Math.max(0, Math.min(100, score)),
        };
      }),
    );

    // Company-wide health score = average of team scores (or 100 if no teams)
    const companyHealthScore = teamHealth.length > 0
      ? Math.round(teamHealth.reduce((sum, t) => sum + t.healthScore, 0) / teamHealth.length)
      : 100;

    res.json({ teams: teamHealth, company_health_score: companyHealthScore });
  } catch (err) {
    logger.error({ err }, 'Teams health error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// POST /api/sync/github-projects — Trigger GitHub Projects v2 sync
// ============================================
router.post('/sync/github-projects', async (req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companiesResult.rows[0]?.id;
    if (!companyId) { res.status(404).json({ error: 'No company found' }); return; }

    const result = await handleProjectsV2Sync(companyId);
    res.json({ message: 'GitHub Projects v2 sync complete', ...result });
  } catch (err) {
    logger.error({ err }, 'GitHub Projects v2 sync error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// POST /api/sync/jira-components — Trigger Jira component sync for a project key
// ============================================
router.post('/sync/jira-components', async (req: Request, res: Response) => {
  try {
    const { project_key } = req.body;
    if (!project_key || typeof project_key !== 'string') {
      res.status(400).json({ error: 'project_key is required' });
      return;
    }

    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companiesResult.rows[0]?.id;
    if (!companyId) { res.status(404).json({ error: 'No company found' }); return; }

    await syncJiraProjectComponents(companyId, project_key);
    res.json({ message: `Jira components synced for project ${project_key}` });
  } catch (err) {
    logger.error({ err }, 'Jira component sync error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GET /api/teams/:id/leak-rules — List custom JQL leak rules for a team
// ============================================
router.get('/teams/:id/leak-rules', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const rules = await getTeamLeakRules(req.params.id);
    res.json({ rules });
  } catch (err) {
    logger.error({ err, teamId: req.params.id }, 'Get leak rules error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// POST /api/teams/:id/leak-rules — Create or update a custom JQL leak rule
// ============================================
router.post('/teams/:id/leak-rules', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id: ruleId, name, description, jql, threshold, severity_multiplier, enabled } = req.body;

    if (!ruleId || !name || !jql || threshold == null) {
      res.status(400).json({ error: 'id, name, jql, and threshold are required' });
      return;
    }

    if (typeof jql !== 'string' || jql.length > 2000) {
      res.status(400).json({ error: 'jql must be a string under 2000 characters' });
      return;
    }

    const multiplier = Number(severity_multiplier) || 1.0;
    if (multiplier < 0.5 || multiplier > 2.0) {
      res.status(400).json({ error: 'severity_multiplier must be between 0.5 and 2.0' });
      return;
    }

    const rules = await upsertTeamLeakRule(req.params.id, {
      id: String(ruleId),
      name: String(name),
      description: String(description || ''),
      jql: String(jql),
      threshold: Number(threshold),
      severity_multiplier: multiplier,
      enabled: enabled !== false,
    });

    res.json({ rules });
  } catch (err) {
    logger.error({ err, teamId: req.params.id }, 'Upsert leak rule error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// DELETE /api/teams/:id/leak-rules/:ruleId — Delete a custom JQL leak rule
// ============================================
router.delete('/teams/:id/leak-rules/:ruleId', async (req: Request<{ id: string; ruleId: string }>, res: Response) => {
  try {
    // Verify team belongs to current company
    const companyResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companyResult.rows[0]?.id;
    if (!companyId) { res.status(404).json({ error: 'No company found' }); return; }

    const teamCheck = await query<{ id: string }>(
      `SELECT id FROM teams WHERE id = $1 AND company_id = $2`,
      [req.params.id, companyId],
    );
    if (!teamCheck.rows[0]) { res.status(404).json({ error: 'Team not found' }); return; }

    const rules = await deleteTeamLeakRule(req.params.id, req.params.ruleId);
    res.json({ rules });
  } catch (err) {
    logger.error({ err, teamId: req.params.id, ruleId: req.params.ruleId }, 'Delete leak rule error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// POST /api/leak-rules/validate — Validate a JQL query (dry-run)
// ============================================
router.post('/leak-rules/validate', async (req: Request, res: Response) => {
  try {
    const { jql } = req.body;
    if (!jql || typeof jql !== 'string') {
      res.status(400).json({ error: 'jql is required' });
      return;
    }

    if (jql.length > 2000) {
      res.status(400).json({ error: 'jql must be under 2000 characters' });
      return;
    }

    const result = await validateJql(jql);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'JQL validation error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// POST /api/leak-rules/evaluate — Trigger custom JQL leak rule evaluation
// ============================================
router.post('/leak-rules/evaluate', async (req: Request, res: Response) => {
  try {
    const companiesResult = await query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    const companyId = companiesResult.rows[0]?.id;
    if (!companyId) { res.status(404).json({ error: 'No company found' }); return; }

    await evaluateCustomLeakRules(companyId);
    res.json({ message: 'Custom JQL leak rules evaluated' });
  } catch (err) {
    logger.error({ err }, 'JQL leak rules evaluation error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
