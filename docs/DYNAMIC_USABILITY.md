# Dynamic usability delivery

Authority: DESIGN.md → Centinel_PRD_Revised.md → DEVELOPMENT_PLAN.md P5.

## M5c1: bounded browser rule engine

This slice adds an internal Playwright assessment engine and strict configuration
validator. M5c1 merged through PR #28 (`8ab59fb`). Browser assessment execution,
Run result persistence, model suggestions, usability finding review and reports
remain required delivery gates.

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
expected/observed rule behavior, proof references and limitations. Subjective model
suggestions and usability finding decisions are not represented as implemented.

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

## Remaining M5c gates

- Retain/share stopped partial assessment diagnostics without claiming completed
  rules or changing terminal functional outcomes.
- Add a distinct subjective model-suggestion view alongside the rule results.
- Generate bounded Codex suggestions through existing call/usage accounting;
  label them subjective, with uncertain claims and no invented study outcomes.
- Correlate evidence-backed usability candidates with the human review lifecycle.
- Complete live acceptance of subjective suggestions and usability finding review;
  include these results in versioned reports and the broader release corpus.
