import { query } from '@flowguard/db';
import { adapterRegistry } from '@flowguard/adapter-sdk';
import { logger } from '../logger.js';

/**
 * Morning Team Pulse — per-team daily Slack summary.
 *
 * Migrated from apps/worker/src/services/morning-pulse.ts.
 * Key changes:
 *   - Uses `@flowguard/db` query() instead of local db client
 *   - Slack delivery uses `adapterRegistry.executeAction()` instead of WebClient
 *
 * All business logic preserved from the original implementation.
 */

interface TeamRow {
  id: string;
  name: string;
  slug: string;
  color: string | null;
}

interface PulseData {
  openPRs: number;
  stalePRs: { entityId: string; days: number }[];
  activeLeaks: { ruleKey: string; severity: number; title: string }[];
  recentDecisions: { title: string; status: string }[];
  eventCount24h: number;
}

export async function runMorningPulse(companyId: string): Promise<void> {
  const log = logger.child({ companyId, job: 'morning-pulse' });

  // Get all teams
  const teamsResult = await query<TeamRow>(
    `SELECT id, name, slug, color FROM teams WHERE company_id = $1 ORDER BY name`,
    [companyId],
  );

  if (teamsResult.rows.length === 0) {
    log.debug('No teams configured — skipping morning pulse');
    return;
  }

  // Get the Slack channel mapping from company settings
  const settingsResult = await query<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM companies WHERE id = $1`,
    [companyId],
  );
  const settings = settingsResult.rows[0]?.settings || {};
  const channelMap = (settings.team_slack_channels || {}) as Record<string, string>;
  const defaultChannel = (settings.pulse_channel || settings.digest_channel) as string | undefined;

  for (const team of teamsResult.rows) {
    const channel = channelMap[team.id] || channelMap[team.slug] || defaultChannel;
    if (!channel) {
      log.debug({ team: team.slug }, 'No Slack channel for team — skipping');
      continue;
    }

    try {
      const data = await gatherTeamPulseData(companyId, team.id);
      const blocks = buildPulseBlocks(team, data);

      if (blocks.length === 0) {
        log.debug({ team: team.slug }, 'Empty pulse — skipping');
        continue;
      }

      if (adapterRegistry.has('slack')) {
        await adapterRegistry.executeAction({
          provider: 'slack',
          actionType: 'post_message',
          targetId: channel,
          companyId,
          payload: {
            text: `Morning pulse for ${team.name}`,
            blocks,
            unfurl_links: false,
          },
          riskLevel: 'low',
          metadata: { digest_type: 'morning_pulse', team_id: team.id },
        });
        log.info({ team: team.slug, channel }, 'Team pulse posted');
      } else {
        log.warn('Slack adapter not registered — cannot deliver morning pulse');
      }
    } catch (err) {
      log.warn({ err, team: team.slug }, 'Failed to post team pulse — continuing');
    }
  }
}

async function gatherTeamPulseData(companyId: string, teamId: string): Promise<PulseData> {
  const [openPRsResult, activeLeaksResult, recentDecisionsResult, eventCountResult] = await Promise.all([
    query<{ entity_id: string; days: number }>(
      `SELECT DISTINCT ON (e.entity_id)
        e.entity_id,
        EXTRACT(DAY FROM NOW() - e.created_at)::int AS days
       FROM events e
       WHERE e.company_id = $1 AND e.team_id = $2
         AND e.source = 'github' AND e.event_type = 'github.pr_opened'
         AND e.created_at > NOW() - INTERVAL '30 days'
         AND NOT EXISTS (
           SELECT 1 FROM events e2
           WHERE e2.company_id = $1 AND e2.source = 'github'
             AND e2.event_type IN ('github.pr_merged', 'github.pr_closed')
             AND e2.entity_id = e.entity_id
             AND e2.created_at > e.created_at
         )
       ORDER BY e.entity_id, e.created_at DESC`,
      [companyId, teamId],
    ),

    query<{ rule_key: string; severity: number; title: string }>(
      `SELECT rule_key, severity, title FROM leak_instances
       WHERE company_id = $1 AND team_id = $2
         AND status IN ('new', 'active', 'acknowledged')
       ORDER BY severity DESC LIMIT 5`,
      [companyId, teamId],
    ),

    query<{ title: string; status: string }>(
      `SELECT title, status FROM ledger_commits
       WHERE company_id = $1 AND team_id = $2
         AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC LIMIT 3`,
      [companyId, teamId],
    ),

    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM events
       WHERE company_id = $1 AND team_id = $2
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [companyId, teamId],
    ),
  ]);

  const mappedPRs = openPRsResult.rows.map((pr) => ({ entityId: pr.entity_id, days: pr.days }));
  const stalePRs = mappedPRs.filter((pr) => pr.days >= 3);

  return {
    openPRs: openPRsResult.rows.length,
    stalePRs,
    activeLeaks: activeLeaksResult.rows.map((leak) => ({ ruleKey: leak.rule_key, severity: leak.severity, title: leak.title })),
    recentDecisions: recentDecisionsResult.rows,
    eventCount24h: parseInt(eventCountResult.rows[0]?.count || '0', 10),
  };
}

function buildPulseBlocks(team: TeamRow, data: PulseData): Array<Record<string, unknown>> {
  if (data.openPRs === 0 && data.activeLeaks.length === 0 && data.recentDecisions.length === 0 && data.eventCount24h === 0) {
    return [];
  }

  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Morning Pulse — ${team.name}`, emoji: true },
    },
  ];

  const lines: string[] = [];

  if (data.openPRs > 0) {
    lines.push(`*${data.openPRs} open PR${data.openPRs > 1 ? 's' : ''}*`);
    if (data.stalePRs.length > 0) {
      for (const pr of data.stalePRs.slice(0, 3)) {
        lines.push(`  \`${pr.entityId}\` — open ${pr.days}d`);
      }
    }
  }

  if (data.activeLeaks.length > 0) {
    lines.push(`*${data.activeLeaks.length} active leak${data.activeLeaks.length > 1 ? 's' : ''}*`);
    for (const leak of data.activeLeaks.slice(0, 3)) {
      lines.push(`  ${leak.ruleKey} (severity ${leak.severity})`);
    }
  }

  if (data.recentDecisions.length > 0) {
    lines.push(`*${data.recentDecisions.length} new decision${data.recentDecisions.length > 1 ? 's' : ''}*`);
    for (const d of data.recentDecisions) {
      lines.push(`  ${d.title} [${d.status}]`);
    }
  }

  if (data.eventCount24h > 0) {
    lines.push(`${data.eventCount24h} events in last 24h`);
  }

  if (lines.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: lines.join('\n') },
    });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_FlowGuard Morning Pulse_ · <https://flowguard.dev|View dashboard>' }],
    },
  );

  return blocks;
}
