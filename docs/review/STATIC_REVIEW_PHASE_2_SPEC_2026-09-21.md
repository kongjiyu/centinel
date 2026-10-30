# Static Review Phase 2 Specification

## Problem Statement

Centinel's project reporting and external connections are not yet complete product workflows. Project export can produce a partial Markdown/JSON result, but it is not backed by one immutable report snapshot rendered consistently to every output. GitHub, Google Drive, and Slack can record OAuth connection metadata, but users cannot reliably browse, select, import, refresh, and audit connected content as governed project sources. OAuth refresh and revision-aware synchronization are incomplete.

The static Review workflow also lacks structured standards grounding, requirement/evidence elicitation, robust evidence-sufficiency feedback, cross-Review finding correlation, and a complete Request Changes to re-review loop. Legacy SQLite, provider-specific smoke, and blocked Review implementations must be removed after accepted replacements are verified.

## Solution

Phase 2 will introduce an immutable report snapshot interface, provider-neutral connected-source import and synchronization, structured standards and evidence grounding, and a Review iteration/correlation interface. Project Detail retains Export Report and Start Review in its Action dropdown. Dynamic Test Detail receives no export action. Existing Dynamic Test records may contribute a latest-session summary to the project report, but Dynamic Testing implementation remains unchanged.

All new durable records and files use the authenticated user's Supabase/RLS context and private Storage. Provider tokens refresh automatically and remain encrypted. A completed Request Changes decision creates a traceable child Review whose findings are classified as new, recurring, carried over, resolved, or regressed.

After Phase 2 acceptance review, superseded legacy implementations are removed. Any incomplete, partial, failing, or externally unverifiable acceptance item is moved to the recursive Phase 3 backlog.

## User Stories

1. As a project member, I want Export Report in Project Detail's Action dropdown, so that all project reporting starts from one predictable location.
2. As a Dynamic Test reviewer, I do not want a separate export action in Dynamic Test Detail, so that reports remain consolidated at project level.
3. As a report consumer, I want every export format generated from one immutable snapshot, so that JSON, Markdown, and PDF cannot disagree.
4. As a report consumer, I want the report to identify the project, generator version, generation time, actor, and risk-policy version, so that the output is auditable.
5. As a report consumer, I want the current project risk assessment, so that I can understand overall exposure.
6. As a report consumer, I want every available finding and its current state, so that accepted, dismissed, fixed, new, and carried-over issues are visible.
7. As a report consumer, I want reported findings separated from carryover and recurring findings, so that a Review does not claim older findings as newly discovered.
8. As a report consumer, I want the latest applicable Static Review summary and approval decision, so that the report represents governed analysis.
9. As a report consumer, I want the immutable Review source manifest, so that I know exactly which material was evaluated.
10. As a report consumer, I want requirements, standards, and traceability results included, so that conclusions can be traced to their grounding.
11. As a report consumer, I want evidence references and locations, so that findings can be reproduced and investigated.
12. As a report consumer, I want a model usage summary without credentials or hidden reasoning, so that automated analysis remains transparent.
13. As a report consumer, I want the latest existing Dynamic Test summary when one exists, so that the consolidated project report preserves previously requested coverage.
14. As a report consumer, I want an honest unavailable state when historical Review evidence does not exist, so that missing data is not represented as zero.
15. As a report consumer, I want downloadable JSON, Markdown, and PDF files, so that the report supports automation, review, and presentation.
16. As a project member, I want generated reports stored privately with short-lived download links, so that report files are not public.
17. As an auditor, I want report checksums and immutable metadata, so that exported content can be verified later.
18. As a user, I want a report failure to leave no partial record or orphaned object, so that report history remains trustworthy.
19. As a GitHub user, I want to browse repositories available to the connected repository OAuth identity, so that I can select the correct source without pasting a URL.
20. As a GitHub user, I want to import public or private repositories and select a branch, so that static analysis uses the intended revision.
21. As a GitHub user, I want imported artifacts associated with commit SHA and remote paths, so that Review evidence is reproducible.
22. As a GitHub user, I want optional pull-request context associated with a source, so that a Review can analyze a selected change.
23. As a Google Drive user, I want to browse accessible files and folders, so that I can select project documents.
24. As a Google Drive user, I want Google Docs and supported files imported with their Drive identifier and revision, so that updates do not create unrelated duplicates.
25. As a Slack user, I want to browse authorized workspaces and channels, so that I can select relevant discussions.
26. As a Slack user, I want messages, threads, and supported attachments imported with author, timestamp, channel, thread, and permalink provenance, so that conversational requirements remain traceable.
27. As an integration user, I want connection account, scopes, expiry, and status displayed, so that I understand what Centinel can access.
28. As an integration user, I want access tokens refreshed automatically, so that routine synchronization does not repeatedly require reconnection.
29. As an integration user, I want disconnect to revoke or discard credentials and stop synchronization, so that access ends predictably.
30. As a project member, I want to manually synchronize connected sources, so that I can request the latest revisions.
31. As a project member, I want synchronization history and actionable failures, so that I can understand whether project sources are current.
32. As a project member, I want incremental synchronization based on remote revisions, so that unchanged material is not duplicated or reprocessed.
33. As a project member, I want removed or inaccessible remote content represented honestly, so that stale evidence is not silently presented as current.
34. As a reviewer, I want requirements and acceptance criteria extracted from supported documents as candidates, so that I can confirm rather than manually transcribe everything.
35. As a reviewer, I want extracted requirements to retain source provenance and confidence, so that I can judge their reliability.
36. As a reviewer, I want candidate requirements confirmed before they become authoritative, so that model output cannot silently change project scope.
37. As a reviewer, I want coding standards parsed into structured rules, so that standards affect verification instead of remaining passive documents.
38. As a reviewer, I want standards rules enabled or disabled per project, so that irrelevant checks can be excluded deliberately.
39. As a reviewer, I want every standards-based finding to cite its standard and source location, so that the result is defensible.
40. As a reviewer, I want Centinel to explain missing or contradictory evidence before analysis, so that I can add the right material.
41. As a reviewer, I want evidence sufficiency recorded with the Review, so that blocked Reviews remain auditable.
42. As an approver, I want Request Changes to create a child Review carrying my feedback, so that revision is part of the lifecycle rather than only a comment.
43. As an approver, I want the original Review and its findings to remain immutable, so that history is not rewritten.
44. As a reviewer, I want the child Review to reuse the original source manifest by default, so that the comparison has a stable baseline.
45. As a reviewer, I want to explicitly refresh sources before re-review, so that I can evaluate newer revisions when intended.
46. As a reviewer, I want unchanged work skipped when safe, so that re-review can focus on affected artifacts and rules.
47. As a reviewer, I want findings classified as new, recurring, carried over, resolved, or regressed, so that changes are clear.
48. As a reviewer, I want stable finding correlation based on rule, source identity, location, requirement, and normalized evidence, so that minor wording changes do not break lineage.
49. As a reviewer, I want the Review comparison visible in Review Detail, so that I can understand the effect of requested changes.
50. As an approver, I want the revised Review to return to pending approval, so that it receives explicit sign-off.
51. As a maintainer, I want reports to consume the same risk, traceability, and correlation modules as the UI, so that duplicate calculations cannot diverge.
52. As a maintainer, I want integrations to satisfy one connected-source interface, so that provider differences stay inside adapters.
53. As a maintainer, I want legacy Review, persistence, provider-smoke, and duplicate report code removed after replacement verification, so that dead paths cannot be executed accidentally.
54. As a maintainer, I want every incomplete acceptance item retained in Phase 3 with evidence, so that partial implementation is not mistaken for completion.

