# Project-to-review acceptance, 20 October 2026

This is acceptance of the current local working tree, including the earlier project-wide finding reconciliation changes. It is not a production/native signoff. No finding was approved, dismissed or marked fixed in live project data, and no changes were pushed.

| Feature | Measurable acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Review sequence and final issue registry | Read selected immutable sources, run checks, validate evidence, remove duplicate candidates, compare every completed project review, reuse original issue identity, and derive resolution only from comparable changed-source success | Contract tests passed | Real-model end-to-end review and live persistence remain unverified for this revision |
| Four-domain assessment | Save inferred features/branches before inference; request Security, Business, Technical and Personnel/human-error outcomes; accept only unique feature/domain rows with exact known source/version references and a concise explanation | Synthetic-provider and parser tests passed | Bounded JS/TS local syntax, not whole-program CFG/data-flow, deployed safeguards or runtime proof. Real-model quality blocked |
| Interface follows recorded work | Activity shows stage purpose, timing and finding links; separate feature disclosures show assessed/unverified domains, path questions and unsupported sources. Overview lists coverage concerns. Missing history remains explicit | Frontend tests and isolated browser checks passed | Existing reviews have no retroactive map. A saved model response is not independently proved behavior |
| Diagnostic precision | JS/TS nesting counts actual control statements, ignoring objects/comments/strings/formatting; secret candidates require a static literal, omit environment expressions and common symbolic values, redact values and avoid claiming proved exposure | Positive and negative rule tests passed | Other-language diagnostics remain heuristic. Specific credential-format scanners need broader false-positive/false-negative evaluation |
| Current project risk and reports | Validated derived resolutions leave current risk totals; missing source proof keeps them open; correlation-loading errors do not produce misleading totals; per-review history is immutable | Regression tests passed | Findings falls back conservatively to saved rows if lineage is unavailable; Assessment/export fails rather than inventing a current total |
| Readiness outcome mechanism | Independent quality criteria; scope coverage asks whether substantive category content exists, while consistency/testability/exception defects remain separate; previous snapshot survives errors and pauses | Deterministic engine, evaluator, coordinator, route and persistence tests passed | This verifies mechanism, not model judgment accuracy |
| Readiness semantic accuracy | Full independently judged 11-case corpus passes category states, criterion verdicts, evidence/basis and scope coverage | **Not accepted — blocked** | Prior policy `.4` report is partial and contains mismatches plus `rate_limited`. Current policy `.5` has no completed live corpus |
| GitHub remote transport | Real remote head is checked before tree/blob requests; matching successful revision skips content; an ancestor revision fails the equality fast path and allows pinned content lookup | Read-only live adapter probe passed for CORS and Serve Static | Samples one content item per repo. No authenticated app scheduler, durable worker or Storage write is established by this probe |
| Automatic sync lifecycle | Open signed-in workspace schedules eligible sources, excludes local sources, checks head before pulling, resumes partial work and avoids unchanged versions/duplicate readiness work | Scheduler/importer/worker tests passed; **authenticated live acceptance pending** | Requires signed-in local app session. App-closed scheduling is not implemented |
| Whole project initiation journey | Failed import retains discoverable project/source identity with a clear retry path; document category labels distinguish inferred from confirmed meaning | **Open gaps** | Local-create partial failure and filename-based Source labels remain; see audit |

## Verification actually run

- Backend: 254 tests across 21 files, plus 110 tests across 14 files (10 tests/two files overlap). A further middleware regression was added and passed: **355 distinct relevant backend tests across 33 files**. These cover readiness, sync providers/importer/worker/routes, orchestration, finding normalization/correlation/reconciliation, grounding, provider pauses, reporting/risk, parser and static rules. Focused reruns after final backend edits passed. Full backend suite is not claimed green; the earlier run had 18 Windows Dynamic Testing failures.
- Frontend: **347 tests across all 60 files passed**. After the final source-link/feedback changes, the relevant four-file set passed **51 tests**.
- Frontend production build passed. Existing large-bundle warning remains. Sidecar TypeScript check passed; whitespace check passed.
- Isolated headless Edge checked feature/path disclosures, four domain labels, unsupported-source disclosure, missing old-review history, zero page errors, and no page overflow at **1440×900, 1200×900 and 390×844**. Screenshots were visually inspected; feedback-bar alignment and placeholder wrapping were corrected. Evidence: `evidence/review-analysis-ui-2026-10-20/results.json` and screenshots. These fixtures intercept auth/API traffic; they are not live persistence evidence.
- Read-only real GitHub adapter evidence: `evidence/github-live-2026-10-20/public-adapter-probe.json`. CORS current head `5317ebe670db2aaebc1d496eb5d33493deefb3ed`; Serve Static `109a299c26d2d532027bb6e66e50e365eeb8fcdd`. Each was compared with its actual first parent and confirmed one commit ahead. Head checks made no tree/blob requests; changed-revision content lookup did. No upstream repository was modified.
- `pnpm dev:check` confirmed the owned sidecar and web app are healthy/reusable. Native desktop signed-in behavior was not verified in this pass.

