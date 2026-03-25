# FlowGuard Feature And Endpoint Reference

> Last updated: 2026-03-08

This document maps FlowGuard's user-facing and operator-facing features to the API endpoints that power them.

Interactive API docs:

- Swagger UI: http://localhost:3001/docs/swagger
- OpenAPI JSON: http://localhost:3001/docs/openapi.json

## Authentication Model

- Dashboard APIs under `/api/*` accept either `Authorization: Bearer <ADMIN_API_KEY>` or `x-api-key: <ADMIN_API_KEY>`.
- Admin APIs under `/admin/*` use `x-admin-key: <ADMIN_API_KEY>`.
- Slack webhooks verify `x-slack-signature` and `x-slack-request-timestamp` when `SLACK_SIGNING_SECRET` is configured.
- Jira webhooks verify `x-atlassian-webhook-signature`, `x-hub-signature`, or `x-hub-signature-256` when `JIRA_WEBHOOK_SECRET` is configured.
- GitHub webhooks verify `x-hub-signature-256` when `GITHUB_WEBHOOK_SECRET` is configured.
- In local development, dashboard and admin auth are relaxed when keys are empty.

## 1. Dashboard Overview

UI route:

- `/app`

What it does:

- Gives the operator a single landing page for company status, scoped health, recent leaks, integration state, and top-line action volume.

How it works:

- The overview endpoints read from `companies`, `leak_instances`, `events`, `integrations`, `ledger_commits`, and `proposed_actions`.
- Team or project scoping happens at query time rather than by maintaining separate materialized views.

Endpoints:

| Method | Path | What it does | How it works | Key inputs |
| --- | --- | --- | --- | --- |
| `GET` | `/api/dashboard/overview` | Returns the main dashboard payload used by the app shell. | Aggregates company info, leak counts, event counts, recent leaks, integration state, commit status counts, and action status counts in parallel. | Optional `team_id`, `project_id` |
| `GET` | `/api/overview` | Returns a compact org summary. | Reads a smaller subset of the same tables for lightweight summary views or quick health snapshots. | None |
| `GET` | `/api/health/detailed` | Returns deeper service health for the settings area. | Pings the database and reports table counts for companies, events, and leaks. | None |

## 2. Leaks And Root-Cause Analysis

UI route:

- `/app/leaks`

What it does:

- Lists detected process leaks such as cycle-time drift, PR review bottlenecks, reopen spikes, decision drift, and custom JQL leak detections.
- Lets operators inspect evidence, supporting metrics, related commits, and downstream remediation proposals.

How it works:

- Leak records are stored in `leak_instances`.
- Deep context is built by joining leaks to `ledger_commits`, `entity_links`, `metric_snapshots`, and `proposed_actions`.
- Feedback flows are recorded as `events` with a `feedback.*` event type.

Endpoints:

| Method | Path | What it does | How it works | Key inputs |
| --- | --- | --- | --- | --- |
| `GET` | `/api/leaks` | Returns paginated leak records. | Filters leaks by status, type, team, project, and trailing day window. | `page`, `limit`, `status`, `leak_type`, `team_id`, `project_id`, `days` |
| `GET` | `/api/leaks/:id/context` | Returns the enriched context bundle for one leak. | Loads the leak, then joins related ledger commits, entity links, recent metrics, and proposed actions. | Leak id |
| `GET` | `/api/leaks/:id/trace` | Returns the causal trace for one leak. | Walks from the leak to triggered ledger commits, resulting actions, evidence events, and later metric snapshots. | Leak id |
| `POST` | `/api/feedback` | Records operator feedback. | Inserts a feedback event and optionally dismisses a leak or down-ranks an entity link depending on `feedback_type`. | `feedback_type`, `entity_id`, `entity_type`, optional `reason`, `metadata` |

## 3. Approval Workflow And Execution Audit

UI route:

- `/app/approvals`

What it does:

- Lets reviewers approve or reject remediation proposals.
- Shows execution history and supports rollback where the executor exposes it.

How it works:

- Approval drafts live in `proposed_actions`.
- Execution results and rollback metadata live in `executed_actions`.
- Approval transitions update the proposal row directly; rollback delegates to the executor service.

Endpoints:

| Method | Path | What it does | How it works | Key inputs |
| --- | --- | --- | --- | --- |
| `GET` | `/api/approvals` | Lists proposed actions. | Sorts pending actions ahead of processed actions and joins leak severity context for display. | `page`, `limit`, `status`, `team_id` |
| `POST` | `/api/approvals/:id/action` | Approves or rejects a proposal. | Updates only pending proposals and stamps `approved_by` and `approved_at`. | Proposal id, `action`, optional `actor` |
| `GET` | `/api/executions` | Lists executed actions. | Joins execution records with their originating proposal metadata. | `limit` |
| `POST` | `/api/executions/:id/rollback` | Attempts rollback. | Calls the executor rollback flow and returns either success or the failure reason. | Executed action id, optional `actor` |

## 4. Git Ledger And Traceable Decision Memory

UI route:

- `/app/ledger`

What it does:

- Shows the decision ledger as both a list and a graph.
- Lets operators inspect evidence edges, traverse connected graph neighborhoods, and promote team decisions into org policy proposals.

How it works:

- Ledger commits live in `ledger_commits`.
- Directed edges between commits and related entities live in `ledger_edges`.
- The tree response enriches commits with resolved target rows and derived filter dimensions for branch, tags, Jira issues, PRs, and Slack channels.

Endpoints:

| Method | Path | What it does | How it works | Key inputs |
| --- | --- | --- | --- | --- |
| `GET` | `/api/ledger/tree` | Returns the graph explorer payload. | Combines commits, edge-resolved target data, teams, active leaks, explicit linked entities, inferred links, and generated filter facets. | `commit_limit`, `leak_limit`, `status`, `commit_type`, `team_id`, `project_id`, `from`, `to`, `branch`, `jira_key`, `pr`, `slack_channel`, `tag`, `tags` |
| `GET` | `/api/ledger` | Returns paginated ledger commits. | Filters directly on `ledger_commits` with optional team and project scope. | `page`, `limit`, `status`, `commit_type`, `team_id`, `project_id` |
| `GET` | `/api/ledger/:id` | Returns a single commit row. | Loads the commit by id. | Commit id |
| `POST` | `/api/ledger/:id/promote` | Promotes a scoped decision to org policy. | Creates a new org-scoped `policy` commit linked through `promoted_from`. Source commits must already be approved or merged. | Commit id, optional `title`, optional `rationale` |
| `GET` | `/api/ledger/:id/edges` | Returns resolved edges for one commit. | Expands each edge with the matching target row from leaks, events, actions, or other commits. | Commit id |
| `GET` | `/api/ledger/:id/graph` | Returns a BFS traversal from one commit. | Delegates to the connected-graph resolver with a bounded `depth`. | Commit id, optional `depth` |

## 5. Saved Ledger Routes And Review Packets

UI route:

- `/app/ledger`

What it does:

- Saves named graph snapshots.
- Stores proposed solution text next to the snapshot.
- Dispatches review packets to Slack, Jira, or GitHub and preserves an audit trail of sends and failures.

How it works:

- Route snapshots live in `ledger_routes`.
- Dispatch audit rows live in `ledger_route_dispatches`.
- Slack dispatch posts a message, Jira dispatch adds a comment, and GitHub dispatch creates an issue or PR comment.

Endpoints:

| Method | Path | What it does | How it works | Key inputs |
| --- | --- | --- | --- | --- |
| `GET` | `/api/ledger/routes` | Lists active saved routes. | Returns the most recently updated routes and narrows by team or project when supplied. | `team_id`, `project_id`, `limit` |
| `POST` | `/api/ledger/routes` | Creates a saved route. | Persists the graph snapshot, dataset signature, extracted focus node ids, and optional solution draft. | `name`, `snapshot`, `dataset_signature`, optional scope fields |
| `PATCH` | `/api/ledger/routes/:id` | Updates a saved route. | Applies partial updates, refreshes focus node ids if a new snapshot is supplied, and updates `updated_at`. | Route id plus changed fields |
| `DELETE` | `/api/ledger/routes/:id` | Archives a saved route. | Soft-deletes by setting `status = 'archived'`. | Route id |
| `GET` | `/api/ledger/routes/:id/dispatches` | Lists review-packet dispatches. | Returns recent Slack, Jira, and GitHub dispatch attempts for the route. | Route id, optional `limit` |
| `POST` | `/api/ledger/routes/:id/dispatch` | Sends a route review packet. | Builds a review message, sends it to the selected provider, and records success or failure in the dispatch audit table. | Route id, `provider`, `target`, optional `message`, optional `actor` |

