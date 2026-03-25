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
import { normalizeJiraEvents } from './normalizer.js';
import { jiraClient } from './client.js';
import { logger } from './logger.js';

/**
 * JiraAdapter — Implements PublisherAdapter for Jira.
 *
 * Handles:
 * - Inbound: webhook signature verification, payload normalization
 * - Outbound: add_comment, transition_issue, delete_comment via JiraClient
 * - Entity resolution: Jira issue lookup
 */
export class JiraAdapter extends BaseAdapter {
  readonly provider = 'jira' as const;
  readonly capabilities: AdapterCapability[] = [
    'webhook_ingest',
    'outbound_action',
    'entity_resolve',
  ];

  private webhookSecret: string;

  constructor(webhookSecret: string) {
    super({ logger });
    this.webhookSecret = webhookSecret;
  }

  // ---- Inbound: Webhook Handling ----

  async verifySignature(req: WebhookRequest): Promise<boolean> {
    if (!this.webhookSecret) {
      logger.warn('Jira webhook secret not configured — skipping verification');
      return true;
    }

    const rawBody = req.rawBody;
    if (!rawBody) return false;

    // Jira sends signature in various header formats
    const signature = (
      req.headers['x-hub-signature-256'] ||
      req.headers['x-atlassian-webhook-signature'] ||
      req.headers['x-hub-signature']
    ) as string | undefined;

    if (!signature) return false;

    const expectedHmac = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody, 'utf-8')
      .digest('hex');

    const receivedHex = signature.startsWith('sha256=')
      ? signature.slice(7)
      : signature;

    if (expectedHmac.length !== receivedHex.length) return false;

    return crypto.timingSafeEqual(
      Buffer.from(expectedHmac, 'utf-8'),
      Buffer.from(receivedHex, 'utf-8'),
    );
  }

  async handleWebhook(req: WebhookRequest): Promise<NormalizedEvent[]> {
    const body = typeof req.body === 'object' && req.body !== null
      ? req.body as Record<string, any>
      : {};

    // Resolve company from Jira context
    const companyId = await this.resolveCompanyId(body);

    return normalizeJiraEvents(body, companyId);
  }

  // ---- Outbound: Execute Actions ----

  protected async doExecuteAction(action: OutboundAction): Promise<ActionResult> {
    const integration = await this.getActiveIntegration(action.companyId);
    if (!integration) {
      return {
        success: false,
        provider: 'jira',
        executionDetails: { reason: 'missing_jira_credentials_or_base_url' },
        rollbackInfo: { canRollback: false, rollbackData: {} },
        error: 'No active Jira integration found',
      };
    }

    try {
      if (action.actionType === 'add_comment') {
        const commentBody =
          (action.payload.text as string) ||
          (action.payload.description as string) ||
          'FlowGuard suggestion: please review and confirm owner/due date.';

        const result = await jiraClient.addComment(
          integration,
          action.targetId,
          commentBody,
          { useAdf: action.payload.use_adf as boolean | undefined },
        );

        return {
          success: true,
          provider: 'jira',
          executionDetails: {
            issue_key: action.targetId,
            comment_id: result.id,
          },
          rollbackInfo: {
            canRollback: true,
            rollbackType: 'delete_comment',
            rollbackData: {
              issue_key: action.targetId,
              comment_id: result.id,
            },
          },
        };
      }

      if (action.actionType === 'transition_issue') {
        await jiraClient.transitionIssue(
          integration,
          action.targetId,
          action.payload.transition_id as string,
        );

        return {
          success: true,
          provider: 'jira',
          executionDetails: {
            issue_key: action.targetId,
            transition_id: action.payload.transition_id,
          },
          rollbackInfo: { canRollback: false, rollbackData: {} },
        };
      }

      return {
        success: false,
        provider: 'jira',
        executionDetails: { reason: 'unsupported_action_type', actionType: action.actionType },
        rollbackInfo: { canRollback: false, rollbackData: {} },
        error: `Unsupported action type: ${action.actionType}`,
      };
    } catch (error) {
      logger.error({ error, actionType: action.actionType }, 'Jira action execution failed');
      return {
        success: false,
        provider: 'jira',
        executionDetails: { reason: 'api_error' },
        rollbackInfo: { canRollback: false, rollbackData: {} },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  protected async doRollbackAction(action: OutboundAction, _executionId: string): Promise<RollbackResult> {
    const integration = await this.getActiveIntegration(action.companyId);
    if (!integration) {
      return { success: false, reason: 'No active Jira integration' };
    }

    try {
      const issueKey = action.payload.issue_key as string;
      const commentId = action.payload.comment_id as string;
      if (issueKey && commentId) {
        await jiraClient.deleteComment(integration, issueKey, commentId);
        return { success: true };
      }
      return { success: false, reason: 'Missing issue_key/comment_id for rollback' };
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : 'Rollback failed' };
    }
  }

  // ---- Entity Resolution ----

  async resolveEntity(ref: EntityReference): Promise<ResolvedEntity | null> {
    if (ref.provider !== 'jira') return null;
    return {
      provider: 'jira',
      entityType: ref.entityType,
      entityId: ref.entityId,
      url: ref.url,
      title: ref.title,
      metadata: {},
    };
  }

  // ---- Health Check ----

  async healthCheck(integration: Integration): Promise<HealthStatus> {
    const result = await jiraClient.testConnection(integration);
    return {
      healthy: result.ok,
      provider: 'jira',
      latencyMs: result.latencyMs,
      details: {},
    };
  }

  // ---- Private helpers ----

  private async resolveCompanyId(body: Record<string, any>): Promise<string> {
    const cloudId = body.cloudId;
    const projectKey = body.issue?.fields?.project?.key;

    if (cloudId) {
      const result = await query<{ company_id: string }>(
        `SELECT company_id FROM integrations
         WHERE provider = 'jira' AND installation_data->>'cloud_id' = $1
         LIMIT 1`,
        [cloudId],
      );
      if (result.rows[0]?.company_id) return result.rows[0].company_id;
    }

    if (projectKey) {
      const result = await query<{ company_id: string }>(
        `SELECT company_id FROM integrations
         WHERE provider = 'jira' AND installation_data->'project_keys' ? $1
         LIMIT 1`,
        [projectKey],
      );
      if (result.rows[0]?.company_id) return result.rows[0].company_id;
    }

    // Fall back to default company
    const defaultResult = await query<{ id: string }>(
      `SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`,
    );
    if (defaultResult.rows[0]?.id) return defaultResult.rows[0].id;

    throw new Error('No company found for Jira webhook');
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
       WHERE company_id = $1 AND provider = 'jira' AND status = 'active'
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
