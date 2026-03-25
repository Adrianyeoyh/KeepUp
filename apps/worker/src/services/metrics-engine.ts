import type { MetricName } from '@flowguard/shared';
import { query } from '../db/client.js';

const DAY_MS = 24 * 60 * 60 * 1000;

type ThreadAggregateRow = {
  entity_id: string;
  message_count: string;
  resolved: boolean;
  implied_action: boolean;
  linked_jira_issue: boolean;
};

type PairTimestampRow = {
  entity_id: string;
  opened_at: Date | null;
  closed_at: Date | null;
  first_review_at: Date | null;
  created_at: Date | null;
  done_at: Date | null;
};

type MetricValue = {
  metricName: MetricName;
  value: number;
  metadata?: Record<string, unknown>;
};

/** Optional scope for team/project-level metrics */
export interface MetricsScope {
  teamId?: string;
  projectId?: string;
}

/** Returns 'team' | 'project' | 'company' based on which scope is provided */
function scopeLevel(scope?: MetricsScope): 'team' | 'project' | 'company' {
  if (scope?.projectId) return 'project';
  if (scope?.teamId) return 'team';
  return 'company';
}

/** Returns the scope_id (team or project UUID) or NULL */
function scopeId(scope?: MetricsScope): string | null {
  if (scope?.projectId) return scope.projectId;
  if (scope?.teamId) return scope.teamId;
  return null;
}

/** Builds a WHERE clause fragment and params array for optional team/project scoping */
function scopeFilter(scope?: MetricsScope, startParamIndex = 4): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let idx = startParamIndex;

  if (scope?.teamId) {
    parts.push(`AND team_id = $${idx}`);
    params.push(scope.teamId);
    idx++;
  }

  if (scope?.projectId) {
    parts.push(`AND project_id = $${idx}`);
    params.push(scope.projectId);
    idx++;
  }

  return { clause: parts.join(' '), params };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function getBaseline(
  companyId: string,
  metricName: MetricName,
  forDate: string,
  scope?: MetricsScope,
): Promise<number | null> {
  const sl = scopeLevel(scope);
  const sid = scopeId(scope);

  const result = await query<{ baseline: string | null }>(
    `SELECT AVG(value) AS baseline
     FROM metric_snapshots
     WHERE company_id = $1
       AND metric_name = $2
       AND scope = $3
       AND (scope_id = $4 OR ($4::uuid IS NULL AND scope_id IS NULL))
       AND date < $5::date
       AND date >= ($5::date - INTERVAL '28 days')`,
    [companyId, metricName, sl, sid, forDate],
  );

  if (!result.rows[0]?.baseline) {
    return null;
  }

  const value = Number(result.rows[0].baseline);
  return Number.isFinite(value) ? value : null;
}

async function upsertSnapshot(
  companyId: string,
  metricName: MetricName,
  metricValue: number,
  forDate: string,
  metadata: Record<string, unknown> = {},
  scope?: MetricsScope,
): Promise<void> {
  const sl = scopeLevel(scope);
  const sid = scopeId(scope);
  const baseline = await getBaseline(companyId, metricName, forDate, scope);

  await query(
    `INSERT INTO metric_snapshots (
      company_id,
      metric_name,
      scope,
      scope_id,
      value,
      baseline_value,
      date,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8)
    ON CONFLICT (company_id, metric_name, scope, scope_id, date)
    DO UPDATE SET
      value = EXCLUDED.value,
      baseline_value = EXCLUDED.baseline_value,
      metadata = EXCLUDED.metadata`,
    [
      companyId,
      metricName,
      sl,
      sid,
      metricValue,
      baseline ?? metricValue,
      forDate,
      JSON.stringify(metadata),
    ],
  );
}

