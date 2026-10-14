# Dynamic finding verification and remediation

Authority: DESIGN.md → Centinel_PRD_Revised.md → DEVELOPMENT_PLAN.md.
M5a supplies a functional finding workflow and connects M4 regression lineage.
Usability personas/rules, shared evidence recovery/retention, versioned reports,
M6 and M7 remain required. Static implementation is excluded.

## Workflow

Open a completed Run and choose **Record failed-check candidates**. Only failed
independent checks with matching definitions and uniquely referenced SHA-256
proof can produce candidates. Runtime/provider blocks and unsupported evidence
produce no application issue. Collection is idempotent for the Run/check.

Candidates start **Unreviewed**, with severity, priority and confidence
**Unclassified**. Inspect the immutable expected/actual result, frozen goal,
target/version, executor and evidence references before making a decision.
**Confirm issue** requires explicit shared severity/priority/confidence and a
reason; **Reject candidate** and **Needs investigation** require a reason.
The verified bearer account supplies attribution, never a caller actor ID.
Existing project-member authorization is reused; no new reviewer role is invented.

Verification and remediation are separate. A passing Run does not automatically
resolve a finding. **Resolved after regression** requires a confirmed candidate,
a passed completed regression pinned to one of its failed observations, the same
frozen revision/check and independent passing proof. Inspect changed recorded
conditions before saving. The resolution event preserves the regression ID,
reason, actor and environment/engine/actor difference disclosures. Private state
and actual runtime contents remain unproven by matching version metadata.

Repeated failed observations for the same mission/check/criterion/target address
correlate to one finding. A fresh failure after resolution reopens it and requires
investigation, clears current confidence and appends an explicitly automatic
recurrence event. Original human decisions and both Run results remain intact.
Different saved missions remain distinct; this slice does not claim semantic
cross-mission deduplication or general application security assessment.

Decision updates require the exact current version. Concurrent/stale submissions
are rejected before appending history. Detail reads return the finding and its
observation/event history from one database snapshot. UI failures preserve inputs
and expose **Refresh finding**. Late responses from a previously selected project
are ignored. A decision clears the selection honestly after success.

## Storage and interfaces

`202610140017_dynamic_reviewed_findings.sql` adds three separate Dynamic tables,
member-scoped read policies, guarded candidate/review/remediation RPCs and a
snapshot detail reader. Direct table writes are revoked. Non-members and revoked
members cannot retrieve histories or make decisions. Existing Static tables,
Project Assessment aggregation and saved Runs are not rewritten.

The bearer-scoped sidecar exposes:

- `GET /projects/:project/dynamic/findings`
- `GET /projects/:project/dynamic/findings/:finding`
- `POST /projects/:project/dynamic/runs/:run/findings`
- `POST /projects/:project/dynamic/findings/:finding/review`
- `POST /projects/:project/dynamic/findings/:finding/remediation`

Shared notes reject known private local values before persistence. Evidence
references remain local to the executing device in this slice; their presence
is not a claim of second-device file availability. M5 evidence sharing and report
snapshots will consume this immutable observation/decision history.

## Retained acceptance

- Real failed Codex baseline `380dddca-3df5-4e5a-babb-3e9fc4118ae2` produced finding
  `491031d1-3b8c-4c6e-97b1-c37aaaea50ca` without automatic triage. Repeated collection
  kept one observation. A stale concurrent decision returned HTTP 409.
- Restored original RWA source, then real Codex regression
  `3a7565ad-cec9-4bd3-baf2-3d6aad938eed` passed the exact frozen revision/expectation.
  An explicit QA decision resolved the finding and disclosed changed environment
  conditions. The baseline JSON stayed identical. Only the declared fictional
  First Name changed; unrelated and primary data remained identical. Preparation,
  cleanup and session removal completed.
- Actual QA UI rejected the incorrect-expected-wording candidate from Run
  `c0814b78-6554-430f-9a0a-88bde5943143` and displayed attributed history. This is a
  false test expectation, not a confirmed application defect.
- These decisions are agent-operated QA acceptance simulations, explicitly named
  in their persisted reasons; they do not claim stakeholder sign-off.
- 525 sidecar tests, 226 frontend tests, TypeScript/frontend build, twenty-two
  Dynamic SQL suites and preservation of all nine pre-existing Dynamic tables in
  the upgrade fixture passed. Additive migration applied and registered on
  Centinel Supabase. Build retains its known large-chunk warning.
- Light DESIGN.md workflow inspected at 1440×900, 1200×900 and 390×844. Narrow
  tables use contained horizontal scrolling; reason inputs, shared Select controls,
  focusable table and history remain readable without page overflow. CSS is
  scoped to the new finding panel. API-provider live acceptance is user-deferred.

Local audit files: `output/playwright/findings-live.json`, `findings-ui.json` and
`findings-<width>-*.png`. They are ignored and contain no imported session state.
