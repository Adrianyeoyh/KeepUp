import { query } from '../db/client.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

/**
 * AI Impact Summary
 *
 * After a ledger commit is merged, analyzes metric snapshots before/after
 * to produce a human-readable impact statement. Stored in commit metadata.
 * E.g. "After this decision, cycle_time dropped 12% over 3 days"
 */

interface MergedCommit {
  id: string;
  company_id: string;
  team_id: string | null;
  leak_instance_id: string | null;
  title: string;
  created_at: string;
}

interface MetricDelta {
  metric_name: string;
  before_avg: number;
  after_avg: number;
  change_pct: number;
}

async function computeMetricDeltas(commit: MergedCommit): Promise<MetricDelta[]> {
  const scope = commit.team_id ? 'team' : 'company';
  const scopeId = commit.team_id || commit.company_id;
  const mergedDate = commit.created_at;

  const result = await query<{
    metric_name: string; period: string; avg_value: number;
  }>(
    `SELECT
       metric_name,
       CASE WHEN date < $3::timestamp THEN 'before' ELSE 'after' END AS period,
       AVG(value) AS avg_value
     FROM metric_snapshots
     WHERE company_id = $1 AND scope = $2 AND scope_id = $4
       AND date BETWEEN ($3::timestamp - INTERVAL '7 days') AND ($3::timestamp + INTERVAL '7 days')
     GROUP BY metric_name, period`,
    [commit.company_id, scope, mergedDate, scopeId],
  );

  const grouped: Record<string, { before?: number; after?: number }> = {};
  for (const row of result.rows) {
    if (!grouped[row.metric_name]) grouped[row.metric_name] = {};
    grouped[row.metric_name][row.period as 'before' | 'after'] = Number(row.avg_value);
  }

  return Object.entries(grouped)
    .filter(([, v]) => v.before != null && v.after != null)
    .map(([metric_name, v]) => {
      const before_avg = v.before!;
      const after_avg = v.after!;
      const change_pct = before_avg !== 0 ? ((after_avg - before_avg) / before_avg) * 100 : 0;
      return { metric_name, before_avg, after_avg, change_pct };
    })
    .filter((d) => Math.abs(d.change_pct) >= 3); // only meaningful changes
}

function buildDeterministicSummary(commit: MergedCommit, deltas: MetricDelta[]): string {
  if (deltas.length === 0) {
    return 'No significant metric changes detected in the 7 days after this decision.';
  }

  const parts = deltas.slice(0, 3).map((d) => {
    const direction = d.change_pct < 0 ? 'decreased' : 'increased';
    const pct = Math.abs(Math.round(d.change_pct));
    const friendlyName = d.metric_name.replace(/[._]/g, ' ');
    return `${friendlyName} ${direction} by ${pct}%`;
  });

  return `After "${commit.title}": ${parts.join('; ')}.`;
}

async function callLLMForImpactSummary(
  commit: MergedCommit,
  deltas: MetricDelta[],
): Promise<string | null> {
  if (!config.LLM_API_KEY) return null;

  const systemMsg = 'You are FlowGuard AI. Generate a concise 1-2 sentence impact summary for a merged decision. Reference specific metrics and percentages.';
  const prompt = JSON.stringify({
    commit_title: commit.title,
    metrics_before_after: deltas,
    instructions: 'Produce a natural-language impact summary. Be specific. Max 100 words.',
  });

  try {
    const body = config.LLM_PROVIDER === 'anthropic'
      ? { model: config.LLM_MODEL, max_tokens: 200, temperature: 0.2, system: systemMsg, messages: [{ role: 'user', content: prompt }] }
      : { model: config.LLM_MODEL, temperature: 0.2, messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }] };

    const url = config.LLM_PROVIDER === 'anthropic'
      ? 'https://api.anthropic.com/v1/messages'
      : 'https://api.openai.com/v1/chat/completions';

    const headers: Record<string, string> = config.LLM_PROVIDER === 'anthropic'
      ? { 'x-api-key': config.LLM_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
      : { Authorization: `Bearer ${config.LLM_API_KEY}`, 'Content-Type': 'application/json' };

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) return null;

    const data = await response.json();
    return config.LLM_PROVIDER === 'anthropic'
      ? data.content?.find((e: any) => e.type === 'text')?.text?.trim() || null
      : data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export async function runAIImpactSummaries(companyId: string): Promise<void> {
  const log = logger.child({ companyId, job: 'ai-impact-summary' });

  const settingsResult = await query<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM companies WHERE id = $1`, [companyId],
  );
  const settings = settingsResult.rows[0]?.settings || {};
  const enabledFeatures = (settings.ai_enabled_features as string[]) || [];

  if (enabledFeatures.length > 0 && !enabledFeatures.includes('impact_summary')) {
    log.debug('AI impact summaries disabled');
    return;
  }

  // Find merged commits from last 7 days without impact summaries
  const commitsResult = await query<MergedCommit>(
    `SELECT id, company_id, team_id, leak_instance_id, title, created_at
     FROM ledger_commits
     WHERE company_id = $1
       AND status = 'merged'
       AND created_at > NOW() - INTERVAL '7 days'
       AND created_at < NOW() - INTERVAL '2 days'
       AND (metadata IS NULL OR metadata->>'impact_summary' IS NULL)
     ORDER BY created_at DESC
     LIMIT 5`,
    [companyId],
  );

  if (commitsResult.rows.length === 0) {
    log.debug('No merged commits need impact summaries');
    return;
  }

  for (const commit of commitsResult.rows) {
    try {
      const deltas = await computeMetricDeltas(commit);
      const aiSummary = await callLLMForImpactSummary(commit, deltas);
      const summary = aiSummary || buildDeterministicSummary(commit, deltas);

      await query(
        `UPDATE ledger_commits
         SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [
          JSON.stringify({
            impact_summary: summary,
            impact_deltas: deltas,
            impact_computed_at: new Date().toISOString(),
          }),
          commit.id,
        ],
      );

      log.info({ commitId: commit.id, deltaCount: deltas.length }, 'Impact summary generated');
    } catch (err) {
      log.warn({ err, commitId: commit.id }, 'Failed to compute impact summary');
    }
  }
}
