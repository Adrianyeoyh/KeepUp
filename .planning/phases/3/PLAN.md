# Phase 3: Digest & Remediation — "Workflow-Native Intelligence"

## Goal
Refine the daily digest to deliver max 1–3 actionable insights with cost estimates, evidence links, and human-gated approval buttons that convey full context (what/why/risk/rollback). Make FlowGuard indispensable by living where developers already work.

## Why This Phase
KeepUp.txt: "Teams do not need more numbers; they need interpreted, actionable guidance." The current digest-builder creates Slack blocks but needs refinement for: noise control, deep approval context, role-based views, and closed-loop tracking.

---

## Wave 1: Digest Quality (Tasks 3.1–3.3)

### Task 3.1: Smart Ranking — Top 3 by Impact
**File**: `apps/worker/src/services/digest-builder.ts` (refactor)
**What**:
- Replace simple `slice(0, 3)` with impact-ranked selection
- Scoring: `severity * confidence * cost_estimate_hours_per_week * (1 - snooze_rate)`
- Deduplicate similar leaks (e.g., don't show 3 decision_drift leaks — group and show count)
- Add "Also detected but lower priority" collapsed section for transparency
**Acceptance**:
- Digest shows top 3 leaks ranked by impact score, not just severity
- Similar leak types grouped (e.g., "3 decision drift threads" not 3 separate items)
- Lower-priority items visible in collapsed section

### Task 3.2: Rich Approval Context
**File**: `apps/worker/src/services/digest-builder.ts` (enhance blocks)
**What**:
- Each insight includes: what happened, why it matters, estimated weekly cost, recommended action, risk of action, rollback plan
- Approval buttons include confirmation dialog showing: "This will post a comment on PROJ-123. Rollback: delete comment. Risk: low."
- Add "View Evidence" button that deep-links to the relevant Slack thread/Jira issue
**Acceptance**:
- Each digest item has cost estimate, risk level, and rollback description visible before approval
- Approval button triggers confirmation dialog (not instant execution)
- Evidence links resolve to actual Slack/Jira/GitHub URLs

### Task 3.3: Role-Based Digest Views
**Files**:
- `apps/worker/src/services/digest-builder.ts` (add role routing)
- `apps/worker/src/services/digest-service.ts` (enhance delivery)
**What**:
- IC digest: max 3 items, only items in their scope (their PRs, their team's leaks)
- Lead digest: team-level summary, actionable items, team health trend
- Exec digest: cross-team summary, trend arrows, cost aggregation
- Route digests to the right Slack channel/DM based on role configuration in company settings
**Acceptance**:
- ICs receive only items relevant to their PRs/assignments
- Leads see team-level aggregation with action buttons
- Execs see cross-team trends without operational noise

---

## Wave 2: Closed-Loop Remediation (Tasks 3.4–3.5)

### Task 3.4: Action Tracking — Did the Fix Work?
**Files**:
- `apps/api/src/services/remediation.ts` (enhance)
- `apps/worker/src/services/metrics-engine.ts` (add post-action metrics check)
**What**:
- After an action is executed, schedule a follow-up check (24h, 72h, 7d)
- Compare the metric that triggered the leak before and after the action
- If metric improved: mark remediation as `effective`
- If metric unchanged/worse: flag for re-review and suggest escalation
- Store effectiveness data to improve future recommendations
**Acceptance**:
- Executed actions get follow-up effectiveness checks at 24h/72h/7d
- Dashboard shows remediation effectiveness rate
- Ineffective remediations flagged for escalation

### Task 3.5: Approvals Page — Full Lifecycle View
**File**: `src/pages/app/ApprovalsPage.tsx` (enhance)
**What**:
- Show pending approvals with full context (evidence, risk, cost, rollback)
- Show execution history with status (success/failed/rolled_back/effective/ineffective)
- Add bulk approve/dismiss for low-risk items
- Add timeline: proposed → approved → executed → effective/ineffective
**Acceptance**:
- Pending approvals show evidence + risk context
- Execution history shows full lifecycle status
- Bulk actions available for low-risk items

---

## Success Criteria
1. Daily digest delivers max 3 ranked, actionable insights per role
2. Every approval button shows what/why/risk/rollback before execution
3. Remediation effectiveness tracked and visible (closed loop)
4. Role-based routing delivers the right content to ICs, leads, and execs
5. No "just graphs" — every metric has an interpretation and suggested action

## Risks
- **Over-messaging**: Even 3 items/day may feel noisy for some teams. Mitigation: allow digest frequency configuration (daily/twice-weekly/weekly).
- **Approval fatigue**: If too many approvals queue up, people stop reviewing. Mitigation: auto-expire stale proposals after 7 days with a final "This expired" notification.
