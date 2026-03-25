import { query } from '@flowguard/db';
import { logger } from '../logger.js';
import { config } from '../config.js';

/**
 * AI Recommendation Drafts
 *
 * Migrated from apps/worker/src/services/ai-recommendation-drafts.ts.
 * Key changes:
 *   - Uses `@flowguard/db` query() instead of local db client
 *   - Uses consumer config for LLM settings
 *
 * Generates draft ledger commits from detected leaks:
 *   - What to do (specific action, not vague advice)
 *   - Why (evidence chain: Slack thread -> Jira ticket -> PR -> metric)
 *   - Who should own it (DRI suggestion based on project context)
 *   - Expected impact (based on similar historical patterns)
 *   - Confidence score
 *
 * All business logic preserved from the original implementation.
 */

interface LeakForDraft {
  id: string;
  company_id: string;
  leak_type: string;
  severity: number;
  confidence: number;
  team_id: string | null;
  project_id: string | null;
  evidence_links: Array<{ url: string; title?: string; entity_id?: string }>;
  metrics_context: Record<string, unknown>;
  recommended_fix: Record<string, unknown>;
  ai_diagnosis: { root_cause?: string; explanation?: string } | null;
}

interface RecommendationDraft {
  title: string;
  summary: string;
  rationale: string;
  dri_suggestion: string | null;
  expected_impact: string;
  confidence: number;
  evidence_chain: Array<{ provider: string; entity_id: string; description: string }>;
}

interface TeamContext {
  teamName: string | null;
  teamLead: string | null;
  recentDecisions: string[];
  historicalPatterns: string[];
}

function buildPrompt(leak: LeakForDraft, context: TeamContext): string {
  return JSON.stringify({
    task: 'Generate a specific, actionable recommendation for this detected leak.',
    leak: {
      type: leak.leak_type,
      severity: leak.severity,
      diagnosis: leak.ai_diagnosis?.explanation || 'No AI diagnosis available.',
      root_cause: leak.ai_diagnosis?.root_cause || 'Unknown root cause.',
      metrics: leak.metrics_context,
      evidence_count: leak.evidence_links?.length || 0,
    },
    team_context: {
      team_name: context.teamName,
      recent_decisions: context.recentDecisions,
      historical_patterns: context.historicalPatterns,
      team_lead: context.teamLead,
    },
    output_format: {
      title: 'A specific action title (e.g., "Reduce sprint scope by 20% for Platform")',
      summary: 'What to do in 2-3 sentences',
      rationale: 'Why this action is recommended with evidence references',
      dri_suggestion: 'Suggested owner username or null',
      expected_impact: 'Expected outcome (e.g., "~15% cycle time reduction within 1 sprint")',
      confidence: 'A number between 0 and 1',
      evidence_chain: '[{ provider, entity_id, description }]',
    },
    constraints: {
      be_specific: true,
      reference_evidence: true,
      prefer_low_risk: true,
      max_evidence_chain: 5,
    },
  });
}

async function getTeamContext(companyId: string, teamId: string | null): Promise<TeamContext> {
  if (!teamId) {
    return { teamName: null, teamLead: null, recentDecisions: [], historicalPatterns: [] };
  }

  const [teamResult, decisionsResult, patternsResult] = await Promise.all([
    query<{ name: string; lead_user_id: string | null }>(
      `SELECT name, lead_user_id FROM teams WHERE id = $1`, [teamId],
    ),
    query<{ title: string }>(
      `SELECT title FROM ledger_commits
       WHERE company_id = $1 AND team_id = $2 AND status = 'merged'
       ORDER BY created_at DESC LIMIT 5`,
      [companyId, teamId],
    ),
    query<{ leak_type: string; resolution: string }>(
      `SELECT leak_type,
         CASE WHEN status = 'resolved' THEN 'resolved' ELSE 'persisted' END AS resolution
       FROM leak_instances
       WHERE company_id = $1 AND team_id = $2
         AND created_at > NOW() - INTERVAL '60 days'
       ORDER BY created_at DESC LIMIT 10`,
      [companyId, teamId],
    ),
  ]);

  return {
    teamName: teamResult.rows[0]?.name || null,
    teamLead: teamResult.rows[0]?.lead_user_id || null,
    recentDecisions: decisionsResult.rows.map((r) => r.title),
    historicalPatterns: patternsResult.rows.map((r) => `${r.leak_type}: ${r.resolution}`),
  };
}

