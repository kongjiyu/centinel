# Project Detail Follow-up Plan

Status: phases 1 and 2 implemented by Luna Max and completed through root-agent verification; no Phase 3 fix items remain

## Scope and source of truth

- Implement only the Project Detail Settings, Collaborations, Overview, and Findings refinements in this plan.
- Treat the three supplied screenshots as visual references; the written requirements below are authoritative.
- Preserve the existing Centinel design tokens, Lucide icon system, API contracts, and unrelated working-tree changes.
- Keep Findings Priority and Findings Severity as mocked UI state for this iteration. Persisting them per project is explicitly deferred to a future plan.

## Phase 1 — Settings and Collaborations

### Settings

- Put the Settings title and Edit action on the same row.
- In view mode, render the description in a fixed-height read-only presentation that shows the complete value without clipping or a textarea scrollbar.
- Format Created Datetime as `DD/MM/YYYY HH:mm:ss` with tabular numerals.
- Rename configuration labels to Findings Priority and Findings Severity.
- Provide local-only editable defaults:
  - Findings Priority: low, medium, high.
  - Findings Severity: low, medium, high, critical.
- Add an accessible information icon that opens or exposes a concise explanation of how the default priority and severity affect findings. Do not imply persistence.
- Add/update tests for view/edit behavior, defaults, information disclosure, and the exact datetime format.

### Collaborations

- Add a collaboration search field before the Add collaborator action.
- Replace the unavailable/empty copy with a concise “Collaborator not found” state and guidance to add or sync collaborators.
- Add a “Sync from GitHub” option to the Add collaborator modal.
- Reorder modal content: repository name, repository information tooltip, instruction, then email search.
- Remove the token warning and bottom information strip.
- Move the search icon to the trailing edge of the email input, remove the Search button, and implement debounced real-time search with an accessible loading/no-results state.
- Keep the current explicit confirmation before an external invitation is sent.
- Treat GitHub sync as a safe UI workflow using available collaboration data; if no backend sync contract exists, present an honest non-destructive result rather than inventing collaborators.
- Add/update tests for modal structure, debounced search, sync option, empty copy, and confirmation.

## Phase 2 — Overview and Findings

### Overview

- Move the type control beside the Recent activity title and present it as a three-option toggle:
  - All: icon only with an accessible label.
  - Review: icon and label.
  - Dynamic Testing: icon and label.
- Position State and Datetime filters in the requested order and replace the date-only control with a datetime filter.
- Format displayed activity timestamps as `DD/MM/YY HH:mm:ss`.
- Keep Need attention and Readiness equal-height at desktop widths regardless of attention content.
- Clamp Need attention descriptions to two lines and append an inline bold “See More” affordance when truncated, with full content accessible on activation.
- Reserve stable, symmetric space for Previous and Next pagination controls so page changes do not shift the center label.
- Add/update tests for toggle filtering, datetime filtering/formatting, description disclosure, and pagination layout semantics.

### Findings

- Move the detail panel outside the Findings container.
- Make the Findings tab a two-section 7/5 desktop grid: list/filter container on the left, independent detail container on the right.
- Remove the Source filter while preserving search, severity, status, and priority filters.
- Preserve keyboard-selectable rows, total count, pagination, and all finding detail/actions.
- Stack the two sections at the existing narrow breakpoint without hiding any action or causing page-level horizontal overflow.
- Add/update tests for the absence of Source, the independent detail region, selection, and responsive-compatible structure.

## Phase 3 — Verification and audit

- Run focused Project Detail and Findings component tests.
- Run the complete frontend test suite serially if parallel execution is unstable.
- Run `pnpm --filter centinel build`.
- Verify the live screen at 1440×900, 1200×900, and a narrow viewport.
- Exercise Settings edit/view, configuration information, collaboration real-time search/sync/confirmation, Recent activity toggles and filters, Need attention See More, Findings selection, and narrow stacking.
- Update project-root `design-qa.md`; completion requires `final result: passed` with no P0/P1/P2 findings.

Verification outcome:

- Focused Project Detail and Findings tests passed: 18 tests across 2 files.
- Complete frontend suite passed: 101 tests across 22 files in single-worker mode.
- Frontend production build passed.
- `git diff --check` passed; Git reported line-ending normalization warnings only.
- Live in-app-browser review covered Settings, configuration help, Collaborations and its modal, Overview, and Findings selection/layout at the available desktop viewport. Responsive behavior was additionally audited at the 960px and 720px CSS breakpoints.
- Phase 3 pending fix items: none.

## Future plan item

- Persist Findings Priority and Findings Severity defaults in the project model, sidecar API, and local database with backward-compatible migration behavior.
