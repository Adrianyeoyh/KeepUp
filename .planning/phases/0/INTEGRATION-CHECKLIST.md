# Phase 0: Integration Checklist

Every integration point that must be verified before Phase 0 is considered complete. Each item must pass for the microservice architecture to function correctly end-to-end.

---

## 1. Gateway Routing -- Webhook Routes Match Publisher Endpoints

Each gateway webhook route must correctly proxy to the corresponding publisher microservice.

| Gateway Route | Target Service | Method | Verification |
|---------------|---------------|--------|--------------|
| `POST /webhooks/slack` | Slack Publisher `handleWebhook()` | POST | [ ] Route exists in gateway |
| | | | [ ] Proxies to correct port/sub-router |
| | | | [ ] Raw body preserved for signature verification |
| `POST /webhooks/jira` | Jira Publisher `handleWebhook()` | POST | [ ] Route exists in gateway |
| | | | [ ] Proxies to correct port/sub-router |
| | | | [ ] Raw body preserved for signature verification |
| `POST /webhooks/github` | GitHub Publisher `handleWebhook()` | POST | [ ] Route exists in gateway |
| | | | [ ] Proxies to correct port/sub-router |
| | | | [ ] Raw body preserved for signature verification |

### Critical Detail
Webhook signature verification requires the **raw request body**. If the gateway parses JSON before proxying, signature verification will fail. The gateway MUST either:
- Forward the raw body unparsed, OR
- Mount publisher handlers as sub-routers (dev mode) with `express.raw()` middleware on webhook routes

---

## 2. Gateway Routing -- API Routes Match Consumer Endpoints

| Gateway Route | Target Service | Method | Verification |
|---------------|---------------|--------|--------------|
| `GET /api/dashboard/overview` | Gateway (direct DB) or Data Processor | GET | [ ] Route exists |
| `GET /api/dashboard/leaks` | Gateway (direct DB) or Data Processor | GET | [ ] Route exists |
| `GET /api/ledger/commits` | Ledger Consumer | GET | [ ] Route proxies to ledger service |
| `POST /api/ledger/commits` | Ledger Consumer | POST | [ ] Route proxies to ledger service |
| `PATCH /api/ledger/commits/:id/transition` | Ledger Consumer | PATCH | [ ] Route proxies to ledger service |
| `GET /api/teams` | Gateway (direct DB) | GET | [ ] Route exists |
| `GET /api/projects` | Gateway (direct DB) | GET | [ ] Route exists |
| `POST /api/inference/diagnose` | AI Engine Consumer | POST | [ ] Route proxies to AI engine |
| `PATCH /api/leaks/:id/snooze` | Gateway or Data Processor | PATCH | [ ] Route exists |
| `PATCH /api/leaks/:id/dismiss` | Gateway or Data Processor | PATCH | [ ] Route exists |
| `POST /api/actions/:id/approve` | Executor Consumer (via event bus) | POST | [ ] Publishes `actions.approved` to event bus |
| `GET /health` | Gateway (aggregated) | GET | [ ] Checks all service health |
| `GET /admin/*` | Gateway | GET | [ ] Admin routes mounted |

---

## 3. Event Bus Topics -- Every Topic Has a Publisher AND Subscriber

Each topic defined in `@flowguard/event-bus` TOPICS must have at least one publisher and at least one subscriber. An orphan topic (no publisher or no subscriber) indicates a broken data flow.

| Topic | Publisher(s) | Subscriber(s) | Verification |
|-------|-------------|---------------|--------------|
| `events.ingested` | Slack Publisher, Jira Publisher, GitHub Publisher | Data Processor | [ ] All 3 publishers call `eventBus.publish('events.ingested', ...)` |
| | | | [ ] Data Processor subscribes via `on-event-ingested.ts` handler |
| `leaks.detected` | Data Processor (leak-engine) | Digest, AI Engine | [ ] Data Processor publishes after leak detection |
| | | | [ ] Digest subscribes via `on-leak-created.ts` handler |
| | | | [ ] AI Engine subscribes (for diagnosis) |
| `leaks.updated` | Gateway (API route) | Data Processor | [ ] Gateway publishes on snooze/dismiss |
| | | | [ ] Data Processor subscribes to update state |
| `digest.tick` | Cron (scheduled job) | Digest | [ ] Cron job publishes on schedule (9am weekdays) |
| | | | [ ] Digest subscribes via `on-digest-tick.ts` handler |
| `actions.approved` | Gateway (API route) | Executor | [ ] Gateway publishes when user approves action |
| | | | [ ] Executor subscribes via `on-action-approved.ts` handler |
| `actions.executed` | Executor | Data Processor (audit) | [ ] Executor publishes after execution |
| | | | [ ] Data Processor subscribes for audit logging |
| `ledger.committed` | Ledger | Data Processor | [ ] Ledger publishes on new commit creation |
| | | | [ ] Data Processor subscribes |
| `ledger.approved` | Ledger | Executor (writeback) | [ ] Ledger publishes on commit approval |
| | | | [ ] Executor subscribes for writeback via `on-commit-approved.ts` (in ledger) or writeback service |
| `ai.diagnosis.req` | Data Processor | AI Engine | [ ] Data Processor publishes diagnosis requests |
| | | | [ ] AI Engine subscribes via `on-diagnosis-requested.ts` handler |
| `ai.draft.req` | Gateway (API route) | AI Engine | [ ] Gateway publishes draft requests |
| | | | [ ] AI Engine subscribes via `on-draft-requested.ts` handler |

