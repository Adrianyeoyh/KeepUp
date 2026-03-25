# KeepUp Refactoring Roadmap

## Milestone 1: Workflow-Centric Refactor

Based on the KeepUp.txt document analysis, this roadmap addresses the gap between the current implementation and the investor-aligned vision of solving invisible workflow friction rather than "fixing broken tools."

### Phase 0: Architectural Refactor — Microservice + Publisher/Consumer Split
**Goal**: Separate frontend and backend into distinct top-level folders. Decompose the monolith API and worker into microservices using a publisher/consumer pattern. Publishers (Slack, Jira, GitHub) become adapter-wrapped microservices so new integrations (Linear, Zendesk, etc.) are pluggable. Consumers (data-processor, digest, ledger) process events from a shared event bus.
**Status**: unplanned

### Phase 1: Foundation — Real Data Pipeline & Noise Reduction
**Goal**: Replace seeded/demo data reliance with real webhook ingestion, calibrate leak detection thresholds to prevent false-positive fatigue (existential risk per KeepUp.txt).
**Status**: unplanned
**Depends on**: Phase 0

### Phase 2: Memory Ledger UX — "One-Click Context Translation"
**Goal**: Make the truth ledger accessible and actively reused (not write-only). Implement one-click capture from Slack threads to ledger commits with deep-link writeback.
**Status**: unplanned
**Depends on**: Phase 1

### Phase 3: Digest & Remediation — "Workflow-Native Intelligence"
**Goal**: Refine the daily digest to max 1-3 actionable insights with cost estimates, evidence links, and human-gated approval buttons that convey full context (what/why/risk/rollback).
**Status**: unplanned
**Depends on**: Phase 1

### Phase 4: AI Administrative Reduction — Bounded AI Drafting
**Goal**: Implement AI-assisted user story drafting, decision summaries, and story-point estimation from cycle-time data. Strict guardrails, no hallucination tolerance.
**Status**: unplanned
**Depends on**: Phase 2, Phase 3

### Phase 5: Integration Hardening & Feedback Loop
**Goal**: Close the feedback loop — track whether acted-on remediations actually improved metrics. Implement threshold calibration from real usage. Validate on real team workflows.
**Status**: unplanned
**Depends on**: Phase 4
