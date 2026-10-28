# Review quality remediation implementation plan — P1 and P2

Date: 21 October 2026. Status: implemented locally; offline and isolated-interface acceptance is recorded in [implementation acceptance](REVIEW_REMEDIATION_ACCEPTANCE_2026-10-21.md). Real-model/native signoff remains separate. The steps below retain the execution plan and original criteria.

Scope: all ten audit findings, six P1 and four P2. Behavior and acceptance are defined in the [specification](REVIEW_P2_REMEDIATION_SPEC_2026-10-21.md); original evidence is in the [audit](REVIEW_QUALITY_AUDIT_2026-10-21.md). Existing filenames are retained for link compatibility. Preserve unrelated working-tree changes. Implementation must keep the current AI hold and avoid live provider calls. This plan authorizes no implementation by itself.

## Delivery sequence

| Step | Work | Dependencies | Exit evidence |
| --- | --- | --- | --- |
| 1 | P1-01, P1-02: validate responses/evidence and prevent false resolution | None; first acceptance gate | Production-orchestrator audit reproductions no longer establish success/risk/resolution |
| 2 | P1-05: freeze scoped traceability and mapping versions | Step 1 completion/coverage contract | Snapshot/scope/version and concurrent-edit regressions pass |
| 3 | P1-03, P1-04, P1-06: decision evidence, frozen source view and explicit retry | Steps 1–2 for full integration | Failure/recovery, frozen-version and linked-retry tests pass |
| 4 | P2-01: preserve validated feature/finding associations | Step 1 final evidence validation | Orchestrator persistence and navigation regressions pass |
| 5 | P2-03: correct latest Static attempt selection | None; deliver before report renderer signoff | Adapter/ordering tests pass, including older approval/newer failure |
| 6 | P2-02: current export inventory and labeled history | Steps 1–2 and 5 | One captured projection feeds risk/inventory; JSON/Markdown/PDF verified |
| 7 | P2-04: previous readiness results and hidden gaps | Existing readiness status/snapshot contracts | State matrix, accessibility and viewport checks pass |
| 8 | Consolidated review and acceptance | Steps 1–7 | All ten criteria evaluated with actual evidence and limitations |

Each step is independently reviewable; deliver P1 safeguards before claiming trustworthy downstream results. Source evidence validation and link preservation share a pipeline, so avoid competing edits to those paths. Do not expand into Dynamic Testing repairs. No step depends on resuming AI. Prefer additive fields in existing snapshots; document any required schema change and compatibility implications before implementation, with no destructive migration.

## Step 1 — P1 response/evidence validation and resolution safety

- Inspect `review/orchestrator.ts`, `findings.ts`, `featurePathAnalysis.ts`, `locationValidation.ts`, provider response parsing/schema, `correlation.ts`, `projectCorrelation.ts`, `findingReconciliation.ts` and current projection consumers.
- First add executable regressions reproducing the ownership issue followed by malformed changed-source output, fabricated Critical claims, valid-line/invented evidence and title-only output. Assert final lifecycle, model status, saved findings, audit summaries, resolution eligibility and current risk, not just helper return values.
- Introduce the versioned response validator and evidence-anchor contract before normalization. Distinguish structural invalidity, explicit unverified coverage, unsupported observations, genuine empty findings and successfully assessed scope. Update prompt/schema together. Do not make model-private reasoning a required output.
- Preserve deterministic/valid partial evidence without enabling Need Approval or absence-based resolution for invalid assessments. Route safe unverified limitations through existing evidence-sufficiency metadata; reject raw-payload logging. Preserve cancellation, capacity stop, manual retry and provider configuration behavior.
- Add validation proof to new resolution eligibility and require it in current projections. Missing legacy proof keeps unresolved candidates conservative without altering saved approvals or snapshots. Test valid resolution still works, uncertainty cannot resolve, recurrence remains attributable and risk consumers agree.
- Cover empty feature maps, duplicate/missing domain rows, partial mixed candidates, requirements-only evidence, source range/version mismatch and policy changes. Keep evidence validation order compatible with step 4's association checks.

Targeted checks: production orchestration, model finding/schema normalization, feature-path assessment, location validation, provider pause/retry, evidence sufficiency, correlation/reconciliation and current risk suites. Use injected offline providers; no live model requests.

Exit gate: invalid output cannot create clean success, unsupported claims cannot enter ordinary risk, and neither can resolve a prior issue. If this gate fails, later presentation work cannot establish overall acceptance.

## Step 2 — P1 frozen scoped traceability

