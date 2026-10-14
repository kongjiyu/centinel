# Shared data resources and frozen Run budgets

M2d2b delivery contract, 14 October 2026. Authority: DESIGN.md, revised PRD and
DEVELOPMENT_PLAN.md P2.1/P2.3/P2.5/P2.6 plus remaining P1 lifecycle gates. This is
a split delivery: resource ownership (M2d2b1) is implemented and verified below;
frozen budgets and generic worker liveness (M2d2b2) remain planned. Static remains
excluded.

## Data ownership

A profile may declare a bounded data-resource key. Profiles in the same shared
project that use the same target dataset use the same key. An absent key preserves
profile-scoped ownership; this must not silently widen existing access or couple
unrelated projects. A preparation/Run/hook/sign-in capture must reserve the resource
atomically through the existing project advisory lock. A different profile cannot
prepare, capture authentication, run or clean someone else's reserved resource.

Reservation persists through ready data, execution, cancellation, interruption and
cleanup failure. It has no expiry that declares data clean. Successful verified
cleanup releases it; profile edits preserve the original reservation and cannot
move a dirty resource to a new key. Freeze the key into data preparation and Run
snapshots. Existing ready/dirty data acquires equivalent additive reservations
without reset, deletion or reinterpretation as clean. Clearly identify the owning
environment and required recovery in preflight/UI.

All lifecycle RPC changes must preserve M2d2a's capture guards. The current public
start_dynamic_run/start_dynamic_hook/record_dynamic_environment_data/save_dynamic_environment
functions wrap private implementations; changing a public wrapper or re-granting
its private implementation must not expose a guard bypass. Capture/Run/hook/data
transactions and historical snapshots need regression tests on the extended schema.

## Budget and liveness boundaries

Profile limits must be sanitized and frozen per Run: duration, steps, model calls,
optional accounted tokens, observation size and console/output size. Mission limits
remain a separate requested bound; execution uses the stricter effective limit.
Existing profiles retain documented compatible defaults. UI shows actual limits
and actionable blocked/uncertain reasons, never invented cost/usage metrics.

Enforce limits before the next action/provider call or persistence growth. Count
unsuccessful attempts and repairs as calls. Unknown provider token accounting is
explicitly unavailable and cannot be treated as zero or a proven hard cost bound.
Budget expiry aborts active provider/browser work, preserves bounded partial evidence
and attempts only matching configured cleanup; it is not a website finding.

Generic Run workers also need monotonic initiation-based heartbeat freshness,
independent local execution deadlines and proxy canForward gating for existing
HTTP/TLS/WebSocket streams. The capture broker already demonstrates this boundary.
A late heartbeat response must not extend local freshness after the database lease
may have expired. Preserve healthy workers and fence stale completion after restart.

## Concrete acceptance

- Two profiles share a declared resource. Prepare A, reject B's preparation/capture/
  Run while A owns it, retain the block after A's cleanup failure, then clean A and
  accept B. Editing A's key/version cannot release or relocate dirty state.
- A peer member sees ownership/recovery metadata; a nonmember cannot read or mutate
  the resource. Private worker/capture nonce columns remain unreadable and internal
  RPC implementations remain inaccessible to authenticated direct callers.
- Freeze limits/key in a Run, edit the profile and verify old conditions/history
  remain unchanged. A missing prerequisite remains a blocked preflight.
- Actual browser/provider cancellation at duration/call/step/console limits retains
  bounded partial artifacts and truthful verdicts. Known secrets are absent after
  truncation. An expired/failed worker cannot forward network traffic or finalize.
- Repeat the pinned target workflow from an equivalent initial state; record the
  exact local/Codex/SQL/UI evidence. API live acceptance remains user-deferred.
- Build, appropriate suites and three DESIGN.md viewports precede PR creation and
  merge. Successful implementation does not declare P3–P7 completed.

## M2d2b1 retained acceptance, 14 October 2026

- Optional `dataResourceKey` is normalized and project-scoped. Absent keys retain
  profile-scoped behavior. Reservation metadata identifies the current owner; a
  reserved target cannot bypass ownership through a fresh URL-only Run.
- Preparation (manual and approved script) and Run snapshots freeze the actual
  resource key. Cleanup success releases ownership; failure, cancellation or
  interrupted execution retains it. A ready baseline may be withdrawn without
  creating a Run, after explicit cleanup verification.
- Migration `202610140003` applied and registered on Centinel Supabase. Local
  upgrade fixture preserved existing ready/dirty states, preparation, event and Run
  history. All eight transactional SQL suites passed; added coverage also confirms
  old hook completion cannot release a later reservation.
- 412 sidecar and 193 frontend tests passed; sidecar TypeScript and frontend build
  passed. Build retains the pre-existing large-chunk warning. No GitHub CI workflow
  runs are asserted by these local results.
- Real QA bearer → approved isolated pnpm setup → Codex → Playwright → independent
  Sign in check completed twice. Final Run:
  `80ee94ea-8a37-4c64-a42c-a243a2cd0546`, completed/passed with frozen resource key.
  A's reserved baseline rejected B preparation/setup and A key relocation. Failed
  cleanup retained the marker and excluded B; successful cleanup removed it and
  allowed B setup. RWA database SHA-256 stayed unchanged.
- Real logged-in frontend showed B as owner while A's preparation was disabled;
  verified 1440×900, 1200×900 and 390×844 with no document overflow. After manually
  executing the approved fixture cleanup and checking marker removal, **Release
  prepared data** released B and made A available. Local screenshots and JSON
  acceptance metadata are retained in ignored `output/playwright/`.
- Budgets, generic Run lease freshness, P3–P7 and cross-user acceptance remain
  outstanding. API live acceptance is explicitly user-deferred for this release.
