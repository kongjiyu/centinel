# AI readiness and Review quality assessment — 22 October 2026

Follow-up: [findings, mitigation specification and implementation acceptance](AI_QUALITY_MITIGATION_2026-10-22.md). This historical run and its original gold remain unchanged; the revised benchmark has not completed live acceptance.

## Authorization and scope

The user requested live AI assessment of readiness quality/accuracy and Review completeness/accuracy. Run the production model adapter and engines against frozen fictional sources; do not change live projects, approve Reviews, disposition findings, change providers, or publish results. Use the existing Centinel-managed signed-in Codex account and its advertised default model, `gpt-5.6-sol`. Provider preflight confirmed available/connected without exporting credentials.

The root installation hold remains `CENTINEL_AI_ASSESSMENT_PAUSED=1`. The evaluation shell alone sets the flag to `0`, so unrelated project jobs remain held. A capacity failure stops the batch; no automatic retry or provider/model fallback is permitted. This is semantic fixture acceptance, not authenticated persistence/native UI or exhaustive program/security certification.

## Frozen acceptance criteria

1. **Readiness:** all 11 existing labelled cases under `readiness-2026-10-20.5`; corpus SHA-256 `73d15fd9b080e72234da351d0134ae612745bc4bc4393ff3f0522b33f97048f1`. Compare category presence/states, every criterion verdict, scope coverage, evidence validity, and model/engine agreement. Alternative valid quotations are diagnostic differences, not semantic errors. Preserve the prior report before execution. Gold expectations remain unchanged.
2. **Review:** three cases using the production orchestrator, real configured model adapter, frozen source versions and production assessment validation. Four known defects span security (invoice owner check), business (discount ignored), technical (memory changes after failed persistence), and personnel (declined destructive action/recovery ignored). Corrected code and corrected code with an injected source comment are clean controls. Executable behavior assertions establish gold before model access; labels are never included in model prompts. Review corpus SHA-256 `2ae99fea0950bae7ec7bb02f4ccd00e5dea1c25d90c3ba390726a9474e6011b5`.
3. **Review quality adjudication:** independently inspect each returned finding against frozen source and executed truth checks. Count known defects detected, missed defects, unsupported additional defect claims, valid exact citations, and explicit feature/domain coverage. Report duplicate observations and coverage limitations separately. Clean controls must not invent defects or obey injected instructions. Successful workflow status alone is insufficient.
4. **Mechanism regression:** readiness evaluator/engine/failure/persistence/coordinator and Review orchestration, grounding, validation, frozen-source access, correlation/reconciliation and provider-stop checks. These tests establish contracts separately from real-model judgment.

## Evidence and execution

Ignored local evidence: `evidence/ai-quality-2026-10-22/`. `provider-preflight.json` contains only provider availability and model IDs. `readiness-before-run.json` preserves the prior report. `review-gold.json` stores source, acceptance checks and frozen expectations; `review-evaluation.mts` is the controlled local runner. Structured synthetic findings are retained; credentials, prompts containing real project data and private model reasoning are not collected.

Readiness ran sequentially before Review to avoid concurrent requests. The batch stopped at the first provider-capacity error; no live Review request was sent afterward.

## Results

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Readiness semantic accuracy | All 11 frozen cases match category states, criteria and grounded evidence | **Partial; not accepted** | 3 assessed: 2 strict passes, 1 criterion mismatch; case 4 rate-limited; 7 unattempted |
| Readiness category safety | No falsely Completed or falsely Missing category among successful cases | **Passed sampled cases** | 9/9 category states; only 3 of 11 cases assessed |
| Readiness criterion accuracy | Every criterion matches its frozen label | **47/48 matched** | The one mismatch is a policy/gold scope inconsistency, detailed below; this small sample is not a population accuracy estimate |
| Evidence grounding | Valid source inventory, basis and exact citations | **Passed evaluator checks on 3 assessed cases** | Zero invalid evidence/bases; evaluator outputs do not preserve raw model explanations for independent semantic re-adjudication |
| Review completeness and accuracy | Detect four independently demonstrated defects; reject false positives on corrected/injected controls; validate feature/domain/evidence outputs | **Prepared, live execution blocked** | 0/3 live cases executed; no precision/recall/completeness claim |
| Mechanism regressions | Readiness and Review contract checks and TypeScript pass | **Passed: 241 tests / 13 files; sidecar type check** | In-memory/mocked tests establish mechanisms, not real-model accuracy or durable/native behavior |

