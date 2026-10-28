# Readiness and Review mitigation verification — 23 October 2026

The code mitigations are implemented and regression-verified. The fresh live evaluation is **NOT ACCEPTED** because the configured provider exhausted its quota on the first Review request. No automatic retry, fallback, provider switch or remaining-project assessment ran after that response.

## Actual saved outcomes

Run: `evidence/public-repo-outcomes-2026-10-22/run-2026-10-22T16-30-21-513Z`. The original failed baseline and frozen gold remain unchanged. Existing five projects were reused; all 192 imported files were verified against the same frozen selection. New Review policy: `review-2026-10-23-batched-coverage-v6`; Readiness policy: `readiness-2026-10-23.1`. Provider: the user's saved Codex `gpt-5.6-sol` configuration.

| Project | Readiness | Review | Outcome limitation |
| --- | --- | --- | --- |
| Axios | Completed in **257.225 seconds**, three semantic batches | Blocked on first model request: `quota_exhausted` | Six deterministic observations retained; no accepted model findings |
| Docusaurus | Unattempted in this fresh run | Unattempted | Batch stopped at provider capacity response |
| Immutable.js | Unattempted in this fresh run | Unattempted | Batch stopped at provider capacity response |
| Three.js | Unattempted in this fresh run | Unattempted | Batch stopped at provider capacity response |
| Preact | Unattempted in this fresh run | Unattempted | Batch stopped at provider capacity response; original selected-config limitation remains |

Axios Review `adb6b61c-752f-45ae-89d7-9e2e5e7968f1` read **52/52 selected files** and inventoried **133 operations**, with **zero inventory omissions**, planning 18 bounded requests. The actual attempt journal records one request, 2,685 ms, `quota_exhausted`; no retry or fallback followed. All 532 feature/domain rows remain explicitly unverified. Parsing and reading files do not establish behavioral assessment.

Readiness request `948a82a8-1c8f-4b7f-b791-e64c5d02dd04` saved assessment `0b1e1306-683f-44f2-b5e9-076fb433a3f0`. Repository is Completed; Requirements, Design and Standards remain Incomplete. All three semantic categories were classified Present with valid source inventory. The three batches claimed 48 local check passes; validation/consolidation retained seven effective passes and nine Unknown criteria, including unverified cross-batch consistency/conflicts. These counts expose overclaim/validation differences; they are not a full semantic accuracy score. Unknown evidence must be resolved or supplied, not converted into a fabricated pass.

## Metrics against the unchanged acceptance criteria

| Measure | Actual result | Acceptance interpretation |
| --- | --- | --- |
| Successful complete workflows | **0/5** | Not accepted; four unattempted, one capacity-blocked |
| Model precision | **Undefined: 0 predictions** | No semantic accuracy claim |
| Known issue / occurrence recall | **0/5 / 0/7** | Fixed end-to-end outcomes; capacity failure does not measure model defect-detection ability |
| Exact evidence validity | **362/362** | Valid for retained references only; not five-case acceptance |
| Selected code inspection | **48/169 (28.40%)** fixed sample; **48/48 Axios** | Whole evaluation threshold not met; file reading is not semantic coverage |

Additional disclosure: **532/532** inferred feature/domain rows are recorded, but **0/532** have supported model assessments. The six deterministic observations deduplicate to four source-supported candidate claims (three long implementation regions and one TODO marker), yielding provisional deterministic precision **4/4** for this stopped case. This cannot be generalized to the model or all five repositories. Seven frozen partial Readiness assertions are supported for Axios only; the other 28 assertions remain unattempted. No complete 16-criterion gold accuracy is claimed.

Machine-readable evidence: [metrics.json](./metrics.json), [adjudication.json](./adjudication.json), [scorer](./score.mjs). The scorer reuses the original frozen gold and denominators. New finding IDs were independently adjudicated rather than copying historical verdicts. Nested HTTP/XHR wrapper and callback length observations share one cause key per adapter.

## Implementation acceptance

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Frozen source loading | Selected version/hash, authorization retained, four-worker bound, reads reused | Verified by regressions; Axios read all selected sources live | Live timing depends on Storage/network |
| Readiness batching/deadline | Full source inventory, task-scoped cross-batch citations, bounded cancellation, previous snapshot preserved | Verified; prior Axios timeout replaced by a completed live result | Semantic categories remain Incomplete; four cases blocked |
| Review inventory and repair | CJS/classes/prototypes, explicit omission accounting, bounded requests/attempts, exact evidence validation | Offline checks passed; live inventory verified | Live model repairs and full batch completion blocked by quota |
| Finding accuracy safeguards | Sink observations require flow verification; TODO alone does not block release; earlier validated findings survive later failure | Regression-verified; TODO wording observed in saved live finding | Does not establish general precision/recall |
| Outcome evaluation | All five eligible and frozen metric thresholds met | **NOT ACCEPTED** | Provider quota; no automatic workaround |

Final integrated affected suite: **279/279 tests across 19 files passed**. Sidecar TypeScript and frontend build passed; frontend retains its existing large-bundle warning. Four metric-scoring unit tests passed. Independent GPT-6.1 Sol review found no blocking issues in the final scoped code or metrics, reproduced the scores and independently checked source spans/hashes. Earlier full sidecar invocation had 18 unchanged Dynamic Windows failures plus one subsequently fixed Readiness fixture; no full-suite green claim is made.

Two final defensive patches postdate the saved live execution: rejecting snapshots returned after deadline during final metadata revalidation, and preserving deterministic counts alongside validated model prefixes after a later permanent failure. Both passed targeted/integrated regression checks and independent review. Their live paths remain unverified; the saved run's runtime-code manifest is preserved rather than relabelled.

The application is returned to the existing assessment hold (`CENTINEL_AI_ASSESSMENT_PAUSED=1`); root `.env` is unchanged and the temporary project allowlist override is removed. Restoring provider access and an explicit manual resume are required before the remaining live evaluation can continue. Keep the saved failed/blocked attempts as historical evidence.
