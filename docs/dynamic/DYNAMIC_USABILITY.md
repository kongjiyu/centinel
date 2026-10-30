# Dynamic usability delivery

Authority: DESIGN.md → Centinel_PRD_Revised.md → DEVELOPMENT_PLAN.md P5.

## M5c1: bounded browser rule engine

This slice adds an internal Playwright assessment engine and strict configuration
validator. M5c1 merged through PR #28 (`8ab59fb`). Subsequent delivery slices are recorded
below; outstanding requirements remain listed in the final section.

The explicit personas are first-time, keyboard-only and returning task-focused
visitors. They describe simulated task perspectives, not demographic claims or
real-user research. Supported rules are labels, keyboard reachability, observable
focus styling, feedback and error recovery. Feedback requires existing visible
text/element checks; recovery requires explicit existing check references. A passed
final task does not establish that an error scenario was exercised.

The engine samples up to 40 visible main-document controls, bounds candidate
inspection at 2,000 elements and traverses at most 42 Tab presses. It never clicks,
types into controls or submits forms. Cancellation and worker fencing are checked
before each keyboard dispatch. Initial focus is restored when the worker remains
active. Keyboard events can still trigger application focus handlers, so this
assessment belongs inside the same authorized test-data lifecycle as browser work.

Control references bind to original DOM identities. Reordering does not reassign
results to another element; removed, unreached originals are uncertain. An enabled
control with no configured label source fails the label rule. Keyboard reachability
failure refers to the declared bounded traversal. An observed outline/shadow is a
styling observation; absent styling is uncertain because other focus mechanisms
exist. This is not a full accessible-name computation, contrast assessment or WCAG
conformance check. Frames and shadow roots are outside the initial sampling scope.

Results retain rule, persona, verdict, expected/observed behavior and caller-provided
evidence references. The engine itself does not capture or authenticate evidence:
Run integration must bind these references to retained assessment proof. Raw control
names and field values are excluded; configured check reasons are redacted against
known sensitive values.

## Validation

Eight real Chromium tests cover configuration rejection, missing labels,
keyboard-excluded controls, no form activation, DOM reordering/removal, explicit
feedback/recovery results, oversized surfaces and cancellation/fencing. Sidecar
TypeScript and the complete sidecar suite passed: 76 files / 546 tests. No
frontend or schema change is included in this slice.

## M5c2: frozen optional configuration

Mission inputs accept an optional `usability` configuration. Explicit null,
unsupported personas/rules/fields, duplicate rules/references and unknown checks
are rejected by both the sidecar and direct authenticated database RPCs. Feedback
requires selected visible text/element checks; error recovery requires explicit
selected checks. Omitting configuration preserves historical payload compatibility.

The immutable revision retains the configuration. Fresh Runs record usability
protocol version 1; this means configured rules, not an assessment pass. Duplicate
starts return the original Run unchanged, later Mission edits do not replace its
configuration, and regression uses its baseline revision. No UI enablement or
assessment dispatch is included in this contract slice.

Migration `202610150002_dynamic_usability_configuration.sql` adds validation and
wrappers around existing authenticated revision/start functions. Private helpers
cannot be invoked by application roles. No table reset, historical rewrite or
runtime service-role access is introduced. Applied and registered in Centinel
Supabase after local verification.

Validation: sidecar TypeScript and 77 files / 548 tests passed. All 25 SQL suites
passed on the retained upgrade fixture. The broader run exposed an outdated local
finding collector; refreshing only that fixture from the canonical existing
`202610140017` migration restored its null-proof guards. A read-only check confirmed
the live collector already had the correct guard; no production finding change was
needed.

Live QA-bearer acceptance Run `435f3825-234f-4b52-a030-c11bbfaa371c` retained
revision `14100027-09d2-4682-8ced-d5da4384796a` while the Mission advanced to
`b6d27312-27bf-404d-9585-dcde034d79ef`. Duplicate request replay was unchanged,
an invalid direct-RPC reference rolled back without advancing the revision, and
the separate Reader account read the frozen configuration. The configuration-only
Run was cancelled with `not_tested`: no browser or model request was dispatched.
This is configuration acceptance, not live usability acceptance.

