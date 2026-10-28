# Staged semantic mitigation — independent structural review

**Structural code review: clear at the source hashes below; no remaining blocking code finding in the reviewed v10 change. Semantic-quality acceptance remains pending.** Root's three expanded-suite failures were corrected or resolved by the isolated test environment and independently rerun here. The apply manifest still needs two corrected hash entries and two additional fixture entries. This verdict does not itself authorize applying the stage or restarting the active v9 runtime.

Scope: `evidence/public-repo-outcomes-2026-10-22/staged-semantic-mitigation-2026-10-25/`, compared with production working-tree hashes captured by `baseline-hashes.json` over commit `476a506`. Reviewed the eight changed source files, relevant tests and callers against `docs/SEMANTIC_SUPPORT_MITIGATION_2026-10-25.md`, repository instructions, and the review/test skills. This was the independent read-only review continuation requested for GPT-6.1 Sol High; the implementer changed staged code in response to feedback. The reviewer changed only review artifacts under this documentation directory.

## Findings and final dispositions

The following seven P1 findings were reported during preliminary review. Their corrected paths were reread at the final source hashes and relevant regressions passed. There is no unresolved disagreement about these fixes.

| Preliminary finding | Final disposition and evidence |
| --- | --- |
| Segmented source was passed to a full-file citation validator | Fixed: uniquely select the containing segment, validate using a local offset, then restore the original line for the batch-range check. Both multi-segment and later-segment-only references pass; boundary-spanning excerpts remain rejected. |
| A duplicate/conflicting repair could preserve a stale supported partial row | Fixed: invalid candidate IDs revoke their retained row; duplicate/ambiguous IDs stay conflicted rather than inheriting an earlier positive result. Supported unrelated siblings remain eligible. |
| Insufficiency excluded only the primary artifact from absence proof | Fixed: primary, validated related sources, support references and linked selected-map sources contribute to exclusion. The regression preserves an unaffected artifact's eligibility while excluding both involved artifacts. |
| The original public claim carried causal fields absent from the challenge | Fixed: bounded `logicFlow`, related locations, recommendation and other public candidate fields enter the challenge and opaque identity. A supported description alone no longer leaves an unchallenged causal chain attached through this omission. |
| Contradicted findings disappeared while their allegation survived in public feature summaries | Fixed: affected rows receive bounded non-clean limitations, including candidates without a precise domain/link; sanitized feature deltas are persisted before later batches. The frontend's existing `ReviewAnalysisScope` renders these summaries, so this correction matters to observable output. |
| Feature and holistic-sweep verdicts could disagree while the earlier positive remained actionable | Fixed: an exact normalized public-claim/source identity, independent of batch ID, detects disposition/boundary disagreement. Earlier positive candidates are revoked, affected sources lose absence proof, and the map retains an explicit limitation. Both verdict orders are tested. This is exact reconciliation, not an unbounded semantic merge. |
| An earlier valid contradiction in an incomplete packet could be forgotten after a successful repair | Fixed: valid per-ID observations persist across repair responses; conflicting dispositions/boundaries are withheld. Both earlier and later support-reference sets are excluded from absence proof, including a guard artifact present only in the earlier response. The unaffected supported sibling survives. |

Two additional P2 gaps were addressed: support is explicitly capped at two calls within the same total-five ledger, and safe support audits include a stable hash of validated source/authority-reference identity without storing their source excerpts or candidate descriptions.

## Final structural assessment

| feature | acceptance criteria | status | risk flags |
| --- | --- | --- | --- |
| Candidate promotion and history | Only supported complete claims enter actionable findings; preserve safe siblings; exclude affected absence proof; old proof cannot gain v10 eligibility | OFFLINE PASS | Exact-reference validation and model agreement do not establish semantic truth. Exact conflict identity does not reconcile paraphrases. Historical proof projections intentionally remain conservative. |
| Paid-call lifecycle | Generation/repairs/fallback and support/repair share the same stable batch operation and durable total-five high-water mark; generation cap three, support cap two; capacity/cancellation/context failures stop safely | OFFLINE PASS | Real provider capacity, storage failure and process-crash recovery were not exercised. Challenge uses the generation-selected configured provider, including an already-selected fallback; it adds no new fallback. |
| Evidence, authority and privacy | Exact frozen source/hash/path/range and trusted authority versions; manual confirmed records remain authority; safe bounded audit metadata and repairs | OFFLINE PASS | Authority existence and source provenance are not causal proof. No live Supabase or browser verification was performed. |
| Full source sweeps | Every selected source-code segment receives an independent empty-feature sweep; combined 128-batch/64,000-source-character preflight; sweeps add no map/absence coverage | OFFLINE PASS | Extra provider cost and context failures remain possible. Generic contract-comparison prompting is not demonstrated recall improvement or exhaustive contract pairing. |
| Application and model-quality acceptance | Refreeze correct hashes, clear required broader checks, then independently grade blinded actual configured-provider outcomes | PENDING | Active production v9 remains untouched. No actual-model improvement, public-benchmark pass, or general accuracy is claimed. |

The gate preserves the existing authenticated provider/runtime boundary and source/traceability ownership. The same configured model challenges its own candidates; this is a consistency check, not independent corroboration. Current requirement/rule records are checked by frozen identity and available versions; manual confirmed requirements do not need invented artifact-line authority. No benchmark manifest, gold issue details, expected labels or target names were found in the changed production prompt/gate paths.

