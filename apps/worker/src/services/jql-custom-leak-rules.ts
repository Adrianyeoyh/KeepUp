/**
 * JQL Custom Leak Rules — Worker-side evaluator
 *
 * Evaluates JQL-based custom leak rules during the daily leak detection cycle.
 * Shared JQL execution logic lives in @flowguard/shared.
 */

import { query } from '../db/client.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import {
  type CustomLeakRule,
  type JqlConfig,
  executeJqlQuery,
  computeJqlSeverity,
  buildJqlEvidenceLinks,
  buildJqlLeakData,
} from '@flowguard/shared';

function getJqlConfig(): JqlConfig {
  return {
    baseUrl: config.JIRA_BASE_URL || '',
    email: config.JIRA_USER_EMAIL || '',
    apiToken: config.JIRA_API_TOKEN || '',
  };
}

export async function evaluateCustomLeakRules(companyId: string): Promise<void> {
  const jqlConfig = getJqlConfig();

  // Skip if Jira not configured
  if (!jqlConfig.baseUrl || !jqlConfig.email || !jqlConfig.apiToken) {
    return;
  }

  const teamsResult = await query<{ id: string; name: string; custom_leak_rules: string }>(
    `SELECT id, name, custom_leak_rules FROM teams WHERE company_id = $1 AND custom_leak_rules != '[]'::jsonb`,
    [companyId],
  );

  for (const team of teamsResult.rows) {
    const rules: CustomLeakRule[] =
      typeof team.custom_leak_rules === 'string'
        ? JSON.parse(team.custom_leak_rules)
        : (team.custom_leak_rules as unknown as CustomLeakRule[]);

    for (const rule of rules) {
      if (!rule.enabled) continue;

      try {
        await evaluateSingleRule(jqlConfig, companyId, team.id, team.name, rule);
      } catch (err) {
        logger.warn({ err, companyId, teamId: team.id, ruleId: rule.id }, 'Custom JQL rule evaluation failed — skipping');
      }
    }
  }
}

async function evaluateSingleRule(
  jqlConfig: JqlConfig,
  companyId: string,
  teamId: string,
  teamName: string,
  rule: CustomLeakRule,
): Promise<void> {
  // Dedup: skip if already created today for this rule
  const existing = await query<{ id: string }>(
    `SELECT id FROM leak_instances
     WHERE company_id = $1 AND team_id = $2
       AND leak_type = 'custom_jql'
       AND detected_at::date = CURRENT_DATE
       AND metrics_context->>'rule_id' = $3
     LIMIT 1`,
    [companyId, teamId, rule.id],
  );

  if (existing.rows.length > 0) return;

  const result = await executeJqlQuery(jqlConfig, rule.jql, 5);
  const issueCount = result.total;

  if (issueCount <= rule.threshold) return;

  const severity = computeJqlSeverity(issueCount, rule.threshold, rule.severity_multiplier);
  const evidenceLinks = buildJqlEvidenceLinks(jqlConfig.baseUrl, rule, result.issues);
  const { metricsContext, recommendedFix, costHoursPerWeek } = buildJqlLeakData(rule, issueCount, severity);

  await query(
    `INSERT INTO leak_instances (
      company_id, leak_type, severity, confidence, status, detected_at,
      evidence_links, metrics_context, recommended_fix,
      cost_estimate_hours_per_week, team_id
    )
    VALUES ($1, 'custom_jql', $2, $3, 'detected', NOW(), $4, $5, $6, $7, $8)`,
    [
      companyId,
      severity,
      0.8,
      JSON.stringify(evidenceLinks),
      JSON.stringify(metricsContext),
      JSON.stringify(recommendedFix),
      costHoursPerWeek,
      teamId,
    ],
  );

  logger.info(
    { companyId, teamId, ruleId: rule.id, issueCount, threshold: rule.threshold, severity },
    `Custom JQL rule "${rule.name}" triggered for team ${teamName}`,
  );
}