## M5c3: real Run assessment, private proof and UI

Selected rule assessments now execute before terminal Run persistence. They retain
`usability.json` with its SHA-256 as a fixed evidence slot, plus separate structured
Run observations. The finalizer requires the frozen configuration, each selected
rule, bounded observations, known proof references and the live execution lease.
Failed rule observations remain separate from the functional acceptance verdict.
Cancellation/fencing prevents a terminal assessment write; a Run without retained
assessment displays Not tested. Stopped local partial assessment sharing remains
outside this slice; no completed record is fabricated from it.

Tab dispatch and focus restoration reserve steps from the same Run budget as the
browser executor. Reaching the action limit stops sampling and records unvisited
controls as uncertain. It does not mark them failed or claim complete keyboard
coverage. The fixed task perspective is included in the existing bounded planner
prompt; it does not authorize additional actions or replace the declared task.

The editor defaults usability off, provides the three fixed perspectives and five
rules, and requires explicit feedback/recovery check references. Removed/changed
references are visible and can be cleared. Results expose recorded counts,
expected/observed rule behavior, proof references and limitations. M5c4 below adds optional subjective suggestions. M5c5 below adds usability finding decisions and pinned remediation.

Private evidence transport supports a fourth fixed slot alongside screenshot,
checks and an optional file manifest. Sharing uses the same checksum, membership,
transfer lease and seven-day retention contract. No public link or runtime admin
key is added. Migration `202610150003_dynamic_usability_results.sql` was locally
verified, applied and registered on Centinel Supabase.

### Live Codex acceptance (15 October 2026 local time)

| Case | Run | Observed result |
| --- | --- | --- |
| Public normal fixture | `20207b47-28ba-491b-bedb-f8ce8e9da5bf` | Functional pass, zero rule failures; four Tab actions; five total budgeted steps and one model call. |
| Public seeded label/Tab exclusion | `22eb29ca-7caa-4a01-b7b5-8101c643eebf` | Functional pass and two independent rule failures; four Tab actions; five steps and one model call. |
| Explicit error then retry | `7b9e366b-9d52-4752-b9f3-3cf9ed24787b` | Error page retained in intermediate observations; exactly two approved clicks then Recovered; feedback/recovery criteria passed; three steps/model calls. |
| Pinned RWA sign-in surface | `2c741e9c-e387-4d57-a9cf-a9ce439701e2` | Functional pass; one label-source observation failed and seven Tab actions reached the eight-step limit; incomplete keyboard sampling explicitly recorded. This is not a confirmed RWA defect. |

All four proof copies were downloaded by the separate Reader account and verified
against their hashes and structured Run observations. Original Run JSON and the
primary RWA database checksum were preserved. Preparation/cleanup outcomes were
recorded. The primary repository HEAD and isolated baseline marker were checked
against `9dfcb9869533ce8a8963c556facc0d80457f9d39`.

The Reader authored revision `449b6bef-943e-44bf-94a5-3099613c9e8d` through the
actual UI with an explicit feedback reference, then inspected the seeded rule
failure and shared JSON proof. Screenshots were inspected at 1440×900, 1200×900 and
390×844. Narrow results use a focusable horizontal table with readable verdicts;
checkbox touch areas are larger on narrow screens. CSS is confined to usability
sections. No unrelated screen styles changed.

Validation: sidecar TypeScript and 553 sidecar tests; frontend build and 238
frontend tests; all 26 SQL suites and retained upgrade-data checks. The existing
Vite chunk-size warning remains. A Settings test race was corrected to wait for
Codex status to enable its button, rather than merely waiting for the button to
exist; no Settings behavior changed.

Reproduction uses the checked-in public fixture and live harness:

```sh
pnpm --filter @centinel/sidecar exec tsx src/dynamic/testing/usabilityTarget.ts
# In a second terminal, load the ignored root .env and explicitly configure:
# CENTINEL_RWA_QA_PROJECT, CENTINEL_RWA_PRIMARY_DATABASE,
# CENTINEL_RWA_EVALUATION_ROOT and optional CENTINEL_RWA_SIDECAR_URL.
# QA/Reader account values remain in the ignored .env, never in this document.
node --env-file=.env sidecar/node_modules/tsx/dist/cli.mjs \
  sidecar/__tests__/acceptance/usabilityLive.ts
```

