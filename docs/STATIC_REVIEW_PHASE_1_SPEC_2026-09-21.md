# Static Review Phase 1 Specification

## Problem Statement

Centinel currently contains useful project, artifact, review-result, model-provider, and Supabase building blocks, but they do not form a complete static-review system. Durable product data remains split between SQLite, the local filesystem, and Supabase. Several sidecar routes trust a caller-supplied user identifier instead of consistently validating the signed-in user's bearer token. The Review entry surface and Review creation route do not execute a live review. Existing deterministic analysis, context retrieval, evidence snapshots, findings, risk assessment, approval, and model usage features are therefore disconnected.

This prevents a signed-in user from reliably starting, monitoring, cancelling, retrying, reviewing, and approving a static analysis whose inputs, evidence, findings, usage, and lifecycle are durably stored under Supabase row-level security.

## Solution

Phase 1 will make Supabase the authoritative durable data layer for the in-scope static product workflow, introduce one consistent authenticated-request gateway, support explicit identity linking, and connect the existing static-analysis building blocks through a single static-review orchestration interface.

The configured Model Provider will support static analysis with a maximum of three total attempts per model operation, optional configured fallback, complete usage accounting, and cancellation. Project Detail will retain Start Review and Export Report in its Action dropdown. Review Detail will own state-gated Cancel and Retry actions. Completed analysis will persist immutable source, evidence, traceability, findings, risk, usage, and decision data in Supabase.

Local repository clones, temporary extraction directories, and rebuildable caches may remain local. They are not authoritative product records.

## User Stories

