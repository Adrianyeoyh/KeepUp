# FlowGuard

FlowGuard is an operational intelligence dashboard that connects Slack, Jira, and GitHub signals to detect process leaks, recommend actions, and keep a decision audit trail in a Git-style ledger.

## What FlowGuard Does

- Detects leak patterns such as cycle-time drift, PR review bottlenecks, reopen spikes, and unlogged action items.
- Surfaces AI-assisted diagnosis and suggested actions.
- Supports approval workflows before executing remediation.
- Provides a Git Ledger (tree + graph) to trace decisions, leaks, ownership, and evidence links.
- Tracks team and project-level health and activity over time.

## Architecture At A Glance

| Service | Path | Default Port | Responsibility |
| --- | --- | --- | --- |
| Frontend | `src/` | `8080` (dev) | Dashboard UI (React + Vite) |
| API | `apps/api` | `3001` | REST APIs, auth, webhook ingestion, ledger routes |
| Worker | `apps/worker` | n/a | Scheduled jobs for metrics, leak detection, digests, nudges, decision capture, and AI automation |
| Shared Types | `packages/shared` | n/a | Shared schemas and types |
| Infra | `infra/docker-compose.yml` | n/a | Postgres + Redis local dependencies |

## Tech Stack

- React 18 + TypeScript + Vite
- TanStack Query
- Tailwind CSS + shadcn/ui
- Express + PostgreSQL + Redis + BullMQ
- Vitest + Playwright

## Documentation

- Onboarding: [`docs/onboarding/onboarding.md`](docs/onboarding/onboarding.md)
- Feature and endpoint reference: [`docs/api/feature-and-endpoint-reference.md`](docs/api/feature-and-endpoint-reference.md)
- Swagger UI: `http://localhost:3001/docs/swagger`
- OpenAPI JSON: `http://localhost:3001/docs/openapi.json`

## Database Structure

The current schema goes beyond the original MVP. The diagram below reflects the live migration set in `apps/api/src/db/migrations`.

```mermaid
erDiagram
	companies ||--o{ integrations : has
	companies ||--o{ teams : owns
	companies ||--o{ projects : owns
	companies ||--o{ events : ingests
	companies ||--o{ metric_snapshots : computes
	companies ||--o{ leak_instances : detects
	companies ||--o{ ledger_commits : records
	companies ||--o{ proposed_actions : proposes
	companies ||--o{ executed_actions : audits
	companies ||--o{ entity_links : links
	companies ||--o{ inferred_links : infers
	companies ||--o{ ledger_routes : stores
	companies ||--o{ ledger_route_dispatches : audits

	teams ||--o{ projects : groups
	teams ||--o{ events : scopes
	teams ||--o{ leak_instances : scopes
	teams ||--o{ ledger_commits : scopes
	teams ||--o{ proposed_actions : scopes
	teams ||--o{ inferred_links : scopes
	teams ||--o{ user_identity_map : maps

	projects ||--o{ events : scopes
	projects ||--o{ leak_instances : scopes
	projects ||--o{ ledger_commits : scopes
	projects ||--o{ ledger_routes : scopes

	leak_instances ||--o{ ledger_commits : triggers
	leak_instances ||--o{ proposed_actions : drives
	proposed_actions ||--o{ executed_actions : executes
	ledger_commits ||--o{ ledger_edges : emits
	ledger_routes ||--o{ ledger_route_dispatches : dispatches
```

Schema groups:

- Operational state: `companies`, `integrations`, `teams`, `projects`
- Signal ingestion: `events`
- Analysis: `metric_snapshots`, `leak_instances`
- Decisions and audit: `ledger_commits`, `ledger_edges`, `proposed_actions`, `executed_actions`
- Graph intelligence: `entity_links`, `inferred_links`, `user_identity_map`
- Saved review packets: `ledger_routes`, `ledger_route_dispatches`

## Installation And Local Setup

### 1) Prerequisites

- Node.js 18+
- npm 9+
- Docker + Docker Compose

### 2) Clone And Install

```bash
git clone <your-repo-url>
cd FlowGuard
npm install
```

### 3) Start Local Infrastructure (Postgres + Redis)

```bash
npm run infra:up
```

### 4) Configure Environment Variables

Copy the sample env file:

```bash
cp .env.example .env
```

Minimum vars for local development:

```env
DATABASE_URL=postgresql://flowguard:flowguard@localhost:5432/flowguard
REDIS_URL=redis://localhost:6379
API_PORT=3001
NODE_ENV=development
ADMIN_API_KEY=
```

Optional frontend env vars (if you want explicit API URL/key wiring):

```env
VITE_API_URL=http://localhost:3001
VITE_API_KEY=
```

Notes:

- In development, if `ADMIN_API_KEY` is empty, dashboard auth is skipped.
- If you set `ADMIN_API_KEY`, set `VITE_API_KEY` to the same value so the frontend can authenticate.

### 5) Run Database Migrations

```bash
npm run db:migrate
```

### 6) Seed Development Data (recommended)

```bash
npm run seed:dev
```

### 7) Start Services

Run in separate terminals:

```bash
# API
npm run dev:api
```

