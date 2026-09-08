# Dashboard, Settings, and Shell Refinement Plan

## Objective

Refine the recently added dashboard, settings, pinned-project navigation, and desktop shell so the interface is lighter, denser, and structurally closer to a classic desktop workspace. The five supplied screenshots are visual references only; this plan follows the user's written requirements, `DESIGN.md`, existing behavior, and real application data.

## Guardrails

- Preserve all existing navigation, project selection, pin persistence, provider save/test behavior, usage loading/filtering, Tauri menu behavior, and frontend/sidecar contracts.
- Use the existing light Centinel token system and Lucide icons. Do not copy the dark palette from the usage references.
- Never manufacture cost, success-rate, latency, cache-hit-rate, provider readiness, or other metrics that are not returned by the existing API.
- Keep the current route-aware semantic breadcrumbs, keyboard access, focus-visible states, disclosure semantics, responsive behavior, and browser/Vitest fallbacks.
- The latest written request supersedes the earlier dashboard rule that prohibited right arrows: breadcrumb separators and the restored Recommendation previous/next pager are the only intended `>` uses on Dashboard.

## Implementation

### 1. Restructure the application shell

Files: `centinel/src/components/AppShell.tsx`, `centinel/src/components/PageBreadcrumbs.tsx`, `centinel/src/components/WindowHeader.tsx`, `centinel/src/workspace.css`, and their tests.

- Keep one white application/window background below the native-style title bar.
- Split the workspace into two sibling regions:
  - a navigation-panel container with its own compact header and independently scrolling navigation body;
  - a page-content container with a rounded top-left corner, its own page header, and independently scrolling body.
- Move the sidebar collapse/expand button out of the breadcrumb component and into the navigation-panel header, aligned to the right. Preserve its accessible name, expanded state, tooltip, and 40/44 px hit target.
- Keep the route-aware breadcrumb trail, but render it inside the page-content header rather than across the full window width.
- Preserve the 232 px expanded and 72 px collapsed widths. On narrow windows, keep actions reachable and prevent horizontal shell overflow.
- Reduce the Centinel shield in the desktop title bar to a restrained 14–16 px visual size without shrinking the title-bar controls.

Acceptance:

- Sidebar toggle is inside the navigation header, not the breadcrumb row.
- Breadcrumbs occupy only the page-content header.
- The page-content surface has a visible top-left radius against the white shell background.
- Title bar, sidebar, and page content retain independent, predictable layout and scrolling.

### 2. Simplify Pinned navigation

Files: `centinel/src/components/AppShell.tsx`, `centinel/src/workspace.css`, `centinel/src/components/AppShell.test.tsx`.

- Remove the standalone `Pins` category label and the pin icon from the disclosure heading.
- Rename `Pinned projects` to `Pinned` and render it as a lightweight ChatGPT-classic-style section label with a trailing expand/collapse chevron.
- Preserve persisted expand/collapse state and keyboard/ARIA disclosure behavior.
- Keep pinned project rows as compact indented navigation items with truncation and accessible names.
- In the empty state, show only `No pinned projects` using lower-emphasis text. Remove the `Open Projects` link/action.
- In collapsed-sidebar mode, retain a discoverable icon/tooltip representation without showing clipped text.

Acceptance:

- There is no visible `Pins` category label, `Pinned projects` copy, or `Open Projects` action.
- `Pinned` expands and collapses and still opens real pinned projects.
- The empty message is legible but visually subordinate.

### 3. Simplify Dashboard quick actions

Files: `centinel/src/screens/DashboardScreen.tsx`, `centinel/src/screens/DashboardScreen.css`, `centinel/src/screens/DashboardScreen.test.tsx`.

- Remove the Quick actions panel/container surface and visible `Quick actions` heading.
- Retain the three action buttons and their routes in a bare 12-column grid above Recommendations:
  - Create project: 12/12 width;
  - Review: 6/12 width;
  - Dynamic Testing: 6/12 width.
- Keep the buttons visually coherent with the Centinel action system, keyboard accessible, and stacked at the existing narrow breakpoint.

Acceptance:

- The three buttons remain fully functional, but no enclosing card/panel or visible Quick actions title remains.

### 4. Refine Recent projects density

Files: `centinel/src/components/ProjectSummaryTable.tsx`, `centinel/src/components/ProjectSummaryTable.css`, dashboard tests.

- Add consistent horizontal and vertical padding inside every dashboard Recent projects row so hover/focus surfaces do not touch the panel edge.
- Set dashboard project names to the normal dense-list body treatment (14 px/20 px, weight 400) rather than title-sized or bold text.
- Preserve the hidden semantic header, right-aligned current state, row keyboard activation, four-row limit, no row dividers, and no dashboard action column.
- Do not change the full Projects directory typography or table controls unless a shared rule must be isolated with the existing dashboard variant.

Acceptance:

