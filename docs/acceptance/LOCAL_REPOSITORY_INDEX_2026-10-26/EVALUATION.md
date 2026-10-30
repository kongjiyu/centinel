# Local repository index comparison

Status: acceptance plan prepared before the new full Axios run. No live optimization result or quality pass is claimed here. The JSON comparator is read-only and reports only the supplied normalized counts, hashes, enums and independent judgments.

## Scope and frozen Axios gold

Compare one new full Axios Review using the repository index with the previously completed 52-file Axios Review. The project is `3c66cb23-9805-471d-97e6-719182787d94`; the frozen SWE-bench case is `axios__axios-4738`, pinned to commit `9bb016f95e6de871a44f3276fd06562704a0abb0` and benchmark revision `846e647b9f33c0b51b739d005d13d85493c9af09`.

The single registered Axios gold issue is `node-timeout-custom-message` (1 issue, 1 occurrence). A valid hit identifies the Node HTTP timeout callback, its failure to use `config.timeoutErrorMessage`, and the incorrect emitted message, with exact frozen-source evidence. A generic timeout warning is insufficient. The negative control is part of the same gold judgment: default timeout behavior and error code stay valid, and XHR already honors the configured message. The registered affected file/range is `lib/adapters/http.js:421–430`; the contrast is `lib/adapters/xhr.js:127–137`, and the option declaration is in `index.d.ts:137`.

Keep the expected finding, exact gold ranges, independent match decisions, and severity review out of the imported repository tree, index snapshot, and model requests. Evaluate context coverage after the run from safe request-context metadata. The gold source ranges are evaluator references only.

The existing frozen sources of truth are [manifest.json](../PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/manifest.json), [ACCEPTANCE.md](../PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/ACCEPTANCE.md), and [independent Axios adjudication](../PUBLIC_REPO_ACCEPTANCE_V9_RESUME_2026-10-24/review-axios-adjudication.json) plus [verification](../PUBLIC_REPO_ACCEPTANCE_V9_RESUME_2026-10-24/review-axios-verification.json). Do not edit those historical files or their thresholds.

## Historical comparison baseline

The baseline is Review `4cf606de-7bc7-482d-aee2-8df0f3cbdb97` in `evidence/public-repo-outcomes-2026-10-22/run-2026-10-24T15-46-37-089Z/`. It completed its model workflow with status `pending_approval`, using `codex/gpt-5.6-sol` and policy `review-2026-10-24-batch-domain-coverage-v9`.

| Baseline measure | Frozen observation |
| --- | ---: |
| Selected files / selected JS and TS files | 52 / 48 |
| Successful Review calls | 20 |
| Reported Review input / output / combined tokens | 873,802 / 99,619 / 973,421 |
| Independently adjudicated unique predictions | 25 true / 1 false / 5 unknown; 0 unadjudicated |
| Resolved precision; conservative interval lower bound | 25/26 = 96.15%; 25/31 = 80.65% |
| Exact source references | 656/656 valid |
| Selected code inspection | 48/48; the registered gold file was inspected |
| Feature/domain rows | 588/588 disclosed and validated; 359/588 supported-claim coverage |
| Registered Axios gold | 0/1 issue and 0/1 occurrence |
| Packet requests / file appearances | 20 / 142 |

This is a completed usage baseline, not an accepted semantic baseline. Its five unknown claims and missed gold issue remain acceptance failures. The old report has 100% citation validity, but a valid citation did not guarantee a supported conclusion. Its exact prompt-range coverage was not retained; path inspection and file appearances must not be presented as exact source-range coverage.

The single-file control `e593fa27-1e10-4ebc-a127-05a32693a014` used `gpt-6.1-sol` and recorded 30,745 tokens in two calls for `lib/helpers/isAbsoluteURL.js`. It is an accounting/context control only. It is not a full-repository baseline and must not be divided, multiplied, or extrapolated into an Axios-wide saving.

