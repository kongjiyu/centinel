# Centinel — Progress Trace

> **Purpose:** Single source of truth for where the project actually is, what's
> in flight, and what's still open against the FYP roadmap in `PROJECT_PLAN.md`.
>
> **Last refreshed:** 2026-06-25 (post-P1-5 commit batch)
> **Current branch:** `feature/review-p0-batch1`
> **Base branch:** `main` @ `d47b6d6`
> **Branches ahead of main:** 9 commits on `feature/review-p0-batch1`
>   - 4 P0-1 / P0-3 / P0-4 / Group 2c commits (already on the branch before today)
>   - 1 schema fix + P1-5 columns (commit `99bb8d7`, today)
>   - 1 P1-5 domain logic (commit `2e0b415`, today)
>   - 1 P1-5 HTTP surface (commit `693cac1`, today)
>   - 1 P1-5 frontend (commit `5f15099`, today)
> **Working tree:** clean (only this file remains to be added; the rest of the
>   previously-dirty P1-5 WIP is committed)

---

## 1. TL;DR

Phases 0–4 are **shipped**. The P0/P1 Static Review precision batch is
**complete on `feature/review-p0-batch1`** and the P1-5 re-review-on-push work
is committed atomically. What's left for the precision layer: merge both
feature branches to `main`, then triage the pre-existing test failures before
Phase 5 (hardening) and Phase 6 (FYP evaluation) can start.

| Track | Status | Where it lives |
|---|---|---|
| Desktop shell (Tauri + React) | ✅ Working | `centinel/` |
| Sidecar runtime (Node + Playwright + SQLite) | ✅ Working | `sidecar/` |
| Phase 0 — Stack spike | ✅ Done | smoke scripts in `sidecar/src/*Smoke.ts` |
| Phase 1 — App foundation + project model | ✅ Done | `centinel/src/screens/ProjectsScreen.tsx`, `sidecar/src/projects.ts` |
| Phase 2 — Static MVP | ✅ Done (functionally) | `sidecar/src/staticReview.ts`, `staticSessions.ts` |
| Phase 3 — Dynamic MVP | ✅ Done + e2e verified | `sidecar/src/dynamicRunner.ts` |
| Phase 4 — Unified reporting + Evidence Browser | ✅ Done | `centinel/src/screens/EvidenceBrowser.tsx`, `sidecar/src/reportExport.ts` |
| Static precision (P0/P1) — **committed, not merged** | ✅ Code complete | `feature/review-p0-batch1`, `feature/static-review-optimization` |
| Phase 5 — Hardening | ⏸ Blocked on merge + pre-existing test triage | — |
| Phase 6 — FYP evaluation | ⏸ Blocked on Phase 5 | — |

---

## 2. Phase Trace (Mapped to PROJECT_PLAN.md)

### Phase 0 — Stack spike ✅

- Tauri + React boots; SQLite via `sql.js` (no native compile pain); Playwright
  captures a screenshot end-to-end; MiMo + Gemini smoke tests pass.
- Evidence: `evidence/phase-0/`, `sidecar/src/{mimo,gemini,playwright,sqlite}Smoke.ts`.

### Phase 1 — App foundation ✅

- Project list, project detail, project create/delete with persistent SQLite.
- Local workspace folder convention: `evidence/phase-0/<projectId>/...`.
- Settings page for text + vision AI providers.
- Acceptance: covered by `docs/phase4-status.md` and E2E report screenshots.

### Phase 2 — Static MVP ✅ (now in precision hardening)

- Artifact upload (text/markdown + source code), auto-type detection,
  SHA-256 content hash, repository import.
- MiMo-driven review pipeline with structured-JSON output contract.
- Static sessions, findings CRUD, accept/dismiss/fixed workflow.
- Static report export (`sidecar/src/reportExport.ts` → Markdown).
- **What changed since MVP:** see §4 below — schema columns for file:line,
  verifier/noise/repro-hint trust layer, parallel stages, stage-skip, cache
  markers, diff-scope, review decisions, test plan generation.

### Phase 3 — Dynamic MVP ✅

- Playwright + Gemini/MiMo vision hybrid loop (DOM-first, screenshot fallback).
- Action set: `click | type | press_key | scroll | wait | navigate |
  assert_visible | finish_success | finish_failure`.
