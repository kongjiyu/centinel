# Manual capacity recovery driver — independent review

**ACCEPTED for the scoped temporary-driver change. No blocking findings.** This accepts offline recovery-control behavior, not provider recovery, semantic accuracy or the five-project benchmark.

Reviewed `centinel/.outcome-evaluation.ts` against the preserved baseline `evidence/public-repo-outcomes-2026-10-22/run-2026-10-24T15-46-37-089Z/saved-outcome-evaluation.ts`. The change has three hunks: an opt-in `runAll` parameter defaulting to false, a single conditional linked retry, and an explicit Resume button. The user explicitly authorized resumption after capacity restoration on 25 October 2026. No production files were changed by this review.

1. Normal Run still calls `action(runAll)`, whose invocation passes no arguments. Only the explicit Resume button calls `runAll(true)`. The retry requires the freshly read saved session to be both `blocked` and capacity-classified. Generic failure and completed sessions do not enter that branch.
2. The branch executes once before the polling loop. It sends `refreshSourceManifest:false` with an idempotency key containing the case and exact parent Review ID, records the linked child, and retains the historical parent. A second capacity result reaches the existing terminal collection/stop path; it cannot loop back to another retry or continue to a later case. No provider/model fallback was added.
3. Both existing `case-completed` guards precede assessment creation. A saved `review-created` is observed rather than replaced with another root. The existing root/initial-parent paths and keys are unchanged. Failed recording or API calls reject into the existing stop handler; the API client does not automatically retry the mutation. Retrying the same parent after an uncertain response uses the same key; the production orchestrator looks up the recorded operation/Review before creating a child.
4. Frozen project name/description, artifact identity/version/hash/path/type, current Readiness status/staleness and snapshot-ID guards remain before the Review phase. Session restoration, bearer transport and authenticated API use are unchanged. The retry endpoint checks membership and target Review/project identity. Backend retry reuses the parent's source manifest and configuration. New diagnostic metadata contains the parent ID and fixed authorization text; observer-stop records retain allowlisted code/status without raw response bodies. Existing usage diagnostics use the safe usage service. No new prompt, source, credential or provider-response logging was introduced.

| feature | acceptance criteria | status | risk flags |
| --- | --- | --- | --- |
| Explicit recovery | Ordinary Run holds; explicit Resume retries only a saved blocked capacity Review | PASS | Capacity detector is the unchanged broad pause detector; this review does not narrow production pause policy |
| Bounded retry/lineage | One linked saved-source retry; parent-specific idempotency; stop on renewed capacity | PASS | Another explicit later user action is a separate invocation; no live provider recovery was attempted |
| Frozen/authenticated scope | Preserve source/snapshot guards, completed cases and authenticated project ownership | PASS by inspected paths and relevant mocked fixtures | Fixtures do not exercise a real server, authentication session, concurrent browser instances or independent on-disk byte verification |
| Local verification | All eleven driver fixtures pass against reviewed source | PASS: 11/11 | VM fixtures extract `runAll`, stub API/capacity boundaries and transpile TypeScript; they do not execute the complete browser module |

Ran successfully:

```powershell
node evidence/public-repo-outcomes-2026-10-22/verify-v9-driver-guards.mjs
```

Passing fixtures: changed project, changed artifact, stale Readiness, changed snapshot, unchanged-input Review boundary, checkpoint stop, ordinary continuation, ordinary capacity hold, manual linked recovery, renewed-capacity stop, and changed-source recovery rejection.

The review also followed the existing client request/retry method, membership-checked retry route, orchestrator idempotency/source reuse and safe usage projection as read-only supporting context. No network, provider, browser/app API, install, production mutation or saved-baseline rewrite occurred. Product UI/build checks were not run for this temporary offline evaluation driver; live recovery remains for the authorized root workflow.

## Final reviewed SHA-256 values

| File | SHA-256 |
| --- | --- |
| `centinel/.outcome-evaluation.ts` | `49fff171f49e3df1a930dff290f776d6731cfe30fff796b0c8aae2dc474eb9de` |
| `evidence/public-repo-outcomes-2026-10-22/verify-v9-driver-guards.mjs` | `0261137a25ee4b131b2888608e04e44d52bed2ede6ac4bdf4862b15f71f480f0` |
| Run baseline `saved-outcome-evaluation.ts` | `ace595a0a1c2a27b7b7444b7782d0fbe33658ace8b4d953615f82c7f517f267a` |
