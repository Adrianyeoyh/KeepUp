# How to Add a New Publisher Integration

This template provides everything you need to add a new integration to FlowGuard (e.g., Linear, Zendesk, Asana, GitLab). Follow these steps to go from zero to a fully working publisher microservice.

## Overview

A publisher is a microservice that:
- **Receives webhooks** from an external platform and normalizes them into `NormalizedEvent[]`
- **Executes outbound actions** on the platform (post comments, send messages, etc.)
- **Resolves entities** for cross-platform linking

Publishers are fully isolated. Adding a new one requires **zero changes to any consumer** (data-processor, digest, ledger, executor, ai-engine).

## Step-by-Step Guide

### 1. Copy the Template

```bash
cp -r backend/publishers/_template backend/publishers/your-provider
```

Replace `your-provider` with the lowercase name of the platform (e.g., `linear`, `zendesk`, `gitlab`).

### 2. Update package.json

Edit `backend/publishers/your-provider/package.json`:

```json
{
  "name": "@flowguard/publisher-your-provider",
  ...
}
```

Add any provider-specific SDK dependencies:

```json
{
  "dependencies": {
    "@linear/sdk": "^x.y.z"
  }
}
```

### 3. Implement the Adapter (`src/adapter.ts`)

This is the core file. Your adapter extends `BaseAdapter` and implements:

| Method | Purpose |
|--------|---------|
| `verifySignature(req)` | Verify webhook authenticity (HMAC, shared secret, etc.) |
| `handleWebhook(req)` | Parse webhooks into `NormalizedEvent[]` |
| `doExecuteAction(action)` | Execute outbound actions (post, comment, transition) |
| `doRollbackAction(action, id)` | Undo a previously executed action |
| `resolveEntity(ref)` | Look up entity details for cross-platform linking |
| `healthCheck(integration)` | Verify API connectivity |

```typescript
export class LinearAdapter extends BaseAdapter {
  readonly provider = 'linear' as const;
  readonly capabilities: AdapterCapability[] = [
    'webhook_ingest',
    'outbound_action',
    'entity_resolve',
  ];

  // ... implement methods
}
```

`BaseAdapter` gives you for free: retry with exponential backoff, circuit breaker, and structured logging.

### 4. Implement the Webhook Handler (`src/webhook-handler.ts`)

Create an Express router that:
1. Verifies webhook signatures (via your adapter)
2. Acknowledges the webhook quickly (most providers require < 3s response)
3. Processes the payload in the background
4. Publishes normalized events to the event bus