- Inspect source-manifest capture/reuse, scope selection, confirmed requirements/standard loading, Supabase/in-memory repository adapters, traceability readiness/snapshot creation, approval consumers and report adapters.
- Extend existing snapshot JSON additively with versioned selected requirements, mappings and inclusion basis captured before execution. Use the exact frozen context in provider input and final traceability. Define legacy absence explicitly; never repopulate old context from current mutable tables.
- Bind complete mappings to reviewed source versions. Missing/deleted/unreadable targets, stale hashes or missing version provenance become explicit unavailable evidence. Preserve existing traceability vocabulary while ensuring attention totals distinguish unknown from clean.
- Test selected versus unselected requirements, artifact filtering, full scope, simultaneous requirement/mapping edits, source deletion/change, unchanged proven mappings, no mapping and legacy snapshots. Include reused/refreshed retries and downstream Overview/approval/report consistency.
- Confirm source/requirement bodies stay in authorized snapshot storage, not harness logs. Retain member-scoped reads and immutable saved observations.

Targeted checks: `supabaseReviewRepository`, orchestration scope/manifest tests, evidence/traceability, decision routes and report snapshot suites; relevant frontend Traceability/Review Overview tests. Verify actual test filenames when implementing.

## Step 3 — P1 evidence workspace and recovery

- Read `DESIGN.md` before UI edits. Inspect `ReviewActivityScreen.tsx`, Review source/traceability API contracts, decision handlers/routes, source-version preview access, retry idempotency and orchestrator manifest capture/reuse.
- Add separate evidence loading/success/contract-unavailable/failure states and a **Retry evidence** action. Gate decisions and recheck the handler on failed/loading evidence; test stale async responses, polling failure, invalid identities and recovery without creating a Review.
- Replace the project source-management panel in historical Overview with frozen manifest evidence. Reuse authenticated version-content access, or add a narrowly scoped version-read API if required. Test current source update/delete/new imports cannot change saved evidence. Keep management navigation separate and missing historical bytes explicit.
- Expose saved-source and updated-source retry choices with accurate default guidance. Verify entire frozen requirement/mapping context follows the choice. Preserve parent history and effective scope; reject missing explicit selections rather than broadening scope.
- Review operation keys: repeated transport submission returns one child; a later intentional retry after another repair may create a new child rather than returning an old terminal child. Test capture/read failures, repeated clicks, multiple attempts, cancellation and provider pause without implicit resume.
- Verify keyboard/focus/status messages and required viewports for evidence failures, historical sources, retry choices and narrow long-path content. Use safe fictional fixtures and no live decisions.

Targeted checks: Review Activity/Overview, API contract/authorization, source-manifest/version reads, decision gate and retry/iteration tests. Combine with step 2 tests to prove repaired evidence enters a refreshed child.

## Step 4 — P2 associations

- Inspect `sidecar/src/review/orchestrator.ts`, `featurePathAnalysis.ts`, `locationValidation.ts`, repository save/read mapping and `centinel/src/components/ReviewAnalysisScope.tsx`.
- Add a production-orchestrator regression that provides a valid feature/path/domain-linked finding and inspects the saved/read-back locator. Include ordinary code, requirement and standard grounding, invalid link IDs and contradictory final locations.
- Preserve validated association separately while rebuilding trusted requirement/standard provenance. Confirm validation order does not leave stale links after location normalization.
- Extend the Activity component/navigation test to open the linked persisted finding. Retain the historical no-map/no-link state.

Targeted checks: `staticReviewOrchestrator`, `featurePathAnalysis`, finding-location and Supabase repository suites; frontend `ReviewAnalysisScope` and relevant Review Activity tests. Select actual test paths from the repository when implementing.

## Step 5 — P2 latest attempt ordering

- Inspect `sidecar/src/report/snapshot.ts`, `supabaseSnapshot.ts`, `types.ts`, `sidecar/src/staticDomainTypes.ts`, frontend `reviewCurrency.ts`, and their existing tests.
- Add optional execution-completion metadata to the report-facing adapter only where backed by saved fields. Implement timestamp resolution with creation fallback and stable ID ties. Keep generic activity timestamps separate.
- Introduce Static-specific selection so Dynamic behavior stays unchanged. Preserve terminal-attempt eligibility and distinguish it from the latest-successful currency policy.
- Test the October 1/20/21 reproduction, delayed completion, missing/malformed fields, ties, reversed input order and a newer failed/cancelled/blocked attempt. Assert changing only a decision/update time does not change selection.
- Update renderer terminology and time labels together with step 6; retain historical saved-report readability.

Targeted checks: `reportSnapshot`, report adapter tests and frontend `reviewCurrency` regressions.

## Step 6 — P2 current export inventory