## 6. Metrics And Health Scoring

UI route:

- `/app/metrics`
- `/app`

What it does:

- Shows metric snapshots over time.
- Compares team trajectories against an org baseline.
- Computes a lightweight team health score for summary cards.

How it works:

- Metric rows live in `metric_snapshots`.
- Team health is calculated at request time from recent metric deviations plus active leak counts.

Endpoints:

| Method | Path | What it does | How it works | Key inputs |
| --- | --- | --- | --- | --- |
| `GET` | `/api/metrics` | Returns metric snapshots. | Filters the snapshot table by trailing days and optional metric name. | `days`, `metric_name` |
| `GET` | `/api/compare/metrics` | Returns team comparison series and org baseline. | Builds per-team averaged daily series, defaulting to all teams when `team_ids` is omitted. | Required `metric_name`, optional `team_ids`, optional `days` |
| `GET` | `/api/teams/health` | Returns per-team health cards. | Pulls latest team metric values, applies weighted penalties, and averages the result into a company score. | None |

## 7. Connected Entity Graph And Inference

Primary UI surfaces:

- `/app/ledger`
- `/app/projects/:id`

What it does:

- Connects Slack, Jira, and GitHub entities into a shared graph.
- Lets operators inspect explicit and inferred relationships.
- Supports manual confirmation or dismissal of inferred links.

How it works:

- Explicit links live in `entity_links`.
- Inferred links live in `inferred_links`.
- The inference engine uses team and project scope plus cross-platform signals to propose missing edges.

Endpoints:

| Method | Path | What it does | How it works | Key inputs |
| --- | --- | --- | --- | --- |
| `GET` | `/api/entity-links` | Lists explicit entity links. | Filters by entity id, provider, and link type. | `entity_id`, `provider`, `link_type`, `limit` |
| `GET` | `/api/entities/:provider/:id/connections` | Returns all outgoing and incoming connections for one entity. | Expands the matching `entity_links` rows into a direction-aware connection list plus raw links. | Provider, entity id |
| `POST` | `/api/inference/run` | Runs inferred-link generation. | Invokes the inference engine for the org, a team, or a project and supports dry-run execution. | Optional `team_id`, `project_id`, `dry_run` |
| `PATCH` | `/api/inferred-links/:id` | Confirms or dismisses an inferred link. | Updates status, stamps the actor, and boosts confidence to `1.0` on confirmation. | Inferred link id, `status`, optional `actor` |

## 8. Teams, Team Rules, And Ownership Modeling

UI route:

- `/app/teams`

What it does:

- Manages teams and their ownership metadata.
- Stores team colors, lead ids, and custom JQL leak rules.

How it works:

- Team rows live in `teams`.
- Custom leak rules are stored in the team's `custom_leak_rules` JSONB field and evaluated through Jira-aware services.

Endpoints:

| Method | Path | What it does | How it works | Key inputs |
| --- | --- | --- | --- | --- |
| `POST` | `/api/teams` | Creates a team. | Inserts a new team row, using the primary company when `company_id` is omitted. | `name`, `slug`, optional description and display fields |
| `GET` | `/api/teams` | Lists teams. | Returns teams with derived counts for active projects, recent events, and active leaks. | Optional `company_id` |
| `GET` | `/api/teams/:id` | Returns team detail. | Loads the team plus its projects. | Team id |
| `PATCH` | `/api/teams/:id` | Updates a team. | Applies dynamic updates to the supplied fields only. | Team id plus changed fields |
| `DELETE` | `/api/teams/:id` | Deletes a team. | Deletes the team when it belongs to the primary company. | Team id |
| `GET` | `/api/teams/:id/leak-rules` | Lists custom leak rules. | Returns the team's stored JQL rule set. | Team id |
| `POST` | `/api/teams/:id/leak-rules` | Creates or updates a custom leak rule. | Validates and upserts a JQL rule in the team config. | Team id, `id`, `name`, `jql`, `threshold`, optional multiplier |
| `DELETE` | `/api/teams/:id/leak-rules/:ruleId` | Deletes a custom leak rule. | Verifies the team exists, then removes the matching rule. | Team id, rule id |
| `POST` | `/api/leak-rules/validate` | Validates a JQL expression. | Performs a dry-run Jira validation against the supplied `jql`. | `jql` |
| `POST` | `/api/leak-rules/evaluate` | Evaluates all custom leak rules. | Runs the custom-rule evaluator for the primary company. | None |