- Safety limits: max steps, max runtime, action retry ×2, vision retry ×3,
  failure categories.
- Evidence: screenshots/ai/action-trace/console/debug/summary — all served via
  `/evidence-file` with path validation.
- **E2E verified** end-to-end: invalid-credentials login flow achieved
  `success` status on first attempt (`docs/e2e-test-report.md`, dated 2026-06-19).

### Phase 4 — Unified reporting + Evidence Browser ✅

- Evidence browser with session sidebar, type filters, screenshot modal
  (`centinel/src/screens/EvidenceBrowser.tsx`).
- Project report combines static + dynamic; empty-state aware.
- In-app Markdown preview, file export, "Copy Path".
- See `docs/phase4-status.md` for the full breakdown.

---

## 3. What's Done Beyond the Original Plan

These were added mid-stream as the team learned what "good" looks like:

| Feature | Why it was added | Where |
|---|---|---|
| Token usage tracking (cache read/creation, hit rate) | Cost & perf visibility | `sidecar/src/tokenUsage.ts` |
| Repo index + context retrieval | Smaller prompts, better grounding | `sidecar/src/{repoIndex,contextRetrieval}.ts` |
| Auto-detect review type from artifact mix | Less friction | `sidecar/src/staticReview.ts` |
| Tool-use path (`callAiWithTools`) | When the AI needs to fetch code instead of guessing | `sidecar/src/{aiClient,tools}.ts` |
| Requirement entity + mapping | Traceability outside of one-shot review | `sidecar/src/requirements.ts` |
| Static analysis engine (`staticEngine.ts`) | Rule-based findings alongside AI findings | `sidecar/src/staticEngine.ts`, `sidecar/src/rules/` |
| Risk score | Aggregate quality signal | `sidecar/src/riskScore.ts` |
| Review toast (collapsed/expanded/complete) | Live UX during long reviews | `centinel/src/components/ReviewToast*.tsx` |
| Quality dashboard | Manager view | `centinel/src/components/CommandUI.tsx` |

---

## 4. Current Focus — Static Review Precision (P0/P1)

The P0/P1 precision layer is **complete on the branches** and waiting to be
merged. The P1-5 re-review-on-push work that was previously uncommitted has
been split into atomic commits today.

### 4.1 Already on `feature/review-p0-batch1` (9 commits ahead of main)

| Commit | Theme | Task ID |
|---|---|---|
| `061f94d` | Tighten severity contract in code-review + traceability prompts | P0-1 |
| `72c3487` | Review decisions: Approve / Request Changes / Comment at session level | P0-3 |
| `4d062c3` | Diff-scope reviews to a git base/head ref range | P0-4 |
| `016c9c9` | Test plan generation: module-grouped test items from findings | Group 2c (backend) |
| `03432d0` | TestPlanPanel UI: module-grouped items with Accept/Reject | Group 2c (frontend) |
| `99bb8d7` | **P1-5 schema: `parent_session_id` + `review_diff_json` columns + index; also fixes a latent P0-4 bug where `migrateCol` was hardcoded to `findings` and silently mis-routed the diff-scope columns** | P1-5 schema |
| `2e0b415` | **P1-5 domain logic: `carryoverFindings()` + `getSessionDiff()` + `Finding.status='carryover'`** | P1-5 logic |
| `693cac1` | **P1-5 HTTP surface: `POST /projects/:id/static-sessions` accepts `parentSessionId`, `GET .../sessions/:childId/diff/:parentId`** | P1-5 API |
| `5f15099` | **P1-5 frontend: SessionDiffView, Re-review button on completed sessions, carryover tag on findings** | P1-5 UI |

### 4.2 Trust-optimization layer on `feature/static-review-optimization` (not merged)

| Commit | Theme |
|---|---|
| `e0bae5e` | `cache_control` markers for prompt caching |
| `178e507` | Run code review + traceability in parallel; skip empty stages |
| `a1f58b9` → `79e5593` | Cheap-model verifier pass + tests (T7) |
| `63302ea` | Noise filter (`noiseFilter.ts`) + `GET /noise-rules` |
| `743cf3f` | `reproductionHint` required on AI findings (T9) |
| `8ea0a98` | Verified badge on findings |
| `0208dab` → `4ca1e57` | ReproductionHint component + copy button (T11) |
| `4352090` | Review-type header in `ReviewProgressView` |
| `51420db` | NoiseRulesPanel + `listNoiseRules`/`resetNoiseRule` API |

