import { Router, Request, Response } from 'express';
import { WebClient } from '@slack/web-api';
import { query } from '../db/client.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { getOctokitForRepo } from '../services/github-client.js';

type DispatchProvider = 'slack' | 'jira' | 'github';

type RouteRow = {
  id: string;
  company_id: string;
  team_id: string | null;
  project_id: string | null;
  name: string;
  solution_draft: string | null;
  snapshot: Record<string, unknown>;
  dataset_signature: string;
  focus_node_ids: string[];
  created_by: string | null;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
};

type DispatchRow = {
  id: string;
  ledger_route_id: string;
  company_id: string;
  provider: DispatchProvider;
  target: string;
  status: 'sent' | 'failed';
  message: string | null;
  response: Record<string, unknown>;
  error: string | null;
  dispatched_by: string | null;
  created_at: string;
};

const router = Router();

async function resolvePrimaryCompanyId(): Promise<string | null> {
  const companyResult = await query<{ id: string }>(
    `SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`,
  );
  return companyResult.rows[0]?.id || null;
}

function extractFocusNodeIds(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== 'object') return [];

  const traversal = (snapshot as { traversal?: unknown }).traversal;
  if (!traversal || typeof traversal !== 'object') return [];

  const lockedFocusIds = (traversal as { lockedFocusIds?: unknown }).lockedFocusIds;
  if (!Array.isArray(lockedFocusIds)) return [];

  return lockedFocusIds
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .slice(0, 120);
}

