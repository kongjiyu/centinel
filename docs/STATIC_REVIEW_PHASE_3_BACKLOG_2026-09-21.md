# Static Review Phase 3 Recursive Backlog

Phase 3 contains every in-scope acceptance item that remained incomplete, partially implemented, failing, or externally unverifiable after Phases 1 and 2. Items are removed only after repository evidence and executed verification prove the acceptance criterion.

## Carryover from Phase 1

### Supabase authority

1. Migrate Project, Project Source, Artifact, Artifact Version, Requirement, Requirement Mapping, Model Provider Settings, Integration, Project Assessment, and remaining report routes away from authoritative SQLite reads and writes.
2. Upload artifact content to private Supabase Storage and make artifact versions/content hashes the immutable Review input. Local files may be caches only.
3. Replace SQLite-backed repository indexing/context retrieval with a durable Supabase knowledge index plus optional rebuildable local cache.
4. Exercise the Phase 1 SQL migrations against a real local or hosted Supabase database and verify all RLS and Storage policies with two-user isolation tests.
5. Execute the legacy migration against a representative real Centinel database and reconcile record counts, hashes, attachments, and storage objects.

### Static Review runtime

6. Load the primary and fallback static-analysis providers from encrypted Supabase Model Provider configuration instead of SQLite settings.
7. Complete fallback configuration UI and prove the three-total-attempt budget across primary and fallback providers end to end.
8. Make artifact ingestion, indexing, and context retrieval natively abort-aware so Cancel can stop work inside those stages rather than immediately after they return.
9. Add durable worker leasing/recovery so queued or running Reviews recover honestly after sidecar restart instead of remaining stranded.
10. Refresh or safely replace the RLS-scoped Supabase client used by a long-running cached Review runtime when the user's access token refreshes.
11. Add authenticated HTTP integration tests for Start, list, get, cancel, retry, findings, evidence, decisions, usage, idempotency, and cross-user denial.
12. Run a credentialed end-to-end Review against real project artifacts and a configured Model Provider.

### Authentication and decisions

13. Perform live Google and GitHub identity-linking callbacks with Supabase manual identity linking enabled and configured redirect allow-lists.
14. Move Review decision attachments to private Supabase Storage and remove the temporary `decision_attachments_pending` response.

### Cleanup deferred until Phase 2 audit

15. Remove superseded SQLite repositories, legacy Review persistence, unused provider-specific smoke paths, obsolete imports, and dead UI only after Phase 2 acceptance has been reviewed and no accepted workflow depends on them.

## Carryover from Phase 2

See `STATIC_REVIEW_PHASE_2_ACCEPTANCE_AUDIT_2026-09-22.md` for evidence.

16. Replace every legacy SQLite read in the report snapshot builder with one authenticated Supabase snapshot adapter covering project metadata, artifacts/versions, requirements/mappings, reviews/findings, decisions, assessment, model usage, and the latest existing Dynamic summary.
17. Add authenticated project report history/list and signed-link regeneration endpoints/UI for immutable existing exports.
18. Populate structured standard rules and finding correlation/recurrence in the report snapshot instead of returning unavailable when Supabase records exist.
19. Run live report Storage/RLS/expiry/cleanup checks with two Supabase users.
20. Apply and smoke-test connected-source migrations and GitHub, Google Drive, and Slack flows with real configured credentials.
21. Add Slack Events API ingestion or a bounded periodic full reconciliation so edits, deletions, and replies on older threads become visible.
22. Recursively baseline newly-created Google Drive folders discovered by the incremental changes feed.
23. Detect insufficient Slack scopes and guide existing users through reauthorization before private-channel/attachment sync.
24. Add project UI for requirement-candidate review/confirm/reject and structured standard-rule list/enable/disable.
25. Add explicit reviewer disposition for possible evidence contradictions and extend contradiction detection beyond conservative lexical matches without silently asserting semantic conflict.
26. Make Request Changes decision persistence, parent transition, and prepared-child creation one atomic Supabase operation with idempotent recovery.
27. Supply connected-source availability/staleness state to every Review evidence-sufficiency execution path.
28. Store Review decision attachments in private Supabase Storage and expose metadata/signed retrieval under project membership RLS.
29. Apply all migrations and run two-user RLS isolation tests against a real local or hosted Supabase database.
30. Reauthorize existing Slack connections for expanded scopes during credentialed validation.
31. Make project and artifact deletion recoverable across Supabase rows and private Storage. A bearer-scoped SQL RPC now commits metadata deletion with an exact private-object manifest, and the sidecar retries interrupted Storage cleanup on the next authenticated project load. Local failure-path tests pass; apply `202609250001_storage_deletion_jobs.sql` and verify Storage RLS and cleanup with two real users before accepting the live criterion.

## Recursive completion rule

For every remaining item:

1. Write or update the acceptance test at the highest available interface.
2. Implement through the established authentication, repository, Review orchestration, connected-source, or report seam.
3. Run targeted verification and the complete affected suite.
4. Re-audit the acceptance criterion.
5. Keep any incomplete or failing criterion in this document with current evidence and the next concrete action.
6. Repeat until the backlog is empty or the only remaining verification requires an external credential or unavailable provider service.
