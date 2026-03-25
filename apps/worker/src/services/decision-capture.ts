import { WebClient } from '@slack/web-api';
import { query } from '../db/client.js';
import { logger } from '../logger.js';

/**
 * Decision Capture Prompt — Detect long Slack threads with no resolution
 *
 * Trigger: 20+ message thread with no linked Jira ticket or ledger commit
 *          AND thread is older than 48h
 * Delivery: Slack DM to the thread starter
 * Purpose: Capture decisions before they drift and are lost
 *
 * Design spec §9.3 — Tier 3 nudge: "Decision drift detector"
 */

interface DriftingThread {
  channel_id: string;
  thread_ts: string;
  message_count: number;
  thread_starter: string;       // Slack user_id
  first_message_at: string;     // ISO timestamp
  channel_name: string | null;
}

export async function runDecisionCapture(companyId: string): Promise<void> {
  const log = logger.child({ companyId, job: 'decision-capture' });

  // Get Slack token
  const tokenResult = await query<{ bot_token: string | null }>(
    `SELECT token_data->>'bot_token' AS bot_token
     FROM integrations
     WHERE company_id = $1 AND provider = 'slack' AND status = 'active'
     ORDER BY updated_at DESC LIMIT 1`,
    [companyId],
  );
  const slackToken = tokenResult.rows[0]?.bot_token;
  if (!slackToken) {
    log.debug('No Slack token — skipping decision capture');
    return;
  }

  // Check if feature is enabled (default: on)
  const settingsResult = await query<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM companies WHERE id = $1`,
    [companyId],
  );
  const settings = settingsResult.rows[0]?.settings || {};
  const enabledFeatures = (settings.ai_enabled_features || {}) as Record<string, boolean>;
  if (enabledFeatures.decision_capture === false) {
    log.debug('Decision capture disabled by company settings');
    return;
  }

  const threads = await detectDriftingThreads(companyId);

  if (threads.length === 0) {
    log.debug('No drifting threads detected');
    return;
  }

  log.info({ count: threads.length }, 'Drifting threads detected — sending capture prompts');

  const slack = new WebClient(slackToken);

  for (const thread of threads) {
    try {
      await sendCapturePrompt(slack, companyId, thread);
      log.info(
        { channel: thread.channel_id, thread_ts: thread.thread_ts, user: thread.thread_starter },
        'Decision capture prompt sent',
      );
    } catch (err) {
      log.warn({ err, channel: thread.channel_id, thread_ts: thread.thread_ts }, 'Failed to send capture prompt');
    }
  }
}

/**
 * Find Slack threads that:
 *   1. Have 20+ messages
 *   2. Are older than 48 hours
 *   3. Have NOT been resolved (no ✅ reaction)
 *   4. Have NO linked Jira ticket (entity_links)
 *   5. Have NO linked ledger commit (ledger_edges)
 *   6. Haven't already received a prompt (tracked via events table to avoid spamming)
 */
async function detectDriftingThreads(companyId: string): Promise<DriftingThread[]> {
  const result = await query<DriftingThread>(
    `WITH thread_stats AS (
      SELECT
        metadata->>'channel_id' AS channel_id,
        metadata->>'thread_ts' AS thread_ts,
        COUNT(*) FILTER (
          WHERE event_type IN ('slack.message', 'slack.thread_reply')
        ) AS message_count,
        -- The earliest user who posted in this thread entity
        (ARRAY_AGG(
          metadata->>'user_id'
          ORDER BY timestamp ASC
        ) FILTER (WHERE metadata->>'user_id' IS NOT NULL))[1] AS thread_starter,
        MIN(timestamp) AS first_message_at,
        MAX(metadata->>'channel_name') AS channel_name
      FROM events
      WHERE company_id = $1
        AND source = 'slack'
        AND event_type IN ('slack.message', 'slack.thread_reply', 'slack.thread_resolved')
        AND timestamp >= NOW() - INTERVAL '14 days'
      GROUP BY metadata->>'channel_id', metadata->>'thread_ts'
      HAVING
        -- 20+ messages
        COUNT(*) FILTER (
          WHERE event_type IN ('slack.message', 'slack.thread_reply')
        ) >= 20
        -- Thread started more than 48h ago
        AND MIN(timestamp) < NOW() - INTERVAL '48 hours'
        -- Not resolved
        AND BOOL_OR(event_type = 'slack.thread_resolved') IS NOT TRUE
    )
    SELECT ts.*
    FROM thread_stats ts
    WHERE ts.channel_id IS NOT NULL
      AND ts.thread_ts IS NOT NULL
      AND ts.thread_starter IS NOT NULL
      -- No linked Jira ticket in entity_links
      AND NOT EXISTS (
        SELECT 1 FROM entity_links el
        WHERE el.company_id = $1
          AND el.source_provider = 'slack'
          AND el.source_entity_id = ts.channel_id || ':' || ts.thread_ts
          AND el.target_provider = 'jira'
      )
      -- No linked ledger commit via ledger_edges
      AND NOT EXISTS (
        SELECT 1 FROM ledger_edges le
        JOIN ledger_commits lc ON lc.id = le.commit_id AND lc.company_id = $1
        WHERE le.company_id = $1
          AND le.target_type = 'event'
          AND le.target_id IN (
            SELECT id::text FROM events
            WHERE company_id = $1
              AND source = 'slack'
              AND entity_id = ts.channel_id || ':' || ts.thread_ts
            LIMIT 1
          )
      )
      -- Haven't already sent a capture prompt for this thread (prevent spam)
      AND NOT EXISTS (
        SELECT 1 FROM events e
        WHERE e.company_id = $1
          AND e.source = 'slack'
          AND e.event_type = 'flowguard.decision_capture_sent'
          AND e.entity_id = ts.channel_id || ':' || ts.thread_ts
          AND e.timestamp > NOW() - INTERVAL '7 days'
      )
    ORDER BY ts.message_count DESC
    LIMIT 10`,
    [companyId],
  );

  return result.rows;
}

/**
 * Send a Slack DM to the thread starter asking them to capture the decision.
 * Also record the nudge in the events table to prevent re-sending.
 */
async function sendCapturePrompt(slack: WebClient, companyId: string, thread: DriftingThread): Promise<void> {
  const threadToken = thread.thread_ts.replace('.', '');
  const threadUrl = `https://slack.com/archives/${thread.channel_id}/p${threadToken}`;
  const channelLabel = thread.channel_name ? `#${thread.channel_name}` : `channel`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          ':memo: *Decision Capture Prompt*',
          '',
          `A thread in ${channelLabel} has reached *${thread.message_count} messages* with no linked Jira ticket or decision record.`,
          '',
          `Long discussions often contain decisions that get lost. Consider capturing the outcome.`,
        ].join('\n'),
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${threadUrl}|View thread>*`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':ledger: Capture Decision', emoji: true },
          style: 'primary',
          url: `${process.env.APP_URL || 'https://app.flowguard.dev'}/app/ledger/new?source=slack&entity_id=${encodeURIComponent(`${thread.channel_id}:${thread.thread_ts}`)}`,
          action_id: 'decision_capture_click',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: ':white_check_mark: Already Resolved', emoji: true },
          action_id: 'decision_capture_dismiss',
          value: `${thread.channel_id}:${thread.thread_ts}`,
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '_FlowGuard detects long unresolved discussions so decisions don\'t get lost._',
        },
      ],
    },
  ];

  // Send DM to thread starter
  const dm = await slack.conversations.open({ users: thread.thread_starter });
  if (!dm.channel?.id) {
    throw new Error(`Could not open DM with user ${thread.thread_starter}`);
  }

  await slack.chat.postMessage({
    channel: dm.channel.id,
    text: `A thread in ${channelLabel} has ${thread.message_count} messages with no decision captured. Consider recording the outcome.`,
    blocks,
    unfurl_links: false,
  });

  // Record that we sent this prompt (prevents re-sending for 7 days)
  await query(
    `INSERT INTO events (company_id, source, entity_id, event_type, timestamp, metadata, provider_event_id)
     VALUES ($1, 'slack', $2, 'flowguard.decision_capture_sent', NOW(), $3, $4)
     ON CONFLICT (company_id, provider_event_id) DO NOTHING`,
    [
      companyId,
      `${thread.channel_id}:${thread.thread_ts}`,
      JSON.stringify({
        channel_id: thread.channel_id,
        thread_ts: thread.thread_ts,
        user_id: thread.thread_starter,
        message_count: thread.message_count,
      }),
      `flowguard:decision_capture:${thread.channel_id}:${thread.thread_ts}`,
    ],
  );
}
