# Dynamic usability delivery

Authority: DESIGN.md → Centinel_PRD_Revised.md → DEVELOPMENT_PLAN.md P5.

## M5c1: bounded browser rule engine

This slice adds an internal Playwright assessment engine and strict configuration
validator. It does not yet add Mission authoring, Run persistence, model suggestions,
reviewable usability findings or reports. Those remain required delivery gates.

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

## Remaining M5c gates

- Freeze optional persona/rules in Mission revisions and execution versions; old
  Missions remain compatible. Add direct-RPC validation and actor/lease guards.
- Run assessment before terminal persistence under the existing runtime/budgets;
  retain reproducible proof, partial outcomes and limitations.
- Add persona/rule authoring and distinct deterministic/subjective result views.
- Generate bounded Codex suggestions through existing call/usage accounting;
  label them subjective, with uncertain claims and no invented study outcomes.
- Correlate evidence-backed usability candidates with the human review lifecycle.
- Verify normal/seeded defects with real Codex and UI at three required viewports.
