# Requested UI Implementation Plan

Status: Phases 1 and 2 audited; Phase 3 pending user instruction  
Created: 2026-09-08

This plan tracks the user-requested UI work in two implementation phases and a third, intentionally deferred remediation phase. Attached screenshots are visual references only.

## Phase 1 — Project Detail page

- [x] Header: remove created date, workspace path, New review, New test, and Evidence actions.
- [x] Header: add one Action disclosure with Review and Dynamic testing options.
- [ ] Tabs: use larger Recent-project-title-scale headings and remove supporting descriptions. Findings still renders supporting copy.
- [x] Overview: add a two-column 8/4 layout with equal-height Need Attention and Readiness sections.
- [x] Need Attention: show three items per page and add pagination.
- [x] Readiness: show honest readiness for repository, requirement specification, design documentation, and one additional high-value source category.
- [x] Recent activity: place below the overview grid; support search plus type and state filters.
- [ ] Source: local repository/directory browsing and supported text/PDF/image preview are implemented; connected-source browsing and a directory tree inside the modal remain unavailable.
- [x] Findings: use the Recent-project row surface treatment; make each item expandable; add search, severity, priority, and pagination.
- [ ] Collaborations: the unavailable message is centered and width-limited, but service-backed search/pagination are unavailable and the outer card still supplies a surface.
- [ ] Settings: the groups, created datetime, future workspace note, and remove action exist; project edits/configuration defaults do not persist, and deletion does not refresh App project state.
- [x] Remove the Search evidence section.
- [x] Add/update focused tests.
- [x] Phase audit: frontend build passed; 18 targeted tests passed; unmet items are recorded under Phase 3.

## Phase 2 — Non-Project-Detail pages

- [x] Dashboard and Projects tables: use the Recent projects light-green row hover and a small token-based radius.
- [x] Dashboard: move Recommendations above the Create project/quick-action buttons.
- [ ] Review Entry: the body-container layout and three requested sections are implemented, but Show Git diff is an honest availability note rather than a pre-run file diff, and directory scope is passed as review instructions rather than technically constraining the runner.
- [x] Review Entry Project Context: allow optional document sources and a checkbox to save them to project sources; unsaved uploads are deleted by the sidecar after the review finishes.
- [x] Projects: remove the table/pagination divider, “Find projects” text, and Activity type filter; use `Search your projects` as the placeholder.
- [x] Project Creation: let the user choose a local repository or a public GitHub URL; default a local repository project workspace to that repository path and clone GitHub projects into Centinel's default project directory.
- [x] Settings: lighten connection-item backgrounds to match version surfaces; compact usage values above six displayed figures with K/M/B/T; keep locale grouping with a space after commas; render Recent calls title only after Show log is selected.
- [x] Add/update focused tests.
- [x] Phase audit: production frontend build passed; full frontend suite passed 97/97; focused sidecar Projects integration passed 2/2; frontend and sidecar TypeScript checks passed; responsive checks completed at 1440×900, 1200×900, and 760×900.

## Phase 3 — Pending fixes (hold for user instruction)

Do not implement items in this section until the user explicitly instructs us to proceed.

- Persist Project Detail name, description, workspace, severity default, and priority default through a real sidecar update contract.
- Route Project Detail deletion through App state (or reload projects after deletion) so the removed project disappears immediately.
- Remove Findings supporting copy so every Project Detail tab follows the requested title-only heading treatment.
- Make the repository/directory row itself open a real modal directory tree; the current row expands inline and its separate Open contents modal is a flat file list.
- Add connected-source browsing once a connector service can return an integration hierarchy.
- Add Collaboration search and pagination once collaboration records exist; remove the outer surfaced card in the unavailable state so the centered message is fully borderless/backgroundless.
- Complete Action-menu keyboard behavior (Escape, focus movement/restoration, and outside-click dismissal).
- Replace the Review Entry Show Git diff availability note with a real pre-run changed-file preview.
- Enforce Review Entry selected-directory scope in artifact/context selection instead of relying only on appended review instructions.
- Add an authenticated GitHub repository picker/private-repository flow; the current implementation clones public repository URLs.
- Redesign Projects rows for narrow viewports; at 760px the fixed table columns avoid horizontal overflow but compress activity copy into very narrow word-wrapped columns.

### Validation debt observed outside the requested UI scope

- Repair the pre-existing full sidecar test-suite failures before treating that suite as a release gate. The focused Projects integration tests pass, but the full suite currently has missing source modules, report return-shape expectations, generated graph/index fixture instability, and incomplete database-table setup in unrelated tests.
