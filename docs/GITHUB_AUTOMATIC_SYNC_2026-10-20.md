# Automatic GitHub source synchronization

## Contract

The signed-in web and desktop workspace starts a background GitHub check after five seconds, wakes every 30 seconds, and also checks when the window regains focus. Each repository is eligible after five minutes since its latest attempt or recorded sync. A pass examines at most ten projects and starts at most one source sync. Projects rotate and the oldest eligible source wins, so a failing or busy repository does not starve the rest. Large fleets take longer than five minutes to visit. Closing the workspace or changing accounts cancels future work; an already accepted server request may finish. There is no synchronization while the app is closed and no webhook or operating-system watcher.

Every pass obtains the current account's projects and connected sources through the existing authenticated, membership-checked API. Only active GitHub repository sources enter this path. Local folders, local repository imports, Slack and Drive skip this GitHub check. Removed, inaccessible and disconnected sources require the existing access/reconnection flow. Only one pass runs at a time, failed attempts are throttled, provider retry timestamps are respected, and per-source time-bucket keys plus durable server leases guard duplicate imports.

The GitHub adapter resolves the selected branch, repository default branch, or selected pull-request head first. A matching, successfully completed imported SHA ends the run without fetching commit-tree metadata, trees, blobs or creating artifact versions. A different SHA imports the new pinned snapshot through the existing worker. This includes changed/rewritten refs; the implementation compares SHA identity rather than pretending to know an exact number of commits behind. The app imports source snapshots through GitHub's read-only API; it does not execute `git pull` or alter a local checkout.

An incomplete or failed import cannot use SHA equality as proof of completion. It resumes its saved revision/cursor, completes that snapshot, then checks the current head on a later pass. Older tree-SHA cursors remain supported. A failed head lookup does not report the repository as current. A completed unchanged check remains visible in sync history, but its new run ID does not invalidate readiness. If readiness queued while the check was active, the previous matching assessment is reused. Explicit manual readiness reassessment still runs, and provider-paused readiness still requires a manual resume.

## Source coverage follow-up

Plain-text extensionless files and dotfiles now enter GitHub import, including the Serve Static fixtures `test/fixtures/foo bar` and `test/fixtures/.hidden`, LICENSE/README and `.eslintrc`. Dots in parent directories do not change file classification. Candidate files must be valid UTF-8 without NUL bytes or ZIP/PDF signatures; binary candidates and oversized files are retained as explicit unsupported items. This is text import, not general binary/document extraction. Other unsupported extensions remain outside this text selection.

This selection change does not rewrite existing snapshots. A changed remote commit or an explicit full refresh (`force: true` on the authenticated source sync API) imports the additional files. The previously saved Serve Static Review and its coverage finding remain immutable; no live refresh, new Review or derived resolution is claimed by the fixture tests.

## Acceptance evidence

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Automatic trigger | Startup, periodic and focus checks; no overlapping passes; cleanup stops new work | Passed executable timer tests | Requires an open signed-in workspace; real account/native WebView not exercised in this change |
| Scope and fairness | Local/other providers excluded; inaccessible/busy/recent sources skipped; failed checks throttled; later sources visited | Passed fixture tests | Large fleets have bounded throughput rather than a guaranteed five-minute refresh |
| Commit comparison | Head request precedes content; same successful SHA causes zero tree/blob requests and no new artifact version | Passed actual GitHub adapter + importer with scripted HTTP | No live GitHub credentials used in tests |
| Changed commit | Import new pinned SHA and persist a new content version | Passed actual adapter + importer fixture | No numerical ahead/behind count or local checkout mutation |
| Recovery | Partial/failed snapshots are not falsely current; explicit force refresh works; durable worker/authentication contracts preserved | Passed importer/provider/worker and route regressions | Cross-process recovery continues to require valid bearer sessions |
| Readiness cost/pause | Unchanged run identity does not invalidate assessment; reuse previous matching snapshot; manual reassessment and capacity pause remain effective | Passed runtime/coordinator and provider-pause regressions | Does not establish model verdict accuracy |
| Additional text sources | Hidden/extensionless text imports; binary candidate becomes unsupported | Passed scripted provider fixture | Existing live source snapshots have not been refreshed |

Verification: **146 backend tests passed in 13 files**, including importer/provider/worker/routes, readiness runtime/coordinator/engine/evaluation/HTTP triggers, provider pause and finding reconciliation. **14 frontend integration/timer tests passed in 2 files** on the final code. The earlier full frontend run passed **341 tests in 59 files**; the final focused run includes the later fairness/retry additions. Frontend production build, sidecar TypeScript and whitespace checks passed. The existing large-bundle warning remains. No UI layout or styling changes were made, and native desktop/live account behavior was not exercised. The earlier 18 Windows Dynamic failures remain outside this scoped verification.

The inventory fingerprint no longer includes sync-run identity. Persisted snapshots produced by the older fingerprint calculation may need a one-time reassessment after upgrade; the no-repeat-assessment tests compare snapshots produced under the current calculation. Provider-paused jobs retain their manual-resume protection across this change.

## Remaining readiness assessment

The resumed real-model run used the existing configured `codex` / `gpt-5.6-sol`, unchanged policy `readiness-2026-10-19.4`, and nine remaining fictional cases. The selected subset hash is `1414d9e234ea2999bbe038f0d5ecc2b16811d5aedfd5999a75b285c6f5a4910d`; it is distinct from the complete eleven-case corpus hash.

- Vague requirements passed all measurable checks.
- Contradictory requirements reached the expected Incomplete state but failed scope acceptance: the raw scope check was pass, while scope coverage caused the engine's conservative gap verdict.
- Untestable requirements reached the expected Incomplete state but also flagged clarity, whereas the authored expectation was pass. The fixture contains “useful and quick”; criterion/fixture overlap needs examination before changing policy or expected labels.
- Exception handling stopped with `rate_limited`, without a semantic result. The five later cases were not attempted.

The runner stopped immediately on capacity failure with no retry/fallback or further model calls. The prior report was copied before the run; generated case results remain in ignored `evidence/readiness-outcomes-2026-10-19/live-codex-results.json`. Gold expectations were not weakened and no overall AI acceptance is claimed. Detailed model assessment work remains paused pending an explicit resume.
