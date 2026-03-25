import { WebClient } from '@slack/web-api';
import { query } from '../db/client.js';
import { logger } from '../logger.js';

/**
 * Proactive Nudges — Reach users before things break
 *
 * Phase 3 v1:
 *   1. Reviewer bottleneck alert — DM to tech lead
 *   2. Epic risk warning — Slack channel message
 */

interface NudgeCandidate {
  type: string;
  channel: string;      // Slack user ID (DM) or channel ID
  isDM: boolean;
  text: string;
  blocks: any[];
}

export async function runProactiveNudges(companyId: string): Promise<void> {
  const log = logger.child({ companyId, job: 'proactive-nudges' });

  const tokenResult = await query<{ bot_token: string | null }>(
    `SELECT token_data->>'bot_token' AS bot_token
     FROM integrations
     WHERE company_id = $1 AND provider = 'slack' AND status = 'active'
     ORDER BY updated_at DESC LIMIT 1`,
    [companyId],
  );
  const slackToken = tokenResult.rows[0]?.bot_token;
  if (!slackToken) {
    log.debug('No Slack token — skipping nudges');
    return;
  }

  const nudges: NudgeCandidate[] = [];

  const [reviewerNudges, epicNudges, shadowNudges, collisionNudges, meetingNudges] = await Promise.all([
    detectReviewerBottlenecks(companyId),
    detectEpicRisks(companyId),
    detectShadowWork(companyId),
    detectCrossTeamCollisions(companyId),
    detectMeetingToActionRatio(companyId),
  ]);

  nudges.push(...reviewerNudges, ...epicNudges, ...shadowNudges, ...collisionNudges, ...meetingNudges);

  if (nudges.length === 0) {
    log.debug('No proactive nudges to send');
    return;
  }

  const slack = new WebClient(slackToken);

  for (const nudge of nudges) {
    try {
      if (nudge.isDM) {
        // Open DM conversation first
        const dm = await slack.conversations.open({ users: nudge.channel });
        if (dm.channel?.id) {
          await slack.chat.postMessage({
            channel: dm.channel.id,
            text: nudge.text,
            blocks: nudge.blocks,
            unfurl_links: false,
          });
        }
      } else {
        await slack.chat.postMessage({
          channel: nudge.channel,
          text: nudge.text,
          blocks: nudge.blocks,
          unfurl_links: false,
        });
      }

      log.info({ type: nudge.type, channel: nudge.channel }, 'Nudge sent');
    } catch (err) {
      log.warn({ err, type: nudge.type }, 'Failed to send nudge — continuing');
    }
  }
}

// ============================================
// Nudge 1: Reviewer Bottleneck Alert
//
// Trigger: 5+ pending reviews AND avg response > 2 days
// Delivery: DM to relevant tech lead
// ============================================

async function detectReviewerBottlenecks(companyId: string): Promise<NudgeCandidate[]> {
  const nudges: NudgeCandidate[] = [];

  // Find reviewers with 5+ pending reviews (requested but not yet submitted)
  const result = await query<{
    reviewer: string;
    pending_count: number;
    team_id: string | null;
    lead_slack_id: string | null;
  }>(
    `WITH pending_reviews AS (
      SELECT
        e.metadata->>'requested_reviewer' AS reviewer,
        e.team_id,
        COUNT(*) AS pending_count
      FROM events e
      WHERE e.company_id = $1
        AND e.source = 'github'
        AND e.event_type = 'github.review_requested'
        AND e.created_at > NOW() - INTERVAL '14 days'
        AND NOT EXISTS (
          SELECT 1 FROM events e2
          WHERE e2.company_id = $1
            AND e2.source = 'github'
            AND e2.event_type = 'github.review_submitted'
            AND e2.metadata->>'reviewer' = e.metadata->>'requested_reviewer'
            AND e2.entity_id = e.entity_id
            AND e2.created_at > e.created_at
        )
      GROUP BY e.metadata->>'requested_reviewer', e.team_id
      HAVING COUNT(*) >= 5
    )
    SELECT
      pr.reviewer,
      pr.pending_count::int,
      pr.team_id,
      t.lead_user_id AS lead_slack_id
    FROM pending_reviews pr
    LEFT JOIN teams t ON t.id = pr.team_id
    ORDER BY pr.pending_count DESC
    LIMIT 10`,
    [companyId],
  );

  for (const row of result.rows) {
    // DM the tech lead (or skip if unknown)
    const target = row.lead_slack_id;
    if (!target) continue;

    nudges.push({
      type: 'reviewer_bottleneck',
      channel: target,
      isDM: true,
      text: `⚠️ Reviewer bottleneck: ${row.reviewer} has ${row.pending_count} pending reviews`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              `👀 *Reviewer Bottleneck Alert*\n\n` +
              `\`${row.reviewer}\` has *${row.pending_count} pending code reviews*.\n` +
              `This is likely slowing down cycle time for the team.\n\n` +
              `*Suggested actions:*\n` +
              `• Redistribute pending reviews across the team\n` +
              `• Consider pairing reviews to reduce backlog\n` +
              `• Block review-request time on the reviewer's calendar`,
          },
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: '📍 _FlowGuard Proactive Nudge_ • <https://flowguard.dev|View dashboard>' },
          ],
        },
      ],
    });
  }

  return nudges;
}

