# Axios v19 saved partial result: independent quality assessment

**Acceptance fails: the Review is quota-blocked and the registered timeout issue is missing.** The saved claims have strong bounded precision and exact references, but this is not a completed Review or a semantic pass.

Review: `a679eca3-7cec-4860-a3b1-bec7770ac0c7`. Frozen case: `axios__axios-4738`, source commit `9bb016f95e6de871a44f3276fd06562704a0abb0`. Evaluator inputs are the supplied `0173` manifest, `0174` usage, `0175` findings and `0177` harness in `evidence/repository-index-evaluation-2026-10-26/run-2026-10-27T13-50-39-777Z/`. No gold, application code, production record, imported source or historical report was changed.

1. Read the complete relevant original frozen functions and callers, including both adapters, dispatch, transforms, configuration merge, serializer and cancellation helpers.
2. Independently verified all saved predictions and their source identities/locations. Executed 14 evaluator probes against unchanged source with inert network transports and explicit environment stubs; no real network, app API or provider call occurred.
3. Retained partial workflow status, all production uncertainty flags and the fixed gold denominator. The reproducible checks are [verify-partial.mjs](./verify-partial.mjs); detailed results are [verification.json](./verification.json) and [adjudication.json](./adjudication.json).

## Results against frozen acceptance

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Frozen source | Exact selected manifest and hashes | Verified 52/52 file bytes before and after evaluator probes; normalized manifest `669a3ea464b6c3184f87dc29526db66e587c9226e754c4e69b56937bbdf99c64` | Does not independently attest every historical runtime/configuration setting |
| Saved prediction precision | Every unique prediction adjudicated; precision at least .80 | 16 true / 0 false / 0 unknown / 0 unadjudicated; resolved and conservative/optimistic partial-result bounds 100% | Factual/conditional claim scope; four deterministic observations are not four proven behavioral defects; not a statistical confidence interval or full-run precision |
| Registered gold recall | 1/1 issue and 1/1 occurrence | **0/1 issue; 0/1 occurrence in saved partial output** | Gold HTTP timeout range appears in recorded AI context; final-run recall unavailable |
| Exact source evidence | All references valid; causal truth separately adjudicated | 41/41 finding primary/related excerpts valid; 288/288 assessment anchors valid | Assessment rows retain anchors without excerpts; valid locations do not establish every no-issue conclusion |
| Complete execution | All 22 planned batches and independent full source sweeps complete | **9/22 distinct batch IDs saved; 0/3 source-sweep batches complete** | `blocked`, `modelStatus=partial`, `provider_paused`, `quota_exhausted`; no finalization |
| Code/source coverage | Full source sweeps; at least 90% selected code inspection; gold file inspected | Physical reads 52/52 and code reads 48/48; AI context only 35/52 files and 31/48 code files (64.58%) | Physical reading does not establish model inspection, complete range coverage or semantic source sweeps |
| Feature/domain coverage | All inferred four-domain rows disclosed and validated | 588/588 disclosed; only 288/588 assessed (48.98%); 300 unverified; 72/147 features assessed | 241/588 non-N/A assessed rows (40.99%) are production-reported supported-claim coverage, not independent validation of every summary; 360 explicit unresolved edges |
| Whole benchmark/Readiness | Five completed cases; separately scored Readiness assertions | Not established | One saved partial Review; no supplied Readiness output; no whole-system recall or full 16-criterion accuracy claim |

The 20 saved records contain 14 model records and six deterministic records. Causal deduplication merges the two ArrayBufferView warnings, the two shared-helper warnings, and each adapter's nested/wrapper length warnings. This yields **12 unique model claims plus four unique deterministic observations**, consistent with the frozen historical adapter-length grouping. Model-only precision is also 12/12 for these saved bounded claims.

Three saved records still carry `needs_verification` / `support_unverified`: both ArrayBufferView records and the XSRF record. Every one has zero unmatched references. Independent source inspection supports their local mechanisms; the original flags remain intact. No independent judgment grants clean completion or absence-resolution proof.

## Per-prediction judgments

IDs below use unique eight-character prefixes; [adjudication.json](./adjudication.json) preserves every full UUID and causal key. Every row was adjudicated **true at the stated scope**.

