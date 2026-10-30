# Indexing and cache reliability acceptance — 29 October 2026

Scope: requested embedding pacing/retries, automatic repository updates/indexing, stale-index rejection, saved-result cache control and known Review completion defects. Unrelated existing work is preserved.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Embedding | 3 RPM / 200,000 TPM; bounded increasing waits; per-attempt usage and renewed guards | Implemented; tests and independent review passed | Account-wide contention can still exhaust retries; no live recovery run |
| Source automation | New imports and complete changed repositories queue indexing; local polling is authenticated, bounded and fair | Implemented; targeted regressions passed | Signed-in polling required; oversized/unreadable inventories skipped |
| Index cache | Exact identity and source hashes checked before warm reuse or restore | Implemented; corruption/recovery tests passed | No fresh second-device/provider verification |
| Review result cache | Explicit saved-source-only control, exact backend eligibility, correct request identity | Implemented; UI/backend tests and responsive fixture passed | Eligible cache may be absent; updated sources run fresh |
| Complete Review | Retain evidence gates and safe diagnostics; no unsupported success | Known projection/diagnostic regressions pass | Generic historical upstream failure cause remains unknown; full live completion not established |

Verification: 93 combined sidecar indexing/embedding tests, 55 cache/support/Codex tests, 40 frontend Help/Review tests, sidecar TypeScript and frontend production build passed. Native index integration separately passed with the embedding suites (45 tests). No full workspace suite was claimed. Build retains the existing bundle-size advisory; diff check passes with line-ending advisories. Independent GPT-6.1 Sol review found retry-deadline, partial-import, scan-fairness and revert-repair issues; fixes were reassessed.

Cache UI screenshots at 1440x900, 1200x900 and 390x844 are in ignored `evidence/review-cache-reuse-ui-2026-10-29/`. Root check logs are `evidence/index-reliability-final-tests.txt`, `index-reliability-final-tsc.txt`, `index-cache-ui-tests.txt` and `index-cache-frontend-build.txt`.

Remote endpoint generates document/query embeddings; similarity search uses the local frozen vector index. Voyage documents temporary-limit exponential backoff at https://docs.voyageai.com/docs/rate-limits. See EMBEDDING_RELIABILITY_2026-10-29.md, INDEX_AUTOMATION_2026-10-29.md and REVIEW_SAVED_SOURCE_CACHE_REUSE_2026-10-29.md for contracts and bounds.

The ignored local runtime TPM override was changed from 10,000 to 200,000 (RPM stays 3). Development services and native app started through the checkout-aware launcher; health preflight passed. Existing provider/application holds were not cleared and no live Review was started by this verification. A ready search index is not semantic Review acceptance.

Final reconciliation protection: only importer-owned artifact IDs recorded for that root participate in hash baselines/pruning. Separately uploaded documents under the root are preserved. Final combined sidecar rerun remains 93 passing tests, TypeScript passes, and the rebuilt native development app passes `pnpm dev:check` on the final code.
