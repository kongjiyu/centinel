# Project Source and Findings Redesign Plan

Status: phases 1 and 2 implemented; phase 3 verification complete

## Scope and constraints

- Treat the four supplied screenshots as visual references only; the written request is authoritative.
- Preserve the existing sidecar schema and persisted finding statuses. Present a simplified UI lifecycle without a destructive migration: `new`, `carryover`, and legacy `accepted` map to **Unresolved**; `fixed` maps to **Resolved**; `dismissed` maps to **Dismissed**.
- Use only persisted source records and real locations. Documents and repositories are available now. GitHub, Google Drive, and Slack remain clearly unavailable unless a real connected location is returned by the running application.
- Reuse React, Lucide, `Modal`, shared controls, `react-markdown`, Centinel design tokens, and existing Tauri file/shell capabilities. Preserve unrelated working-tree edits.

## Phase 1 — Overview, Settings, and finding lifecycle polish

- Recompose Recent activity controls so the search field owns the primary width and Datetime/State controls align predictably without crowding.
- Rebuild Need attention pagination with the same three-column, fixed-action-slot pattern as Findings so Previous and Next never overlap the content or card edge.
- In Settings view mode, render Workspace as plain technical text without a field border or folder action. Retain the directory picker only in edit mode.
- Render Findings Priority and Findings Severity as clean ordered value lists in view mode. Show editable inputs plus add/remove controls only after the user enters edit mode.
- Reduce finding status presentation and filtering to Unresolved, Resolved, and Dismissed through a backward-compatible UI mapping.
- Reorder Project Finding detail to: source type, title/status, priority, severity, location, description, evidence, recommendation, then a bottom-right action row.
- Remove confidence and Accept. Expose only **Dismiss** and **Mark as resolved**, hiding an action when it already represents the current state.

## Phase 2 — Source list, add-source modal, and detail explorer

- Replace the expandable legacy Source list with a calm, scan-first source directory. Each row shows category, name, supporting location/count, and a labelled **Open** or **Open with** action.
- Keep the add-source interaction in an accessible modal with the five categories: Documents, Repository, GitHub, Google Drive, and Slack. Documents and Repository use the existing upload/import flows; unavailable connectors are disabled and explicitly labelled.
- Opening a Document replaces the list with a Source detail view that has a predictable Back action and file metadata. Preview text/code, images, and PDF; Markdown provides **Preview** and **Original** modes; unsupported formats show **Preview not available**.
- Opening a Repository replaces the list with a Source detail explorer. It provides a hierarchical directory tree, directory navigation, selectable files, and the same preview behavior as Documents.
- Open external/local locations through the existing Tauri shell capability only when a valid real location exists. Connected-app categories route to their provider location when such a URL is present; otherwise they remain unavailable.
- Preserve add, delete, drag/drop, loading, indexing, error, empty, keyboard, and focus-restoration behavior while removing the old inline expansion and duplicate browse-content modals.

## Phase 3 — Verification and pending fixes

- Add or update accessible component tests for the three-state mapping and actions, detail ordering, Settings view/edit presentation, Overview toolbar/pagination, Source categories, add-source modal, document preview modes, repository traversal, unsupported preview, and external-open fallbacks.
- Run focused Project Detail, Findings, and Artifacts tests.
- Run the complete frontend suite with one worker, `pnpm --filter centinel build`, and `git diff --check`.
- Inspect Overview, Findings, Settings, Source list/detail, and modal states at 1440×900, 1200×900, and a narrow viewport. Confirm no horizontal overflow, clipped actions, inaccessible focus, or unrelated style leakage.
- Record any unmet requirement under **Pending fix items** and stop after reporting it for user direction.

### Pending fix items

- None. All requested UI items passed component, build, and responsive verification.

### Verification outcome

- Delegated implementation completed by Luna Max and independently audited by the primary agent.
- Frontend suite: 22 files and 109 tests passed.
- Production frontend build passed.
- `git diff --check` passed; only expected Windows line-ending notices were emitted.
- Manual responsive inspection passed at 1440×900, 1200×900, and 720×900 for Overview, Findings, Settings, the Source directory/detail flow, and the add-source modal.

## Deferred service work

- Persist custom Findings Priority and Findings Severity collections per project.
- Add durable source records and authorization flows for GitHub, Google Drive, and Slack, including provider URLs required for external navigation.