1. As a signed-in user, I want my projects stored in Supabase, so that they remain available across application restarts and devices.
2. As a project owner, I want project membership enforced by Supabase row-level security, so that another user cannot access my project by guessing its identifier.
3. As a project member, I want artifacts and their versions stored durably, so that a Review can identify the exact material it analyzed.
4. As a reviewer, I want requirements, standards, and their mappings stored with the project, so that static analysis can use consistent grounding.
5. As a reviewer, I want Review sessions and progress stored durably, so that closing the desktop application does not erase Review history.
6. As a reviewer, I want source manifests and traceability snapshots to be immutable per Review, so that historical results do not change when the project changes.
7. As a reviewer, I want findings and finding-state history stored durably, so that acceptance, dismissal, and remediation remain auditable.
8. As an approver, I want decisions and attachments stored securely, so that approval history remains available and attributable.
9. As a user, I want model settings, usage records, and audit events persisted, so that I can understand which provider was used and how much it consumed.
10. As a user, I want integration connection metadata and encrypted credentials stored securely, so that connection state survives application restarts.
11. As an existing user, I want an idempotent migration of my local records, so that moving to Supabase does not duplicate or silently discard data.
12. As an operator, I want migration dry-run and reconciliation results, so that data parity can be verified before local storage is retired.
13. As a signed-in user, I want every protected sidecar request to validate my bearer token, so that caller-controlled identity headers cannot impersonate another user.
14. As a signed-in user, I want expired sessions reported consistently, so that the desktop application can return me to sign-in instead of failing unpredictably.
15. As a project member, I want authorization to be derived from my verified identity and membership, so that access rules are consistent across every route.
16. As an email user, I want to explicitly link Google or GitHub to my existing account, so that all sign-in methods open the same Centinel account.
17. As a social-sign-in user, I want to explicitly add an email or another social identity, so that I have more than one usable sign-in method.
18. As a user, I want identity conflicts blocked rather than silently merged by matching email text, so that accounts cannot be taken over accidentally.
19. As a user, I want the application to prevent removal of my final sign-in identity, so that I cannot lock myself out.
20. As a project member, I want to start a Review from Project Detail's Action dropdown, so that the existing project workflow remains familiar.
21. As a reviewer, I want to choose the Review scope from current project artifacts, requirements, and standards, so that analysis is deliberate.
22. As a reviewer, I want Centinel to freeze source versions at Review start, so that findings are reproducible.
23. As a reviewer, I want static analysis to use deterministic checks and the configured text Model Provider, so that results combine repeatable rules with contextual analysis.
24. As a reviewer, I want every finding tied to evidence, an artifact version, and an applicable requirement or standard when available, so that the finding is actionable.
25. As a reviewer, I want overlapping analyzer results normalized and deduplicated, so that the findings list does not exaggerate risk.
26. As a reviewer, I want analysis progress persisted by stage, so that Review Detail honestly communicates queued, running, blocked, failed, cancelled, pending-approval, and completed states.
27. As a reviewer, I want to cancel a queued or running Review from Review Detail, so that unnecessary model usage and processing stop promptly.
28. As a reviewer, I want cancellation to abort active processing rather than only change a status field, so that resources are actually released.
29. As a reviewer, I want to retry a failed, blocked, or cancelled Review from Review Detail, so that I can recover without recreating its configuration.
30. As an auditor, I want Retry to create a child Review and retain the original attempt, so that failure history remains immutable.
31. As a reviewer, I want duplicate Start, Cancel, and Retry submissions to be idempotent, so that repeated clicks cannot create conflicting work.
32. As a reviewer, I want a model request to make no more than three total attempts, so that transient failures can recover without unbounded cost or delay.
33. As a reviewer, I want rate limits, timeouts, network failures, and retryable server failures retried with bounded backoff, so that temporary provider problems do not immediately fail the Review.
34. As a reviewer, I want permanent authentication and configuration errors to fail immediately, so that futile calls are not repeated.
35. As a reviewer, I want an optional fallback model used only after the primary model's eligible attempts are exhausted, so that analysis can continue under a deliberate policy.
36. As a reviewer, I want partial deterministic results retained if every model provider fails, so that useful work is not discarded.
37. As a user, I want each model attempt recorded with provider, model, Review, stage, token counts, duration, and outcome, so that usage is transparent.
38. As a user, I want failed and retried calls included in usage reporting, so that the usage page represents actual provider activity.
39. As a reviewer, I want Review Detail to show the Review's model usage summary, so that I can relate cost to the analysis result.
40. As a user, I want cancellation to interrupt retry backoff and active model work, so that Cancel has immediate operational effect.
41. As an approver, I want completed analysis to enter pending approval, so that findings are not represented as approved automatically.
42. As an approver, I want approve, request-changes, and comment decisions to remain associated with the Review, so that governance remains intact.
43. As a report consumer, I want the existing project export action to continue working during the migration, so that Phase 1 does not regress reporting.
44. As a user, I want existing Dynamic records preserved during data migration without changing Dynamic Testing behavior, so that this static-focused phase does not destroy historical data.
45. As a maintainer, I want the static workflow to depend on domain repositories rather than directly on SQLite or Supabase tables, so that persistence behavior remains localized and testable.
46. As a maintainer, I want one orchestration interface for Review execution, so that routes and UI do not reproduce lifecycle, evidence, retry, or persistence logic.
47. As a maintainer, I want legacy persistence and blocked Review paths removed only after verified cutover, so that cleanup cannot destroy the working migration path.

## Implementation Decisions

