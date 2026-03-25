import { Octokit } from '@octokit/rest';
import { query } from '../db/client.js';
import { logger } from '../logger.js';
import { getOctokitForRepo } from './github-client.js';

/**
 * GitHub Projects v2 Integration
 *
 * Syncs GitHub Projects (v2, GraphQL-based) to FlowGuard as an alternative
 * to Jira boards. Maps project items (issues/PRs/drafts) to events and
 * enables teams using GitHub-only workflows.
 *
 * Features:
 *   1. Sync GitHub Project metadata → FlowGuard project settings
 *   2. Ingest project_v2_item webhooks → track board state changes
 *   3. Map GitHub Project custom fields (status, priority) to metrics
 */

interface GitHubProjectV2 {
  id: string;
  title: string;
  number: number;
  shortDescription?: string;
  url: string;
  closed: boolean;
  items: {
    totalCount: number;
  };
}

interface GitHubProjectV2Item {
  id: string;
  type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE';
  content?: {
    number: number;
    title: string;
    state?: string;
    url?: string;
  };
  fieldValues: Array<{
    name: string;
    value?: string;
    optionId?: string;
  }>;
}

/**
 * Sync GitHub Projects v2 for a company.
 * Lists all projects in connected GitHub orgs and stores metadata.
 */
export async function syncGitHubProjectsV2(companyId: string): Promise<void> {
  // Get all GitHub repos from FlowGuard projects to discover orgs
  const projectsResult = await query<{ id: string; github_repos: string[]; settings: Record<string, any> }>(
    `SELECT id, github_repos, COALESCE(settings, '{}') AS settings
     FROM projects
     WHERE company_id = $1 AND github_repos != '{}'`,
    [companyId],
  );

  const orgs = new Set<string>();
  const repoToProject = new Map<string, string>();

  for (const project of projectsResult.rows) {
    for (const repo of project.github_repos) {
      const [owner] = repo.split('/');
      if (owner) orgs.add(owner);
      repoToProject.set(repo, project.id);
    }
  }

  for (const org of orgs) {
    const firstRepo = [...repoToProject.keys()].find((r) => r.startsWith(`${org}/`));
    if (!firstRepo) continue;

    const octokit = await getOctokitForRepo(companyId, firstRepo);
    if (!octokit) continue;

    try {
      const ghProjects = await fetchOrgProjectsV2(octokit, org);
      for (const ghProject of ghProjects) {
        await linkGitHubProjectToFlowGuard(companyId, org, ghProject, repoToProject);
      }
      logger.info({ org, count: ghProjects.length }, 'GitHub Projects v2 synced');
    } catch (err) {
      logger.warn({ err, org }, 'GitHub Projects v2 sync failed — non-fatal');
    }
  }
}

/**
 * Fetch org-level Projects v2 via GraphQL.
 */
async function fetchOrgProjectsV2(
  octokit: Octokit,
  org: string,
): Promise<GitHubProjectV2[]> {
  try {
    const response = await octokit.graphql<{
      organization: {
        projectsV2: {
          nodes: GitHubProjectV2[];
        };
      };
    }>(
      `query($org: String!) {
        organization(login: $org) {
          projectsV2(first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              id
              title
              number
              shortDescription
              url
              closed
              items { totalCount }
            }
          }
        }
      }`,
      { org },
    );

    return response.organization.projectsV2.nodes.filter((p) => !p.closed);
  } catch (err) {
    logger.debug({ err, org }, 'GraphQL Projects v2 query failed');
    return [];
  }
}

/**
 * Link a GitHub Project v2 to a FlowGuard project via naming convention or settings.
 */
async function linkGitHubProjectToFlowGuard(
  companyId: string,
  org: string,
  ghProject: GitHubProjectV2,
  repoToProject: Map<string, string>,
): Promise<void> {
  const slug = ghProject.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Try explicit match first (project settings contain github_project_id)
  const explicitMatch = await query<{ id: string }>(
    `SELECT id FROM projects
     WHERE company_id = $1
       AND settings->>'github_project_node_id' = $2
     LIMIT 1`,
    [companyId, ghProject.id],
  );

  if (explicitMatch.rows[0]) {
    await updateProjectGitHubMeta(explicitMatch.rows[0].id, ghProject);
    return;
  }

  // Try slug-based match
  const slugMatch = await query<{ id: string }>(
    `SELECT id FROM projects
     WHERE company_id = $1 AND slug = $2
     LIMIT 1`,
    [companyId, slug],
  );

  if (slugMatch.rows[0]) {
    await updateProjectGitHubMeta(slugMatch.rows[0].id, ghProject);
    logger.info({ ghProjectTitle: ghProject.title, projectId: slugMatch.rows[0].id }, 'Auto-linked GitHub Project v2 by slug');
    return;
  }

  // No match — store as an unlinked GitHub project for manual linking
  logger.debug({ ghProjectTitle: ghProject.title, org }, 'GitHub Project v2 has no matching FlowGuard project');
}

async function updateProjectGitHubMeta(
  projectId: string,
  ghProject: GitHubProjectV2,
): Promise<void> {
  await query(
    `UPDATE projects
     SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [
      JSON.stringify({
        github_project_node_id: ghProject.id,
        github_project_number: ghProject.number,
        github_project_title: ghProject.title,
        github_project_url: ghProject.url,
        github_project_item_count: ghProject.items.totalCount,
        github_project_synced_at: new Date().toISOString(),
      }),
      projectId,
    ],
  );
}

/**
 * Process a projects_v2_item webhook event.
 * Called from the GitHub webhook handler when event type is projects_v2_item.
 */
export function normalizeProjectV2ItemEvent(
  body: Record<string, any>,
  companyId: string,
  deliveryId: string,
): Array<{
  company_id: string;
  source: 'github';
  entity_id: string;
  event_type: 'github.project_v2_item';
  timestamp: Date;
  metadata: Record<string, unknown>;
  provider_event_id: string;
}> {
  const action = body.action; // created, edited, archived, restored, reordered, deleted
  const item = body.projects_v2_item;
  const projectId = item?.project_node_id || body.project_v2?.node_id;
  const contentType = item?.content_type; // Issue, PullRequest, DraftIssue
  const contentNodeId = item?.content_node_id;

  if (!item || !action) return [];

  return [{
    company_id: companyId,
    source: 'github' as const,
    entity_id: contentNodeId || item.node_id || 'unknown-item',
    event_type: 'github.project_v2_item',
    timestamp: new Date(body.projects_v2_item?.updated_at || new Date()),
    metadata: {
      action,
      project_node_id: projectId,
      item_node_id: item.node_id,
      content_type: contentType,
      content_node_id: contentNodeId,
      sender: body.sender?.login,
      changes: body.changes || null,
    },
    provider_event_id: `${deliveryId}:project_v2_item:${action}`,
  }];
}

/**
 * API endpoint handler for manually triggering GitHub Projects v2 sync.
 */
export async function handleProjectsV2Sync(companyId: string): Promise<{ synced: number }> {
  const before = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM projects WHERE company_id = $1 AND settings->>'github_project_node_id' IS NOT NULL`,
    [companyId],
  );

  await syncGitHubProjectsV2(companyId);

  const after = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM projects WHERE company_id = $1 AND settings->>'github_project_node_id' IS NOT NULL`,
    [companyId],
  );

  return { synced: parseInt(after.rows[0]?.count || '0', 10) - parseInt(before.rows[0]?.count || '0', 10) };
}
