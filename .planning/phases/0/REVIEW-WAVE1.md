# Wave 1 Code Review: Shared Packages

**Reviewer**: Code Review Agent
**Date**: 2026-03-26
**Packages reviewed**: `@flowguard/adapter-sdk`, `@flowguard/event-bus`, `@flowguard/db`
**Contracts reference**: `AGENT-CONTRACTS.md`, `PLAN.md`

---

## Overall Assessment: NEEDS_CHANGES

The Wave 1 packages form a solid architectural foundation. The type system is well-designed, the event bus is properly typed with runtime validation, and the adapter pattern correctly decouples publishers from consumers. However, there are several issues that should be addressed before Wave 2 begins building on top of these packages.

### What was done well

- The `PublisherAdapter` interface is comprehensive and covers all operations specified in the plan (inbound, outbound, rollback, entity resolution, health check).
- Type definitions use Zod schemas consistently, providing both compile-time and runtime safety.
- The `EventBus` class validates payloads at publish time, which will catch contract violations early.
- The `BaseAdapter` has a clean separation between public methods (with retry/circuit breaker) and protected abstract methods (`doExecuteAction`, `doRollbackAction`) that subclasses implement.
- The `AdapterRegistry` has a convenience `executeAction` method that routes by provider, which is exactly what the executor consumer needs.
- All 10 event topics from `AGENT-CONTRACTS.md` are defined in `topics.ts` with matching Zod schemas.
- ESM module syntax is used consistently with `.js` extensions in imports.
- The `NormalizedEvent` type includes `companyId` and optional `teamId`, which are additions beyond the plan that are necessary for multi-tenant operation.

---

## Issues Found

### Critical

**C1. Missing files specified in PLAN.md: `base-webhook.ts` and `base-client.ts`**
- **Location**: `backend/packages/adapter-sdk/src/`
- **Plan reference**: Task 0.1 specifies three base classes: `BaseAdapter`, `BaseWebhookHandler` (signature verification scaffolding), and `BaseClient` (HTTP retry, timeout, error normalization).
- **Current state**: Only `BaseAdapter` exists. `base-webhook.ts` and `base-client.ts` are absent.
- **Impact**: Without `BaseWebhookHandler`, each publisher must independently implement signature verification boilerplate. Without `BaseClient`, each publisher must implement HTTP retry/timeout independently, leading to inconsistent error handling across Slack/Jira/GitHub clients.
- **Recommendation**: Create these two files before Wave 2. The `BaseWebhookHandler` should provide the signature verification scaffold (abstract `computeExpectedSignature()` method, concrete `verify()` that compares). The `BaseClient` should wrap fetch/axios with retry, timeout, and circuit breaker logic. Alternatively, if the decision is that `BaseAdapter` already covers enough, document this as a deliberate deviation from the plan and update `PLAN.md`.

**C2. Missing migration infrastructure in `@flowguard/db`**
- **Location**: `backend/packages/db/`
- **Plan reference**: Task 0.3 specifies: "Extract `db/migrate.ts` into shared package with migration runner" and "Move migrations from API into `backend/packages/db/migrations/`".
- **Current state**: `src/migrate.ts` does not exist. The `migrations/` directory does not exist. The `package.json` references a `migrate` script (`tsx src/migrate.ts`) that points to a nonexistent file.
- **Impact**: No service can run migrations. This is a foundational capability needed before any consumer can start.
- **Recommendation**: Create `src/migrate.ts` with a migration runner (can be simple: read numbered SQL files from `migrations/`, track applied migrations in a `schema_migrations` table, apply in order). Create the `migrations/` directory with at least a placeholder or copy existing migrations from `apps/api`.

### Major

