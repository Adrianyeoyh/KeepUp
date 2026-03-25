import { query } from '@flowguard/db';
import { logger } from '../logger.js';

/**
 * Cross-Team Pattern Detection
 *
 * Migrated from apps/worker/src/services/cross-team-patterns.ts.
 * Key changes:
 *   - Uses `@flowguard/db` query() instead of local db client
 *
 * Identifies patterns that span multiple teams — e.g. similar leaks
 * appearing across teams, correlated metric dips, or shared bottlenecks.
 * Runs weekly, generates cross-team insights as ledger commits.
 *
 * All business logic preserved from the original implementation.
 */

interface CrossTeamPattern {
  pattern_type: 'shared_leak' | 'correlated_metric_dip' | 'bottleneck_overlap';
  description: string;
  affected_teams: Array<{ team_id: string; team_name: string }>;
  severity: number;
  evidence: Record<string, unknown>;
}

/**
 * Main entry point: detect cross-team patterns for a company.
 */
export async function runCrossTeamPatternDetection(companyId: string): Promise<void> {
  const log = logger.child({ companyId, service: 'cross-team-patterns' });

  try {
    const patterns: CrossTeamPattern[] = [];

    const sharedLeaks = await detectSharedLeakTypes(companyId);
    patterns.push(...sharedLeaks);

    const correlatedDips = await detectCorrelatedMetricDips(companyId);
    patterns.push(...correlatedDips);

    const bottlenecks = await detectBottleneckOverlaps(companyId);
    patterns.push(...bottlenecks);

    if (patterns.length === 0) {
      log.info('No cross-team patterns detected');
      return;
    }

    for (const pattern of patterns) {
      await recordPatternAsCommit(companyId, pattern);
    }

    log.info({ patternCount: patterns.length }, 'Cross-team patterns detected and recorded');
  } catch (err) {
    log.error({ err }, 'Cross-team pattern detection failed');
  }
}

/**
 * Pattern 1: Same leak type appearing in 2+ teams concurrently.
 */
async function detectSharedLeakTypes(companyId: string): Promise<CrossTeamPattern[]> {
  const result = await query<{
    leak_type: string;
    team_count: number;
    avg_severity: number;
    team_ids: string[];
    team_names: string[];
  }>(
    `SELECT
       li.leak_type,
       COUNT(DISTINCT li.team_id)::int AS team_count,
       AVG(li.severity)::int AS avg_severity,
       ARRAY_AGG(DISTINCT li.team_id) AS team_ids,
       ARRAY_AGG(DISTINCT t.name) AS team_names
     FROM leak_instances li
     JOIN teams t ON t.id = li.team_id
     WHERE li.company_id = $1
       AND li.status IN ('detected', 'delivered')
       AND li.detected_at > NOW() - INTERVAL '14 days'
       AND li.team_id IS NOT NULL
     GROUP BY li.leak_type
     HAVING COUNT(DISTINCT li.team_id) >= 2
     ORDER BY AVG(li.severity) DESC`,
    [companyId],
  );

  return result.rows.map((r) => ({
    pattern_type: 'shared_leak' as const,
    description: `"${r.leak_type.replace(/_/g, ' ')}" detected across ${r.team_count} teams — may indicate a systemic process issue.`,
    affected_teams: r.team_ids.map((id, i) => ({ team_id: id, team_name: r.team_names[i] })),
    severity: r.avg_severity,
    evidence: { leak_type: r.leak_type, team_count: r.team_count, avg_severity: r.avg_severity },
  }));
}

/**
 * Pattern 2: Same metric degrading across multiple teams simultaneously.
 */
