# Dynamic delivery progress

Authority: DESIGN.md → Centinel_PRD_Revised.md → DEVELOPMENT_PLAN.md.
The user authorized milestone PR creation, merge into the actual default branch
`main`, and continued delivery through all required Dynamic work on 13 October
2026. Static implementation remains out of scope; explicit mock snapshots supply
incoming criteria. Native desktop testing remains the separately scoped extension.

| Milestone | Scope | Status / next gate |
| --- | --- | --- |
| M1 | Local target/provider acceptance; Mission revisions, Run lifecycle, independent checker, worker leases and saved-test/history UI | Merged via PR #3 (`eb0f60f`), verified locally and against QA-bearer Supabase/Codex. Broader API/provider failure and shared evidence gates remain later work. |
| M2a | Reusable environment profiles, encrypted local variables, preflight and immutable Run conditions (P2.1–P2.3 slice) | Merged via PR #4 (`b46bdac`); locally/live verified. See DYNAMIC_ENVIRONMENT_PROFILES.md. |
| M2b | Manual preparation/cleanup ledger, versioned readiness and exclusive dirty-data lock | Merged via PR #5 (`9b195af`); locally/live verified. See DYNAMIC_DATA_LIFECYCLE.md. |
| M2c1 | Read-only workspace prerequisites, explicit script authorization and bounded process engine | Merged via PR #6 (`162ff3e`); locally/live verified. See DYNAMIC_WORKSPACE_EXECUTION.md. |
| M2c2 | Durable hook operations and automatic configured cleanup | Merged via PR #7 (`33206e5`); locally/live verified. See DYNAMIC_HOOK_OPERATIONS.md. |
| M2d1 | Network-origin enforcement and protected observations | Merged via PR #8 (`5e0576e`); locally/live verified. See DYNAMIC_SESSION_PROTECTION.md. |
| M2d2a | Device-local sessions, manual capture, lease fencing, preflight and authenticated execution | Merged via PR #9 (`bf316c6`); locally/live verified. See DYNAMIC_SESSION_PROTECTION.md. |
| M2d2b1 | Shared target-data resource keys and durable ownership | Merged via PR #10 (`cc788eb`); SQL, Codex, hook recovery and three viewports passed. See DYNAMIC_RESOURCE_BUDGETS.md. |
| M2d2b2 | Frozen execution budgets and generic worker liveness | Merged via PR #11 (`cecb7a1`); frozen budgets, worker liveness, stream fencing and live cancellation/cleanup passed. See DYNAMIC_RESOURCE_BUDGETS.md. |
| M3 | Mock snapshot selection, exceptional inputs and immutable coverage (P3) | Merged via PR #12 (`b59b96e`); all six inputs, explicit exclusions, frozen coverage, real Codex logout and three viewports passed. See DYNAMIC_CONTEXT_COVERAGE.md. |
| M4 | Enforced browser policy, richer observations/checks, exploration, regression and budgets (P4; remaining P1 execution gates) | In progress; M4a–M4g3 merged in PRs #13–#21. M4h1 private value references and real normal/negative/defective RWA login verified in PR #22; M4h2 normal CRUD and a seeded persistence defect merged in PR #23 (`04dfdf9`). M4h3 controlled active cancellation, browser crash and worker kill/restart merged in PR #24 (`961ecd5`); Finding lineage now verified in M5a; broader corpus and release acceptance remain M7; see DYNAMIC_BROWSER_EXECUTION.md, DYNAMIC_BROWSER_CREDENTIALS.md and DYNAMIC_RWA_CRUD_ACCEPTANCE.md and DYNAMIC_BROWSER_RECOVERY_ACCEPTANCE.md. |
| M5 | Usability, reviewed findings, private shared evidence and versioned reports (P5; remaining P1 storage gates) | In progress; M5a functional candidates, attributable decisions and pinned remediation merged in PR #25 (`0ac5f93`). M5b1 independent evidence copies, retention and two-user reading/revocation merged in PR #26 (`9dcdb01`). M5b2 stopped-run diagnostic/captured-file sharing merged in PR #27 (`2f26177`). M5c1 bounded usability engine merged in PR #28 (`8ab59fb`); M5c2 immutable configuration merged in PR #29 (`9333a3e`). M5c3 real rule assessment, budget accounting, private proof and authoring/results UI locally/live verified. Subjective suggestions, usability finding review, stopped assessment diagnostics and reports remain required; see DYNAMIC_REVIEWED_FINDINGS.md, DYNAMIC_PRIVATE_EVIDENCE.md and DYNAMIC_SHARED_ARTIFACTS.md and DYNAMIC_USABILITY.md. |
| M6 | Separate bounded Vitest workspace runner and unit-run history/report integration (P6) | Planned |
| M7 | Repeated corpus evaluation, two-user isolation, packaged acceptance and release guide (P7; remaining P0 acceptance) | Planned |

A merged milestone is not proof that an entire phase passed. Retain exact checks,
live evidence and remaining gates in the linked implementation records. The first
milestone includes previously authorized foundation work; no Static product logic
is introduced. Each subsequent milestone must include relevant behavioral tests,
TypeScript/build checks and DESIGN.md viewport checks for UI changes, plus live
acceptance when configured services support it.

## M1 retained validation

- Sidecar: 363 tests; frontend: 179 tests; sidecar TypeScript and frontend build.
- Independent pass/fail baseline on pinned Cypress Real World App; explicit mock
  context fixtures and lifecycle/RLS/concurrency SQL checks.
- Both additive Dynamic migrations locally verified and separately approved/applied
  to existing Centinel Supabase; no data reset or runtime service-role key.
- Real QA bearer → Codex → Playwright → independent URL/text checks → durable Run.
- Live worker heartbeat, natural lease expiry, interruption, fenced completion,
  idempotent replay and healthy preservation across a sidecar restart.
- Saved-test UI start, history and authenticated local screenshots; 1440×900,
  1200×900 and 390×844 layout checks.
- Build retains its large-chunk warning; active browser crashes, API journeys,
  second-device private evidence and packaged launch remain explicit later gates.

See DYNAMIC_MISSION_RUN_FOUNDATION.md, LOCAL_RUNTIME_SETUP.md and DYNAMIC_TEST_TARGET.md.

## Current release acceptance decision

On 13 October 2026 the user chose real Codex acceptance for this release. The API
provider path remains supported and covered by local contract tests; real API
provider acceptance is deferred until a key is configured through Settings. It is
not counted as a passed live gate and does not block this agreed release scope.
