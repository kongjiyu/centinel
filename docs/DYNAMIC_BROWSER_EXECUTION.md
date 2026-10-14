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
Historical legacy sessions retain their evidence; M4g1 disables new direct starts. Uncertain dispatched actions
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

## M4b frozen action permissions

- Saved environments configure at most 20 unique CSS controls with explicit
  click/fill/select/check grants and optional coordinates. Empty grants allow
  observation and allowed-origin navigation only. Origins never promise a
  read-only server; approved controls can affect test data. Page claims, target
  descriptions and model proposals cannot add grants.
- The executor authorizes the actual resolved DOM target before dispatch.
  Coordinates require opt-in, protected pixels and a unique granted target.
  Enter/Space submission is denied; use a granted explicit control. File inputs,
  their labels and download links are denied even with ordinary click grants.
  Unexpected chooser/download events on main pages or popups stop execution;
  downloads are not accepted for saving. Approved upload/download operations
  are not implemented by this permission editor.
- Migration `202610140006_dynamic_action_policy.sql` sanitizes grants at SQL
  boundaries and freezes database-owned policy plus observer/planner/policy/
  executor/checker versions in new Runs. Forged startup permissions are ignored,
  replay preserves original snapshots and helper RPCs remain private. The
  migration was applied/registered on Centinel Supabase after local verification.
  Existing Run histories are not rewritten or assigned invented permissions.
- Real Codex form Run `ffb274d5-b9b2-4d96-b858-2edf64d73996` filled a synthetic
  name and clicked the granted save control once; independent confirmation passed.
  Run `cdc00e35-592a-437f-aaee-76aab86560d7` clicked a granted control that
  unexpectedly triggered a download: execution stopped as blocked/not_tested,
  with one download attempt, no forbidden mutation and no automatic retry.
  Both use the isolated `sidecar/__tests__/fixtures/dynamicPolicyTarget.mjs`,
  never the RWA business database, and have recorded cleanup. Stop the owned
  fixture process after acceptance to discard its explicitly ephemeral records.
- 466 sidecar and 203 frontend tests, TypeScript and frontend build passed. All
  eleven Dynamic SQL suites and the retained-data upgrade fixture passed. Real
  profile UI checks at 1440×900, 1200×900 and 390×844 found no document overflow;
  action selectors and coordinate consent round-trip in component tests.
- Historical M3 criterion counts/results/source versions remain consistent with
  retained evidence. Historical permissions remain unavailable rather than
  inferred from today's profile. Live API-provider acceptance remains deferred.
- Rich form-state checking, detailed before/after observations, safe repeated
  interaction semantics, live visual fallback, bounded exploration, regression
  and approved file-transfer support remain explicit M4 work. This slice does
  not establish completion of P4. Legacy direct-session entry points retain their
  compatibility behavior and must be audited/fenced before release; new Mission
  Runs are the validated permission-controlled product path.

## M4c independent form state and retained observations

- Independent checks support `field_value`, `field_checked`, `field_enabled`,
  `field_valid` (native browser validity) and `selected_values`, alongside existing
  URL/text/visibility checks. A unique visible supported control is required.
  Missing, ambiguous, unavailable, private or unsupported form observations are
  uncertain. Results contain only match/mismatch, never arbitrary field values.
  Native validity does not establish server/business-rule validity.
- The editor round-trips exact values (including empty strings), explicit boolean
  expectations, order-independent selected-value lists and an empty-option flag.
  Expectations are shared configuration and must use synthetic data. Unknown
  caller fields are discarded; selectors and expectations are bounded/typed.
- DOM observer v2 includes public form state and omits private field state. Each
  executed DOM action retains a timestamped before/after observation pair.
  Element bindings/private raw values stay outside serialized observations.
  New private values rescrub this Run's bounded JSON/Markdown artifacts and
  final console output. Private type proposals (including repaired proposals) are
  identified before retention/dispatch so lost acknowledgements cannot leave
  newly typed private values in logs. Console text is withheld if complete sanitized page
  observation was unavailable. Dispatched actions stop on missing after-observation
  rather than guessing an outcome or continuing to retry.
- Migration `202610140007_dynamic_form_checks.sql` sanitizes typed checks and
  records observer/checker version 2 only for newly started Runs. Old direct
  RPC clients that omitted descriptions receive a generic description on new
  saves; old histories are not rewritten. Private helper RPCs remain revoked.
  The migration was applied and registered on Centinel Supabase.
- Real Codex normal form Run `52b49347-82f1-464b-bc7f-2f4e585b0a4c` passed
  six independent checks. Defective Run `22ac1b50-171d-45a8-8266-a6436aa747b1`
  failed the required saved-consent check after a controlled reset. Both model
  terminal proposals were finish_success: independent checks overrode the
  misleading proposal for the defective form. Each submitted once and retained
  four before/after action pairs, including actual empty → populated name state.
  These isolated `/form-state` fixtures have no RWA/production connection;
  cleanup was recorded and the owned fixture process stopped after acceptance.