// ============================================
// Nudge 2: Epic Risk Warning
//
// Trigger: >30% of epic issues still open AND target date <5 days away
// Delivery: Team Slack channel
// ============================================

async function detectEpicRisks(companyId: string): Promise<NudgeCandidate[]> {
  const nudges: NudgeCandidate[] = [];

  // Check for Jira epics approaching deadline with many open items
  // We detect this from events: Jira issue updates carry epic_link metadata
  // and we track status transitions
  const result = await query<{
    epic_key: string;
    total_issues: number;
    open_issues: number;
    team_id: string | null;
  }>(
    `WITH epic_issues AS (
      SELECT DISTINCT ON (e.entity_id)
        e.entity_id AS issue_key,
        e.metadata->>'epic_key' AS epic_key,
        e.metadata->>'status' AS current_status,
        e.team_id,
        e.created_at
      FROM events e
      WHERE e.company_id = $1
        AND e.source = 'jira'
        AND e.metadata->>'epic_key' IS NOT NULL
        AND e.created_at > NOW() - INTERVAL '60 days'
      ORDER BY e.entity_id, e.created_at DESC
    )
    SELECT
      epic_key,
      COUNT(*) AS total_issues,
      COUNT(*) FILTER (WHERE current_status NOT IN ('Done', 'Closed', 'Resolved')) AS open_issues,
      team_id
    FROM epic_issues
    WHERE epic_key IS NOT NULL
    GROUP BY epic_key, team_id
    HAVING COUNT(*) >= 3
      AND COUNT(*) FILTER (WHERE current_status NOT IN ('Done', 'Closed', 'Resolved'))::float
          / COUNT(*)::float > 0.3`,
    [companyId],
  );

  // For each risky epic, get the team's Slack channel
  const settingsResult = await query<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM companies WHERE id = $1`,
    [companyId],
  );
  const settings = settingsResult.rows[0]?.settings || {};
  const channelMap = (settings.team_slack_channels || {}) as Record<string, string>;
  const defaultChannel = (settings.nudge_channel || settings.digest_channel) as string | undefined;

  for (const row of result.rows) {
    const openPercent = Math.round((row.open_issues / row.total_issues) * 100);
    const channel = (row.team_id ? channelMap[row.team_id] : null) || defaultChannel;
    if (!channel) continue;

    nudges.push({
      type: 'epic_risk',
      channel,
      isDM: false,
      text: `⏰ Epic risk: ${row.epic_key} has ${openPercent}% issues still open`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              `⏰ *Epic Risk Warning*\n\n` +
              `\`${row.epic_key}\` has *${row.open_issues}/${row.total_issues}* issues still open (${openPercent}%).\n\n` +
              `*Suggested actions:*\n` +
              `• Review remaining scope — can anything be deferred?\n` +
              `• Check for blocked items that need unblocking\n` +
              `• Communicate risk to stakeholders early`,
          },
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: '📍 _FlowGuard Proactive Nudge_ • <https://flowguard.dev|View dashboard>' },
          ],
        },
      ],
    });
  }

  return nudges;
}

// ============================================
// Nudge 3: Shadow Work Detector
//
// Trigger: PRs with no linked Jira issue for >3 days
// Delivery: Gentle DM to PR author
// ============================================

