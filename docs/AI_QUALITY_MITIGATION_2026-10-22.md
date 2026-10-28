# AI quality evaluation findings and mitigation specification

Origin: [live assessment](AI_QUALITY_ASSESSMENT_2026-10-22.md). Scope is evaluation integrity, not an unverified claim that model accuracy is repaired. Keep production AI held; no live inference is needed to implement these mitigations.

## Findings and required behavior

| ID | Finding | Mitigation / acceptance criteria |
| --- | --- | --- |
| AQ-01 / P2 | Vague-source scope gold expects Gap while production policy requires Unknown when no feature/boundary is identifiable | Version the benchmark; calibrate this expectation to Unknown; add a distinct explicitly named but uncovered feature expecting Gap. Both remain Incomplete. Freeze the new corpus/hash; preserve the original failed run unchanged. Regression tests must distinguish Unknown/Gap and reject a false Pass. |
| AQ-02 / P2 | Provider execution failures create synthetic criterion/evidence/basis errors and contaminate semantic totals | Separate assessed, mismatched, execution-error and unattempted counts. Null engine outcomes remain unavailable. Exclude execution-error cases from all semantic totals, including legacy case objects. Never count an unexecuted case as passed or accept a partial corpus. |
| AQ-03 / P2 | Evaluator discards concise explanations and exact evidence needed to independently inspect a criterion mismatch | Retain only bounded safe criterion/classification explanations and validated exact citations from the fictional fixture inventory. Never save arbitrary raw provider payloads, source bodies, secrets, or private reasoning. Regression-test redaction and forged-source rejection. |
| AQ-04 / P2 | Core batch evaluator can continue requesting later cases after a provider-capacity error; live CLI overwrites a fixed report path | Stop the batch immediately on capacity/pause, with no retries/fallback. Persist a new collision-resistant run directory containing a frozen corpus and incremental report, benchmark/policy/model identity and full planned case IDs. Preserve existing reports; stop behavior and artifact retention need offline tests. |
| AQ-06 / P2 | A wrong raw model Pass can receive a passing benchmark result when the engine safely downgrades it to the expected Gap | Score raw model criterion agreement separately from effective engine agreement. Both must match for semantic acceptance; retain the engine's conservative safeguard. Test an incorrect raw scope Pass that is corrected by the engine but must still fail model accuracy acceptance. |
| AQ-05 / acceptance blocker | Live Review precision/recall/completeness was not measured because provider capacity stopped readiness first | Keep live Review acceptance explicitly blocked. Preserve prepared independent defect/clean controls; require a later complete live run and independent finding adjudication. Tests alone cannot close semantic acceptance; do not retry automatically. |

## Design decisions

Production readiness prompts/decisions and project persistence are unchanged. The benchmark version changes independently from `READINESS_POLICY_VERSION`, because AQ-01 corrects evaluation labels rather than deployed product behavior. Existing report fields remain readable; additive fields provide assessment/execution denominators and provenance. `failedCaseCount` continues to mean attempted non-passes, while semantic mismatch counts exclude execution failures. Historical evidence remains immutable.

The new named-scope control must quote the identified feature and explicit lack of coverage. Missing categories still require Unknown criterion verdicts rather than synthetic gaps. A successful benchmark case must satisfy the original grounding/state checks as well as the newly explicit scope distinction.

## Verification plan

1. Run readiness evaluator/engine/failure/persistence/coordinator/provider-stop regression suites, plus targeted Review integrity suites.
2. Run sidecar TypeScript and scoped whitespace checks.
3. Inspect the generated frozen corpus and reports using mocked providers only. Confirm old report bytes and the root AI hold remain unchanged.
4. Record per-finding acceptance and residual live-model limits below. No whole-product, model-accuracy or native/persistence signoff from offline checks.

## Implementation results

| Finding | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| AQ-01 | Versioned Unknown/Gap controls; old run preserved | Implemented; offline checks passed | New corpus has no live acceptance |
| AQ-02 | Separate semantic/execution denominators; partial corpus cannot be accepted | Implemented; offline checks passed | Historical raw counters remain unchanged |
| AQ-03 | Safe explanations and exact citations; forged/secret/private-reasoning content omitted | Implemented; offline checks passed | Source anchoring does not establish semantic correctness |
| AQ-04 | Capacity/hold stops; new frozen run directories; prior files retained | Implemented; offline checks passed | Provider execution not retried |
| AQ-06 | Wrong raw model verdict cannot pass because engine normalization corrected it | Implemented; offline checks passed | Engine safeguards remain unchanged |
| AQ-05 | Complete live Review corpus and independently adjudicate findings | Still blocked | Provider rate limit; no new model calls during mitigation |

### Implemented contract

- Benchmark `readiness-benchmark-2026-10-22.1`: **12 cases**, SHA-256 `960cc215077f74fad134a6dc9bf9fd980b86d048549be81ca7b0c89c7020bd59`. The unidentifiable-scope expectation is Unknown; a new named export feature without behavior expects Gap. Both remain Incomplete. Production policy, prompts and decisions are unchanged.
- Additive report fields provide benchmark identity, planned IDs, assessed/mismatched/execution/unattempted counts, `selectedCasesPassed` and `accepted`. `accepted` requires the complete current benchmark, so a passing selected subset is insufficient. Existing `failedCaseCount` still counts attempted non-passes. All semantic totals filter execution failures, including legacy objects with placeholder scores. Raw and effective criterion disagreements are recorded separately; either fails semantic acceptance.
- Audit evidence retains safe explanations up to 400 characters, exact validated citations up to 800 characters, at most 16 citations per criterion/classification/coverage record, and 100 scope records. Invalid snippets are omitted while validation failures remain visible. Arbitrary raw provider payloads, secrets and private reasoning are not retained.
- `evaluationRun.ts` and the live CLI write `evidence/readiness-evaluations/run-*/corpus.json`, `run.json` and incremental `report.json`. Corpus/provenance are written exclusively; report replacement uses a temporary file within that run. Old reports are never overwritten. Empty/blocked reports retain the selected denominator.

### Verification actually run

- **250 tests / 14 files passed** across readiness, provider-stop and Review integrity contracts. The evaluator/run-evidence subset has **20 tests**, including five capacity/hold variants. The adversarial mock builder clones fixtures to prevent test mutations of shared gold.
- Sidecar `tsc --noEmit` and scoped whitespace checks passed.
- Independent hash assertion confirms the original report is unchanged: SHA-256 `fa01a0d5da9b88d9bde3f48e0c38d1efcf33078c62a8add783b974462c4ae909`. Local verification metadata: `evidence/ai-quality-2026-10-22/mitigation-verification.json`.
- Installation AI hold remains `1`. No live inference, project mutation, approval, commit or push occurred. Frontend/native UI is unchanged.

The original assessment remains partial/failed against its frozen gold. A new full live run and independent Review adjudication are still required; offline mitigation tests do not certify model accuracy.
