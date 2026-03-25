import { query } from '@flowguard/db';
import { EventBus, TOPICS } from '@flowguard/event-bus';
import { logger } from '../logger.js';

/**
 * Leak Engine — Detects process leaks from metric snapshots.
 *
 * Migrated from apps/worker/src/services/leak-engine.ts.
 * Key changes:
 *   - Uses `@flowguard/db` query() instead of local db client
 *   - Publishes `leaks.detected` events to EventBus
 *   - Custom JQL leak rules are called externally (not inlined here)
 *
 * All business logic preserved from the original implementation.
 */

type LatestMetric = {
  value: number;
  baselineValue: number;
};

type EvidenceLink = {
  provider: 'slack' | 'jira' | 'github' | 'system';
  entity_type: string;
  entity_id: string;
  url: string;
  title?: string;
};

function calcDeltaPercentage(currentValue: number, baselineValue: number): number {
  if (baselineValue <= 0) {
    return currentValue > 0 ? 100 : 0;
  }
  return ((currentValue - baselineValue) / baselineValue) * 100;
}

function severityFromRatio(currentValue: number, baselineValue: number): number {
  if (baselineValue <= 0) {
    return Math.min(100, Math.round(currentValue * 20 + 20));
  }
  const ratio = currentValue / baselineValue;
  return Math.max(10, Math.min(100, Math.round((ratio - 1) * 55 + 45)));
}

function estimatedWeeklyCostHours(severity: number): number {
  return Math.round((severity / 100) * 16 * 10) / 10;
}

async function getLatestMetric(
  companyId: string,
  metricName: string,
  teamId?: string,
): Promise<LatestMetric | null> {
  const scopeClause = teamId ? `AND scope = 'team' AND scope_id = $3` : `AND scope = 'company'`;
  const result = await query<{ value: string; baseline_value: string | null }>(
    `SELECT value, baseline_value
     FROM metric_snapshots
     WHERE company_id = $1
       AND metric_name = $2
       ${scopeClause}
     ORDER BY date DESC
     LIMIT 1`,
    teamId ? [companyId, metricName, teamId] : [companyId, metricName],
  );

  const row = result.rows[0];
  if (!row) return null;

  const value = Number(row.value || 0);
  const baselineValue = Number(row.baseline_value || row.value || 0);
  return {
    value: Number.isFinite(value) ? value : 0,
    baselineValue: Number.isFinite(baselineValue) ? baselineValue : 0,
  };
}

async function leakExistsForToday(
  companyId: string,
  leakType: string,
  teamId?: string,
): Promise<boolean> {
  const teamClause = teamId ? `AND team_id = $3` : `AND team_id IS NULL`;
  const result = await query<{ id: string }>(
    `SELECT id
     FROM leak_instances
     WHERE company_id = $1
       AND leak_type = $2
       AND detected_at::date = CURRENT_DATE
       ${teamClause}
     LIMIT 1`,
    teamId ? [companyId, leakType, teamId] : [companyId, leakType],
  );
  return Boolean(result.rows[0]);
}

async function createLeak(
  input: {
    companyId: string;
    leakType: string;
    severity: number;
    confidence: number;
    evidenceLinks: EvidenceLink[];
    metricName: string;
    currentValue: number;
    baselineValue: number;
    recommendedFixSummary: string;
    recommendedActionType: string;
    recommendedFixDetails?: Record<string, unknown>;
    semanticExplanation?: string;
    teamId?: string;
  },
  eventBus?: EventBus,
): Promise<void> {
  const result = await query<{ id: string }>(
    `INSERT INTO leak_instances (
      company_id,
      leak_type,
      severity,
      confidence,
      status,
      detected_at,
      evidence_links,
      metrics_context,
      recommended_fix,
      cost_estimate_hours_per_week,
      team_id
    )
    VALUES ($1, $2, $3, $4, 'detected', NOW(), $5, $6, $7, $8, $9)
    RETURNING id`,
    [
      input.companyId,
      input.leakType,
      input.severity,
      input.confidence,
      JSON.stringify(input.evidenceLinks),
      JSON.stringify({
        current_value: input.currentValue,
        baseline_value: input.baselineValue,
        metric_name: input.metricName,
        delta_percentage: calcDeltaPercentage(input.currentValue, input.baselineValue),
        semantic_explanation: input.semanticExplanation || null,
      }),
      JSON.stringify({
        summary: input.recommendedFixSummary,
        action_type: input.recommendedActionType,
        details: input.recommendedFixDetails || {},
      }),
      estimatedWeeklyCostHours(input.severity),
      input.teamId || null,
    ],
  );

  // Publish leaks.detected event to EventBus
  const leakId = result.rows[0]?.id;
  if (leakId && eventBus) {
    try {
      await eventBus.publish(TOPICS.LEAKS_DETECTED, {
        companyId: input.companyId,
        leakId,
        leakType: input.leakType,
        severity: input.severity,
        confidence: input.confidence,
        teamId: input.teamId,
      });
    } catch (err) {
      logger.warn({ err, leakId }, 'Failed to publish leaks.detected event — non-fatal');
    }
  }
}

