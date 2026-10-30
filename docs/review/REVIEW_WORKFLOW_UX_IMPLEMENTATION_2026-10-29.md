# Review workflow implementation checks — 29 October 2026

Scope: agreed Review Entry, Activity, Overview, Findings, saved evidence, Project Sources and Help workflow. Existing readiness/source-index edits are outside this task.

## QA inventory

| Claim or control | Functional check | Visual state |
| --- | --- | --- |
| Action-first Overview | Confirm blocker/risk/gap order; failed/unknown evidence never ready; independent human decision | Completed and failed records, 1440×900, 1200×900, narrow |
| Saved source browser | Collapsed initially; search and nested folders; exact version/hash rejection; late response ignored | 285 files, expanded tree and fixed-height reader |
| Activity | Completed/unreached stages, honest duration, pause explanation, finding navigation | Active/failed/completed and unavailable history |
| Entry and Help | Repository-only defaults, deselect documents, retained retry scope, navigation | Compact entry and Help at three widths |
| Findings | One occurrence, status actions, hover/focus, selected range, same-version reader and return | Popover near edges, long file, narrow |
| Project Sources | Persistent tree, source/folder/file continuity, row sync, minute polling guards | Repo/folder/file and no-results |

Exploratory failures: missing historical manifest, version mismatch, stale response after navigation, incomplete Review and unavailable findings.

## Acceptance

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Entry and Help | First repo plus eligible documents, deselection, retained retry scope; Help under Settings | Passed frontend checks | Native shell unverified |
| Overview and Activity | Action-first saved-evidence outcome, blocker/risk/gap priority, honest incomplete coverage, human decision separate | Passed frontend checks | Conservative missing-evidence gates; no live model evaluation |
| Frozen sources | Collapsed bounded nested tree; exact version/hash checks and late-response guards | Passed frontend checks | Historical unavailable versions remain unavailable |
| Findings | One selected occurrence; highlighted bounded preview; same-version reader and return; uncertainty retained through retry | Passed frontend checks | Synthetic content only in browser QA |
| Project Sources and sync | Persistent navigation and scroll; per-row Sync/history; minute scheduler with auth/backoff/concurrency guards | Passed frontend checks | Live provider sync unverified; bounded passes defer excess sources |

## Verification evidence

- Full frontend suite: **71 files, 495 tests passed**, `pnpm --filter centinel test --maxWorkers=2`.
- Following final independent-review fixes: **84 tests passed** across ArtifactsPanel, FindingEvidence and ReviewActivityScreen. Includes three-blocker ordering, uncertain-preview retry and stale scroll restoration. One new test brings the test inventory to 496; the full suite was not repeated after these focused fixes.
- `pnpm --filter centinel build` passed with the existing large-chunk advisory. `git diff --check` passed (line-ending advisories only).
- Browser fixture checks/screenshots cover Overview, Activity, Entry, Help, Findings and both source browsers at 1440×900, 1200×900 and 390×900. No page-level horizontal overflow observed. Frozen source inventory used 285 files; project navigation used 150 files; citation reader used 500 lines and opened at line 31. Preview remained inside the narrow viewport and Close dismissed it.
- Evidence lives under ignored `evidence/review-ux-audit-2026-10-29/`, including `frontend-tests-final.txt`, `final-fixes-tests.txt`, `build-final.txt` and `impl-*.png`.
- Independent read-only GPT-6.1 Sol review found focus restoration, citation uncertainty, source scroll races and action-ranking defects; fixes were reassessed with no remaining blocking findings. Root ran the verification.
- Browser QA intercepted synthetic auth/API responses. No paid Review, live import, indexing resume or model call was initiated. Native packaged desktop, live connected-provider sync and release deployment remain unverified. Existing unrelated readiness/source-index changes were preserved.
- The full test run emitted jsdom's unimplemented `window.scrollTo` notice in a return-navigation test; assertions passed. Actual source-reader return behavior was also checked in Chromium.

## Handover presentation rules implemented

Recommendations are deterministic projections of saved Review evidence, with no model calls. Open verified Critical/High findings produce Changes needed; other verified findings remain Remaining risks. Document gaps, uncertain citations, missing verifier/evidence and unresolved coverage remain Evidence gaps. Severity then shared priority orders items within each group, then source path/title/id for stable ties. The first three actions are taken from blockers, then risks, then gaps; coverage limitations remain visible even when all slots contain blockers. Human acceptance does not resolve an issue; effective resolved/dismissed items are excluded.

Ready within scope requires successful execution, no loading/read failures, an exact-version source manifest, a ready document assessment with no gaps/contradictions, nonempty fully verified requirement coverage, and a fully assessed four-domain feature map with no unsupported/unresolved/limited paths. Missing legacy evidence is insufficient. This deliberately conservative presentation does not certify whole-product or runtime correctness. A human decision is separate.

Saved source browser heights remain 418px desktop / 598px narrow regardless of file count. Project Sources uses a bounded persistent tree/content workspace and preserves navigation and scroll per source. Source checks run on the signed-in workspace lifecycle, respect provider backoff and existing worker status, and never clear an indexing/model hold. Local files require explicit reimport.