- Inspect `sidecar/src/review/currentProjectFindings.ts`, `findingReconciliation.ts`, `sidecar/src/report/{types,snapshot,supabaseSnapshot,markdown,pdf}.ts` and all snapshot/rendering consumers. Discover actual PDF renderer/test paths before editing.
- Refactor capture so the production report receives risk and current findings from the same reconciled set, avoiding a second independent projection read. Keep the bearer/member checks and existing fail-closed error behavior.
- Add the optional current inventory envelope, canonical IDs, effective disposition and available occurrence/resolution references. Preserve raw `findings` and per-review observations. Do not derive current inventory from risk items, which omit resolved/informational issues.
- Update JSON, Markdown and PDF together; clearly label historical states, unavailable legacy projection and latest attempt. Increment generator version without removing existing schema fields.
- Add fixtures for recurrence, derived resolution, regression, human dismissal/fix, ambiguity/missing proof, Dynamic provenance, informational findings, zero issues, projection failure and legacy snapshot absence. Assert source records remain unchanged and current risk agrees with the same projection.
- Render a representative multi-page PDF with long paths, resolved/current issues and history; inspect page images for wrapping, headings and clipped rows. Apply the PDF skill when doing this artifact verification.

Targeted checks: `currentProjectRisk`, `findingReconciliation`, `projectCorrelation`, `supabaseReportRisk`, `reportSnapshot`, storage and relevant renderer suites. Test counts overlap; do not sum them as distinct coverage.

## Step 7 — P2 previous readiness presentation

- Read `DESIGN.md` before UI edits. Inspect `ProjectReadinessCard.tsx/.css`, `readinessFindings.ts`, Project Findings loading/empty states, and existing tests.
- Add previous-assessment/date copy whenever stale results are shown. Explain queued/running/idle/failed/paused state separately and retain existing action semantics.
- Keep stale readiness gaps excluded; add context explaining why they are hidden. Preserve non-readiness findings, filtering and risk behavior.
- Cover snapshot present/absent, stale/fresh and idle/queued/running/failed/paused states with parameterized behavior tests. Verify invalid dates, recovery to fresh results, source-update transitions and no implicit start/resume requests.
- Check visible and screen-reader status, keyboard controls, focus, long copy and narrow wrapping at 1440×900, 1200×900 and a narrow viewport. Use intercepted fictional fixtures; record that these do not verify live persistence.

Targeted checks: `ProjectReadinessCard`, `readinessFindings`, affected Findings/Project Detail suites and readiness integration regressions if the data-loading contract changes.

## Step 8 — Consolidated verification and handoff

1. Run the smallest complete backend suite covering response/evidence validation, scope and frozen context, decisions, retry, orchestration, adapters, projection and exports; run the relevant frontend suites with bounded workers. Expand testing only for new failures or affected contracts.
2. Run `pnpm --filter centinel build`, relevant frontend tests, sidecar type checking if a configured command exists, and `git diff --check`. Complete required viewport and PDF visual checks. A build alone does not establish behavior.
3. Review the final diff for invalid/partial success, false resolution, evidence anchoring, decision gating, frozen-source/requirement scope, retry semantics, provenance validation, schema compatibility, immutable history, current-risk consistency, stale-state honesty and unintended Dynamic changes. Keep credentials/source text/private reasoning out of new audit metadata.
4. Record commands, actual results and evidence paths in a separate acceptance note linked here. Use the ten-feature acceptance table from the spec; mark each Passed, Failed, Blocked or Unverified. Re-run the original offline audit reproductions against the final implementation. Include any still-open P1/P2 findings and real-model limits; do not close a finding on implementation alone.
5. Leave changes reviewable locally. Commits, pushes, live decisions and outward-facing writes require the user's authorization; none are necessary for local acceptance.

## Known baseline and reporting rules

The audit's frontend build passed. Its bounded-worker frontend run had 347/348 passing tests with one Dynamic Workspace timeout. Sidecar had 833 passing tests, 26 failing tests and two suite-hook failures in Dynamic Testing, including Windows/platform and browser issues. These are historical results, not results for the eventual implementation. Reproduce only what is necessary to distinguish new failures; never label an unrun check passed or the whole product accepted.

All six P1 and four P2 findings have now been implemented and checked locally; actual feature statuses, commands and limitations are recorded in [implementation acceptance](REVIEW_REMEDIATION_ACCEPTANCE_2026-10-21.md). Real-model semantic evaluation and live durable end-to-end acceptance remain separately unverified; they require explicit authorization to resume AI and available capacity. Local mechanism acceptance must not be presented as a passing live-quality corpus.
