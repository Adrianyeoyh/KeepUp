# Phase 1: Foundation — Real Data Pipeline & Noise Reduction

## Goal
Replace seeded/demo data reliance with robust real webhook ingestion and calibrate leak detection thresholds to prevent false-positive fatigue — the existential risk identified in KeepUp.txt ("if the system flags too many false positives, engineers will lose trust and the product will be disabled").

## Depends On
Phase 0 (Architectural Refactor). All file paths below use the new microservice structure.

## Why This Phase Second
Every other feature (Memory Ledger, Digest, AI Drafting) depends on real, accurate data flowing through the system. The KeepUp.txt document explicitly calls out: "The product currently relies too heavily on seeded demo data. To prove AI administrative reduction is actually valuable, FlowGuard must validate its effectiveness on real, messy team workflows."

---

## Wave 1: Publisher Ingestion Logic (Tasks 1.1–1.3)

### Task 1.1: Slack Publisher — Complete Normalizer & Cross-Reference Detection
**File**: `backend/publishers/slack/src/normalizer.ts`
**What**:
- Implement full Slack event normalization (Phase 0 created the skeleton; this fills in the logic)
- Add idempotency guard using `provider_event_id` (Slack's `event_id`) to prevent duplicate processing
- Extract `thread_ts`, `channel_id`, `user_id` into structured `metadata` JSONB
- Detect cross-references: parse message text for Jira keys (`/[A-Z]+-\d+/`), GitHub PR URLs, and other Slack thread links
- Resolve `team_id` from channel → team mapping in company settings
- Detect implied actions: messages with action verbs ("let's", "we should", "action item") but no linked ticket
**Acceptance**:
- All Slack events normalized with correct `source='slack'`, typed `event_type`, and structured metadata
- Cross-references detected and included in `NormalizedEvent.crossReferences`
- Implied actions flagged in metadata for unlogged-action-items leak detection
- Unit test: send same event twice, verify idempotency guard prevents double-publish

### Task 1.2: Jira Publisher — Complete Normalizer & Entity Extraction
**File**: `backend/publishers/jira/src/normalizer.ts`
**What**:
- Implement full Jira webhook normalization for: `issue_created`, `issue_updated`, `issue_transitioned`, `issue_reopened`, `sprint_started`, `sprint_closed`
- Extract `issue_key`, `status`, `from_status`, `to_status`, `assignee`, `epic_key`, `story_points`, `sprint_id`
- Detect cross-references: parse description/comments for Slack thread URLs, GitHub PR URLs
- Handle bulk transitions (Jira automation can move many issues at once)
**Acceptance**:
- Jira status transitions include `from_status` and `to_status` in metadata
- Cross-references to Slack/GitHub detected in issue descriptions
- Unit test: Jira issue with GitHub PR link in description produces correct cross-reference

### Task 1.3: GitHub Publisher — Complete Normalizer & PR Lifecycle
**File**: `backend/publishers/github/src/normalizer.ts`
**What**:
- Track full PR lifecycle: opened → review_requested → review_submitted → approved → merged/closed
- Extract `files_changed` array (crucial for cross-team collision detection in proactive-nudges)
- Detect cross-references: Jira issue keys in PR title, body, and branch name
- Store `html_url`, `author`, `requested_reviewer`, `review_state` in metadata
**Acceptance**:
- PR review request + review submission tracked as separate events
- `files_changed` extracted for collision detection
- Jira keys auto-detected from PR title/body/branch name

---

## Wave 2: Consumer Processing Logic (Tasks 1.4–1.6)

### Task 1.4: Data Processor — Event Persistence & Entity Link Creation
**File**: `backend/consumers/data-processor/src/handlers/on-event-ingested.ts`
**What**:
- Persist `NormalizedEvent` to DB `events` table
- Process `crossReferences` from the event: create `entity_links` for each detected cross-reference
- Resolve and assign `team_id` using entity-resolver logic
- Emit downstream events as needed (e.g., after sufficient events accumulated, trigger metrics refresh)
**Acceptance**:
- Events persisted to DB with correct schema
- Entity links auto-created from cross-references
- No data loss — every published event is persisted

### Task 1.5: Leak Detection — Rolling Baseline & Evidence-Weighted Confidence
**File**: `backend/consumers/data-processor/src/services/leak-engine.ts`
**What**:
- Replace static `baselineValue` comparison with 14-day rolling median baseline
- Add `baseline_window_days` to company settings (default: 14)
- Implement percentile-based thresholds (p75 triggers warning, p90 triggers leak) instead of flat 10-15% above baseline
- Add rate-of-change detection: flag rapid spikes separately from gradual drift
- Replace hardcoded confidence values (0.65, 0.72, 0.78) with evidence-weighted scoring:
  - `confidence = base_confidence * evidence_multiplier * recency_decay`
  - `evidence_multiplier`: higher when multiple sources agree (Slack + Jira + GitHub)
  - `recency_decay`: lower confidence for older evidence
- Add minimum confidence threshold (0.6) below which leaks are not created
- Publish to `leaks.detected` topic
**Acceptance**:
- Leak detection uses 14-day rolling median, not static baseline
- Confidence varies based on evidence quality
- Leaks with confidence < 0.6 suppressed
- Test: high-variance team doesn't trigger false decision_drift

### Task 1.6: Noise Control — Snooze, Dismiss & Feedback Loop
**Files**:
- `backend/consumers/data-processor/src/services/feedback-flywheel.ts`
- `backend/packages/shared/src/schemas/leak-instance.ts`
- Gateway: new endpoints in dashboard API
**What**:
- Add `snoozed` and `dismissed` to leak status enum
- Add `PATCH /api/leaks/:id/snooze` endpoint (sets status + snooze_until timestamp)
- Add `PATCH /api/leaks/:id/dismiss` endpoint with required `reason` field
- Track dismiss reasons to feed into threshold calibration
- Enhance feedback-flywheel: if >30% of a leak type is dismissed in 30 days, raise threshold by 10%
**Acceptance**:
- Leaks can be snoozed or dismissed
- Dismissal reasons stored and queryable
- Feedback flywheel auto-adjusts thresholds based on dismiss rate

---

## Wave 3: Data Quality & Observability (Tasks 1.7–1.8)

### Task 1.7: Migration System — Schema Evolution
**Files**: `backend/packages/db/migrations/*`
**What**:
- Create migration for: adding `snoozed`/`dismissed` to leak_instances status enum
- Create migration for: adding `snooze_until` and `dismiss_reason` columns
- Create migration for: adding `baseline_window_days` to company settings
- Ensure `npm run db:migrate` applies pending migrations idempotently
**Acceptance**:
- Migrations apply cleanly on fresh DB and existing DB
- Rollback path documented for each migration

### Task 1.8: Health & Pipeline Observability
**Files**: `backend/gateway/src/routes/health.ts`
**What**:
- `/health/deep`: checks DB connectivity, Redis connectivity, event bus health, last-processed event timestamp per publisher
- `/api/admin/pipeline-status`: events ingested (24h), leaks detected (24h), digests sent (24h), per-publisher event counts, queue depths
- Prometheus-compatible `/metrics` endpoint
**Acceptance**:
- `/health/deep` returns 503 if any critical dependency is unreachable
- Pipeline status shows per-publisher ingestion health
- Metrics endpoint parseable by Prometheus/Grafana

---

## Success Criteria (Phase 1 Complete When)
1. All three publishers process real webhooks through the adapter → event bus → consumer pipeline end-to-end
2. Leak detection uses rolling baselines and evidence-weighted confidence scoring
3. Users can snooze/dismiss leaks, and the feedback flywheel auto-adjusts thresholds
4. Pipeline health is observable via `/health/deep` and admin status endpoints
5. No reliance on seeded data — system operates on real webhook payloads

## Risks
- **Webhook volume**: High-traffic Slack workspaces could overwhelm publishers. Mitigation: publishers are independently scalable + BullMQ backpressure.
- **Baseline cold-start**: New companies won't have 14 days of data. Mitigation: use global defaults for first 14 days.
- **Integration testing**: Real webhooks are hard to test locally. Mitigation: create replay scripts from captured payloads in `scripts/`.
