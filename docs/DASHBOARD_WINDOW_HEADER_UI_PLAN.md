# Dashboard and application header UI plan

## Objective

Refine Home so its quick actions and recent-project list are simpler to scan, add consistent desktop window chrome and route-aware breadcrumbs, reorganize the navigation rail, and clarify the Settings information architecture. Preserve existing data loading, project limits, review/test behavior, and the Projects directory experience.

## Requirement interpretation

- The first reference image defines the in-app page-location bar: a sidebar toggle followed by a route-aware breadcrumb such as `Home > Dashboard`.
- The second reference image defines the desktop window bar: Centinel/app mark on the left, `File`, `Edit`, `View`, and `Help` menu labels, and Windows-style minimize, maximize/restore, and close controls on the right.
- “Remove all `>` on dashboard pages” applies to dashboard content affordances. Dashboard action buttons, recommendation controls, overflow links, and recent-project rows must not render right-arrow/chevron glyphs. Breadcrumb separators remain because the same request explicitly requires the `Home > Dashboard > …` hierarchy.
- The three new actions sit in the dashboard’s right rail above Recommendations. Inside their own 12-column grid, Create project spans 12 columns; Review and Dynamic Testing each span 6 columns. At narrow widths they may stack to preserve readable labels and 44 px targets.
- The recent-project simplification is dashboard-only. The full Projects directory retains visible table headers, directory filters, pagination, and its explicit row affordances.
- Removing recent-project action buttons removes the trailing action column, not access to the project: each dashboard row remains hoverable, focusable, and operable with Enter/Space to open the project overview.
- File/Edit/View/Help must not be dead controls. Implement only honest, working menu items backed by existing browser/Tauri capabilities; visually match the reference without inventing unsupported product commands.
- Remove both the sidebar brand/logo block and the service-readiness footer. The window title bar now owns product identity; connection and provider state belongs in Settings.
- Group sidebar navigation under visible category labels in this exact order: Dashboard (Home), Activities (Review, Dynamic Testing), Settings (Settings), and Pins (pinned projects).
- The repository has no pin field or pinning API. Implement pins as a local desktop preference, persisted in `localStorage`, with a discoverable pin/unpin control in the full Projects directory. Do not present pins as shared or server-synchronized state. Filter stale IDs against the current project list so removed projects disappear safely.
- Pins is an accessible expand/collapse group. Its project links open project overview; its empty state is concise and points users to the Projects directory to pin workspaces.
- Settings uses three top-level sections in this order: Versions; Model Service Provider; Connections. Model Service Provider contains two explicit subsections, API Key and Usage. Existing Text AI and Vision AI provider forms belong under API Key, and the existing token dashboard belongs under Usage.
- Versions shows only versions retrievable from the running application/build (Centinel and Tauri where available), with a safe browser/test fallback. Connections preserves the current honest capability boundary and must not invent GitHub, Drive, Slack, or other connection statuses.

## Implementation plan

### 1. Record the approved design-system amendment

Update `DESIGN.md` so the newest explicit requirements supersede the prior dashboard contract where it requires an activity filter, visible table headers, row action controls, and a header-adjacent View more link. Add the custom window bar and breadcrumb bar to the application-shell contract. Keep existing neutral-first tokens, Lucide-only icon rule, WCAG 2.1 AA target, and responsive breakpoints.

### 2. Add reusable desktop window chrome

Create a shared `WindowHeader` component and render it once from `AppShell` above the sidebar/content workspace.

- Add a 40–44 px light neutral title bar with the Centinel/app mark, File/Edit/View/Help menu triggers, a drag region, and right-aligned minimize, maximize/restore, and close buttons.
- Back the window controls with `@tauri-apps/api/window`; keep button labels/tooltips, visible focus, and the expected larger close-button hover state.
- Implement a small accessible menu primitive (button + popup menu, Escape/outside-click close, focus restoration) for the four menu labels. Limit entries to working commands such as close, standard edit commands, zoom/reset view, and product/about information; omit any unsupported command.
- Set the Tauri window to custom decorations and enable only the window permissions/features required for drag, minimize, maximize/unmaximize, and close.
- Keep a safe browser/Vitest fallback so importing or rendering the component outside Tauri does not throw.

Primary files: `centinel/src/components/WindowHeader.tsx` (new), `centinel/src/components/WindowHeader.test.tsx` (new), `centinel/src/components/AppShell.tsx`, `centinel/src/App.css`/`centinel/src/workspace.css`, `centinel/src-tauri/tauri.conf.json`, and `centinel/src-tauri/Cargo.toml` if Tauri feature flags require it.

### 3. Add a shared route-aware breadcrumb bar

Create a `PageBreadcrumbs` component owned by `AppShell`, using `screen` plus the loaded project list to build semantic trails.

