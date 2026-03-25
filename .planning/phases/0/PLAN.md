# Phase 0: Architectural Refactor — Microservice + Publisher/Consumer Split

## Goal
Decompose the monolith into a microservice architecture with clear frontend/backend separation and a publisher/consumer event-driven pattern. Publishers are adapter-wrapped integration microservices (Slack, Jira, GitHub) designed for extensibility (Linear, Zendesk, etc.). Consumers are domain-focused processing microservices (data-processor, digest, ledger).

## Why This Phase First
The current monolith (`apps/api` = everything, `apps/worker` = everything async) makes it impossible to:
- Add a new integration without touching the core API
- Scale webhook ingestion independently from digest generation
- Test integrations in isolation
- Onboard a new publisher (e.g., Linear) without understanding the entire codebase

The publisher/consumer pattern with adapter wrappers means: **adding Linear = implement one adapter interface, deploy one microservice, zero changes to consumers**.

---

## Target Architecture

```
keepup/
├── frontend/                          # React app (standalone)
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── layouts/
│   │   ├── lib/
│   │   ├── pages/
│   │   └── main.tsx
│   ├── public/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── backend/
│   ├── gateway/                       # API Gateway — auth, routing, rate limiting
│   │   ├── src/
│   │   │   ├── middleware/            # auth, rate-limit, cors, error-handler
│   │   │   ├── routes/               # proxies to internal services
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── publishers/                    # Integration microservices (data IN)
│   │   ├── slack/                     # Slack publisher
│   │   │   ├── src/
│   │   │   │   ├── adapter.ts         # implements PublisherAdapter interface
│   │   │   │   ├── webhook-handler.ts # Slack-specific webhook parsing
│   │   │   │   ├── client.ts          # Slack WebClient wrapper (outbound)
│   │   │   │   ├── normalizer.ts      # Raw payload → NormalizedEvent
│   │   │   │   └── index.ts
│   │   │   ├── tsconfig.json
│   │   │   └── package.json
│   │   │
│   │   ├── jira/                      # Jira publisher
│   │   │   ├── src/
│   │   │   │   ├── adapter.ts
│   │   │   │   ├── webhook-handler.ts
│   │   │   │   ├── client.ts          # Jira REST API wrapper (outbound)
│   │   │   │   ├── normalizer.ts
│   │   │   │   └── index.ts
│   │   │   ├── tsconfig.json
│   │   │   └── package.json
│   │   │
│   │   ├── github/                    # GitHub publisher
│   │   │   ├── src/
│   │   │   │   ├── adapter.ts
│   │   │   │   ├── webhook-handler.ts
│   │   │   │   ├── client.ts          # Octokit wrapper (outbound)
│   │   │   │   ├── normalizer.ts
│   │   │   │   └── index.ts
│   │   │   ├── tsconfig.json
│   │   │   └── package.json
│   │   │
│   │   └── _template/                 # Template for new publishers
│   │       ├── src/
│   │       │   ├── adapter.ts         # Copy & implement for new integration
│   │       │   ├── webhook-handler.ts
│   │       │   ├── client.ts
│   │       │   ├── normalizer.ts
│   │       │   └── index.ts
│   │       └── README.md              # "How to add a new publisher"
│   │
│   ├── consumers/                     # Domain processing microservices (data OUT/PROCESS)
│   │   ├── data-processor/            # Event processing, leak detection, metrics
│   │   │   ├── src/
│   │   │   │   ├── services/
│   │   │   │   │   ├── event-store.ts
│   │   │   │   │   ├── leak-engine.ts
│   │   │   │   │   ├── metrics-engine.ts
│   │   │   │   │   ├── entity-resolver.ts
│   │   │   │   │   ├── entity-link-extractor.ts
│   │   │   │   │   └── feedback-flywheel.ts
│   │   │   │   ├── handlers/          # Event bus message handlers
│   │   │   │   │   ├── on-event-ingested.ts
│   │   │   │   │   ├── on-metrics-tick.ts
│   │   │   │   │   └── on-leak-detected.ts
│   │   │   │   └── index.ts
│   │   │   ├── tsconfig.json
│   │   │   └── package.json
│   │   │
│   │   ├── digest/                    # Digest building, delivery, remediation
│   │   │   ├── src/
│   │   │   │   ├── services/
│   │   │   │   │   ├── digest-builder.ts
│   │   │   │   │   ├── digest-service.ts
│   │   │   │   │   ├── morning-pulse.ts
│   │   │   │   │   ├── proactive-nudges.ts
│   │   │   │   │   ├── sprint-retro.ts
│   │   │   │   │   └── cross-team-patterns.ts
│   │   │   │   ├── handlers/
│   │   │   │   │   ├── on-digest-tick.ts
│   │   │   │   │   └── on-leak-created.ts
│   │   │   │   └── index.ts
│   │   │   ├── tsconfig.json
│   │   │   └── package.json
│   │   │
│   │   ├── ledger/                    # Truth ledger CRUD, state machine, writeback
│   │   │   ├── src/
│   │   │   │   ├── services/
│   │   │   │   │   ├── ledger.ts
│   │   │   │   │   ├── decision-capture.ts
│   │   │   │   │   └── writeback.ts
│   │   │   │   ├── routes/            # Ledger-specific API routes (mounted by gateway)
│   │   │   │   │   └── ledger-routes.ts
│   │   │   │   ├── handlers/
│   │   │   │   │   └── on-commit-approved.ts
│   │   │   │   └── index.ts
│   │   │   ├── tsconfig.json
│   │   │   └── package.json
│   │   │
│   │   ├── ai-engine/                 # AI orchestration, drafts, guardrails
│   │   │   ├── src/
│   │   │   │   ├── services/
│   │   │   │   │   ├── ai-orchestrator.ts
│   │   │   │   │   ├── ai-recommendation-drafts.ts
│   │   │   │   │   ├── ai-entity-link-inference.ts
│   │   │   │   │   ├── ai-impact-summary.ts
│   │   │   │   │   └── ai-guardrails.ts
│   │   │   │   ├── handlers/
│   │   │   │   │   ├── on-diagnosis-requested.ts
│   │   │   │   │   └── on-draft-requested.ts
│   │   │   │   └── index.ts
│   │   │   ├── tsconfig.json
│   │   │   └── package.json
│   │   │
│   │   └── executor/                  # Remediation execution, rollback, audit
│   │       ├── src/
│   │       │   ├── services/
│   │       │   │   ├── executor.ts
│   │       │   │   ├── remediation.ts
│   │       │   │   └── rollback.ts
│   │       │   ├── handlers/
│   │       │   │   ├── on-action-approved.ts
│   │       │   │   └── on-rollback-requested.ts
│   │       │   └── index.ts
│   │       ├── tsconfig.json
│   │       └── package.json
│   │
│   └── packages/                      # Shared libraries
│       ├── shared/                    # Domain schemas (Zod), types, constants
│       │   ├── src/
│       │   │   ├── schemas/           # (existing — unchanged)
│       │   │   ├── index.ts
│       │   │   └── jql-engine.ts
│       │   └── package.json
│       │
│       ├── adapter-sdk/               # Publisher adapter interface + base classes
│       │   ├── src/
│       │   │   ├── types.ts           # PublisherAdapter, NormalizedEvent, OutboundAction
│       │   │   ├── base-adapter.ts    # Abstract base class with common logic
│       │   │   ├── base-webhook.ts    # Abstract webhook handler with signature verification
│       │   │   ├── base-client.ts     # Abstract outbound client with retry + circuit breaker
│       │   │   └── index.ts
│       │   └── package.json
│       │
│       ├── event-bus/                 # Event bus abstraction (BullMQ wrapper)
│       │   ├── src/
│       │   │   ├── types.ts           # EventEnvelope, EventTopic, SubscriptionOptions
│       │   │   ├── bus.ts             # publish(), subscribe(), EventBus class
│       │   │   ├── topics.ts          # Topic constants + schema registry
│       │   │   └── index.ts
│       │   └── package.json
│       │
│       └── db/                        # Database client, migration runner, connection pool
│           ├── src/
│           │   ├── client.ts
│           │   ├── migrate.ts
│           │   └── index.ts
│           ├── migrations/            # Numbered SQL migrations
│           └── package.json
│
├── infra/
│   ├── docker-compose.yml             # All services + Postgres + Redis
│   ├── docker-compose.dev.yml         # Dev overrides (hot reload, ports)
│   └── init.sql
│
├── scripts/
├── docs/
├── tests/                             # E2E / integration tests
├── package.json                       # Root workspace config
└── turbo.json                         # Turborepo build orchestration (replaces npm workspaces scripts)
```