### Verification Steps
- [ ] Count unique topics in `event-bus/src/topics.ts` -- should be exactly 10
- [ ] Every topic constant has a Zod payload schema defined
- [ ] Every topic has at least one `eventBus.publish()` call across all services
- [ ] Every topic has at least one `eventBus.subscribe()` call across all services
- [ ] Dead-letter queue (`${topic}.dlq`) configured for each topic

---

## 4. Outbound Actions -- All Go Through Adapter Registry

The executor and any service that performs outbound actions (digest delivery, writeback) MUST use the adapter registry, never direct SDK imports. This is the extensibility contract.

| Service | Outbound Action | Must Use | Must NOT Use | Verification |
|---------|----------------|----------|--------------|--------------|
| Executor | Slack post/DM/delete | `adapterRegistry.get('slack').executeAction(...)` | `new WebClient(...)` | [ ] No `@slack/web-api` import in executor |
| Executor | Jira comment/transition | `adapterRegistry.get('jira').executeAction(...)` | Direct Jira REST calls | [ ] No `jira.js` or `axios` to Jira in executor |
| Executor | GitHub PR comment/review | `adapterRegistry.get('github').executeAction(...)` | `new Octokit(...)` | [ ] No `@octokit/*` import in executor |
| Executor | Rollback any action | `adapterRegistry.get(provider).rollbackAction(...)` | Provider-specific rollback | [ ] Rollback uses same adapter interface |
| Digest | Deliver digest via Slack | `adapterRegistry.get('slack').executeAction(...)` | `new WebClient(...)` | [ ] No `@slack/web-api` import in digest consumer |
| Digest | Deliver nudges | `adapterRegistry.get(provider).executeAction(...)` | Direct SDK calls | [ ] All delivery through adapters |
| Ledger | Writeback to Jira | `adapterRegistry.get('jira').executeAction(...)` | Direct Jira API calls | [ ] Writeback service uses adapter registry |
| Ledger | Writeback to Slack | `adapterRegistry.get('slack').executeAction(...)` | Direct Slack API calls | [ ] Writeback service uses adapter registry |

### Verification Steps
- [ ] `grep -r "@slack/web-api" backend/consumers/` returns ZERO results
- [ ] `grep -r "octokit" backend/consumers/` returns ZERO results (except type imports if needed)
- [ ] `grep -r "jira.js\|atlassian" backend/consumers/` returns ZERO results
- [ ] Every consumer that does outbound actions imports `AdapterRegistry` from `@flowguard/adapter-sdk`
- [ ] `AdapterRegistry` has `get(provider)` method that returns a `PublisherAdapter`
- [ ] Each publisher registers itself with the adapter registry at startup

---

## 5. Consumer Service Initialization -- DB and EventBus

Every consumer service must correctly initialize both the database pool and event bus connection. Failure to do so means the service cannot process events or persist data.

| Service | Initializes DB | Initializes EventBus | Subscribes To | Verification |
|---------|---------------|---------------------|---------------|--------------|
| Data Processor | [ ] `initPool()` | [ ] `new EventBus({ serviceName: 'data-processor' })` | `events.ingested`, `leaks.updated`, `actions.executed`, `ledger.committed`, `ai.diagnosis.req` (publishes) | [ ] `index.ts` init block |
| Digest | [ ] `initPool()` | [ ] `new EventBus({ serviceName: 'digest' })` | `leaks.detected`, `digest.tick` | [ ] `index.ts` init block |
| Ledger | [ ] `initPool()` | [ ] `new EventBus({ serviceName: 'ledger' })` | `ledger.approved` (subscribes), `ledger.committed` (publishes) | [ ] `index.ts` init block |
| AI Engine | [ ] `initPool()` | [ ] `new EventBus({ serviceName: 'ai-engine' })` | `ai.diagnosis.req`, `ai.draft.req` | [ ] `index.ts` init block |
| Executor | [ ] `initPool()` | [ ] `new EventBus({ serviceName: 'executor' })` | `actions.approved`, `ledger.approved` (writeback) | [ ] `index.ts` init block |