## Independently executed checks

At the final reviewed code, these commands passed from the staged `sidecar` directory:

```powershell
pnpm exec tsc --noEmit
pnpm exec vitest run __tests__/unit/assessmentBatches.test.ts __tests__/unit/assessmentValidation.test.ts __tests__/unit/sourcePrompt.test.ts __tests__/unit/staticReviewOrchestrator.test.ts __tests__/unit/supabaseReviewRepository.test.ts __tests__/unit/findingReconciliation.test.ts __tests__/unit/projectCorrelation.test.ts __tests__/unit/phase2Correlation.test.ts __tests__/unit/reviewHarness.test.ts __tests__/unit/reviewRetry.test.ts
```

Final independent core rerun: **223/223 tests, 10/10 files; TypeScript passed** (25 October, 14:58 Makassar). Earlier failures were not represented as passes: the initial focused run had one stale support-call-count expectation, and root later reported three failures in an expanded 19-suite run.

The two root fixture changes were subsequently inspected: current-project risk now uses the current validation-version constant for current-proof success and explicitly retains historical risk for the older version; iteration success uses a 20,000-token parent budget while a separate 1,000-token test asserts failure before any provider call or reservation. This preserves the full-context ceiling rather than weakening production validation. The isolated auth tests require configuration to create their injected storage test double; supplying shell-only fake `SUPABASE_URL=https://supabase.invalid` and `SUPABASE_ANON_KEY=test-anon-key` changes no runtime file or credentials.

Independently ran `pnpm exec vitest run __tests__/unit/currentProjectRisk.test.ts __tests__/unit/phase2ReviewIteration.test.ts __tests__/integration/activeHttpAuth.test.ts` under that fake shell environment: **43/43 tests, 3/3 files passed** at 15:00 Makassar. Independent total: **266 tests across 13 files**, plus TypeScript. Root reported the broader 19-suite result as **320/320 passed**; this reviewer did not rerun that entire expanded command. The eight reviewed source hashes remained unchanged through these follow-ups.

Additional independent offline probes verified whole-source reconstruction, combined batch-limit failure before any provider boundary, and a simulated recovered high-water mark of two producing new attempt numbers **3, 4, 5** on the same real planned batch stage. The public-summary, cross-batch and repair-conflict failure cases were reproduced before remediation. These probes and fake-provider tests establish control flow and validation plumbing only.

No live app/provider calls, upstream code/tests, dependency installation, production mutation, active-run restart or benchmark-input change was performed by this review. The auth suite used its local test server/doubles. Product visual checks, the full sidecar suite and actual-model blinded evaluations were not run here.

## Reviewed hashes and application blocker

All **378 captured production baseline files** still match. The reviewed test/source inventory and exact thirteen executed test-file hashes are saved in `STAGED_MITIGATION_REVIEW_HASHES_2026-10-25.json`, SHA-256 `a2fafa0a660f44183637a8de1bce1988b7a53eafb29fee42d3cb18e0a8a1a8b5`. The baseline manifest SHA-256 is `b169124aac50efc34ca949bda320a50636010c4faf6d2bc4854cddfe6106c02c`.

The currently inspected `APPLY_MANIFEST.md` SHA-256 is `be109662194e321c7ad923b0381f69f71d717b6be8a1aa41049638ad58ceeca0`. It predates the final both-reference fix: its orchestrator entry must become `e2bd80890121ac8c8f8689bf1a1356b83cb7efb1aa5e3a8377f43e07c4160fb7`, its assessment-validation test entry must become `cc0c0b8060de3408469c269b8f9da04c2445f11395a346f50da1fa829c0d69e8`, and its core test count must become 223. Add the reviewed `currentProjectRisk.test.ts` hash `7643b037ad6393143eef1f208abc83a61c3e27116684a14a27fe71f04a8ed35d` and `phase2ReviewIteration.test.ts` hash `7ce8f0cf5343bb8521a320c941fc2d55870e96ead9a237582e77d2b57604f492` with their captured production baselines and root's updated verification. **Do not apply using the stale manifest.**

| Reviewed staged source | SHA-256 |
| --- | --- |
| `sidecar/src/review/assessmentBatches.ts` | `35dd093530a187e81eecae06bbb03df87aaa25fb0c4e7400da76f79de755c287` |
| `sidecar/src/review/assessmentValidation.ts` | `be68aff9ede772ae18a52224cc13b29b937f7ae1cb77258546c5555987a0bb0f` |
| `sidecar/src/review/correlation.ts` | `8429b3c74f6f5bf602ce4d6a75f9441603d98d2e3cf63e4fd692d023efe665a4` |
| `sidecar/src/review/findingReconciliation.ts` | `fcc895118d3c93a2df3896f2e7eed5fb96331dd63167592f6f1a4bb734c56e4b` |
| `sidecar/src/review/harness.ts` | `308ab91be7afc609a835234beda3c470d5c039cd2195250f2928b4387d101570` |
| `sidecar/src/review/orchestrator.ts` | `e2bd80890121ac8c8f8689bf1a1356b83cb7efb1aa5e3a8377f43e07c4160fb7` |
| `sidecar/src/review/sourcePrompt.ts` | `ac0b19427bea4632c15bc167479daa7b942b64637bef8a505c57139f2d3d71a8` |
| `sidecar/src/review/supabaseRepository.ts` | `2c2dbc69a46ca23d780594111a1df1f249ef629783acfe06aef8d55f532498a2` |
