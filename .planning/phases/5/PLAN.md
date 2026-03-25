# Phase 5: Integration Hardening & Feedback Loop

## Goal
Close the feedback loop — track whether remediation actions actually improved metrics. Validate FlowGuard on real team workflows. Implement threshold calibration from real usage data.

## Why This Phase
KeepUp.txt: "FlowGuard must validate its effectiveness on real, messy team workflows rather than theoretical models." This is the validation phase that proves the product works.

---

## Wave 1: Effectiveness Measurement (Tasks 5.1–5.2)

### Task 5.1: Remediation Effectiveness Tracking
**Files**:
- `apps/worker/src/services/feedback-flywheel.ts` (enhance)
- `apps/api/src/routes/dashboard-api.ts` (add effectiveness endpoints)
**What**:
- After each remediation: compare target metric at T+24h, T+72h, T+7d
- Classify as: effective (metric improved >10%), neutral (within 10%), counterproductive (metric worsened >10%)
- Build per-action-type effectiveness rate: "Slack reminders resolve 67% of PR bottlenecks within 48h"
- Surface effectiveness data in dashboard and future digest recommendations
**Acceptance**:
- Each executed action has effectiveness classification
- Per-action-type effectiveness rate computed and stored
- Dashboard shows overall and per-type effectiveness metrics

### Task 5.2: Threshold Auto-Calibration
**Files**:
- `apps/worker/src/services/feedback-flywheel.ts` (enhance)
- `apps/worker/src/services/leak-engine.ts` (consume calibrated thresholds)
**What**:
- Weekly calibration job: analyze dismiss rate, snooze rate, and effectiveness per leak type per company
- If dismiss rate > 30%: raise detection threshold by 10%
- If effectiveness > 80%: maintain or slightly lower threshold (more is useful)
- If effectiveness < 40%: raise threshold (detections aren't leading to real improvements)
- Store calibration history for audit trail
**Acceptance**:
- Thresholds auto-adjust weekly based on real usage patterns
- Calibration history is auditable
- Test: high dismiss rate causes threshold increase within 2 calibration cycles

---

## Wave 2: Real-World Validation (Tasks 5.3–5.5)

### Task 5.3: Onboarding Flow — First 14 Days
**Files**:
- `src/pages/app/DashboardOverview.tsx` (add onboarding state)
- `apps/api/src/routes/admin.ts` (add onboarding status endpoint)
**What**:
- New company onboarding: show progress of data ingestion ("Day 3: 127 Slack events, 45 Jira events ingested. Baseline building...")
- After 14 days: show first baseline report and invite to configure thresholds
- Guide: "FlowGuard learns your team's patterns. The first 2 weeks are calibration — insights will improve over time."
**Acceptance**:
- New companies see onboarding progress instead of empty dashboard
- Day 14: first baseline report auto-generated
- Onboarding guide explains what to expect

### Task 5.4: Settings — Team Configuration
**File**: `src/pages/app/SettingsPage.tsx` (enhance)
**What**:
- Integration status: show connected/disconnected for Slack, Jira, GitHub with last-event timestamp
- Threshold configuration: allow manual override per leak type (with "Reset to auto-calibrated" option)
- Digest preferences: frequency (daily/twice-weekly/weekly), time, role mapping
- AI feature toggles: enable/disable per feature (decision capture, story drafting, estimation)
- Notification preferences: which nudge types to receive
**Acceptance**:
- Integration health visible with last-event timestamps
- Manual threshold overrides with reset-to-auto option
- All preferences persisted in company settings

### Task 5.5: Cross-Team Metrics Dashboard
**Files**:
- `src/pages/app/MetricsPage.tsx` (enhance)
- `src/pages/app/TeamsPage.tsx` (enhance)
**What**:
- Team comparison view: side-by-side cycle time, review latency, leak count
- Trend arrows: improving/stable/declining per metric per team
- Drill-down: click a team's metric → see contributing leaks, actions taken, effectiveness
- Export: CSV/JSON export for reporting to leadership
**Acceptance**:
- Team comparison view shows key metrics side-by-side
- Trend indicators (arrows/colors) for each metric
- Drill-down from metric to contributing evidence

---

## Success Criteria
1. Remediation effectiveness tracked and classified for every executed action
2. Thresholds auto-calibrate weekly from real usage — dismiss rate < 20% within 60 days
3. New company onboarding guides through 14-day calibration period
4. Settings page provides full control over thresholds, digest, and AI features
5. Cross-team metrics enable leadership visibility without FlowGuard being "just another dashboard"

## Risks
- **Insufficient data**: Small teams may not generate enough events for meaningful calibration. Mitigation: use global baseline for teams < 5 members.
- **Metric gaming**: If teams know they're being measured, they may game the metrics. Mitigation: FlowGuard measures workflow friction, not developer performance. Messaging matters.
- **Privacy**: Cross-team comparisons could be used punitively. Mitigation: exec view shows trends not individual blame, team view accessible only to team members.
