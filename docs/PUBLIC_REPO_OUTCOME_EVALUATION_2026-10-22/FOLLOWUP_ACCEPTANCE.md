# Screenshot follow-up acceptance — 22 October 2026

**24 October addendum:** the Source UUID naming gap recorded below is superseded by the verified durable-source identity/path fix in [OFFLINE_FOLLOWUP_2026-10-24.md](../OFFLINE_FOLLOWUP_2026-10-24.md). Same-name repositories stay separate; existing Hello-World displays its saved name and README correctly. This later UI/API verification does not change the historical 22 October results or certify AI outcome accuracy.

The five requested checks were inspected and exercised after the public-repository assessment. Existing unrelated changes were preserved. The remaining production retry override was removed; Activity now displays the latest valid saved retry count and wait without exposing provider payloads.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| JWT/connection status | Specific future-issued JWT read recovery is bounded; temporary remote errors do not invalidate the session or fabricate a disconnection | Passed controlled transport/auth/frontend regressions; signed-in live workspace remained usable | A real upstream clock-skew incident was not induced. No OS clock changes or auth bypass. |
| Faster project loading | Project rows usable before enrichment; small presence and Review summary reads; no source content downloaded by directory | Passed request/query-budget tests and live authenticated probe | Not a controlled before/after speedup or sustained-load result; all-project enrichment remains proportional to project count |
| Background GitHub import | Creation persists project/source/queued run and returns before pulling; Source exposes progress; durable jobs recover conservatively | Passed handoff/worker/importer/HTTP regressions and live public import | Recovery tested with a fresh worker plus persisted job records, not forced production-process termination mid-write |
| Root Review creation | No null iteration insert; root payload uses `{}` | Passed Supabase repository regression; five real root Reviews created successfully | Later model/validation failures are separate from creation |
| Retry policy | Three non-AI / five AI total attempts; waits and attempt counts visible; capacity/auth errors stop appropriately | Fixed production override; helper/orchestrator/audit/UI regressions pass | No deliberate paid five-failure live campaign; original benchmark outcomes retained |

## Implemented mitigation

- Removed `retry: { maxAttempts: 3, maxTotalAttempts: 3 }` from production orchestration wiring. Production now uses the centrally bounded five-attempt default. The same total budget includes durable attempt offsets and configured fallback, rather than five attempts per provider. Permanent/capacity errors still stop immediately.
- Strengthened the orchestrator regression to assert four persisted retry updates with attempts 2–5, limit 5, and waits 1/3/7/15 seconds.
- Activity presents a polite status for the latest valid retry: request type, upcoming attempt and total limit, and wait. After termination it describes the saved schedule in the past tense. Foreign-Review events, invalid counters and invalid waits are excluded; provider/service payload strings are not rendered. Existing layout and styling are reused.
- Added a restart-contract regression: a new worker recovers persisted partial and expired-running jobs, leaves active leases alone and excludes foreign projects and failed retryable runs.

## Live evidence

Authenticated metadata probe: `evidence/public-repo-outcomes-2026-10-22/run-2026-10-22T09-13-31-758Z/0095-acceptance-probe.json`.

- `GET /projects`: 215ms, 5,712 bytes, 13 metadata records. No source content endpoint requested.
- Five-project enrichment with the production four-worker pattern: first round 771ms after directory metadata; second round 1,057ms including its directory request. This is a small two-round sample, not p95 or a before/after comparison.
- Source presence responses: 19 bytes each. Review summary responses about 644 bytes each. Empty Dynamic histories: 2 bytes each. The actual page visibly rendered selectable rows while activity enrichment was pending.
- Separate public GitHub import project: `eae271b4-0e7e-4d6e-83ff-c935396a2f78`, source `dd95737b-a71a-40cd-8007-c7e3e67a8887`, run `854ce121-ea48-4acf-9af2-3c0139277bae`. Imported one file from octocat/Hello-World at revision `7fd1a60b01f91b314f59955a4e4d4e80d8edf11d`; terminal Success, no error, no active lease. Source UI showed Completed. Successful durable queue/claim/import confirms the active database supports this path; no schema migration was performed.

The live import also exposed an existing Source naming gap: its top-level repository row displays a source UUID while Source updates correctly says Hello-World. This is outside the five screenshot checks and remains an explicit UI follow-up: carry the durable source identity/name into repository grouping rather than deriving the label from the storage path. Do not merge distinct repository sources merely because their imported files share a storage ancestor.

## Checks actually run

| Command / scope | Result |
| --- | --- |
| Sidecar retry/orchestrator/refreshed-runtime/Review repository/source worker/source routes/page queries/auth gateway | 100 tests passed, eight files |
| Sidecar JWT clock-skew/assessment schema/static context/static engine | 48 tests passed, four files |
| Sidecar project import/connected-source importer/authenticated HTTP | 48 tests passed, three files |
| New worker restart contract with worker suite | 5 tests passed |
| Frontend API/App loading/auth/project summaries/Projects/Project detail/Activity | 95 tests passed, seven files |
| Updated narrative/Activity retry behavior | 44 tests passed, two files |
| Source component regressions | 30 tests passed |
| Sidecar TypeScript; frontend production build | Passed; existing large-main-chunk warning remains |
| Metric scorer | Four Node tests passed; frozen specification and all 192 input hashes verified |

Counts above are per invocation; overlapping tests are not added into an inflated unique total. UI responsive checks and final cleanup are recorded below when completed.

Final UI verification: saved Activity inspected at 1440×900, 1200×900 and 390×844. Document scroll width matched viewport width at all three sizes; narrow Activity content wrapped and remained vertically scrollable. Breadcrumb/tab strips retain their intentional local horizontal scrolling. Viewport override restored. Retry status was verified through the rendered Activity regression; real baseline attempts contained no retry-scheduled events, so no synthetic operational event was inserted into the live product.

Runtime: root .env retained CENTINEL_AI_ASSESSMENT_PAUSED=1 and development services restarted with the same process hold. Temporary authenticated evaluation pages are removed after preserving their harness under ignored evidence. No commits, schema changes, external messages, upstream code execution or destructive project cleanup performed. The six created projects (five assessment samples and one explicit import acceptance case) remain available.
