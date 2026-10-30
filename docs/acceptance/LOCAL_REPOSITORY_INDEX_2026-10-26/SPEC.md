# Local repository index and context compaction

Current prepared policy: `review-2026-10-27-source-event-indexing-v19`, with [source-event preparation, owner holds and Review reuse](SOURCE_EVENTS.md). Earlier phases: native index v13, lossless graph v14, frozen retrieval v15, bounded schema v16, support citation repair v17 and confidence continuation v18. Supersedes the production custom v12 index; historical chunk records and evaluations remain untouched and do not acquire later fixes.

The v14 prompt projection stores each repeated exact graph reference once in an ephemeral per-request `evidenceReferenceTable`, with short links in entry points, paths, unresolved boundaries and retained assessment evidence. Use the dictionary only when the entire encoded JSON is smaller. Preserve all other facts and keep canonical maps, source packets and validation unchanged. Responses still require full original reference objects; no production response decoder accepts short links. Require four domain rows and nonempty public summaries structurally while permitting honest unverified outcomes. Graph character reduction does not establish provider-token savings or semantic equivalence. Whole document context and independent source sweeps remain available until authority-specific narrowing is proven safe.

The v15 adapter reconstructs retrieval slice hashes and UTF-16 offsets from trusted frozen line ranges so native hits can pass existing exact packet selection. Shared-index text is never source evidence. Preserve stale-version, offset/hash and complete-unit checks. Supplemental selected CommonJS dependency context is bounded, one-hop and optional; it must not execute source, claim resolved runtime behavior, displace existing packets/documents or exceed the source ceiling. Valid local-source insufficiency remains terminal. See the progress report for test and live-run status.

The v16 schema couples status/outcome pairs on initial requests, requiring nonempty evidence for assessed rows. Only domain repairs receive larger closed full-reference tuple allowlists tied to each feature in the actual prompt map. Schema limits fall back atomically to generic full-reference guidance, preserving every source, feature and runtime validator. Actual schema characters participate in context admission and durable usage accounting. See [offline verification](OFFLINE_VERIFICATION_2026-10-27.md) for measurements and acceptance limits. Provider work resumed under subsequent user authorization; the live v16 execution and unverified quality are tracked in `PROGRESS.md`.

Prepared v17 support repairs add allowlisted mismatch diagnostics and bounded exact windows revalidated against frozen packet identities and original line offsets. Keep the complete base source packet and all semantic/authority checks. Repair-only schemas constrain source identity/range tuples without clipping source context; oversized schemas fall back atomically. Admission and usage must account for the actual augmented prompt/schema. Local tests pass; independent final review was interrupted by model capacity and no v17 execution has begun. See `PROGRESS.md` for the exact resume point.

## Behavior and architecture

1. Explicit Review execution reads selected frozen artifact versions once through the existing content pool. Each staged source must match its saved SHA-256. Ordinary project/source reads never build an index.
2. Pinned `open-codebase-index@0.38.1` runs through its public MCP stdio server in an isolated source workspace. Automatic indexing, watching, provider fallback, retries, reranking and global knowledge bases are disabled. Its local SQLite/usearch files provide search and a bounded static graph; Supabase is the private backup, not the live vector search engine.
3. A capability-protected loopback bridge keeps provider keys in the sidecar. Saved Voyage 4 Lite/4/4 Large use 1024 dimensions and explicit document/query input types. Existing custom providers retain 1536 dimensions. Finite nonzero vector count/dimensions and provider usage are checked before use.
4. Completed, closed index files are archived with hashes and compatibility identity: project, exact source versions/paths/hashes, engine and chunk policy, endpoint hash, embedding model and dimensions. Members with matching configuration restore the same archive to their own owner-isolated local cache. Every result is reconstructed from exact frozen source ranges; shared index text is never trusted as evidence.
5. Prompt compaction removes empty domain placeholders and irrelevant duplicate-avoidance hints. Saved findings, validated facts, uncertainty, evidence, requirements and the complete validation map remain intact. Independent selected-source sweeps and four-domain assessment coverage remain required.

## Free-tier pacing and accounting

