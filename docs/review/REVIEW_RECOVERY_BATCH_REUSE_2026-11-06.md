# Same-Review batch reuse after lease recovery (6 November 2026)

## Problem
When a running Static Review was interrupted (app quit, computer shut down) and later resumed through lease
recovery (`review_lease_recovered`), model analysis restarted from the first batch. Batches already validated
and saved in the same Review were sent to the provider again. A Cypress Real World App run on 6 November 2026
repeated about 350k input tokens of finished work this way.

## Rule (user-approved, amends the v20 cache read contract)
Every clean, primary-provider batch was already written to the encrypted validated batch cache
(`review/batchCheckpoint.ts`). Previously the cache was read only for explicit saved-source retries with a
parent Review. Now a Review that resumes after `review_lease_recovered` with `action: 'requeued'` may also
reuse a batch record when all of the following hold:

1. **Same identity.** The record's `originReviewId` is this Review, and owner, project and request hash match.
   The request hash (`batchRequestIdentity`) binds the lineage root, policy and validation versions, provider
   configuration fingerprint, exact system prompt/prompt/schema, frozen authorities and the full frozen source
   manifest (artifact IDs, version IDs, paths, content hashes). Any difference is a miss.
2. **Journaled clean.** `recoveryBasisFromJournal` reads this Review's own journal (`getRecoveryJournal`) before
   the resumed run records any batch:
   - the batch's retained `review_analysis_batch_saved` conclusions equal the cached conclusions;
   - the cached findings' candidate IDs exactly equal the batch's `supported` records in
     `review_candidate_support_saved`, and no other disposition was recorded;
   - no `review_batch_needs_verification`, `review_analysis_batch_unverified`,
     `review_candidate_support_incomplete`/`_limited`/`_conflict` or `review_batch_cache_rejected` event exists
     for the batch. Negative, uncertain, timed-out and unverified batches are therefore always re-run.
3. **Revalidated.** Every current validator reruns on the reused result (shape, four-domain coverage,
   grounding, citation ranking with uncertain citations vetoing, frozen-source excerpt validation and
   semantic-support validation), exactly as for explicit retries.

## Accounting and budgets
- A reused batch makes no provider call and records no attempt or `model_usage_records` row. The records from
  before the interruption remain on the Review, so that spend is counted once.
- `review_batch_cache_reused` records `originReviewId` (the same Review), `providerCallsAvoided` and
  `reuseKind: 'lease_recovery'`.
- Durable per-operation attempt budgets are unchanged; re-run batches continue from their recorded counts.

## Failure behaviour
Recovery reuse is an optimisation. If the journal or a cache record cannot be read, the orchestrator audits
`review_batch_cache_rejected` (`recovery_journal_unavailable` or `persistence`) and runs the batch normally.
Explicit `reuseValidatedBatches` retries keep their fail-closed behaviour.

## Limits
- Installations without `CENTINEL_TOKEN_ENCRYPTION_KEY` have no cache and keep full reruns.
- A batch that was in flight at the interruption, or whose cache write failed, is re-run.
- If a resumed run builds a byte-different prompt for a batch (for example, changed deterministic findings),
  that batch misses and is re-run.
- No migration, table or hosted change. Not verified against a live interrupted Review yet.

## Verification
`sidecar/__tests__/unit/batchRecoveryReuse.test.ts` simulates an interruption with the provider call in flight
and resumes the same Review from a new orchestrator sharing the repository and cache:
- N ≥ 2 finished batches are reused, not re-sent; only the in-flight batch is re-sent; attempts for reused
  batches are unchanged; findings equal an uninterrupted run.
- No `review_lease_recovered` event: the cache is not read.
- Changed provider fingerprint, changed frozen manifest version IDs, or a different origin Review: nothing reused.
- A journaled `review_batch_needs_verification` for a cached batch: re-run.
- Insufficient (unverified) support: never cached, re-run.
