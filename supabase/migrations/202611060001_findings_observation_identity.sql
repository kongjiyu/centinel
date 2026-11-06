-- A Review keeps one finding row per correlation fingerprint *per observation*:
-- the verifier (deterministic rule or model) and whether its citation still
-- needs verification. Uncertain observations must never overwrite proven
-- evidence (see SupabaseStaticReviewRepository.saveFinding), so the same
-- fingerprint can legitimately appear up to four times in one Review.
--
-- The original index allowed only one row per (Review, fingerprint), so saving
-- the second observation failed with a unique violation and the whole Review
-- ended as "Validated partial evidence could not be saved".
--
-- Additive and idempotent: existing rows already satisfy the narrower index.

create unique index if not exists findings_review_observation_idx
  on public.findings(
    review_session_id,
    correlation_fingerprint,
    (coalesce(verifier, '')),
    ((source_locator -> 'citationEvidence' ->> 'verification') is not distinct from 'needs_verification')
  )
  where correlation_fingerprint is not null;

drop index if exists public.findings_review_fingerprint_idx;