async function getSlackDecisionEvidence(
  companyId: string,
  teamId?: string,
): Promise<EvidenceLink[]> {
  const teamClause = teamId ? `AND team_id = $2` : '';
  const result = await query<{
    channel_id: string | null;
    thread_ts: string | null;
    message_count: string;
  }>(
    `SELECT
      metadata->>'channel_id' AS channel_id,
      metadata->>'thread_ts' AS thread_ts,
      COUNT(*) FILTER (WHERE event_type IN ('slack.message', 'slack.thread_reply'))::text AS message_count
     FROM events
     WHERE company_id = $1
       AND source = 'slack'
       AND timestamp >= NOW() - INTERVAL '7 days'
       ${teamClause}
     GROUP BY metadata->>'channel_id', metadata->>'thread_ts'
     HAVING BOOL_OR(event_type = 'slack.thread_resolved') = FALSE
     ORDER BY COUNT(*) FILTER (WHERE event_type IN ('slack.message', 'slack.thread_reply')) DESC
     LIMIT 1`,
    teamId ? [companyId, teamId] : [companyId],
  );

  const row = result.rows[0];
  if (!row?.channel_id || !row?.thread_ts) {
    return [{
      provider: 'slack',
      entity_type: 'thread',
      entity_id: 'unknown-thread',
      url: 'https://slack.com',
      title: 'Slack unresolved thread',
    }];
  }

  const threadToken = row.thread_ts.replace('.', '');
  return [{
    provider: 'slack',
    entity_type: 'thread',
    entity_id: `${row.channel_id}:${row.thread_ts}`,
    url: `https://slack.com/archives/${row.channel_id}/p${threadToken}`,
    title: `Unresolved thread (${row.message_count} messages)`,
  }];
}

async function getSlackUnloggedActionEvidence(
  companyId: string,
): Promise<{ count: number; evidence: EvidenceLink[] }> {
  const result = await query<{
    channel_id: string | null;
    thread_ts: string | null;
    implied_count: string;
  }>(
    `SELECT
      metadata->>'channel_id' AS channel_id,
      metadata->>'thread_ts' AS thread_ts,
      COUNT(*)::text AS implied_count
     FROM events
     WHERE company_id = $1
       AND source = 'slack'
       AND timestamp >= NOW() - INTERVAL '24 hours'
       AND metadata->>'implied_action' = 'true'
     GROUP BY metadata->>'channel_id', metadata->>'thread_ts'
     HAVING BOOL_OR(metadata->>'linked_jira_issue' = 'true') = FALSE
     ORDER BY COUNT(*) DESC
     LIMIT 1`,
    [companyId],
  );

  const row = result.rows[0];
  if (!row?.channel_id || !row?.thread_ts) {
    return { count: 0, evidence: [] };
  }

  const threadToken = row.thread_ts.replace('.', '');
  return {
    count: Number(row.implied_count || 0),
    evidence: [{
      provider: 'slack',
      entity_type: 'thread',
      entity_id: `${row.channel_id}:${row.thread_ts}`,
      url: `https://slack.com/archives/${row.channel_id}/p${threadToken}`,
      title: 'Implied action without Jira ticket',
    }],
  };
}

async function getJiraEvidence(
  companyId: string,
  eventType: 'jira.issue_reopened' | 'jira.issue_transitioned',
): Promise<EvidenceLink[]> {
  const result = await query<{ issue_key: string | null }>(
    `SELECT metadata->>'issue_key' AS issue_key
     FROM events
     WHERE company_id = $1
       AND source = 'jira'
       AND event_type = $2
     ORDER BY timestamp DESC
     LIMIT 1`,
    [companyId, eventType],
  );

  const issueKey = result.rows[0]?.issue_key;
  if (!issueKey) {
    return [{
      provider: 'jira',
      entity_type: 'issue',
      entity_id: 'unknown-issue',
      url: 'https://example.atlassian.net',
      title: 'Recent Jira issue event',
    }];
  }

  return [{
    provider: 'jira',
    entity_type: 'issue',
    entity_id: issueKey,
    url: `https://example.atlassian.net/browse/${issueKey}`,
    title: issueKey,
  }];
}

