# Embedding and index-cache mock performance

Scope: embedding adapter, index identity/hash checks, owner-local warm reuse and shared snapshot restoration only. No Review assessment, text model, real embedding provider, production Storage or billing calls. The runtime AI hold remains enabled. The benchmark forbids global external fetch and injects a synthetic response transport into the real embedding adapter.

## Fixture and method

Three sequential rounds use 301 synthetic TypeScript files, 1,024-dimensional fixed vectors, 64 inputs per mock embedding batch and a fixed 20 ms mock transport delay. The native MCP engine, embedding bridge, membership and Supabase Storage are mocked; cache identity, frozen-file checks, snapshot encoding/restoration and embedding response validation execute production code. Each mocked native index is a 1 MiB repeated-byte file, whose compression is not representative of a real SQLite/vector index. Source bodies come from memory; local staged-file reads/writes/hashes use the filesystem. Timings measure this fixture, not live Voyage, Supabase or native-index performance.

| Scenario | Median ms | Range ms | Mock embedding calls | Mock vectors | Native build invocations | Frozen-source reader calls |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Cold build | 488.10 | 475.52–555.69 | 5 | 301 | 1 | 301 |
| Warm exact cache | 282.95 | 265.74–290.38 | 0 | 0 | 0 | 301 |
| Compatible shared-member restore | 295.52 | 246.04–317.11 | 0 | 0 | 0 | 301 |
| One changed source version/hash | 465.81 | 449.07–539.24 | 5 | 301 | 1 | 301 |

Warm reuse made no Storage upload/download calls. Shared restoration made one mock download and no upload. A changed source produced a fresh complete identity and rebuild; this test does not establish incremental per-file embedding reuse. Every warm request still reads the complete frozen source inventory and verifies its materialized hashes, so zero embeddings does not mean zero local I/O.

Separate virtual-clock admission measurement uses 3 RPM and 200,000 TPM. Five fixture batches require one **60,100 ms** admission wait. That wait is simulated, not included in the sub-second wall-clock rows above. Real throughput also includes provider latency, real chunk counts, native processing and network/persistence costs; synthetic vector/token values cannot establish semantic quality or actual billing savings.

## Verification

`pnpm --filter @centinel/sidecar exec vitest run __tests__/performance/embeddingCache.mock.test.ts __tests__/unit/embeddingProvider.test.ts __tests__/unit/embeddingRateLimit.test.ts __tests__/unit/repositoryEmbeddingBridge.test.ts __tests__/unit/localRepositoryIndex.test.ts __tests__/unit/repositoryIndexSnapshot.test.ts __tests__/unit/repositoryIndexSync.test.ts __tests__/unit/repositoryIndexSyncRoutes.test.ts`

All **69 tests across eight files passed**. The final benchmark-only rerun passed after its admission fixture was made independent of environment overrides. Sidecar TypeScript and `git diff --check` passed. Raw latest timings and counters are in ignored `evidence/embedding-cache-mock-performance.json`.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Embedding adapter and admission | Valid dimensions/response ordering, bounded batching, RPM/TPM admission, bounded temporary-limit retries | Mock tests passed | No real provider latency, quota or retrieval quality measurement |
| Warm/shared caches | Exact compatible identity reuses index with zero mock embedding calls | Passed in all three rounds | Warm paths still read/hash all sources; Storage/RLS/native engine mocked |
| Stale/corrupt identity safety | Source/version/config mismatches and changed staged bytes do not use an outdated index; archive hashes remain enforced | Targeted regression tests passed; changed-version benchmark rebuild passed | Rebuilding a changed complete identity can repeat all embeddings |
| Assessment isolation | No Review/text model executed; no external fetch allowed by the benchmark | Passed; runtime hold remains 1 | Live embedding/publication/cache acceptance remains pending |
