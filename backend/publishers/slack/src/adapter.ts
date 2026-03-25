import crypto from 'crypto';
import type {
  AdapterCapability,
  WebhookRequest,
  NormalizedEvent,
  OutboundAction,
  ActionResult,
  RollbackResult,
  EntityReference,
  ResolvedEntity,
  HealthStatus,
  Integration,
} from '@flowguard/adapter-sdk';
import { BaseAdapter } from '@flowguard/adapter-sdk';
import { query } from '@flowguard/db';
import { normalizeSlackEvent } from './normalizer.js';
import { slackClient } from './client.js';
import { logger } from './logger.js';

const SLACK_TIMESTAMP_MAX_AGE_SECONDS = 300;

/**
 * SlackAdapter — Implements PublisherAdapter for Slack.
 *
 * Handles:
 * - Inbound: webhook signature verification, payload normalization
 * - Outbound: post_message, open_dm, delete_message via SlackClient
 * - Entity resolution: Slack user/channel lookup
 */
export class SlackAdapter extends BaseAdapter {
  readonly provider = 'slack' as const;
  readonly capabilities: AdapterCapability[] = [
    'webhook_ingest',
    'outbound_action',
    'entity_resolve',
  ];

  private signingSecret: string;

  constructor(signingSecret: string) {
    super({ logger });
    this.signingSecret = signingSecret;
  }

  // ---- Inbound: Webhook Handling ----