async function getGitHubEvidence(companyId: string): Promise<EvidenceLink[]> {
  const result = await query<{ entity_id: string; html_url: string | null }>(
    `SELECT
      entity_id,
      metadata->>'html_url' AS html_url
     FROM events
     WHERE company_id = $1
       AND source = 'github'
       AND event_type IN ('github.pr_opened', 'github.pr_updated')
     ORDER BY timestamp DESC
     LIMIT 1`,
    [companyId],
  );

  const row = result.rows[0];
  if (!row) {
    return [{
      provider: 'github',
      entity_type: 'pr',
      entity_id: 'unknown-pr',
      url: 'https://github.com',
      title: 'Recent PR',
    }];
  }

  return [{
    provider: 'github',
    entity_type: 'pr',
    entity_id: row.entity_id,
    url: row.html_url || 'https://github.com',
    title: row.entity_id,
  }];
}

async function detectLeaks(companyId: string, eventBus?: EventBus, teamId?: string): Promise<void> {
  const unresolvedThreads = await getLatestMetric(companyId, 'slack.unresolved_threads', teamId);
  if (
    unresolvedThreads &&
    unresolvedThreads.value >= Math.max(1, unresolvedThreads.baselineValue * 1.1) &&
    !(await leakExistsForToday(companyId, 'decision_drift', teamId))
  ) {
    const severity = severityFromRatio(unresolvedThreads.value, unresolvedThreads.baselineValue || 1);
    const delta = calcDeltaPercentage(unresolvedThreads.value, unresolvedThreads.baselineValue);
    await createLeak({
      companyId,
      leakType: 'decision_drift',
      severity,
      confidence: 0.72,
      evidenceLinks: await getSlackDecisionEvidence(companyId, teamId),
      metricName: 'slack.unresolved_threads',
      currentValue: unresolvedThreads.value,
      baselineValue: unresolvedThreads.baselineValue,
      recommendedFixSummary: 'Assign a DRI and create a Decision Commit in the unresolved Slack thread.',
      recommendedActionType: 'create_decision_commit',
      semanticExplanation: `${Math.round(unresolvedThreads.value)} Slack threads have 3+ messages with no resolution — that's ${delta > 0 ? `${Math.round(delta)}% above` : 'at'} your baseline. This represents invisible decision debt: discussions are happening but decisions aren't being captured. Without resolution, these same conversations will repeat in 2-3 weeks, costing the team time and context.`,
      teamId,
    }, eventBus);
  }

  const unloggedActions = await getSlackUnloggedActionEvidence(companyId);
  if (unloggedActions.count > 0 && !(await leakExistsForToday(companyId, 'unlogged_action_items', teamId))) {
    const severity = severityFromRatio(unloggedActions.count, 1);
    await createLeak({
      companyId,
      leakType: 'unlogged_action_items',
      severity,
      confidence: 0.65,
      evidenceLinks: unloggedActions.evidence,
      metricName: 'slack.unlogged_actions_detected',
      currentValue: unloggedActions.count,
      baselineValue: 0,
      recommendedFixSummary: 'Create Action Commits and link follow-up Jira tickets for implied actions.',
      recommendedActionType: 'create_action_commit',
      semanticExplanation: `${unloggedActions.count} action items were implied in Slack conversations but never created as Jira tickets. This is shadow work — tasks the team committed to verbally but aren't tracked anywhere. Without tickets, there's no visibility into workload, no way to prioritize, and no record when things slip.`,
      teamId,
    }, eventBus);
  }

  const reopenRate = await getLatestMetric(companyId, 'jira.reopen_rate', teamId);
  if (
    reopenRate &&
    reopenRate.value >= Math.max(0.1, reopenRate.baselineValue * 1.15) &&
    !(await leakExistsForToday(companyId, 'reopen_bounce_spike', teamId))
  ) {
    const severity = severityFromRatio(reopenRate.value, Math.max(reopenRate.baselineValue, 0.05));
    const pct = (reopenRate.value * 100).toFixed(0);
    const basePct = (reopenRate.baselineValue * 100).toFixed(0);
    await createLeak({
      companyId,
      leakType: 'reopen_bounce_spike',
      severity,
      confidence: 0.78,
      evidenceLinks: await getJiraEvidence(companyId, 'jira.issue_reopened'),
      metricName: 'jira.reopen_rate',
      currentValue: reopenRate.value,
      baselineValue: reopenRate.baselineValue,
      recommendedFixSummary: 'Propose Jira template improvement for acceptance criteria and ownership fields.',
      recommendedActionType: 'jira_template_suggest',
      semanticExplanation: `Reopen rate has spiked to ${pct}% (baseline ${basePct}%). Issues are being closed prematurely and bouncing back — this indicates unclear acceptance criteria, insufficient testing, or requirements that changed after work started. The team is paying a "rework tax" that inflates cycle time and erodes trust in the definition of done.`,
      teamId,
    }, eventBus);
  }

  const cycleTime = await getLatestMetric(companyId, 'jira.cycle_time_median', teamId);
  if (
    cycleTime &&
    cycleTime.baselineValue > 0 &&
    cycleTime.value >= cycleTime.baselineValue * 1.15 &&
    !(await leakExistsForToday(companyId, 'cycle_time_drift', teamId))
  ) {
    const severity = severityFromRatio(cycleTime.value, cycleTime.baselineValue);
    const hrs = cycleTime.value.toFixed(1);
    const baseHrs = cycleTime.baselineValue.toFixed(1);
    await createLeak({
      companyId,
      leakType: 'cycle_time_drift',
      severity,
      confidence: 0.7,
      evidenceLinks: await getJiraEvidence(companyId, 'jira.issue_transitioned'),
      metricName: 'jira.cycle_time_median',
      currentValue: cycleTime.value,
      baselineValue: cycleTime.baselineValue,
      recommendedFixSummary: 'Add SLA reminder and approval owner clarifications on delayed Jira flow stages.',
      recommendedActionType: 'jira_comment',
      semanticExplanation: `Median cycle time has drifted to ${hrs}h vs ${baseHrs}h baseline. Issues are taking longer to move from "In Progress" to "Done". This could indicate blocked PRs waiting for review, scope creep within tickets, or architectural bottlenecks where one team's work depends on another's. The compounding effect: longer cycles → larger batches → higher risk per release.`,
      teamId,
    }, eventBus);
  }

  const reviewLatency = await getLatestMetric(companyId, 'github.pr_review_latency_median', teamId);
  if (
    reviewLatency &&
    reviewLatency.value >= Math.max(24, reviewLatency.baselineValue * 1.2) &&
    !(await leakExistsForToday(companyId, 'pr_review_bottleneck', teamId))
  ) {
    const severity = severityFromRatio(reviewLatency.value, Math.max(reviewLatency.baselineValue, 12));
    const hrs = reviewLatency.value.toFixed(1);
    const baseHrs = reviewLatency.baselineValue.toFixed(1);
    await createLeak({
      companyId,
      leakType: 'pr_review_bottleneck',
      severity,
      confidence: 0.76,
      evidenceLinks: await getGitHubEvidence(companyId),
      metricName: 'github.pr_review_latency_median',
      currentValue: reviewLatency.value,
      baselineValue: reviewLatency.baselineValue,
      recommendedFixSummary: 'Trigger reviewer rotation and post review-request ping for stalled pull requests.',
      recommendedActionType: 'github_request_review',
      semanticExplanation: `PRs are waiting ${hrs}h for their first review (baseline ${baseHrs}h). This creates a context-switching penalty: developers move on to new work while PRs stall, then lose context when they revisit. Stale PRs also accumulate merge conflicts. If one reviewer is overloaded (check if review load is concentrated), the team needs reviewer rotation or pairing.`,
      teamId,
    }, eventBus);
  }
}

/**
 * Run leak detection for a company at company-level and per-team.
 *
 * @param companyId - The company to run leak detection for
 * @param eventBus - Optional EventBus instance for publishing leaks.detected events
 */
export async function runLeakDetection(companyId: string, eventBus?: EventBus): Promise<void> {
  // 1. Company-level leak detection
  await detectLeaks(companyId, eventBus);

  // 2. Per-team leak detection
  const teamsResult = await query<{ id: string }>(
    `SELECT id FROM teams WHERE company_id = $1`,
    [companyId],
  );

  for (const team of teamsResult.rows) {
    try {
      await detectLeaks(companyId, eventBus, team.id);
    } catch (err) {
      logger.warn({ err, companyId, teamId: team.id }, 'Team leak detection failed — continuing');
    }
  }
}
