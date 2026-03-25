import { query } from '@flowguard/db';
import { adapterRegistry } from '@flowguard/adapter-sdk';
import { logger } from '../logger.js';
import { buildDigestBlocks, type DigestRole, type LeakDigestRow } from './digest-builder.js';

/**
 * Digest Service — Builds and delivers daily digests.
 *
 * Migrated from apps/worker/src/services/digest-service.ts.
 * Key changes:
 *   - Uses `@flowguard/db` query() instead of local db client
 *   - Slack delivery uses `adapterRegistry.executeAction()` instead of WebClient
 *   - AI diagnosis generation is triggered via EventBus (ai.diagnosis.req) rather
 *     than called inline; for now uses stored ai_diagnosis from leak_instances.
 *
 * All business logic preserved from the original implementation.
 */

type CompanySettings = {
  confidence_threshold?: number;
  insight_budget_per_day?: number;
  digest_user_ids?: string[];
  digest_roles?: Record<string, DigestRole>;
};

function parseCompanySettings(raw: unknown): CompanySettings {
  if (!raw || typeof raw !== 'object') return {};
  const settings = raw as CompanySettings;
  return {
    confidence_threshold: settings.confidence_threshold,
    insight_budget_per_day: settings.insight_budget_per_day,
    digest_user_ids: Array.isArray(settings.digest_user_ids) ? settings.digest_user_ids : [],
    digest_roles: settings.digest_roles,
  };
}

async function getCompanySettings(companyId: string): Promise<CompanySettings> {
  const result = await query<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM companies WHERE id = $1 LIMIT 1`,
    [companyId],
  );
  return parseCompanySettings(result.rows[0]?.settings);
}

async function loadCandidateLeaks(companyId: string): Promise<LeakDigestRow[]> {
  const result = await query<LeakDigestRow>(
    `SELECT
      id, company_id, leak_type, severity, confidence,
      evidence_links, metrics_context, recommended_fix,
      cost_estimate_hours_per_week, ai_diagnosis
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

async function markLeakStatuses(leakIds: string[], status: 'delivered' | 'suppressed'): Promise<void> {
  if (leakIds.length === 0) return;
  await query(
    `UPDATE leak_instances SET status = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])`,
    [status, leakIds],
  );
}

async function insertDigestEvent(
  companyId: string,
  leakIds: string[],
  recipients: string[],
): Promise<void> {
  await query(
    `INSERT INTO events (
      company_id, source, entity_id, event_type, timestamp, metadata, provider_event_id
    )
    VALUES ($1, 'system', $2, 'system.digest_sent', NOW(), $3, $4)
    ON CONFLICT (provider_event_id, source, company_id) DO NOTHING`,
    [
      companyId,
      'daily-digest',
      JSON.stringify({ leak_ids: leakIds, recipients }),
      `digest:${companyId}:${new Date().toISOString().slice(0, 10)}`,
    ],
  );
}

/**
 * Run the daily digest for a company.
 *
 * @param companyId - Company to generate digest for
 * @param confidenceThresholdOverride - Override the default confidence threshold
 * @param insightBudgetOverride - Override the default insight budget
 */
export async function runDailyDigest(
  companyId: string,
  confidenceThresholdOverride?: number,
  insightBudgetOverride?: number,
): Promise<void> {
  const settings = await getCompanySettings(companyId);
  const confidenceThreshold = confidenceThresholdOverride ?? settings.confidence_threshold ?? 0.5;
  const budget = Math.max(1, Math.min(3, insightBudgetOverride ?? settings.insight_budget_per_day ?? 3));

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

  await markLeakStatuses(suppressedForThreshold, 'suppressed');

  if (selected.length === 0) {
    logger.info({ companyId, confidenceThreshold }, 'No leaks passed digest confidence/evidence policy gates');
    return;
  }

  const recipients = settings.digest_user_ids || [];
  const digestRoles = settings.digest_roles || {};

  if (recipients.length === 0) {
    const defaultBlocks = buildDigestBlocks(selected, 'lead');
    logger.info({
      companyId,
      reason: 'missing_recipients',
      digest_preview: defaultBlocks,
    }, 'Digest generated but not delivered; review configuration');
    return;
  }

  // Deliver via adapter registry instead of direct Slack SDK
  const deliveredRecipients: string[] = [];
  for (const userId of recipients) {
    try {
      const role: DigestRole = digestRoles[userId] || 'lead';
      const blocks = buildDigestBlocks(selected, role);

      if (adapterRegistry.has('slack')) {
        await adapterRegistry.executeAction({
          provider: 'slack',
          actionType: 'post_message',
          targetId: userId,
          companyId,
          payload: {
            text: 'FlowGuard Daily Digest',
            blocks,
          },
          riskLevel: 'low',
          metadata: { digest_type: 'daily', role },
        });
        deliveredRecipients.push(userId);
      } else {
        logger.warn({ companyId }, 'Slack adapter not registered — cannot deliver digest');
      }
    } catch (error) {
      logger.error({ error, userId, companyId }, 'Failed to deliver digest DM');
    }
  }

  if (deliveredRecipients.length > 0) {
    await markLeakStatuses(selected.map((leak) => leak.id), 'delivered');
    await insertDigestEvent(companyId, selected.map((leak) => leak.id), deliveredRecipients);
  }
}