The public fixture is synthetic acceptance data and complements the pinned RWA;
it does not replace the required broader release corpus. Live JSON/screenshots
remain in ignored `output/playwright/`. API-provider live acceptance remains
explicitly deferred per the user's release decision.

## M5c4: optional subjective suggestions

The editor now offers an explicit **Include subjective model suggestions** option,
which defaults off. Selecting it freezes `includeSuggestions: true` in a new
revision. Only fresh selected Runs record usability protocol version 2; old
revisions, version-1 Runs and duplicate requests retain their original snapshots.

After deterministic assessment, one advisory request uses the configured provider
through the same model-call/token/runtime lease accounting as the browser planner.
It prepares up to 20 rule observations within a 10,000-character JSON sample and
bounded limitation excerpts. Failures/unassessed observations are prioritized;
omitted observation counts remain explicit. The advisory prompt/proof omits raw field values, provider credentials,
endpoints and raw model reasoning. The request does not attach a screenshot. All observation text remains untrusted data.

The model may return at most five qualified improvement suggestions. Each must
cite supplied original observation indexes from the same selected rule; the server
binds their complete proof-reference union. Unsupported fields, triage values,
invented indexes/proof and malformed output are rejected. Suggestions are labeled
subjective and do not change deterministic checks, functional verdicts, severity,
confirmation or remediation. Empty valid replies remain distinguishable from
unavailable suggestions.

Budget, provider and malformed-response failures are retained as explicit advisory
unavailability, without retries or invented items. Cancellation/fencing aborts
terminal persistence. Deterministic local JSON is written before the advisory
request; sharing that stopped partial assessment remains a separate required gate.
A scripted path that did not execute an advisory request records `not_executed`
with null model provenance. The UI describes observations as **prepared**, since a
budget limit can prevent them from being sent.

Migration `202610150004_dynamic_usability_suggestions.sql` adds strict selection,
source/proof/model validation and fresh-Run versioning without table resets or
historical rewrites. It was applied and registered on Centinel Supabase after
local SQL validation. Private helpers remain inaccessible to application roles.

### Live acceptance

| Case | Run | Actual evidence |
| --- | --- | --- |
| Seeded label/keyboard fixture | `a9aa7447-3c08-49fc-b1f4-f4ff8e04c9fb` | Three subjective suggestions, two total model calls, one persisted `usability_suggestions` usage record; functional pass and original two rule failures unchanged. |
| Pinned RWA surface | `a8aece47-ef17-4633-a1cb-7eceef1e7f7d` | Four qualified suggestions with source references, two model calls and one advisory usage record; the eight-step keyboard limit remained explicit. No RWA defect confirmation was performed. |
| One-call budget | `688821ff-6319-4ec6-8abe-7ae3dd92ba9c` | Functional/rule checks passed, advisory `budget_limit`, zero items, exactly one total model call and zero advisory usage records. |

Real QA-bearer Supabase usage rows were checked by Run ID. Both successful cases
used the authenticated Codex `gpt-5.6-sol` provider. The separate Reader downloaded
hash-matched proof JSON containing the same suggestion records. Run JSON and the
primary RWA data checksum were preserved; preparation/cleanup were recorded.

Reader UI revision `5054a8d2-4d9f-45af-9cb6-ff4f12f2c91b` froze the explicit
option through the actual editor. Successful and budget-unavailable displays and
private JSON inspection were verified at 1440×900, 1200×900 and 390×844; screenshots
were inspected and no page overflow was observed. CSS changes are confined to
suggestion text wrapping. API live acceptance remains deferred as agreed.

Validation: sidecar TypeScript, 561 sidecar tests, frontend build, 239 frontend tests
and all 27 SQL suites. Tests cover real accounting integration, call-budget denial,
strict sources, malformed output, secret redaction, sample limits and
cancellation/fencing. A test mock was reset per case to avoid leftover one-shot
responses affecting the subsequent provider tests. The Vite chunk warning remains.