### Shared Config Contract
```
Every service index.ts must:
1. import { initPool } from '@flowguard/db'
2. import { EventBus } from '@flowguard/event-bus'
3. Call initPool({ databaseUrl: process.env.DATABASE_URL! })
4. Create EventBus with { redisUrl: process.env.REDIS_URL!, serviceName: '<name>' }
5. Register event handlers via eventBus.subscribe()
6. Start HTTP server if the service exposes routes (ledger, ai-engine)
7. Handle graceful shutdown (close pool, disconnect event bus)
```

### Verification Steps
- [ ] Every consumer `index.ts` imports `@flowguard/db`
- [ ] Every consumer `index.ts` imports `@flowguard/event-bus`
- [ ] Every consumer has `DATABASE_URL` and `REDIS_URL` in its env config
- [ ] Graceful shutdown handlers exist (SIGTERM/SIGINT)

---

## 6. Frontend API Calls -- Every Call Has a Matching Gateway Route

The frontend (currently in `src/`, target: `frontend/src/`) makes API calls that must all resolve through the gateway.

| Frontend Call | Expected Gateway Route | Verification |
|--------------|----------------------|--------------|
| Dashboard overview fetch | `GET /api/dashboard/overview` | [ ] Route exists in gateway |
| Dashboard leaks fetch | `GET /api/dashboard/leaks` | [ ] Route exists in gateway |
| Ledger commits list | `GET /api/ledger/commits` | [ ] Route proxies to ledger service |
| Ledger commit create | `POST /api/ledger/commits` | [ ] Route proxies to ledger service |
| Ledger commit transition | `PATCH /api/ledger/commits/:id/transition` | [ ] Route proxies to ledger service |
| Team list | `GET /api/teams` | [ ] Route exists in gateway |
| Project list | `GET /api/projects` | [ ] Route exists in gateway |
| AI diagnose | `POST /api/inference/diagnose` | [ ] Route proxies to AI engine |
| Snooze leak | `PATCH /api/leaks/:id/snooze` | [ ] Route exists in gateway |
| Dismiss leak | `PATCH /api/leaks/:id/dismiss` | [ ] Route exists in gateway |
| Approve action | `POST /api/actions/:id/approve` | [ ] Route exists + publishes to event bus |

### Verification Steps
- [ ] Audit all `fetch()` / `axios` / API client calls in `src/` (or `frontend/src/`)
- [ ] Each API call has a corresponding gateway route
- [ ] Vite dev proxy configured to forward `/api/*` to gateway
- [ ] No frontend code directly calls publisher or consumer URLs (all goes through gateway)

---

## 7. Publisher Webhook Signature Verification

Each publisher must verify webhook authenticity. A misconfigured verification breaks the entire ingest pipeline for that platform.

| Publisher | Signature Method | Header | Verification |
|-----------|-----------------|--------|--------------|
| Slack | HMAC-SHA256 | `x-slack-signature` + `x-slack-request-timestamp` | [ ] `verifySignature()` implemented |
| | | | [ ] URL verification challenge handled |
| | | | [ ] Signing secret from env var (not hardcoded) |
| Jira | Shared secret | Jira-specific header | [ ] `verifySignature()` implemented |
| | | | [ ] Secret from env var |
| GitHub | HMAC-SHA256 | `x-hub-signature-256` | [ ] `verifySignature()` implemented |
| | | | [ ] Webhook secret from env var |

---

## 8. Cross-Reference Detection -- Publishers Detect Links to Other Platforms

| Publisher | Detects | In Fields | Verification |
|-----------|---------|-----------|--------------|
| Slack | Jira issue keys (e.g., `PROJ-123`) | Message text | [ ] Regex extraction implemented |
| Slack | GitHub PR URLs | Message text | [ ] URL parsing implemented |
| Jira | GitHub PR URLs | Description, comments | [ ] URL parsing implemented |
| Jira | Slack thread links | Description, comments | [ ] URL parsing implemented |
| GitHub | Jira issue keys | PR title, body, branch name | [ ] Regex extraction implemented |

### Verification Steps
- [ ] Each publisher's `normalizer.ts` populates `crossReferences` field on `NormalizedEvent`
- [ ] Cross-references use the `EntityReference` type from adapter-sdk
- [ ] Data Processor's `entity-link-extractor.ts` creates `entity_links` from cross-references

---

## 9. Adapter Registry -- All Publishers Registered

