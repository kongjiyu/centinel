# Token optimization acceptance — 25 October 2026

The requested accounting, model-selection and bounded context optimizations are implemented and verified. This acceptance covers their behavior; it does not accept the separate five-repository AI outcome benchmark or promise a percentage reduction in provider-billed tokens.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Stage and phase accounting | Persist actual usage/provenance/unknown values and safe phase/source metadata; preserve usage on repair, cancellation and failure | Passed: local regressions, independent review, live two-call reconciliation to 30,745 tokens | Old missing usage is not recoverable; concurrent paged summaries are best effort |
| Source accounting | Exact frozen paths/versions, per-stage counts and deduplicated total; physical reads separate from AI context | Passed live: one unique file, two AI appearances, one physical read | Counts show supplied context and reads, not proof that a model understood every line |
| Context and embedding optimization | Remove exact duplicate retrieval text; compact only prompt metadata; reuse only compatible real vectors | Passed: all 192 files/196 segments byte-preserved, 991 feature IDs retained; initial prompt text reduced 12.9%; cache isolation regressions pass | Actual full-repository token savings unmeasured; embedding cache lacks live configured-provider acceptance |
| Model and interface | Select real models from a picker; save requested exact model; lazy Activity usage; responsive bounded scrolling | Passed: `gpt-6.1-sol` saved and used; 83 frontend tests; 1440×900, 1200×900, 390×844 visual checks | Public catalog rejects existing OAuth session; actual installed-CLI catalog fallback is labeled |
| Safety and quality boundaries | Keep exact evidence, four domains, attempt budgets, membership checks, capacity stop and historical results | Passed local safety/auth regression suites and independent review | Five-repository semantic quality remains unaccepted; fixed Codex framing remains a material cost |

## Verification evidence

- [Root-cause findings, mitigation status and next experiments](../../review/TOKEN_OPTIMIZATION_ASSESSMENT_2026-10-25.md).
- [Independent review, scoped source hashes and exact test commands](INDEPENDENT_REVIEW.md): 129 accounting/context/catalog tests, 133 safety/auth tests, and the final 83 frontend tests passed. The final pause-state regression and sidecar typecheck also passed. Overlapping reruns are not added into an artificial grand total.
- [Live model, stage, file and token reconciliation](LIVE_VERIFICATION.md). Root `pnpm --filter centinel build` passed after the final display change; Vite retains its existing large-chunk advisory.
- Root verified all 25 reviewed source hashes against the final report. The measured runtime loaded the reviewed sidecar sources before execution; subsequent changes were UI presentation and documentation only.
- Ignored device evidence: `evidence/public-repo-outcomes-2026-10-22/token-reviewed-source-hashes.json`, `token-settings-{1440,1200,390}.png`, `token-usage-stages-1440.png`, `token-usage-{1200,390}.png`, and the live Review capture directory.

On the 390-pixel viewport, the usage table's 620-pixel content stays within its 208-pixel scroll region; an actual ArrowRight key moved it by 37.6 pixels. Neither Settings nor Review Activity produced document-wide horizontal overflow. The screenshots show the real authenticated application and saved data.

## Remaining cost work

The 12,306-input-token minimal Codex test demonstrates a material fixed baseline. Its internal cause is not proven by the visible prompt. Follow the report's controlled same-model A/B plan before changing provider instructions, tools or caching controls. Whole-review authorities/documents and four-domain response prose remain candidates for further reduction only with false-omission and semantic-quality checks. The current change preserves those inputs and their evidence safeguards.
