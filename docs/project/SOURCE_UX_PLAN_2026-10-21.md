# Source UX implementation plan

Specification: [SOURCE_UX_SPEC_2026-10-21.md](SOURCE_UX_SPEC_2026-10-21.md).

## Execution

1. Capture the existing Sources and detail component with an isolated local fixture harness; preserve all unrelated working-tree changes.
2. Simplify the list, detail, file navigation, and import choices in ArtifactsPanel; retain existing transport and persistence behavior. Consolidate Source-specific CSS in one scoped component stylesheet.
3. Add meaningful behavior regression tests, run the relevant frontend suite and build, then inspect 1440×900, 1200×900, narrow and 200%-equivalent layouts.
4. Review the final diff for correctness, accessibility, style isolation, and unsupported claims. Record actual results and limitations below.

## Progress and evidence

- Planning: complete. Code inspection confirmed mixed connection/material rows, inconsistent Drive Open behavior, repeated location metadata, competing directory controls, and no list/global file search.
- Implementation: complete in `centinel/src/components/ArtifactsPanel.tsx` and its new scoped `ArtifactsPanel.css`. Removed the superseded Source directory/detail CSS from `workspace.css` and Source overrides from `ProjectDetailScreen.css`, preserving unrelated working-tree edits.
- Behavior: list search and focus restoration; separate update disclosure; saved previews for Drive and local documents; progressive metadata/removal; repository-wide file search; grouped local/connected imports; visible retry/reconnect/history errors. All five import paths retain their existing API payloads.
- Build: `pnpm --filter centinel build` passed after correcting test query typings. Vite emits its existing-size chunk warning; no new code-splitting work is included.
- Targeted checks: Sources and Project detail suites passed together (47 tests before the final four import/location tests were added). Final Source suite has 24 tests, including upload, local folder, GitHub, Drive folder and Slack scopes.
- Full-suite verification: `pnpm --filter centinel test --maxWorkers=2 --testTimeout=15000` **passed all 384 tests across 61 files** (118.53s), including all 24 Source tests. The unrestricted run had 15 failures, predominantly 5-second timeouts plus follow-on interaction failures. With `--maxWorkers=2` and the default 5-second timeout, 383/384 tests passed; the remaining DynamicWorkspaceScreen exceptional-input test timed out. No tests were skipped or global runner configuration changed; the successful bounded run used a longer timeout explicitly.
- Browser checks: used the actual component and application styles in a temporary isolated fixture harness, labelled synthetic data with all service calls stubbed. Verified list → repository → global search → nested-file preview → back → document preview; Add source and Escape dismissal also worked. Desktop panels use the same row at 1440×900 (338px browser / 811px preview) and 1200×900 (324px / 777px). At 390×844 panels stack, list actions are 44px tall, and the import dialog fits within the viewport. At 720×450 the document preview fits the content width; this is a zoom-equivalent layout check, not a native 200% zoom test. No page-width overflow was measured in these states.
- Visual evidence: screenshot capture repeatedly returned `Unable to capture screenshot`, including after explicit viewport selection, showing the browser, and requesting a full-page capture. Screenshot-based visual acceptance is **blocked**, not passed. DOM snapshots and measured layout results were generated under `evidence/source-ux-2026-10-21/`; they do not establish visual polish or WCAG compliance.
- Residual limitations: repository membership is unavailable in the frontend Artifact contract; no backend mapping will be invented. Live provider, OAuth and native picker validation require configured runtime services.
- Cleanup: removed both temporary fixture harness files, closed the browser tab, restored its viewport, and stopped only the preview Vite process launched by this task. No fixture route or operational sample data is shipped.

## Acceptance status

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Sources | Separate materials/updates, search and restore focus, no repeated path/delete controls | Behavior verified | Screenshot acceptance pending |
| Source detail | Saved content first, details collapsed, explicit original action, preview retry | Behavior verified | Native external opening and live Storage not exercised |
| Repository detail | Directory navigation, global search, file preview and narrow stacking | Behavior and geometry verified | Existing repository identity/grouping limitation; visual review pending |
| Add source / updates | Five import paths, retained scope, visible failure/retry/reconnect/history | Component tests cover existing contracts | Live OAuth, native OS picker and remote sync not exercised |
| Release checks | Frontend tests, production build, target widths, visual and zoom checks | Build and bounded full suite passed; layout dimensions checked | Full screenshot and native 200% zoom acceptance remain open |

## Final review

Source-specific selectors now live in one stylesheet under `.source-workspace`; shared Findings selectors were retained when removing combined Source/Findings declarations. The frontend/sidecar contract, source grouping inputs, saved-version reader, sync cadence, and removal confirmation/persistence flow remain in place. Real Open original destinations are restricted to HTTP(S) URLs or absolute filesystem paths. No backend, migration, credentials, model settings, or AI assessments were changed by this task.
