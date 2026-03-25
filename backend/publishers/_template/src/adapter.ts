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
import { logger } from './logger.js';

// ============================================
// Publisher Adapter Template
// ============================================
//
// This file is the core of your publisher. It extends BaseAdapter (which
// provides retry with exponential backoff, circuit breaker, and rate limiting)
// and implements the PublisherAdapter interface.
//
// TODO: Replace 'TemplateAdapter' with your provider name, e.g., 'LinearAdapter'
// TODO: Replace 'template' provider name with your provider, e.g., 'linear'
// TODO: Implement all methods marked with TODO below
//
// See backend/publishers/slack/src/adapter.ts for a complete working example.

export class TemplateAdapter extends BaseAdapter {
  // TODO: Replace 'template' with your provider name (must be lowercase)
  readonly provider = 'template' as const;

  // TODO: Update capabilities based on what your provider supports:
  //   'webhook_ingest'  — Can receive webhooks from the provider
  //   'outbound_action' — Can execute actions on the provider (post, comment, etc.)
  //   'entity_resolve'  — Can resolve cross-platform entity references
  readonly capabilities: AdapterCapability[] = [
    'webhook_ingest',
    'outbound_action',
    'entity_resolve',
  ];

  // TODO: Add any provider-specific instance variables here
  // private signingSecret: string;
  // private apiKey: string;

  constructor(/* TODO: Add constructor params, e.g., signingSecret: string */) {
    super({ logger });
    // TODO: Store constructor params
    // this.signingSecret = signingSecret;
  }

  // ============================================
  // Inbound: Webhook Signature Verification
  // ============================================
  //
  // Verify that the incoming webhook is genuinely from your provider.
  // Most providers use HMAC-SHA256 signatures. Check your provider's docs.
  //
  // TODO: Implement signature verification using your provider's method.
  //       See Slack (HMAC-SHA256 with timestamp) or GitHub (HMAC-SHA256)
  //       as examples.

  async verifySignature(req: WebhookRequest): Promise<boolean> {
    // TODO: Implement signature verification
    //
    // Example pattern (HMAC-SHA256):
    //
    // const signature = req.headers['x-provider-signature'] as string;
    // if (!signature) return false;
    //
    // const expected = crypto
    //   .createHmac('sha256', this.signingSecret)
    //   .update(req.rawBody)
    //   .digest('hex');
    //
    // return crypto.timingSafeEqual(
    //   Buffer.from(signature),
    //   Buffer.from(expected),
    // );

    logger.warn('verifySignature not implemented — allowing all webhooks through');
    return true;
  }

  // ============================================
  // Inbound: Webhook Parsing
  // ============================================
  //
  // Parse the raw webhook payload and return NormalizedEvent[].
  // This is where you map provider-specific events to FlowGuard's
  // normalized format.
  //
  // TODO: Parse the webhook body and delegate to normalizer.ts
  //       See backend/publishers/slack/src/adapter.ts handleWebhook()

  async handleWebhook(req: WebhookRequest): Promise<NormalizedEvent[]> {
    const body = typeof req.body === 'object' && req.body !== null
      ? req.body as Record<string, any>
      : {};

    // TODO: Extract company/team context from the webhook payload.
    //       You'll need to look up the companyId from your provider's
    //       tenant identifier (e.g., workspace ID, org ID).
    //
    // const providerOrgId = body.organization?.id;
    // const companyId = await this.resolveCompanyId(providerOrgId);

    // TODO: Call your normalizer to convert the raw payload
    //       into NormalizedEvent[]:
    //
    // return normalizeTemplateEvent(body, companyId);

    logger.warn({ body }, 'handleWebhook not implemented');
    return [];
  }

  // ============================================
  // Outbound: Execute Actions
  // ============================================
  //
  // Execute an action on your provider's platform. Called by the executor
  // consumer through the adapter registry.
  //
  // Common action types: 'post_message', 'add_comment', 'create_issue',
  //   'transition_issue', 'request_review', etc.
  //
  // TODO: Implement each action type your provider supports.
  //       Use your client.ts for the actual API calls.
  //       See backend/publishers/slack/src/adapter.ts doExecuteAction()

