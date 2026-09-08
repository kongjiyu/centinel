# Project workspace refinement plan and acceptance matrix

> Status vocabulary: **Unresolved**, **Partial fix**, **Completed**
>
> Design authority: [`../DESIGN.md`](../DESIGN.md)
>
> Scope: Projects and Recent Projects, New Review entry, Project Overview, Source, Findings, Collaborations, Project Settings, and the shared visual relationship with global Settings.

## Acceptance status rules

- **Unresolved** — the requested behavior or presentation is absent, or the existing implementation materially conflicts with the criterion.
- **Partial fix** — a meaningful portion is implemented, but behavior, data integrity, accessibility, responsive composition, or verification remains incomplete.
- **Completed** — the criterion is implemented with real application data, preserves the existing product contract, works at the required viewports, and passes its relevant automated checks.

## AC-1 — Shared project workspace structure

Initial state: **Unresolved**

- Source, Findings, Collaborations, and Project Settings use a consistent full-width `12/12` content surface.
- Each surface has one clear header/body boundary, shared padding and typography, restrained separators, and a useful minimum body height that can grow with content.
- The page canvas is light grey; content surfaces are primarily white; primary text is near-black. Green is reserved for primary actions, meaningful selection, semantic state, and restrained hover feedback.
- Nested cards are removed unless the nested region has an independent interaction boundary.
- Layout remains usable without horizontal overflow at 1440×900, 1200×900, and a narrow viewport.

## AC-2 — Projects and Recent Projects

Initial state: **Partial fix**

- Projects uses the same visible content and column order as Recent Projects: Project, Latest activity, Current state, and an icon-only navigation affordance.
- Project description, testing counts, workspace path, and remove controls are absent from both tables.
- Projects shows no more than five items per page and provides accessible previous/next controls, current page, and visible result range.
- Search plus current-state and activity filters remain available in a flat neutral toolbar; they do not appear as a green or nested card.
- Filtering resets pagination to the first page and empty results provide a clear recovery action.
- Recent Projects padding, margins, row height, and responsive containment match the shared table system without broken panel edges.

## AC-3 — New Review entry

Initial state: **Unresolved**

- Global Review navigation opens a dedicated **New review** entry screen rather than a project-selection modal.
- The form begins with an accessible project selector. A left-aligned **Create project** link is directly below the selector.
- Create project opens a reusable modal, preserves in-progress review input, returns to New review, and automatically selects the newly created project.
- With no projects, the page presents project creation as the clear prerequisite without inventing data.
- Review name, optional instructions, inherited source context, source-currency warning when supported, and Git scope under Advanced options appear in one coherent form.
- Starting a review uses the selected project, registers the active review, and navigates to the resulting Review activity.
- Loading, validation, submission failure, keyboard focus, and narrow-screen behavior are covered.

## AC-4 — Project Overview

Initial state: **Unresolved**

- Overview behaves as a concise project briefing with this scan path: project identity and primary actions; actionable condition or next step; recent activity; findings preview.
- New review and New dynamic test remain immediately discoverable.
- Review and Dynamic Testing activity are combined chronologically and limited to five preview rows with type, state, timestamp, and direct navigation.
- The complete Review list, Dynamic Testing list, and full Findings panel are not duplicated on Overview.
- Findings preview shows no more than three real unresolved findings, ordered by severity and then recency, with a clear route to the Findings tab.
- Empty and unavailable states explain the next useful action without fake metrics or readiness claims.

## AC-5 — Source tab and Add Source modal

Initial state: **Partial fix**

- Source uses the shared `12/12` section shell. The header contains Sources and a right-aligned icon-only add control with tooltip and accessible name; the visible “Add source” label is removed from the header.
- When empty, the reserved body is a functional drag-and-drop target and also supports keyboard/click file selection. A duplicate empty-state add button is not shown.
- Drag state, unsupported input, upload/import progress, and failure feedback are visible and do not discard existing sources.
- Populated repositories use a GitHub-style data explorer within the Centinel design system: repository header, nested folders/files, directory expansion, stable indentation, file counts, file/folder icons, restrained row separators, and keyboard-operable disclosures.
- The Add Source modal is wider on desktop, remains viewport-safe, gives the dropzone substantially more space, and places Upload, Repository, GitHub, Google Drive, and Slack options in one row that wraps only when needed.
- Available and unavailable source methods are truthfully distinguished; no connector is presented as operational without support.

## AC-6 — Findings tab

