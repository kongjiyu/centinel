# Local repository index synchronization

## Build and sync triggers

- Successful source imports/updates persist a background indexing/embedding job. Explicit Review can also prepare a missing exact index and shares the same build lease. Ordinary reads create no new paid job; they may recover already recorded source-event work.
- Startup sync compares the latest imported artifact versions and hashes with the saved embedding configuration. A matching published identity may be downloaded into the member's owner-scoped local cache. This download path validates the archive and does not call an embedding provider.
- A source import or completed connected-source sync that records a new artifact version/hash queues the changed identity, so an older publication cannot satisfy the new version. Missing indexes can also be prepared explicitly from Source. Paused provider jobs require an explicit owner resume.
- Only a completed, closed index is published. Its archive is immutable and its project-visible publication records the exact source version/hash and embedding/index compatibility identity.

## Compatibility and limits

- Compatibility includes the project, artifact IDs, frozen version IDs, paths and content hashes, index engine/policy, embedding provider/model/dimensions and endpoint hash. The member's provider key and machine-local paths are excluded.
- Startup sync only downloads a previously published archive for the exact current identity. It does not run `index_codebase`, call the embedding bridge, or create a publication for a partial index. A later explicit Review restores a prefetched archive into a fresh stage and requires native index status plus exact frozen-source checks before using it.
- The app does not watch arbitrary local filesystem edits. Unsaved or unimported changes do not alter artifact hashes and therefore are not visible to compatibility checks.
- Reusing a compatible archive can avoid rebuilding the index, but the workflow does not guarantee that a future explicit Review will embed only newly changed documents. Incremental-only embedding is not an acceptance claim.
- Index archives are rebuildable derived data. They are not source evidence: retrieval locations are reconstructed from the frozen source content, and existing independent source sweeps remain required.
- This change does not add PDF/Word text extraction. Only sources already available as supported frozen text can participate; a document upload alone does not establish that its text was successfully indexed.

## Workspace integration

The signed-in workspace starts a nonblocking pass five seconds after mounting. It reads the already-loaded project IDs, uses at most two transfers concurrently, and rotates through at most 20 projects per pass. A 30-second timer and window focus check for a pass due at least five minutes after the previous pass. Cleanup cancels outstanding transfers when leaving the workspace or changing accounts. Project-list rendering does not wait for these requests.

Authenticated GET `/projects/:projectId/repository-index/sync` inspects the exact current metadata/configuration identity. POST on the same route downloads only a matching completed publication. GET has a 30-second response deadline; POST has 60 seconds, with caller/disconnect cancellation. Neither route has an embedding or native-index execution seam. The later explicit Review validates frozen sources, restores into a fresh stage, and requires native readiness before retrieval.

## Verification

The backend's 19 targeted tests cover publication, stale identity isolation, another simulated member, unchanged reuse, tampering, concurrent different archive serializations, unsafe restore links, and prefetch consumption without rebuilding. Coordinator tests cover background startup, two-worker concurrency, failure recovery and sign-out cancellation. Route checks enforce membership before metadata access and verify cancellation when an adapter ignores the abort signal. These tests do not establish true second-device/live Supabase behavior.
# Source-event amendment (27 October 2026)

The user's later request supersedes the explicit-Review-only build trigger below. Successful source imports/updates now persist a background indexing/embedding job; Review joins or restores that exact compatible index. Startup archive transfer itself remains embedding-free, though authenticated status reads can recover an already recorded source-event job. See [SOURCE_EVENTS.md](SOURCE_EVENTS.md) for owner-scoped capacity holds, leases, manual resume and verification limits. Statements below about explicit-Review-only builds describe the preceding v18 phase.