- Every dashboard item has a consistent padded hit area.
- Project names scan like normal list text, while state badges remain aligned at the far right.

### 5. Restore Recommendation previous/next pagination

Files: `centinel/src/screens/DashboardScreen.tsx`, `centinel/src/screens/DashboardScreen.css`, `centinel/src/screens/DashboardScreen.test.tsx`.

- Replace numbered recommendation selector buttons with compact previous and next icon buttons using `ChevronLeft` and `ChevronRight`.
- Keep the `N of M` position text and `aria-live` announcement.
- Provide explicit accessible labels (`Previous recommendation`, `Next recommendation`) and use deterministic wraparound navigation.
- Show pager controls only when multiple recommendations exist.

Acceptance:

- The recommendation header exposes `<` and `>` controls, no numbered selectors, and correct keyboard-operable wraparound behavior.

### 6. Redesign API Key presentation

Files: `centinel/src/screens/SettingsScreen.tsx`, `centinel/src/workspace.css`, `centinel/src/screens/SettingsScreen.test.tsx`.

- Replace the current visually separated Text Generation / Multimodal Vision columns with one cohesive API Key flow.
- Keep the functional scope of each provider setting clear through compact labels or metadata, but do not split the section into two competing visual columns.
- Preserve provider selection, masked-key handling, save/test actions, messages, disabled states, and local credential wording.
- Keep custom-provider fields and behavior, while normalizing field height, label/copy spacing, grid alignment, card radius, button placement, and narrow-screen stacking.
- Avoid nested-card clutter: one subsection surface may contain compact provider blocks separated by spacing or a quiet rule.

Acceptance:

- API Key reads as one section and one flow.
- Both provider configurations remain functional and identifiable.
- Custom endpoint/model/format inputs retain their current behavior with consistent styling.

### 7. Redesign Usage overview and logs

Files: `centinel/src/screens/SettingsScreen.tsx`, `centinel/src/workspace.css`, `centinel/src/screens/SettingsScreen.test.tsx`.

- Recompose the Usage subsection using the hierarchy of references 3 and 4 in Centinel's light theme:
  - a prominent `Tokens processed` total derived from input + output + cache read + cache creation;
  - a compact `Total requests` summary from the existing call count;
  - a responsive metric strip for Input, Output, Cache creation, and Cache reads;
  - retain the scope filter, refresh action, loading, error, and empty states.
- Redesign the aggregated provider/model table as a clean usage-overview table. Use only fields supported by `byGroup`, such as Provider, Format, Model, Requests, Input, Output, Cache, and total tokens.
- Retain the expandable recent-calls log as a separate, clearly labelled table with its existing real fields.
- Do not render Cost, Success rate, Average latency, or Cache hit rate unless the service contract genuinely supplies those values; do not infer them from unrelated fields.
- Use tabular numerals, accessible table headers, horizontal overflow at narrow widths, and no dark-theme styling copied from the references.

Acceptance:

- The overview has one clear total, one request summary, and four supporting token metrics.
- Aggregated usage and recent call logs remain backed entirely by `getAiUsage` data.
- Loading, empty, error, filter, refresh, and recent-log disclosure states remain usable.

### 8. Update the design contract and tests

Files: `DESIGN.md` and the relevant component/screen tests.

- Record this approved refinement in `DESIGN.md`, including the shell split, simplified Pinned disclosure, bare quick-action grid, restored recommendation arrows, dashboard row typography/padding, unified API Key flow, and honest usage hierarchy.
- Update tests with accessible role/name queries for:
  - sidebar toggle relocation and `Pinned` disclosure;
  - no Pins category/Open Projects empty-state action;
  - bare quick actions and their routes;
  - normal recommendation previous/next behavior;
  - usage summary calculations and supported table labels;
  - provider form behavior after layout changes.
- Avoid snapshot-only assertions; test user-visible behavior and semantic structure.

## Verification

1. Run targeted tests while iterating:
   - `pnpm --filter centinel test -- AppShell.test.tsx PageBreadcrumbs.test.tsx WindowHeader.test.tsx`
   - `pnpm --filter centinel test -- DashboardScreen.test.tsx SettingsScreen.test.tsx`
2. Run the full frontend suite: `pnpm --filter centinel test`.
3. Run the frontend build: `pnpm --filter centinel build`.
4. Run `git diff --check`.
5. Visually verify Dashboard and Settings at 1440x900, 1200x900, and a narrow viewport. Check expanded/collapsed sidebar, empty/populated pins, recommendation paging, provider defaults/custom fields, usage loading/populated/empty states, focus visibility, overflow, and style leakage.

## Non-goals

- No sidecar API or database schema changes.
- No invented usage pricing or reliability telemetry.
- No changes to project pin persistence semantics, provider secrets, project routing, or the Tauri window-control behavior.
- No wholesale redesign of screens outside Dashboard, Settings, and the shared shell.