**M1. Singleton pool pattern in `@flowguard/db` conflicts with plan**
- **Location**: `backend/packages/db/src/client.ts`, line 6-7
- **Plan reference**: Task 0.3 specifies "Connection pool shared configuration, individually instantiated per service".
- **Current state**: The module uses a module-level `let pool: pg.Pool | null = null` singleton. `initPool()` returns the existing pool if already initialized, ignoring any new config. This means if two services in the same process (dev mode single-process) call `initPool()` with different configs, the second call is silently ignored.
- **Impact**: In dev mode (gateway mounts all services in one process per Task 0.12), all services will share one pool config. This is likely acceptable, but the silent ignoring of the second config is a bug waiting to happen -- a service could pass different `maxConnections` and wonder why it has no effect.
- **Recommendation**: Either (a) log a warning when `initPool()` is called with a different config than the existing pool, or (b) refactor to return a `DbClient` class that can be instantiated per-service (matching the plan's "individually instantiated" language). Option (a) is simpler and sufficient for now.

**M2. `adapterRegistry` singleton import may cause issues across package boundaries**
- **Location**: `backend/packages/adapter-sdk/src/adapter-registry.ts`, line 57
- **Current state**: A module-level singleton `export const adapterRegistry = new AdapterRegistry()` is exported.
- **Impact**: In a monorepo with workspace linking, this singleton should work correctly since all packages resolve to the same module instance. However, if packages are ever bundled separately or if there are duplicate `node_modules` resolutions, two different `adapterRegistry` instances could exist silently. Also, the singleton makes unit testing harder since tests must clean up global state.
- **Recommendation**: Keep the singleton export for convenience, but add a `reset()` or `clear()` method on `AdapterRegistry` for testing purposes. Add a note in the JSDoc that this relies on single module resolution.

**M3. No dead-letter queue (DLQ) support in EventBus**
- **Location**: `backend/packages/event-bus/src/bus.ts`
- **Plan reference**: Task 0.2 specifies "Dead-letter queue support: failed messages go to `${topic}.dlq`".
- **Current state**: BullMQ's built-in retry (`attempts: 3`) is configured, and failed jobs are kept (`removeOnFail: 100`), but there is no explicit DLQ routing. After 3 attempts, failed messages remain in the BullMQ failed set for the original queue, but they are not moved to a separate `${topic}.dlq` queue for monitoring/reprocessing.
- **Recommendation**: After all retries are exhausted, move the failed message to a dedicated DLQ queue. This can be done by listening to the `'failed'` event on the worker and checking `job.attemptsMade >= job.opts.attempts`, then adding to a `${topic}.dlq` queue. This is important for operational visibility.

### Minor

**m1. `maxRetriesPerRequest: null as any` type cast in EventBus**
- **Location**: `backend/packages/event-bus/src/bus.ts`, line 49
- **Current state**: `null as any` is used to satisfy the BullMQ requirement that `maxRetriesPerRequest` be `null` for workers.
- **Recommendation**: Use `null as unknown as number` or add a `// eslint-disable-next-line` comment explaining why. The `as any` masks the type system.

**m2. `query()` function uses `any` for params**
- **Location**: `backend/packages/db/src/client.ts`, line 83
- **Current state**: `params?: any[]` -- the parameter array is untyped.
- **Recommendation**: Use `params?: unknown[]` for stricter typing, or `params?: (string | number | boolean | null | Date | Buffer)[]` if you want to be explicit about allowed Postgres parameter types.

**m3. `query()` return type uses `any` for row type default**
- **Location**: `backend/packages/db/src/client.ts`, line 82
- **Current state**: `<T extends pg.QueryResultRow = any>` defaults the generic to `any`.
- **Recommendation**: Default to `pg.QueryResultRow` (which is `Record<string, any>`) instead of raw `any`. This is cosmetic but signals intent better.

**m4. Missing `AdapterRegistry.unregister()` method**
- **Location**: `backend/packages/adapter-sdk/src/adapter-registry.ts`
- **Recommendation**: Add an `unregister(provider: string)` method for testing and for hot-swapping adapters during development. Low priority but helpful.

**m5. `EventBus.schedule()` does not validate payload**
- **Location**: `backend/packages/event-bus/src/bus.ts`, lines 149-177
- **Current state**: `publish()` validates the payload against the Zod schema, but `schedule()` does not.
- **Recommendation**: Add the same schema validation to `schedule()` for consistency. A scheduled job with an invalid payload will fail silently on each cron tick.

**m6. No `tsconfig.json` files were reviewed, but the plan specifies `base-webhook.ts` and `base-client.ts` in the barrel export**
- **Location**: `backend/packages/adapter-sdk/src/index.ts`
- **Current state**: The barrel export only exports from `types.ts`, `base-adapter.ts`, and `adapter-registry.ts`. This is correct for the files that exist, but incomplete per the plan.
- **Recommendation**: Once `base-webhook.ts` and `base-client.ts` are created, add them to the barrel export.

---

## Contract Compliance Check (AGENT-CONTRACTS.md)

| Contract Item | Status | Notes |
|---|---|---|
| `PublisherAdapter` interface | PASS | All methods present: `handleWebhook`, `verifySignature`, `executeAction`, `rollbackAction`, `resolveEntity`, `healthCheck` |
| `NormalizedEvent` type | PASS | Matches contract plus adds `companyId`/`teamId` (beneficial addition) |
| `OutboundAction` type | PASS | Matches contract plus adds `companyId`/`metadata` (beneficial addition) |
| `ActionResult` type | PASS | Includes `rollbackInfo` for rollback support |
| `AdapterRegistry` | PASS | Routes outbound actions by provider |
| `TOPICS` constants (all 10) | PASS | All topics from contract defined |
| `EventBus.publish()` | PASS | Typed, validated |
| `EventBus.subscribe()` | PASS | Typed with envelope access |
| `EventBus.schedule()` | PASS | Cron support for digest.tick etc. |
| `EventBus.shutdown()` | PASS | Graceful shutdown |
| `EventEnvelope` | PASS | Has `id`, `topic`, `payload`, `timestamp`, `source`, `traceId` |
| Dead-letter queue | FAIL | Not implemented (see M3) |
| `initPool()` | PASS | Pool initialization works |
| `query()` | PASS | Parameterized queries with slow-query logging |
| `withTransaction()` | PASS | Transaction support |
| `listCompanyIds()` | PASS | For cron jobs |
| `migrate.ts` / migrations | FAIL | Not implemented (see C2) |
| `BaseWebhookHandler` | FAIL | Not implemented (see C1) |
| `BaseClient` | FAIL | Not implemented (see C1) |
| Shared config pattern | PASS | `initPool({ databaseUrl })` and `new EventBus({ redisUrl, serviceName })` match contract |
| No secrets in code | PASS | All credentials come from config/env |
| No SQL injection vectors | PASS | `query()` uses parameterized queries |
| Webhook signature verification | PARTIAL | Part of `PublisherAdapter` interface but no base class scaffolding |

---

## Extensibility Assessment

| Scenario | Assessment |
|---|---|
| Adding Linear publisher | PASS -- implement `PublisherAdapter`, register in `AdapterRegistry`, zero consumer changes |
| Adding new event topic | PASS -- add to `TOPICS` and `EventPayloadSchemas` in `topics.ts` |
| Adding new outbound action type | PASS -- `actionType` is a string, no enum restriction |
| Adding new capability | PASS -- `AdapterCapabilitySchema` is an enum that can be extended |
| No hardcoded provider names in base classes | PASS -- `BaseAdapter` uses abstract `provider` property |

---

## Summary of Required Actions

### Before Wave 2 starts (blocking)

1. **Create `base-webhook.ts`** with abstract signature verification scaffolding, or document the deviation
2. **Create `base-client.ts`** with HTTP retry/timeout/error normalization, or document the deviation
3. **Create `src/migrate.ts`** with migration runner and the `migrations/` directory
4. **Add payload validation to `EventBus.schedule()`** (m5 -- easy fix, prevents silent cron failures)

### Should fix soon (non-blocking but important)

5. Add DLQ routing after retry exhaustion in `EventBus` (M3)
6. Add warning log in `initPool()` when called with different config (M1)
7. Add `reset()`/`clear()` method to `AdapterRegistry` for testing (M2)

### Nice to have

8. Replace `as any` with proper type handling in bus.ts (m1)
9. Tighten `query()` param types (m2, m3)
10. Add `unregister()` to `AdapterRegistry` (m4)
