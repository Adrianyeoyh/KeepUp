import { query } from '../db/client.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

/**
 * Jira Components → Sub-Project Mapping
 *
 * Large Jira projects often use components to subdivide work (e.g. "Backend",
 * "Frontend", "Infra"). This service syncs Jira components and maps them to
 * FlowGuard projects, enabling finer-grained scoping for events and leaks.
 *
 * Flow:
 *   1. On Jira webhook, extract component info from issue.fields.components[]
 *   2. Store component→project mapping in project settings
 *   3. EntityResolver uses component mapping as a secondary lookup when
 *      a Jira event's project_key matches but component narrows to a sub-project
 */

interface JiraComponent {
  id: string;
  name: string;
  description?: string;
}

/**
 * Extract and store Jira components from an incoming webhook payload.
 * Called after normalizeJiraEvents during webhook processing.
 */
export async function syncJiraComponentsFromWebhook(
  companyId: string,
  issuePayload: Record<string, any>,
): Promise<void> {
  const components: JiraComponent[] = Array.isArray(issuePayload.fields?.components)
    ? issuePayload.fields.components
    : [];

  if (components.length === 0) return;

  const projectKey = issuePayload.fields?.project?.key;
  if (!projectKey) return;

  for (const component of components) {
    try {
      await mapComponentToProject(companyId, projectKey, component);
    } catch (err) {
      logger.debug({ err, component: component.name, projectKey }, 'Component mapping skipped');
    }
  }
}

/**
 * Map a Jira component to a FlowGuard project.
 *
 * Matching rules (in priority order):
 *   1. Project with settings.jira_component_ids containing this component ID
 *   2. Project whose slug matches the component name (normalized)
 *   3. If no match, store the component mapping on the parent project for reference
 */
async function mapComponentToProject(
  companyId: string,
  projectKey: string,
  component: JiraComponent,
): Promise<void> {
  const componentSlug = component.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Check if any project already claims this component
  const explicitMatch = await query<{ id: string }>(
    `SELECT id FROM projects
     WHERE company_id = $1
       AND settings->>'jira_component_ids' IS NOT NULL
       AND settings->'jira_component_ids' ? $2
     LIMIT 1`,
    [companyId, component.id],
  );

  if (explicitMatch.rows[0]) {
    return; // Already mapped
  }

  // Try slug-based match (e.g. component "Backend" → project slug "backend")
  const slugMatch = await query<{ id: string }>(
    `SELECT id FROM projects
     WHERE company_id = $1
       AND slug = $2
       AND $3 = ANY(jira_project_keys)
     LIMIT 1`,
    [companyId, componentSlug, projectKey],
  );

  if (slugMatch.rows[0]) {
    // Auto-link: store component ID in project settings
    await query(
      `UPDATE projects
       SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
         'jira_component_ids', COALESCE(settings->'jira_component_ids', '[]'::jsonb) || to_jsonb($1::text)
       ),
       updated_at = NOW()
       WHERE id = $2`,
      [component.id, slugMatch.rows[0].id],
    );
    logger.info({ projectKey, component: component.name, projectId: slugMatch.rows[0].id }, 'Auto-mapped Jira component to project by slug');
    return;
  }

  // No sub-project match — store on the parent project's component_map for reference
  const parentProject = await query<{ id: string }>(
    `SELECT id FROM projects
     WHERE company_id = $1 AND $2 = ANY(jira_project_keys)
     LIMIT 1`,
    [companyId, projectKey],
  );

  if (parentProject.rows[0]) {
    await query(
      `UPDATE projects
       SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
         'jira_component_map', COALESCE(settings->'jira_component_map', '{}'::jsonb) || jsonb_build_object($1, $2)
       ),
       updated_at = NOW()
       WHERE id = $3`,
      [component.id, component.name, parentProject.rows[0].id],
    );
  }
}

/**
 * Resolve a Jira issue to a sub-project using its component.
 * Called by EntityResolver as a secondary lookup after project_key matching.
 *
 * Returns a more specific project_id if a component maps to a sub-project,
 * or null to use the default project_key-based resolution.
 */
export async function resolveProjectByComponent(
  companyId: string,
  projectKey: string,
  components: Array<{ id?: string; name?: string }>,
): Promise<{ project_id: string; team_id: string | null } | null> {
  for (const component of components) {
    if (!component.id) continue;

    const result = await query<{ id: string; team_id: string | null }>(
      `SELECT id, team_id FROM projects
       WHERE company_id = $1
         AND (
           settings->'jira_component_ids' ? $2
           OR slug = $3
         )
         AND $4 = ANY(jira_project_keys)
       LIMIT 1`,
      [
        companyId,
        component.id,
        (component.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        projectKey,
      ],
    );

    if (result.rows[0]) {
      return {
        project_id: result.rows[0].id,
        team_id: result.rows[0].team_id,
      };
    }
  }

  return null;
}

/**
 * Fetch all components for a Jira project via API (for initial sync).
 * Requires JIRA_BASE_URL and auth credentials.
 */
export async function syncJiraProjectComponents(
  companyId: string,
  projectKey: string,
): Promise<void> {
  const { JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN } = config;
  if (!JIRA_BASE_URL || !JIRA_USER_EMAIL || !JIRA_API_TOKEN) {
    logger.debug('Jira component sync skipped — no credentials');
    return;
  }

  const auth = Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

  try {
    const response = await fetch(
      `${JIRA_BASE_URL}/rest/api/3/project/${encodeURIComponent(projectKey)}/components`,
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
        },
      },
    );

    if (!response.ok) {
      logger.warn({ status: response.status, projectKey }, 'Jira components API failed');
      return;
    }

    const components = await response.json() as JiraComponent[];

    for (const component of components) {
      await mapComponentToProject(companyId, projectKey, component);
    }

    logger.info({ projectKey, count: components.length }, 'Jira project components synced');
  } catch (err) {
    logger.warn({ err, projectKey }, 'Jira component sync error — non-fatal');
  }
}
