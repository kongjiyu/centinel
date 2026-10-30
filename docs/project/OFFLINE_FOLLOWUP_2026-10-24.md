# Offline follow-up — 24 October 2026

The user's current instruction is to proceed only with work that does not require AI provider capacity. Model calls remain held (`CENTINEL_AI_ASSESSMENT_PAUSED=1` in root configuration and the restarted process). No model run, retry, fallback, provider switch or approval decision was requested. The five-repository AI benchmark remains **NOT_ACCEPTED**; these fixes do not change its semantic scores.

| Feature | Acceptance criteria | Status | Risk flags |
|---|---|---|---|
| Connected repository identity | Show persisted source name, separate distinct source IDs even when names match | Passed component/API regressions and live Hello-World check | Legacy/local sources without IDs retain the existing common-root grouping |
| Repository file navigation | Show original source paths, keep Storage identity and frozen evidence intact, no body prefetch for directory browsing | Passed regression; live saved README appears by name | Missing connection metadata uses neutral Imported repository; live GitHub authorization needs renewal for future sync |
| Review execution timing | Paused/stopped execution must not be labelled Completed; later decisions must not extend execution duration | Passed unit/component and live paused Review checks | Native app packaging and independent model review were not run |
| Model hold and benchmark integrity | No provider execution; unchanged frozen inputs/gold; existing blocked outcomes preserved | Pause regressions pass; all 192 files and frozen bundle verify | Live semantic acceptance still requires future explicitly authorized model execution |

## Specification and changes

1. Add optional nullable `Artifact.sourceId` to the existing client contract, populated from the durable artifact column. Never infer source identity from an imported metadata field, a display name or a storage directory. No migration or new query is required.
2. Preserve the artifact's Storage `filePath`. Prefer existing original-path metadata; for connected artifacts, use persisted `sourcePath` as the display-path fallback. Content hash, version ID, historical snapshots and source bodies remain unchanged.
3. Partition repository files by durable source ID. Resolve a name only from matching project-owned GitHub source metadata; use a neutral fallback when metadata is unavailable. Preserve the existing local/legacy grouping. Use stable group identity for row keys, focus restoration and removal targeting, so equal names cannot merge groups or close an unrelated repository view. No live removal was performed.
4. Rename the internal narrative stop boundary from `completedAt` to `endedAt`. Overview uses Paused at for provider pauses, Stopped at for failed/blocked/cancelled execution and Execution finished for successful execution. Execution timing continues to use saved harness boundaries and the existing conservative legacy fallback, independently of human approval timestamps. This is presentation only; execution status and persisted timestamps are not rewritten.

No CSS or visual tokens changed. Existing Source and Review structures are reused. DESIGN.md's state honesty, durable source evidence and responsive requirements govern this work; the UI guideline search returned no relevant status-timing match, so no unrelated database recommendation was applied.

## Checks actually executed

| Scope | Result |
|---|---|
| Frontend ArtifactsPanel, reviewNarrative, ReviewActivityScreen | **77 tests passed**, three files |
| Sidecar phase3Authority and pageLoadQueries | **25 tests passed**, two files |
| Sidecar providerPause, readinessRuntime, supabaseReviewRepository | **40 tests passed**, three files; fake-provider/transport fixtures only |
| Sidecar TypeScript | Passed |
| Frontend TypeScript + production Vite build | Passed; existing large-main-chunk warning remains |
| v7/v8/v9 scorer regressions | **11 tests passed**, three files |
| Trusted saved-result adjudication verifier | Passed; semantic verdicts remain unchanged |
| Frozen input/gold integrity | 192/192 selected files unchanged; frozen acceptance bundle valid |
| Development preflight | Sidecar, demo and app healthy/reusable after startup completed |
| Scoped whitespace checks | Passed; Git notes existing LF/CRLF normalization for artifacts.ts |

Counts are per invocation. Initial added Source test queries used two outdated accessible names; those queries were corrected to the actual directory count label and All sources navigation, then the complete three-file frontend invocation passed. No production behavior was weakened to satisfy the tests.

Self-review traced the authenticated artifact projection, trusted source column, per-project metadata matching, directory grouping/navigation and stable deletion identity; it also checked every caller of narrative timing. No independent model reviewer was invoked for this offline follow-up. Earlier independent reader acceptance remains historical evidence for its unchanged scope, not acceptance of these new changes.

## Live UI evidence

Both Source and Review were inspected at **1440×900**, **1200×900**, and **390×844**. Document scroll width equals viewport width in every required case. Source retains local table/breadcrumb scrolling and ordinary vertical navigation. The existing Hello-World project shows the real repository name and README in its directory. The current Axios Review remains Paused and shows Paused at with its saved timestamp, preserving its duration and partial findings. Temporary viewport overrides were reset.

The saved GitHub source reports an existing authorization failure; no reconnect, new scope grant or manual synchronization was performed. This does not prevent displaying already imported files. Multiple equal repository names and unavailable source metadata are verified with component fixtures rather than creating additional live projects.

Evidence is retained under `evidence/public-repo-outcomes-2026-10-22/run-2026-10-24T10-27-46-162Z/offline-followup/`: Source/Review screenshots at required sizes, responsive measurement JSON, exact changed source/test copies and `runtime-code-manifest.json`. The original paid model runtime and earlier reader runtime manifests remain separate. Only `applicationApi.ts` and the Artifact type changed in backend runtime relative to the reader snapshot; no assessment policy changed. New process identities and global hold are recorded in `offline-runtime-processes.json` beside that folder.

The first restart timestamp check encountered PowerShell's automatic JSON date deserialization, so Parse received a localized DateTime string and raised a non-terminating error. The command-line check still matched the owned launcher before it was stopped; no unrelated process was targeted. The follow-up check uses terminating errors and casts the already-deserialized value directly to DateTimeOffset; the new launcher identity verified. The initial preflight observed Vite during startup and reported a conflict; the subsequent preflight passed after startup. Future lifecycle checks must fail closed before mutation.

## Remaining work held by instruction

The v9 Axios Review is quota-blocked with 19/20 batches. Its independent saved-result adjudication still has one false unique model claim, five Unknown claims and no registered Axios gold hit. Four later v9 Reviews remain unattempted. Completing those assessments, validating semantic mitigations and accepting the full benchmark remain deferred until the user explicitly requests provider-backed work. Do not launch the old reader-only resume preparer: it intentionally rejects the additional API/type changes until new provenance and required review are prepared.