The frozen Axios manifest has no severity field for its registered issue. Report the severity inventory as unavailable unless it is independently classified. Requiring all 1/1 eligible registered Axios gold issues and the 1/1 occurrence to be detected already covers every gold issue in this bounded case; do not infer its severity. Do not claim whole-system high/critical recall from this one case.

## Freeze before the candidate run

Preserve the same 52 source files, their selected versions and byte hashes, the source commit, and the registered Axios case. Record the full normalized artifact-manifest hash and independently verify all 52 file hashes before and after the Review. The baseline fixture’s `source.manifestSha256` is SHA-256 of UTF-8 JSON for the 52 rows `{path, versionId, contentHash}`, with backslashes changed to `/`, rows sorted by code-unit path order, and keys emitted in that order. Its value is `669a3ea464b6c3184f87dc29526db66e587c9226e754c4e69b56937bbdf99c64`.

Record the authority snapshot as exact requirement, standard, and mapping version IDs plus a hash. The historical run had no traceability records; its normalized empty authority set is `{requirements:[],standards:[],mappings:[]}` with SHA-256 `29b39ac0614e13edc2fc0c40485d3e38129c5137bd531c2873fd2af97f8ed8df`. Keep the four review domains fixed. Record a hash of custom review instructions; the baseline hash is `8769b0b5fb7457fcfa6b38eb1c75495d904ece014831c9edecccf5b957e58390`. Hashes are for comparison only; never copy prompt text into this package.

Before model execution, capture provider, exact model ID, model authority/authentication mode as a safe enum, reasoning effort, policy, engine/runtime manifest, and local-index package/model/dimensions/strategy versions. The historical capture did not record model authority or reasoning effort, so those dimensions are unavailable for that baseline. The baseline uses `gpt-5.6-sol` and policy v9. A candidate using another model (for example `gpt-6.1-sol`) or policy is confounded. The comparator will still show the observed metrics, but its efficiency attribution must be descriptive only. Missing historical settings also prevent an isolated causal claim even if the visible model and policy happen to match.

Do not change model, policy, source or authority after seeing outcomes to improve the comparison. The retrieval/index path is the intended intervention; record its cold build, warm reuse or restore mode separately. Keep current source/index/runtime artifacts intact after the Review.

## Acceptance gates fixed before results

Use the existing frozen thresholds exactly. The five-project benchmark acceptance remains 5/5 completed cases, unique precision at least 0.80, issue recall at least 0.80 over the fixed 5 issues, occurrence recall at least 0.80 over the fixed 7 occurrences, reference validity 1.00, selected code inspection at least 0.90 with all gold-affected files inspected, domain row completeness 1.00, zero execution failures, zero unadjudicated predictions, and zero unsupported or abstained gold cases. This one-project Axios comparison cannot pass or replace that five-project acceptance. Report its bounded case denominator as 1 issue / 1 occurrence; the frozen 0.80 threshold on a single eligible Axios issue requires 1/1 to meet the threshold.

| Gate | Required result for this Axios case | Failure handling |
| --- | --- | --- |
| Frozen context | Same pinned source manifest and authority snapshot; all selected source sweeps complete; at least 90% of 48 selected code files inspected; the registered gold file inspected; all inferred feature/domain rows disclosed and validated; local index source manifest and compatibility verified | Source/authority mismatch or failed/partial execution cannot pass. Changed model, model authority, instructions, reasoning, runtime or policy is listed as a confound. |
| Findings quality | Independently adjudicate every unique prediction; precision at least 0.80; the eligible Axios issue and occurrence each hit (1/1) | Undefined precision fails. Unknown or unadjudicated predictions stay counted and block semantic pass. A gold miss is a false negative, not an excluded case. |
| Evidence accuracy | Exact frozen-source references are 100% valid; adjudicate causal support separately from citation validity; report supported, contradicted and unresolved claims | Invalid reference fails. Unsupported, contradicted and unknown consequences cannot be promoted or counted as clean negatives. |
| Completeness and coverage | Review reaches complete finalization; 52 source sweeps; at least 90% code inspection; 100% validated feature/domain disclosure; report supported assessment coverage, retrieval file/chunk/range coverage, explicit unresolved boundaries and limitations | Partial, failed or unknown completion is not semantic pass. Explicit runtime/dependency boundaries are limitations, not automatic failures, if they remain disclosed and do not acquire clean absence proof. |
| Efficiency | Report Review model usage and document/query embedding usage separately, by stage, with exact complete-run totals, call counts, cache subset and safe source provenance | Unknown or partial provider usage stays unknown, never zero. No complete-run delta or reduction claim for partial runs. Characters and adapter estimates remain separate from provider-reported tokens. |