### 4.3 Latent bug fixed while doing P1-5

`migrateCol` in `sidecar/src/db.ts` was hardcoded to `ALTER TABLE findings`.
The P0-4 diff-scope columns (`base_ref`, `head_ref`, `changed_files_json`)
had therefore been silently going to the wrong table — only the unit tests
caught this (they use a hand-rolled schema in `testHelpers.ts` that already
includes the columns inline). The P1-5 index creation on
`static_sessions(parent_session_id)` tripped "no such column" and exposed the
drift. Fixed by adding an explicit `table` parameter to `migrateCol` and
updating all 11 callers. Retroactively fixes P0-4 as well.

### 4.4 What's next on this track

- Merge `feature/review-p0-batch1` → `main`
- Merge `feature/static-review-optimization` → `main`
- Triage the 15 pre-existing test failures (see §5)
- Then Phase 5 / Phase 6

---

## 5. Test Coverage Snapshot

- **39 test files** under `sidecar/__tests__/`.
- ~85+ tests in the static module alone (see `docs/TEST_CASES.md`).
- Trust layer adds: `severityPromptContract.test.ts`,
  `staticReviewToolPath.test.ts`, `findingLocation.test.ts`,
  `dedupFindings.test.ts`, `verifier.test.ts`,
  `noiseFilter.test.ts`, `graphIndexValidation.test.ts`,
  `qualityDashboard.test.ts`, `sessionAudit.test.ts`,
  `reviewDecisions.test.ts`, `testPlan.test.ts`,
  `riskScore.test.ts`, `requirements.test.ts`,
  `aiPrompt.test.ts`.
- **Current status:** 223 passed | 15 failed | 8 skipped (246 total).
- **The 15 failures are pre-existing** — they reproduce on the base branch
  (`03432d0`) with the P1-5 WIP stashed away. They are NOT caused by the
  P1-5 commits landed today. The P1-5 caused failure
  (`staticReview.test.ts > should process findings from AI response and save them`
  hitting `no such column: parent_session_id`) is fixed by the
  `migrateCol` refactor in commit `99bb8d7` — verified by running
  `pnpm --filter @centinel/sidecar test -- --run staticReview.test`
  (28/28 passing).
- **Pre-existing failure breakdown:**
  - `reportExport.test.ts` — 7 failures (path-arg + undefined-binding errors
    against `exportProjectReport` / `exportSessionReport`)
  - `graphIndexValidation.test.ts` — 4 failures in the A/B comparison suite
  - `qualityDashboard.test.ts` — file fails to load
  - `sessionAudit.test.ts` — file fails to load
  - `api.test.ts` — 1 failure on `POST /projects/:id/reports/export` (same
    reportExport path that fails in the unit test)
  - `staticReviewToolPath.test.ts` — 1 failure (test DB schema missing
    `static_analysis_results` table that the runtime db.ts has)
- **No frontend tests** yet beyond `SettingsScreen.test.ts`. FindingsPanel
  tests for the ReproductionHint are sketched in the v2 plan but not landed.

---

## 6. Decision Log (so we don't re-litigate)

| Decision | Why | When |
|---|---|---|
| `sql.js` over `better-sqlite3` | Avoids native compile on Node 23 / ARM | Phase 0 |
| Sidecar in Node, not Rust | Playwright + AI SDKs are JS-native | Phase 0 |
| `api-key` header for MiMo | Provider quirk vs. Anthropic spec | Phase 3 |
| `thinking: { type: 'disabled' }` for MiMo | Avoid burning tokens on internal scratchpad | Phase 3 |
| `FINDING status='carryover'` | Re-review lineage without inventing a new lifecycle | P1-5 |
| Cheap-model verifier over bigger model | Cost vs. precision — yes there's noise, fix in noise layer | T7 |
| Carryover only for `new`/`accepted` findings | Dismissed/fixed are deliberate, audit wants them where they closed | P1-5 |
| Match key for diff = `filePath:lineNumber::titlePrefix40` | Approximate is good enough; stable cross-session ID is future work | P1-5 |
| One worktree per concurrent track, merge at end | Avoid 3-way conflicts between backend / frontend / final integration | `.mavis/plans/...` |
| `migrateCol` takes explicit `table` param | Original was hardcoded to `findings`; refactor prevents silent mis-routing of column migrations to the wrong table | P1-5 schema (`99bb8d7`) |

