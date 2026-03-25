# KeepUp (FlowGuard) — Project Context

## Vision
A workflow-native intelligence and action layer that lives where developers already work (Slack, Jira, GitHub), detecting invisible friction and human bottlenecks — not replacing project management tools but bridging the gap between informal communication and formal tracking.

## Current State (Pre-Refactor)
- **Frontend**: React 18 + Vite + TailwindCSS + shadcn/ui in `src/`. Landing page + dashboard.
- **API** (`apps/api`): Monolith Express API — webhooks, ledger, remediation, inference, dashboard, auth.
- **Worker** (`apps/worker`): Monolith BullMQ worker — 15 scheduled jobs.
- **Shared** (`packages/shared`): Zod schemas for all domain entities.
- **Database**: PostgreSQL with UUID extensions.
- **AI**: OpenAI/Anthropic dual-provider orchestrator with fallback.

## Target Architecture (Phase 0)
- **Frontend** (`frontend/`): Standalone React app, zero backend imports.
- **Gateway** (`backend/gateway/`): API gateway — auth, routing, rate limiting.
- **Publishers** (`backend/publishers/{slack,jira,github}/`): Adapter-wrapped integration microservices. Each handles inbound webhooks AND outbound actions for its platform.
- **Consumers** (`backend/consumers/{data-processor,digest,ledger,ai-engine,executor}/`): Domain-focused processing microservices. Subscribe to event bus topics.
- **Shared Packages**: `@flowguard/shared` (schemas), `@flowguard/adapter-sdk` (publisher interface), `@flowguard/event-bus` (BullMQ wrapper), `@flowguard/db` (database).
- **Publisher Template** (`backend/publishers/_template/`): Copy-paste scaffold for adding new integrations (Linear, Zendesk, etc.).

## Core Pain Points from KeepUp.txt
1. **Context Fragmentation** — Decisions lost across Slack channels
2. **Backfilling Burden** — Manual effort translating chat to Jira
3. **Human Bottlenecks** — PRs stalling on review, unassigned action items
4. **Organizational Memory Decay** — Rationale lost when people leave

## Four Solution Pillars
1. **FlowGuard Memory** — Git-style truth ledger (implemented: LedgerService)
2. **FlowGuard Leaks** — Bottleneck detection (implemented: leak-engine)
3. **FlowGuard Remediation** — Daily digest + human-gated actions (implemented: digest-builder + executor)
4. **AI Administrative Reduction** — AI drafting of user stories/summaries (partially implemented: ai-orchestrator)

## Key Architectural Decision
**Publisher/Consumer pattern with adapter SDK** — Adding a new integration (Linear, Zendesk, etc.) requires: implement `PublisherAdapter` interface, deploy one microservice, zero changes to any consumer. This is the extensibility moat.