```bash
# Frontend
npm run dev -- --host 0.0.0.0 --port 8080
```

```bash
# Optional: worker for scheduled/background jobs
npm run dev:worker
```

Open:

- App: `http://localhost:8080/app`
- API health: `http://localhost:3001/health`
- Swagger UI: `http://localhost:3001/docs/swagger`

## How To Use The Features (Tutorial)

### 1) Dashboard Overview (`/app`)

What it does:

- Shows current health score, active leaks, estimated hours lost, events, and pending approvals.
- Gives team-level health comparisons and integration status.

How to use:

1. Open `/app`.
2. Check active leak count and cost estimate.
3. Use scope selection (sidebar) to narrow by team.

### 2) Leaks (`/app/leaks`)

What it does:

- Lists detected leaks with severity, confidence, evidence, and AI explanation.
- Supports filtering by type/status and dismissing false positives.

How to use:

1. Filter by leak type and status.
2. Expand a leak card to inspect metric context and evidence links.
3. Dismiss false positives with a rationale when needed.

### 3) Approvals (`/app/approvals`)

What it does:

- Shows proposed remediation actions.
- Lets reviewers approve or reject actions with rationale.

How to use:

1. Filter to `pending`.
2. Inspect payload preview and risk metadata.
3. Approve or reject with optional reviewer rationale.

### 4) Git Ledger (`/app/ledger`)

Two views:

- Tree view: chronological and structured decision history.
- Graph view: relationship map of commits, leaks, teams, and linked entities.

Graph interactions:

- Zoom: mouse wheel or trackpad pinch on graph canvas.
- Zoom controls: `-` / `+` toolbar buttons.
- Reset: resets zoom and layout.
- Drag: drag nodes to inspect dense clusters.
- Focus lock: click nodes to lock focus context.
- Multi-focus: enable to lock multiple nodes in sequence.
- Focus order tracker: right panel shows click order and supports `Set Last` to reorder anchor.
- Route tools: save, restore, rename, delete, copy review packet, and dispatch review packet.

### 5) Metrics (`/app/metrics`)

What it does:

- Displays Golden Rules metrics over configurable date ranges.
- Supports team-compare mode and anomaly markers.

How to use:

1. Select timeframe (7/14/30/90 days).
2. Toggle compare mode for cross-team baseline comparison.
3. Enable/disable metric series to isolate trends.

### 6) Teams (`/app/teams`)

What it does:

- CRUD management for teams.
- Shows per-team project count, events, and active leaks.

How to use:

1. Create a team with name/slug/color.
2. Edit details or delete obsolete teams.

### 7) Projects (`/app/projects`) And Project Activity (`/app/projects/:id`)

What it does:

- CRUD management for projects and tool mappings.
- Maps Jira project keys, GitHub repos, and Slack channels to project scope.
- Activity page shows connected tools, health snapshot, and recent project activity graph.

How to use:

1. Create a project and attach Jira/GitHub/Slack identifiers.
2. Open a project card to view activity and metrics context.

### 8) Settings (`/app/settings`)

What it does:

- Shows system health and database counts.
- Displays configured integration statuses and company settings.

How to use:

1. Click `Refresh` in System Health.
2. Check integration status and installation metadata.

## Admin Bootstrap (Optional)

Use the helper script to patch company settings and upsert integration metadata/tokens:

```bash
npm run admin:bootstrap
```

Script path: `scripts/bootstrap-admin.sh`

Common env vars used by the script include:

- `ADMIN_API_KEY`
- `DIGEST_USER_IDS`, `DIGEST_CHANNEL_IDS`
- `SLACK_BOT_TOKEN`
- `JIRA_ACCESS_TOKEN`
- `GITHUB_ACCESS_TOKEN`

## Useful Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start frontend dev server |
| `npm run dev:api` | Start API server |
| `npm run dev:worker` | Start worker |
| `npm run build` | Build frontend |
| `npm run build:api` | Build API |
| `npm run lint` | Lint workspace |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run seed:dev` | Seed development dataset |
| `npm run db:migrate` | Run DB migrations |
| `npm run infra:up` | Start Postgres + Redis |
| `npm run infra:down` | Stop Postgres + Redis |

## Troubleshooting

### API connection refused

- Confirm API is running: `npm run dev:api`
- Confirm port 3001 is open.

### Empty dashboard/no data

- Run migrations: `npm run db:migrate`
- Seed data: `npm run seed:dev`

### Unauthorized API requests

- If `ADMIN_API_KEY` is set, ensure `VITE_API_KEY` matches it.

### Background jobs not running

- Ensure Redis is up (`npm run infra:up`) and worker is started (`npm run dev:worker`).

## Repository Layout

```text
apps/
	api/         Express API + routes + services + migrations
	worker/      BullMQ workers and scheduled jobs
packages/
	shared/      Shared schemas/types
src/           Frontend app (pages/components/hooks)
scripts/       Seed/bootstrap/tunnel helper scripts
infra/         Docker compose + DB init
tests/         Playwright E2E tests
```

## Additional Documentation

- Detailed onboarding: `docs/onboarding/onboarding.md`
- V2 design and tracking docs: `docs/v2/`