The comparator reports resolved precision and its conservative/optimistic bounds, gold issue/occurrence recall, reference validity, source/domain coverage, supported-claim coverage and retrieval context counts. An unknown unique prediction blocks semantic pass even when the resolved precision exceeds 0.80. Zero predictions make precision undefined and fail the gate. Do not block on explicitly disclosed external/runtime map boundaries alone; do block if an unknown claim, missing required metric, failed execution, missing gold result or precision-undefined condition remains.

An all-gold hit establishes retention for the registered Axios gold set only. Severity inventory is reported separately when absent; it is not used to invent a high/critical label or to claim coverage beyond this bounded set.

## Safe normalized summaries and comparator

The pure comparator is [compare.mjs](./compare.mjs); its synthetic behavior cases are [compare.test.mjs](./compare.test.mjs). The frozen historical baseline summary is [axios-52-file-baseline.json](./fixtures/axios-52-file-baseline.json). The summary schema is `centinel-local-index-evaluation-run-v1` and carries only safe enums, IDs, counts and hashes. Build a candidate `comparison-input.json` after independent adjudication from the saved run artifacts; do not feed gold labels into production or derive candidate quality from implementation tests.

The JSON shape is deliberately small so the runner can build it from durable evidence without passing raw artifacts to the comparator:

| Input key | Required safe contents |
| --- | --- |
| `execution` | UUID review ID; allowlisted execution, model and workflow states |
| `freeze.source` | Repository commit, benchmark revision, 52-row manifest SHA-256, selected/code file counts |
| `freeze.authority` | Exact normalized authority SHA-256 and requirement/standard/mapping counts; this case uses the frozen empty-set hash above |
| `freeze.model`, `freeze.policyVersion`, `freeze.instructionsSha256`, `freeze.runtimeManifestSha256`, `freeze.reviewDomains` | Safe provider/model/authority/reasoning enums and IDs, policy/hash provenance, and the exact four fixed domains |
| `retrieval` | `mode` (`cold_build`, `warm_reuse`, or `restored`), package and strategy versions, indexed source-manifest SHA-256, `compatibilityVerified: true`, plus embedding model/dimensions when used |
| `usage.review`, `usage.embedding` | Request counts, provider-reported token totals, unknown-request counts, safe stage aggregates and cache subsets; estimates contain character counts only |
| `coverage.selectedSource`, `coverage.featureDomains`, `coverage.retrieval` | Imported/swept/inspected files, domain-row totals, explicit unverified-boundary count, packet/file/chunk/character counts, and independently reconstructed gold-range counts |
| `adjudication.predictions` | Independent aggregate unique-prediction counts (`true`, `false`, `unknown`, `unadjudicated`) |
| `adjudication.references`, `adjudication.gold` | Independently verified citation counts and the exact registered gold issue/occurrence outcomes; severity inventory is optional and unavailable for the historical Axios manifest |

The candidate must carry explicit index provenance and compatibility verification; a disabled index cannot pass the candidate gate. Missing required provenance stays `unknown`. The historical baseline serves as the no-index control and remains semantically unaccepted. Only allowlisted enums, IDs, hashes, and numeric counts are copied into output. No prompts, source bodies, excerpts, API keys, access tokens, arbitrary status strings, free-text failure messages, or private model reasoning belong in the summary or comparator result.