- Render `<nav aria-label="Breadcrumb"><ol>…</ol></nav>` between the desktop window bar and page content.
- Include a real sidebar collapse/expand button at the leading edge, with `aria-expanded`, an accessible name, and a minimum 40 px desktop / 44 px narrow hit target.
- Make ancestor crumbs actionable and the final crumb plain text with `aria-current="page"`; separators are decorative and hidden from assistive technology.
- Suggested trails:
  - Dashboard: Home / Dashboard
  - Projects: Home / Projects
  - Project overview: Home / Projects / `{project name}`
  - Review entry/activity: Home / Review / current flow or activity
  - Dynamic run/evidence: Home / Dynamic Testing / current run or Evidence
  - Requirements: Home / Review / Requirements
  - Settings: Home / Settings
- Truncate long project/session context visually while preserving the full accessible/title text. Allow horizontal breadcrumb scrolling on narrow windows instead of wrapping into a tall header.
- Restructure shell sizing so the title bar and breadcrumb bar are fixed above an independently scrolling sidebar/content region; no content may be hidden behind either bar.

Primary files: `centinel/src/components/PageBreadcrumbs.tsx` (new), `centinel/src/components/PageBreadcrumbs.test.tsx` (new), `centinel/src/components/AppShell.tsx`, `centinel/src/components/AppShell.test.tsx`, `centinel/src/App.css`, `centinel/src/workspace.css`, and `centinel/src/screens/DashboardScreen.css`.

### 4. Reorganize the navigation rail and add local pins

Refactor `AppShell` navigation into labelled groups and move all product identity to the new window header.

- Delete the sidebar brand/logo section and the service-ready/provider-readiness footer, including obsolete props, imports, and CSS.
- Render the groups Dashboard, Activities, Settings, and Pins in the required order. Category labels are non-interactive text; navigation entries remain semantic buttons with active state and accessible names.
- Add a small reusable local-preference hook for pinned project IDs. Validate parsed storage defensively, preserve ordering, and synchronize changes in the same window.
- Add an optional pin/unpin control to the Projects-directory `ProjectSummaryTable` variant only. It must have an accessible name, pressed state, tooltip, and no effect on dashboard rows.
- Render valid pinned projects under the Pins disclosure. The disclosure uses `aria-expanded`/`aria-controls`, remains usable when the sidebar is collapsed, and persists its expanded state locally. Project links show a consistent Folder/Pin icon and open `{ name: 'project-detail', projectId }`.
- When there are no pins, show a compact empty message when expanded and a route to Projects. Never auto-pin recent projects.

Primary files: `centinel/src/components/AppShell.tsx`, `centinel/src/components/AppShell.test.tsx`, `centinel/src/components/ProjectSummaryTable.tsx`, `centinel/src/components/ProjectSummaryTable.css`, `centinel/src/screens/ProjectsScreen.tsx`, `centinel/src/hooks/usePinnedProjects.ts` (new), `centinel/src/App.tsx`, `centinel/src/App.css`, and `centinel/src/workspace.css`.

### 5. Reorganize Settings

Restructure `SettingsScreen` without changing provider-save, provider-test, or usage API contracts.

- Add a Versions section first. Resolve the Centinel app version and Tauri version with `@tauri-apps/api/app`; display an explicit unavailable state in browser/Vitest rather than a fabricated value.
- Add Model Service Provider as the second top-level section, containing:
  - API Key: the existing Text AI and Vision AI provider configuration forms.
  - Usage: the existing token totals, provider/model grouping, scope filter, refresh action, and recent-call disclosure.
- Add Connections last. Rename the current Source connections region to Connections and retain the truthful explanation that supported sources are managed inside each project until global connectors exist.
- Use semantic nested headings (`h2` for sections, `h3` for API Key/Usage and provider groups), avoid nested-card clutter, and keep tables horizontally usable at narrow widths.
- Update the page description and remove the configured-provider count from the header if it duplicates the API Key subsection.

Primary files: `centinel/src/screens/SettingsScreen.tsx`, `centinel/src/screens/SettingsScreen.test.tsx`, `centinel/src/workspace.css`, and Tauri app API mocks as needed.

### 6. Add the dashboard quick-action launchpad

Refactor the dashboard right rail into a vertical stack: Quick actions first, Recommendations second.

- Add Create project as the 12/12 action, followed by Review and Dynamic Testing at 6/12 each.
- Use Lucide icons, visible text labels, shared tokens, and stable hover/focus/pressed states; do not add arrow/chevron glyphs.
- Create project routes directly into the existing focused project-creation modal. Extend the `projects` screen state with a narrowly scoped `createProject`/`initialCreate` flag instead of duplicating the modal on Home.
- Review and Dynamic Testing reuse existing launch rules: retain latest/current project context where available, otherwise use the existing project-selection or project-creation path.
- Stack all three actions below 720 px and retain at least 44 px control height.

