# Actual v20 Axios partial result: independent assessment

**Acceptance fails: execution stopped for quota, the registered issue is missing, and assessed-domain evidence is incomplete.** Saved findings have supported local causes and valid exact citations. This does not establish a completed Review, cache benefit or semantic pass.

Review `1deb8b4b-10b5-4da3-b627-0e7a50ed4d8b` is the actual v20 child of v19 Review `a679eca3-7cec-4860-a3b1-bec7770ac0c7`. Session provenance records policy `review-2026-10-28-validated-batch-cache-v20` and `reuseValidatedBatches=true`, but the saved usage projection records **zero reused batches**. Assessment uses the fixed Axios case, original source and unchanged gold/thresholds in [EVALUATION.md](../EVALUATION.md). The previous v19 adjudication remains untouched.

Inputs are `0065` session, `0066` manifest, `0067` usage, `0068` findings, `0070` harness and `0071` evidence under `evidence/repository-index-evaluation-2026-10-26/run-2026-10-28T04-07-38-400Z/`. Full record IDs, source reasoning and dispositions are in [adjudication.json](./adjudication.json); reproducible checks and safe captured metrics are in [verification.json](./verification.json).

## Frozen acceptance results

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Frozen source | Same selected manifest and original bytes | Verified all 52/52 hashes before and after offline probes; normalized manifest `669a3ea464b6c3184f87dc29526db66e587c9226e754c4e69b56937bbdf99c64` | Source verification does not attest every historical runtime/configuration dimension |
| Unique saved precision | Every unique prediction adjudicated, precision at least .80 | **10 true / 0 false / 0 unknown / 0 unadjudicated**; partial resolved precision and adjudication bounds **100%** | Six causal model claims plus four factual diagnostics; already-aborted cancellation subclaim is adapter-local; severity and deployed exploitability are separate |
| Registered Axios recall | 1/1 issue and 1/1 occurrence | **0/1 issue, 0/1 occurrence in saved output** | Complete gold HTTP range appeared in recorded AI context; final-run recall unavailable |
| Finding references | 100% exact frozen-source validity | **28/28 primary/related finding excerpts valid** | Citation validity does not establish every consequence; production uncertainty flags retained |
| Workflow completeness | Finalize all planned batches and source sweeps | **3/22 distinct batch IDs saved; 0/3 independent source-sweep batches complete** | `blocked`, `modelStatus=partial`, `provider_paused`, `quota_exhausted`; no finalization |
| Source/code coverage | Full sweeps, at least 90% code inspection, gold file inspected | Physical read 52/52; selected code read 48/48; recorded AI context **13/52 files and 9/48 code files (18.75%)** | Physical reading does not prove semantic inspection or full prompt/source-range coverage |
| Domain disclosure/evidence | Every inferred four-domain row disclosed and validated | 588/588 disclosed; **92 labelled assessed**, 496 unverified; only **89 assessed rows have evidence** | Three assessed/potential_gap rows have empty evidence; 17/147 features fully assessed, 27/147 have any assessed row; 360 unresolved edges |
| Usage/cache comparison | Complete provider totals, distinct embedding/model usage, verified reuse | Known partial usage **289,982 tokens + one unknown call**; reused batches **0** | 289,918 model tokens plus 64 query-embedding tokens; no complete-run delta or index/cache saving claim |
| Readiness/benchmark | Separately scored Readiness and five completed cases | Not established | One partial Review; preflight `readiness=ready` is not Project Readiness semantic acceptance |

The 13 records comprise seven model observations and six deterministic observations. Two undeclared-`req` records share one cause. Each adapter's outer function and nested Promise executor length warnings also share one maintainability cause, consistent with the fixed historical/v19 dedup policy. That leaves **six unique model defects/conditional mechanisms and four unique diagnostics**. Model-only saved precision is 6/6.

The [1.00, 1.00] precision bounds describe resolved saved-claim adjudication. They are not statistical confidence intervals, complete-run precision, or proof of severity calibration. No later, unsaved result is credited. The cancellation setup scope correction below is necessary when presenting the findings.

## Every saved claim

Prefixes below uniquely identify records; complete UUIDs are retained in JSON. All ten causal/factual groups are true at the stated scope.