  protected async doExecuteAction(action: OutboundAction): Promise<ActionResult> {
    // TODO: Look up the active integration for this company
    // const integration = await this.getActiveIntegration(action.companyId);
    // if (!integration) {
    //   return {
    //     success: false,
    //     provider: this.provider,
    //     executionDetails: { reason: 'missing_integration' },
    //     rollbackInfo: { canRollback: false, rollbackData: {} },
    //     error: 'No active integration found',
    //   };
    // }

    // TODO: Switch on action.actionType and call your client methods
    //
    // if (action.actionType === 'post_comment') {
    //   const result = await templateClient.addComment(
    //     integration,
    //     action.targetId,
    //     action.payload.body as string,
    //   );
    //   return {
    //     success: true,
    //     provider: this.provider,
    //     executionDetails: { commentId: result.id },
    //     rollbackInfo: {
    //       canRollback: true,
    //       rollbackType: 'delete_comment',
    //       rollbackData: { commentId: result.id },
    //     },
    //   };
    // }

    return {
      success: false,
      provider: this.provider,
      executionDetails: { reason: 'not_implemented' },
      rollbackInfo: { canRollback: false, rollbackData: {} },
      error: `Action type "${action.actionType}" not implemented`,
    };
  }

  // ============================================
  // Outbound: Rollback Actions
  // ============================================
  //
  // Undo a previously executed action (e.g., delete a posted message).
  //
  // TODO: Implement rollback for each reversible action type.
  //       The rollback data from doExecuteAction() is available in action.payload.

  protected async doRollbackAction(
    action: OutboundAction,
    executionId: string,
  ): Promise<RollbackResult> {
    // TODO: Implement rollback logic
    //
    // Example:
    // const integration = await this.getActiveIntegration(action.companyId);
    // if (!integration) {
    //   return { success: false, reason: 'No active integration' };
    // }
    //
    // if (action.payload.rollbackType === 'delete_comment') {
    //   await templateClient.deleteComment(
    //     integration,
    //     action.payload.commentId as string,
    //   );
    //   return { success: true };
    // }

    return { success: false, reason: 'Rollback not implemented' };
  }

  // ============================================
  // Entity Resolution
  // ============================================
  //
  // Resolve a cross-platform entity reference to get details from your
  // provider. Used for entity linking (e.g., looking up a Jira issue
  // mentioned in a Slack message).
  //
  // TODO: Implement entity resolution for your provider's entity types.

  async resolveEntity(ref: EntityReference): Promise<ResolvedEntity | null> {
    if (ref.provider !== this.provider) return null;

    // TODO: Look up the entity in your provider's API
    //
    // Example:
    // if (ref.entityType === 'issue') {
    //   const issue = await templateClient.getIssue(ref.entityId);
    //   return {
    //     provider: this.provider,
    //     entityType: 'issue',
    //     entityId: ref.entityId,
    //     url: issue.url,
    //     title: issue.title,
    //     metadata: { status: issue.status },
    //   };
    // }

    return {
      provider: this.provider,
      entityType: ref.entityType,
      entityId: ref.entityId,
      url: ref.url,
      title: ref.title,
      metadata: {},
    };
  }

  // ============================================
  // Health Check
  // ============================================
  //
  // Check connectivity to your provider's API.
  //
  // TODO: Implement a lightweight API call to verify the integration is working.

  async healthCheck(integration: Integration): Promise<HealthStatus> {
    // TODO: Make a lightweight API call to check connectivity
    //
    // Example:
    // const start = Date.now();
    // try {
    //   await templateClient.ping(integration);
    //   return {
    //     healthy: true,
    //     provider: this.provider,
    //     latencyMs: Date.now() - start,
    //     details: {},
    //   };
    // } catch (error) {
    //   return {
    //     healthy: false,
    //     provider: this.provider,
    //     latencyMs: Date.now() - start,
    //     details: { error: error instanceof Error ? error.message : 'Unknown' },
    //   };
    // }

    return {
      healthy: false,
      provider: this.provider,
      details: { reason: 'Health check not implemented' },
    };
  }

  // ============================================
  // Private Helpers
  // ============================================

  // TODO: Add helper methods for your adapter. Common patterns:
  //
  // private async resolveCompanyId(providerOrgId: string): Promise<string> {
  //   const result = await query<{ company_id: string }>(
  //     `SELECT company_id FROM integrations
  //      WHERE provider = $1 AND installation_data->>'org_id' = $2
  //      LIMIT 1`,
  //     [this.provider, providerOrgId],
  //   );
  //   if (result.rows[0]?.company_id) return result.rows[0].company_id;
  //   throw new Error(`No company found for ${this.provider} org ${providerOrgId}`);
  // }
  //
  // private async getActiveIntegration(companyId: string): Promise<Integration | null> {
  //   const result = await query(
  //     `SELECT * FROM integrations
  //      WHERE company_id = $1 AND provider = $2 AND status = 'active'
  //      LIMIT 1`,
  //     [companyId, this.provider],
  //   );
  //   if (!result.rows[0]) return null;
  //   const row = result.rows[0];
  //   return {
  //     id: row.id,
  //     companyId: row.company_id,
  //     provider: row.provider,
  //     status: row.status,
  //     tokenData: row.token_data,
  //     installationData: row.installation_data,
  //   };
  // }
}