async function detectCorrelatedMetricDips(companyId: string): Promise<CrossTeamPattern[]> {
  const result = await query<{
    metric_name: string;
    team_count: number;
    avg_delta: number;
    team_ids: string[];
    team_names: string[];
  }>(
    `WITH recent AS (
       SELECT metric_name, scope_id AS team_id, AVG(value) AS recent_avg
       FROM metric_snapshots
       WHERE company_id = $1 AND scope = 'team'
         AND date >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY metric_name, scope_id
     ),
     baseline AS (
       SELECT metric_name, scope_id AS team_id, AVG(value) AS baseline_avg
       FROM metric_snapshots
       WHERE company_id = $1 AND scope = 'team'
         AND date BETWEEN (CURRENT_DATE - INTERVAL '28 days') AND (CURRENT_DATE - INTERVAL '7 days')
       GROUP BY metric_name, scope_id
     ),
     deltas AS (
       SELECT r.metric_name, r.team_id,
         CASE WHEN b.baseline_avg > 0
           THEN ((r.recent_avg - b.baseline_avg) / b.baseline_avg * 100)
           ELSE 0
         END AS pct_change
       FROM recent r
       JOIN baseline b ON r.metric_name = b.metric_name AND r.team_id = b.team_id
       WHERE b.baseline_avg > 0
     )
     SELECT
       d.metric_name,
       COUNT(DISTINCT d.team_id)::int AS team_count,
       AVG(d.pct_change)::int AS avg_delta,
       ARRAY_AGG(DISTINCT d.team_id) AS team_ids,
       ARRAY_AGG(DISTINCT t.name) AS team_names
     FROM deltas d
     JOIN teams t ON t.id = d.team_id
     WHERE d.pct_change > 20
     GROUP BY d.metric_name
     HAVING COUNT(DISTINCT d.team_id) >= 2`,
    [companyId],
  );

  return result.rows.map((r) => ({
    pattern_type: 'correlated_metric_dip' as const,
    description: `"${r.metric_name}" degraded by ~${Math.abs(r.avg_delta)}% across ${r.team_count} teams — possible shared external cause.`,
    affected_teams: r.team_ids.map((id, i) => ({ team_id: id, team_name: r.team_names[i] })),
    severity: Math.min(80, Math.abs(r.avg_delta)),
    evidence: { metric_name: r.metric_name, avg_delta: r.avg_delta, team_count: r.team_count },
  }));
}

/**
 * Pattern 3: Same person blocking reviews across multiple teams.
 */
async function detectBottleneckOverlaps(companyId: string): Promise<CrossTeamPattern[]> {
  const result = await query<{
    reviewer: string;
    team_count: number;
    pending_count: number;
    team_ids: string[];
    team_names: string[];
  }>(
    `SELECT
       e.metadata->>'requested_reviewer' AS reviewer,
       COUNT(DISTINCT e.team_id)::int AS team_count,
       COUNT(*)::int AS pending_count,
       ARRAY_AGG(DISTINCT e.team_id) FILTER (WHERE e.team_id IS NOT NULL) AS team_ids,
       ARRAY_AGG(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL) AS team_names
     FROM events e
     LEFT JOIN teams t ON t.id = e.team_id
     WHERE e.company_id = $1
       AND e.event_type = 'github.review_requested'
       AND e.created_at > NOW() - INTERVAL '7 days'
       AND e.metadata->>'requested_reviewer' IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM events e2
         WHERE e2.company_id = $1
           AND e2.event_type = 'github.review_submitted'
           AND e2.metadata->>'reviewer' = e.metadata->>'requested_reviewer'
           AND e2.entity_id = e.entity_id
           AND e2.created_at > e.created_at
       )
     GROUP BY e.metadata->>'requested_reviewer'
     HAVING COUNT(DISTINCT e.team_id) >= 2 AND COUNT(*) >= 5`,
    [companyId],
  );

  return result.rows
    .filter((r) => r.team_ids && r.team_ids.length > 0)
    .map((r) => ({
      pattern_type: 'bottleneck_overlap' as const,
      description: `@${r.reviewer} has ${r.pending_count} pending reviews spanning ${r.team_count} teams — multi-team bottleneck.`,
      affected_teams: (r.team_ids || []).map((id, i) => ({ team_id: id, team_name: r.team_names?.[i] || 'Unknown' })),
      severity: Math.min(70, r.pending_count * 7),
      evidence: { reviewer: r.reviewer, pending_count: r.pending_count, team_count: r.team_count },
    }));
}

/**
 * Record a detected pattern as an org-level ledger commit.
 */
async function recordPatternAsCommit(companyId: string, pattern: CrossTeamPattern): Promise<void> {
  // Dedup: check if a similar pattern was already recorded this week
  const existing = await query<{ id: string }>(
    `SELECT id FROM ledger_commits
     WHERE company_id = $1
       AND commit_type = 'observation'
       AND tags @> $2
       AND created_at > NOW() - INTERVAL '7 days'
     LIMIT 1`,
    [companyId, JSON.stringify([`cross-team:${pattern.pattern_type}`])],
  );

  if (existing.rows.length > 0) return;

  await query(
    `INSERT INTO ledger_commits (
      company_id, commit_type, title, summary, rationale, dri,
      status, branch_name, tags, scope_level, created_by
    )
    VALUES ($1, 'observation', $2, $3, $4, 'system', 'proposed', 'main',
      $5, 'company', 'system:cross-team-detection')`,
    [
      companyId,
      `Cross-Team: ${pattern.description.slice(0, 100)}`,
      pattern.description,
      `Detected by cross-team pattern analysis. Affected teams: ${pattern.affected_teams.map((t) => t.team_name).join(', ')}. Severity: ${pattern.severity}/100.`,
      JSON.stringify([`cross-team:${pattern.pattern_type}`, 'auto-detected']),
    ],
  );
}
