# Project Detail Interaction Polish Plan

Status: phases 1 and 2 implemented by Luna Max; Phase 3 verification complete with no pending fix items

## Scope and constraints

- Implement the requested Project Detail Settings, Collaborations, Overview, Findings, header actions, and Review entry width refinements.
- Treat the five supplied screenshots as visual references only; the written requirements in the user request are authoritative.
- Preserve existing frontend/sidecar contracts and unrelated working-tree edits.
- Findings configuration values remain local mocked UI state for this iteration; persistent project storage stays deferred.
- Use the existing React, Lucide, shared Modal/Select primitives, and Centinel design tokens.

## Phase 1 — Settings, Collaborations, and project actions

- Replace the single Priority and Severity selects with editable local value collections that support viewing, adding, renaming, and removing values.
- Seed Priority with Low, Medium, High and Severity with Low, Medium, High, Critical; allow examples such as adding Info or renaming Medium to Average.
- Preserve at least one value in each collection, prevent blank/duplicate labels, expose keyboard-operable edit/remove actions, and restore the draft on Cancel.
- Make Workspace read-only at all times. In Settings edit mode, clicking the field or its trailing directory icon opens the native directory picker and updates the draft path.
- Move the Collaboration search control to a full-width second row below the title; remove the visible “Search collaborators” label while retaining an accessible name.
- Add Export report as the third Action-menu item and connect it to the existing report export workflow.

## Phase 2 — Overview, Findings, and Review entry

- Give Need attention pagination its own padded footer area and stable Previous/Next slots so controls never overlap adjacent sections.
- Limit each attention row to a single preview line followed by an inline bold “… See More” affordance when truncated.
- Open See More in the shared accessible modal, show the complete item, and include the same contextual action (Inspect, Set up, or equivalent) as the row.
- Lighten the activity toggle frame and inactive controls while making the selected state a clearly opaque light-green surface; remove the visible Search label but retain its accessible name.
- Add horizontal padding to Need attention rows and left padding to Readiness rows.
- Remove the project Findings result-summary sentence and the visible Search findings label while retaining accessible names.
- Reduce Findings filter cognitive load with a search-first compact toolbar and progressive filter disclosure. Keep Severity, Status, and Priority clearly named; show active-filter summary controls and a single Clear action only when applicable.
- Keep the finding table/detail 7/5 composition, keyboard row selection, pagination, and responsive stacking.
- Make the Review entry header and form body share the same computed width and box-sizing at desktop and narrow breakpoints.

## Phase 3 — Verification and pending fixes

- [x] Add or update focused tests for editable configuration collections, directory picking, collaboration/search layout semantics, attention modal actions, activity toggle/search labels, compact Findings filters, export action, and Review entry equal-width structure.
- [x] Run focused Project Detail, Findings, and Review Entry tests.
- [x] Run the complete frontend suite with one worker, then `pnpm --filter centinel build` and `git diff --check`.
- [x] Exercise the changed states in the running app and inspect responsive rules at 1440×900, 1200×900, and a narrow 760px viewport.
- [x] Record unsatisfied requirements as Phase 3 pending fix items; none remain.

### Verification outcome

- Luna Max implementation completed the requested Settings, Collaborations, Overview, Findings, Action menu, and Review Entry work.
- Focused tests passed; complete frontend suite passed: 105 tests across 22 files.
- Frontend production build passed. Vite emitted only its existing advisory about the minified bundle exceeding 500 kB.
- `git diff --check` passed; Git reported line-ending normalization warnings only.
- Live in-app browser QA covered Settings edit/view, local configuration add/rename/remove affordances, workspace picker affordance, collaboration empty state and modal, Overview pagination/toggle/filter layout, Findings progressive filters and selection detail, Action menu ordering, and Review Entry widths.
- Computed Review Entry header/body widths matched at 1440×900, 1200×900, and 760×900; no page-level horizontal overflow was observed.
- Phase 3 pending fix items: none.

## Deferred work

- Persist custom Findings Priority and Findings Severity collections per project through a backward-compatible sidecar API and database migration.
