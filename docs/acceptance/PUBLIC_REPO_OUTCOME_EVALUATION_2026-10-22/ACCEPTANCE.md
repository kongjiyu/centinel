# Public repository outcome evaluation — frozen before production inference

This is a five-project, bounded-source smoke evaluation. It cannot certify whole repositories, general model accuracy, security absence, or exhaustive defect recall. `manifest.json` contains the exact pins, source selection, behavioral gold, controls and Readiness judgments. `input-files.json` contains original Git blob and SHA-256 provenance. Keep this entire documentation directory and the separate oracle evidence outside app imports and prompts.

## Inputs and provenance

All five cases occur in the official [SWE-bench Multilingual dataset](https://huggingface.co/datasets/SWE-bench/SWE-bench_Multilingual/tree/846e647b9f33c0b51b739d005d13d85493c9af09). The [official benchmark description](https://www.swebench.com/multilingual) explains the real issue/PR construction and fail-to-pass/pass-to-pass tests. This evaluation uses its source snapshots and independently checks the bug mechanism; it does **not** claim benchmark test execution.

| Selected project | Pinned pre-fix revision | Selected files | Gold issue / affected occurrences |
| --- | --- | ---: | ---: |
| [Axios](https://github.com/axios/axios) | `9bb016f95e6de871a44f3276fd06562704a0abb0` | 52 | 1 / 1 |
| [Docusaurus](https://github.com/facebook/docusaurus) | `0589b1475d56b0b541348aa56f201ec7c56c56d5` | 29 | 1 / 1 |
| [Immutable.js](https://github.com/immutable-js/immutable-js) | `493afba6ec17d9c999dc5a15ac80c71c6bdba1c3` | 80 | 1 / 1 |
| [Three.js](https://github.com/mrdoob/three.js) | `8d9f8d50b923d5f8a673590ae138bc5d86a3a256` | 10 | 1 / 3 |
| [Preact](https://github.com/preactjs/preact) | `b17a932342bfdeeaf1dc0fbe4f436c83e258d6c8` | 21 | 1 / 1 |

The selected inputs total 192 files. Original staging contains 198 files / 673,479 bytes. Five extensionless LICENSE files and Docusaurus's extensionless `.prettierrc` are intentionally excluded from the assessed copies because the current local importer skips them. Original files remain in `evidence/public-repo-outcomes-2026-10-22/inputs/<instance_id>/`. No selected path was renamed or altered. All projects use MIT licensing; preserve the original notices with the external staged copies.

Use only the absolute `inputDirectory` from each manifest case, under `evidence/public-repo-outcomes-2026-10-22/assessed-inputs/<alias>/`. Keep project names neutral. Use the same `genericProjectDescription` from the manifest for all five. Do not import benchmark issue text, test patches, patches, grading labels, this spec, or source manifests. An upstream README's external links are references, not imported evidence; do not follow them silently during grading. Do not install dependencies or execute repository code.

Axios includes `lib/` and API types; Preact includes core `src/`; Immutable.js includes `src/`; Docusaurus includes the utils package source excluding tests; Three.js includes Object3D, Line, Mesh, Points, Material and constants. Original README/contribution/configuration material accompanies the selected modules where available. These are bounded samples; omitted addons, packages, dependencies, renderers and runtime paths remain outside coverage.

## Frozen Review expectations

| Case | Required behavioral finding | Controls / overclaim to reject |
| --- | --- | --- |
| Axios | Node HTTP timeout callback ignores the configured custom timeout message and emits hard-coded duration text. | Default timeout messages and error codes remain valid; XHR already honors the custom message. |
| Preact | Progress value 0 can skip its required attribute write because the DOM property already equals zero, leaving indeterminate progress. | Do not claim all numeric zero children or all controlled input values are broken. |
| Immutable.js | Filtered sequence of unknown size resolves negative slice bounds incorrectly: ToInt32 makes the NaN guard ineffective; the last-two example returns all elements. | Positive bounds and known-size ranges are distinct controls; do not claim mutation of immutable inputs. |
| Docusaurus | Bare-LF fence extraction regexes fail to unwrap CRLF MDX escape blocks. | LF works; three/four-backtick support is intentional. Do not generalize to all Markdown or all fence lengths. |
| Three.js | Clone/copy aliases the material array container for Line, Mesh and Points; editing a clone's list affects the original. | Sharing individual Material objects is intended. Unconditional deep-clone advice contradicts the issue. |

Matching is behavioral, not title-string matching. A hit needs an affected frozen file, accurate trigger, cause and observable consequence, plus exact valid source evidence. Severity need not match a predetermined number. A generic warning or wrong mechanism is not a hit. The manifest records exact source locations and upstream issue/PR URLs. Three.js issue recall credits one valid occurrence; occurrence recall requires separate coverage of all three affected classes. Immutable.js uses two supporting files for one occurrence, not two independent issues.

All five minimum findings are Technical. A supported additional Business or Personnel interpretation may be valid, but duplicate domains do not multiply the issue numerator. There is no exhaustive negative gold for Security, Business or Personnel. An N/A or no-finding row proves neither absence nor safety.

Separate `control-inputs/<alias>/` copies apply only each official production fix patch to the selected base files. The seven changed files exactly equal their corresponding upstream merge file bytes. These controls contain natural official code comments, including issue references in some fixes; they are therefore less blind and must be identified as paired controls. They are optional separate runs and must never replace the five baseline runs or inflate baseline denominators. The known issue should disappear after its fix; this does not make unrelated findings false. Held-out regression test patches and all benchmark rows remain under `oracle/`; no tests have been run.

## Frozen Readiness expectations and limits

Readiness evaluates documentation sufficiency and selected repository availability, separately from code correctness or Review risk. A real code defect is not automatically a Readiness finding. Artifact extension/type labels do not prove semantic categories.

For each case, the scored assertions are: repository Completed **only if** all selected expected files are readable and applicable original configuration is parseable; requirements content present rather than wholly Missing; design content present rather than wholly Missing; standards content present rather than wholly Missing; applicable/checkable standards have original rule evidence; no invented requirement/design document; no whole-repository or bug-free certification. Compare category presence with raw classification where available; a downgraded effective result cannot hide a wrong raw classification.

These presence judgments follow actual material: READMEs contain product/API intentions and examples, source comments and contributor descriptions assign responsibilities and decisions, and linter/editor configurations prescribe checkable rules. Preact's contribution guide explicitly explains the core/addon layout and options hooks. Immutable.js explicitly describes immutable/persistent behavior, structural sharing and lazy sequences. Docusaurus's parsing comments separate server-side metadata utility responsibilities from the MDX loader. Three.js describes scene construction but leaves “easy” and “lightweight” without measurable thresholds. Axios documents request configuration and error handling but does not supply a complete cross-adapter contract.

Conservative pre-run expectations are Requirements Incomplete and Design Incomplete; standards may be Incomplete or Completed depending on supported scope/conflict evidence. **Those category-state expectations are partial independent judgments, not exhaustive criterion gold.** Do not auto-fail a different state without independently adjudicating its exact sources. Do not compute or claim a full 16-criterion Readiness semantic accuracy score from this dataset. Missing exception/coverage evidence must remain Unknown or an exact source-backed gap, never invented content. A source-backed conflicting outcome is a recorded adjudication case; preserve this frozen judgment rather than rewriting it to match the model.

## Numerical acceptance and denominators

| Measure | Definition | Threshold |
| --- | --- | --- |
| Execution eligibility | Five baseline projects have successful import, Readiness and Review; no unresolved pause, partial import, malformed response, validation failure or missing result | 5/5; failures remain failed acceptance, never semantic Missing |
| Review precision | Independently adjudicated true unique predictions / (true + false unique predictions), across all returned Review findings; deduplicate only same cause/behavior | >= 0.80; every prediction adjudicated |
| Known issue recall | Matched pre-registered issue IDs / five known issues, regardless of extra findings | >= 0.80, at least 4/5; all five eligible |
| Known occurrence recall | Matched registered affected occurrences / seven, with Three.js counted three times | >= 0.80, at least 6/7 |
| Evidence validity | Valid exact frozen-source references / all references asserted by findings and assessed outcomes | 1.00; all references sampled exhaustively, not just gold hits |
| Selected code inspection coverage | Unique selected imported JS/TS files with explicit successful production inspection evidence / 169 selected JS/TS files | >= 0.90, at least 153/169; every gold affected file inspected |
| Domain record completeness | Valid explicit assessed/unverified rows / all inferred feature × four-domain pairs in the frozen pre-provider map | 1.00; unverified rows satisfy disclosure only |
| Readiness partial gold agreement | Satisfied eligible frozen scored assertions / all eligible frozen scored assertions across five projects | 1.00; report exact count and raw/effective outcomes separately |

No predictions makes precision undefined, not 100%. Additional valid issues count as true positives after independent source-based adjudication even if absent from the benchmark. Unsupported or unresolved predictions are Unknown: retain their count, exclude them from the provisional adjudicated precision denominator, and prohibit overall acceptance until resolved. Provide a precision interval as TP/(TP+FP+Unknown) through (TP+Unknown)/(TP+FP+Unknown). Split bundled claims where independently falsifiable; duplicate occurrences do not inflate unique precision. Gold misses remain false negatives even if an unsupported/abstained run would otherwise shrink the semantic denominator. Report completed-eligible recall additionally, without replacing the fixed 5/7 acceptance denominators.

Maintain two coverage measures: execution/disclosure coverage and **supported assessment claim coverage**. Claim coverage counts only successfully validated assessed feature/domain rows, excluding N/A, unsupported and unverified rows, over all pre-provider inferred pairs; report it with its exact denominator and no safety inference. Neither measure is whole-program coverage. The 90% file threshold is a selected-sample execution measure and cannot substitute for feature/domain claims. If production evidence cannot establish per-file inspection, mark coverage Unverified and overall acceptance Pending; merely importing a file does not prove it was assessed.

An independent adjudicator must inspect each new prediction against the frozen source, trace relevant local calls, state trigger/consequence and record a verdict with exact lines. Use upstream issue/patch/tests as supporting truth for registered cases only. Runtime-dependent allegations remain Unknown without authorized reproduction. Do not infer false positives merely from absence in the official patch. Record evidence validity and behavioral correctness separately: an exact quote can still support a wrong conclusion. No code/dependency execution has been authorized in this research task.

## Verification and run record

Pre-run verification: all original staged bytes match Git tree blob IDs and recorded lengths; 169 selected JavaScript/TypeScript source/config files parse without diagnostics under the workspace's trusted TypeScript 5.9.3 parser; seven patched control files match upstream official merge bytes. No repository code, dependency install, regression suite, production model call or project mutation was executed by the research agent. Historical repository vulnerabilities, benchmark contamination and the small hand-selected sample remain residual risks.

Production execution must record each project/import/review/readiness ID, actual imported manifest, source version/hash, policy/model/provider, start/end/status, safe failure codes, raw/effective Readiness results, Review findings, map/assessment rows and citations. Verify the frozen hash before execution. Stop on capacity/pause failures without retries or fallback. Preserve partial runs unchanged. No acceptance claim until all above thresholds are assessable and met, with all unknowns adjudicated. Store results outside the immutable specification and oracle; do not edit frozen labels after seeing results.

The executable evidence preparation scripts live outside app inputs under `evidence/public-repo-outcomes-2026-10-22/`; they use standard-library HTTPS, byte verification and trusted parser APIs only. These scripts are provenance, not commands to rerun after freeze. The operative source selection is the already staged manifest, not a current GitHub branch.