- 473 sidecar tests, 206 frontend tests, TypeScript/build, all twelve Dynamic SQL
  suites and retained-data upgrade fixture passed. Form values and option editor
  checked at 1440×900, 1200×900 and 390×844 with no document overflow. Existing
  build chunk-size warning remains. Historical M3 criteria/source versions and
  absent historical permissions remain consistent with retained evidence.
- This slice does not implement general repeated-submission consent/ledger,
  network diagnostics, exploration, regression, approved file transfers,
  legacy-entry fencing or the remaining live visual/CRUD gates. Those remain
  required work; P4 and the overall Dynamic release are not yet complete.

## M4d repeat guards and network diagnostics

- Every new Mission Run has a click ledger. Each granted control is single-use
  per origin/path unless every matching selector rule explicitly approves
  `repeatable: true`. Query/hash changes and alternate locator aliases do not
  grant another activation. Reservations precede dispatch and are not refunded
  after an ambiguous result. The ledger does not promise server idempotency or
  prevent all target-side effects. Cleanup remains required before another Run.
- The environment editor exposes optional repeatable click selectors, which must
  already have click approval. Repeat consent is SQL-validated and frozen from
  the database, never startup caller/model/page data. Already-matched fill,
  select and check operations return an observation receipt without re-emitting
  events. Approved changes to a different form state remain executable.
- `finish_blocked` is an operational abstention: the agent reports unfinished
  scope and no independent website verdict is claimed. It does not bypass a
  failed website check with a pass. Existing success/failure proposals continue
  through independent verification. Actual policy blocks remain code-enforced.
- Network diagnostics retain method/resource type, sanitized URL, status,
  transport error and time to observed response/failure. Headers, cookies, bodies
  and payloads are never read. Missing request starts have no invented duration.
  The capture window and unanswered response count are recorded. A 1000-event/
  256-KiB cap discloses omissions; URLs/details are withheld if safe DOM
  observation was unavailable. Diagnostics alone do not assign a defect verdict.
- Migration `202610140008_dynamic_repeat_consent.sql` was applied/registered on
  Centinel Supabase after local verification. New Runs record planner/policy/
  executor v2; prior snapshots/replays and existing data remain unchanged.
- Real Codex Run `1b32e7b2-25a5-4607-9a92-504bc0c0ecf5` abstained as
  blocked/not_tested when a twice-activation goal exceeded single-use consent,
  without changing the counter. Run `1ad5b4f7-b363-4508-8857-801239f24c4f`
  activated the explicitly repeatable control twice and passed. Run
  `7bdcdbd4-900b-4baf-8c5a-d1a68bf2e27a` attempted once, retained POST/500
  metadata and failed its independent success criterion. The synthetic query
  value is absent from retained diagnostics; no RWA/production data is involved.
  Cleanup recorded and the owned fixture process stopped after acceptance.
- Real Chromium tests attempt actual second dispatches through aliases/query
  changes and prove one effect, explicit-repeat behavior and conflicting-rule
  denial. Already-matched form operations do not re-emit events.
- 481 sidecar tests, 207 frontend tests, TypeScript/build, all thirteen Dynamic
  SQL suites and retained-data upgrade fixture passed. Real repeat-consent editor
  checked at 1440×900, 1200×900 and 390×844 without document overflow. Known
  build chunk warning remains. Historical M3 results/source versions remain
  consistent and missing historical permissions are not invented.
- Exploration, pinned regression, approved file transfers, live visual/CRUD
  gates and legacy-entry fencing remain required. This is bounded M4d evidence,
  not completion of P4 or the overall Dynamic release.

## M4e bounded exploration

- New revisions explicitly choose guided or exploratory mode; old history remains
  unchanged. Selected objectives come from frozen acceptance checks. Exploratory
  planning receives bounded visited-state/action context and remaining observed
  controls, while existing permissions, repetition guards and budgets stay fixed.
- The journal records sampled DOM state identities, actual actions, confirmed
  interactions, uncertain targets and controls with no confirmed interaction.
  Unresolved targeting and recording truncation are disclosed. These are sampled
  state/control pairs, not a full application inventory or exhaustive coverage.
- Progress checkpoints require project membership, the initiating actor, correct
  non-null worker/token and an unexpired running lease. They cannot renew the
  lease, change frozen inputs/outcome or supply objective passes. Invalid/dangling
  scope fields and exhaustive claims are rejected. Checkpoint failure stops
  further provider/browser activity while retaining recoverable local scope.
- Completed objective outcomes derive from frozen required checks and retained
  evidence. A caller's scope pass cannot replace a retained failed observation.
  Local journal and durable results resolve consistently; cancellation, budget
  exhaustion and incomplete execution leave unverified objectives not tested.
- Migration `202610140009_dynamic_exploration.sql` was locally verified, applied
  and registered on Centinel Supabase. Follow-up migration
  `202610140010_dynamic_worker_null_fence.sql` closes inherited SQL NULL
  credential comparisons for heartbeat/finalization, preserving healthy worker
  requests and member cancellation; it was also locally verified and applied.
  Fresh exploratory Runs identify explorer
  v1. Guided and historical Runs are not retroactively labeled exploratory.
