# Project Detail Refinement Plan

Status: implemented by Luna Max and verified  
Created: 2026-09-08

The attached screenshots are visual references only. `DESIGN.md`, persisted application data, and existing behavior remain the implementation sources of truth.

## 1. Header and overview structure

- Vertically center the Back and Action controls in the Project header.
- Remove the leading plus icon from Action and raise the menu above the section navigation and content surfaces.
- Remove decorative dividers beneath Need attention, Readiness, and Recent activity headings and between their rows.
- Keep the existing 8/4 overview grid and current source types/counts.
- Render Readiness as a 1/9/2 checklist row: semantic icon, source label/count, and colored Ready/Insufficient/Missing state.
- Render Recent activity rows as 8/2/2 activity/date/state columns, with the shared recent-project hover surface and radius.

## 2. Findings workspace

- Remove supporting copy and decorative header/pagination dividers.
- Use an 8/4 master-detail layout: findings table on the left and an elevated white details panel on the right.
- Show a prominent total and table columns in this exact order: Priority, Severity, Description, Status.
- Match the AI usage-log table structure with bordered headers/rows and the recent-project hover color/radius.
- Keep search and filters; put the `Showing X–Y of Z` count at the bottom-left inside the table region.
- Selecting a row populates the detail panel; the empty panel reads `Select Finding to review the details`.
- Preserve finding lifecycle actions and expose row selection to keyboard users.

## 3. Settings and collaboration

- Make Project settings and Configuration full-width stacked sections.
- Remove nested card backgrounds/borders and supporting descriptions; use one divider only between the two sections.
- Present settings rows as 2/10 label/value columns.
- Keep fields read-only until Edit is selected from the Project settings header; provide Save/Cancel/error states using the real project update contract.
- Move Remove project into Project settings and retain only an explicit irreversible-action warning before its confirmation.
- Remove the Collaboration heading divider and add an Add collaborator action.
- Add a dialog that searches GitHub by email, displays matching accounts, and requests confirmation before sending an invitation. Derive repository identity from the project Git remote and use a configured GitHub token without exposing it to the frontend or logs.
- Show a clear unavailable/error state when the repository remote or GitHub credential is missing. Do not send a real invitation during automated or visual validation.

## 4. Verification and design QA

- Update focused component and Project Detail tests for menu layering, edit state, table selection, readiness states, activity layout, and collaborator dialog/API behavior.
- Run frontend and sidecar TypeScript checks, focused tests, the frontend production build, and `git diff --check`.
- Render and inspect Overview, Findings, Collaboration, and Settings at 1440×900, 1200×900, and a narrow viewport.
- Compare the reference and rendered states in one visual QA artifact, fix all P0–P2 mismatches, and record the final result in project-root `design-qa.md`.