---

## Event Flow Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Slack      │  │   Jira      │  │   GitHub    │   ← External platforms
│  Publisher   │  │  Publisher   │  │  Publisher   │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │ NormalizedEvent  │                  │
       ▼                  ▼                  ▼
┌──────────────────────────────────────────────────┐
│              Event Bus (BullMQ/Redis)             │
│                                                   │
│  Topics:                                          │
│    events.ingested   — raw normalized event       │
│    leaks.detected    — new leak found             │
│    leaks.updated     — leak status changed        │
│    digest.tick       — time to build digest       │
│    actions.approved  — human approved action      │
│    actions.executed  — action was executed         │
│    ledger.committed  — new ledger commit          │
│    ledger.approved   — commit approved/merged     │
│    ai.diagnosis.req  — AI diagnosis requested     │
│    ai.draft.req      — AI draft requested         │
└────────┬──────────┬──────────┬──────────┬─────────┘
         │          │          │          │
         ▼          ▼          ▼          ▼
┌────────────┐ ┌─────────┐ ┌────────┐ ┌──────────┐
│   Data     │ │ Digest  │ │ Ledger │ │ Executor │  ← Consumers
│ Processor  │ │ Service │ │Service │ │ Service  │
└────────────┘ └─────────┘ └────────┘ └──────────┘
                                           │
         ┌─────────────────────────────────┘
         ▼ (outbound actions via publisher clients)
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Slack      │  │   Jira      │  │   GitHub    │
│   Client     │  │   Client    │  │   Client    │
└──────────────┘  └──────────────┘  └──────────────┘
```

**Key principle**: Publishers handle both inbound (webhooks) AND outbound (API calls) for their platform. The executor consumer calls publisher clients through the adapter interface — it never imports `@slack/web-api` directly.

---

## Wave 1: Publisher Adapter SDK & Event Bus (Tasks 0.1–0.3)

### Task 0.1: Create `@flowguard/adapter-sdk` — Publisher Interface Contract
**Files**: `backend/packages/adapter-sdk/src/*`
**What**:
- Define `PublisherAdapter` interface:
  ```typescript
  interface PublisherAdapter {
    readonly provider: ProviderName;           // 'slack' | 'jira' | 'github' | string
    readonly capabilities: AdapterCapability[]; // ['webhook_ingest', 'outbound_action', 'entity_resolve']

    // Inbound: webhook → normalized events
    handleWebhook(req: WebhookRequest): Promise<NormalizedEvent[]>;
    verifySignature(req: WebhookRequest): Promise<boolean>;

    // Outbound: execute actions on the platform
    executeAction(action: OutboundAction): Promise<ActionResult>;
    rollbackAction(action: OutboundAction, executionId: string): Promise<RollbackResult>;

    // Entity resolution: resolve cross-platform references
    resolveEntity(ref: EntityReference): Promise<ResolvedEntity | null>;

    // Health: check integration connectivity
    healthCheck(integration: Integration): Promise<HealthStatus>;
  }
  ```
- Define `NormalizedEvent` type:
  ```typescript
  type NormalizedEvent = {
    provider: ProviderName;
    eventType: string;               // e.g. 'slack.message', 'jira.issue_transitioned'
    entityId: string;                // Unique entity identifier within provider
    providerEventId: string;         // For idempotency
    timestamp: Date;
    metadata: Record<string, unknown>;
    rawPayload?: unknown;            // Original payload for debugging
    crossReferences?: EntityReference[]; // Auto-detected links to other providers
  };
  ```
- Define `OutboundAction` type (what executor sends to publishers):
  ```typescript
  type OutboundAction = {
    provider: ProviderName;
    actionType: string;              // 'post_message', 'add_comment', 'request_review'
    targetId: string;                // Platform-specific target
    payload: Record<string, unknown>;
    riskLevel: RiskLevel;
  };
  ```
- Create `BaseAdapter` abstract class with common logic: retry with exponential backoff, circuit breaker, rate limiting, structured logging
- Create `BaseWebhookHandler` with signature verification scaffolding
- Create `BaseClient` with HTTP retry, timeout, and error normalization
**Acceptance**:
- `PublisherAdapter` interface is the single contract for all publishers
- `BaseAdapter` provides retry, circuit breaker, rate limiting out of the box
- A new publisher can be created by: `class LinearAdapter extends BaseAdapter implements PublisherAdapter`

### Task 0.2: Create `@flowguard/event-bus` — Event Bus Abstraction
**Files**: `backend/packages/event-bus/src/*`
**What**:
- Wrap BullMQ into a typed event bus:
  ```typescript
  class EventBus {
    async publish<T extends EventTopic>(topic: T, payload: EventPayloadMap[T]): Promise<void>;
    subscribe<T extends EventTopic>(topic: T, handler: (payload: EventPayloadMap[T]) => Promise<void>): void;
  }
  ```
- Define topic constants with Zod-validated payload schemas:
  ```typescript
  const TOPICS = {
    EVENTS_INGESTED: 'events.ingested',
    LEAKS_DETECTED: 'leaks.detected',
    LEAKS_UPDATED: 'leaks.updated',
    DIGEST_TICK: 'digest.tick',
    ACTIONS_APPROVED: 'actions.approved',
    ACTIONS_EXECUTED: 'actions.executed',
    LEDGER_COMMITTED: 'ledger.committed',
    LEDGER_APPROVED: 'ledger.approved',
    AI_DIAGNOSIS_REQ: 'ai.diagnosis.req',
    AI_DRAFT_REQ: 'ai.draft.req',
  } as const;
  ```
- Each topic has a Zod schema in `topics.ts` — publishing validates payload at runtime
- `EventEnvelope` wraps every message: `{ id, topic, payload, timestamp, source, traceId }`
- Dead-letter queue support: failed messages go to `${topic}.dlq`
**Acceptance**:
- `eventBus.publish('events.ingested', normalizedEvent)` validates and enqueues
- `eventBus.subscribe('events.ingested', handler)` processes with automatic retry
- Invalid payloads are rejected at publish time with clear error
- Dead-letter queue captures failed messages

### Task 0.3: Create `@flowguard/db` — Shared Database Package
**Files**: `backend/packages/db/src/*`
**What**:
- Extract `db/client.ts` from `apps/api/src/db/client.ts` into shared package
- Extract `db/migrate.ts` into shared package with migration runner
- Move migrations from API into `backend/packages/db/migrations/`
- All services import `@flowguard/db` for database access — single connection pool config
- Add connection pool health check method
**Acceptance**:
- All services use `@flowguard/db` for database access
- Migration runner works from any service context
- Connection pool shared configuration, individually instantiated per service

---

## Wave 2: Publisher Microservices (Tasks 0.4–0.6)

### Task 0.4: Slack Publisher Microservice
**Files**: `backend/publishers/slack/src/*`
**What**:
- Implement `SlackAdapter extends BaseAdapter implements PublisherAdapter`
- `webhook-handler.ts`: Parse Slack events (message, thread_reply, thread_resolved, reaction, interactivity)
  - Verify Slack signature using `x-slack-signature` header
  - Handle URL verification challenge
  - Normalize into `NormalizedEvent[]`
  - Detect cross-references: Jira issue keys in message text, GitHub PR URLs
  - Publish to `events.ingested` topic via event bus
- `client.ts`: Wrap `@slack/web-api` WebClient
  - `postMessage(channel, text, options)` — used by executor for remediations
  - `openDM(userId)` — used by nudges
  - `deleteMessage(channel, ts)` — used by rollback
  - All methods go through `BaseClient` retry/circuit-breaker
- `normalizer.ts`: Raw Slack payload → `NormalizedEvent` mapping
  - Extract `team_id` from channel → team mapping
  - Detect implied actions (messages with action verbs but no ticket link)
- Standalone Express server on its own port (or mounted as sub-router in gateway)
**Acceptance**:
- Slack webhooks processed entirely within this microservice
- Normalized events published to event bus (not directly to DB)
- Outbound Slack actions (post, DM, delete) callable via adapter interface
- No imports from other services — fully isolated

### Task 0.5: Jira Publisher Microservice
**Files**: `backend/publishers/jira/src/*`
**What**:
- Implement `JiraAdapter extends BaseAdapter implements PublisherAdapter`
- `webhook-handler.ts`: Parse Jira webhooks (issue CRUD, sprint events, comment events)
  - Verify Jira webhook signature (shared secret)
  - Extract `issue_key`, `status`, `from_status`, `to_status`, `assignee`, `epic_key`, `story_points`
  - Detect cross-references: GitHub PR URLs in description/comments, Slack thread links
  - Publish to `events.ingested` topic
- `client.ts`: Wrap Jira REST API v3
  - `addComment(issueKey, body)` — used by executor for ledger writeback
  - `getIssue(issueKey)` — used by entity resolution
  - `transitionIssue(issueKey, transitionId)` — future use
  - ADF (Atlassian Document Format) helper for rich comments
- `normalizer.ts`: Raw Jira payload → `NormalizedEvent`
  - Map Jira webhook event names to FlowGuard event types
  - Handle edge cases: bulk transitions, automation-triggered events
**Acceptance**:
- Jira webhooks fully handled within this microservice
- Cross-references to GitHub/Slack detected in issue descriptions
- Outbound Jira actions callable via adapter interface
- ADF formatting for rich comment writeback

### Task 0.6: GitHub Publisher Microservice
**Files**: `backend/publishers/github/src/*`
**What**:
- Implement `GitHubAdapter extends BaseAdapter implements PublisherAdapter`
- `webhook-handler.ts`: Parse GitHub webhooks (PR events, review events, push, issue_comment)
  - Verify GitHub webhook signature (HMAC-SHA256)
  - Track full PR lifecycle: opened → review_requested → review_submitted → approved → merged/closed
  - Extract `files_changed` for cross-team collision detection
  - Detect cross-references: Jira issue keys in PR title/body/branch name
  - Publish to `events.ingested` topic
- `client.ts`: Wrap Octokit
  - `addPRComment(owner, repo, prNumber, body)` — used by executor
  - `requestReview(owner, repo, prNumber, reviewers)` — used by remediation
  - `getPR(owner, repo, prNumber)` — used by entity resolution
- `normalizer.ts`: Raw GitHub payload → `NormalizedEvent`
  - Handle GitHub App vs OAuth token auth
  - Map action/event combinations to FlowGuard event types
**Acceptance**:
- GitHub webhooks fully handled within this microservice
- PR lifecycle tracked as discrete events
- Jira cross-references auto-detected from PR title/body/branch
- Outbound GitHub actions callable via adapter interface

---

## Wave 3: Consumer Microservices (Tasks 0.7–0.11)

### Task 0.7: Data Processor Consumer
**Files**: `backend/consumers/data-processor/src/*`
**What**:
- Subscribe to `events.ingested` topic
- `on-event-ingested.ts`: Persist event to DB, create entity_links from cross-references, resolve team_id
- Subscribe to `digest.tick` (cron-triggered): run metrics aggregation
- `leak-engine.ts`: Moved from `apps/worker/src/services/leak-engine.ts` — runs leak detection, publishes to `leaks.detected`
- `metrics-engine.ts`: Moved from `apps/worker/src/services/metrics-engine.ts`
- `feedback-flywheel.ts`: Moved from `apps/worker/src/services/feedback-flywheel.ts`
- Scheduled jobs: metrics aggregation (daily 8am), leak detection (daily 8:30am), feedback calibration (weekly)
**Acceptance**:
- Events persisted to DB from event bus (not from webhook handlers)
- Leak detection runs on schedule and publishes results
- Entity links auto-created from cross-references in events

### Task 0.8: Digest Consumer
**Files**: `backend/consumers/digest/src/*`
**What**:
- Subscribe to `leaks.detected`, `digest.tick`
- `digest-builder.ts`: Moved from `apps/worker/src/services/digest-builder.ts`
- `digest-service.ts`: Moved from `apps/worker/src/services/digest-service.ts`
- `morning-pulse.ts`, `proactive-nudges.ts`, `sprint-retro.ts`, `cross-team-patterns.ts`: Moved from worker
- Outbound delivery: uses publisher clients via adapter registry (not direct `@slack/web-api` import)
  ```typescript
  // Instead of: new WebClient(token).chat.postMessage(...)
  // Now: adapterRegistry.get('slack').executeAction({ actionType: 'post_message', ... })
  ```
- Scheduled jobs: digest (9am weekdays), pulse (9:05am), nudges (10am), decision-capture (10:30am)
**Acceptance**:
- Digest delivery goes through publisher adapter (not direct Slack SDK)
- All digest/nudge services migrated from monolith worker
- Adding a new delivery channel (e.g., email, Teams) = new publisher adapter

### Task 0.9: Ledger Consumer
**Files**: `backend/consumers/ledger/src/*`
**What**:
- `ledger.ts`: Moved from `apps/api/src/services/ledger.ts` — full LedgerService with state machine
- `decision-capture.ts`: Moved from `apps/worker/src/services/decision-capture.ts`
- `writeback.ts`: Extracted from `executor.ts` — triggers writeback via publisher adapters when commits are approved
- HTTP routes: `ledger-routes.ts` moved here, mounted by gateway via HTTP proxy
- Subscribe to `ledger.approved`: trigger writeback to originating platforms
- Publish `ledger.committed` when new commits created
**Acceptance**:
- Ledger CRUD operates as isolated service
- Writeback uses publisher adapters, not direct SDK imports
- Ledger routes served by this service, proxied by gateway

### Task 0.10: AI Engine Consumer
**Files**: `backend/consumers/ai-engine/src/*`
**What**:
- Subscribe to `ai.diagnosis.req`, `ai.draft.req`
- `ai-orchestrator.ts`: Moved from worker — dual-provider (OpenAI/Anthropic) with fallback
- `ai-recommendation-drafts.ts`, `ai-entity-link-inference.ts`, `ai-impact-summary.ts`: Moved from worker
- `ai-guardrails.ts`: New — validation layer for all AI outputs (placeholder for Phase 4)
- Scheduled jobs: AI drafts (11am), entity-link inference (11:15am), impact summaries (11:30am)
**Acceptance**:
- AI processing isolated from other consumers
- Can be scaled independently (AI calls are expensive + slow)
- Guardrails framework in place for Phase 4

### Task 0.11: Executor Consumer
**Files**: `backend/consumers/executor/src/*`
**What**:
- Subscribe to `actions.approved`
- `executor.ts`: Moved from `apps/api/src/services/executor.ts`
  - Rewritten to use adapter registry instead of direct SDK imports:
    ```typescript
    // Old: executeSlackAction(), executeJiraAction(), executeGitHubAction()
    // New: adapterRegistry.get(action.target_system).executeAction(outboundAction)
    ```
- `remediation.ts`: Moved from `apps/api/src/services/remediation.ts`
- `rollback.ts`: Extracted rollback logic, also uses adapter registry
- Blast-radius enforcement unchanged
- Publish `actions.executed` after execution
**Acceptance**:
- Executor uses adapter registry — adding a new target system requires zero executor changes
- Rollback uses same adapter interface
- Execution audit trail maintained

---

## Wave 4: Gateway + Frontend Separation (Tasks 0.12–0.14)

### Task 0.12: API Gateway
**Files**: `backend/gateway/src/*`
**What**:
- New Express service that handles: auth, CORS, rate limiting, request routing
- Routes:
  - `/webhooks/slack` → proxies to Slack publisher (or mounts sub-router)
  - `/webhooks/jira` → proxies to Jira publisher
  - `/webhooks/github` → proxies to GitHub publisher
  - `/api/ledger/*` → proxies to Ledger consumer HTTP routes
  - `/api/dashboard/*` → proxies to Data Processor (or serves directly with DB queries)
  - `/api/inference/*` → proxies to AI Engine
  - `/admin/*` → admin routes (bootstrap, seeding)
  - `/health` → aggregated health from all services
- In dev mode: all services run in-process (single Node process with sub-routers)
- In prod mode: services run as separate processes, gateway proxies via HTTP
**Acceptance**:
- Single entry point for all HTTP traffic
- Auth middleware applied once at gateway level
- Dev mode works as single process (no Docker required)
- Prod mode supports independent scaling

### Task 0.13: Frontend Separation
**Files**: `frontend/*`
**What**:
- Move `src/` → `frontend/src/`
- Move `public/` → `frontend/public/`
- Move `index.html` → `frontend/index.html`
- Move frontend-specific configs: `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig.app.json`, `components.json`
- Create `frontend/package.json` with only frontend dependencies (React, Radix, Recharts, etc.)
- Update Vite dev proxy to point to gateway
- Root `package.json` becomes workspace orchestrator only (no direct dependencies)
**Acceptance**:
- `cd frontend && npm run dev` starts the React app standalone
- Frontend has zero backend dependencies in its package.json
- Vite proxy routes `/api/*` and `/webhooks/*` to gateway
- No source code changes needed in React components (just import path aliases updated)

### Task 0.14: Publisher Template & Documentation
**Files**: `backend/publishers/_template/*`, `docs/adding-a-publisher.md`
**What**:
- Create a template publisher with commented scaffolding
- Document the process: "How to add a new integration (e.g., Linear)"
  1. Copy `_template/` to `publishers/linear/`
  2. Implement `LinearAdapter` (the `PublisherAdapter` interface)
  3. Implement `webhook-handler.ts` (platform-specific webhook parsing)
  4. Implement `client.ts` (outbound API calls)
  5. Implement `normalizer.ts` (raw → NormalizedEvent)
  6. Register in adapter registry
  7. Add webhook route in gateway
  8. Deploy — zero changes to any consumer
- Include example: Linear adapter skeleton (shows how small the implementation is)
**Acceptance**:
- Template is copy-paste ready
- Documentation covers full lifecycle
- Example Linear skeleton demonstrates adapter pattern

---

## Wave 5: Build System & DevEx (Tasks 0.15–0.16)

### Task 0.15: Turborepo + Workspace Configuration
**Files**: Root `package.json`, `turbo.json`
**What**:
- Replace npm workspace scripts with Turborepo for:
  - Parallel builds: `turbo run build` builds all packages/services
  - Dependency-aware: builds `@flowguard/shared` before consumers that depend on it
  - Incremental: only rebuilds changed packages
- Workspace layout:
  ```json
  {
    "workspaces": [
      "frontend",
      "backend/gateway",
      "backend/publishers/*",
      "backend/consumers/*",
      "backend/packages/*"
    ]
  }
  ```
- Scripts:
  - `npm run dev` — starts all services in dev mode (gateway mounts everything in-process)
  - `npm run dev:frontend` — starts only the React app
  - `npm run dev:gateway` — starts only the gateway + all backend services
  - `npm run build` — builds everything via Turborepo
  - `npm run test` — tests everything
**Acceptance**:
- `npm run dev` starts the full stack in one command
- `turbo run build` correctly orders builds by dependency graph
- Each service is independently buildable and testable

### Task 0.16: Docker Compose — Multi-Service Dev Environment
**Files**: `infra/docker-compose.yml`, `infra/docker-compose.dev.yml`
**What**:
- Update docker-compose to define services: postgres, redis, gateway, slack-publisher, jira-publisher, github-publisher, data-processor, digest, ledger, ai-engine, executor, frontend
- Dev compose: use `tsx watch` with volume mounts for hot reload
- Each service gets its own container with defined ports, env vars, and health checks
- Shared network for inter-service communication
- Optional: run all backend services in one container for simpler local dev
**Acceptance**:
- `docker compose up` starts the full platform
- Each service has health check endpoint
- Services can communicate via Docker network
- Dev mode has hot reload for all services

---

## Migration Strategy (Monolith → Microservices)

This is NOT a big-bang rewrite. Each wave can be deployed incrementally:

1. **Wave 1** (packages): No runtime changes. Just extracted shared code.
2. **Wave 2** (publishers): Run alongside existing webhook routes. Feature-flag to route traffic to new publishers.
3. **Wave 3** (consumers): Run alongside existing worker. Feature-flag to route jobs to new consumers.
4. **Wave 4** (gateway + frontend): Deploy gateway as new entry point. Frontend move is a file reorganization.
5. **Wave 5** (build): Tooling improvement. No runtime changes.

At each step, the old code continues to work. Once a wave is validated, the old code path is removed.

---

## Success Criteria (Phase 0 Complete When)
1. Frontend runs independently from `frontend/` with zero backend imports
2. All three publishers (Slack, Jira, GitHub) operate as isolated microservices behind the adapter interface
3. All consumers process events from the event bus, not from direct webhook handler calls
4. Executor uses adapter registry — adding a new integration requires zero consumer changes
5. `_template/` publisher + documentation exists so a new integration is a 1-day task
6. `npm run dev` starts the full stack; each service is independently deployable
7. Zero functionality regression — all existing features work through the new architecture

## Files Deleted After Migration
| Old Path | Replaced By |
|----------|-------------|
| `src/` | `frontend/src/` |
| `apps/api/` | `backend/gateway/` + `backend/consumers/ledger/` + `backend/consumers/executor/` |
| `apps/worker/` | `backend/consumers/data-processor/` + `backend/consumers/digest/` + `backend/consumers/ai-engine/` |
| `apps/api/src/routes/webhooks/` | `backend/publishers/slack/` + `backend/publishers/jira/` + `backend/publishers/github/` |

## Risks
- **Complexity during migration**: Running old + new in parallel temporarily increases cognitive load. Mitigation: feature flags + incremental wave rollout.
- **Shared DB**: All services share one Postgres. This is intentional for now — a separate DB per service is over-engineering at this stage. Revisit when scaling requires it.
- **Local dev overhead**: 11+ services is heavy. Mitigation: dev mode runs everything in a single Node process with sub-routers; Docker only needed for staging/prod.
- **Inter-service latency**: Event bus adds latency vs direct function calls. Mitigation: BullMQ on local Redis has <5ms overhead. Acceptable for async workflows.