  async verifySignature(req: WebhookRequest): Promise<boolean> {
    if (!this.signingSecret) {
      logger.warn('Slack signing secret not configured — skipping verification');
      return true;
    }

    // Allow url_verification challenges through
    const body = typeof req.body === 'object' && req.body !== null ? req.body as Record<string, any> : {};
    if (body.type === 'url_verification') return true;

    const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;
    const slackSignature = req.headers['x-slack-signature'] as string | undefined;
    const rawBody = req.rawBody;

    if (!timestamp || !slackSignature || !rawBody) return false;

    // Replay protection
    const requestTime = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - requestTime) > SLACK_TIMESTAMP_MAX_AGE_SECONDS) return false;

    // Compute expected signature
    const sigBaseString = `v0:${timestamp}:${rawBody}`;
    const expectedSignature = 'v0=' + crypto
      .createHmac('sha256', this.signingSecret)
      .update(sigBaseString, 'utf-8')
      .digest('hex');

    if (expectedSignature.length !== slackSignature.length) return false;

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf-8'),
      Buffer.from(slackSignature, 'utf-8'),
    );
  }

  async handleWebhook(req: WebhookRequest): Promise<NormalizedEvent[]> {
    const body = typeof req.body === 'object' && req.body !== null ? req.body as Record<string, any> : {};

    // URL verification challenge — return empty events
    if (body.type === 'url_verification') return [];

    // Resolve company from Slack team_id
    const teamId = body.team_id || body.event?.team;
    const companyId = await this.resolveCompanyId(teamId);

    return normalizeSlackEvent(body, companyId);
  }

  // ---- Outbound: Execute Actions ----

  protected async doExecuteAction(action: OutboundAction): Promise<ActionResult> {
    const integration = await this.getActiveIntegration(action.companyId);
    if (!integration) {
      return {
        success: false,
        provider: 'slack',
        executionDetails: { reason: 'missing_slack_bot_token' },
        rollbackInfo: { canRollback: false, rollbackData: {} },
        error: 'No active Slack integration found',
      };
    }

    try {
      if (action.actionType === 'post_message') {
        const result = await slackClient.postMessage(
          integration,
          action.targetId,
          (action.payload.text as string) || 'FlowGuard approved reminder.',
          {
            threadTs: action.payload.thread_ts as string | undefined,
            unfurlLinks: action.payload.unfurl_links as boolean | undefined,
          },
        );

        return {
          success: true,
          provider: 'slack',
          executionDetails: { channel: action.targetId, ts: result.ts },
          rollbackInfo: {
            canRollback: true,
            rollbackType: 'delete_message',
            rollbackData: { channel: action.targetId, ts: result.ts },
          },
        };
      }

      if (action.actionType === 'open_dm') {
        const result = await slackClient.openDMAndSend(
          integration,
          action.targetId,
          (action.payload.text as string) || 'FlowGuard notification.',
        );

        return {
          success: true,
          provider: 'slack',
          executionDetails: { channel: result.channel, ts: result.ts },
          rollbackInfo: {
            canRollback: true,
            rollbackType: 'delete_message',
            rollbackData: { channel: result.channel, ts: result.ts },
          },
        };
      }

      if (action.actionType === 'delete_message') {
        await slackClient.deleteMessage(
          integration,
          action.targetId,
          action.payload.ts as string,
        );

        return {
          success: true,
          provider: 'slack',
          executionDetails: { channel: action.targetId, ts: action.payload.ts },
          rollbackInfo: { canRollback: false, rollbackData: {} },
        };
      }

      return {
        success: false,
        provider: 'slack',
        executionDetails: { reason: 'unsupported_action_type', actionType: action.actionType },
        rollbackInfo: { canRollback: false, rollbackData: {} },
        error: `Unsupported action type: ${action.actionType}`,
      };
    } catch (error) {
      logger.error({ error, actionType: action.actionType }, 'Slack action execution failed');
      return {
        success: false,
        provider: 'slack',
        executionDetails: { reason: 'api_error' },
        rollbackInfo: { canRollback: false, rollbackData: {} },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  protected async doRollbackAction(action: OutboundAction, executionId: string): Promise<RollbackResult> {
    const integration = await this.getActiveIntegration(action.companyId);
    if (!integration) {
      return { success: false, reason: 'No active Slack integration' };
    }

    try {
      const channel = action.payload.channel as string;
      const ts = action.payload.ts as string;
      if (channel && ts) {
        await slackClient.deleteMessage(integration, channel, ts);
        return { success: true };
      }
      return { success: false, reason: 'Missing channel/ts for rollback' };
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : 'Rollback failed' };
    }
  }

  // ---- Entity Resolution ----

  async resolveEntity(ref: EntityReference): Promise<ResolvedEntity | null> {
    if (ref.provider !== 'slack') return null;
    // Basic resolution — return the reference as-is with metadata
    return {
      provider: 'slack',
      entityType: ref.entityType,
      entityId: ref.entityId,
      url: ref.url,
      title: ref.title,
      metadata: {},
    };
  }

  // ---- Health Check ----

  async healthCheck(integration: Integration): Promise<HealthStatus> {
    const result = await slackClient.testConnection(integration);
    return {
      healthy: result.ok,
      provider: 'slack',
      latencyMs: result.latencyMs,
      details: {},
    };
  }

  // ---- Private helpers ----

  private async resolveCompanyId(slackTeamId?: string): Promise<string> {
    if (slackTeamId) {
      const result = await query<{ company_id: string }>(
        `SELECT company_id FROM integrations
         WHERE provider = 'slack' AND installation_data->>'team_id' = $1
         LIMIT 1`,
        [slackTeamId],
      );
      if (result.rows[0]?.company_id) return result.rows[0].company_id;
    }

    // Fall back to default company
    const defaultResult = await query<{ id: string }>(
      `SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`,
    );
    if (defaultResult.rows[0]?.id) return defaultResult.rows[0].id;

    throw new Error('No company found for Slack webhook');
  }

  private async getActiveIntegration(companyId: string): Promise<Integration | null> {
    const result = await query<{
      id: string;
      company_id: string;
      provider: string;
      status: string;
      token_data: Record<string, unknown>;
      installation_data: Record<string, unknown>;
    }>(
      `SELECT * FROM integrations
       WHERE company_id = $1 AND provider = 'slack' AND status = 'active'
       LIMIT 1`,
      [companyId],
    );

    if (!result.rows[0]) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      companyId: row.company_id,
      provider: row.provider,
      status: row.status as 'active',
      tokenData: row.token_data,
      installationData: row.installation_data,
    };
  }
}
