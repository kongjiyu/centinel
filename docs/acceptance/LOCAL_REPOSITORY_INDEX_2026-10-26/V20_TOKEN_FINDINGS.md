# v20 token-cost findings and mitigation

Evidence: immutable v19 Axios terminal usage `run-2026-10-27T13-50-39-777Z/0174-optimized-usage.json`. This is a **partial** 9/22-batch execution, not a full-review price or a quality pass. Known usage is **1,031,994 tokens**, with one additional quota response lacking usage. Unknown consumption is not replaced by a measured zero. Codex account allowance is shared and has no verified fixed tokens-to-five-hour-percentage conversion.

| Phase | Calls | Known tokens | Unknown-total calls |
| --- | ---: | ---: | ---: |
| Query embedding/retrieval | 1 | 64 | 0 |
| Initial analysis | 10 | 440,157 | 1 |
| Domain repairs | 4 | 211,370 | 0 |
| Semantic-support checks | 9 | 335,856 | 0 |
| Support repair | 1 | 44,547 | 0 |
| Total | 25 | 1,031,994 | 1 |

## Findings

1. **Validated work was repeated after interruption.** Saved-source Retry preserves frozen inputs but historically reran every generation/support batch. v20 adds prospective exact-request memoization of the clean validated subset. Every hit must pass current evidence/domain/support validators, parent-retained conclusions and ancestry checks. Existing v19 partial journals cannot safely be converted. Reuse is explicit, and fresh independent Reviews remain fresh.
2. **Repair requests contributed 255,917 known tokens.** Four domain repairs and one support repair account for about 24.8% of known v19 tokens. Current schema coupling, exact repair references, safe feedback and confidence continuation address malformed/incomplete output. v20 does not change their semantic gates or prove their live repair rate improved. Track repair tokens and validated-batch yield on the new execution before claiming improvement.
3. **Support validation is a substantial separate pass.** Its 335,856 known tokens are about 32.5% of the known total. It checks whether cited code actually supports a causal claim; simply removing it could inflate false positives. v20 can reuse a fully supported record alongside the exact generation, rerun its deterministic validation, and reconstruct ordinary cross-batch conflict reconciliation. Contradicted, insufficient, uncertain and conflicting outcomes are excluded from the memo subset.
4. **Source/context repetition dominates request size.** The 24 analysis calls accumulated 1,403,241 source characters, 242,306 graph characters, and 141,145 schema characters. These components are descriptive and may overlap other prompt totals; do not sum them into provider tokens. Recorded AI context covered 35 unique files through 224 appearances (189 repeats). Independent source sweeps and business documents cannot be dropped solely to reduce this count. The native index, bounded packets and lossless graph references remain active; cache reuse removes only proven repeated requests on an eligible retry.
5. **Embedding was not the main cost in this warm run.** Document embeddings were reused, and the one query cost 64 reported tokens. Embedding the same sources again would not resolve analysis/repair cost. Measure background source-event preparation outside the Review ledger too; cold preparation is not free because a warm Review omits it.

## Evaluation rules

Report new provider calls/tokens, reused historical batches/files, physical reads, unknown counters and background preparation separately. Reused evidence is not newly sent model context. For quality coverage on future cache-bearing runs, join manifest-checked reused packet references and their origin Review with current-request evidence; retain the two provenance classes. Do not treat a cache-only child as a zero-cost whole workflow or count an ancestor's entire file inventory as reused evidence.

Keep the existing five-repository corpus, source versions, issue/occurrence recall, precision, reference validity and coverage thresholds unchanged. Adjudicate all distinct saved claims, including uncertainty flags and conditional scope. Execution failures and incomplete source sweeps fail full acceptance. The v19 partial adjudication found supported saved claims but missed the registered defect; token savings cannot compensate for that miss.

Offline v20 tests and independent review establish cache control behavior, not real provider savings or semantic equivalence. Live v20 persistence/reuse and a completed unchanged-gold assessment must still be observed.