- Supabase is the only authoritative durable store after Phase 1 cutover. SQLite and local JSON files are not fallback product databases.
- Local clones, temporary extraction data, and rebuildable analysis caches may remain local and must be clearly separated from authoritative records.
- Persistence will be exposed through domain repository interfaces for projects, membership, sources, artifacts, artifact versions, requirements, mappings, standards, reviews, evidence, decisions, findings, assessments, model configuration, model usage, integrations, sync records, and reports.
- The existing general store interface will be replaced or deepened rather than wrapped with another pass-through layer.
- Supabase schema changes will include the constraints, indexes, ownership fields, lifecycle fields, idempotency keys, lineage fields, and storage metadata required by the interfaces.
- The vector extension and durable embedding records will be introduced for artifact, requirement, and standard chunks. Embeddings are an optimization and retrieval mechanism; exact provenance records remain authoritative.
- Storage buckets will keep project artifacts, Review evidence, decision attachments, and reports private. Object paths will be project-scoped and protected by membership-aware policies.
- OAuth refresh tokens, integration access tokens, and Model Provider secrets stored in Supabase will be encrypted before persistence. The encryption key will not be stored in Supabase or exposed to the frontend.
- The service-role key is limited to migrations and explicit administrative tooling. The running desktop application and sidecar use the user's access token and Supabase row-level security.
- A one-time migration module will support dry-run, idempotent upsert, resumability, checksums, record-count reconciliation, storage upload reconciliation, and a machine-readable failure report.
- Migration will not delete the user's local data. Legacy data deletion is a later explicit cleanup step after acceptance verification.
- All protected sidecar routes will cross one authentication seam. The gateway validates the bearer token, resolves the canonical Supabase user, creates a user-scoped Supabase client, and makes verified identity available to route implementations.
- Caller-supplied user identifiers may be retained only as non-authoritative diagnostics. They cannot grant access or override the verified user.
- Authorization failures use consistent status semantics: unauthenticated is `401`, authenticated without membership is `403`, missing resources visible to the caller are `404`.
- Identity linking is explicit and begins from an authenticated account. Email equality by itself does not authorize a merge.
- An identity already owned by another canonical account cannot be linked automatically. The interface presents a recovery path and does not reveal sensitive account information.
- A user cannot unlink their final usable identity. Linked identities share one canonical user identifier and therefore the same projects, integrations, reports, and membership.
- Static Review execution will live behind one `StaticReviewOrchestrator` interface supporting start, cancel, and retry. Route implementations will not orchestrate individual stages.
- The orchestrator implementation will internally use context building, evidence sufficiency, deterministic verification, model verification, normalization, deduplication, traceability, risk calculation, and persistence seams.
- Existing repository indexing, context retrieval, deterministic static analysis, risk policy, evidence snapshot, finding, decision, and usage implementations will be adapted into the orchestrator instead of duplicated.
- Review execution freezes an immutable source manifest before analysis. Each artifact reference identifies its durable version and content hash.
- Finding provenance includes the originating Review, verifier, artifact version, location, evidence, applicable requirement or standard, severity, priority, confidence, recommendation, and stable correlation fingerprint.
- Model-assisted analysis uses the text Model Provider configured in Settings. Static analysis will not read removed provider-specific environment variables.
- Each model operation permits three total attempts, including the first request. Eligible retries use exponential backoff with jitter and honor provider retry hints.
- Retryable failures include transient network errors, timeouts, rate limits, and retryable server errors. Invalid credentials, invalid model configuration, permission failures, and other permanent client errors are not retried.
- A malformed structured response may consume a subsequent attempt through a constrained repair request. Every provider request counts toward the three-attempt limit.
- Fallback is explicit configuration. It is used after the primary's eligible attempts are exhausted and is not used to conceal invalid credentials or unsupported configuration.
- Every attempt emits a usage/audit record, including attempts without provider-reported token counts. Records identify the Review, project, stage, attempt number, provider, model, duration, outcome, and available token/cost data.
- Cancellation propagates through an abort signal to ingestion, indexing, verification, retry waits, and model requests. A cancelled Review cannot later transition to success.
- Retry creates a new Review with parent lineage. It does not overwrite or resume the immutable failed record. The user may explicitly choose whether to reuse or refresh the source manifest.
- Start Review and Export Report remain in Project Detail's Action dropdown. Cancel and Retry are direct, state-gated actions in Review Detail.
- Existing decision behavior remains: completed analysis waits for approval, and approve, request changes, and comment are persisted separately from per-finding state.
- Dynamic Testing execution is not changed. Existing Dynamic records are included only in persistence migration where needed to eliminate split authority and prevent historical data loss.
- Phase 1 cleanup removes superseded persistence and blocked Review implementations only after the acceptance gate passes. Any failing, partial, or unverifiable acceptance item is moved to Phase 3 rather than being represented as complete.