function normalizeRouteRow(row: RouteRow) {
  return {
    id: row.id,
    company_id: row.company_id,
    team_id: row.team_id,
    project_id: row.project_id,
    name: row.name,
    solution_draft: row.solution_draft,
    snapshot: row.snapshot,
    dataset_signature: row.dataset_signature,
    focus_node_ids: row.focus_node_ids || [],
    created_by: row.created_by,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function ensureDispatchProvider(input: unknown): DispatchProvider | null {
  if (input === 'slack' || input === 'jira' || input === 'github') return input;
  return null;
}

function buildReviewMessage(route: RouteRow, inputMessage?: string): string {
  if (typeof inputMessage === 'string' && inputMessage.trim().length > 0) {
    return inputMessage.trim();
  }

  const packet = {
    route_id: route.id,
    route_name: route.name,
    created_at: route.created_at,
    updated_at: route.updated_at,
    dataset_signature: route.dataset_signature,
    focus_node_ids: route.focus_node_ids || [],
    proposed_solution: route.solution_draft || null,
    snapshot: route.snapshot,
  };

  return [
    `FlowGuard route review request: ${route.name}`,
    route.solution_draft ? `Proposed solution: ${route.solution_draft}` : 'Proposed solution: (none provided)',
    'Review packet:',
    '```json',
    JSON.stringify(packet, null, 2),
    '```',
  ].join('\n');
}

function normalizeGithubTarget(target: string): { repoFullName: string; issueNumber: number } | null {
  const match = /^([^/\s]+\/[^#\s]+)#(\d+)$/.exec(target.trim());
  if (!match) return null;

  const issueNumber = Number.parseInt(match[2], 10);
  if (!Number.isFinite(issueNumber) || issueNumber <= 0) return null;

  return {
    repoFullName: match[1],
    issueNumber,
  };
}

async function dispatchToSlack(companyId: string, target: string, message: string): Promise<Record<string, unknown>> {
  const tokenResult = await query<{ bot_token: string | null }>(
    `SELECT token_data->>'bot_token' AS bot_token
     FROM integrations
     WHERE company_id = $1 AND provider = 'slack' AND status = 'active'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [companyId],
  );

  const botToken = tokenResult.rows[0]?.bot_token;
  if (!botToken) {
    throw new Error('Slack integration token not configured for this company');
  }

  const client = new WebClient(botToken);
  const result = await client.chat.postMessage({
    channel: target,
    text: message,
    unfurl_links: false,
  });

  if (!result.ok) {
    throw new Error(`Slack dispatch failed: ${result.error || 'unknown_error'}`);
  }

  return {
    ok: result.ok,
    channel: result.channel,
    ts: result.ts,
  };
}

async function dispatchToJira(target: string, message: string): Promise<Record<string, unknown>> {
  if (!config.JIRA_BASE_URL || !config.JIRA_USER_EMAIL || !config.JIRA_API_TOKEN) {
    throw new Error('Jira API credentials are not configured');
  }

  const auth = Buffer.from(`${config.JIRA_USER_EMAIL}:${config.JIRA_API_TOKEN}`).toString('base64');
  const response = await fetch(
    `${config.JIRA_BASE_URL}/rest/api/3/issue/${encodeURIComponent(target)}/comment`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: message.slice(0, 3000),
                },
              ],
            },
          ],
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Jira dispatch failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const payload = await response.json().catch(() => ({}));
  return {
    id: (payload as { id?: string }).id || null,
    self: (payload as { self?: string }).self || null,
  };
}

async function dispatchToGithub(companyId: string, target: string, message: string): Promise<Record<string, unknown>> {
  const parsed = normalizeGithubTarget(target);
  if (!parsed) {
    throw new Error('GitHub target must be in format owner/repo#issueOrPrNumber');
  }

  const octokit = await getOctokitForRepo(companyId, parsed.repoFullName);
  if (!octokit) {
    throw new Error('GitHub credentials are not configured for the target repository');
  }

  const [owner, repo] = parsed.repoFullName.split('/');
  const result = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: parsed.issueNumber,
    body: message,
  });

  return {
    id: result.data.id,
    html_url: result.data.html_url,
  };
}

async function recordDispatch(dispatch: {
  routeId: string;
  companyId: string;
  provider: DispatchProvider;
  target: string;
  status: 'sent' | 'failed';
  message: string;
  response?: Record<string, unknown>;
  error?: string;
  actor?: string;
}): Promise<DispatchRow> {
  const result = await query<DispatchRow>(
    `INSERT INTO ledger_route_dispatches (
      ledger_route_id,
      company_id,
      provider,
      target,
      status,
      message,
      response,
      error,
      dispatched_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
    RETURNING *`,
    [
      dispatch.routeId,
      dispatch.companyId,
      dispatch.provider,
      dispatch.target,
      dispatch.status,
      dispatch.message,
      JSON.stringify(dispatch.response || {}),
      dispatch.error || null,
      dispatch.actor || null,
    ],
  );

  return result.rows[0];
}

router.get('/ledger/routes', async (req: Request, res: Response) => {
  try {
    const companyId = await resolvePrimaryCompanyId();
    if (!companyId) {
      res.json({ routes: [] });
      return;
    }

    const teamId = typeof req.query.team_id === 'string' ? req.query.team_id : undefined;
    const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : undefined;
    const limitInput = Number.parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(limitInput) ? Math.min(200, Math.max(1, limitInput)) : 80;

    const params: unknown[] = [companyId];
    const whereParts = [`company_id = $1`, `status = 'active'`];

    if (teamId) {
      params.push(teamId);
      whereParts.push(`(team_id = $${params.length} OR team_id IS NULL)`);
    }

    if (projectId) {
      params.push(projectId);
      whereParts.push(`(project_id = $${params.length} OR project_id IS NULL)`);
    }

    const routesResult = await query<RouteRow>(
      `SELECT *
       FROM ledger_routes
       WHERE ${whereParts.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT $${params.length + 1}`,
      [...params, limit],
    );

    res.json({
      routes: routesResult.rows.map(normalizeRouteRow),
    });
  } catch (err) {
    logger.error({ err }, 'List ledger routes failed');
    res.status(500).json({ error: 'Failed to list ledger routes' });
  }
});

router.post('/ledger/routes', async (req: Request, res: Response) => {
  try {
    const companyId = await resolvePrimaryCompanyId();
    if (!companyId) {
      res.status(404).json({ error: 'No company found' });
      return;
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const snapshot = req.body?.snapshot as unknown;
    const teamId = typeof req.body?.team_id === 'string' ? req.body.team_id : null;
    const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id : null;
    const createdBy = typeof req.body?.created_by === 'string' ? req.body.created_by : 'web_ui';
    const solutionDraft = typeof req.body?.solution_draft === 'string' ? req.body.solution_draft.trim() : null;

    const datasetSignatureFromBody = typeof req.body?.dataset_signature === 'string'
      ? req.body.dataset_signature.trim()
      : '';
    const datasetSignatureFromSnapshot = snapshot && typeof snapshot === 'object'
      ? ((snapshot as { datasetSignature?: unknown }).datasetSignature as string | undefined)
      : undefined;
    const datasetSignature = datasetSignatureFromBody || (typeof datasetSignatureFromSnapshot === 'string' ? datasetSignatureFromSnapshot : '');

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    if (name.length > 255) {
      res.status(400).json({ error: 'name must be 255 characters or less' });
      return;
    }

    if (!snapshot || typeof snapshot !== 'object') {
      res.status(400).json({ error: 'snapshot is required and must be an object' });
      return;
    }

    if (!datasetSignature) {
      res.status(400).json({ error: 'dataset_signature is required' });
      return;
    }

    const focusNodeIds = extractFocusNodeIds(snapshot);

    const result = await query<RouteRow>(
      `INSERT INTO ledger_routes (
        company_id,
        team_id,
        project_id,
        name,
        solution_draft,
        snapshot,
        dataset_signature,
        focus_node_ids,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::text[], $9)
      RETURNING *`,
      [
        companyId,
        teamId,
        projectId,
        name,
        solutionDraft,
        JSON.stringify(snapshot),
        datasetSignature,
        focusNodeIds,
        createdBy,
      ],
    );

    res.status(201).json({ route: normalizeRouteRow(result.rows[0]) });
  } catch (err) {
    logger.error({ err }, 'Create ledger route failed');
    res.status(500).json({ error: 'Failed to create ledger route' });
  }
});

router.patch('/ledger/routes/:id', async (req: Request, res: Response) => {
  try {
    const companyId = await resolvePrimaryCompanyId();
    if (!companyId) {
      res.status(404).json({ error: 'No company found' });
      return;
    }

    const routeId = req.params.id;
    const setParts: string[] = [];
    const params: unknown[] = [];

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
    if (name !== undefined) {
      if (!name) {
        res.status(400).json({ error: 'name cannot be empty' });
        return;
      }
      if (name.length > 255) {
        res.status(400).json({ error: 'name must be 255 characters or less' });
        return;
      }
      params.push(name);
      setParts.push(`name = $${params.length}`);
    }

    const solutionDraft = req.body?.solution_draft;
    if (solutionDraft !== undefined) {
      if (solutionDraft !== null && typeof solutionDraft !== 'string') {
        res.status(400).json({ error: 'solution_draft must be a string or null' });
        return;
      }
      params.push(solutionDraft === null ? null : String(solutionDraft).trim());
      setParts.push(`solution_draft = $${params.length}`);
    }

    const snapshot = req.body?.snapshot;
    if (snapshot !== undefined) {
      if (!snapshot || typeof snapshot !== 'object') {
        res.status(400).json({ error: 'snapshot must be an object when provided' });
        return;
      }

      params.push(JSON.stringify(snapshot));
      setParts.push(`snapshot = $${params.length}::jsonb`);

      const focusNodeIds = extractFocusNodeIds(snapshot);
      params.push(focusNodeIds);
      setParts.push(`focus_node_ids = $${params.length}::text[]`);

      const datasetSignatureFromBody = typeof req.body?.dataset_signature === 'string'
        ? req.body.dataset_signature.trim()
        : '';
      const datasetSignatureFromSnapshot = (snapshot as { datasetSignature?: unknown }).datasetSignature;
      const datasetSignature = datasetSignatureFromBody
        || (typeof datasetSignatureFromSnapshot === 'string' ? datasetSignatureFromSnapshot : '');

      if (datasetSignature) {
        params.push(datasetSignature);
        setParts.push(`dataset_signature = $${params.length}`);
      }
    }

    if (setParts.length === 0) {
      res.status(400).json({ error: 'No fields provided to update' });
      return;
    }

    setParts.push('updated_at = NOW()');
    params.push(routeId);
    params.push(companyId);

    const result = await query<RouteRow>(
      `UPDATE ledger_routes
       SET ${setParts.join(', ')}
       WHERE id = $${params.length - 1} AND company_id = $${params.length}
       RETURNING *`,
      params,
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Ledger route not found' });
      return;
    }

    res.json({ route: normalizeRouteRow(result.rows[0]) });
  } catch (err) {
    logger.error({ err }, 'Update ledger route failed');
    res.status(500).json({ error: 'Failed to update ledger route' });
  }
});

router.delete('/ledger/routes/:id', async (req: Request, res: Response) => {
  try {
    const companyId = await resolvePrimaryCompanyId();
    if (!companyId) {
      res.status(404).json({ error: 'No company found' });
      return;
    }

    const result = await query<{ id: string }>(
      `UPDATE ledger_routes
       SET status = 'archived', updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND status = 'active'
       RETURNING id`,
      [req.params.id, companyId],
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: 'Ledger route not found' });
      return;
    }

    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    logger.error({ err }, 'Delete ledger route failed');
    res.status(500).json({ error: 'Failed to delete ledger route' });
  }
});

router.get('/ledger/routes/:id/dispatches', async (req: Request, res: Response) => {
  try {
    const companyId = await resolvePrimaryCompanyId();
    if (!companyId) {
      res.status(404).json({ error: 'No company found' });
      return;
    }

    const routeId = req.params.id;
    const limitInput = Number.parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(limitInput) ? Math.min(200, Math.max(1, limitInput)) : 50;

    const dispatches = await query<DispatchRow>(
      `SELECT *
       FROM ledger_route_dispatches
       WHERE ledger_route_id = $1 AND company_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [routeId, companyId, limit],
    );

    res.json({ dispatches: dispatches.rows });
  } catch (err) {
    logger.error({ err }, 'List ledger route dispatches failed');
    res.status(500).json({ error: 'Failed to list ledger route dispatches' });
  }
});

router.post('/ledger/routes/:id/dispatch', async (req: Request, res: Response) => {
  const routeIdParam = req.params.id;
  const routeId = Array.isArray(routeIdParam) ? routeIdParam[0] : routeIdParam;
  if (!routeId) {
    res.status(400).json({ error: 'route id is required' });
    return;
  }

  try {
    const companyId = await resolvePrimaryCompanyId();
    if (!companyId) {
      res.status(404).json({ error: 'No company found' });
      return;
    }

    const provider = ensureDispatchProvider(req.body?.provider);
    const target = typeof req.body?.target === 'string' ? req.body.target.trim() : '';
    const actor = typeof req.body?.actor === 'string' ? req.body.actor : 'web_ui';

    if (!provider) {
      res.status(400).json({ error: 'provider must be one of slack, jira, github' });
      return;
    }

    if (!target) {
      res.status(400).json({ error: 'target is required' });
      return;
    }

    const routeResult = await query<RouteRow>(
      `SELECT *
       FROM ledger_routes
       WHERE id = $1 AND company_id = $2 AND status = 'active'`,
      [routeId, companyId],
    );

    const route = routeResult.rows[0];
    if (!route) {
      res.status(404).json({ error: 'Ledger route not found' });
      return;
    }

    const message = buildReviewMessage(
      route,
      typeof req.body?.message === 'string' ? req.body.message : undefined,
    );

    let dispatchResponse: Record<string, unknown>;
    if (provider === 'slack') {
      dispatchResponse = await dispatchToSlack(companyId, target, message);
    } else if (provider === 'jira') {
      dispatchResponse = await dispatchToJira(target, message);
    } else {
      dispatchResponse = await dispatchToGithub(companyId, target, message);
    }

    const dispatch = await recordDispatch({
      routeId,
      companyId,
      provider,
      target,
      status: 'sent',
      message,
      response: dispatchResponse,
      actor,
    });

    res.json({
      dispatch,
      route: normalizeRouteRow(route),
    });
  } catch (err) {
    const provider = ensureDispatchProvider(req.body?.provider) || 'slack';
    const target = typeof req.body?.target === 'string' ? req.body.target.trim() : '';
    const actor = typeof req.body?.actor === 'string' ? req.body.actor : 'web_ui';
    const message = typeof req.body?.message === 'string' ? req.body.message : '';

    const companyId = await resolvePrimaryCompanyId();
    if (companyId) {
      try {
        await recordDispatch({
          routeId,
          companyId,
          provider,
          target,
          status: 'failed',
          message,
          error: err instanceof Error ? err.message : 'Unknown dispatch error',
          actor,
        });
      } catch (logErr) {
        logger.warn({ logErr }, 'Failed to record dispatch failure audit');
      }
    }

    logger.error({ err, routeId }, 'Ledger route dispatch failed');
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to dispatch route review',
    });
  }
});

export default router;
