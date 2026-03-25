# FlowGuard — Onboarding Guide

> Last updated: 2026-03-08

This guide is the current entry point for contributors working on FlowGuard. It focuses on what is actually implemented in the repository today rather than the earlier design-only phases.

## 1. What FlowGuard Is

FlowGuard is an operational-intelligence platform for software delivery teams. It ingests activity from Slack, Jira, and GitHub, normalizes those signals into a shared event model, computes operational metrics, detects process leaks, proposes remediations, and records decisions in a Git-like ledger.

The current product has four major user-facing pillars:

- Dashboards for health, leaks, approvals, metrics, teams, projects, and settings.
- A connected graph and Git ledger for tracing why a leak happened and what decision followed.
- An approval and execution layer for suggested remediations.
- Background automation that produces digests, nudges, AI drafts, inferred links, and cross-team analysis.

## 2. Services In The Repo

There are three runtime services and one shared package.

### Frontend

- Path: `src/`
- Stack: React 18, Vite, TanStack Query, Tailwind, shadcn/ui
- Default dev URL: `http://localhost:8080`
- Main app routes:
  - `/`
  - `/app`
  - `/app/leaks`
  - `/app/approvals`
  - `/app/ledger`
  - `/app/metrics`
  - `/app/teams`
  - `/app/projects`
  - `/app/projects/:id`
  - `/app/settings`

### API

- Path: `apps/api`
- Stack: Express, PostgreSQL, Redis-backed services, TypeScript
- Default dev URL: `http://localhost:3001`
- Public docs routes:
  - `/health`
  - `/docs/swagger`
  - `/docs/openapi.json`

### Worker

- Path: `apps/worker`
- Stack: BullMQ, Redis, PostgreSQL, TypeScript
- Role: scheduled automation and background processing

### Shared Package

- Path: `packages/shared`
- Role: shared schemas and types across frontend, API, and worker

## 3. Current Feature Set

This is the implemented feature map, grouped the same way contributors usually reason about the code.

### Dashboard Overview

- Company summary, scoped health, recent leaks, action counts, and integration state.

### Leak Management

- Paginated leak listing.
- Enriched leak context.
- Leak causal traces from leak to evidence, commits, and actions.
- Operator feedback flows for dismissal and scope correction.

### Approval Workflow

- Proposal review for remediation actions.
- Approval and rejection handling.
- Execution history and rollback hooks.

### Git Ledger And Graph

- Ledger commit list.
- Connected graph traversal.
- Commit promotion from team decision to org policy proposal.
- Saved graph routes with review packet dispatch to Slack, Jira, or GitHub.

### Metrics And Health

- Time-series metrics.
- Team-to-team comparison overlays.
- Derived per-team health scoring.

### Teams And Projects

- CRUD for teams and projects.
- Project activity graph.
- Custom team leak rules using Jira JQL.
- Manual GitHub Projects v2 and Jira component sync endpoints.

### Settings And Integrations

- Company settings.
- AI budget settings.
- Integration status display.
- Detailed system health.

### Connected Entity Inference

- Explicit entity links.
- Inferred links with confirm and dismiss actions.
- Manual inference engine execution for a team or project scope.

### Background Automation

- Metrics aggregation.
- Leak detection.
- Daily digest.
- Morning pulse.
- Proactive nudges.
- Decision capture.
- Sprint retrospectives.
- AI recommendation drafts.
- AI entity-link inference.
- AI impact summaries.
- Feedback threshold calibration.
- Cross-team pattern detection.

## 4. Documentation You Should Use

Use the docs in this order.

1. This onboarding guide for system orientation.
2. `docs/api/feature-and-endpoint-reference.md` for a feature-to-endpoint map.
3. `http://localhost:3001/docs/swagger` for request and response details.
4. `README.md` for local setup and the database relationship diagram.

## 5. Local Setup

### Prerequisites

- Node.js 18+
- npm 9+ or Bun for dependency management tasks
- Docker and Docker Compose

### Install

```bash
npm install
```

### Environment

Create `.env` from `.env.example`.

Minimum local values:

```env
DATABASE_URL=postgresql://flowguard:flowguard@localhost:5432/flowguard
REDIS_URL=redis://localhost:6379
API_PORT=3001
NODE_ENV=development
ADMIN_API_KEY=
VITE_API_URL=http://localhost:3001
VITE_API_KEY=
```

Notes:

- When `ADMIN_API_KEY` is empty in development, dashboard auth is skipped.
- If you do set `ADMIN_API_KEY`, set `VITE_API_KEY` to the same value.
- Real Slack, Jira, and GitHub credentials are only needed when testing live integrations or webhooks.

### Infrastructure And Data

```bash
npm run infra:up
npm run db:migrate
npm run seed:dev
```

### Run The Services

```bash
# frontend
npm run dev -- --host 0.0.0.0 --port 8080
```

```bash
# api
npm run dev:api
```

```bash
# worker
npm run dev:worker
```

Useful local URLs:

- App: `http://localhost:8080/app`
- API health: `http://localhost:3001/health`
- Swagger UI: `http://localhost:3001/docs/swagger`

