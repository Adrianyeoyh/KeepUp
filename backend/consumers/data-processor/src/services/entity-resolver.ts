import { query } from '@flowguard/db';
import { logger } from '../logger.js';

/**
 * EntityResolver — Auto-scopes incoming events to teams + projects.
 *
 * Migrated from apps/api/src/services/entity-resolver.ts.
 * Key changes:
 *   - Uses `@flowguard/db` query() instead of local db client
 *
 * All business logic preserved including BFS graph traversal.
 */

export interface ScopeResolution {
  team_id: string | null;
  project_id: string | null;
}

interface ProjectRow {
  id: string;
  team_id: string | null;
}

async function resolveSlackScope(
  companyId: string,
  channelId: string | undefined,
): Promise<ScopeResolution> {
  if (!channelId) return { team_id: null, project_id: null };

  const result = await query<ProjectRow>(
    `SELECT id, team_id FROM projects
     WHERE company_id = $1 AND $2 = ANY(slack_channel_ids)
     LIMIT 1`,
    [companyId, channelId],
  );

  if (result.rows.length === 0) return { team_id: null, project_id: null };
  return { team_id: result.rows[0].team_id, project_id: result.rows[0].id };
}

async function resolveJiraScope(
  companyId: string,
  projectKey: string | undefined,
): Promise<ScopeResolution> {
  if (!projectKey) return { team_id: null, project_id: null };

  const result = await query<ProjectRow>(
    `SELECT id, team_id FROM projects
     WHERE company_id = $1 AND $2 = ANY(jira_project_keys)
     LIMIT 1`,
    [companyId, projectKey],
  );

  if (result.rows.length === 0) return { team_id: null, project_id: null };
  return { team_id: result.rows[0].team_id, project_id: result.rows[0].id };
}

async function resolveGitHubScope(
  companyId: string,
  repoFullName: string | undefined,
): Promise<ScopeResolution> {
  if (!repoFullName) return { team_id: null, project_id: null };

  const result = await query<ProjectRow>(
    `SELECT id, team_id FROM projects
     WHERE company_id = $1 AND $2 = ANY(github_repos)
     LIMIT 1`,
    [companyId, repoFullName],
  );

  if (result.rows.length === 0) return { team_id: null, project_id: null };
  return { team_id: result.rows[0].team_id, project_id: result.rows[0].id };
}

/**
 * Main entry point: resolves scope for any event source.
 */
export async function resolveScope(
  companyId: string,
  source: 'slack' | 'jira' | 'github',
  context: {
    channelId?: string;
    projectKey?: string;
    repoFullName?: string;
  },
): Promise<ScopeResolution> {
  try {
    switch (source) {
      case 'slack':
        return await resolveSlackScope(companyId, context.channelId);
      case 'jira':
        return await resolveJiraScope(companyId, context.projectKey);
      case 'github':
        return await resolveGitHubScope(companyId, context.repoFullName);
      default:
        return { team_id: null, project_id: null };
    }
  } catch (err) {
    logger.warn({ err, source, companyId }, 'Entity scope resolution failed — event will be unscoped');
    return { team_id: null, project_id: null };
  }
}

/**
 * BFS traversal to find the full connected graph from a starting entity.
 * Returns all nodes and edges reachable from the root via entity_links + ledger_edges.
 */
export async function getConnectedGraph(
  companyId: string,
  rootEntityId: string,
  maxDepth: number = 5,
): Promise<{
  nodes: Array<{ entity_id: string; entity_type: string; depth: number }>;
  edges: Array<{ source: string; target: string; link_type: string }>;
}> {
  const visited = new Set<string>();
  const nodes: Array<{ entity_id: string; entity_type: string; depth: number }> = [];
  const edges: Array<{ source: string; target: string; link_type: string }> = [];

  const queue: Array<[string, number]> = [[rootEntityId, 0]];
  visited.add(rootEntityId);

  // Seed the root node type
  const rootResult = await query<{ source_entity_type: string }>(
    `SELECT source_entity_type FROM entity_links WHERE company_id = $1 AND source_entity_id = $2 LIMIT 1`,
    [companyId, rootEntityId],
  );
  nodes.push({
    entity_id: rootEntityId,
    entity_type: rootResult.rows[0]?.source_entity_type || 'unknown',
    depth: 0,
  });

  while (queue.length > 0) {
    const [currentId, depth] = queue.shift()!;
    if (depth >= maxDepth) continue;

    // Find all linked entities via entity_links (bidirectional)
    const linkResult = await query<{
      source_entity_id: string;
      source_entity_type: string;
      target_entity_id: string;
      target_entity_type: string;
      link_type: string;
    }>(
      `SELECT source_entity_id, source_entity_type, target_entity_id, target_entity_type, link_type
       FROM entity_links
       WHERE company_id = $1 AND (source_entity_id = $2 OR target_entity_id = $2)`,
      [companyId, currentId],
    );

    for (const link of linkResult.rows) {
      const neighborId = link.source_entity_id === currentId
        ? link.target_entity_id
        : link.source_entity_id;
      const neighborType = link.source_entity_id === currentId
        ? link.target_entity_type
        : link.source_entity_type;

      edges.push({
        source: link.source_entity_id,
        target: link.target_entity_id,
        link_type: link.link_type,
      });

      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        nodes.push({ entity_id: neighborId, entity_type: neighborType, depth: depth + 1 });
        queue.push([neighborId, depth + 1]);
      }
    }

    // Also traverse ledger_edges (commit -> target relationships)
    const ledgerResult = await query<{
      commit_id: string;
      target_id: string;
      target_type: string;
      edge_type: string;
    }>(
      `SELECT commit_id, target_id, target_type, edge_type
       FROM ledger_edges
       WHERE commit_id = $1 OR target_id = $1`,
      [currentId],
    );

    for (const le of ledgerResult.rows) {
      const neighborId = le.commit_id === currentId ? le.target_id : le.commit_id;
      const neighborType = le.commit_id === currentId ? le.target_type : 'ledger_commit';

      edges.push({
        source: le.commit_id,
        target: le.target_id,
        link_type: le.edge_type,
      });

      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        nodes.push({ entity_id: neighborId, entity_type: neighborType, depth: depth + 1 });
        queue.push([neighborId, depth + 1]);
      }
    }
  }

  return { nodes, edges };
}

export const entityResolver = { resolveScope, getConnectedGraph };