## Testing Decisions

- Tests will exercise the highest available interface: authenticated HTTP behavior for product flows, repository interfaces for persistence contracts, and the orchestrator interface for Review execution. Internal helper structure is not a test contract.
- Supabase repository contract tests will run against a controlled Supabase test project or local Supabase stack and verify mapping, constraints, storage paths, and RLS-visible behavior.
- Authentication integration tests will cover missing tokens, malformed tokens, expired tokens, valid users, non-members, members, and attempts to spoof a user header.
- RLS tests will create two users and prove that neither can read or mutate the other's projects, artifacts, reviews, findings, evidence, usage, integrations, or reports.
- Identity tests will cover linking Google and GitHub to an authenticated account, identity conflicts, callback cancellation, duplicate callbacks, unlink protection, and session continuity.
- Migration tests will use representative legacy SQLite and filesystem fixtures, run migration twice, and verify idempotency, checksums, counts, resumability, and failure reporting.
- Review orchestration tests will cover success, deterministic-only partial success, model failure, evidence insufficiency, cancellation at each long-running stage, and process restart recovery.
- Retry-policy tests will prove that no operation exceeds three attempts, permanent failures do not retry, backoff honors cancellation, fallback ordering is deterministic, and all attempts create usage records.
- Review lifecycle tests will cover queued, running, blocked, failed, cancelled, pending approval, approved, and changes-requested states, including invalid transitions.
- Idempotency tests will repeat start, cancel, and retry requests and verify that duplicate sessions or conflicting transitions are not created.
- Finding tests will verify complete provenance, normalization, stable correlation fingerprints, deduplication, source-version association, and shared risk-policy output.
- Frontend tests will verify Project Detail retains Start Review and Export Report, Review Detail owns Cancel and Retry, controls are state-gated, and model usage is displayed without credentials.
- Regression tests will verify project report export and existing historical Review presentation continue to work after persistence cutover.
- The smallest relevant test suites will run while iterating. Phase 1 acceptance requires the complete frontend and sidecar suites plus production frontend build and sidecar TypeScript validation.
- User-facing Review surfaces will be verified at 1440×900, 1200×900, and a narrow viewport in accordance with the design contract.

## Out of Scope

- New Dynamic Testing behavior, browser orchestration, personas, target-site execution, screenshots, or dynamic-analysis changes.
- Phase 2 report expansion, PDF generation, report snapshot redesign, and report delivery integrations.
- Phase 2 GitHub repository browsing, Google Drive browsing, Slack channel browsing, and incremental connected-source synchronization.
- Phase 2 standards authoring, advanced requirement elicitation, cross-Review finding correlation, and request-changes re-analysis beyond preserving current decisions.
- Automatic merging of separate canonical user accounts based only on matching email addresses.
- Deleting the user's legacy SQLite database or local artifacts during migration.
- Introducing provider-specific static-analysis environment variables.

## Further Notes

- The test seams and action placement were established in the preceding architecture plan and are treated as confirmed for this execution cycle.
- This specification is the Phase 1 execution source for the delegated implementation agents.
- After implementation, every acceptance criterion will be audited against repository evidence and executed checks. Any incomplete, partially implemented, failing, or externally unverifiable item will be copied into the Phase 3 backlog with its evidence and next action.
- Phase 2 receives its own specification and follows the same implementation and acceptance-review cycle.
- After Phases 1 and 2, superseded legacy code and UI will be removed only when no accepted workflow depends on it.
- Phase 3 is recursive: implementation and verification repeat until the in-scope backlog is empty or an item is demonstrably blocked by an external credential, provider configuration, or unavailable service.
