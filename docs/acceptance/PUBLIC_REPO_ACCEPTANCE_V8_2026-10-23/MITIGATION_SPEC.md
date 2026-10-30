# Citation and batch-conflict mitigation

Status: implementation and offline verification in progress; live acceptance not achieved.

## Observed failures

The v7 Axios manual retry failed after five excerpt-mismatch repairs in its first batch. Source was supplied without individual line numbers. Each repair was a fresh provider call containing only response indexes and validation enums; it did not identify the previously rejected candidate. Strict evidence validation correctly prevented completion.

Docusaurus Readiness completed, but standards checkability merged two local passes and one local gap into a global gap. It copied a batch-local absence assertion even though the aggregate references included commands and configuration. This overstates what a partial batch can establish.

## Required behavior

1. Present frozen Review sources with explicit original line numbers, including blank lines and segmented offsets. Evidence remains an exact original source excerpt, without presentation prefixes. Do not repair fabricated quotes automatically.
2. Make repair requests actionable with bounded references derived from trusted frozen sources. Audit metadata retains safe enums/indexes only. Enforce the same context bound for initial and repair requests. Preserve all selected-source coverage and the five-attempt budget.
3. Keep contradictory non-scope Readiness batch verdicts unknown unless an existing validated cross-batch comparison resolves them. Preserve exact evidence and raw counts. Use a neutral conflict explanation rather than publishing a local absence assertion as a global fact. Unknown remains incomplete and generates an evidence-needed finding.
4. Version policies as Review `review-2026-10-23-numbered-source-coverage-v8` and Readiness `readiness-2026-10-23.3`. Preserve historical snapshots and attempts. Run all five Readiness and Review assessments under these policies; reuse project/artifact identities only.
5. Assess all five Readiness jobs before starting Reviews. Stop the evaluation batch on a failed Review to permit mitigation before further provider spending. Capacity responses still stop immediately with no retry or fallback.

## Acceptance

Synthetic tests must cover original offsets, CRLF/blank lines, context overflow, safe repair/audit separation, mixed pass/gap batches, unchanged scope/comparison guards, and unchanged single-batch behavior. Run the affected integration suite and sidecar TypeScript check, then obtain independent review before restarting the live runtime.

Live acceptance retains the original frozen thresholds: five eligible workflows, unique adjudicated precision at least .80, known issue recall at least 4/5, occurrence recall at least 6/7, exact evidence validity 1, selected code inspection at least 153/169 including every affected file, complete four-domain disclosure, all 35 partial Readiness assertions correctly supported, and no unresolved claim adjudications. No benchmark issue text, patches or expected answers enter provider requests.

Numbered citations do not establish semantic correctness. Conservative conflict handling can leave a genuine item-specific gap unknown until a cross-batch reconciliation exists. Such uncertainty must remain visible and cannot certify completeness.
