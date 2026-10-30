# Review activity and narrative acceptance

## Scope and QA inventory

User request: replace the empty completed Activity view with an explanation of the saved review; present each objective sentence as a point; summarize the overall outcome, blockers, and next action. Identify the source or feature, review aspect, rule, evidence, and recommended action where recorded.

The presentation uses authenticated saved harness events and findings. It does not generate or reveal private model reasoning, fabricate missing checks, or rerun a review. Objective formatting preserves the authored rules and decisions; it does not invent requirement mappings.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Objective | Authored instructions appear as semantic sentence-level bullets; source paths and rule references survive formatting. Expanded objective uses the same points. | Pass | Ambiguous or absent business rules still need author clarification. |
| Summary | Separately explains overall result, recorded activity totals, execution/evidence blockers, and next action; execution, approval and finding disposition remain distinct. | Pass | Missing findings or model results are reported as gaps. |
| Activity | Modern flat progress records load the saved harness; phases explain purpose and recorded outcome. Source reads, hash checks and rule checks show recorded evidence. | Pass, including actual n8n desktop review | Older runs can have no detailed history; disclose that gap and retain findings. |
| Review aspects | Source-rule checks and finding assessments show Security, Business rules, or Technical, derived from the recorded rule/category. | Pass | Category-based labels do not establish complete aspect coverage or feature acceptance. |
| Evidence controls | Source and check disclosures, finding evidence/action disclosures, tabs and objective expansion remain operable. Decision controls preserve lifecycle restrictions. | Pass | No live decisions submitted during QA. |
| Off-happy paths | Failed/interrupted/running runs, requested changes, missing history, mismatched review traces and findings-load errors remain explicit. | Pass | Do not infer completion from absent events. |
| Responsive UI | Inspect Overview and Activity at 1440×900, 1200×900, and 390×844; long paths wrap and scoped styles do not affect other screens. | Pass | Narrow screens require more vertical scrolling. |

## Verification

- Production frontend build: passed (`pnpm --filter centinel build`). Vite retains its existing bundle-size warning.
- Review tests: **43 passed**, five files: `reviewNarrative`, `ReviewActivityScreen`, `ReviewProgressView`, `reviewViewModel`, `reviewHarness`.
- Expanded check of `ArtifactsPanel`: **7 passed, 1 failed**. Its existing load-error test expects “Sources could not be loaded”; the already-modified source panel returns “Files could not be refreshed.” This assertion mismatch is independent of the narrative change and remains unresolved to preserve the separate source-panel work. The only source-panel edit for this task safely defaults optional `attemptCount` to zero to unblock TypeScript compilation.
- Browser QA uses intercepted synthetic auth/API fixtures, with **zero API writes** and **zero page errors**. Verified all three widths, objective expansion/Escape, tabs, source/rule disclosures, finding evidence/action disclosure, unavailable history with findings retained, and failed summary with approval absent. Measured no horizontal overflow in the review screen. Styles are prefixed by `.review-activity-screen`; Home has none of the new narrative elements.
- Actual desktop check: read Centinel's accessibility tree without activating its window or sending desktop input. Review `558cc99b` now exposes five completed source reads and matching hashes, 61 completed source-rule checks, one successful model attempt, all five phases, and 12 saved finding assessments. This verifies that the existing n8n run can populate Activity without rerunning it.
- Direct review found no blocking issue in this change's correctness, regression, security or usability scope. Private legacy thoughts and arbitrary harness metadata are excluded by construction and regression-tested. This is not an acceptance verdict for n8n itself; its business-rule coverage still needs confirmed requirements.

Screenshots: [`evidence/review-narrative-2026-10-18/`](../../evidence/review-narrative-2026-10-18/) contains Overview and Activity at all three widths, rule and finding details, unavailable-history fallback and failed-summary captures. These generated local artifacts are not source files. The fixture is `scripts/review-narrative-qa-fixture.mjs`, layered over the existing connection fixture.