Run the test fixtures with:

```powershell
node --test docs/acceptance/LOCAL_REPOSITORY_INDEX_2026-10-26/compare.test.mjs
```

After the independent Axios review/adjudication is complete, compare the fixed baseline with the safe candidate summary:

```powershell
node docs/acceptance/LOCAL_REPOSITORY_INDEX_2026-10-26/compare.mjs `
  docs/acceptance/LOCAL_REPOSITORY_INDEX_2026-10-26/fixtures/axios-52-file-baseline.json `
  evidence/local-repository-index-2026-10-26/run-<review-id>/comparison-input.json
```

The script emits JSON to stdout and writes no files. Save that output as `comparison-result.json` only as part of the evaluation evidence package. `semanticStatus` is `fail`, `unknown`, or `pass`: partial/failed execution, unresolved predictions, an undefined precision, a missing/unknown registered gold result, invalid references, or missing required coverage cannot pass. Unknown usage disables a usage delta; unknown context counts disable context comparison. A complete candidate may have a case-level semantic result even when the historical comparison is confounded; the comparison remains `descriptive-only` and cannot attribute observed savings to the index.

The report keeps provider-reported model tokens, provider-reported document/query embedding tokens, cache subsets, adapter arithmetic and character estimates separate. Cache reads are already included in input; never add them again. A combined token count is a raw resource count, not a price. An absent cache/usage field is unknown, not zero. For cold runs include document indexing and query embedding; for warm reuse document tokens may be zero only when verified no document requests occurred, while query requests still count. Report index build overhead separately from the Review total.

## Cache scenarios

1. **Cold build:** record provider-reported document embedding requests/tokens, query embedding requests/tokens and Review model totals. Include indexing overhead in combined run usage. No fallback or capacity retry.
2. **Same-device warm reuse:** require exact source manifest, model, dimensions and index policy compatibility. Verify the local snapshot was actually reused without document embedding calls. Record every query embedding request/usage.
3. **Fresh-device/member restore:** use a separate empty cache root and member-scoped Supabase session; verify snapshot checksums, source/config compatibility and selected-source locations before retrieval. Do not delete the original cache or production data. Same-owner isolated restore proves relocation mechanics only; do not claim cross-member verification without a real second member session.

The index is a relevance aid. Keep canonical frozen sources, original line numbers, requirement authority, independent findings evidence and immutable review history. Compacted descriptions cannot replace evidence or widen a claim.

## Evidence package and known artifact locations

Keep the baseline unchanged. Its primary live artifacts are in `evidence/public-repo-outcomes-2026-10-22/run-2026-10-24T15-46-37-089Z/`: `0050-review-session.json`, `0051-review-findings.json`, `0052-review-manifest.json`, `0053-review-traceability.json`, `0054-review-evidence.json`, and `0055-review-harness.json`. The independent scoring and usage reports are `docs/acceptance/PUBLIC_REPO_ACCEPTANCE_V9_RESUME_2026-10-24/review-axios-adjudication.json`, `review-axios-verification.json`, `TOKEN_USAGE_2026-10-25.md`, and `TOKEN_USAGE_BY_STAGE_2026-10-25.md`.

For the new run, preserve its session/findings/manifest/traceability/evidence/harness events, all-scope Review usage, local index compatibility/provenance, provider-reported embedding usage, runtime-code manifest, exact source hash verification, independent adjudication and verification, `comparison-input.json`, and `comparison-result.json` under the new ignored path `evidence/local-repository-index-2026-10-26/run-<review-id>/`. Record the actual path and review IDs in the run report. If the run fails, preserve its partial evidence and keep its status failed/partial; do not normalize it into a clean comparison.

No optimized result exists in this plan. The old baseline's missing prompt-range inventory, missing model-authority/reasoning metadata, old model and v9 policy must remain visible as limits/confounds. Do not rewrite historical reports, source gold, adjudication thresholds, or partial-run outcomes after seeing the candidate.
