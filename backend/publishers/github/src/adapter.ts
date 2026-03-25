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
import { normalizeGitHubEvents } from './normalizer.js';
import { githubClient, parseGitHubTarget } from './client.js';
import { logger } from './logger.js';

/**
 * GitHubAdapter — Implements PublisherAdapter for GitHub.
 *
 * Handles:
 * - Inbound: HMAC-SHA256 webhook signature verification, payload normalization
 * - Outbound: add_pr_comment, request_review, delete_comment via GitHubClient
 * - Entity resolution: PR lookup
 */
export class GitHubAdapter extends BaseAdapter {
  readonly provider = 'github' as const;
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
      logger.warn('GitHub webhook secret not configured — skipping verification');
      return true;
    }

    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = req.rawBody;

    if (!signature || !rawBody) return false;

    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (signature.length !== expectedSignature.length) return false;

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );
  }

  async handleWebhook(req: WebhookRequest): Promise<NormalizedEvent[]> {
    const body = typeof req.body === 'object' && req.body !== null
      ? req.body as Record<string, any>
      : {};

    const githubEvent = req.headers['x-github-event'] as string || '';
    const deliveryId = (req.headers['x-github-delivery'] as string) || `delivery-${Date.now()}`;

    // Resolve company
    const companyId = await this.resolveCompanyId(body);

    return normalizeGitHubEvents(body, githubEvent, deliveryId, companyId);
  }

  // ---- Outbound: Execute Actions ----

  protected async doExecuteAction(action: OutboundAction): Promise<ActionResult> {
    const integration = await this.getActiveIntegration(action.companyId);
    if (!integration) {
      return {
        success: false,
        provider: 'github',
        executionDetails: { reason: 'missing_github_token' },
        rollbackInfo: { canRollback: false, rollbackData: {} },
        error: 'No active GitHub integration found',
      };
    }

    try {
      if (action.actionType === 'add_pr_comment') {
        const parsed = parseGitHubTarget(action.targetId);
        if (!parsed) {
          return {
            success: false,
            provider: 'github',
            executionDetails: { reason: 'invalid_target_id_format_expected_owner_repo_pr' },
            rollbackInfo: { canRollback: false, rollbackData: {} },
            error: 'Invalid target ID format',
          };
        }

        const commentBody =
          (action.payload.text as string) ||
          (action.payload.description as string) ||
          'FlowGuard reviewer ping: this PR appears to be waiting for review.';

        const result = await githubClient.addPRComment(
          integration,
          parsed.owner,
          parsed.repo,
          parsed.prNumber,
          commentBody,
        );

        return {
          success: true,
          provider: 'github',
          executionDetails: {
            target: action.targetId,
            comment_id: result.id,
            comment_url: result.htmlUrl,
          },
          rollbackInfo: {
            canRollback: true,
            rollbackType: 'delete_comment',
            rollbackData: {
              owner: parsed.owner,
              repo: parsed.repo,
              comment_id: result.id,
            },
          },
        };
      }

      if (action.actionType === 'request_review') {
        const parsed = parseGitHubTarget(action.targetId);
        if (!parsed) {
          return {
            success: false,
            provider: 'github',
            executionDetails: { reason: 'invalid_target_id' },
            rollbackInfo: { canRollback: false, rollbackData: {} },
            error: 'Invalid target ID format',
          };
        }

        const reviewers = (action.payload.reviewers as string[]) || [];
        await githubClient.requestReview(
          integration,
          parsed.owner,
          parsed.repo,
          parsed.prNumber,
          reviewers,
        );

        return {
          success: true,
          provider: 'github',
          executionDetails: { target: action.targetId, reviewers },
          rollbackInfo: { canRollback: false, rollbackData: {} },
        };
      }

      return {
        success: false,
        provider: 'github',
        executionDetails: { reason: 'unsupported_action_type', actionType: action.actionType },
        rollbackInfo: { canRollback: false, rollbackData: {} },
        error: `Unsupported action type: ${action.actionType}`,
      };
    } catch (error) {
      logger.error({ error, actionType: action.actionType }, 'GitHub action execution failed');
      return {
        success: false,
        provider: 'github',
        executionDetails: { reason: 'api_error' },
        rollbackInfo: { canRollback: false, rollbackData: {} },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  protected async doRollbackAction(action: OutboundAction, _executionId: string): Promise<RollbackResult> {
    const integration = await this.getActiveIntegration(action.companyId);
    if (!integration) {
      return { success: false, reason: 'No active GitHub integration' };
    }

    try {
      const owner = action.payload.owner as string;
      const repo = action.payload.repo as string;
      const commentId = action.payload.comment_id as number;

      if (owner && repo && commentId) {
        await githubClient.deleteComment(integration, owner, repo, commentId);
        return { success: true };
      }
      return { success: false, reason: 'Missing rollback data' };
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : 'Rollback failed' };
    }
  }

  // ---- Entity Resolution ----

  async resolveEntity(ref: EntityReference): Promise<ResolvedEntity | null> {
    if (ref.provider !== 'github') return null;
    return {
      provider: 'github',
      entityType: ref.entityType,
      entityId: ref.entityId,
      url: ref.url,
      title: ref.title,
      metadata: {},
    };
  }

  // ---- Health Check ----

  async healthCheck(integration: Integration): Promise<HealthStatus> {
    const result = await githubClient.testConnection(integration);
    return {
      healthy: result.ok,
      provider: 'github',
      latencyMs: result.latencyMs,
      details: {},
    };
  }

  // ---- Private helpers ----

  private async resolveCompanyId(body: Record<string, any>): Promise<string> {
    const repoFullName = body.repository?.full_name;

    if (repoFullName) {
      const result = await query<{ company_id: string }>(
        `SELECT company_id FROM integrations
         WHERE provider = 'github'
           AND (installation_data->>'repo_full_name' = $1
             OR installation_data->'repositories' ? $1)
         LIMIT 1`,
        [repoFullName],
      );
      if (result.rows[0]?.company_id) return result.rows[0].company_id;
    }

    const defaultResult = await query<{ id: string }>(
      `SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`,
    );
    if (defaultResult.rows[0]?.id) return defaultResult.rows[0].id;

    throw new Error('No company found for GitHub webhook');
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
       WHERE company_id = $1 AND provider = 'github' AND status = 'active'
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