---

## 7. Open Gaps (against the FYP success criteria)

Mapped to `PROJECT_PLAN.md` §19.

| # | Gap | Blocks FYP? | Owner | Effort |
|---|---|---|---|---|
| 1 | **15 pre-existing test failures not yet triaged** (was 11 before today — the 4 added are `graphIndexValidation` A/B cases; same root cause family as the others) | Yes (claims "85 tests pass" become false) | Whoever picks up Phase 5 entry | 0.5–1 day |
| 2 | ~~P1-5 re-review-on-push is uncommitted~~ **DONE** — atomic commits `99bb8d7` → `5f15099` | — | — | — |
| 3 | No frontend tests beyond Settings | Cosmetic | Frontend | 1–2 days |
| 4 | `feature/review-p0-batch1` not merged to main | No (but blocks §5 / Phase 5) | Whoever runs the merge | ≤1 hour |
| 5 | `feature/static-review-optimization` not merged to main | No (but blocks §5 / Phase 5) | Whoever runs the merge | ≤1 hour |
| 6 | No formal Phase 5 hardening pass (error states, cancellation UX, empty states audited) | Yes | Both owners | 1–2 weeks |
| 7 | No Phase 6 evaluation data set / demo script | Yes (this is the submission artifact) | Both owners | 2 weeks |
| 8 | `phase4-status.md` claims still claim "static evidence integration awaits Phase 2" — that gate is open now; static evidence integration should be revisited | Cosmetic | Static owner | 0.5 day |
| 9 | No automated E2E test for the static module (only for dynamic) | Yes for evaluation rigor | Both owners | 1 week |

---

## 8. Recommended Sequence to Reach FYP-Ready

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Step 0 ✅ DONE:  Commit P1-5 re-review-on-push in atomic chunks.        │
│                  All 4 P1-5 chunks landed today.                        │
│                  P1-5 caused test failure (parent_session_id index)      │
│                  fixed via the migrateCol refactor.                      │
│                  Pre-existing failures left for Step 1.                  │
├─────────────────────────────────────────────────────────────────────────┤
│ Step 1 (next):  Merge the two feature branches → main.                  │
│                 Order: feature/review-p0-batch1 first (depends on       │
│                 static-review-optimization work, but is independent in  │
│                 tree terms since the two branches diverged before       │
│                 either side landed their changes — verify by checking   │
│                 merge-base before each merge).                            │
├─────────────────────────────────────────────────────────────────────────┤
│ Step 2:          Triage the 15 pre-existing test failures.               │
│                  Either fix or quarantine with `@skip` + ADR note.      │
├─────────────────────────────────────────────────────────────────────────┤
│ Step 3 (Phase 5): Hardening pass.                                       │
│   - Static: error states for failed AI calls, empty project states,     │
│             cancelled session UX.                                        │
│   - Dynamic: ditto + URL allowlist, demo data set.                      │
│   - Shared: keyboard-only nav, reduced-motion audit, design-system     │
│             compliance scan across all screens.                         │
├─────────────────────────────────────────────────────────────────────────┤
│ Step 4 (Phase 6): Evaluation.                                           │
│   - Build static sample set (req + code pairs with known issues).       │
│   - Build dynamic sample web app (login / form / CRUD).                 │
│   - Run the demo script from PROJECT_PLAN.md §18, record results.       │
│   - Write evaluation tables (PROJECT_PLAN.md §14).                       │
│   - Write the FYP report chapters.                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 9. How To Read This Doc Over Time

- After every commit that changes scope, edit §4 (current focus) and §7 (open
  gaps). Keep them terse.
- When a phase closes, tick it in §2 and add a one-liner with the validation
  evidence.
- When a new decision is made that future-you would regret forgetting, add it
  to §6.
- When you discover something that future-self will trip over, add it to §7.

This file is intentionally **not** a task tracker (use the GitHub-style plan
yamls in `.mavis/plans/` for that). It is the **map** — the high-level view of
where we are, what we did, and what's next, with pointers into the deep docs.