Primary files: `centinel/src/screens/DashboardScreen.tsx`, `centinel/src/screens/DashboardScreen.css`, `centinel/src/types.ts`, `centinel/src/App.tsx`, `centinel/src/screens/ProjectsScreen.tsx`, and related tests.

### 7. Simplify Recent projects on Home only

Add a dashboard presentation variant to `ProjectSummaryTable` rather than changing the shared directory defaults.

- Remove Home’s activity-type state, Select, filtering call, and filter transfer in View more. View more routes to the unfiltered Projects directory.
- Place Recent projects at the left and View more at the far right of the section header.
- In the dashboard variant, visually hide (but retain for screen readers) the Project, Latest activity, and Current state column headers.
- Render only three columns: Project, Latest activity, and Current state. Remove the trailing action column and all dashboard row chevrons.
- Pin Current state to the far right with right alignment and a stable width; keep Project and Latest activity flexible.
- Remove horizontal row dividers in the dashboard variant and use whitespace plus the existing restrained hover/focus treatment to distinguish rows.
- Preserve the four-row cap, real persisted data, loading/error/empty states, row click behavior, and Enter/Space navigation.
- Keep the default table variant unchanged for Projects.

Primary files: `centinel/src/screens/DashboardScreen.tsx`, `centinel/src/screens/DashboardScreen.css`, `centinel/src/components/ProjectSummaryTable.tsx`, `centinel/src/components/ProjectSummaryTable.css`, and tests.

### 8. Remove dashboard content chevrons comprehensively

Remove `ChevronRight`/`ArrowRight` glyphs from Action required controls, the affected-project overflow link, recommendation CTAs, and recent-project actions. Replace the recommendation previous/next arrow pair with labelled, accessible recommendation selectors (for example compact numbered/dot controls) so all recommendations remain reachable without a `>` glyph.

Do not remove chevrons from other pages, select controls, disclosure widgets, or the new breadcrumb separators.

### 9. Tests and verification

Update/add React tests to prove behavior rather than CSS implementation details:

- Dashboard renders the 12/12 + 6/12 action group labels, has no activity combobox, and View more navigates to `{ name: 'projects' }`.
- Create project opens the existing modal; Review and Dynamic Testing retain their current context/selection routing.
- Dashboard recent projects expose no visible column-header row or trailing action buttons, still show state and activity, remain limited to four, and open project overview by pointer and keyboard.
- Dashboard content contains no right-arrow/chevron icons; recommendation selection remains operable and labelled.
- Breadcrumbs render the correct current route and clickable ancestors for every `Screen` union variant; long project names do not remove the accessible name.
- Sidebar collapse toggles `aria-expanded` and the shell class/state.
- Sidebar has no logo/brand region or service-ready footer; its four category labels and required entries render in order.
- Pin/unpin persists locally, the Pins group expands/collapses accessibly, stale/deleted IDs are ignored, and pinned project links open the correct overview.
- Settings renders Versions, Model Service Provider, and Connections in order; API Key and Usage are nested under Model Service Provider; existing save/test/usage behavior remains covered.
- Version loading covers successful Tauri values and the explicit browser/test unavailable fallback.
- Window menu and window-control tests mock Tauri calls and cover keyboard close/focus restoration.
- Projects directory regression tests confirm its filters, visible headers, pagination, and row affordance remain unchanged.

Run:

```bash
pnpm --filter centinel test
pnpm --filter centinel build
```

Then visually verify the Tauri app at 1440×900, 1200×900, and a narrow viewport. Check custom-window dragging, double-click maximize/restore, all window buttons, keyboard navigation, focus visibility, 200% zoom, reduced motion, breadcrumb overflow, row navigation, modal focus, and that styles do not leak to non-dashboard screens.

## Acceptance criteria

- Home has no activity filter in Recent projects.
- View more is aligned to the far right of the Recent projects header and opens the full unfiltered Projects directory.
- Dashboard Recent projects has no visible column headings, row dividers, action column, action buttons, or right-chevron glyphs; Current state is the rightmost content.
- Create project spans the full quick-action row; Review and Dynamic Testing share the next row equally at desktop widths.
- The three quick actions appear above Recommendations and preserve existing navigation semantics.
- No dashboard content control renders a `>`/right-arrow glyph; breadcrumb separators remain.
- Every page displays a semantic route-aware breadcrumb bar.
- The application displays functional custom desktop window chrome resembling the second reference, including working minimize, maximize/restore, and close controls.
- The sidebar has no top logo section or bottom service status. It presents Dashboard, Activities, Settings, and Pins groups in the requested order.
- Users can pin/unpin projects from the full Projects directory; valid pins persist locally and appear in an accessible collapsible Pins group without affecting dashboard row actions.
- Settings presents Versions; Model Service Provider with API Key and Usage subsections; and Connections, without fabricating unavailable connection/version state.
- Relevant tests and the frontend build pass, and the three required viewport checks show no lost or overlapping content.
