# Source workspace simplification

The screen composition is superseded by [the GitHub reference specification](SOURCE_GITHUB_REFERENCE_2026-10-22.md), following the user's later screenshots. Import, recovery and source-management contracts below remain applicable.

## Outcome and scope

Users understand Source as the materials available to their project's Reviews. The list answers “What have I added?”, detail answers “What is inside?”, and Add source answers “Where are my materials?”. Follow DESIGN.md's neutral surfaces, shared controls, semantic status, and progressive disclosure. This is a frontend change; imports, authentication, durable source versions, sync cadence, Review selection, and backend contracts remain unchanged.

## Screen contract

1. **Sources:** one heading, one primary Add source action, and a labelled search. Show imported documents and the existing repository collection in a quiet list. Each row has a familiar icon, name, plain origin/category or file count, and one explicit View button. Do not repeat full paths or put removal controls on every row. Search matches names and relevant paths/origins; preserve the query after returning from detail. Distinguish an empty project, no search matches, an import still waiting for files, and a failed load. Failed loads expose Retry and never claim there are no materials.
2. **Source updates:** separate connected-source management from imported materials. Collapse successful connection detail initially; automatically reveal failed/inaccessible/disconnected work. Keep source-specific errors, Sync/Retry, reconnect guidance, and History available. Use shared StatusBadge and user-facing execution labels. A successful import/sync is not proof of Review coverage, approval, or currency confirmation.
3. **Document detail:** Back to sources, file name and concise origin, then the saved-content preview. Every View action opens in-app, including Drive. An explicit Open original action is available only when an actual location exists. Location, added date, category, and Remove source live in a collapsed Source details disclosure below content. Preserve Markdown Preview/Original, PDF/image/text previews, unsupported-format and failure states; provide preview retry.
4. **Repository detail:** Back to sources, collection name and saved file count, then a file browser beside content on desktop and above content on narrow screens. Use a semantic list of directory/file buttons rather than an incomplete ARIA tree. A single breadcrumb handles directory navigation. Search spans every imported file in the collection, shows relative locations, distinguishes no matches, and retains directory context when cleared. Technical root and Remove repository live in Source details. No individual file selection means an explicit instruction to choose a file.
5. **Add source:** group choices by location: This computer (Upload files, Import local folder) and Connected apps (GitHub, Google Drive, Slack). Keep drag-and-drop as an alternative to file upload, without a second large duplicate upload surface. Explain that connections are managed in Settings. Preserve provider browsing, branch/folder selection, pagination, and Import and sync. Keep import errors inside the dialog and prevent repeat submissions while work is active.

## Interaction and accessibility

- Use native buttons, visible search labels, semantic headings/lists and native details disclosures. Keep actions available by keyboard and at narrow widths; do not depend on clickable row containers or hover.
- Focus the detail heading when opening a source; Back restores focus to the newly mounted View button for that source. A removal confirmation names its exact scope and retains existing behavior.
- Do not hide a source error in a closed disclosure. Unknown update state stays explicit. Preserve saved files during refresh failure and distinguish sync completion from a request in flight.
- Use scoped component CSS and existing tokens, not new app-wide colors or dashboard changes. No decorative metrics, gradients, status walls, nested cards, or entry animations.
- At 1440×900 and 1200×900 keep list names readable and the repository browser narrower than preview. At a narrow viewport stack browser/content and preserve all controls with 44px targets. Verify a 200%-equivalent content width and reduced-motion styles.

## Data limitations

Artifact records do not expose a reliable connected-source/repository identifier. Do not infer membership from names, timestamps or remote URLs; keep connections separate and retain the existing repository collection grouping. Do not claim multiple repository identities are represented faithfully until the API supplies them. Counts describe saved files only. No semantic AI assessment is started for this redesign.

## Acceptance criteria

| Feature | Acceptance criteria | Required evidence |
| --- | --- | --- |
| Source list | Imported materials and update connections are separate; search/clear/back work; no repeated removal/path clutter | Component tests and desktop/narrow screenshots |
| Document detail | All origins open saved previews; details collapsed; original explicitly named; preview failure can retry | Component tests and screenshot |
| Repository detail | Directories, global file search, no-match state, preview and back work; semantic keyboard controls | Component tests and desktop/narrow screenshots |
| Import and sync | All five import routes remain; grouping understandable; errors/recovery visible; history failure is not empty success | Existing and added component tests |
| Design/regression | Build and relevant frontend suite pass; scoped styles; target widths checked; native/live limits disclosed | Recorded results in implementation plan |

## Verification boundary

Visual checks may use the real component in an isolated local fixture harness with clearly labelled synthetic data and stubbed API methods. Such checks validate presentation and component interaction only, not live OAuth, native OS pickers, Supabase persistence, or remote sync. Never include the harness as a production route or substitute fixtures for real application data.