## 9. Projects, Scoped Activity, And Sync Operations

UI routes:

- `/app/projects`
- `/app/projects/:id`

What it does:

- Manages projects and the external identifiers that scope incoming events.
- Shows a project-specific activity graph built from events, leaks, entity links, and metrics.
- Provides manual sync controls for GitHub Projects v2 and Jira components.

How it works:

- Project rows live in `projects`.
- External identifiers in `jira_project_keys`, `github_repos`, and `slack_channel_ids` drive scope resolution during ingestion.

Endpoints:

| Method | Path | What it does | How it works | Key inputs |
| --- | --- | --- | --- | --- |
| `POST` | `/api/projects` | Creates a project. | Persists scope mappings plus lifecycle metadata. | `name`, `slug`, optional scope arrays and dates |
| `GET` | `/api/projects` | Lists projects. | Returns projects with team name/color and derived event/leak counts. | Optional `company_id`, `team_id`, `status` |
| `GET` | `/api/projects/:id` | Returns project detail. | Loads the project and computes recent event/leak counts. | Project id |
| `PATCH` | `/api/projects/:id` | Updates a project. | Applies dynamic field updates to the selected project. | Project id plus changed fields |
| `DELETE` | `/api/projects/:id` | Deletes a project. | Deletes the project when it belongs to the primary company. | Project id |
| `GET` | `/api/projects/:id/activity-graph` | Returns the project activity graph. | Combines recent scoped events, scoped leaks, explicit links, and recent project metrics into graph nodes and edges. | Project id, optional `days` |
| `POST` | `/api/sync/github-projects` | Runs GitHub Projects v2 sync. | Triggers the GitHub Projects metadata synchronizer for the primary company. | None |
| `POST` | `/api/sync/jira-components` | Runs Jira component sync. | Refreshes Jira component mappings used for project sub-scoping. | `project_key` |

## 10. Settings, Integrations, And Budget Controls

UI route:

- `/app/settings`

What it does:

- Shows company configuration, AI budget settings, integration status, and health details.

How it works:

- General settings live in the `companies.settings` JSONB document.
- Integration status and provider metadata live in `integrations`.

Endpoints:

| Method | Path | What it does | How it works | Key inputs |
| --- | --- | --- | --- | --- |
| `GET` | `/api/settings` | Returns company settings and integration rows. | Loads the primary company plus its integration records. | None |
| `PATCH` | `/api/settings` | Patches company settings. | Merges the request body into the existing company settings JSON. | Arbitrary settings fields |
| `GET` | `/api/settings/ai-budget` | Returns AI-specific settings. | Reads `ai_budget_per_day`, `ai_enabled_features`, and `digest_roles` from company settings. | None |
| `PATCH` | `/api/settings/ai-budget` | Patches AI-specific settings. | Updates only the allowed AI budget keys. | Any of `ai_budget_per_day`, `ai_enabled_features`, `digest_roles` |
| `GET` | `/api/integrations` | Lists current integrations. | Returns integration rows for the primary company. | None |
| `GET` | `/api/health/detailed` | Returns service health and row counts. | Used by settings screens and operator diagnostics. | None |

## 11. Admin And Bootstrap Operations

Primary usage:

- Manual bootstrap scripts
- Environment setup
- Integration provisioning

What it does:

- Lets operators list companies, patch operational settings directly, and upsert integrations or webhook credentials.

How it works:

- These endpoints bypass dashboard scoping and work directly on target company ids.
- Responses intentionally sanitize token storage so secrets are not echoed back.

Endpoints:

