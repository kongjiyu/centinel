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

## Remaining M5c gates

- Run assessment before terminal persistence under the existing runtime/budgets;
  retain reproducible proof, partial outcomes and limitations.
- Add persona/rule authoring and distinct deterministic/subjective result views.
- Generate bounded Codex suggestions through existing call/usage accounting;
  label them subjective, with uncertain claims and no invented study outcomes.
- Correlate evidence-backed usability candidates with the human review lifecycle.
- Verify normal/seeded defects with real Codex and UI at three required viewports.
