# Phase 0 — Gap Resolutions

Responses to the 7 gaps identified by the PM agent.

## GAP-1: `leaks.updated` Publisher → Gateway owns it
**Resolution**: The gateway handles snooze/dismiss directly. It queries the DB (same as dashboard-api routes), updates leak status, and publishes `leaks.updated` to the event bus. This is thin business logic (update a row + publish), consistent with how the gateway already handles dashboard-api routes that query DB directly.

## GAP-2: `ledger.approved` Subscriber → Ledger consumer handles writeback
**Resolution**: Writeback lives in the **ledger consumer** (as planned in `writeback.ts`). The ledger consumer imports `adapterRegistry` from `@flowguard/adapter-sdk`. This is acceptable — the adapter registry is a shared package, not an executor-specific concern. The executor handles *remediation* actions; the ledger handles *writeback* actions. Both use the same adapter registry interface.

## GAP-3: Adapter Registry Initialization → Each consumer initializes its own
**Resolution**: Each consumer that needs outbound actions imports the singleton `adapterRegistry` from `@flowguard/adapter-sdk` and registers the publishers it needs at startup. In dev mode (single process), the gateway registers all publishers once and consumers share the singleton. In prod mode (separate processes), each consumer that does outbound work registers the publishers it needs.

Pattern:
```typescript
// In consumer's index.ts (only for consumers that do outbound):
import { adapterRegistry } from '@flowguard/adapter-sdk';
import { SlackAdapter } from '@flowguard/publisher-slack'; // or construct directly
adapterRegistry.register(new SlackAdapter(config));
```

## GAP-4: Missing package.json → Backend agent created them
**Resolution**: The backend agent DID create all package.json files before it errored. Verified: all 3 publishers, all 5 consumers, and the gateway have package.json files.

## GAP-5: Database Migrations Ownership → CLI command in @flowguard/db
**Resolution**: Migrations run via `npm run db:migrate` from the root (which delegates to `@flowguard/db`'s migrate script). This runs ONCE before any service starts — not per-service. In Docker, a migration init container runs before other services. In dev, it runs manually or as a pre-dev hook.

## GAP-6: Dev Mode Mounting → createRouter() export pattern
**Resolution**: Each service that has HTTP routes exports a `createRouter()` function. The gateway imports and mounts these in dev mode:

```typescript
// In publisher/consumer that has routes:
export function createRouter(deps: { eventBus: EventBus }): express.Router { ... }

// In gateway dev mode:
import { createRouter as createSlackWebhook } from '@flowguard/publisher-slack';
app.use('/webhooks/slack', createSlackWebhook({ eventBus }));
```

Services also export a standalone `start()` for prod mode (separate process).

## GAP-7: `actions.approved` Origin → Gateway has thin business logic
**Resolution**: Accept that the gateway has thin business logic for certain operations. The gateway reads the proposed_action from DB, validates it exists, updates approval_status, then publishes `actions.approved`. This is analogous to how it handles snooze/dismiss (GAP-1). The gateway is "routing + thin mutations," not "routing only." This is a pragmatic choice — creating a separate consumer HTTP route for every button click would be over-engineering.