Handle any registration/verification challenges your provider requires (e.g., Slack's `url_verification`).

### 5. Implement the Client (`src/client.ts`)

Extend `BaseClient` to wrap your provider's API. The executor consumer calls these methods through the adapter interface.

```typescript
export class LinearClient extends BaseClient {
  constructor() {
    super({ baseUrl: 'https://api.linear.app' });
  }

  async addComment(integration: Integration, issueId: string, body: string) {
    return this.request('POST', `/graphql`, {
      body: { query: '...', variables: { issueId, body } },
      headers: { Authorization: `Bearer ${integration.tokenData.access_token}` },
    });
  }
}
```

### 6. Implement the Normalizer (`src/normalizer.ts`)

Convert raw webhook payloads into `NormalizedEvent[]`. Key fields:

| Field | Description |
|-------|-------------|
| `provider` | Your provider name (e.g., `'linear'`) |
| `eventType` | Namespaced event (e.g., `'linear.issue_created'`) |
| `entityId` | Unique entity ID within the provider |
| `providerEventId` | For idempotency (deduplicate repeated webhooks) |
| `companyId` | FlowGuard company UUID (resolved from provider org) |
| `crossReferences` | Auto-detected links to other platforms |

Always detect cross-references in text fields (Jira keys, GitHub PR URLs, Slack thread links).

### 7. Update Configuration (`src/config.ts`)

Add your provider-specific environment variables:

```typescript
const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3020),
  LINEAR_API_KEY: z.string(),
  LINEAR_WEBHOOK_SECRET: z.string(),
  // ...
});
```

### 8. Register in Gateway Routing

Add your webhook route in `backend/gateway/src/routes/`:

```typescript
// In gateway route setup:
app.use('/webhooks/your-provider', yourProviderWebhookRouter);
```

### 9. Add to Docker Compose

Add your service to `infra/docker-compose.yml`:

```yaml
your-provider-publisher:
  build:
    context: ../backend/publishers/your-provider
    dockerfile: Dockerfile
  environment:
    DATABASE_URL: postgresql://flowguard:flowguard@postgres:5432/flowguard
    REDIS_URL: redis://redis:6379
    NODE_ENV: production
  depends_on:
    redis:
      condition: service_healthy
  networks:
    - flowguard
```

And the dev override in `infra/docker-compose.dev.yml`:

```yaml
your-provider-publisher:
  volumes:
    - ../backend/publishers/your-provider/src:/app/src
  command: npx tsx watch src/index.ts
```

### 10. Done — Zero Consumer Changes Needed

That's it. Once deployed:
- Webhooks from your provider flow through the event bus as `NormalizedEvent` objects
- All consumers (data-processor, digest, ledger, etc.) process them automatically
- The executor can send outbound actions to your provider via the adapter registry
- Cross-platform entity linking works through cross-references

## File Overview

```
backend/publishers/your-provider/
  src/
    adapter.ts          # Core adapter (extends BaseAdapter)
    webhook-handler.ts  # Express router for incoming webhooks
    client.ts           # Outbound API client (extends BaseClient)
    normalizer.ts       # Raw payload -> NormalizedEvent[]
    config.ts           # Environment variable schema (Zod)
    logger.ts           # Structured logger (Pino)
    index.ts            # Entry point (standalone server or sub-router)
  package.json          # Dependencies (@flowguard/adapter-sdk, provider SDK)
  tsconfig.json         # TypeScript configuration
```

## Example: Linear Adapter Skeleton

Here's how small a real adapter implementation looks:

```typescript
import { BaseAdapter } from '@flowguard/adapter-sdk';
import type { WebhookRequest, NormalizedEvent, OutboundAction, ActionResult } from '@flowguard/adapter-sdk';
import { linearClient } from './client.js';
import { normalizeLinearEvent } from './normalizer.js';

export class LinearAdapter extends BaseAdapter {
  readonly provider = 'linear' as const;
  readonly capabilities = ['webhook_ingest', 'outbound_action', 'entity_resolve'] as const;

  private webhookSecret: string;
  constructor(webhookSecret: string) { super(); this.webhookSecret = webhookSecret; }

  async verifySignature(req: WebhookRequest) {
    const sig = req.headers['linear-signature'] as string;
    return sig === crypto.createHmac('sha256', this.webhookSecret).update(req.rawBody).digest('hex');
  }

  async handleWebhook(req: WebhookRequest) {
    const body = req.body as Record<string, any>;
    const companyId = await this.resolveCompanyId(body.organizationId);
    return normalizeLinearEvent(body, companyId);
  }

  protected async doExecuteAction(action: OutboundAction): Promise<ActionResult> {
    if (action.actionType === 'add_comment') {
      const result = await linearClient.addComment(action.targetId, action.payload.body as string);
      return { success: true, provider: 'linear', executionDetails: result, rollbackInfo: { canRollback: true, rollbackType: 'delete_comment', rollbackData: result } };
    }
    return { success: false, provider: 'linear', executionDetails: {}, rollbackInfo: { canRollback: false, rollbackData: {} }, error: 'Unsupported' };
  }

  // ... rollback, resolveEntity, healthCheck
}
```

## Testing

```bash
cd backend/publishers/your-provider
npm test          # Run unit tests
npm run dev       # Start with hot reload (standalone mode)
npm run typecheck # Verify types
```
