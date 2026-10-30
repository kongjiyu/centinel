# Review provider failure pause and manual resume

## Scope

Static Review text assessment only. Existing Review retry remains a linked child using its current saved or refreshed source policy, optional validated batch cache, and ownership checks. The explicit child has the existing fresh per-attempt budget; crash recovery within a single attempt operation still honors its durable high-water mark. This change does not create same-Review continuation or change source indexing/readiness recovery.

## Behavior

- Structured rate-limit, quota, credit, and billing responses keep their existing immediate `provider_paused` behavior. They make one request at most, skip repairs and provider fallback, and do not claim exhausted quota from a generic 429.
- When a Review text operation exhausts its existing bounded transient retries, it pauses with safe code `provider_unavailable`. The message describes provider availability only and does not infer quota exhaustion. Per-request attempt records remain authoritative; absent usage remains unknown.
- A generic Codex `codex_turn_failed` with unknown cause and potentially unknown consumption pauses neutrally without automatically replaying the paid request. Observed partial usage is retained by the existing attempt record.
- Malformed output, citation/domain/semantic validation failures, permanent auth/configuration errors, persistence failures, cancellation, and safety/context stops keep their existing failure or stop behavior. They do not become provider pauses.
- The internal `provider_unavailable` marker is recognized only by Review's explicit pause helper. Shared capacity classification remains limited to structured provider capacity codes, so Readiness and source-index jobs do not acquire a new pause category.
- Recovery is the existing explicit linked Review retry. It preserves the parent's attempt records and history, does not schedule work automatically when provider access changes, and continues to apply existing source/owner/cache checks. A child receives the existing fresh request budget; no crash-recovered operation may reset its own durable attempt high-water mark.

## Acceptance

| Feature | Acceptance criteria | Status | Risk flags |
|---|---|---|---|
| Capacity stop | Structured capacity codes still stop on the first request without sleep, repair, or fallback | Offline lifecycle checks passed | Provider-internal work before its first observable error cannot be undone |
| Transient exhaustion | Eligible Review model retries retain every attempt, then produce a tagged neutral `provider_unavailable` pause | Offline lifecycle checks passed | No account quota state is inferred |
| Unknown Codex failure | `codex_turn_failed` pauses without replay; observed usage is retained and missing usage remains unknown | Offline lifecycle checks passed | Cause remains unknown until an explicit structured subtype is available |
| Validation and boundaries | Malformed/semantic failures remain failures; generic provider pause classification remains capacity-only outside Review | Offline lifecycle checks passed | Review-only helper integrated at every inner and outer stop gate |
| Recovery | Existing linked-child retry, source lineage, ownership checks, and durable attempt budgets remain unchanged | Offline linked retry passed; live RLS recovery unverified | Full persistence behavior depends on the existing authenticated repository path |

## Verification

**44 targeted tests passed** across `providerPause.test.ts`, `reviewRetry.test.ts`, and `modelUsageSummary.test.ts`. Sidecar TypeScript passed with `pnpm --filter @centinel/sidecar exec tsc --noEmit -p tsconfig.json`. No provider/network calls or live retry were made.

The parent integrated the Review-only pause helper at all four inner/outer orchestrator stop gates, preventing deterministic-only completion from hiding an interrupted model assessment. Offline lifecycle checks confirm three transient generation attempts and two waits, retained deterministic findings, no correlation/completion, a durable blocked/provider-paused state, and a successful explicit saved-source linked retry while preserving its parent. Generic Codex failures pause after one observed request without replay. A recovered operation with its persisted budget already exhausted pauses without sending or reserving another request; malformed-response exhaustion still follows validation failure behavior. Retry/orchestrator suites passed **68 tests** after this recovery amendment.

The authenticated retry route already requires current project membership and loads the Review through bearer-scoped RLS before creating the linked attempt. No permissions or owner-isolated provider/cache credentials were broadened. Authorized members use their own runtime/provider access; cross-member live recovery was not exercised. The UI exposes **Resume review** for paused state and opens the existing explicit source-choice panel without automatically sending a request. The three affected frontend suites passed **83 tests**, and the frontend production build passed with its existing large-chunk advisory.

Live recovery, provider usage, embeddings and cache-publication acceptance remain pending because the user explicitly requested code-only work while quota is unavailable. The ignored runtime configuration retains the global AI hold; do not clear it without the user's resume request.

Final integrated offline run passed **309 backend tests across 15 suites**, including provider pause/retry, Review lifecycle, grounding, packet validation and cache integration. Sidecar TypeScript and `git diff --check` passed. Final frontend coverage remains **83 tests across three suites**, with a successful production build. A final independent GPT-6.1 Sol review of the newest changes was unavailable after its quota failure; lead self-review and supplementary read-only planning diagnostics do not replace that independent verdict.