## Readiness corpus provenance and provider stop

Current policy: `readiness-2026-10-20.5`. Eleven fixtures; corpus SHA-256 `73d15fd9b080e72234da351d0134ae612745bc4bc4393ff3f0522b33f97048f1`.

The prompt now separates scope coverage from quality failures. The contradiction fixture's coverage declaration explicitly names its already-present audit-retention rules. The original “useful and quick” untestable fixture and its gold verdicts were retained; clarity/testability overlap remains a calibration question to resolve transparently rather than rewriting a failing example to manufacture a pass. Historic live results are not scores for this new policy/corpus.

The delegated AI workers reported a usage-limit block before a new live readiness result was saved. All further AI assessment was stopped; root ignored runtime configuration was restored to `CENTINEL_AI_ASSESSMENT_PAUSED=1`. The owned sidecar was restarted with the pause applied. No model fallback, credit purchase or automatic retry was attempted. Resume only after the user requests it and capacity is available; a later manual readiness trigger/new linked review is still required.

## Remaining acceptance work

1. Resume and pass the complete live readiness corpus after capacity returns; investigate criterion/evidence mismatches without weakening acceptance.
2. In an authenticated local workspace, observe automatic scheduled sync through the real durable worker and Storage: unchanged head creates no versions; older head imports changed content; partial/error recovery and restart preserve correct state. Sign-in was requested but not supplied during this pass.
3. Run the revised four-domain review on the updated public-source imports, then run a comparable changed-source review and verify canonical IDs, deduplication, derived resolution, reappearance, risk totals and exports against durable records.
4. Repair local-create partial-import recovery and Source category labeling. Broaden language/framework, dependency and deployment evidence before claiming wider path coverage.

Full findings and source evidence: `PROJECT_REVIEW_JOURNEY_GAP_AUDIT_2026-10-20.md`.

## Later authenticated desktop sync verification — 21:17–21:24 local time

The user supplied the signed-in desktop session. This section supersedes the earlier sign-in blocker and the pending unchanged-head scheduler case above. AI remains paused; no manual Sync or Review action was invoked by this verification.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Desktop automatic sync | Open signed-in workspace creates successful scheduled checks without manual Sync | Passed live UI observation for both public repositories | Development Tauri window using the local web server; installed release not tested |
| Unchanged revision outcome | Run records no imported/updated/removed files and preserves current inventory | Serve Static: 25 unchanged at 21:17:05; CORS: 17 unchanged at 21:17:23 and 21:22:34 | Counters and inventories are UI evidence, not an independent Storage object/version audit |
| Source UI refresh | An initially idle Source pane updates timestamps/files after background sync without leaving the pane | Fixed and verified live: Serve Static timestamp changed from 21:11:48 to 21:17:06; 17 source/scheduler tests passed | Read-only idle refresh every 30 seconds; active-run polling remains faster |
| Read failure/recovery | Retain saved sources, explain stale progress, clear warning when reads recover, stop polling after unmount | Passed unit regression and isolated browser failure/recovery checks | Offline behavior used a fictional intercepted API, not a live outage |
| Readiness hold | Preserve previous category outcomes and explicitly explain AI pause while source imports continue | Passed native UI observation on both projects | Semantic accuracy corpus remains paused and unaccepted |
| New remote commit | Pull newly published remote changes through the authenticated scheduler/worker/storage path | Still pending | Real public heads were unchanged. Historical recovery imported seven Serve Static and two CORS files after authorization recovered; this is not proof of a new-head import |

The CORS overview also showed **2 new project sources need review**, matching its newly imported inventory. Old reviews/findings were not rewritten or approved. Historical authorization failures remain in sync history beside the later successful records.

Evidence: `evidence/github-live-2026-10-20/desktop-sync-observation.json`; isolated refresh UI report and screenshots in the same directory. Refresh feedback was visually checked at 1440×900, 1200×900 and 390×844. Production frontend build passed, with the existing bundle-size warning. No backend or provider configuration changed during this follow-up.
