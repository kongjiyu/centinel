# Static Review Phase 2 Acceptance Audit

## Verified complete in the repository

- Project Detail owns `Start Review` and `Export report`; Dynamic Test Detail has no export action.
- One frozen report snapshot drives canonical JSON, Markdown, and PDF rendering. Private Supabase persistence uses immutable object paths, checksums, compensating cleanup, and 15-minute signed URLs.
- The representative five-page PDF was rendered with Poppler and visually inspected after a blank-page pagination defect was fixed.
- GitHub, Google Drive, and Slack implement the shared connected-source interface for status, browse, import, revision-aware synchronization, resume, history, and disconnect.
- Connected source routes use the bearer-authenticated request identity, an RLS-scoped Supabase client, and explicit project membership checks.
- Project Sources now exposes provider browsing, selection, import-and-sync, current source status, manual synchronization, and synchronization history. Disconnected providers route to Settings.
- Requirement candidate extraction remains pending until explicit confirmation; structured standards retain source provenance and enabled state.
- Evidence sufficiency is persisted, exposed by an authenticated route, and presented in Review Detail with actionable remediation.
- Request Changes prepares an immutable child Review without model execution. The reviewer explicitly chooses frozen-source reuse or refresh and explicitly starts the child.
- Parent/child findings are correlated as new, recurring, carried over, resolved, or regressed; Review Detail presents the persisted comparison and discloses ambiguous matches.
- Complete local gates pass: sidecar TypeScript, 38 sidecar files / 316 tests, frontend TypeScript, 27 frontend files / 149 tests, and the production frontend build. The build has only the known large-chunk warning.

## Incomplete, partial, or externally unverifiable

Every item below is transferred to Phase 3; none is treated as accepted by implication.

1. The report snapshot builder still reads several legacy SQLite modules. It must read projects, artifacts/versions, requirements, mappings, reviews, findings, decisions, assessments, usage, and Dynamic summaries from the authenticated Supabase data layer.
2. Report history/list and signed-link regeneration endpoints are absent. The export response is complete for the immediate download, but an existing immutable export cannot yet be reopened from project history.
3. Report rendering currently marks structured standard rules and recurring/correlation classification unavailable when the legacy snapshot input cannot supply them. The Supabase snapshot adapter must populate both.
4. Report storage, RLS isolation, signed URL expiry, and cleanup were verified with mocks and local PDF inspection, not a live Supabase project.
5. Connected-source migrations and provider flows were not exercised against live Supabase, GitHub, Google Drive, or Slack credentials.
6. Slack timestamp polling cannot reliably discover edits/deletions in older messages or new replies on older threads. Add an Events API feed or scheduled full reconciliation.
7. Google Drive incremental sync does not recursively scan a newly-created nested folder discovered by the changes feed.
8. Existing Slack connections require reauthorization for expanded private-channel and attachment scopes.
9. Requirement candidate confirmation and standards enable/disable have authenticated backend routes but no complete project management UI.
10. Evidence contradiction discovery is conservative lexical matching; semantic contradiction review and explicit human disposition are not implemented.
11. Request Changes decision persistence, parent transition, and child preparation are not one database transaction. A child-preparation failure can leave a persisted changes-requested parent without its child.
12. Source freshness in evidence sufficiency is only as strong as the route/runtime source-state adapter; it is not yet supplied from every connected-source state during Review execution.
13. Decision attachments remain rejected with `decision_attachments_pending` instead of being stored in private Supabase Storage.
14. The Phase 2 SQL migrations and their RLS policies were not applied and tested with two real users because no Supabase CLI/database credentials were available.

## Gate evidence

- `pnpm --filter @centinel/sidecar exec tsc --noEmit` — passed.
- `pnpm --filter @centinel/sidecar test` — 38 files, 316 tests passed.
- `pnpm --filter centinel exec tsc --noEmit` — passed.
- `pnpm --filter centinel test` — 27 files, 149 tests passed.
- `pnpm --filter centinel build` — passed; Vite reported the existing chunk-size warning.
- PDF operation marker — ran exactly once; representative output rendered to five pages and passed visual inspection.

