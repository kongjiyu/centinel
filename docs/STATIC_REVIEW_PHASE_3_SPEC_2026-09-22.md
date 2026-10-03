# Static Review Phase 3 Recursive Completion Specification

## Problem Statement

Phases 1 and 2 established the authenticated Review lifecycle, model retry boundary, immutable Review evidence, report package, connected-source adapters, evidence sufficiency, and re-review correlation. Their acceptance audits also proved that Centinel still has split authority: several project, artifact, model, report, and indexing paths read or write SQLite while accepted Review records live in Supabase. Some workflows are locally complete but not live-service verified, and a few lifecycle operations are not transactional.

Phase 3 must close every remaining static-testing gap without narrowing the product scope. It is recursive: after each implementation wave, every incomplete, partial, failing, or externally unverifiable criterion remains in the Phase 3 backlog and becomes the input to the next wave. Dynamic Testing execution stays out of scope; its existing latest-session summary is only a read-only report input.

## Solution

Introduce one request-scoped Supabase application repository as the authoritative durable boundary for projects, members, sources, artifact versions/content, requirements, standards, Review lifecycle/evidence, assessments, model configuration/usage, integrations, and reports. Local SQLite/files may be used only for explicitly rebuildable caches, offline staging, or legacy import.

Complete the Artifact Verification workflow around immutable artifact versions, confirmed requirements, enabled standards, evidence sufficiency, deterministic and model analysis, human approval, atomic Request Changes iteration, finding correlation, risk assessment, and immutable reports. Remove legacy code only after all callers have moved and the complete affected suites pass.

## User Stories

1. As a signed-in member, I want every static-testing screen to show the same Supabase records, so that restarting the app or switching devices does not change authority.
2. As a reviewer, I want Review inputs to be immutable Storage-backed artifact versions, so that conclusions can be reproduced from hashes and provider revisions.
3. As a reviewer, I want indexing and context retrieval to be durable and rebuildable, so that local cache loss does not erase Review knowledge.
4. As a reviewer, I want my configured primary and fallback Model Providers used with a three-total-attempt budget, so that static analysis is reliable and auditable.
5. As a reviewer, I want cancellation to interrupt ingestion, indexing, context retrieval, and provider work, so that a cancelled Review stops promptly.
6. As an operator, I want queued/running Reviews to recover after sidecar restart, so that they do not remain stranded.
7. As a user, I want refreshed bearer tokens to replace stale request-scoped clients, so that long-running desktop sessions keep working without weakening RLS.
8. As an approver, I want Request Changes and child preparation to commit atomically, so that every saved verdict has its prepared revision.
9. As an approver, I want supportive decision attachments stored privately, so that feedback evidence remains available without local paths.
10. As a project member, I want requirement candidates and standard rules managed in the project UI, so that grounding decisions are explicit.
11. As a reviewer, I want connected-source staleness and access loss reflected in evidence sufficiency, so that stale evidence cannot silently pass.
12. As an integration user, I want Drive nested-folder changes and Slack edits/deletions/replies reconciled, so that synchronized evidence remains honest.
13. As a report consumer, I want report history and renewed short-lived downloads, so that immutable exports can be reopened safely.
14. As a report consumer, I want standards and correlation classifications in every applicable export, so that the UI and report cannot diverge.
15. As a maintainer, I want no executable legacy Review, duplicate report, unused provider-smoke, or obsolete UI path, so that there is one supported implementation.
16. As an auditor, I want two-user RLS and Storage isolation tests, so that membership boundaries are proved rather than assumed.

## Implementation Decisions