The configured account dashboard showed 3 requests/minute and 10,000 tokens/minute on 26 October 2026. Defaults use those limits; optional root runtime configuration `CENTINEL_VOYAGE_EMBEDDING_RPM` and `CENTINEL_VOYAGE_EMBEDDING_TPM` override them. Upstream requests use at most 32 chunks, each targeting 2048 upstream tokens. The bridge splits requests using a conservative UTF-8 admission estimate, without truncation, and admits first attempts through a rolling 60.1-second owner/endpoint/model window. Known actual usage replaces reservations; unknown usage retains the estimate. This cannot observe other apps or guarantee an account balance. A provider capacity response stops the workflow without retry or fallback.

Actual document/query provider calls each save their own usage and source attribution. Admission estimates are never presented as consumed tokens. Long local pacing is separate from the 30-second remote provider deadline. Upstream bridge timeout is 15 minutes; explicit index RPC timeout is one hour, with cancellation support. Fresh bearer clients are selected for usage writes and final archive upload so a routine session refresh does not invalidate a long build.

## Security and retention

The reviewed migration and rollback-only live regression are documented in [RETENTION.md](RETENTION.md). No service-role key, real provider key, global config or auth bearer enters the index archive/MCP child. Snapshot publication requires confirmed child exit. Archives are bounded to 32 MB compressed, 128 MB expanded and 64 files; path traversal, private/transient files and incompatible identities fail closed. The closed database WAL is included; transient SHM and runtime locks are excluded.

## Acceptance status

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Native index and local retrieval | Cold build, exact frozen ranges, warm reuse, fresh-root restore | Real Voyage cold index and warm reuse verified; authenticated download and native fresh-root restore passed; producer/selector regressions passed | True second-member live restore and complete semantic quality remain unverified |
| Shared snapshot access | Member read; outsider/signing/deleted-source read denial; cleanup manifest selection | Live rollback-only SQL checks passed | Late concurrent upload can leave an inaccessible orphan; see retention limits |
| Provider pacing and accounting | Preserve order, exact per-call usage, unknown totals, stop on capacity, refreshed bearer upload | Regression tests passed; independent review found no blocking findings | Other account traffic is unobservable |
| Compaction | Preserve evidence/facts/canonical validation map | Targeted tests passed | Semantic quality requires live adjudication |
| Efficiency and quality | Same 52-file Axios scope, complete actual usage, independent precision/recall/evidence/coverage | Not accepted; v16 failed/partial, v17 not started | v16 usage is known but scope incomplete; historical model/policy differ; independent reviewer hit capacity |

Verification before live run: frontend build and sidecar TypeScript check passed; 109 tests across ten relevant backend files passed. Independent latest-delta review ran 31 tests including the native MCP integration, with no blocking findings. Comparator has 13 passing cases. A completed model workflow alone does not pass the semantic acceptance gates in [EVALUATION.md](EVALUATION.md).

## Windows cache-path regression

The first 52-file live attempt (`5cc6c27b-7277-4983-9aa3-16ecd3f1c48a`) failed before any provider calls. The native MCP returned INTERNAL_ERROR from the 230-character owner/project/fingerprint staging root. Reproducing the exact same frozen sources with a loopback fake provider succeeded at short roots (48 and 126 characters) and at the corrected production-shaped root (156 characters), producing 439 chunks and 17 fake embedding requests. Production now hashes the complete owner/project/fingerprint tuple into one 64-hex cache directory, preserving owner isolation and compatibility inputs while avoiding redundant Windows path expansion. No existing source/index data was deleted. This is an integration correction, not a measured token reduction.

Later verification hardening: each embedding call now reserves a durable UUID usage record before network access and updates it on completion; unfinished records preserve unknown consumption. Ordinary verified HTTP polling refreshes the existing same-owner background Review runtime. Private interrupted stages can be reopened only through a later explicit Review after complete frozen-source/hash and recursive link checks. Public upstream recovery may resend successful embeddings. Failed-batch journals are excluded from shared archives. See `PROGRESS.md` for stopped attempts, current run IDs and verification.
# Current trigger amendment — 27 October 2026

The user's later instruction moves index construction/document embedding to successful source-import/update events. Review reuses or waits for that exact compatible prepared index; archive prefetch remains embedding-free. [SOURCE_EVENTS.md](SOURCE_EVENTS.md) is the current trigger, lease, owner-capacity, status and accounting contract. Earlier explicit-Review-only statements in this historical specification describe preceding phases.

