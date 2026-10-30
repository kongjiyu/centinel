# GitHub Source reference implementation

## User direction

The user supplied three visual references: a GitHub repository directory, a GitHub file reader with a Files sidebar and scrollbars, and a categorized file explorer for mixed sources. The accepted flow is categorized Sources → repository directory → file reader. This supersedes the earlier split-preview composition in SOURCE_UX_SPEC_2026-10-21.md. Reference pages also inspected live on 22 October 2026:

- https://github.com/orgs/microsoft/repositories — bordered list, search, compact linked names and metadata.
- https://github.com/microsoft/vscode — repository identity, compact toolbar, bordered folder/file table, supporting About information.
- https://github.com/microsoft/vscode/blob/main/README.md — breadcrumbs, file controls, Preview/Code, bordered reader and content hierarchy.

Reference screenshots are stored under `evidence/github-source-ux-2026-10-22/`. Use the actual screenshots for visual comparison, not a generated mockup. The existing Centinel shell remains the surrounding product navigation.

## Specification

1. Source list: All sources / Repositories / Documents / Images categories, search, and a bordered Name / Kind / Added table. Names are explicit navigation controls, with concise origin/count and recorded import date. Use 20-row pagination; reset the page when filtering. Preserve category, query and focus on return. A project containing only one repository opens its directory directly.
2. Repository browsing: use the Code view's full directory table, compact toolbar and root/path breadcrumbs. Show only real saved-file metadata. Folders navigate in place; a file opens a distinct reading state. Keep source management secondary. No empty side-by-side preview in the browsing state.
3. File reading: keep repository/path context, a collapsible Files sidebar, expandable folders, and file controls above a bordered full content reader. Sidebar and reader scroll independently. Markdown uses Preview/Code. Code uses line numbers, preserves whitespace, and scrolls horizontally within its reader. Opening a different file resets its reader position while preserving sidebar position. Document sources use the same reading hierarchy. Return to a directory through its breadcrumb without leaving the source.
4. Data and performance: never prefetch all file bodies. Read one selected file through the existing version-owned endpoint. Do not introduce a branch selector, commits, fake authors or dates, star/fork counts, or editing controls. Preserve existing import, sync, retry and removal contracts.
5. Responsive/accessibility: native button/link semantics, labelled search, visible focus, semantic tables, operable file navigation and 44px narrow controls. Check 1440×900, 1200×900, and 390px width; verify screenshots and relevant component tests/build. Keep styles under `.source-workspace`.

## Plan

1. Capture repository/list/file references and record the Source-specific design amendment.
2. Replace source rows and repository/detail composition; reuse import/update workflows.
3. Verify browsing/search/back, saved previews, original/code modes, file switching and error paths.
4. Compare the implemented screenshots against the reference, run frontend tests/build, and record honest fidelity/data limitations.

## Acceptance

Pixel identity for GitHub-only data/actions is not asserted: Centinel retains its light theme, font and surrounding shell. The accepted target is the supplied explorer/table/reader structure. Source-local blue navigation and 6px control corners are recorded in DESIGN.md.

Browser verification uses the actual component and CSS with synthetic fixtures, without live services. Screenshots are in `evidence/github-source-ux-2026-10-22/`: `sources-1440.png`, `repository-1440.png`, `file-detail-1440.png`, `file-code-1440.png`, `file-detail-1200.png`, and corresponding 390px screenshots. At 1200px and 390px, long code overflows only its reader; the page width stays equal to the viewport. At 390px the source table scrolls internally. Both scrollbars were exercised: reader 397.6px while sidebar stayed at 0, then sidebar 293.6px while reader stayed at 397.6px. Switching files reset the reader to 0 and retained sidebar position.

The existing Artifact contract lacks reliable per-repository identity. Repository artifacts therefore retain the existing common-root grouping; this change does not establish correct separation of multiple repository imports. Native desktop file pickers and authenticated remote imports have unit coverage but were not exercised live in this browser verification. No private content, model calls or remote writes were used.

## Final verification

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Mixed-source explorer | Categories, search, linked names, pagination and back-state retention | Passed component tests and browser checks | Existing repository identity limitation above |
| Repository directory | Folder table, compact directory chains, breadcrumbs, Add file; no file-body prefetch | Passed component tests and browser checks | Metadata inventory remains loaded for navigation |
| File detail | Expandable/collapsible sidebar, independent scrollbars, Preview/Code, line numbers and file-switch scroll reset | Passed component tests and browser checks | Synthetic browser fixtures; native/authenticated flows not live-tested |

- `pnpm --filter centinel test --maxWorkers=2 --testTimeout=15000`: **399 tests passed across 61 files**, 101.17 seconds. Includes 30 ArtifactsPanel tests. The first run exposed an invalid single-file fixture for the compact-directory regression; after correcting its root context, the complete rerun passed.
- `pnpm --filter centinel build`: **passed**. Vite retains its bundle-size warning (main JS approximately 1.20 MB before gzip); this change does not claim to eliminate all initial application load costs.
- Scoped `git diff --check`: **passed**. Source CSS is scoped to `.source-workspace`; unrelated pages retain their rules.
- Browser: **1440×900, 1200×900, 390×844 checked**. No captured browser errors/warnings. Repository Add file opens the existing import dialog. Temporary fixture entrypoints and the preview server were removed/stopped after checking; screenshot evidence remains ignored locally.

The earlier project-loading diagnosis and bounded metadata-query changes are documented separately in PAGE_LOADING_DIAGNOSIS_2026-10-22.md. Authenticated production timing remains unverified; no speed-up percentage is asserted.
