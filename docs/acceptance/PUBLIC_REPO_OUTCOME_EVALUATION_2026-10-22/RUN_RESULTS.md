# Actual public repository outcome assessment — 22 October 2026

**Execution and scoring finished. Outcome: NOT ACCEPTED.** All five real projects were created, all 192 pinned files imported correctly, and Readiness plus Review attempted for each. Three Readiness jobs completed; no Review produced an accepted complete model assessment. Failed attempts remain saved.

## Four primary metrics

| Metric | Actual result | Frozen acceptance | Interpretation |
| --- | --- | --- | --- |
| Precision | Model: undefined (no retained model predictions). Deterministic/aggregate: **22/28 unique claims, 78.57%** | At least 80% unique precision | Fails. Most supported claims are literal TODO notes or maintainability candidates, not functional defects. Raw flags: 29; one duplicate warning collapsed. |
| Known-bug recall | **0/5 issues; 0/7 occurrences** | At least 4/5 issues and 6/7 occurrences | Fails end-to-end. Provider-completed conditional recall: 0/2 issues, 0/4 occurrences. Successful-workflow conditional recall: undefined. This is not standalone model accuracy. |
| Evidence validity | **281/282 asserted references, 99.65%** | 100% | Fails: one Docusaurus finding saved generated prose instead of a source excerpt. Repeated references count as asserted occurrences. Provenance does not establish semantic correctness. |
| Coverage completeness | **169/169 selected code files read, 100%**; all gold-affected files read | At least 90%; all affected files | Read gate passes. Supported domain claims: **0/336** feature/domain pairs. All 336 disclose unverified status. Axios/Three.js recognized zero features, an additional blind spot. |

All 29 saved predictions were adjudicated against pinned source in `adjudication.json`; no unknowns were silently dropped. Extra findings were not called false merely because gold omitted them. The high-severity Preact innerHTML warning lacks a demonstrated attacker-controlled caller or missing trust boundary: the cited assignment implements the explicit dangerouslySetInnerHTML API. TODO notes support maintenance observations, not automatic release blockers. These qualifications matter when interpreting the 22 true claims.

## Saved outcomes

| Project | Project ID / Review ID | Readiness | Review / expected defect |
| --- | --- | --- | --- |
| Axios | `3c66cb23-9805-471d-97e6-719182787d94` / `c759d773-e1a7-46e4-9347-cc88d35db0f0` | Failed: timeout, no snapshot | Failed: runtime listReviews method missing, obscuring earlier codex_turn_failed. Custom timeout message defect not retained. |
| Docusaurus | `d957f4b7-f286-4efd-81fc-6d0ac1e1250e` / `4779b4e5-df97-4d7f-926f-2b214ff85fe0` | Completed: repository/standards Completed; requirements/design Incomplete | Same runtime finalization failure after codex_turn_failed. CRLF Markdown defect not retained. |
| Immutable.js | `63b5941f-6daa-42fc-bb1e-fd1eb0d70e88` / `2da3c0ad-682e-450b-9865-2b97179bd94a` | Failed: timeout, no snapshot | Recovered after interruption; finalization method fix worked. Model timeout at 130 seconds; Failed/partial. Filtered negative slice defect not retained. |
| Three.js | `ec239972-c456-4747-a199-d0fcce10e631` / `0da9dac3-39db-4ba2-97ad-2986a149edf2` | Completed: repository Completed; others Incomplete | Provider responded in 14.8s with no findings; zero recognized features prevented sufficient coverage. Failed/partial. Clone material-array aliasing missed at Line/Mesh/Points. |
| Preact | `ff95471a-ec7d-464a-a4c2-01905aa85f12` / `bb2efd09-4a8d-4550-86b0-5940a3c30802` | Completed: repository/requirements/design Incomplete; standards Completed | Provider responded in 61.1s; response validation failed. Failed/partial. No validated progress-value-zero finding retained. Contents of the rejected response are not inferred. |

Completed Readiness snapshot IDs: Docusaurus `a02e4717-a507-46a1-8fcd-5e4fa1917915`, Three.js `d6c79070-c34e-4046-afb0-5d868295deed`, Preact `d04683f0-a885-4918-b068-2f7bccb13285`.

