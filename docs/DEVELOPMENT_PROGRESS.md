# Dynamic delivery progress

Authority: DESIGN.md → Centinel_PRD_Revised.md → DEVELOPMENT_PLAN.md.
The user authorized milestone PR creation, merge into the actual default branch
`main`, and continued delivery through all required Dynamic work on 13 October
2026. Static implementation remains out of scope; explicit mock snapshots supply
incoming criteria. Native desktop testing remains the separately scoped extension.

| Milestone | Scope | Status / next gate |
| --- | --- | --- |
| M1 | Local target/provider acceptance; Mission revisions, Run lifecycle, independent checker, worker leases and saved-test/history UI | Verified locally and against QA-bearer Supabase/Codex; preparing PR. Broader API/provider failure and shared evidence gates remain later work. |
| M2 | Environment profiles, variables, preflight, preparation/cleanup, safe reuse and secret handling (P2) | Next |
| M3 | Mock snapshot selection, exceptional inputs and immutable coverage (P3) | Planned |
| M4 | Enforced browser policy, richer observations/checks, exploration, regression and budgets (P4; remaining P1 execution gates) | Planned |
| M5 | Usability, reviewed findings, private shared evidence and versioned reports (P5; remaining P1 storage gates) | Planned |
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