For the checked-in live harness, use `CENTINEL_USABILITY_SUGGESTIONS=true` and
`CENTINEL_USABILITY_VARIANTS=defect,rwa` with the previously documented fixture,
project and isolated-target variables. `CENTINEL_USABILITY_MAX_MODEL_CALLS=1` with
`CENTINEL_USABILITY_VARIANTS=normal` exercises the blocked advisory budget.
Audits are separate ignored `usability-suggestions-live.json`,
`usability-suggestions-budget-live.json` and usage/UI JSON/screenshots.

## M5c5: usability candidates, review and pinned remediation

Completed failed deterministic usability observations can now be recorded as
`dynamic_usability` candidates alongside functional candidates. Each observation
retains rule, perspective, expected/observed result, original Run/revision,
control/check identity, evidence and related subjective suggestions. The synthetic
check DTO is presentation compatibility for finding history; it is not inserted
into the Mission's acceptance checks or used to change functional verdicts.

Candidates start unreviewed with null severity/priority/confidence. They use the
existing member review policy, explicit triage, reason and version-conflict guard.
Subjective suggestions remain reference material and cannot create or confirm a
candidate on their own. Dynamic findings remain separate from Project Assessment.

For main-document controls with a unique non-generated ID, the executor derives
an opaque SHA-256 key from page origin/path, tag, type, role and ID. Raw IDs are not
retained. Duplicate IDs, known sensitive IDs and common framework-generated IDs
are excluded. DOM ordinal references may change while this key remains the same.
Reviewers must still inspect application identity semantics across target versions;
a unique ID alone is not a universal guarantee about the application's meaning.
Explicit feedback/recovery check references use their frozen check identity.
Unanchored observations remain Run-specific and cannot be resolved through a
position-only passing comparison.

Resolution requires confirmation and a completed, functionally passed pinned
regression using the original frozen revision. The same rule/perspective and
stable control or explicit check must have one independently passed observation
with retained proof. Wrong identities, ambiguous matches and unanchored positional
claims are rejected. A pass does not automatically resolve a finding. A later
matched failure reopens investigation and preserves prior decisions/remediation.

Migration `202610150005_dynamic_usability_findings.sql` atomically adds an
observation source column and replaces Run/check uniqueness with
Run/source/check uniqueness. This prevents caller-supplied functional check IDs
from colliding with usability identities. Existing functional payloads and review
RPC contracts remain unchanged. It also extends result validation and the
collector/remediation functions. The migration was applied and registered on
Centinel Supabase. Both existing observations retained their exact payload hash
`35842000029d188d31d928f228284dd25cf45596cc06b4c2c475f719a28c7a7d`
immediately before/after migration; no payload rewrite or reset occurred.

### Final-code real Codex acceptance

| Stage | Run | Evidence |
| --- | --- | --- |
| Seeded label / Tab defect | `5ecc87e4-5044-4009-91c5-545c496a3cf5` | Functional pass, two failed rules and two unreviewed candidates. |
| Controls reordered | `0ef46c48-b887-4926-afe3-c12ef0b98c61` | Source control reference changed u0→u1; same two finding IDs and stable control keys, two observations each. |
| Label / Tab fixed | `652851f1-8278-4e0a-bf6e-266e76bcff61` | Same frozen revision and matching control keys passed; Reader explicitly confirmed then recorded resolution with changed environment/fixture conditions. |
| Defect recurred | `113e965b-ef58-4a39-bdf8-0174ded5b5c8` | Same findings reopened for investigation with three observations and preserved confirmation/resolution/recurrence history. |

The final Mission is `f8627e1a-db29-46f9-896c-a8b03f55a48d`.
Finding IDs are `a5eae5b7-cddd-470a-9e9c-4c1cfce5c523` (labels) and
`9aa86346-65e1-4208-9482-b6950d6d5116` (keyboard). The Reader verified hash-matched
private usability proof for all four Runs. Original baseline JSON and primary RWA
data were preserved, and preparation/cleanup recorded. These are agent-operated
QA fixture decisions, explicitly not stakeholder sign-off or a production defect
claim. An earlier prototype identity run was superseded by this final-code round;
its records remain preserved.