| Saved IDs | Claim and disposition | Original-source rationale |
| --- | --- | --- |
| `0ed741c7` | Custom Blob ignored — Act on | `toFormData.js:71–90` selects `options.Blob` then constructs global Blob. Custom constructor remained uncalled; absent globals reached Buffer failure. |
| `8e8b93af` | Cookie regex metacharacters — Act on | `cookies.js:34–36` accepts the configured name without escaping. `session.id` selected `sessionXid`. A name containing an invalid bracketed range throws; bare `[` alone need not throw. No attacker-control or security-impact claim is credited. |
| `b0d7845f` | Silent JSON documentation mismatch — Act on | `README.md:501` promises null; `defaults/index.js:118–139` returns the original malformed string. Silent/strict probe controls confirmed the mismatch. |
| `ac0f09ea`, `ee954e59` | ArrayBufferView bounds lost — Act on | `defaults/index.js:84–85` drops offset/length; `dispatchRequest.js:34–41` forwards it; `http.js:189–190,456` turns the full buffer into request bytes. A two-byte view produced four fake-transport payload bytes. Raw uncertainty retained. |
| `eed6123b` | Inherited strategy lookup — Act on | `mergeConfig.js:63–96` reads a normal-object prototype. Own `toString` is replaced by `[object Undefined]`; own JSON-parsed `__proto__` selects a nonfunction. No prototype-pollution exploit is inferred. |
| `cdb904ff`, `02841aad` | Shared serializer helpers — Act on | `toFormData.js:28,142–159` mutates a module object with closures. Reentrant serialization changed the outer helper and appended the outer field to the inner form. |
| `b7be261a` | Throwing cancellation listener — Consider | `CancelToken.js:25–34,76–86` has no listener isolation. Throwing later subscriber prevented earlier notification, skipped cleanup and rejected the ignored promise. Conditional robustness improvement; normal well-behaved listeners are a separate path. |
| `61c1a08d` | Stream-abort misdiagnosis — Act on | `http.js:351–361` reports size-limit failure for an un-rejected abort without checking bytes or enabled limit. Disabled `-1` limit plus zero-body abort still reported exceeding `-1`. |
| `777a40fd` | XHR cancellation reference error — Act on | `xhr.js:193–204` names undeclared `req`. A post-send abort event threw before rejection and `request.abort()`. Pre-aborted Promise-construction behavior is a separate case. |
| `998e8d8c` | Cross-origin XSRF copy — Act on, conditional | `xhr.js:146–172` copies a local cookie into the destination header when withCredentials is true even with same-origin false. Fake XHR confirmed copy and false-withCredentials negative control. Actual browser CORS, remote URL influence and deployed exploitability remain unverified; disclosure was explicitly conditional on those prerequisites. Raw uncertainty retained. |
| `46490ffe` | Decompression bypass — Act on | `http.js:305–315` deletes response encoding based on an empty request Buffer. The same compressed response stayed compressed for empty request and decompressed for a nonempty request. |
| `2391d134` | BOM removal wrong variable — Act on | `http.js:136–147` strips into `data` but returns `convertedData`. Valid base64 data URI returned a leading U+FEFF; ordinary HTTP decoding uses the correct response variable at 374–375. |
| `1dc9c6f7` | toFormData length — Consider | AST confirms 130 inclusive source lines (`toFormData.js:48–177`). Factually correct; mandatory split and medium severity are unproven. |
| `299f0fda`, `c1ab21f2` | XHR adapter length — Consider | AST confirms 206/208 lines for nested executor/wrapper (`xhr.js:16–223`); one maintainability cause, not two distinct bugs. |
| `94246e7b`, `f43e3746` | HTTP adapter length — Consider | AST confirms 374/376 lines (`http.js:84–459`); one maintainability cause. Length alone does not validate medium severity. |
| `fd1e89e5` | Existing TODO — Noted | The exact maintenance comment exists at `http.js:389`. Relevance/priority still needs context; no behavioral defect follows solely from its presence. |

The registered gold is `node-timeout-custom-message`. No saved finding identifies the Node timeout callback ignoring `config.timeoutErrorMessage` at `http.js:421–430`, although that exact range is contained in recorded AI-context ranges `36–460` and `82–460`. A fake transport reproduced the ignored custom message while preserving default message and `ECONNABORTED`. Selected `xhr.js:127–137` honors the option. This is a false negative for the saved artifact; it is not excluded because execution stopped.

## Evidence and remaining coverage

All 41 finding excerpts were checked against the original starting line with exact contiguous source text (`range.includes(quote)`), plus artifact identity and content hash. All 105 optional citation candidate excerpts also match their recorded source locations. All 1,317 full-map reference anchors have matching file/artifact/hash and in-range lines. These inventories overlap: do not add them as independent evidence or equate an approximate candidate's match score with finding-truth probability. Assessment-anchor validation covers all 288 evidenced assessed rows; the 300 remaining rows have no assessed evidence to certify.

Seventeen files have no recorded AI-context appearance: `.eslintrc.js`, `index.d.ts`, `lib/defaults/transitional.js`, `lib/env/data.js`, `lib/helpers/normalizeHeaderName.js`, `lib/helpers/null.js`, `lib/helpers/parseHeaders.js`, `lib/helpers/parseProtocol.js`, `lib/helpers/spread.js`, `lib/helpers/toURLEncodedForm.js`, all three selected `lib/platform/browser/` files, all three selected `lib/platform/node/` files, and `lib/utils.js`. They were physically read; this does not fill the missing model coverage. Recorded AI file appearances total 224 with no unknown attempts in this inventory.

The 14 probes passed with no socket creation and no dependency installation. They include the 12 distinct model mechanisms, the missing gold behavior and AST/TODO diagnostics. Tests deliberately use mocked request transports, same-origin predicate and browser environment; they verify conditional local mechanics rather than real-browser/network outcomes. They do not verify all 288 assessed domain summaries or all possible callers, runtimes and asynchronous paths.

Reproduce from the repository root:

```powershell
node docs/LOCAL_REPOSITORY_INDEX_2026-10-26/V19_PARTIAL_QUALITY/verify-partial.mjs
```

This writes only evaluator verification JSON in this directory. It never resumes the Review. Completed-run token comparisons, causal attribution to v19 retrieval, full semantic acceptance and Readiness acceptance remain unavailable from this partial result.
