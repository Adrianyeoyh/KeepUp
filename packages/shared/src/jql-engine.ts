/**
 * JQL Engine — Shared between API and Worker
 *
 * Provides types, JQL query execution, and rule evaluation logic
 * for custom JQL-based leak detection rules.
 */

// ============================================
// Types
// ============================================

export interface CustomLeakRule {
  id: string;
  name: string;
  description: string;
  jql: string;
  threshold: number;
  severity_multiplier: number;
  enabled: boolean;
  created_at: string;
}

export interface JqlSearchResult {
  total: number;
  issues: Array<{
    key: string;
    fields: {
      summary: string;
      status: { name: string };
    };
  }>;
}

export interface JqlConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

// ============================================
// JQL Query Execution
// ============================================

export async function executeJqlQuery(
  jqlConfig: JqlConfig,
  jql: string,
  maxResults: number = 10,
): Promise<JqlSearchResult> {
  const { baseUrl, email, apiToken } = jqlConfig;

  if (!baseUrl || !email || !apiToken) {
    throw new Error('Jira credentials not configured');
  }

  const url = new URL('/rest/api/3/search', baseUrl);
  url.searchParams.set('jql', jql);
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('fields', 'summary,status');

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira JQL search failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<JqlSearchResult>;
}

// ============================================
// Severity Computation
// ============================================

export function computeJqlSeverity(
  issueCount: number,
  threshold: number,
  severityMultiplier: number,
): number {
  const ratio = issueCount / Math.max(threshold, 1);
  const baseSeverity = Math.max(10, Math.min(100, Math.round((ratio - 1) * 55 + 45)));
  return Math.max(10, Math.min(100, Math.round(baseSeverity * severityMultiplier)));
}

// ============================================
// Build Evidence Links
// ============================================

export function buildJqlEvidenceLinks(
  baseUrl: string,
  rule: CustomLeakRule,
  issues: JqlSearchResult['issues'],
): Array<{ provider: string; entity_type: string; entity_id: string; url: string; title: string }> {
  const evidenceLinks = issues.slice(0, 3).map((issue) => ({
    provider: 'jira' as const,
    entity_type: 'issue',
    entity_id: issue.key,
    url: `${baseUrl}/browse/${issue.key}`,
    title: `${issue.key}: ${issue.fields.summary}`,
  }));

  if (evidenceLinks.length === 0) {
    evidenceLinks.push({
      provider: 'jira' as const,
      entity_type: 'query',
      entity_id: rule.id,
      url: `${baseUrl}/issues/?jql=${encodeURIComponent(rule.jql)}`,
      title: `JQL: ${rule.name}`,
    });
  }

  return evidenceLinks;
}

// ============================================
// Build Leak Instance Data
// ============================================

export function buildJqlLeakData(rule: CustomLeakRule, issueCount: number, severity: number) {
  return {
    metricsContext: {
      current_value: issueCount,
      baseline_value: rule.threshold,
      metric_name: `custom_jql.${rule.id}`,
      delta_percentage: Math.round(((issueCount - rule.threshold) / rule.threshold) * 100),
      rule_id: rule.id,
      rule_name: rule.name,
      jql: rule.jql,
    },
    recommendedFix: {
      summary: `Custom rule "${rule.name}" triggered: ${issueCount} issues matched (threshold: ${rule.threshold}).`,
      action_type: 'custom_jql_alert',
      details: { rule_id: rule.id, description: rule.description },
    },
    costHoursPerWeek: Math.round((severity / 100) * 16 * 10) / 10,
  };
}