## Implementation Decisions

- Reporting is exposed through one immutable report snapshot interface. Renderers consume the snapshot and cannot query mutable project state independently.
- A report snapshot includes generator and policy versions, project metadata, risk assessment, complete finding inventory and states, latest applicable Static Review, source manifest, traceability, requirements, standards, decisions, evidence references, model usage summary, and latest existing Dynamic summary when available.
- Dynamic data in reports is read-only input. No Dynamic Testing execution or UI behavior is changed.
- Report generation stores the canonical JSON snapshot first in the operation, renders Markdown and PDF from the same in-memory value, calculates checksums, uploads private objects, then commits one report record. Failure triggers compensating cleanup of uploaded objects.
- Download access uses short-lived signed URLs generated for an authenticated project member. Stored objects are never made public.
- Report exports are immutable. Regeneration creates a new export record.
- Project Detail retains Start Review and Export Report in its Action dropdown. Dynamic Test Detail has no export action.
- Connected source behavior is exposed through one interface for browse, select/import, synchronize, disconnect, and connection status. GitHub, Google Drive, and Slack are adapters at this seam.
- Integration OAuth and sign-in identities remain separate. Linking GitHub for sign-in does not grant repository access.
- OAuth access and refresh tokens are encrypted before Supabase persistence. Refresh is performed by the sidecar and updates encrypted credentials atomically.
- Provider refresh failures move a connection to expired/error without deleting source history. Reauthorization restores the existing connection when account identity matches.
- Source records preserve provider, remote identifier, remote URL, remote revision, sync cursor, selected scope, last successful sync, and latest error.
- Synchronization creates immutable artifact versions keyed by content hash and remote revision. Unchanged content is not duplicated.
- GitHub imports preserve repository, branch, commit SHA, remote path, and optional pull-request identity. Private repository contents use the connected repository OAuth token.
- Google Drive imports preserve file ID, MIME type, revision/version, modified time, and export format for native Google files.
- Slack imports preserve workspace, channel, message/thread identity, author, timestamps, permalink, and attachment provenance.
- Remote deletion or permission loss marks a source item unavailable/stale; it does not rewrite historical Review manifests.
- Requirement elicitation produces candidates with provenance and confidence. Candidates require explicit confirmation before entering the authoritative requirement set.
- Standards grounding parses coding-standard artifacts into structured project rules with stable identifiers, source locators, version metadata, and enabled state.
- Evidence sufficiency is a deterministic structured result containing readiness, missing evidence, contradictions, affected Review stages, and actionable remediation. A blocked Review persists this result.
- Review iteration is exposed through one interface that creates a child Review from a changes-requested parent, reviewer feedback, and a reuse/refresh source choice.
- Parent sessions and findings are immutable. Child Reviews retain lineage root and parent identifiers.
- Finding correlation uses a stable fingerprint and similarity inputs. Exact stable identifiers win; heuristic matches are disclosed and cannot silently merge unrelated Critical findings.
- Child findings are classified as new, recurring, carried over, resolved, or regressed. Reports and Review Detail use the same classifications.
- Request Changes does not itself execute a model call. The user starts the prepared child Review from Review Detail, preserving control over source refresh and cost.
- Legacy removal occurs only after all direct callers have moved to accepted replacement interfaces and the complete affected suites pass.
- Phase 2 acceptance review populates Phase 3 with every incomplete, partial, failing, or credential-blocked criterion.

