import { query } from '../db/client.js';
import { logger } from '../logger.js';
import { getOctokitForRepo } from './github-client.js';
import { integrationService } from './integration.js';
import { WebClient } from '@slack/web-api';

/**
 * Platform Sync Service
 *
 * Syncs team membership from GitHub Teams API and Slack User Groups
 * to keep FlowGuard teams aligned with actual organizational structure.
 */

// ============================================
// GitHub Team membership sync
// ============================================

export async function syncGitHubTeamMembership(companyId: string): Promise<void> {
  const log = logger.child({ companyId, job: 'github-team-sync' });

  // Get a working Octokit (try any repo associated with the company)
  const repoResult = await query<{ repo_full_name: string }>(
    `SELECT DISTINCT metadata->>'repo_full_name' AS repo_full_name
     FROM events
     WHERE company_id = $1 AND source = 'github' AND metadata->>'repo_full_name' IS NOT NULL
     LIMIT 1`,
    [companyId],
  );

  if (repoResult.rows.length === 0) {
    log.debug('No GitHub repos found for company');
    return;
  }

  const octokit = await getOctokitForRepo(companyId, repoResult.rows[0].repo_full_name);
  if (!octokit) {
    log.debug('No GitHub credentials available');
    return;
  }

  const orgName = repoResult.rows[0].repo_full_name.split('/')[0];

  try {
    // List org teams
    const { data: ghTeams } = await octokit.teams.list({ org: orgName, per_page: 100 });

    for (const ghTeam of ghTeams) {
      // Check if we have an FlowGuard team linked to this GitHub team
      const fgTeamResult = await query<{ id: string }>(
        `SELECT id FROM teams
         WHERE company_id = $1
           AND (settings->>'github_team_slug' = $2 OR LOWER(slug) = LOWER($2))
         LIMIT 1`,
        [companyId, ghTeam.slug],
      );

      if (fgTeamResult.rows.length === 0) continue;
      const fgTeamId = fgTeamResult.rows[0].id;

      // Get team members
      const { data: members } = await octokit.teams.listMembersInOrg({
        org: orgName,
        team_slug: ghTeam.slug,
        per_page: 100,
      });

      const memberLogins = members.map((m) => m.login);

      // Update team settings with member list
      await query(
        `UPDATE teams
         SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [
          JSON.stringify({
            github_team_slug: ghTeam.slug,
            github_members: memberLogins,
            github_members_synced_at: new Date().toISOString(),
          }),
          fgTeamId,
        ],
      );

      log.info({ team: ghTeam.slug, members: memberLogins.length }, 'GitHub team members synced');
    }
  } catch (err) {
    log.warn({ err }, 'GitHub team membership sync failed');
  }
}

// ============================================
// Slack User Groups mapping
// ============================================

export async function syncSlackUserGroups(companyId: string): Promise<void> {
  const log = logger.child({ companyId, job: 'slack-usergroup-sync' });

  const integration = await integrationService.getActive(companyId, 'slack');
  const botToken = (integration?.token_data as Record<string, string> | null)?.bot_token;

  if (!botToken) {
    log.debug('No Slack bot token available');
    return;
  }

  const client = new WebClient(botToken);

  try {
    const { usergroups } = await client.usergroups.list({ include_users: true });
    if (!usergroups) return;

    for (const group of usergroups) {
      if (!group.handle || group.date_delete) continue;

      // Match to FlowGuard team by handle or settings
      const fgTeamResult = await query<{ id: string }>(
        `SELECT id FROM teams
         WHERE company_id = $1
           AND (settings->>'slack_usergroup_handle' = $2 OR LOWER(slug) = LOWER($2))
         LIMIT 1`,
        [companyId, group.handle],
      );

      if (fgTeamResult.rows.length === 0) continue;
      const fgTeamId = fgTeamResult.rows[0].id;

      await query(
        `UPDATE teams
         SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [
          JSON.stringify({
            slack_usergroup_handle: group.handle,
            slack_usergroup_id: group.id,
            slack_usergroup_users: group.users || [],
            slack_usergroup_synced_at: new Date().toISOString(),
          }),
          fgTeamId,
        ],
      );

      log.info({ handle: group.handle, users: (group.users || []).length }, 'Slack user group synced');
    }
  } catch (err) {
    log.warn({ err }, 'Slack user groups sync failed');
  }
}