- A request-scoped `CentinelApplicationRepository` is constructed from the bearer-authenticated Supabase client. It must never fall back to a service-role key in the desktop runtime.
- Project membership is checked before every project-scoped command; the same RLS client performs all subsequent queries and Storage operations.
- Artifact upload creates a private Storage object and an immutable `artifact_versions` row with content hash, provider revision, source locator, and MIME metadata. Reviews freeze version IDs, not mutable artifact rows or local file paths.
- A durable knowledge index stores chunks and embeddings in Supabase. Local `.centinel` files are optional rebuildable caches and cannot make a Review succeed or fail.
- Model configuration is read from encrypted per-user/per-project Supabase records. A provider chain exposes primary then fallback under one three-total-attempt policy. Every attempt and token result is persisted without secrets or hidden reasoning.
- Review execution uses durable leases and checkpoints. Startup reconciliation requeues recoverable work and marks unrecoverable work honestly with an audit event.
- Cancellation is propagated with `AbortSignal` through Storage reads, indexing, retrieval, deterministic analysis, and provider calls.
- Runtime caches are keyed by canonical user plus access-token fingerprint or are rebuilt per request; stale RLS clients are never retained after token refresh.
- Request Changes uses one Supabase transaction/RPC to persist the decision, transition the parent, create the prepared child, save lineage, and record the idempotent operation.
- Decision attachments upload to `decision-attachments/<project>/<review>/<decision>/...`; metadata is committed only after uploads succeed, and failure performs compensating cleanup.
- Requirement-candidate and standards UI uses the authenticated Phase 2 routes and exposes provenance, confidence/version, confirm/reject, enable/disable, loading, error, and empty states.
- Connected-source evidence state is resolved from source and item status at freeze time and persisted in evidence sufficiency.
- Drive incremental folder creation starts a bounded recursive baseline for that folder. Slack supports an event cursor when configured and a bounded periodic reconciliation fallback.
- Report snapshots query only Supabase authority, include standards and correlation data when applicable, and persist all object paths. Report history regenerates signed URLs after membership checks.
- Legacy migration is explicit, idempotent, count/hash reconciled, and never runs silently on normal app startup.
- A legacy file may be deleted only after import/reference search proves no supported caller and complete relevant suites pass.

## Recursive Delivery Waves

### Wave 3A — Supabase authority and execution correctness

- Migrate projects, sources, artifacts/versions, requirements/mappings, assessments, integrations, model settings/usage, and report snapshot reads to the request-scoped repository.
- Store artifact bytes and decision attachments in private Storage.
- Add durable index/chunks and optional local cache rebuilding.
- Add primary/fallback Model Provider resolution, three-attempt usage/audit persistence, native cancellation, worker leasing/recovery, and refreshed-client handling.
- Make Request Changes plus child preparation atomic.
- Add authenticated HTTP and repository contract tests, including cross-user denial.

### Wave 3B — Product completion, reconciliation, and cleanup

- Add requirement-candidate and standards management UI.
- Complete source-state evidence integration, Drive nested-folder reconciliation, Slack events/full reconciliation, and scope reauthorization guidance.
- Add report history and signed-link renewal; populate standards/correlation in reports.
- Add contradiction disposition workflow.
- Execute legacy migration reconciliation, remove all superseded code/UI/tests/scripts, and document only current architecture/setup.

### Recursive audit wave

- Run the complete acceptance matrix after each wave.
- Fix every locally reproducible gap immediately.
- Retain only live-credential/service checks as external blockers, each with exact prerequisites and a runnable command or test.
- Repeat until the backlog contains only demonstrable external blockers or is empty.

## Testing Decisions

- Repository contract tests run against fakes for fast coverage and against a real local/hosted Supabase instance for final RLS/Storage acceptance.
- Two-user tests prove project, Storage, report, decision attachment, model configuration, and integration isolation.
- Authenticated HTTP tests cover project CRUD, artifacts, requirements, Review start/list/get/cancel/retry/iteration, findings, evidence, decisions, usage, reports, integrations, idempotency, token refresh, and cross-user denial.
- Crash/restart tests verify lease recovery and honest terminal states.
- Cancellation tests hold each execution stage and prove abort reaches the underlying operation.
- Provider-chain tests prove no more than three total attempts across primary/fallback and exact usage/audit records.
- Migration tests reconcile row counts, content hashes, relationships, attachments, Storage objects, and repeatability.
- Frontend tests cover candidate/standard decisions, report history, source reconciliation errors, contradiction disposition, and all accessibility states.
- Credentialed smoke tests cover GitHub private repositories, Drive native files/folders, Slack private channels/threads/attachments, identity linking, and report signed downloads.
- Completion requires sidecar/frontend TypeScript checks, complete suites, production build, migration/RLS verification, and targeted report PDF render inspection after any renderer change.

## Out of Scope

- New Dynamic Testing orchestration, browser missions, screenshots, or Dynamic Test Detail export.
- Public Storage buckets or permanent unauthenticated links.
- Provider write actions such as GitHub commits/issues, Drive writes, or Slack posts.
- Service-role credentials in the packaged desktop runtime.
- Automatic acceptance of extracted requirements, standards, contradictions, or ambiguous finding matches.

## Further Notes

- The authoritative backlog is `STATIC_REVIEW_PHASE_3_BACKLOG_2026-09-21.md`; this specification defines how it is closed.
- Phase 1 and Phase 2 audit evidence remains preserved in their dated specification/audit documents.
- GitHub issue publication remains unavailable because the GitHub CLI is not installed; this repository specification is the execution source.
