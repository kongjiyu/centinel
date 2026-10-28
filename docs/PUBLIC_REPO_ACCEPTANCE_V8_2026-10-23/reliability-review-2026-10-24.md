# Reliability review — 2026-10-24

Verdict: ACCEPTED

**Accepted for controlled runtime verification. No blocking findings in the scoped changes.** This is independent, read-only review of the newly added session-refresh, GET-deadline, usage-diagnostic and observer-stop behavior. The baseline is the existing dirty v8/.3 implementation; unrelated working-tree changes and earlier batching, source-coverage and policy work were excluded.

| Feature | Acceptance criteria | Status | Risk flags |
|---|---|---|---|
| Readiness provider freshness | Resolve the current authenticated client for each configuration lookup and each attempt reservation/completion write; preserve the job owner | Accepted | Requires an authenticated same-owner request to update the coordinator's session; this does not refresh credentials itself |
| Frontend GET deadline | Bound fetch and JSON-body consumption at 30 seconds; abort transport; release shared reads; no automatic retry or timeout-driven sign-out | Accepted | Writes intentionally retain existing behavior |
| Usage diagnostics | Return optional allowed outcomes/error codes and finite nonnegative durations through the existing authenticated owner-scoped query | Accepted | Unknown/legacy diagnostic values become null; raw provider text and metadata are not added |
| Evaluation observer | Journal a safe stop code/status and collect existing usage records without starting assessments or provider calls | Accepted | An observer stop remains distinct from a durable assessment failure and semantic acceptance |

The Readiness coordinator supplies a live getter to `createReadinessModelProvider`. The factory checks its returned user ID against the original job owner before returning the client. `createGroundingModelProvider` creates its configuration repository at the start of each analysis request and obtains the current client separately for both usage callbacks. Existing direct-client callers remain compatible. A failed attempt reservation still prevents a paid request; completion persistence errors still stop execution rather than becoming provider retries. No service-role client, local fallback, retry-policy change or semantic-policy change was introduced in this delta.

The frontend races the complete GET operation, including body parsing, against its deadline and caller cancellation. Its finally block clears the timer/listener; the existing in-flight read map releases rejected promises. Only an explicit HTTP 401 with `unauthenticated` still emits the authentication-expired event. Diagnostic additions preserve existing totals/pagination and owner filters. The temporary observer records only an allowed stop code plus HTTP status and reads the existing usage endpoint.

Independent executed checks: **70 tests passed across eight files**, without network/provider calls or imported upstream execution:

- Frontend `src/api/client.test.ts`: 11 passed.
- Sidecar `modelUsageSummary.test.ts` and `tokenUsage.test.ts`: 7 passed.
- Sidecar `readinessGroundingProvider.test.ts`, `readinessRuntime.test.ts`, `projectReadinessCoordinator.test.ts`, `readinessConcurrency.test.ts` and `readinessFailure.test.ts`: 52 passed.

The new freshness test rotates clients before the first batch and during model execution, checks the client used by each reservation/completion write, and retains the legacy pinned-client negative control. Factory tests cover same-owner replacement and owner-change rejection. Timeout tests cover stalled fetch, stalled body, cleanup, a fresh subsequent read, and unchanged write behavior. Diagnostic tests reject arbitrary outcome/error text and metadata.

Reviewed source SHA-256 values at final inspection:

| File | SHA-256 |
|---|---|
| `centinel/src/api/client.ts` | `6a101c87f562324488b4a475452dd77c4d1cf38bfe9f672c7fb2be47287c9e35` |
| `sidecar/src/modelUsageSummary.ts` | `c532f527133212c4e5742a34e6df9285fa77ee8bfba2a047a7080953ab2f2c74` |
| `sidecar/src/tokenUsage.ts` | `1788a27e4731582d2898463524d1f52b8de3936635f414308ba2ef6f141e74d4` |
| `sidecar/src/readiness/runtime.ts` | `817e6741699449f060cc49e5ad35c85b06008862b4e3dd7ab22469faf156cb42` |
| `sidecar/src/readiness/service.ts` | `a8c630e4244f0c7811a26138d27aefb4e219fdd6f67f9003c09d411c491828af` |
| `sidecar/src/review/groundingProvider.ts` | `7a429688ee3ccbd02958e8cf70f13b1e3e3c64a245b3cf187e51afa195e8d1ba` |

No code edits, deployment, runtime restart, provider invocation or live assessment was performed by this reviewer. Real Supabase credential rotation and the failed Immutable assessment's next outcome remain unverified. The historical Immutable failure's root cause remains unproven; these fixes address demonstrated reliability gaps. This scoped verdict covers transport/session code and diagnostics only. It does not accept the five-repository benchmark, change frozen gold/thresholds, or convert completed Readiness execution into semantic acceptance.
