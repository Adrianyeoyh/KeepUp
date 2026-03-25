/**
 * JQL-Powered Custom Leak Rules — API Service
 *
 * Allows teams to define custom leak detection rules based on Jira JQL queries.
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

// Re-export the type for convenience
export type { CustomLeakRule };

function getJqlConfig(): JqlConfig {
  return {
    baseUrl: config.JIRA_BASE_URL || '',
    email: config.JIRA_USER_EMAIL || '',
    apiToken: config.JIRA_API_TOKEN || '',
  };
}

// ============================================
// Rule Evaluation
// ============================================

export async function evaluateCustomLeakRules(companyId: string): Promise<void> {
  // Get all teams with custom leak rules
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
        await evaluateSingleRule(companyId, team.id, team.name, rule);
      } catch (err) {
        logger.warn({ err, companyId, teamId: team.id, ruleId: rule.id }, 'Custom JQL rule evaluation failed — skipping');
      }
    }
  }
}

async function evaluateSingleRule(
  companyId: string,
  teamId: string,
  teamName: string,
  rule: CustomLeakRule,
): Promise<void> {
  const jqlConfig = getJqlConfig();

  // Check if a leak for this rule was already created today
  const existing = await query<{ id: string }>(
    `SELECT id FROM leak_instances
     WHERE company_id = $1
       AND team_id = $2
       AND leak_type = 'custom_jql'
       AND detected_at::date = CURRENT_DATE
       AND metrics_context->>'rule_id' = $3
     LIMIT 1`,
    [companyId, teamId, rule.id],
  );

  if (existing.rows.length > 0) return;

  // Execute JQL
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

// ============================================
// CRUD Helpers (used by API endpoints)
// ============================================

export async function getTeamLeakRules(teamId: string): Promise<CustomLeakRule[]> {
  const result = await query<{ custom_leak_rules: string }>(
    `SELECT custom_leak_rules FROM teams WHERE id = $1`,
    [teamId],
  );

  const raw = result.rows[0]?.custom_leak_rules;
  if (!raw) return [];
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as unknown as CustomLeakRule[]);
}

export async function upsertTeamLeakRule(
  teamId: string,
  rule: Omit<CustomLeakRule, 'created_at'> & { created_at?: string },
): Promise<CustomLeakRule[]> {
  const existing = await getTeamLeakRules(teamId);
  const now = new Date().toISOString();

  const idx = existing.findIndex((r) => r.id === rule.id);
  const fullRule: CustomLeakRule = { ...rule, created_at: rule.created_at || now };

  if (idx >= 0) {
    existing[idx] = fullRule;
  } else {
    existing.push(fullRule);
  }

  await query(
    `UPDATE teams SET custom_leak_rules = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(existing), teamId],
  );

  return existing;
}

export async function deleteTeamLeakRule(teamId: string, ruleId: string): Promise<CustomLeakRule[]> {
  const existing = await getTeamLeakRules(teamId);
  const filtered = existing.filter((r) => r.id !== ruleId);

  await query(
    `UPDATE teams SET custom_leak_rules = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(filtered), teamId],
  );

  return filtered;
}

// ============================================
// JQL Validation (dry-run)
// ============================================

export async function validateJql(jql: string): Promise<{ valid: boolean; issueCount?: number; error?: string }> {
  try {
    const result = await executeJqlQuery(getJqlConfig(), jql, 0);
    return { valid: true, issueCount: result.total };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { valid: false, error: message };
  }
}