async function computeSlackMetrics(
  companyId: string,
  windowStart: Date,
  windowEnd: Date,
  scope?: MetricsScope,
): Promise<MetricValue[]> {
  const sf = scopeFilter(scope, 4);

  const result = await query<ThreadAggregateRow>(
    `SELECT
      entity_id,
      COUNT(*) FILTER (WHERE event_type IN ('slack.message', 'slack.thread_reply'))::text AS message_count,
      BOOL_OR(event_type = 'slack.thread_resolved') AS resolved,
      BOOL_OR(metadata->>'implied_action' = 'true') AS implied_action,
      BOOL_OR(metadata->>'linked_jira_issue' = 'true') AS linked_jira_issue
     FROM events
     WHERE company_id = $1
       AND source = 'slack'
       AND timestamp >= $2
       AND timestamp <= $3
       ${sf.clause}
     GROUP BY entity_id`,
    [companyId, windowStart, windowEnd, ...sf.params],
  );

  const messageCounts = result.rows
    .map((row) => Number(row.message_count || 0))
    .filter((count) => Number.isFinite(count) && count > 0);

  const unresolvedThreads = result.rows.filter((row) => {
    const messageCount = Number(row.message_count || 0);
    return !row.resolved && messageCount >= 3;
  }).length;

  const impliedUnloggedActions = result.rows.filter((row) => row.implied_action && !row.linked_jira_issue).length;

  return [
    {
      metricName: 'slack.unresolved_threads',
      value: unresolvedThreads,
      metadata: {
        thread_count: result.rows.length,
      },
    },
    {
      metricName: 'slack.thread_length_median',
      value: median(messageCounts),
      metadata: {
        sampled_threads: messageCounts.length,
        implied_unlogged_actions: impliedUnloggedActions,
      },
    },
  ];
}

async function computeJiraMetrics(
  companyId: string,
  windowStart: Date,
  windowEnd: Date,
  scope?: MetricsScope,
): Promise<MetricValue[]> {
  const sf = scopeFilter(scope, 4);

  const counts = await query<{ reopened_count: string; updated_count: string }>(
    `SELECT
      COUNT(*) FILTER (WHERE event_type = 'jira.issue_reopened')::text AS reopened_count,
      COUNT(*) FILTER (WHERE event_type IN ('jira.issue_updated', 'jira.issue_transitioned'))::text AS updated_count
     FROM events
     WHERE company_id = $1
       AND source = 'jira'
       AND timestamp >= $2
       AND timestamp <= $3
       ${sf.clause}`,
    [companyId, windowStart, windowEnd, ...sf.params],
  );

  const reopenedCount = Number(counts.rows[0]?.reopened_count || 0);
  const updatedCount = Number(counts.rows[0]?.updated_count || 0);
  const reopenRate = updatedCount > 0 ? reopenedCount / updatedCount : 0;

  const sfLifecycle = scopeFilter(scope, 2);

  const lifecycleRows = await query<PairTimestampRow>(
    `SELECT
      entity_id,
      MIN(timestamp) FILTER (WHERE event_type = 'jira.issue_created') AS created_at,
      MIN(timestamp) FILTER (
        WHERE event_type = 'jira.issue_transitioned'
          AND metadata->>'is_done_transition' = 'true'
      ) AS done_at,
      NULL::timestamptz AS opened_at,
      NULL::timestamptz AS closed_at,
      NULL::timestamptz AS first_review_at
     FROM events
     WHERE company_id = $1
       AND source = 'jira'
       ${sfLifecycle.clause}
     GROUP BY entity_id`,
    [companyId, ...sfLifecycle.params],
  );

  const cycleTimeHours = lifecycleRows.rows
    .filter((row) => row.created_at && row.done_at)
    .filter((row) => {
      const doneAt = row.done_at as Date;
      return doneAt >= windowStart && doneAt <= windowEnd;
    })
    .map((row) => {
      const createdAt = row.created_at as Date;
      const doneAt = row.done_at as Date;
      return (doneAt.getTime() - createdAt.getTime()) / (60 * 60 * 1000);
    })
    .filter((value) => Number.isFinite(value) && value >= 0);

  return [
    {
      metricName: 'jira.reopen_rate',
      value: reopenRate,
      metadata: {
        reopened_count: reopenedCount,
        updated_count: updatedCount,
      },
    },
    {
      metricName: 'jira.cycle_time_median',
      value: median(cycleTimeHours),
      metadata: {
        sampled_issues: cycleTimeHours.length,
        unit: 'hours',
      },
    },
  ];
}

