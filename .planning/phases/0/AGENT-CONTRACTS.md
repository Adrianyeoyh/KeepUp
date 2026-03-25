# Phase 0 — Agent Coordination Contracts

## Shared Foundation (Already Created)
These packages exist at `backend/packages/` and define ALL contracts:

- `@flowguard/adapter-sdk` — `PublisherAdapter` interface, `NormalizedEvent`, `OutboundAction`, `ActionResult`, `AdapterRegistry`
- `@flowguard/event-bus` — `EventBus`, `TOPICS`, typed publish/subscribe, `EventEnvelope`
- `@flowguard/db` — `initPool()`, `query()`, `withTransaction()`, `listCompanyIds()`
- `@flowguard/shared` — Zod domain schemas (existing, copied to `backend/packages/shared/`)

## API Surface Contract (Gateway ↔ Consumers)

### Gateway Routes → Service Mapping
| Route Pattern | Consumer Service | Method |
|---|---|---|
| `POST /webhooks/slack` | Slack Publisher | `handleWebhook()` |
| `POST /webhooks/jira` | Jira Publisher | `handleWebhook()` |
| `POST /webhooks/github` | GitHub Publisher | `handleWebhook()` |
| `GET/POST /api/ledger/*` | Ledger Consumer | HTTP routes |
| `GET/POST /api/dashboard/*` | Gateway (direct DB) | dashboard-api routes |
| `GET/POST /api/teams/*` | Gateway (direct DB) | teams-projects routes |
| `POST /api/inference/*` | AI Engine Consumer | HTTP routes |
| `POST /api/actions/:id/approve` | Executor Consumer | via event bus |
| `GET /health` | Gateway | aggregated |
| `GET /admin/*` | Gateway | admin routes |

### Event Bus Topics (Publisher → Consumer)
| Topic | Publisher | Consumer(s) |
|---|---|---|
| `events.ingested` | Slack/Jira/GitHub Publishers | Data Processor |
| `leaks.detected` | Data Processor | Digest, AI Engine |
| `leaks.updated` | Gateway (API) | Data Processor |
| `digest.tick` | Cron (scheduled) | Digest |
| `actions.approved` | Gateway (API) | Executor |
| `actions.executed` | Executor | Data Processor (audit) |
| `ledger.committed` | Ledger | Data Processor |
| `ledger.approved` | Ledger | Executor (writeback) |
| `ai.diagnosis.req` | Data Processor | AI Engine |
| `ai.draft.req` | Gateway (API) | AI Engine |

### Shared Config Pattern (every service)
```typescript
// Every service must initialize these:
import { initPool } from '@flowguard/db';
import { EventBus } from '@flowguard/event-bus';

const db = initPool({ databaseUrl: process.env.DATABASE_URL! });
const eventBus = new EventBus({
  redisUrl: process.env.REDIS_URL!,
  serviceName: '<service-name>',
});
```

### Frontend API Contract
Frontend expects these API routes (unchanged from current):
- `GET /api/dashboard/overview` — dashboard data
- `GET /api/dashboard/leaks` — leak list
- `GET /api/ledger/commits` — ledger list
- `POST /api/ledger/commits` — create commit
- `PATCH /api/ledger/commits/:id/transition` — transition status
- `GET /api/teams` — team list
- `GET /api/projects` — project list
- `POST /api/inference/diagnose` — AI diagnosis
- `PATCH /api/leaks/:id/snooze` — snooze leak
- `PATCH /api/leaks/:id/dismiss` — dismiss leak
- `POST /api/actions/:id/approve` — approve action