| Provider | Adapter Class | Registered In | Verification |
|----------|--------------|---------------|--------------|
| `slack` | `SlackAdapter` | Adapter Registry | [ ] `adapterRegistry.register('slack', slackAdapter)` |
| `jira` | `JiraAdapter` | Adapter Registry | [ ] `adapterRegistry.register('jira', jiraAdapter)` |
| `github` | `GitHubAdapter` | Adapter Registry | [ ] `adapterRegistry.register('github', githubAdapter)` |

### Verification Steps
- [ ] `AdapterRegistry` in adapter-sdk has `register()` and `get()` methods
- [ ] Each publisher registers at startup
- [ ] `adapterRegistry.get('nonexistent')` throws a clear error (not undefined)
- [ ] Registry is accessible to executor, digest, and ledger consumers

---

## 10. Scheduled Jobs / Cron -- All Migrated from Monolith Worker

The monolith worker (`apps/worker/`) has 15+ scheduled jobs. Each must be accounted for in a consumer.

| Job | Schedule | Source Service | Target Consumer | Verification |
|-----|----------|---------------|-----------------|--------------|
| Metrics aggregation | Daily 8:00 AM | Worker | Data Processor | [ ] Cron job migrated |
| Leak detection | Daily 8:30 AM | Worker | Data Processor | [ ] Cron job migrated |
| Feedback calibration | Weekly | Worker | Data Processor | [ ] Cron job migrated |
| Digest build + send | 9:00 AM weekdays | Worker | Digest | [ ] Publishes `digest.tick` |
| Morning pulse | 9:05 AM | Worker | Digest | [ ] Cron job migrated |
| Proactive nudges | 10:00 AM | Worker | Digest | [ ] Cron job migrated |
| Decision capture | 10:30 AM | Worker | Digest or Ledger | [ ] Cron job migrated |
| AI drafts | 11:00 AM | Worker | AI Engine | [ ] Cron job migrated |
| Entity-link inference | 11:15 AM | Worker | AI Engine | [ ] Cron job migrated |
| Impact summaries | 11:30 AM | Worker | AI Engine | [ ] Cron job migrated |

### Verification Steps
- [ ] Audit `apps/worker/` for ALL scheduled jobs -- none should be left behind
- [ ] Each cron job has a clear owner consumer
- [ ] Cron triggers either run inside the consumer or publish a topic message

---

## Identified Gaps and Risks

### GAP-1: `leaks.updated` Publisher Unclear
The contract says `leaks.updated` is published by "Gateway (API)" but the gateway is a routing layer. Either:
- The gateway handles snooze/dismiss logic directly and publishes, OR
- There is a consumer (data-processor?) that exposes an HTTP route for this

**Resolution needed**: Clarify which service owns the snooze/dismiss mutation and publishes `leaks.updated`.

### GAP-2: `ledger.approved` Subscriber Ambiguity
The contract lists the executor as the subscriber for `ledger.approved` (writeback), but the plan puts `writeback.ts` in the ledger consumer. Writeback needs the adapter registry (outbound actions) which is an executor concern.

**Resolution needed**: Decide whether writeback lives in ledger consumer or executor consumer. If ledger, it needs adapter registry access. If executor, the handler name in the plan (`on-commit-approved.ts` in ledger) is misleading.

### GAP-3: Adapter Registry Initialization Pattern
How do consumers get access to the adapter registry? Options:
- Each consumer that needs outbound actions creates its own adapter registry and registers all publishers
- A shared initialization module exists in a package
- The gateway initializes the registry and consumers receive it somehow

**Resolution needed**: Define the adapter registry initialization pattern for consumers.

### GAP-4: No `package.json` Files in Any Service
None of the publisher, consumer, or gateway directories have `package.json` files. Without these, no service can declare dependencies, be built, or be started.

**Action needed**: Create `package.json` for every service before any implementation begins.

### GAP-5: Database Migrations Ownership
The plan puts migrations in `backend/packages/db/migrations/` but does not clarify which service runs them. In a microservice architecture, migration ownership matters.

**Resolution needed**: Decide whether migrations run from a dedicated CLI command, from the gateway at startup, or from each service independently.

### GAP-6: Dev Mode Single-Process Architecture
The plan states dev mode runs "all services in-process with sub-routers" but the current gateway is empty. The dev-mode mounting strategy (how publishers and consumers expose their Express routers for in-process mounting) needs to be defined before implementation.

**Resolution needed**: Define the `createRouter()` export pattern for each service.

### GAP-7: `actions.approved` Event Origin
The contract says the gateway publishes `actions.approved` when a user approves an action. But the gateway should be stateless routing. This implies the gateway has some business logic (reading the action from DB, validating it, then publishing). This muddies the "gateway = routing only" principle.

**Resolution needed**: Either accept that the gateway has thin business logic for approval, or create a dedicated route in executor that the gateway proxies to.
