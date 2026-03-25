# Phase 0 - Post-Refactor Verification Test Results

**Date**: 2026-03-26
**Tester**: Application Tester (QA Agent)

---

## 1. Dependency Installation

| Step | Result |
|------|--------|
| `npm install` (root workspace) | PASS - 810 packages audited, all workspaces resolved |

No workspace resolution issues. All `@flowguard/*` packages resolved correctly via npm workspaces.

---

## 2. TypeScript Compilation - Shared Packages

| Package | Result |
|---------|--------|
| `@flowguard/shared` | PASS |
| `@flowguard/adapter-sdk` | PASS |
| `@flowguard/event-bus` | PASS |
| `@flowguard/db` | PASS |

---

## 3. TypeScript Compilation - Publishers

| Package | Result |
|---------|--------|
| `@flowguard/publisher-slack` | PASS |
| `@flowguard/publisher-jira` | PASS |
| `@flowguard/publisher-github` | PASS |

---

## 4. TypeScript Compilation - Consumers

| Package | Result | Notes |
|---------|--------|-------|
| `@flowguard/consumer-data-processor` | PASS | |
| `@flowguard/consumer-digest` | FAIL -> FIXED | See Issue #1 below |
| `@flowguard/consumer-ledger` | PASS | |
| `@flowguard/consumer-ai-engine` | PASS | |
| `@flowguard/consumer-executor` | PASS | |

---

## 5. TypeScript Compilation - Gateway

| Package | Result | Notes |
|---------|--------|-------|
| `@flowguard/gateway` | FAIL -> FIXED | See Issue #2 below |

---

## 6. Frontend

| Check | Result | Notes |
|-------|--------|-------|
| `vite build` | PASS | Built in ~3s. 1 warning about chunk size (>500 kB) - cosmetic, not blocking. |
| `vitest run` (12 tests, 3 files) | PASS | All 12 tests passed in 1.36s |
| Dev server startup | PASS | Vite ready in 143ms |

---

## Issues Found and Fixed

### Issue #1: digest consumer - snake_case to camelCase mismatch in morning-pulse.ts

**File**: `backend/consumers/digest/src/services/morning-pulse.ts`

**Error**:
```
src/services/morning-pulse.ts(143,5): error TS2322: Type '{ entity_id: string; days: number; }[]'
  is not assignable to type '{ entityId: string; days: number; }[]'.
src/services/morning-pulse.ts(144,5): error TS2322: Type '{ rule_key: string; severity: number; title: string; }[]'
  is not assignable to type '{ ruleKey: string; severity: number; title: string; }[]'.
```

**Root Cause**: SQL queries return columns in `snake_case` (`entity_id`, `rule_key`) but the `PulseData` interface expects `camelCase` (`entityId`, `ruleKey`). The `gatherTeamPulseData` function was returning the raw SQL rows directly without mapping them to the expected interface shape.

**Fix**: Added `.map()` calls to transform the SQL result rows from snake_case to camelCase before returning:
- `openPRsResult.rows.map(pr => ({ entityId: pr.entity_id, days: pr.days }))`
- `activeLeaksResult.rows.map(leak => ({ ruleKey: leak.rule_key, severity: leak.severity, title: leak.title }))`

---

### Issue #2: gateway - missing `dotenv` dependency

**File**: `backend/gateway/package.json`

**Error**:
```
src/config.ts(2,20): error TS2307: Cannot find module 'dotenv' or its corresponding type declarations.
```

**Root Cause**: `backend/gateway/src/config.ts` imports `dotenv` but the package was not listed in the gateway's `package.json` dependencies.

**Fix**: Added `"dotenv": "^16.4.7"` to the `dependencies` section of `backend/gateway/package.json`.

---

## Summary

| Category | Total Checks | Passed | Fixed | Still Failing |
|----------|-------------|--------|-------|---------------|
| Shared Packages | 4 | 4 | 0 | 0 |
| Publishers | 3 | 3 | 0 | 0 |
| Consumers | 5 | 4 | 1 | 0 |
| Gateway | 1 | 0 | 1 | 0 |
| Frontend Build | 1 | 1 | 0 | 0 |
| Frontend Tests | 1 | 1 | 0 | 0 |
| Frontend Dev Server | 1 | 1 | 0 | 0 |
| **Total** | **16** | **14** | **2** | **0** |

All 16 checks now pass after the 2 fixes described above.
