import { query } from '@flowguard/db';
import { adapterRegistry } from '@flowguard/adapter-sdk';
import { logger } from '../logger.js';

/**
 * Sprint Retrospective Auto-Generation
 *
 * Migrated from apps/worker/src/services/sprint-retro.ts.
 * Key changes:
 *   - Uses `@flowguard/db` query() instead of local db client
 *   - Slack delivery uses `adapterRegistry.executeAction()` instead of WebClient
 *
 * All business logic preserved:
 *   Sections: What went well | What didn't | Patterns | Suggested actions
 *   Delivery: Slack channel per team + ledger commit
 */

interface RetroData {
  teamId: string;
  teamName: string;
  slackChannel: string | null;
  metrics: {
    cycleTime: { current: number; previous: number } | null;
    prReviewTime: { current: number; previous: number } | null;
    leakCount: { current: number; previous: number };
  };
  resolvedLeaks: Array<{ leak_type: string; title: string; severity: number }>;
  newLeaks: Array<{ leak_type: string; title: string; severity: number }>;
  decisions: Array<{ title: string; status: string }>;
  topEvents: Array<{ event_type: string; count: number }>;
}

export async function runSprintRetrospective(companyId: string): Promise<void> {
  const log = logger.child({ companyId, job: 'sprint-retro' });

  // Get all active teams
  const teamsResult = await query<{ id: string; name: string }>(
    `SELECT id, name FROM teams WHERE company_id = $1 AND status = 'active'`,
    [companyId],
  );

  if (teamsResult.rows.length === 0) {
    log.debug('No active teams — skipping sprint retro');
    return;
  }

  // Get team -> channel mapping from company settings
  const settingsResult = await query<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM companies WHERE id = $1`,
    [companyId],
  );
  const settings = settingsResult.rows[0]?.settings || {};
  const channelMap = (settings.team_slack_channels || {}) as Record<string, string>;

  for (const team of teamsResult.rows) {
    try {
      const retro = await generateTeamRetro(companyId, team.id, team.name, channelMap[team.id] || null);
      if (!retro) continue;

      // Post to Slack via adapter registry
      if (retro.slackChannel && adapterRegistry.has('slack')) {
        const blocks = buildRetroBlocks(retro);
        await adapterRegistry.executeAction({
          provider: 'slack',
          actionType: 'post_message',
          targetId: retro.slackChannel,
          companyId,
          payload: {
            text: `Sprint Retro — ${retro.teamName}`,
            blocks,
            unfurl_links: false,
          },
          riskLevel: 'low',
          metadata: { digest_type: 'sprint_retro', team_id: team.id },
        });
        log.info({ teamId: team.id, channel: retro.slackChannel }, 'Sprint retro posted');
      }

      // Create ledger commit
      await createRetroLedgerCommit(companyId, retro);
    } catch (err) {
      log.warn({ err, teamId: team.id }, 'Failed to generate sprint retro for team');
    }
  }
}

async function generateTeamRetro(
  companyId: string,
  teamId: string,
  teamName: string,
  slackChannel: string | null,
): Promise<RetroData | null> {
  const sprintDays = 14;

  const [metricsResult, resolvedLeaksResult, newLeaksResult, decisionsResult, eventsResult] =
    await Promise.all([
      query<{ metric_name: string; period: string; avg_value: number }>(
        `SELECT
           metric_name,
           CASE WHEN date > NOW() - ($3::int * INTERVAL '1 day') THEN 'current' ELSE 'previous' END AS period,
           AVG(value) AS avg_value
         FROM metric_snapshots
         WHERE company_id = $1
           AND scope = 'team' AND scope_id = $2
           AND date > NOW() - ($4::int * INTERVAL '1 day')
           AND metric_name IN ('cycle_time', 'pr_review_time')
         GROUP BY metric_name, period`,
        [companyId, teamId, sprintDays, sprintDays * 2],
      ),

      query<{ leak_type: string; title: string; severity: number }>(
        `SELECT leak_type, title, severity
         FROM leak_instances
         WHERE company_id = $1 AND team_id = $2
           AND status = 'resolved'
           AND updated_at > NOW() - ($3::int * INTERVAL '1 day')
         ORDER BY severity DESC LIMIT 10`,
        [companyId, teamId, sprintDays],
      ),

      query<{ leak_type: string; title: string; severity: number }>(
        `SELECT leak_type, title, severity
         FROM leak_instances
         WHERE company_id = $1 AND team_id = $2
           AND created_at > NOW() - ($3::int * INTERVAL '1 day')
         ORDER BY severity DESC LIMIT 10`,
        [companyId, teamId, sprintDays],
      ),

      query<{ title: string; status: string }>(
        `SELECT title, status
         FROM ledger_commits
         WHERE company_id = $1 AND team_id = $2
           AND created_at > NOW() - ($3::int * INTERVAL '1 day')
         ORDER BY created_at DESC LIMIT 15`,
        [companyId, teamId, sprintDays],
      ),

      query<{ event_type: string; count: number }>(
        `SELECT event_type, COUNT(*)::int AS count
         FROM events
         WHERE company_id = $1 AND team_id = $2
           AND created_at > NOW() - ($3::int * INTERVAL '1 day')
         GROUP BY event_type
         ORDER BY count DESC LIMIT 5`,
        [companyId, teamId, sprintDays],
      ),
    ]);

  const metricMap: Record<string, Record<string, number>> = {};
  for (const row of metricsResult.rows) {
    if (!metricMap[row.metric_name]) metricMap[row.metric_name] = {};
    metricMap[row.metric_name][row.period] = Number(row.avg_value);
  }

  return {
    teamId,
    teamName,
    slackChannel,
    metrics: {
      cycleTime: metricMap.cycle_time
        ? { current: metricMap.cycle_time.current ?? 0, previous: metricMap.cycle_time.previous ?? 0 }
        : null,
      prReviewTime: metricMap.pr_review_time
        ? { current: metricMap.pr_review_time.current ?? 0, previous: metricMap.pr_review_time.previous ?? 0 }
        : null,
      leakCount: {
        current: newLeaksResult.rows.length,
        previous: 0,
      },
    },
    resolvedLeaks: resolvedLeaksResult.rows,
    newLeaks: newLeaksResult.rows,
    decisions: decisionsResult.rows,
    topEvents: eventsResult.rows,
  };
}

function buildRetroBlocks(retro: RetroData): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Sprint Retro — ${retro.teamName}` },
    },
    { type: 'divider' },
  ];

  // What went well
  const wellItems: string[] = [];
  if (retro.resolvedLeaks.length > 0) {
    wellItems.push(`Resolved *${retro.resolvedLeaks.length} leak${retro.resolvedLeaks.length > 1 ? 's' : ''}*`);
  }
  if (retro.metrics.cycleTime && retro.metrics.cycleTime.current < retro.metrics.cycleTime.previous) {
    const pct = Math.round(
      ((retro.metrics.cycleTime.previous - retro.metrics.cycleTime.current) / retro.metrics.cycleTime.previous) * 100,
    );
    wellItems.push(`Cycle time improved by *${pct}%*`);
  }
  if (retro.metrics.prReviewTime && retro.metrics.prReviewTime.current < retro.metrics.prReviewTime.previous) {
    const pct = Math.round(
      ((retro.metrics.prReviewTime.previous - retro.metrics.prReviewTime.current) / retro.metrics.prReviewTime.previous) * 100,
    );
    wellItems.push(`PR review time improved by *${pct}%*`);
  }
  const mergedDecisions = retro.decisions.filter((d) => d.status === 'merged');
  if (mergedDecisions.length > 0) {
    wellItems.push(`Merged *${mergedDecisions.length} decision${mergedDecisions.length > 1 ? 's' : ''}*`);
  }

  if (wellItems.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*What went well*\n${wellItems.join('\n')}` },
    });
  }

  // What didn't go well
  const badItems: string[] = [];
  if (retro.newLeaks.length > 0) {
    const highSeverity = retro.newLeaks.filter((l) => l.severity >= 70);
    badItems.push(
      `*${retro.newLeaks.length} new leak${retro.newLeaks.length > 1 ? 's' : ''}* detected` +
      (highSeverity.length > 0 ? ` (${highSeverity.length} high severity)` : ''),
    );
  }
  if (retro.metrics.cycleTime && retro.metrics.cycleTime.current > retro.metrics.cycleTime.previous * 1.1) {
    const pct = Math.round(
      ((retro.metrics.cycleTime.current - retro.metrics.cycleTime.previous) / retro.metrics.cycleTime.previous) * 100,
    );
    badItems.push(`Cycle time increased by *${pct}%*`);
  }

  if (badItems.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*What didn't go well*\n${badItems.join('\n')}` },
    });
  }

  // Patterns
  const patterns: string[] = [];
  if (retro.topEvents.length > 0) {
    const top = retro.topEvents[0];
    patterns.push(`Most active signal: *${top.event_type}* (${top.count} events)`);
  }
  const leakTypes = new Set(retro.newLeaks.map((l) => l.leak_type));
  if (leakTypes.size > 0) {
    patterns.push(`Leak types: ${[...leakTypes].join(', ')}`);
  }

  if (patterns.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Patterns*\n${patterns.join('\n')}` },
    });
  }

  // Suggested actions
  const actions: string[] = [];
  const unresolvedHighLeaks = retro.newLeaks.filter((l) => l.severity >= 60);
  if (unresolvedHighLeaks.length > 0) {
    actions.push(`- Prioritize resolving *${unresolvedHighLeaks[0].title}* (severity ${unresolvedHighLeaks[0].severity})`);
  }
  if (retro.metrics.prReviewTime && retro.metrics.prReviewTime.current > retro.metrics.prReviewTime.previous * 1.2) {
    actions.push('- Consider review pairing to reduce PR review backlog');
  }
  if (retro.decisions.filter((d) => d.status === 'draft').length > 3) {
    actions.push('- Several draft decisions — schedule a decision review session');
  }

  if (actions.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Suggested actions*\n${actions.join('\n')}` },
    });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `_FlowGuard Sprint Retro_ · Auto-generated from your team's metadata · <https://flowguard.dev|View dashboard>` },
      ],
    },
  );

  return blocks;
}

async function createRetroLedgerCommit(companyId: string, retro: RetroData): Promise<void> {
  const summary = [
    retro.resolvedLeaks.length > 0 ? `Resolved ${retro.resolvedLeaks.length} leaks.` : null,
    retro.newLeaks.length > 0 ? `${retro.newLeaks.length} new leaks detected.` : null,
    retro.decisions.length > 0 ? `${retro.decisions.length} decisions recorded.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  await query(
    `INSERT INTO ledger_commits (
       company_id, commit_type, title, summary, status,
       branch_name, scope_level, team_id, tags, created_by
     ) VALUES (
       $1, 'decision', $2, $3, 'merged',
       $4, 'team', $5, $6, 'system:sprint-retro'
     )`,
    [
      companyId,
      `Sprint Retro — ${retro.teamName}`,
      summary,
      `retro/${retro.teamId}`,
      retro.teamId,
      JSON.stringify(['auto-retro', 'sprint']),
    ],
  );
}
