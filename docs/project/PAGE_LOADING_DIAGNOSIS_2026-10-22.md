# Project page loading diagnosis

## Answer

`GET /projects` returns project metadata only (name, description, local workspace path, ownership, timestamps). However, Home and Projects immediately enrich **every** project, not only the five visible directory rows. Before this change that required three requests per project: all Static Reviews, all Dynamic sessions, and the complete source-file inventory. It did not download each file's bytes, but computing that source inventory read every artifact and every historical artifact-version metadata row.

File content is downloaded through the authenticated artifact content reader when a preview is opened. Review detail and reconciliation have their own historical evidence reads. Thus “metadata only” describes the initial project-directory request, not the subsequent work triggered by the page.

## Confirmed causes and changes

| Cause confirmed in source | Effect | Change |
| --- | --- | --- |
| `useProjectSummaries` requests all artifacts for each project merely to test whether any exist | Work grows with total imported files and saved versions, even on Home / Projects | Member-checked `GET /projects/:id/artifacts?view=presence` selects at most one artifact ID and returns `hasSources`; failure remains unavailable, never “no sources” |
| Full Review rows selected for project summaries | Large scope/config/summary/progress JSON fetched and serialized for every historical Review | Optional `view=summary` selects identity/lifecycle/timestamps/failure reason and only the progress stage; full-detail endpoint behavior remains available |
| Project detail mounts Findings, Dynamic history, report history and Assessment for every section | Opening Source/Settings/Collaborators runs unrelated evidence queries | Gate work by active section; Source owns its inventory/connection reads; report history loads through its existing explicit action |
| Assessment effect depends on `projectFindings` and `staticSessions` array identity | Initial mount and each independently arriving array trigger repeated Assessment calls; Review polling can repeat it again | Assessment loads on its tab and on an active Review lifecycle change, not every array update |
| Findings and Assessment both derive current reconciliation from Review history | Each duplicate Assessment repeats finding/history/correlation/snapshot work, rather than merely returning a saved risk label | Stop invoking Assessment from other sections and stop the array-driven duplicate calls; preserve its current-risk evidence policy |
| Identical GETs have no shared in-flight identity | StrictMode and simultaneous parent/child consumers may duplicate reads | Coalesce identical pending reads by path + access token + user identity; remove entries on success/failure; do not cache completed results or combine writes |

For a direct Source entry, the ProjectDetail parent now makes zero Review-history, Dynamic-history, Findings, Assessment or report-history requests. The Source component still requests its real file inventory and connections. For an Overview entry, Assessment and report-history calls are eliminated; existing overview Findings, source-currency checks and saved history remain.

The directory still performs three small enrichment requests per project and uses at most four project workers (up to twelve requests in flight). It still needs all project activity metadata to preserve cross-project status filters, required-action ranking, and recent-activity ordering. This is a reduction in work/payload, not a new server-paginated or aggregated directory implementation.

## Runtime probes

- `pnpm dev:check`: sidecar, demo and Vite healthy/reusable. No existing process was restarted.
- Running sidecar `/health`, using the configured `localhost` origin: 52ms first request, then 4ms and 2ms. This endpoint bypasses authentication/database work. Its responsiveness does not prove project routes are fast.
- Configured Supabase `/auth/v1/health`, **without credentials**: 172ms, 132ms, 59ms; all responses were 401. These are network round trips only, not authenticated database or project-query timings. No response body, URL configuration, keys, or credentials were recorded.
- Authenticated project-load latency and payload sizes were **not** measured. No live before/after speedup percentage is claimed. Source inspection and executable request/query-budget checks establish the eliminated work.

## Verification

- Focused frontend checks: 52 tests passed before the final compatibility-response assertion was added. Coverage includes project metadata appearing progressively, source-presence failure, no source-inventory reads for summaries, Source-entry request budget, Assessment request count, in-flight deduplication, auth identity isolation, retry after failure, and unshared writes.
- Sidecar checks: 53 tests passed across page-load query budgets, authenticated HTTP authorization, and the Review repository. Tests enforce one-ID source presence, membership before lookup, heavy Review field exclusion, retained provider-pause stage, authenticated/unauthenticated/foreign-project handling, and existing full-read behavior.
- `pnpm --filter @centinel/sidecar exec tsc --noEmit`: passed.
- `pnpm --filter centinel build`: passed for the final implementation. Existing large-main-chunk warning remains.
- `pnpm --filter centinel test --maxWorkers=2 --testTimeout=15000`: **393 tests passed across 61 files**, including the final compatibility-response guard (108.03 seconds). No skipped tests or runner configuration changes.

## Compatibility and operational follow-up

Restart the original `pnpm dev` terminal to load the backend changes. The root launcher reuses healthy listeners, so launching another `pnpm dev` does not update an existing sidecar. Frontend source presence validates the response shape; an older sidecar returning an inventory is treated as unavailable rather than incorrectly showing setup required. Existing full artifact/Review routes retain their response contracts.

Authentication, membership checks, Review/current-finding semantics, immutable snapshots, source-content readers and durable storage are unchanged. Pending reads are shared only within the same credentials; every request made after settlement revalidates through the server. No cross-account data cache is introduced.

## Remaining limits

1. Source itself still reads complete artifact/version metadata to select current file versions. This scales with import and version history; a latest-version server projection would be a separate improvement.
2. Overview still needs Findings for its current attention list. Findings and Assessment still perform historical reconciliation; large histories can remain expensive. Do not replace them with stale or unverified risk labels to improve apparent speed.
3. Dynamic history still uses its existing complete-session endpoint. Cross-project directory activity remains proportional to project/session count; no server aggregation or pagination was added here.
4. No live authenticated performance acceptance, native WebView profiling or sustained-load test was performed. Build output retains the large main-chunk warning; this change does not claim to resolve cold renderer startup.

If a delay remains after the backend restart, capture the slow request's URL (without query secrets), duration and response size in the browser Network panel. Compare `/findings`, `/assessment`, `/artifacts`, and `/static-sessions` separately rather than attributing all loading to source-content downloads.

Authenticated follow-up (22 October 2026): metadata-only /projects measured 215ms / 5,712 bytes for 13 projects; bounded enrichment of the five assessment samples measured 771ms after metadata and 1,057ms on a second round including its directory read. No content requests. This small sample verifies the production read path, not a before/after speedup. See PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/FOLLOWUP_ACCEPTANCE.md for the saved probe and acceptance limits.
