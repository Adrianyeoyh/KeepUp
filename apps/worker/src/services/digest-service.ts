import { WebClient } from '@slack/web-api';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { query } from '../db/client.js';
import { buildDigestBlocks, type DigestRole } from './digest-builder.js';
import { generateDiagnosis } from './ai-orchestrator.js';

type CompanySettings = {
  confidence_threshold?: number;
  insight_budget_per_day?: number;
  digest_user_ids?: string[];
  digest_roles?: Record<string, DigestRole>;
};

type LeakRow = {
  id: string;
  company_id: string;
  leak_type: string;
  severity: number;
  confidence: number;
  evidence_links: Array<{ url: string; title?: string; entity_id?: string }>;
  metrics_context: {
    current_value: number;
    baseline_value: number;
    metric_name: string;
    delta_percentage: number;
  };
  recommended_fix: {
    summary?: string;
    action_type?: string;
    details?: Record<string, unknown>;
  };
  cost_estimate_hours_per_week?: number | null;
  ai_diagnosis?: {
    explanation?: string;
    root_cause?: string;
    confidence?: number;
  } | null;
};

type CompanyRow = {
  settings: CompanySettings;
};

function parseCompanySettings(raw: unknown): CompanySettings {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const settings = raw as CompanySettings;
  return {
    confidence_threshold: settings.confidence_threshold,
    insight_budget_per_day: settings.insight_budget_per_day,
    digest_user_ids: Array.isArray(settings.digest_user_ids) ? settings.digest_user_ids : [],
  };
}

async function getCompanySettings(companyId: string): Promise<CompanySettings> {
  const result = await query<CompanyRow>(
    `SELECT settings
     FROM companies
     WHERE id = $1
     LIMIT 1`,
    [companyId],
  );

  return parseCompanySettings(result.rows[0]?.settings);
}

async function getActiveSlackToken(companyId: string): Promise<string | null> {
  const result = await query<{ bot_token: string | null }>(
    `SELECT token_data->>'bot_token' AS bot_token
     FROM integrations
     WHERE company_id = $1
       AND provider = 'slack'
       AND status = 'active'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [companyId],
  );

  return result.rows[0]?.bot_token || null;
}

async function loadCandidateLeaks(companyId: string): Promise<LeakRow[]> {
  const result = await query<LeakRow>(
    `SELECT
      id,
      company_id,
      leak_type,
      severity,
      confidence,
      evidence_links,
      metrics_context,
      recommended_fix,
      cost_estimate_hours_per_week,
      ai_diagnosis
     FROM leak_instances
     WHERE company_id = $1
       AND status = 'detected'
       AND detected_at::date >= CURRENT_DATE - INTERVAL '2 days'
     ORDER BY severity DESC, confidence DESC
     LIMIT 30`,
    [companyId],
  );

  return result.rows;
}

async function saveAIDiagnosis(leakId: string, diagnosis: unknown): Promise<void> {
  await query(
    `UPDATE leak_instances
     SET ai_diagnosis = $1, updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(diagnosis), leakId],
  );
}

async function markLeakStatuses(leakIds: string[], status: 'delivered' | 'suppressed'): Promise<void> {
  if (leakIds.length === 0) {
    return;
  }

  await query(
    `UPDATE leak_instances
     SET status = $1, updated_at = NOW()
     WHERE id = ANY($2::uuid[])`,
    [status, leakIds],
  );
}

async function insertDigestEvent(companyId: string, leakIds: string[], recipients: string[]): Promise<void> {
  await query(
    `INSERT INTO events (
      company_id,
      source,
      entity_id,
      event_type,
      timestamp,
      metadata,
      provider_event_id
    )
    VALUES ($1, 'system', $2, 'system.digest_sent', NOW(), $3, $4)
    ON CONFLICT (provider_event_id, source, company_id) DO NOTHING`,
    [
      companyId,
      'daily-digest',
      JSON.stringify({
        leak_ids: leakIds,
        recipients,
      }),
      `digest:${companyId}:${new Date().toISOString().slice(0, 10)}`,
    ],
  );
}

export async function runDailyDigest(companyId: string): Promise<void> {
  const settings = await getCompanySettings(companyId);
  const confidenceThreshold = settings.confidence_threshold ?? config.CONFIDENCE_THRESHOLD;
  const budget = Math.max(1, Math.min(3, settings.insight_budget_per_day ?? config.INSIGHT_BUDGET_PER_DAY));

  const leaks = await loadCandidateLeaks(companyId);
  if (leaks.length === 0) {
    logger.info({ companyId }, 'No detected leaks for digest');
    return;
  }

  const eligible = leaks.filter((leak) => {
    const hasEvidence = Array.isArray(leak.evidence_links) && leak.evidence_links.length > 0;
    return hasEvidence && leak.confidence >= confidenceThreshold;
  });

  const selected = eligible.slice(0, budget);
  const suppressedForThreshold = leaks
    .filter((leak) => !selected.find((picked) => picked.id === leak.id))
    .map((leak) => leak.id);

  for (const leak of selected) {
    const diagnosis = await generateDiagnosis({
      leak_type: leak.leak_type,
      severity: leak.severity,
      confidence: leak.confidence,
      evidence_links: leak.evidence_links || [],
      metrics_context: leak.metrics_context || {},
      recommended_fix: leak.recommended_fix || {},
    });

    leak.ai_diagnosis = diagnosis;
    await saveAIDiagnosis(leak.id, diagnosis);
  }

  await markLeakStatuses(suppressedForThreshold, 'suppressed');

  if (selected.length === 0) {
    logger.info({ companyId, confidenceThreshold }, 'No leaks passed digest confidence/evidence policy gates');
    return;
  }

  const recipients = settings.digest_user_ids || [];
  const digestRoles = settings.digest_roles || {};
  const slackToken = await getActiveSlackToken(companyId);

  if (!slackToken || recipients.length === 0) {
    const defaultBlocks = buildDigestBlocks(selected, 'lead');
    logger.info({
      companyId,
      reason: !slackToken ? 'missing_slack_token' : 'missing_recipients',
      digest_preview: defaultBlocks,
    }, 'Digest generated but not delivered; review configuration');
    return;
  }

  const client = new WebClient(slackToken);

  const deliveredRecipients: string[] = [];
  for (const userId of recipients) {
    try {
      const role: DigestRole = digestRoles[userId] || 'lead';
      const blocks = buildDigestBlocks(selected, role);
      await client.chat.postMessage({
        channel: userId,
        text: 'FlowGuard Daily Digest',
        blocks: blocks as any,
      });
      deliveredRecipients.push(userId);
    } catch (error) {
      logger.error({ error, userId, companyId }, 'Failed to deliver digest DM');
    }
  }

  if (deliveredRecipients.length > 0) {
    await markLeakStatuses(selected.map((leak) => leak.id), 'delivered');
    await insertDigestEvent(companyId, selected.map((leak) => leak.id), deliveredRecipients);
  }
}