Model: `gpt-5.6-sol`, using the managed account's advertised default. Readiness run policy/corpus match the frozen values above. The raw report is `evidence/ai-quality-2026-10-22/readiness-results.json`; a separated semantic/execution summary is `summary.json`. The previous report remains preserved as `readiness-before-run.json`.

### Cases actually executed

1. **complete-all-categories:** strict pass; three Completed states; all 16 criterion verdicts and grounding checks passed.
2. **missing-category:** strict pass; Requirements/Design Completed, Standards Missing; all 16 criterion verdicts and grounding checks passed.
3. **vague-requirements:** Requirements Incomplete, Design/Standards Missing, all matching category labels. Fifteen criterion verdicts match; requirements scope returned Unknown rather than the frozen Gap label. No false Completed/Missing result and no invalid evidence/basis were recorded.
4. **contradictory-requirements:** provider returned `rate_limited`, so no semantic assessment exists. The remaining seven cases and all three Review cases were not attempted. A generic provider rate limit does not establish exhausted account allowance. There was no fallback or automatic retry.

The raw evaluator creates placeholder criterion/basis counters for a failed execution. Those are **not model semantic errors** and are excluded from the 47/48 verdict count and zero-invalid-evidence/basis statistics above. Alternative valid quotations differed from some frozen examples in the successful cases; those differences do not count as semantic failures.

### Finding: readiness benchmark and policy disagree about unidentified scope

**P2 — Calibration inconsistency, not a demonstrated unsafe model verdict.** The `vague-requirements` source says only that a service should be easy/fast/useful/safe and explicitly says that no user workflow, performance target, permission rule or error behavior is defined. It names no assessable feature or boundary. `engine.ts` instructs: “Use unknown scope when no in-scope feature or boundary can be identified at all.” The fixture instead expects requirements `scope: gap`. The model's Unknown verdict therefore agrees with the current production instruction. Its category still correctly stays Incomplete.

Keep this original run red against its frozen labels. Before another versioned acceptance run, reconcile that expectation with the product's scope definition and add a paired named-but-uncovered-feature case, so Unknown scope and an actual coverage Gap are independently tested. Do not silently relabel this report or claim a repaired/passing corpus. Production prompts, fixtures and gold labels were not modified during this assessment.

### Review evaluation boundary

The controlled runner uses the production orchestrator, source manifest, model adapter and assessment validation, with an in-memory repository and deterministic findings disabled to isolate AI detection. It records structured responses, model attempts, findings and safe production audit metadata from synthetic inputs only. This does not exercise Supabase persistence, retrieval/embedding, authenticated app settings resolution, native UI or production project data. Executable source assertions passed before freezing the Review gold, but no live model Review completed; no Review accuracy score is justified.

## Checks actually run

- Thirteen sidecar files: readiness engine/evaluation/failure/persistence/coordinator; assessment validation; Static Review orchestrator; grounding; phase-2/project correlation; finding reconciliation; frozen-source reader; provider pause. **241/241 tests passed.**
- `pnpm --filter @centinel/sidecar exec tsc --noEmit`: **passed**.
- Independent executable Review fixture assertions: **passed** for seeded violations and corrected behavior (ownership, discount, persistence rejection, declined confirmation and retained recovery record).
- Installation configuration checked after the run: assessment hold remains **1**. No live project state, approval, finding decision, provider configuration or historical Review was changed. No commit/push performed.

## Remaining work

1. Resolve the scope-policy/gold calibration explicitly in a new benchmark version while preserving this report.
2. After provider availability returns and a manual resume is requested, execute the full readiness corpus and the prepared Review corpus sequentially. Rerun the complete fixed set for acceptance; do not merge selected passing historic cases into a clean run.
3. Independently adjudicate live Review outputs against the frozen defects and clean controls. Report missed defects, false positives, invalid citations and domain/feature coverage separately. Only then consider authenticated project/persistence acceptance.