## Readiness semantics

The frozen corpus specifies seven partial assertions per case, not complete criterion-level gold. Completed snapshots agree on **20/20 applicable observed assertions**: supplied materials are not falsely wholly Missing; standards checks cite original project rules; references resolve to original sources; results do not claim whole-system correctness. Preact's conditional Repository-Completed assertion is unavailable because selected declaration files require configuration absent from the sample. Fourteen assertions remain execution-unavailable due to two timeouts. This cannot establish a calibrated five-case pass.

Requirements/design Incomplete are conservative sampled-document judgments. No confirmed requirement records or standards were added to Review scope. These runs do not validate the complete requirement-to-code mapping workflow, organizational personnel risks or whole-system security. Raw Readiness classification is not retained by production snapshots, so no raw classification accuracy is claimed.

## Acceptance

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Frozen inputs/import | Five projects, exact pinned bytes, no oracle leakage | Passed: 192 files checked before and after | Bounded source samples |
| End-to-end execution | All Readiness and Reviews successful | Failed: 3/5 Readiness, 0/5 Reviews | Provider errors/timeouts, validation and coverage failures |
| Outcome quality | Precision/recall thresholds; zero unknown claims | Failed | No retained model predictions; gold not surfaced |
| Evidence/coverage | Exact excerpts, file inspection and domain disclosure gates | Partial: reads/disclosure pass, one invalid excerpt | No supported domain assessment; zero-feature cases |
| Readiness semantics | All frozen partial assertions assessable/correct | Incomplete | Two timeouts, one configuration condition unavailable, no raw classification |

## Mitigation and verification

See [EVALUATION_FINDINGS.md](./EVALUATION_FINDINGS.md) for findings, mitigation specifications and checks. Implemented: refreshed authenticated history forwarding, strict provider schema closure, executable JS/TS debug-call checks, correct else-if depth and verbatim AST-bounded long-function evidence. These regressions passed; historical failed results were not rewritten. See [FOLLOWUP_ACCEPTANCE.md](./FOLLOWUP_ACCEPTANCE.md) for the screenshot's five checks, production retry fix and Activity retry feedback.

Open: feature extraction/batched coverage, Readiness timeout diagnosis, raw classification provenance, the selected Preact configuration limitation and context-dependent security warnings. Mitigation tests do not establish an improved live score.

## Provenance and limits

1. Preparation used the requested gpt-6.1-sol subagent at High. Its final delivery encountered an account usage limit after delivering frozen files. The parent independently checked hashes. Post-output adjudication was direct source review by the parent; no independent second reviewer agreement is claimed.
2. Actual application configuration: Codex / gpt-5.6-sol, observed in Settings. No provider substitution or fallback. Provider response completion was 2/5; accepted workflow completion was 0/5. Generic codex_turn_failed does not prove quota exhaustion or schema rejection.
3. This is a mixed-runtime diagnostic baseline: Axios/Docusaurus policy v4; Immutable.js captured v4 and recovered under repaired runtime/schema; Three.js/Preact policy review-2026-10-22-strict-output-v5. A uniform follow-up needs separately recorded attempts. These results are not a controlled before/after experiment.
4. Oracle files, controls and patches stayed outside assessed inputs. No upstream code, dependencies or benchmark tests executed. Five known issues/seven occurrences are not exhaustive defect truth, and five cases do not support a general quality claim.
5. Freeze SHA-256: db53c662e067d32c287732fa9aa2ea198b27aa2048b0ddc7a0f8b66519f2dcd6. All three frozen specification hashes and 192 input hashes rechecked after execution. Raw ledger and scores.json: ignored evidence/public-repo-outcomes-2026-10-22/run-2026-10-22T09-13-31-758Z/. Credentials remained inside existing authenticated app code. Original assessment hold restored; no further model calls scheduled.

Reproduce scoring without network/model execution:

```powershell
node docs/acceptance/PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/score.mjs evidence/public-repo-outcomes-2026-10-22/run-2026-10-22T09-13-31-758Z docs/acceptance/PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/adjudication.json
node --test docs/acceptance/PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/score.test.mjs
```