| Method | Path | What it does | How it works | Key inputs |
| --- | --- | --- | --- | --- |
| `GET` | `/admin/companies` | Lists companies. | Returns company rows ordered by newest first. | None |
| `PATCH` | `/admin/companies/:companyId/settings` | Patches supported company settings. | Validates a specific settings subset before merging it. | Company id plus settings patch |
| `GET` | `/admin/integrations/:companyId` | Lists integrations for one company. | Returns sanitized integration metadata, including token key names but not secret values. | Company id |
| `PUT` | `/admin/integrations/:companyId/:provider` | Creates or updates an integration. | Upserts installation data, token data, scopes, and webhook-secret state. | Company id, provider, integration payload |

## 12. Webhook Ingestion

Primary usage:

- Slack app events and interactivity
- Jira webhooks
- GitHub webhooks

What it does:

- Normalizes external tool activity into FlowGuard events.
- Resolves team and project scope.
- Extracts cross-tool links and triggers side-effect workflows like PR commentary or component sync.

How it works:

- Webhooks are acknowledged immediately where providers require fast responses.
- Background processing is fire-and-forget inside the API for the current implementation.

Endpoints:

| Method | Path | What it does | How it works | Key inputs |
| --- | --- | --- | --- | --- |
| `POST` | `/webhooks/slack/events` | Receives Slack Events API payloads. | Handles URL verification, normalizes supported events, resolves scope, stores events, and triggers entity-link extraction. | Slack event payload |
| `POST` | `/webhooks/slack/actions` | Receives Slack interactive payloads. | Handles approve/reject/propose actions and Workflow Builder configuration flows. | Form-encoded `payload` |
| `GET` | `/webhooks/slack/oauth/callback` | Completes Slack OAuth install. | Exchanges `code` for tokens and upserts the Slack integration for the resolved or default company. | Query `code`, optional `state`, optional `error` |
| `POST` | `/webhooks/jira` | Receives Jira webhook events. | Normalizes issue and comment activity, resolves scope, extracts issue links, and syncs Jira components. | Jira webhook payload |
| `POST` | `/webhooks/github` | Receives GitHub webhook events. | Normalizes PR, review, deployment, check-suite, and Projects v2 events, resolves scope, extracts links, and may run PR commentary. | GitHub webhook payload |

## 13. Background Automation

Service:

- `apps/worker`

What it does:

- Runs scheduled operational intelligence jobs that do not require a user to call an endpoint directly.

How it works:

- Uses BullMQ queues backed by Redis.
- Schedules repeatable jobs for company-wide processing.

Current scheduled jobs:

- Daily metrics aggregation at 08:00.
- Daily leak detection at 08:30.
- Daily digest at `DIGEST_CRON`.
- Morning pulse at 09:05 weekdays.
- Proactive nudges at 10:00 weekdays.
- Decision capture at 10:30 weekdays.
- AI recommendation drafts at 11:00 weekdays.
- AI entity-link inference at 11:15 weekdays.
- AI impact summaries at 11:30 weekdays.
- Feedback threshold calibration weekly on Monday.
- Cross-team pattern detection weekly on Wednesday.
- Sprint retrospective on a biweekly schedule.

## 14. Database Tables Behind The Features

Core tables by responsibility:

- `companies`: tenant configuration and global settings.
- `integrations`: external provider connection state and credentials.
- `events`: append-only normalized source activity.
- `metric_snapshots`: computed metric history and baselines.
- `leak_instances`: detected process leaks.
- `ledger_commits`: decision and policy memory.
- `ledger_edges`: typed graph edges from commits to evidence and related entities.
- `proposed_actions`: remediation drafts requiring approval.
- `executed_actions`: immutable execution audit trail and rollback metadata.
- `teams`: ownership and custom leak rule storage.
- `projects`: scoped initiatives and external identifier mappings.
- `entity_links`: explicit cross-tool graph edges.
- `inferred_links`: confidence-scored inferred graph edges.
- `user_identity_map`: cross-platform identity mapping per team.
- `ledger_routes`: saved graph traversal packets.
- `ledger_route_dispatches`: outbound review packet audit log.

## 15. Recommended Reading Order

1. Start with the onboarding guide in `docs/onboarding/onboarding.md`.
2. Open Swagger UI at `http://localhost:3001/docs/swagger` to inspect request and response shapes.
3. Use this document when you want the feature-level mental model rather than just the raw HTTP contract.