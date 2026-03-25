# Phase 2: Memory Ledger UX — "One-Click Context Translation"

## Goal
Make the truth ledger accessible and actively reused — not "write-only." Implement one-click capture from Slack threads to ledger commits with deep-link writeback, so decisions are preserved where they happen.

## Why This Phase
KeepUp.txt identifies the biggest risk: "The biggest risk to this feature is that teams capture decisions but never look at them again." The current LedgerService has full CRUD + state machine + auto-edges, but the UX path from "Slack discussion" to "captured decision" requires too many steps. This phase makes capture frictionless and retrieval natural.

---

## Wave 1: One-Click Capture Flow (Tasks 2.1–2.3)

### Task 2.1: Slack Shortcut — "Capture Decision" Action
**Files**:
- `apps/api/src/routes/webhooks/slack.ts` (add interactivity handler)
- `apps/api/src/services/ledger.ts` (add `createFromSlackThread()`)
**What**:
- Register a Slack message shortcut ("Capture Decision") that opens a modal
- Modal pre-fills: thread summary (from AI), participants, channel context
- On submit: creates a `draft` ledger commit with evidence_links pointing to the Slack thread
- Auto-creates `entity_links` between the Slack thread and the new commit
- Posts confirmation reply in the original thread with a link to the ledger entry
**Acceptance**:
- User right-clicks a Slack message → "Capture Decision" → modal opens pre-filled
- Submit creates ledger commit + entity_link + thread reply confirmation
- Test: Slack interactivity payload creates correct ledger commit

### Task 2.2: AI Pre-fill — Thread Summarization
**Files**:
- `apps/worker/src/services/decision-capture.ts` (enhance)
- `apps/api/src/services/inference-engine.ts` (add `summarizeThread()`)
**What**:
- When capture modal opens, call AI to summarize the thread: title, summary, key decision, action items, DRI
- Use the existing AI orchestrator (OpenAI/Anthropic dual-provider)
- Fallback: if AI unavailable, leave fields blank for manual entry
- Cache summaries for 1 hour to avoid redundant API calls
**Acceptance**:
- Modal opens with AI-generated title and summary pre-filled
- AI failure gracefully falls back to empty fields
- Summary quality: includes decision outcome, not just topic

### Task 2.3: Ledger Page — Enhanced UX for Retrieval
**Files**:
- `src/pages/app/LedgerPage.tsx` (enhance)
- `src/components/git-ledger/GitLedgerTree.tsx` (enhance)
**What**:
- Add search/filter: by commit_type, status, tags, DRI, date range
- Add "Why was this decided?" context panel: shows linked evidence (Slack threads, Jira issues, metrics at time of decision)
- Add timeline view: chronological decision history with branch visualization
- Add onboarding prompt: "New team member? Start here to understand past decisions"
**Acceptance**:
- Ledger entries searchable by type, DRI, tags, and date range
- Clicking a ledger entry shows linked evidence in context panel
- Timeline view renders decision branches visually

---

## Wave 2: Writeback & Cross-Reference (Tasks 2.4–2.5)

### Task 2.4: Bi-directional Writeback
**Files**:
- `apps/api/src/services/executor.ts` (enhance `triggerLedgerWriteback`)
- `apps/api/src/services/jira-writeback.ts` (enhance)
**What**:
- When a ledger commit is approved/merged, post a formatted summary back to:
  - The originating Slack thread (already partially implemented)
  - The linked Jira issue as a comment with ADF formatting
  - The linked GitHub PR as a comment
- Include deep-link back to the ledger entry in the dashboard
- Track writeback status per evidence link (success/failed/pending)
**Acceptance**:
- Approved ledger commit triggers writeback to all linked platforms
- Each writeback includes a deep-link to the ledger entry
- Failed writebacks are retried once, then logged as failed

### Task 2.5: Ledger Diff & Branching UX
**Files**:
- `src/pages/app/LedgerPage.tsx` (add diff view)
- `apps/api/src/routes/ledger-routes.ts` (add diff endpoint)
**What**:
- Add `GET /api/ledger/:id/diff` — shows what changed between parent and current commit
- Add branching visualization: when a decision supersedes another, show the chain
- Add "Propose Amendment" flow: creates a new commit with `parent_commit_id` pointing to the original
**Acceptance**:
- Diff view shows summary/rationale changes between commits
- Supersedes chain rendered as a visual timeline
- "Propose Amendment" creates correctly parented commit

---

## Success Criteria
1. Users can capture a decision from Slack in 2 clicks (shortcut → submit modal)
2. AI pre-fills decision title, summary, and DRI from thread context
3. Approved decisions write back to originating Slack/Jira/GitHub threads
4. Ledger is searchable and browsable with evidence context — not write-only
5. New team members can use the ledger as an onboarding reference

## Risks
- **Slack App permissions**: Message shortcuts require `commands` and `interactivity` scopes. May need OAuth re-consent from existing installs.
- **AI summary quality**: Thread summarization may miss nuance. Mitigation: always show AI output as pre-fill (editable), never auto-commit.
- **Write-only trap**: Even with better UX, teams may not revisit. Mitigation: Phase 3 digest includes "Decisions made this week" section.