| Saved ID prefixes | Judgment | Source and independent rationale |
| --- | --- | --- |
| `24b5505a` | **Act on:** XHR failure retains cancellation listeners | `xhr.js:22–29,52–78,104–141,190–205`; `CancelToken.js:76–100`. Error, timeout and browser-abort handlers clear `request` without `done()`, so subsequent `loadend` exits early. Two simulated failures per terminal path accumulated six listeners on both reusable token and fake signal. Successful-load control removed its own subscriptions. Actual heap size and native browser event behavior were not measured. |
| `efd895c4`, `052f43e8` | **Act on:** undeclared `req` breaks active XHR cancellation | `xhr.js:193–204` declares `request` but references `req`. Post-send abort event raised `ReferenceError` before rejection or request abortion. **Scope correction:** direct already-aborted adapter invocation also rejects `ReferenceError`, but normal public Axios calls are guarded by `dispatchRequest.js:12–29` and reject `CanceledError` before invoking XHR. Both paths were independently tested. |
| `5e5064e7` | **Act on:** stream abortion misreported as size limit | `http.js:337–362`. Un-rejected aborts always report maxContentLength exceeded without checking bytes or enabled limit. Zero-body fake stream abort with disabled `-1` limit reproduced the misleading message. |
| `e597a091` | **Act on, conditional:** cross-origin XSRF cookie copy | `xhr.js:143–172`, `cookies.js:34–36`. withCredentials bypasses same-origin selection and copies the page cookie into a destination header. Fake XHR established local copying with same-origin false; false-withCredentials control omitted it. Remote URL influence, native credentialed CORS success and deployed exploitability remain unverified. |
| `dde98a15` | **Act on:** empty request bypasses response decompression | `http.js:183–212,301–319`. Empty Buffer request deletes response encoding before selecting decompression. The probe returned the compressed response unchanged and without its encoding header; nonempty-request control decompressed the identical bytes. |
| `e09ed56e` | **Act on:** BOM result discarded | `http.js:128–147,371–375`. Data-URI text path strips into `data` but returns `convertedData`. Valid base64 data URI retained U+FEFF; ordinary HTTP path assigns the returned response variable correctly. |
| `671056b3` | **Consider:** 130-line serializer | AST confirms `toFormData.js:48–177`. Factual length does not establish a mandatory split or medium-severity defect. |
| `d7a870e9`, `611bc6e0` | **Consider:** XHR adapter length | AST confirms 206-line executor and 208-line wrapper at `xhr.js:16–223`. One maintainability cause, not two distinct bugs. |
| `f8048289`, `bd021929` | **Consider:** HTTP adapter length | AST confirms 374-line executor and 376-line wrapper at `http.js:84–459`. One maintainability cause; severity remains unproven. |
| `ac43cfeb` | **Noted:** existing TODO | Exact note at `http.js:389–391`. Presence is proven; priority or behavioral defect does not follow solely from the note. |

Three saved model records still carry `needs_verification` / `support_unverified`: listener leak, the newer undeclared-`req` record, and XSRF. All have zero unmatched references; the duplicate undeclared-`req` record separately carries `verified`. Independent causal judgment does not overwrite these production states, merge the stored records or create clean absence-resolution proof.

## Gold, evidence and coverage limits

The fixed gold issue `node-timeout-custom-message` remains absent from all seven saved model records. Node HTTP at `421–430` ignores `config.timeoutErrorMessage`, while XHR at `127–137` honors it. An inert transport probe confirmed the ignored message and preserved default timeout message/`ECONNABORTED` negative control. The complete gold range lies within recorded AI-context ranges `36–460` and `82–460`. This is a false negative in the saved partial artifact; it must not be dropped from the 1-issue/1-occurrence denominator because execution stopped. The frozen gold has no severity field.

Exact contiguous finding excerpts were independently matched at their recorded starting lines against canonical source, file/artifact identities and content hashes. **28/28** finding references and **66/66** optional candidate excerpts passed. All **1,119/1,119** full-map anchors have correct identity/hash and in-range lines. These inventories overlap and must not be summed into independent observations.

The **90 valid assessment anchors cover 89 evidenced rows**, because one row has two anchors. Three additional cookie module security rows are labelled `assessed/potential_gap` but contain no evidence:

- `feature-3b25017e7a58`
- `feature-773e34d6ce34`
- `feature-689b87bcd3c3`

Their generic summaries state that the frozen source does not establish a browser/runtime consequence. They cannot be credited as validated assessed rows under the frozen evidence requirement. Reported non-N/A assessed coverage is 72/588 (12.24%); restricting that inventory to evidenced rows leaves **69/588 (11.73%)**. Neither figure independently validates every no-issue summary. All 496 unverified rows and 360 explicit runtime/dependency/map boundaries remain disclosed. Explicit boundary disclosure alone is not a whole-system failure; missing required source sweeps and assessed evidence do block acceptance.

The 13 AI-context files are `CONTRIBUTING.md`, `README.md`, `package.json`, `tsconfig.json`, `index.js`, `lib/adapters/http.js`, `lib/adapters/xhr.js`, `lib/axios.js`, `lib/cancel/CanceledError.js`, `lib/cancel/CancelToken.js`, `lib/helpers/cookies.js`, `lib/helpers/toFormData.js`, and `lib/platform/index.js`. The other **39 selected files have no recorded AI appearance**; the complete list is in verification JSON. There are 61 recorded AI file appearances and zero unknown inventory attempts. This is not an exhaustive range coverage claim.

The evidence snapshot's `readiness=ready`, available 52/52 artifacts and empty preflight gaps establish availability for Review input. They do not score Project Readiness's requirement/design/standards criteria. No new semantic Readiness result is supplied here.

## Reproducible verification

Run from the repository root:

```powershell
node docs/LOCAL_REPOSITORY_INDEX_2026-10-26/V20_PARTIAL_QUALITY/verify-partial.mjs
```

**Nine offline probe groups passed.** They cover the six causal mechanisms, direct-adapter/public pre-aborted guard distinction, missing gold and AST/TODO facts. The leak group includes all three terminal paths, repeated failures and success-cleanup control. The evaluator runs unchanged selected source with denied/inert network transports and explicit environment stubs. It creates no sockets, calls no app API or provider, installs no dependencies and changes only evaluator JSON in this directory. All 52 frozen file hashes remained valid afterward.

This is an assessment of the terminal snapshot above. A later retry, cache hit or continued workflow requires its own saved evidence and adjudication. Zero reuse here cannot establish v20 cache success or failure, and a quota-stopped partial token total cannot support a complete-run optimization comparison.