The Reader then opened the actual finding UI, navigated to its source Run/shared
proof and recorded an attributable investigation decision. History displayed four
events for the label finding. The UI exposes rule/perspective, identity limitations
and separate subjective references; source proof availability is inspected in the
Run. Screenshots at 1440×900, 1200×900 and 390×844 were inspected, with no page
horizontal overflow. No unrelated screen CSS was changed.

Validation: sidecar TypeScript and 563 tests; frontend build and 240 tests; all 28
SQL suites and retained upgrade-data checks. Cases include stable reordering,
private/generated ID exclusion, wrong-control regression, unanchored rejection,
stale review, member/non-member guards, recurrence and functional/usability check
ID namespace collisions. The Vite chunk-size warning remains.

The checked-in `usabilityFindingLive.ts` uses the owned fixture's bounded
in-memory `/fixture` modes (defect/reordered/fixed). It never writes target or
primary RWA data. Set the previously documented QA project/primary database/sidecar
variables and load the ignored root `.env`. Audits and UI screenshots remain in
ignored `output/playwright/usability-findings-*.json/png`.

## M5c6: stopped assessment diagnostics

The executor now writes atomic mode-0600 `usability-progress.json` checkpoints
before rules, after label observations and acknowledged Tab dispatch/focus samples,
after rules, and around the optional advisory request. Cancellation or fencing
records a generic stopped reason without raw provider errors. A process kill can
leave the last observed phase; it is historical progress, not proof that a worker
is still running. No checkpoint finalizes a Run, criterion or candidate.

The producer may publish this fixed `usability` slot only for a stopped Run with
selected usability scope. The sanitized `partial_usability` derivative retains
source/hash provenance and explicitly records `criterionProof: false`,
`terminalVerification: false`, authoritative Run state and partial limitations.
Internal proof references may point to local captures that were never published.
Readers do not infer a completed check/finding from the checkpoint's per-rule data.

A private local `usability-shared.json` cache freezes the first diagnostic package
for checksum-stable upload recovery, even if later teardown updates the progress
file. The cache itself is bounded and checksum-checked on retry. Existing shared
copies and historical Run metadata remain unchanged. The original browser-log
availability manifest retains its immutable contents; usability is an independent
extension with its own availability/omission in the current publication response.
The total package and per-file sharing limits still apply after this extension.

Migration `202610150006_dynamic_usability_progress.sql` extends only the fixed
artifact validator. It requires selected scope, producer identity, stopped state,
JSON/size limits and the non-criterion marker. It was locally verified, applied
and registered on Centinel Supabase; existing storage/retention policies remain.

Real Codex cancellation Run `763fe3b8-1da3-4b74-bd8e-4e2ee69a6b15` reached
`advisory_pending` and was stopped through the actual `/cancel` endpoint. It retained
four acknowledged keyboard actions and captured rule observations, with terminal
state `cancelled / not_tested` and no completed usability result. The separate
Reader downloaded the diagnostic and verified its hash, stopped phase and false
verification markers. Repeat publication was identical, terminal Run JSON was
unchanged, and finding collection returned 409. Preparation/cleanup were recorded.

The first acceptance script used the incorrect `/stop` path. Its Run
`80116890-d9f5-4750-8655-4f7554f16119` completed normally; that outcome and cleanup
were preserved and it is not counted as cancellation acceptance. All usability
live harnesses now use the actual `/cancel` route for failure cleanup.

Actual Reader UI showed Not tested separately from the partial diagnostic and
inspected its JSON at 1440×900, 1200×900 and 390×844 without page overflow. Screenshots
were inspected. The new artifact uses the existing evidence UI; no screen CSS
changes are included. The checked-in `usabilityPartialLive.ts` reproduces the
controlled advisory cancellation with the previously documented project/sidecar
variables and ignored account configuration.

Validation: sidecar TypeScript and 565 tests, frontend build and 240 frontend tests,
all 29 SQL suites. Real Chromium verifies cancellation immediately after one
acknowledged Tab retains that count but no unobserved focus pass. Sharing tests
verify redaction, raw-file preservation, frozen retry bytes, unchanged legacy
manifest and terminal-state separation. The Vite chunk warning remains.

## Remaining M5c gates

- Include usability results/decisions in versioned reports and the broader
  repeated release corpus.