## 6. Project Structure

Contributor-oriented view:

```text
FlowGuard/
├── src/                         frontend app and UI routes
├── apps/api/src/                express app, routes, services, migrations
├── apps/worker/src/             queue workers and scheduled jobs
├── packages/shared/src/         shared types and schemas
├── docs/                        onboarding and reference docs
├── infra/                       local postgres and redis
├── scripts/                     seed, bootstrap, and utility scripts
└── tests/                       playwright end-to-end coverage
```

Important API route files:

- `apps/api/src/routes/dashboard-api.ts`
- `apps/api/src/routes/ledger-routes.ts`
- `apps/api/src/routes/teams-projects.ts`
- `apps/api/src/routes/inference.ts`
- `apps/api/src/routes/admin.ts`
- `apps/api/src/routes/webhooks/slack.ts`
- `apps/api/src/routes/webhooks/jira.ts`
- `apps/api/src/routes/webhooks/github.ts`
- `apps/api/src/routes/docs.ts`

Important worker entry points:

- `apps/worker/src/index.ts`
- `apps/worker/src/services/*`

## 7. Request Flow And Data Flow

The real runtime loop looks like this:

1. Slack, Jira, and GitHub send events into webhook endpoints.
2. The API normalizes them into the `events` table and resolves team or project scope.
3. Link extraction creates explicit cross-tool links and, later, inferred links.
4. The worker turns events into `metric_snapshots` and then into `leak_instances`.
5. Remediation proposals are written to `proposed_actions`.
6. Approved actions can be executed and audited in `executed_actions`.
7. Decisions and policies are persisted in `ledger_commits`, with graph edges in `ledger_edges`.
8. Operators inspect everything through dashboard pages and graph tooling.

## 8. Authentication Model

There are three auth models in the codebase.

| Surface | Mechanism | Notes |
| --- | --- | --- |
| `/api/*` | `Authorization: Bearer <key>` or `x-api-key` | Uses `ADMIN_API_KEY` as the dashboard credential |
| `/admin/*` | `x-admin-key` | Also uses `ADMIN_API_KEY` when configured |
| `/webhooks/*` | Provider signature headers | Validation is skipped locally if the matching secret is unset |

## 9. Current Background Schedules

These jobs are defined in `apps/worker/src/index.ts`.

- Metrics aggregation: daily at 08:00.
- Leak detection: daily at 08:30.
- Digest generation: `DIGEST_CRON`, default weekdays at 09:00.
- Morning pulse: weekdays at 09:05.
- Proactive nudges: weekdays at 10:00.
- Decision capture: weekdays at 10:30.
- Sprint retro: biweekly Friday schedule.
- AI recommendation drafts: weekdays at 11:00.
- AI entity-link inference: weekdays at 11:15.
- AI impact summaries: weekdays at 11:30.
- Feedback calibration: Mondays at 06:00.
- Cross-team pattern detection: Wednesdays at 07:00.

## 10. Common Contributor Workflows

### Add Or Change A Dashboard Feature

1. Find the page under `src/pages/app`.
2. Find the matching API route in `apps/api/src/routes`.
3. Check whether the feature already has a documented endpoint in Swagger.
4. Update the feature reference doc if the contract changed.

### Add Or Change A Data Field

1. Update the migration or add a new migration in `apps/api/src/db/migrations`.
2. Update the API route and any service layer joins.
3. Update seed data if the new field is visible in the UI.
4. Update Swagger and the feature reference if the API shape changed.

### Work On Graph Or Ledger Behavior

1. Start in `apps/api/src/routes/dashboard-api.ts` for graph reads.
2. Use `apps/api/src/routes/ledger-routes.ts` for saved routes and dispatches.
3. Check `apps/api/src/services/entity-resolver.ts` and `apps/api/src/services/ledger.ts` for supporting logic.

### Work On Integrations Or Webhooks

1. Update the relevant webhook route under `apps/api/src/routes/webhooks`.
2. Check `apps/api/src/middleware/auth.ts` for signature verification requirements.
3. Update admin integration docs if new provider metadata is exposed.

## 11. Database Model At A Glance

The current schema is larger than the original MVP. The important mental grouping is:

- Operational state: `companies`, `integrations`, `teams`, `projects`
- Source signals: `events`
- Analysis outputs: `metric_snapshots`, `leak_instances`
- Remediation and audit: `proposed_actions`, `executed_actions`
- Decision memory: `ledger_commits`, `ledger_edges`
- Cross-tool graph: `entity_links`, `inferred_links`, `user_identity_map`
- Saved graph review artifacts: `ledger_routes`, `ledger_route_dispatches`

Use the README database diagram for the relationship view.

## 12. What To Trust Most

When docs and code disagree, trust them in this order:

1. Route implementation under `apps/api/src/routes`
2. Database migrations under `apps/api/src/db/migrations`
3. Swagger UI and OpenAPI JSON
4. This onboarding guide
5. Older phase docs under `docs/v2`, `docs/v3`, or `docs/previous`