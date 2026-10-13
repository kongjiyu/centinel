# Manual preparation and cleanup lifecycle

M2b manual-data slice, 13 October 2026. Static implementation is excluded.

An environment has one project-member-scoped data state: unprepared, ready,
in_use or cleanup_required. Manual preparation records its initial-state note,
actor, timestamp and exact profile version. A ready environment-backed Run
atomically acquires the environment's data lock in the same transaction as Run
creation, and freezes the preparation record with its environment snapshot.
No preparation/cleanup command is run in this slice.

After a Run stops, its data state requires cleanup. Completed, failed, cancelled
and interrupted execution all retain this restriction. A failed cleanup adds an
attributable event and keeps the lock; a successful cleanup returns the environment
to unprepared. Preparation must be recorded again before execution. Dirty locks
never expire silently. Profile edits invalidate readiness for earlier versions.
Functional verdicts and immutable Run conditions are not changed by cleanup.
Read-only preflight failures create blocked Runs without acquiring a clean-data
lock; they do not falsely report data mutations or defects.

The notes/outcomes record a human or explicitly identified external acceptance
script's declaration. They are not proof that Centinel executed or independently
verified preparation. The UI discloses this limitation. Do not record credential
values in shared notes; known account-local values are rejected before persistence.
An environment-scoped lock does not discover that two different profiles use the
same external database/account. Declare one shared environment for a shared data
baseline until resource-key/unique-data controls are introduced.

## Interfaces

- GET `/projects/:projectId/dynamic/environments/:id/data` reconciles terminal Run
  ownership into cleanup_required and returns current state plus immutable events.
- POST `.../:id/preparation` and `.../:id/cleanup` accept `outcome` (completed/failed)
  and a bounded, nonempty `note`. Project membership precedes reads or mutations.
- Run creation and preparation version checks are atomic guarded RPCs. A stale
  profile or dirty lock conflict rolls back the new Run. Replays return the old Run.

Migration `202610130004_dynamic_data_lifecycle.sql` adds RLS data-state/event tables
and guarded RPCs, preserving existing tables/data. It was applied transactionally
under continuous milestone authorization after repeated isolated SQL verification.
The test bootstrap is disposable-only. Legacy Runs without environment selection
remain compatible and have no claim of a documented/shared preparation baseline.

## Verification

SQL checks cover initial state, preparation snapshot, active and dirty locks,
failed cleanup, explicit successful cleanup, unchanged Run outcome, old-profile
invalidation and nonmember state/event denial. Existing environment snapshot/replay
SQL acceptance remains passing after replacing the start RPC.

Full local suites passed: 372 sidecar and 183 frontend tests, plus sidecar
TypeScript and frontend production build (existing large-chunk warning).
Focused tests cover dirty/outdated preflight and failure recording in the UI.
Live UI acceptance passed: preparation → real Codex/independent passed Run →
seeded cleanup failure → blocked dirty reuse → cleanup confirmation → preparation.
A second real Codex Run from an equivalent recorded read-only sign-in baseline
also passed. Cleanup failure events persisted and the first verdict stayed passed.
Acceptance scripts explicitly labelled their work; no target database reset or
mutation was claimed. Final state is unprepared after explicit cleanup. Evidence:
`/Users/kongjy/Documents/School/FYP/centinel-test-targets/evidence/live-data-lifecycle-20261013.json`.
UI was inspected at 1440×900, 1200×900 and 390×844 without document overflow.

Remaining P2 work: authorized target-workspace/template inspection, explicit
bounded setup/cleanup hooks, unique resource identifiers, browser credential
references, environment budgets and actual provider-bound screenshot/log redaction.