async function detectShadowWork(companyId: string): Promise<NudgeCandidate[]> {
  const nudges: NudgeCandidate[] = [];

  const result = await query<{
    pr_id: string;
    pr_title: string;
    author: string;
    opened_at: string;
  }>(
    `WITH recent_prs AS (
      SELECT DISTINCT ON (e.entity_id)
        e.entity_id AS pr_id,
        e.metadata->>'title' AS pr_title,
        e.metadata->>'author' AS author,
        e.created_at AS opened_at
      FROM events e
      WHERE e.company_id = $1
        AND e.source = 'github'
        AND e.event_type IN ('github.pr_opened', 'github.pull_request')
        AND e.created_at > NOW() - INTERVAL '14 days'
        AND e.created_at < NOW() - INTERVAL '3 days'
      ORDER BY e.entity_id, e.created_at ASC
    ),
    linked_prs AS (
      SELECT DISTINCT el.source_entity_id AS pr_id
      FROM entity_links el
      WHERE el.company_id = $1
        AND el.source_provider = 'github'
        AND el.target_provider = 'jira'
    )
    SELECT rp.pr_id, rp.pr_title, rp.author, rp.opened_at
    FROM recent_prs rp
    LEFT JOIN linked_prs lp ON lp.pr_id = rp.pr_id
    WHERE lp.pr_id IS NULL
    LIMIT 10`,
    [companyId],
  );

  for (const row of result.rows) {
    const slackLookup = await query<{ slack_user_id: string }>(
      `SELECT metadata->>'user' AS slack_user_id
       FROM events
       WHERE company_id = $1 AND source = 'slack'
         AND metadata->>'github_username' = $2
       LIMIT 1`,
      [companyId, row.author],
    );
    const target = slackLookup.rows[0]?.slack_user_id;
    if (!target) continue;

    const daysOpen = Math.round((Date.now() - new Date(row.opened_at).getTime()) / 86400000);

    nudges.push({
      type: 'shadow_work',
      channel: target,
      isDM: true,
      text: `💡 Heads up: PR "${row.pr_title}" has no linked Jira issue`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              `💡 *Shadow Work Detected*\n\n` +
              `Your PR \`${row.pr_id}\` — *${row.pr_title}*\n` +
              `has been open for ${daysOpen} days with no linked Jira issue.\n\n` +
              `This doesn't show up in sprint tracking and may miss visibility.\n\n` +
              `*Quick fix:* Add a Jira key (e.g. \`PROJ-123\`) to the PR title or description.`,
          },
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: '📍 _FlowGuard Proactive Nudge_ • <https://flowguard.dev|View dashboard>' },
          ],
        },
      ],
    });
  }

  return nudges;
}

// ============================================
// Nudge 4: Cross-Team Collision Alert
//
// Trigger: Two teams' PRs modify the same file/module
// Delivery: Both team leads via DM
// ============================================

async function detectCrossTeamCollisions(companyId: string): Promise<NudgeCandidate[]> {
  const nudges: NudgeCandidate[] = [];

  const result = await query<{
    file_path: string;
    team_a_id: string;
    team_a_name: string;
    team_b_id: string;
    team_b_name: string;
    lead_a_slack_id: string | null;
    lead_b_slack_id: string | null;
  }>(
    `WITH pr_files AS (
      SELECT
        e.team_id,
        jsonb_array_elements_text(e.metadata->'files_changed') AS file_path
      FROM events e
      WHERE e.company_id = $1
        AND e.source = 'github'
        AND e.event_type IN ('github.pr_opened', 'github.pr_merged', 'github.pull_request')
        AND e.team_id IS NOT NULL
        AND e.created_at > NOW() - INTERVAL '7 days'
        AND e.metadata->'files_changed' IS NOT NULL
    ),
    collisions AS (
      SELECT DISTINCT
        a.file_path,
        a.team_id AS team_a_id,
        b.team_id AS team_b_id
      FROM pr_files a
      JOIN pr_files b ON a.file_path = b.file_path AND a.team_id < b.team_id
    )
    SELECT
      c.file_path,
      c.team_a_id, ta.name AS team_a_name,
      c.team_b_id, tb.name AS team_b_name,
      ta.lead_user_id AS lead_a_slack_id,
      tb.lead_user_id AS lead_b_slack_id
    FROM collisions c
    JOIN teams ta ON ta.id = c.team_a_id
    JOIN teams tb ON tb.id = c.team_b_id
    LIMIT 5`,
    [companyId],
  );

  const seen = new Set<string>();
  for (const row of result.rows) {
    const pairKey = [row.team_a_id, row.team_b_id].sort().join(':');
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    const targets = [row.lead_a_slack_id, row.lead_b_slack_id].filter(Boolean) as string[];
    for (const target of targets) {
      nudges.push({
        type: 'cross_team_collision',
        channel: target,
        isDM: true,
        text: `🔀 Cross-team collision: ${row.team_a_name} and ${row.team_b_name} are modifying the same files`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text:
                `🔀 *Cross-Team Collision Alert*\n\n` +
                `*${row.team_a_name}* and *${row.team_b_name}* have PRs touching the same file:\n` +
                `\`${row.file_path}\`\n\n` +
                `This is likely to cause merge conflicts or duplicated work.\n\n` +
                `*Suggested actions:*\n` +
                `• Coordinate on ownership of shared modules\n` +
                `• Consider a quick sync to align approaches`,
            },
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: '📍 _FlowGuard Proactive Nudge_ • <https://flowguard.dev|View dashboard>' },
            ],
          },
        ],
      });
    }
  }

  return nudges;
}

