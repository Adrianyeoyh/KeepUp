import type { EventPayloadMap } from '@flowguard/event-bus';
import type { EventEnvelope } from '@flowguard/event-bus';
import { TOPICS } from '@flowguard/event-bus';
import { adapterRegistry } from '@flowguard/adapter-sdk';
import { query, listCompanyIds } from '@flowguard/db';
import { logger } from '../logger.js';

type DigestTickPayload = EventPayloadMap[typeof TOPICS.DIGEST_TICK];

/**
 * Handler for digest.tick topic.
 *
 * Builds and delivers digests via the adapter registry.
 * Uses adapterRegistry.executeAction() instead of direct Slack SDK imports.
 *
 * Migrated from apps/worker/src/services/digest-builder.ts + digest-service.ts.
 */
export async function onDigestTick(
  payload: DigestTickPayload,
  envelope: EventEnvelope<DigestTickPayload>,
): Promise<void> {
  logger.info(
    { digestType: payload.digestType, companyId: payload.companyId, traceId: envelope.traceId },
    'Digest tick received',
  );

  // Determine which companies to process
  const companyIds = payload.companyId
    ? [payload.companyId]
    : await listCompanyIds();

  for (const companyId of companyIds) {
    try {
      if (payload.digestType === 'daily') {
        await buildAndDeliverDailyDigest(companyId);
      } else if (payload.digestType === 'morning_pulse') {
        await buildAndDeliverMorningPulse(companyId);
      } else if (payload.digestType === 'nudges') {
        await buildAndDeliverNudges(companyId);
      }

      logger.info({ companyId, digestType: payload.digestType }, 'Digest delivered');
    } catch (err) {
      logger.error({ err, companyId, digestType: payload.digestType }, 'Digest delivery failed');
    }
  }
}

async function buildAndDeliverDailyDigest(companyId: string): Promise<void> {
  // Query digest data from DB
  const leaks = await query(
    `SELECT id, leak_type, severity, status, detected_at, summary
     FROM leak_instances
     WHERE company_id = $1 AND status = 'active'
     ORDER BY severity DESC LIMIT 10`,
    [companyId],
  );

  if (leaks.rows.length === 0) return;

  // Build digest message
  const lines = ['*FlowGuard Daily Digest*\n'];
  for (const leak of leaks.rows) {
    lines.push(`- [${leak.severity}] ${leak.leak_type}: ${leak.summary || 'No summary'}`);
  }
  const message = lines.join('\n');

  // Get delivery channels from company settings
  const channels = await getDeliveryChannels(companyId);

  // Deliver via adapter registry (not direct Slack SDK)
  for (const channel of channels) {
    if (adapterRegistry.has('slack')) {
      await adapterRegistry.executeAction({
        provider: 'slack',
        actionType: 'post_message',
        targetId: channel,
        companyId,
        payload: { text: message },
        riskLevel: 'low',
        metadata: { digest_type: 'daily' },
      });
    }
  }
}

async function buildAndDeliverMorningPulse(companyId: string): Promise<void> {
  // Simplified morning pulse — query recent activity
  const eventCount = await query(
    `SELECT COUNT(*) as count FROM events
     WHERE company_id = $1 AND timestamp > NOW() - INTERVAL '24 hours'`,
    [companyId],
  );

  const count = parseInt(eventCount.rows[0]?.count || '0', 10);
  if (count === 0) return;

  const message = `*FlowGuard Morning Pulse*\n${count} events processed in the last 24 hours.`;

  const channels = await getDeliveryChannels(companyId);
  for (const channel of channels) {
    if (adapterRegistry.has('slack')) {
      await adapterRegistry.executeAction({
        provider: 'slack',
        actionType: 'post_message',
        targetId: channel,
        companyId,
        payload: { text: message },
        riskLevel: 'low',
        metadata: { digest_type: 'morning_pulse' },
      });
    }
  }
}

async function buildAndDeliverNudges(companyId: string): Promise<void> {
  // Proactive nudges — find stale threads/PRs
  logger.debug({ companyId }, 'Nudge delivery — placeholder for migrated logic');
}

async function getDeliveryChannels(companyId: string): Promise<string[]> {
  const result = await query<{ settings: Record<string, any> }>(
    `SELECT settings FROM companies WHERE id = $1`,
    [companyId],
  );

  const settings = result.rows[0]?.settings || {};
  const channels = settings.digest_channel_ids;
  return Array.isArray(channels) ? channels : [];
}
