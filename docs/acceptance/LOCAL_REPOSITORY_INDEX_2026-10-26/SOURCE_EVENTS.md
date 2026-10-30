# Source-event indexing and embeddings — 27 October 2026

## User contract and implementation

The user explicitly requested embedding as part of source indexing, before Review. This supersedes the earlier explicit-Review-only build trigger. A successful local project import, repository reimport, text document upload, source removal, or completed connected-source sync now queues preparation. Manual sync-run Resume uses the same completion path. Partial/failed/cancelled imports do not start indexing their incomplete result; partial successful pages continue through the durable source worker.

The source-event response waits only for the metadata/configuration identity and durable queue record. Native indexing, document embeddings and archive publication run afterward. `SourceIndexCoordinator` and `SupabaseSourceIndexJobStore` use existing member-scoped `audit_events`; no new database migration, service-role client or local database fallback is introduced. Source mutation remains successful if queue preparation fails; the service records a safe diagnostic, and Source shows unavailable/unprepared status with an explicit Prepare action. Missing configuration or retention migration must be corrected before that action can succeed.

Each project/fingerprint has a deterministic job identity and conditional revision updates. A two-minute lease, renewed every 30 seconds, prevents two devices from building that same identity concurrently. Both source-event and Review builds use this coordinator. Review waits cancellably for a live shared build for at most ten minutes, then restores the compatible publication using its own authenticated credentials. Source status GETs recover existing queued/expired jobs; they do not create new paid jobs. Shared archive prefetch remains embedding-free.

The guard runs after provider admission and before each paid batch, and before publication. It verifies ownership, lease, owner hold and application pause/project allowlist. Background builds also recompute the latest metadata/configuration fingerprint. A superseded build cannot become the current version; any archive is immutable and addressed by its exact frozen fingerprint. A source update after the guard cannot make an older archive match the new identity. Reviews may deliberately assess an older frozen scope, so they retain that exact identity rather than silently switching to latest sources.

Capacity holds live separately from the shared job, by authenticated owner and project. One member's exhausted provider cannot cancel another member's live lease. Moving a ready/shared job to another member does not erase its original owner's hold. Explicit Source → Resume indexing releases only that owner's expected hold revision. Source changes, polling and restart do not clear capacity holds. Terminal paused job state is persisted before the hold so interrupted persistence remains conservative. Persistence, context, cancellation and capacity failures never authorize fallback or an automatic paid retry.

Source shows one compact preparation status and an explicit Prepare search/Resume indexing action. It polls every 15 seconds without overlapping requests and rejects stale responses after source/project changes. Unknown status stays unavailable. This is search preparation, separate from Readiness or Review completion.

## What Review receives and what is billed

1. Source preparation parses/stages the exact saved text and creates document/code vectors through the saved embedding provider.
2. The completed local native index is archived in private Supabase Storage; compatible members download it for local search.
3. Review searches locally. A semantic query may need a small query embedding. The text model receives retrieved original text/code ranges, their identities and necessary context—not vector coordinates.
4. Independent selected-source sweeps and frozen citation validation remain mandatory. Ready vectors do not establish whole-system review coverage or finding truth.

Background document embedding rows retain `review_session_id=null`, project/owner, `source_indexing`, actual nullable provider counters, exact source attribution where available, `indexTrigger=source_changed` and the compatible `indexFingerprint`. Query/Review rows remain distinguishable. Safe recent-usage projection exposes the trigger/fingerprint. Compare preparation plus Review cost; moving the work earlier is not itself token savings. Recent-call lists remain bounded and do not substitute for the durable full ledger.

## Scope and limits

- Supported text repository/document inputs reuse the existing frozen-source reader. This adds neither PDF/Office extraction nor an external filesystem watcher. Reimport/sync is required to observe external changes.
- A version/hash/model/endpoint/dimension/chunk-policy mismatch produces a different index. The upstream tool may re-embed unchanged chunks when rebuilding a different complete identity; incremental-only embedding savings are not claimed.
- Project source preparation indexes the current project scope. A narrower/historical Review with a different exact scope may need a separate compatible index. All identities preserve owner-local cache isolation and project-member archive access.
- The retention readiness RPC must pass before embeddings. Saved configuration changes are checked in the compatibility fingerprint; changing settings alone does not initiate a paid rebuild.
- Lease expiry and upstream partial-index recovery may repeat embeddings from an interrupted build. This is not exactly-once provider billing.

## Acceptance and verification

Prepared Review policy: `review-2026-10-27-source-event-indexing-v19`. Baseline Git revision remains `476a506054c4987fce3fb89f450d7e10955df175`; unrelated dirty-tree changes are preserved.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Source triggers | Successful import/update queues before Review; partial sync completes first; Resume covered | Implemented; coordinator, source worker and real HTTP fixtures pass | Authenticated live source-event run pending |
| Version and concurrency | Exact identity; one live lease; cancellable cross-device Review wait; stale publication guard | Implemented; conditional PostgREST request/store and native-index fixtures pass | Live multi-device/database race not exercised |
| Owner capacity holds | No automatic resume; another member's lease survives; ownership transfer retains original hold | Implemented; independent Sol review found no remaining blocker; coordinator/store regressions pass | Provider billing remains external; interrupted upstream work may repeat |
| User action and accounting | Visible status/resume, unavailable remains unknown; preparation cost retained outside Review | Implemented; UI/usage fixtures and production build pass | No live total-token saving or semantic quality acceptance follows |

Final test counts, screenshots, runtime provenance and sign-in state are recorded in PROGRESS.md and the ignored evaluation evidence directory. Earlier v18/v17 reports remain historical. The full five-repository semantic acceptance task remains open until complete live executions and unchanged gold adjudication pass.