## Testing Decisions

- Report tests exercise the snapshot interface and renderer outputs. Renderers are checked against the same fixture snapshot rather than mocking their internal formatting helpers.
- Golden/snapshot tests verify that JSON, Markdown, and PDF contain consistent project, finding, risk, traceability, decision, and evidence facts.
- Report transaction tests simulate each upload/database failure and verify no committed partial report or orphaned object remains.
- Report authorization tests prove non-members cannot create, list, or download exports and signed URLs expire.
- Connected-source contract tests run the same behavioral suite against GitHub, Google Drive, and Slack adapters using provider HTTP fakes.
- OAuth tests cover authorization URL, state validation, account identity, refresh, expiry, revocation, cancellation, provider errors, and encrypted persistence without logging secrets.
- Sync tests cover first import, unchanged refresh, changed revision, remote deletion, permission loss, partial provider pagination, rate limit, retry, and resume.
- Provenance tests verify provider identifiers and revisions survive import into artifact versions and Review source manifests.
- Requirement elicitation tests verify candidate-only behavior, confirmation, duplicate handling, provenance, and confidence.
- Standards tests verify parsing, stable rule identity, enable/disable behavior, versioning, and finding citation.
- Evidence sufficiency tests verify ready, missing, contradictory, stale, and inaccessible source states.
- Review iteration tests verify immutable parents, child lineage, feedback preservation, source reuse/refresh, state gating, and return to pending approval.
- Finding-correlation tests cover stable matches, file movement, wording changes, collisions, Critical finding safeguards, new, recurring, carried-over, resolved, and regressed states.
- Frontend tests verify Project Detail action placement, absence of Dynamic Detail export, integration browse/import/sync states, evidence-gap presentation, and Review comparison accessibility.
- Credentialed smoke checks are required for each configured provider but are recorded as externally blocked when credentials or provider approval are unavailable.
- Phase 2 acceptance requires complete frontend and sidecar test suites, frontend production build, sidecar TypeScript validation, and targeted PDF render inspection.

## Out of Scope

- New Dynamic Testing execution behavior, browser automation, visual analysis, missions, personas, screenshots, or Dynamic Detail export.
- Sending reports or messages outward to Slack, GitHub, Drive, email, or other recipients without a separate explicit user action and specification.
- GitHub write operations such as commits, pull-request creation, issue creation, or repository administration.
- Google Drive writes and Slack message posting.
- Automatic acceptance of model-extracted requirements or standards.
- Silent account merging or reuse of sign-in OAuth credentials for repository access.
- Public report buckets or permanent unauthenticated download links.

## Further Notes

- This specification is the Phase 2 execution source for delegated agents.
- The issue-tracker publication step is unavailable in this workspace because GitHub CLI is not installed; the project specification is retained locally.
- Phase 1 carryover remains in the Phase 3 backlog and is not hidden by Phase 2 work.
- After implementation, every Phase 2 criterion will be audited. Incomplete or unverifiable items will be appended to Phase 3 before legacy removal.
- Phase 3 will execute recursively until all in-scope criteria pass or only explicit external credential/service blockers remain.