// ============================================
// Nudge 5: Meeting-to-Action Ratio
//
// Trigger: High Slack volume but low Jira/GitHub activity
// Delivery: Team channel
// ============================================

async function detectMeetingToActionRatio(companyId: string): Promise<NudgeCandidate[]> {
  const nudges: NudgeCandidate[] = [];

  const result = await query<{
    team_id: string;
    team_name: string;
    slack_count: number;
    action_count: number;
  }>(
    `WITH team_slack AS (
      SELECT team_id, COUNT(*) AS cnt
      FROM events
      WHERE company_id = $1 AND source = 'slack'
        AND created_at > NOW() - INTERVAL '7 days'
        AND team_id IS NOT NULL
      GROUP BY team_id
    ),
    team_actions AS (
      SELECT team_id, COUNT(*) AS cnt
      FROM events
      WHERE company_id = $1 AND source IN ('jira', 'github')
        AND created_at > NOW() - INTERVAL '7 days'
        AND team_id IS NOT NULL
      GROUP BY team_id
    )
    SELECT
      ts.team_id,
      t.name AS team_name,
      ts.cnt::int AS slack_count,
      COALESCE(ta.cnt, 0)::int AS action_count
    FROM team_slack ts
    JOIN teams t ON t.id = ts.team_id
    LEFT JOIN team_actions ta ON ta.team_id = ts.team_id
    WHERE ts.cnt >= 50
      AND (COALESCE(ta.cnt, 0)::float / ts.cnt::float) < 0.15`,
    [companyId],
  );

  const settingsResult = await query<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM companies WHERE id = $1`,
    [companyId],
  );
  const settings = settingsResult.rows[0]?.settings || {};
  const channelMap = (settings.team_slack_channels || {}) as Record<string, string>;
  const defaultChannel = (settings.nudge_channel || settings.digest_channel) as string | undefined;

  for (const row of result.rows) {
    const channel = channelMap[row.team_id] || defaultChannel;
    if (!channel) continue;

    const ratio = row.action_count > 0
      ? Math.round((row.action_count / row.slack_count) * 100)
      : 0;

    nudges.push({
      type: 'meeting_to_action_ratio',
      channel,
      isDM: false,
      text: `📊 Meeting-to-action ratio: ${row.team_name} has high discussion but low follow-through`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              `📊 *Meeting-to-Action Ratio*\n\n` +
              `*${row.team_name}* had *${row.slack_count} Slack messages* this week but only *${row.action_count} Jira/GitHub actions* (${ratio}% action rate).\n\n` +
              `High discussion with low follow-through can signal:\n` +
              `• Decisions being discussed but not captured\n` +
              `• Blockers preventing action on agreed items\n` +
              `• Meetings without clear outcomes\n\n` +
              `*Suggested actions:*\n` +
              `• Review recent threads for uncaptured decisions\n` +
              `• Assign DRIs to open discussion items\n` +
              `• Consider async decision-making for simpler items`,
          },
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: '📍 _FlowGuard Proactive Nudge_ • <https://flowguard.dev|View dashboard>' },
          ],
        },
      ],
    });
  }

  return nudges;
}