async function callLLMForDraft(leak: LeakForDraft, teamCtx: TeamContext): Promise<RecommendationDraft | null> {
  if (!config.LLM_API_KEY) return null;

  const prompt = buildPrompt(leak, teamCtx);
  const systemMsg = 'You are FlowGuard AI. Generate a specific, actionable recommendation as strict JSON.';

  try {
    const body = config.LLM_PROVIDER === 'anthropic'
      ? {
          model: config.LLM_MODEL,
          max_tokens: 800,
          temperature: 0.3,
          system: systemMsg,
          messages: [{ role: 'user', content: prompt }],
        }
      : {
          model: config.LLM_MODEL,
          temperature: 0.3,
          messages: [
            { role: 'system', content: systemMsg },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
        };

    const url = config.LLM_PROVIDER === 'anthropic'
      ? 'https://api.anthropic.com/v1/messages'
      : 'https://api.openai.com/v1/chat/completions';

    const headers: Record<string, string> = config.LLM_PROVIDER === 'anthropic'
      ? { 'x-api-key': config.LLM_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
      : { Authorization: `Bearer ${config.LLM_API_KEY}`, 'Content-Type': 'application/json' };

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) return null;

    const data = await response.json();
    const content = config.LLM_PROVIDER === 'anthropic'
      ? data.content?.find((e: any) => e.type === 'text')?.text
      : data.choices?.[0]?.message?.content;

    if (!content) return null;

    const trimmed = content.trim();
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;

    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as RecommendationDraft;
  } catch (err) {
    logger.warn({ err }, 'LLM draft generation failed');
    return null;
  }
}

function fallbackDraft(leak: LeakForDraft, teamCtx: TeamContext): RecommendationDraft {
  const fixSummary = typeof leak.recommended_fix?.summary === 'string'
    ? leak.recommended_fix.summary
    : 'Review the detected process leak and take corrective action.';

  return {
    title: `Address ${leak.leak_type.replace(/_/g, ' ')}${teamCtx.teamName ? ` for ${teamCtx.teamName}` : ''}`,
    summary: fixSummary,
    rationale: `Detected ${leak.leak_type} with severity ${leak.severity}. ${leak.ai_diagnosis?.explanation || ''}`.trim(),
    dri_suggestion: teamCtx.teamLead,
    expected_impact: 'Expected improvement within 1-2 sprints based on historical patterns.',
    confidence: Math.min(0.7, leak.confidence),
    evidence_chain: (leak.evidence_links || []).slice(0, 3).map((e) => ({
      provider: 'unknown',
      entity_id: e.entity_id || e.url,
      description: e.title || e.url,
    })),
  };
}

/**
 * Generate recommendation drafts as ledger commits for detected leaks.
 */
export async function generateRecommendationDrafts(companyId: string): Promise<void> {
  const log = logger.child({ companyId, job: 'ai-recommendation-drafts' });

  // Check AI budget
  const settingsResult = await query<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM companies WHERE id = $1`, [companyId],
  );
  const settings = settingsResult.rows[0]?.settings || {};
  const aiBudget = (settings.ai_budget_per_day as number) || 10;
  const enabledFeatures = (settings.ai_enabled_features as string[]) || [];

  if (enabledFeatures.length > 0 && !enabledFeatures.includes('commit_draft_generation')) {
    log.debug('AI recommendation drafts disabled via company settings');
    return;
  }

  // Count today's AI calls
  const usageResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ledger_commits
     WHERE company_id = $1 AND created_by = 'system:ai-draft'
       AND created_at::date = CURRENT_DATE`,
    [companyId],
  );
  const usedToday = parseInt(usageResult.rows[0]?.count || '0', 10);
  if (usedToday >= aiBudget) {
    log.info({ usedToday, aiBudget }, 'AI budget exhausted for today');
    return;
  }

  // Load leaks that need recommendation drafts
  const leaksResult = await query<LeakForDraft>(
    `SELECT id, company_id, leak_type, severity, confidence,
            team_id, project_id, evidence_links, metrics_context,
            recommended_fix, ai_diagnosis
     FROM leak_instances
     WHERE company_id = $1
       AND status IN ('detected', 'delivered')
       AND severity >= 40
       AND NOT EXISTS (
         SELECT 1 FROM ledger_commits lc
         WHERE lc.leak_instance_id = leak_instances.id
           AND lc.created_by = 'system:ai-draft'
       )
     ORDER BY severity DESC
     LIMIT $2`,
    [companyId, Math.min(5, aiBudget - usedToday)],
  );

  if (leaksResult.rows.length === 0) {
    log.debug('No leaks need recommendation drafts');
    return;
  }

  for (const leak of leaksResult.rows) {
    try {
      const teamCtx = await getTeamContext(companyId, leak.team_id);
      const draft = await callLLMForDraft(leak, teamCtx) || fallbackDraft(leak, teamCtx);

      await query(
        `INSERT INTO ledger_commits (
           company_id, commit_type, title, summary, rationale, dri,
           status, branch_name, scope_level, team_id, project_id,
           tags, leak_instance_id, created_by, evidence_links
         ) VALUES (
           $1, 'decision', $2, $3, $4, $5,
           'draft', $6, $7, $8, $9,
           $10, $11, 'system:ai-draft', $12
         )`,
        [
          companyId,
          draft.title,
          draft.summary,
          draft.rationale,
          draft.dri_suggestion,
          leak.team_id ? `team/${leak.team_id}` : 'main',
          leak.team_id ? 'team' : 'org',
          leak.team_id,
          leak.project_id,
          JSON.stringify(['ai-draft', `confidence:${Math.round(draft.confidence * 100)}`]),
          leak.id,
          JSON.stringify(draft.evidence_chain.map((e) => ({
            url: `flowguard://${e.provider}/${e.entity_id}`,
            title: e.description,
          }))),
        ],
      );

      log.info({ leakId: leak.id, title: draft.title }, 'AI recommendation draft created');
    } catch (err) {
      log.warn({ err, leakId: leak.id }, 'Failed to generate draft for leak');
    }
  }
}