Initial state: **Partial fix**

- Findings is a dedicated full-width triage workspace; Overview contains only the preview defined in AC-4.
- Search and Source, Severity, Status, and supported Priority filters use one flat toolbar with an accurate matching count and a clear empty-filter recovery.
- Default ordering is severity, then recency.
- Each collapsed finding exposes severity, title, source, status, and updated datetime without a decorative visible row index.
- Expanded content uses an approximate `9:3` information/action split: description, evidence, location, and recommendation on the left; status, priority when supported, provenance, and actions on the right.
- Existing Accept, Dismiss, and Mark fixed behavior remains available, gives failure feedback, and does not silently mutate state on API failure.
- Large result sets remain performant and keyboard-operable.

## AC-7 — Collaborations tab

Initial state: **Unresolved**

- Collaborations uses the same full-width section shell, header/body structure, spacing, and minimum body height as Source.
- When real collaboration data is available, presentation supports GitHub username, email, and role in a scan-friendly row/table structure.
- When the service or data is unavailable, a body-level **Collaboration data is not connected** message is shown.
- No example collaborators, invitations, permissions, or roles are presented as real data.

## AC-8 — Project Settings and global Settings

Initial state: **Unresolved**

- Project Settings uses stacked `12/12` settings sections with the same header/body component, spacing, typography, controls, and responsive behavior as global Settings.
- Global Settings is migrated to that same section system; global provider/application settings remain distinct from project-specific configuration.
- Project details shows project name, workspace location, and created datetime with an explicit editable/read-only distinction.
- Severity and Priority are presented as separate project terminology sections.
- Terminology CRUD is enabled only when a real persistence/API contract exists. Without it, the interface truthfully identifies the capability as unavailable and does not simulate saved changes.
- Create, rename, reorder, and delete flows, when supported, protect referenced terms or require a replacement, provide validation and failure feedback, and are keyboard accessible.
- Settings remains predominantly white/grey/black with green limited to actions, selection, and successful state.

## AC-9 — Regression, accessibility, and build verification

Initial state: **Unresolved**

- Relevant component/screen tests cover pagination, filters, Review entry and project creation, Source empty/drop states and tree disclosure, Findings disclosure/actions, and Settings capability states.
- `pnpm --filter centinel build` succeeds.
- Relevant frontend tests succeed; any unrelated pre-existing failure is isolated and documented with evidence.
- UI is reviewed at 1440×900, 1200×900, and a narrow viewport with no lost actions or horizontal overflow.
- Keyboard order, visible focus, accessible names, dialog focus restoration, disclosure state, status announcements, and reduced motion are checked for changed interactions.
- Unrelated working-tree changes and existing sidecar/API behavior remain intact.

## Final review table

| ID | Area | Final state | Evidence / remaining gap |
|---|---|---|---|
| AC-1 | Shared structure | Completed | Full-width section shells and neutral palette visually reviewed at 1440×900; no overflow at 1200px, 720px, or 375px. |
| AC-2 | Projects / Recent Projects | Completed | Five-row pagination regression test passes; shared table, neutral toolbar, and 1440px directory screenshot verified. |
| AC-3 | New Review entry | Completed | Dedicated route, create-project modal, source context, selection handoff, and start navigation covered by ReviewEntry/AppShell tests and 1440px screenshot. |
| AC-4 | Project Overview | Completed | Overview screenshot and ProjectDetail tests verify briefing layout, combined activity preview, next step, and findings preview without duplicated full lists. |
| AC-5 | Source / Add Source | Completed | Empty drop target, unsupported-file feedback, nested repository disclosure, and modal behavior covered by ArtifactsPanel tests; modal and populated Source screenshots verified. |
| AC-6 | Findings | Completed | Search/filter/count, severity-recency ordering, disclosure, 9:3 detail/action structure, retry, and mutation-error handling are implemented; Findings tests and responsive checks pass. |
| AC-7 | Collaborations | Completed | Shared section shell and truthful disconnected state verified by ProjectDetail tests and 1440px screenshot. |
| AC-8 | Project / global Settings | Partial fix | Matching full-width section style and project details/terminology boundaries are complete; Severity/Priority CRUD remains unavailable because no persistence/API contract exists. |
| AC-9 | Verification | Completed | `pnpm --filter centinel test`: 18 files/63 tests; `pnpm --filter centinel build`: pass; 1440px screenshots plus 1200/720/375 no-overflow checks completed. |
