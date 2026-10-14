# Browser execution, policy, exploration and regression

M4 delivery contract, 14 October 2026. Authority: DESIGN.md, revised PRD and
DEVELOPMENT_PLAN.md P4.1–P4.6. This is planned implementation and acceptance;
P4 is not completed by earlier budget/origin checks or the M3 logout run.
Static implementation and optional native-application testing remain excluded.

## Required implementation

1. Split observation, model planning, policy, execution and verification into
   focused modules with explicit contracts. Prefer DOM/accessibility observations
   and stable unique locators. Use protected screenshots where necessary; record
   the reason and coordinates when a locator cannot safely address the target.
   Include only the frozen selected objectives/context as planner data. Page/input
   text and model proposals cannot change policy or supply shell commands.
2. Extend independent checks to supported form-state outcomes as well as URL,
   text and visibility. Retain relevant console/network observations and actual
   before/after state. Missing/ambiguous observation is uncertain. A model terminal
   proposal never supplies a website verdict or replaces a required check.
3. Freeze explicit action restrictions in Run conditions. Enforce them before
   actions, including mutations and approved file operations; deny operations
   without the required configuration/consent. Keep existing origin/proxy/session
   protections for clicks, redirects, popups, downloads/uploads and streams.
   Do not promise universal read-only server behavior from an allowed origin.
4. Distinguish safe observation retries from repeating submissions or other
   potentially non-idempotent actions. After ambiguous action outcomes, re-observe
   rather than blindly resubmit. Preserve duration/step/call/observation/output
   limits and cancellation during browser, provider and backoff work. Retain
   partial observations/evidence and the matching data cleanup/recovery state.
5. Add bounded exploratory mode with selected objectives, visited state/action
   records and explicitly unvisited/unknown scope. No exhaustive-coverage claim
   follows from reaching a budget. Criterion coverage must distinguish actual
   verified partial results from unvisited or blocked criteria.
6. Add regression linkage to a pinned baseline Run/revision and environment/target
   version. New Runs preserve old observations and relevant finding lineage; a
   later pass does not erase an earlier failure or validate changed requirements.
   M5 will connect this lineage to reviewed findings/report retention.

## Acceptance gates

- Real normal and deliberately defective login/form/CRUD cases, using the pinned
  RWA where appropriate and explicitly isolated fixtures for controlled defects.
  Preserve business data and record every prepared/cleaned fixture state.
- Required failed checks defeat a misleading finish_success; provider outages,
  unreachable targets, ambiguous observations and policy blocks remain execution
  limitations rather than confirmed website defects.
- Unsafe redirects/actions/file operations are stopped in code. An ambiguous
  non-idempotent submission is not repeated automatically. Cancellation/restart
  fences further activity and leaves reproducible partial evidence and recovery.
- Exploration records actual visited states/actions and discloses unvisited scope.
  Regression before/after a seeded fix retains both Runs and their linkage.
- Appropriate behavioral/browser/SQL suites, TypeScript/build, privacy inspection
  and DESIGN.md viewports precede each bounded milestone PR and merge. Persisted
  data stays compatible and prior source/Run/evidence history remains available.
- Codex is the real provider acceptance backend for this release. API live testing
  remains explicitly user-deferred; supported API contracts stay tested locally.

## Starting evidence and remaining work

M1–M3 provide authenticated Mission/Run persistence, independent URL/text/element
checks, frozen environments/budgets/context, private sessions, guarded network
transport and criterion coverage. M4a splits DOM observation, planning and single-dispatch execution. New Mission
Runs observe DOM first and request protected pixels only with an explicit reason.
Legacy direct sessions retain their visual default. Uncertain dispatched actions
stop the Run rather than repeating a click or falling back to coordinates.
Exploratory modes, richer form observations, enforced action/file restrictions and
regression/finding lineage remain implementation work, not assumed capabilities.

## M4a retained acceptance

- 460 sidecar tests (including eight real Chromium module tests), 202 frontend
  tests, sidecar TypeScript and frontend build passed. Build retains its known
  large-chunk warning. No user-facing layout changes in this slice.
- Real QA bearer → configured Codex → pinned RWA sign-in page → independent
  URL and button visibility checks: Run `068ad40d-cd46-4e20-89e0-aa229d683757`
  passed with one DOM-only provider request. Business database SHA-256 was
  unchanged and manual cleanup was recorded. This read-only case does not prove
  form submissions, destructive policy, exploration or regression.
- Chromium exercises private-field redaction, semantic refs and unique locators,
  fill/select/check actions, exactly one dispatch after lost acknowledgement,
  ambiguous-target rejection, screenshot/coordinate bounds and cancellation.
- Unknown sensitive values discovered in DOM propagate to independent protected
  screenshots and check results; retained diagnostic records are scrubbed again.
- Explicit visual fallback is covered with provider-contract tests; live visual
  fallback and normal/defective form/CRUD gates remain required in later M4 work.
- No schema migration or historical data rewrite is introduced by M4a.
