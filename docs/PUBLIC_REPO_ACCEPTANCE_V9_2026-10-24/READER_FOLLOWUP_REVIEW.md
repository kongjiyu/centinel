# v9 authenticated reader follow-up

Verdict: ACCEPTED

Independent follow-up reviewer: `/root/v9_reader_acceptance`. Reviewed 2026-10-24T10:56Z using the repository instructions and review/test skills. Baseline checkout HEAD: `476a506054c4987fce3fb89f450d7e10955df175`; the reviewed working-tree reader and regression hashes are recorded below. This accepts the narrow code correction and offline checks. Loading the reader into the running sidecar and recollecting authenticated live evidence remain unverified owner actions.

No remaining **Act on** findings within this scope. `SupabaseStaticReviewRepository.getHarnessEvents` now includes `review_analysis_batch_unverified` alongside the saved-batch event at `sidecar/src/review/supabaseRepository.ts:503`. The query retains the requested project, Review entity, and Review ID filters; its event allowlist still excludes unrelated private event types. The regression checks exact returned IDs, preserved public partial detail, and exclusion of other projects, Reviews, entity types, and the private provider marker.

Integration inspection followed the existing authenticated route at `sidecar/src/index.ts:1173`: project membership and Review/project ownership are checked before the scoped reader is called. The producer records normalized partial-domain features after assessment validation, including bounded sanitized public summaries and frozen-source references. `analysisMapFromEvents` already consumes the unverified tag; exposing it restores that existing reconstruction path without changing assessment completion, provider retry, or absence-resolution rules. This reader change does not invoke a model or alter persisted assessment history.

| Feature | Acceptance criteria | Status | Risk flags |
|---|---|---|---|
| Partial delta visibility | Supabase reader returns the unverified delta and preserves its safe detail | PASS | Live loaded-reader behavior is not independently verified |
| Scope and privacy | Requested project, Review, and entity only; unrelated private event types excluded | PASS | Fake database regression verifies query/projection behavior; live RLS was not exercised |
| Reconstruction integration | Existing consumer can receive the producer's unverified tag without creating completion or absence proof | PASS | Code inspection and offline suite; no live semantic acceptance |
| Runtime provenance | Load at a terminal boundary and recollect with reader hash separate from paid assessment hashes | PENDING owner action | Owner reports Axios Review quota-blocked at 2026-10-24T10:49:32Z; no retry authorized |

Independently executed:

1. `pnpm --filter @centinel/sidecar test -- __tests__/unit/supabaseReviewRepository.test.ts __tests__/unit/assessmentBatches.test.ts __tests__/unit/phase3Runtime.test.ts` — **47 passed, 3 files**.
2. `pnpm --filter @centinel/sidecar exec tsc --noEmit` — **passed**.

Only this report was edited during the follow-up review. No production source edits, live application API calls, upstream requests, model/provider calls, retries, or runtime reloads were made. Owner-reported live state: Axios Review `f859efd0-3ad0-4316-a769-f6d4e1828f99` is terminal and quota-blocked with partial findings. This report does not independently certify that state or accept its semantic results. A read-only reload/recollection does not require another paid assessment; the new capacity error does not authorize a retry.

## Reviewed SHA-256

| Path | SHA-256 |
|---|---|
| `sidecar/src/review/supabaseRepository.ts` | `fbbc9a1060a15b0f26aae8f1a75bc24d34ddbc6f7729fb144257ff178040248f` |
| `sidecar/__tests__/unit/supabaseReviewRepository.test.ts` | `8d25b50059de756630f6d1c2eaaed7fb800148c050a28d7a562d12100e72da00` |

## Historical pending observation (preserved)

The following is the original observation before the reader correction. Its pending verdict and failing regression are historical and superseded for code acceptance by the follow-up above; runtime loading/recollection remains pending.

Verdict: PENDING

Reviewer: `/root/v9_coverage_acceptance_review`, GPT-6.1 Sol High. This additive integration review preserves `IMPLEMENTATION_REVIEW.md` and its launch snapshot as historical scoped acceptance. It does not accept the live model's semantic conclusions.

**Act on — P2:** `sidecar/src/review/supabaseRepository.ts:502`, `SupabaseStaticReviewRepository.getHarnessEvents`, omits `review_analysis_batch_unverified` from its event allowlist. The orchestrator durably writes these sanitized partial-domain deltas and `analysisMapFromEvents` understands them, but the authenticated Supabase reader strips them before reconstruction. A Review that fails or pauses during coverage repair can therefore expose default/older coverage instead of its retained public limitation and valid references. Existing project/Review/entity filters are present; this is event visibility, not an authorization failure.

Remediation owned by the implementation lead: add the new event tag alongside `review_analysis_batch_saved`, load the reader change at a terminal workflow boundary, and recollect the authenticated harness results. A read-only projection fix does not require repeating paid model assessment. Keep model-runtime source hashes separate from the later loaded reader hash.

| Feature | Acceptance criteria | Status | Risk flags |
|---|---|---|---|
| Partial delta visibility | Supabase reader returns `review_analysis_batch_unverified` with its safe detail | FAIL, patch pending | Failure/repair explanations hidden from API projection |
| Scope and privacy | Requested project, Review, and entity only; unrelated/private event types excluded | Regression prepared | Final assertions run after visibility assertion passes |
| Runtime provenance | Apply/load at terminal boundary and recollect without changing paid assessment provenance | PENDING owner action | Current Axios Review `f859efd0-3ad0-4316-a769-f6d4e1828f99` began 2026-10-24T10:29:25Z |

Regression added only to `sidecar/__tests__/unit/supabaseReviewRepository.test.ts`, test `exposes unverified harness deltas only for the requested project and Review`. It seeds the wanted delta, a permitted prepared event, another project's delta, another Review's delta, another entity's delta, and a same-scope private provider event. It checks exact returned IDs, preserved partial detail, scope identity, and no private marker leakage.

Executed `pnpm --filter @centinel/sidecar test -- __tests__/unit/supabaseReviewRepository.test.ts`: **16 passed, 1 expected regression failure**. At line 149, expected IDs `['visible-prepared', 'visible-unverified']`; received `['visible-prepared']`. Production source was not edited by this reviewer, and no application/model/upstream calls were made.

Follow-up acceptance remains pending until the lead applies the allowlist change and the regression passes. Existing paid results should be recollected after the corrected reader is loaded.
