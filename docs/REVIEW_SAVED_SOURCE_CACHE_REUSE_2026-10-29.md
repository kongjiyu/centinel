# Explicit saved-source Review cache reuse

## Purpose

Expose the existing validated-batch cache to users starting a linked retry. Cache reuse remains an explicit optimization choice and does not change what a Review is allowed to conclude.

## Behavior

- The retry panel offers a separate opt-in to reuse eligible validated work from an earlier Review.
- The option is available only when retrying the saved frozen sources. It is off by default and is cleared when the user selects updated sources; it is not shown for an updated-source retry.
- Reuse may restore only a complete clean batch whose exact prompt, schema, frozen source manifest, authorities, provider configuration, project, owner, and lineage match. The current pipeline revalidates every hit and retains the existing parent-conclusion and evidence gates.
- Uncertain, conflicted, negative, incomplete, or otherwise ineligible batches continue through the normal Review path. Updated-source retries always use fresh assessment work.
- The UI does not promise that a cache entry exists or that reuse will avoid a particular amount of work. If encrypted cache support is unavailable, the existing API fails before creating a child Review or starting paid model work.
- Cache reuse choice is part of retry request identity. Retrying an identical failed request reuses its idempotency key; changing source mode or cache reuse choice starts a new request key.
- Reused findings/evidence remain attributed to their origin Review in usage projections; cached evidence is not reported as new provider usage.

## Acceptance criteria

1. A saved-source retry has a keyboard-accessible cache reuse checkbox, unchecked by default, with a concise explanation of its strict eligibility and fresh-work fallback. Selecting updated sources hides and clears it.
2. Checking it sends `reuseValidatedBatches: true`; leaving it unchecked omits the flag. Updated-source retries never send `true`.
3. Changing cache reuse after a failed request creates a new idempotency key, while retrying the same choice keeps the existing key.
4. Tests cover the default-off path, explicit opt-in, updated-source exclusion, and request-key behavior.
5. Existing cache validation, finding evidence, support-limitation, and capacity gates remain unchanged.

## Verification

Run the Review activity screen tests and the targeted batch-cache orchestrator/projection tests. Run the frontend production build after UI changes. Record unrun viewport or live-provider checks explicitly; UI fixtures do not establish live cache availability or semantic acceptance.

### Results recorded on 29 October 2026

- `pnpm --filter centinel test -- ReviewActivityScreen.test.tsx`: 39 tests passed.
- `pnpm --filter centinel build`: passed; Vite retained its existing large-chunk advisory.
- `pnpm --filter @centinel/sidecar test -- __tests__/unit/supportRepairOrchestration.test.ts __tests__/unit/codex.test.ts __tests__/unit/batchCacheOrchestrator.test.ts __tests__/unit/batchCacheValidation.test.ts __tests__/unit/batchCacheUsage.test.ts`: 55 tests passed across five files.
- An isolated Playwright fixture verified the retry panel at 1440×900, 1200×900 and 390×844. The panel stayed within the viewport with no page-level horizontal overflow. Updated-source selection hid and cleared the cache option, and the captured retry request omitted `reuseValidatedBatches`. Screenshots and the fixture report are under ignored `evidence/review-cache-reuse-ui-2026-10-29/`.
- No authenticated cache read/write, live provider call, or full semantic Review was performed. The previously recorded generic `codex_turn_failed` still does not establish an upstream cause or predict completion of a future Review.