async function computeGitHubMetrics(
  companyId: string,
  windowStart: Date,
  windowEnd: Date,
  scope?: MetricsScope,
): Promise<MetricValue[]> {
  const sf = scopeFilter(scope, 2);

  const lifecycleRows = await query<PairTimestampRow>(
    `SELECT
      entity_id,
      MIN(timestamp) FILTER (WHERE event_type = 'github.pr_opened') AS opened_at,
      MIN(timestamp) FILTER (WHERE event_type = 'github.review_submitted') AS first_review_at,
      MIN(timestamp) FILTER (WHERE event_type IN ('github.pr_closed', 'github.pr_merged')) AS closed_at,
      NULL::timestamptz AS created_at,
      NULL::timestamptz AS done_at
     FROM events
     WHERE company_id = $1
       AND source = 'github'
       ${sf.clause}
     GROUP BY entity_id`,
    [companyId, ...sf.params],
  );

  const reviewLatencies = lifecycleRows.rows
    .flatMap((row) => {
      if (!row.opened_at || !row.first_review_at) {
        return [];
      }

      const openedAt = row.opened_at as Date;
      if (openedAt < windowStart || openedAt > windowEnd) {
        return [];
      }

      const firstReviewAt = row.first_review_at as Date;
      const latency = (firstReviewAt.getTime() - openedAt.getTime()) / (60 * 60 * 1000);
      return Number.isFinite(latency) && latency >= 0 ? [latency] : [];
    });

  const openPrAges = lifecycleRows.rows
    .filter((row) => row.opened_at && !row.closed_at)
    .map((row) => {
      const openedAt = row.opened_at as Date;
      return (windowEnd.getTime() - openedAt.getTime()) / (60 * 60 * 1000);
    })
    .filter((value) => Number.isFinite(value) && value >= 0);

  return [
    {
      metricName: 'github.pr_review_latency_median',
      value: median(reviewLatencies),
      metadata: {
        sampled_prs: reviewLatencies.length,
        unit: 'hours',
      },
    },
    {
      metricName: 'github.pr_age_median',
      value: median(openPrAges),
      metadata: {
        sampled_open_prs: openPrAges.length,
        unit: 'hours',
      },
    },
  ];
}

async function computeAndStoreMetrics(
  companyId: string,
  windowStart: Date,
  windowEnd: Date,
  snapshotDate: string,
  scope?: MetricsScope,
): Promise<void> {
  const metrics = [
    ...(await computeSlackMetrics(companyId, windowStart, windowEnd, scope)),
    ...(await computeJiraMetrics(companyId, windowStart, windowEnd, scope)),
    ...(await computeGitHubMetrics(companyId, windowStart, windowEnd, scope)),
  ];

  for (const metric of metrics) {
    await upsertSnapshot(
      companyId,
      metric.metricName,
      metric.value,
      snapshotDate,
      metric.metadata,
      scope,
    );
  }
}

/** Run metrics aggregation at company, team, and project levels */
export async function runDailyMetricsAggregation(companyId: string): Promise<void> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - DAY_MS);
  const snapshotDate = toDateOnly(windowEnd);

  // 1. Company-level metrics (existing behavior)
  await computeAndStoreMetrics(companyId, windowStart, windowEnd, snapshotDate);

  // 2. Per-team metrics
  const teamsResult = await query<{ id: string }>(
    `SELECT id FROM teams WHERE company_id = $1`,
    [companyId],
  );

  for (const team of teamsResult.rows) {
    await computeAndStoreMetrics(
      companyId,
      windowStart,
      windowEnd,
      snapshotDate,
      { teamId: team.id },
    );
  }

  // 3. Per-project metrics
  const projectsResult = await query<{ id: string }>(
    `SELECT id FROM projects WHERE company_id = $1`,
    [companyId],
  );

  for (const project of projectsResult.rows) {
    await computeAndStoreMetrics(
      companyId,
      windowStart,
      windowEnd,
      snapshotDate,
      { projectId: project.id },
    );
  }
}