- Real Codex Run `292fd4e1-4691-41b0-8a0d-725a11a38c2c` passed the selected
  first-panel objective, recording two sampled states, one action and five
  remaining state/control pairs. Run `3aecc46d-585b-4433-ba0d-11bf19e837e0`
  stopped at its one-step budget as blocked/not_tested, retaining one actually
  observed state, one action and two remaining pairs. The asynchronous response
  did not justify inventing another sampled state. Shared/local records matched.
  Both isolated path counters were first=1, secondary=0, delete=0; cleanup recorded
  and the owned fixture stopped after acceptance. No RWA/production data changed.
- 486 sidecar tests, 210 frontend tests, TypeScript/build, all fifteen Dynamic
  SQL suites and retained-data upgrade fixture passed. Actual partial-scope UI
  checked at 1440×900, 1200×900 and 390×844 without document overflow. Existing
  chunk-size warning remains; historical M3 criteria/source metadata preserved.
- Pinned regression/finding lineage, approved file transfers, remaining live
  visual/CRUD gates, legacy-entry fencing and the later M5–M7 deliverables remain
  required. This is M4e acceptance, not completion of all P4 or the release.

## M4f pinned regression observations

- Retests explicitly reference a completed baseline with retained checks/evidence
  and use its exact immutable Mission revision. New Runs preserve baseline ID,
  original verdict/checks/evidence and recorded environment/execution metadata.
  Baseline and new evidence remain separate; old histories are not rewritten.
- Baseline/project/revision validation and idempotency checks occur at the service
  and SQL boundary. Changed baseline parameters cannot reuse a request key.
  Execution still requires fresh provider/environment/data/session preflight.
  Baseline private values/session contents are never copied to the executing user.
- Comparison uses the pinned check IDs and supported retained observations.
  Failed → passed is an observation change, never automatic finding resolution
  or proof of a causal fix. Environment/target declarations, actor, policy,
  budgets and engine metadata differences are shown. Matching configuration
  does not establish identical private state or target contents.
- Migration `202610140011_dynamic_regression.sql` was locally verified, applied
  and registered on Centinel Supabase. Current execution conditions are frozen
  independently of baseline conditions; caller-supplied baseline summaries are
  not accepted. M5 will attach this Run/check lineage to reviewed findings.
- Real Codex baseline `35d09ef0-7a1f-41a8-816f-03f9d16d1399` failed against
  the controlled broken fixture. Retest `1f0d42aa-d110-4deb-b7ca-d105a5dc773a`
  used the same revision after an explicit seeded fix and passed. Recorded target
  version/profile version changed and were disclosed. The entire old Run payload
  stayed identical; idempotent replay returned the same new Run without another
  save. Each fixture version received one actual save. Cleanup recorded and
  owned fixture stopped; no RWA/production data changed.
- 488 sidecar tests, 211 frontend tests, TypeScript/build, all sixteen Dynamic
  SQL suites and retained-data upgrade fixture passed. Actual before/after
  comparison checked at 1440×900, 1200×900 and 390×844 without overflow. Known
  build chunk warning remains. Historical M3 criteria/source metadata preserved.
- Approved file transfers, remaining visual/login/CRUD gates, legacy-entry
  fencing and M5–M7 still remain. This does not claim all P4 or release completion.

## M4g1 entry fencing and explicit visual clicks

- Project Action → Dynamic testing now opens the saved-test workspace. Authenticated
  legacy POST starts return 409 `legacy_dynamic_start_disabled`; historical list,
  detail, evidence and cancellation stay available. Real QA acceptance retained
  all 41 existing sessions, historical GET returned 200 and anonymous POST 401.
- Visual clicks use `click_visual`, current protected pixels and viewport
  coordinates. Locator-plus-coordinate proposals fail before dispatch instead of
  silently clicking a locator's centre. Existing origin, action consent, screenshot
  protection, coordinate bounds and repeat ledger still apply.
- The first canvas acceptance exposed the mixed-target bug: Run
  `39f820bb-d3a8-4682-a9f9-9c457b3e6184` safely stopped without a successful check;
  its original evidence remains. After correction, real Codex Run
  `aad1048d-07f4-445c-9252-05f58c5fc5c9` requested protected pixels, dispatched one
  explicit coordinate click, hit the internal canvas target once and passed the
  independent visible-text check. Preparation/cleanup recorded; no RWA data changed.
- Additive migration `202610140012` freezes visual protocol version 1 on fresh
  Runs, preserves replay payloads and revokes access to private starter helpers.
  Locally verified and applied/registered to Centinel Supabase.
- 489 sidecar tests, 211 frontend tests, sidecar TypeScript, frontend build,
  seventeen SQL suites and retained-data upgrade fixture passed. Project entry
  screenshots inspected at 1440×900, 1200×900 and 390×844; no horizontal overflow.
  The known build chunk warning remains.
- Approved file transfers, remaining normal/defective login/form/CRUD and crash
  gates, reviewed finding linkage and M5–M7 remain required. Real API provider
  acceptance is user-deferred; this slice does not complete P4 or the release.
