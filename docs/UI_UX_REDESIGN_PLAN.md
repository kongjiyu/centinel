# Centinel UI/UX Redesign Implementation Plan

> Planning baseline: repository state on 2026-09-03
>
> Design authority: [`../DESIGN.md`](../DESIGN.md)
>
> Scope: frontend information architecture, interaction design, component system, accessibility, and visual migration; product behavior remains unchanged unless a gap is explicitly listed

> Living plan: this document is updated as each screen is migrated and validated. The checklist at the end records the current implementation boundary and the next verification work.

## 1. Outcome

Redesign Centinel from a dark mission-control interface into a calm office QA workspace that a non-technical reviewer can understand without removing the evidence, traceability, and expert controls needed by QA engineers and developers. The approved visual direction combines the material clarity of Apple-style productivity software with the predictable task density of an AWS Console workspace: quiet surfaces, deliberate hierarchy, compact tables, and clear next actions. These are experiential references, not brand or asset copies.

The target product has two obvious paths:

- **Static testing — Review files without running the application.**
- **Dynamic testing — Test a live website in a real browser.**

Shared Findings and Reports connect the modules. Technical detail is progressively disclosed instead of becoming the main interface.

## 2. Research synthesis

The requested `ui-ux-pro-max` searches were run against internal QA/admin-console patterns, responsive task-dense tables, keyboard focus, and enterprise minimalism. The product search was not a direct match for a QA console, so the result was treated as a recommendation rather than a source of truth; the explicit `DESIGN.md` contract remains authoritative. The selected direction is a grid-disciplined enterprise system with muted sage surfaces, accessible forest-green interaction, a teal-green Dynamic accent, compact data regions, and restrained semantic states. Marketing, community, dark-mode, glass, and product-demo patterns were rejected because Centinel is an operational desktop tool.

The stakeholder refinement is now explicit: use a light canvas with subtle material texture (surface contrast, hairline borders, and low layered elevation), compact but legible task rows, and an AWS-like information scent (persistent navigation, visible headers, predictable filters, and dense but calm tables). Do not translate “Apple-like” into skeuomorphic controls, blur, frosted glass, or gradients; do not translate “AWS-like” into dark infrastructure-console styling, telemetry decoration, or technical jargon.

The requested `make-interfaces-feel-better` review added these constraints:

- one typography system with technical mono only where the content is technical;
- concentric, tokenized radii and optical alignment;
- borders for structure and shadows only for elevation;
- one consistent Lucide icon family and stroke weight;
- exact, interruptible transitions with reduced-motion support;
- minimum 40 px desktop targets and 44 px narrow/touch targets;
- no `transition: all`, ornamental entrance motion, glow, or inconsistent component variants.

For the remaining screens, the polish pass also treats every data-bearing row as a scan surface: use tabular numerals for counts/timestamps, stable row height, an explicit disclosure or action control, visible hover/focus/pressed states, and no hover-only information. Repeated panels use the same outer radius, inset spacing, border, and elevation recipe; nested cards are reserved for a real hierarchy.

Norman’s principles and Shneiderman’s golden rules are translated into implementation requirements in `DESIGN.md`: visible state, natural mapping, signifiers, constraints, feedback, consistency, closure, reversibility, user control, reduced memory load, and universal usability.

## 3. Existing feature inventory

This inventory is based on current frontend screens, API client methods, sidecar routes, types, and tests. “Existing” means a code path is present; it does not claim every path is production-hardened.

### 3.1 Shared platform

| Capability | Current implementation | Redesign destination | State |
|---|---|---|---|
| Sidecar startup and health | Connecting state, connection failure, Retry | Global connection banner and compact shell status | Existing |
| Project management | List, create, choose local folder, open, delete; deletion keeps workspace files | Projects | Existing |
| Home summary | Project count, provider readiness, recent projects, latest Dynamic run, quick actions | Home | Existing, data cleanup required |
| AI provider settings | Text and Vision providers, presets/custom format, endpoint, model, masked key, save, test | Settings > AI providers | Existing |
| AI usage | Input/output/cache/call totals, filters, provider/model groups, recent calls | Settings > Usage | Existing |
| Unified findings | Static/Dynamic filters, severity/status filters, details, accept/dismiss/mark fixed | Project > Findings | Existing |
| Combined report | Project-level Markdown generation and preview/export path | Project > Reports | Existing, reliability verification required |
| Background review visibility | Collapsed, expanded, complete, connection-lost review toast | Global task center/toast | Existing for Static reviews |
| Local-first persistence | Projects, sessions, findings, evidence, settings, requirements, and usage persisted locally | Product-wide trust message; no separate screen | Existing |

### 3.2 Centinel Static

| Capability | Current implementation | Redesign destination | State |
|---|---|---|---|
| Source intake | Upload multiple supported files with type detection and content hashing | Static testing > Sources | Existing |
| Repository import | Choose repository folder, import file tree, delete imported source group | Static testing > Sources | Existing |
| Automatic repository index | Starts after repository import and exposes indexing state | Static testing > Sources | Existing, mostly background |
| Source organization | Document/repository grouping, nested repository tree, expansion | Static testing > Sources | Existing |
| Source removal | Delete one source or an imported repository group | Static testing > Sources | Existing |
| Requirements | Create, view, edit, delete, category, priority | Static testing > Requirements | Existing |
| Requirement mapping | Link requirement to indexed code/source with coverage state and confidence | Static testing > Requirements | Existing |
| Review setup | Name and plain-language review instructions | Static testing > Reviews > New review | Existing |
| Git diff scope | Optional base/head refs and changed-file review | New review > Advanced options | Existing |
| Review execution | AI-assisted review plus rule-based source analysis | Review detail | Existing |
| Review stages | Understand context, code review, requirement validation, summarize | Review progress | Existing |
| Active review control | Queued/running progress, latest activity, cancel, background toast | Review detail and global task center | Existing |
| Review findings | Severity groups, title, file/line location, evidence, recommendation, confidence | Review detail and shared Findings | Existing |
| Finding triage | Accept, dismiss, mark fixed | Findings | Existing |
| Session decision | Approve, request changes, comment; append-only history | Review detail | Existing |
| Suggested tests | Auto-generated module groups, rollups, rationale/location, accept/reject, regenerate | Static testing > Suggested tests | Existing |
| Re-review | Create child review from a completed review and carry open findings | Review detail | Existing |
| Review comparison | Fixed, dismissed, still open, and new buckets | Review detail > Compare | Existing |
| Static session report | Generate a Markdown report for one review | Reports / review detail | Existing, reliability verification required |
| Context retrieval | Repository search/context APIs used to ground review work | Advanced/internal; expose only when a user task needs it | Existing API/internal |
| Standalone static analysis | Trigger and retrieve deterministic rule findings via API | Integrated into review results; no new primary screen | Existing API/internal |

### 3.3 Centinel Dynamic

| Capability | Current implementation | Redesign destination | State |
|---|---|---|---|
| Test setup | Website address, natural-language goal, User journey/Smoke type, max steps | Dynamic testing > New test | Existing |
| Browser execution | Headed Chromium driven by Playwright | Test run detail | Existing |
| Adaptive planning | DOM/accessibility context first with screenshot/vision fallback | Test run activity; technical method stays secondary | Existing/internal |
| Supported actions | Click, type, key press, scroll, wait, navigate, assert visible, pass/fail finish | Activity trace | Existing |
| Safety limits | Step cap, runtime cap, retries, cancellation, categorized failure | Advanced setup and run outcome | Existing |
| Session management | List, open, poll live status, cancel active run | Dynamic testing > Test runs | Existing |
| Result summary | Status, target, goal, summary, failure reason | Test run detail | Existing |
| Evidence capture | Screenshot, action trace, AI request/response, console, debug, session summary | Dynamic testing > Evidence | Existing |
| Evidence browser | Session selection, type filters/counts, grid/list, screenshot viewer | Dynamic testing > Evidence | Existing |
| Dynamic report | Generate Markdown, preview, export, Copy path | Reports / test run detail | Existing |
| Dynamic findings | Stored in the unified project finding model where generated | Project > Findings | Existing data path |

### 3.4 Partial, placeholder, or contradictory surfaces

These items must not be presented as complete features during the redesign.

| Item | Evidence | Required treatment |
|---|---|---|
| Google Drive source | Current action ends with “coming soon” | Remove from the primary source picker or label as unavailable; do not style as an active integration |
| Suggested-test handoff to Dynamic | Accepted item says it is ready for the Dynamic runner, but no direct handoff is implemented | Use “Accepted” only; add handoff in a separate product task |
| Home readiness | Some Static/report readiness values are hard-coded rather than derived | Replace with real queries or remove the indicators |
| Decorative telemetry | Radar, grid, scan, and “online” decoration imply live data | Remove; retain only real health and work state |
| Quality dashboard claim | Progress document names a manager dashboard, but current `CommandUI` is a primitive set rather than a complete manager workflow | Treat as planned, not navigation-ready |
| Dynamic step limit | UI permits 1–50 while the sidecar clamps to 25 | Align the UI and API contract before redesign completion |
| Global Evidence navigation | Evidence is meaningful only in a selected project, while the shell treats it as global | Move into project navigation |
| Legacy browser dialogs | Project/source/requirement deletion, re-review, and report export used browser prompts, confirms, or alerts | Resolved in the current draft with the shared accessible Dialog and inline status feedback |
| Finding row interaction | A clickable header container is used without a dedicated disclosure control | Add a semantic disclosure button and keyboard behavior |
| Report reliability | Existing progress notes record report-export test failures | Fix or explicitly quarantine before calling Reports complete |
| Frontend coverage | Interaction coverage is sparse beyond Settings and a few components | Add workflow and primitive tests during each phase |

## 4. Current UX and implementation debt

### User-facing debt

- The command-center metaphor makes routine office QA feel more technical and risky than it is.
- Static and Dynamic work are stacked in one large project screen rather than presented as stable, task-based destinations.
- Technical data and AI activity often compete with the outcome and next action.
- Project-specific Evidence appears in global navigation.
- Status naming and styling vary by feature and sometimes expose backend vocabulary.
- Remaining low-frequency actions must use the shared dialogs and feedback patterns; browser prompts, confirms, and alerts have been removed from production frontend paths.
- Empty, failure, cancelled, disconnected, and partial states have not been audited as one product system.

### Frontend-system debt

- Styling is split across approximately 86 KB of `App.css`, 59 KB of `command.css`, and a global stylesheet with overlapping tokens.
- Command-center overrides duplicate visual rules already present in `App.css`.
- The styles contain many gradients/glows, several one-off shadow recipes, and radii ranging from 0 to 20 px.
- Three `transition: all` declarations remain.
- UI text mixes 9–10 px mono metadata with several sans and mono declarations, reducing readability and consistency.
- Navigation is an in-memory screen union, so detail state and back behavior are not reliably restorable.
- Shared primitives cover only part of the product; similar panels, forms, statuses, and empty states are still screen-specific.

## 5. Target screen model

### Home

- Use a time-aware greeting with one short orientation line. Add a person's name only when a real authenticated profile supplies it.
- First row: **Action required** on the left and **Quick actions** on the right at an 8:4 desktop grid ratio.
- Action required shows at most four projects requiring a human action: review required, changes required, blocked/failed test, or setup required. Order by urgency, then update time.
- An action row contains a compact semantic status icon, project identity, module, state, last update, and one short action (**Review**, **Resolve**, **Inspect**, or **Set up**). Do not lead with counts or repeat a decorative illustration inside every row.
- Quick actions open the Static testing and Dynamic testing initialization forms directly. A third contextual action offers initial setup when required; otherwise it opens the latest project or project creation flow.
- Second and final row: **Recent activity**, showing Static or Dynamic activity for a project on a specific timeline.
- Hover, focus, or selection exposes metrics directly below an activity: Static shows active reviews and indexed sources; Dynamic shows active tests and latest run status.
- Show only persisted application data. Omit unavailable values or use a concise empty state.
- Use consistent outline icons on tinted semantic tiles for repeated actions and statuses. The review illustration may appear once as a large transparent page watermark; do not repeat it per action row. Do not use evidence screenshots, charts, generic AI artwork, radar, scanning copy, synthetic readiness, or decorative telemetry.

### Projects

- Search/sort may be added only if project volume justifies it; do not add fake complexity.
- List name, description, local folder, last activity, and real work status.
- Create project uses a focused form; delete uses an accessible named confirmation.

### Project overview

- Explain the two module choices in task language.
- Show setup progress derived from sources/provider readiness.
- Show recent review and test-run results, unresolved finding count, and latest report using real data.
- Offer one recommended next action based on actual project state.

### Static testing

- Use a stable subsection switcher: Sources, Requirements, Reviews, Suggested tests.
- Keep review setup simple; place Git scope under Advanced options.
- Make review progress, result, decision, and comparison one coherent detail page.
- Use the shared Findings component instead of a second visual language.

### Dynamic testing

- Use a stable subsection switcher: Test runs, Evidence.
- Explain test type selection and validate the address before starting.
- Show outcome first, followed by screenshots and action trace.
- Collapse AI traffic, console, and debug evidence under Technical details.

### Findings

- Use a filter toolbar, active-filter summary, exact counts, and a scan-friendly list/table.
- Keep source module, severity, status, and location visible without expansion.
- Make actions predictable and reversible where the data contract allows.

### Reports

- Separate Static review reports, Dynamic test reports, and Combined project report.
- Show inclusion scope and generated time.
- Preview content first; Export and Copy path are secondary actions.

### Settings

- Split into AI providers and Usage.
- Show provider presets before custom configuration.
- Put API format, base URL, and model overrides in Advanced settings.
- Preserve masked secret handling and explicit connection tests.

## 6. Component architecture

Create or consolidate these primitives before migrating screens:

```text
ui/
├── Button
├── IconButton
├── LinkButton
├── Field, Input, Textarea, Select, Checkbox
├── FormErrorSummary
├── StatusBadge
├── Banner, InlineMessage, Toast
├── Dialog, Drawer, Popover, Tooltip
├── Tabs, Breadcrumbs, ProjectNav
├── PageHeader, SectionHeader
├── Panel, Toolbar, Divider
├── DataList, DataTable, Disclosure
├── EmptyState, Skeleton, Progress
└── VisuallyHidden, SkipLink
```

Domain components then compose primitives:

- `SourceList`, `RequirementList`, `ReviewList`, `ReviewProgress`
- `FindingList`, `FindingDetail`, `ReviewDecision`
- `SuggestedTestList`, `ReviewComparison`
- `TestRunList`, `TestRunProgress`, `EvidenceGallery`, `EvidenceViewer`
- `ReportPreview`, `ProviderSettings`, `UsageSummary`

One semantic status mapper converts backend states into the user-facing status vocabulary. One formatting layer owns dates, counts, durations, token values, refs, and paths.

## 7. Implementation phases

The phases are ordered to avoid recreating screen-specific styles during migration. Static and Dynamic screen work can proceed independently after the foundation and shell are stable.

### Phase 0 — Baseline and behavior lock

Deliverables:

- Capture current screenshots at 1440 x 900, 1200 x 900, and narrow width for every screen and material state.
- Record the current frontend test/build baseline and known failures.
- Add a screen/state matrix covering empty, loading, in progress, success, failure, cancelled, disconnected, and partial states.
- Confirm which report-export failures are current rather than relying on the dated progress note.
- Create a small fixture project using real local fixture data for deterministic visual QA.

Exit criteria:

- Behavior baseline is documented.
- Known failures are separated from redesign regressions.
- No production UI changes yet.

### Phase 1 — Tokens and accessible primitives

Deliverables:

- Add the semantic colors, type, spacing, size, radius, elevation, motion, and z-index tokens from `DESIGN.md`.
- Package Plus Jakarta Sans and JetBrains Mono locally or use an approved existing local dependency.
- Build the shared primitives listed in Section 6.
- Replace the current modal with an accessible Dialog: semantics, focus trap, initial focus, Escape, focus restore, safe dismissal.
- Centralize status mapping and feedback patterns.
- Add component tests for keyboard behavior, accessible names, error association, focus, disabled/loading states, and reduced motion.

Exit criteria:

- Primitive showcase/test route covers all documented states.
- No primitive uses raw colors, unapproved radius/shadow, `transition: all`, or a second icon library.
- Automated accessibility checks pass for the primitive set.

### Phase 2 — Shell, navigation, and Home

Deliverables:

- Replace global navigation with Home, Projects, Static testing, Dynamic testing, and Settings. Keep Integrations within Settings.
- Add breadcrumb plus project navigation: Overview, Static testing, Dynamic testing, Findings, Reports.
- Introduce stable/restorable route state for project sections and details.
- Redesign Home using only real persisted/health data.
- Implement the confirmed 8:4 Highlights/Quick actions row and the Recent activity interaction defined in Section 5.
- Route Static and Dynamic quick actions directly to their initialization forms.
- Add the purpose-built SVG illustration set without adding raster dependencies or simulated operational data.
- Remove radar, grid, scan line, decorative gradients, glows, and synthetic telemetry.
- Preserve the background Static-review toast through the new feedback primitives.

Exit criteria:

- Back/forward and return-to-list behavior preserve project context and filters.
- Shell is keyboard operable and includes a skip link.
- Home never displays a hard-coded readiness or operational value.
- Action required contains only actionable project states and no approval-count lead metric.
- Recent activity metrics are reachable by pointer and keyboard, not hover alone.
- Shell passes the three required viewport checks.

### Phase 3 — Project, Sources, and Static testing

Deliverables:

- Create the project Overview and recommended-next-action logic from real state.
- Migrate Sources and Requirements into Static testing subsections.
- Hide or clearly disable the Google Drive placeholder.
- Redesign review setup with Advanced options for Git scope.
- Migrate review progress, completion, findings, decisions/history, suggested tests, re-review, and comparison.
- Rename internal-facing copy to the terminology contract.
- Align finding status behavior and ensure informational findings are counted.
- Do not promise direct Dynamic handoff from accepted suggested tests.

Exit criteria:

- A user can complete the full Static path using keyboard only.
- Review state remains visible after navigating away.
- Error/cancel/retry paths preserve user input and explain recovery.
- Targeted Static frontend tests and the frontend build pass.

### Phase 4 — Dynamic testing and Evidence

Deliverables:

- Redesign test setup around website address and test goal.
- Add plain-language descriptions for User journey and Smoke test.
- Move max steps to Advanced options and align its maximum with the sidecar.
- Redesign live run progress and completion around current action, outcome, and next step.
- Make screenshots and action traces primary evidence.
- Put AI requests/responses, console, debug, and session bundles under Technical details.
- Add accessible screenshot viewer navigation, loading errors, and focus management.
- Preserve cancel and report export behavior.

Exit criteria:

- A non-technical user can configure, run, cancel, and interpret a test without reading AI/model details.
- All evidence types remain discoverable.
- Viewer and filter workflows work with keyboard and narrow windows.
- Targeted Dynamic frontend tests and the frontend build pass.

### Phase 5 — Shared Findings, Reports, and Settings

Deliverables:

- Consolidate Static and Dynamic findings into the shared list/detail components.
- Add active-filter summary and consistent status actions.
- Redesign Reports with clear inclusion scope, preview, export, and Copy path.
- Resolve or explicitly document report-export failures before acceptance.
- Redesign Settings with provider presets first and custom fields progressively disclosed.
- Keep token usage factual and use tabular numbers.

Exit criteria:

- The same finding renders and behaves consistently from review detail and shared Findings.
- Reports identify their included project/runs and failure states.
- Secrets never appear in screen output, logs, screenshots, or tests.
- Relevant tests and build pass.

### Phase 6 — Hardening and legacy removal

Deliverables:

- Audit every screen against the `DESIGN.md` visual checklist and state matrix.
- Run keyboard, screen-reader semantics, contrast, zoom, and reduced-motion checks.
- Verify 1440 x 900, 1200 x 900, and narrow viewport for every migrated screen.
- Remove migrated command-center and legacy CSS; delete unused selectors and duplicate tokens.
- Remove all `transition: all`, ornamental gradient/glow, arbitrary radii/shadows, and competing component variants.
- Add regression tests for primary Static, Dynamic, Findings, Reports, project deletion, provider configuration, and disconnected sidecar workflows.
- Update product screenshots and stale UI documentation.

Exit criteria:

- `pnpm --filter centinel test` passes.
- `pnpm --filter centinel build` passes.
- Relevant sidecar tests pass, especially when a UI contract changed.
- No visual regressions at the required viewports.
- No unused legacy design layer remains.

## 8. Suggested implementation slices

Keep pull requests or commits small enough to review and revert:

1. Tokens and fonts.
2. Buttons, fields, status, and feedback.
3. Dialog, disclosure, tabs, breadcrumbs, and data list/table.
4. Shell and route state.
5. Home dashboard: Action required, quick-action routing, Recent activity, and SVG assets.
6. Projects.
7. Project Overview and Sources.
8. Requirements.
9. Static review setup/progress.
10. Static results, decisions, suggested tests, and comparison.
11. Dynamic setup/run detail.
12. Evidence.
13. Findings and Reports.
14. Settings and Usage.
15. Accessibility/responsive hardening and legacy CSS removal.

Each slice should include its tests and should not leave the same screen half-migrated between two visual systems.

## 9. Verification matrix

For every migrated workflow, verify:

| Area | Required checks |
|---|---|
| Behavior | Existing action/result contract preserved; no API or persistence regression |
| States | Empty, loading, queued/in progress, partial, success, failure, cancelled, disconnected |
| Input | Validation, limits, preserved values, error association, safe repeat submission |
| Keyboard | Logical tab order, visible focus, activation, disclosure, dialog trap/restore, Escape |
| Accessibility | Landmarks, headings, labels, names, status announcements, contrast, 200% zoom |
| Responsive | 1440 x 900, 1200 x 900, narrow viewport; no lost actions |
| Visual system | Token-only color/radius/shadow/motion, Lucide icons, no decorative telemetry or AI slop |
| Data trust | Real data only, provenance retained, secrets redacted, destructive scope explicit |
| Tests | Targeted frontend tests, complete frontend suite, build; sidecar tests when contracts change |

## 10. Definition of done

The redesign is complete when:

- a first-time office user can identify Static versus Dynamic testing and complete either primary flow without technical assistance;
- every implemented feature in Section 3 has a deliberate destination or an explicit internal/partial classification;
- all screens use the shared component and status contracts;
- technical detail is available without dominating the default experience;
- no fake data, command-center decoration, competing theme layer, or placeholder integration is presented as operational;
- accessibility, responsive, build, and test requirements in `DESIGN.md` pass;
- implementation documentation and screenshots reflect the shipped interface.

## 11. Living implementation and validation checklist

This checklist is intentionally maintained alongside the code. Mark an item only after the implementation and the associated state checks are complete; a visual pass alone does not make a workflow complete.

### Foundation and shell

- [x] `DESIGN.md` remains the visual and terminology authority.
- [x] Approved light workspace direction recorded: Apple-like material clarity plus AWS-like task predictability/density.
- [x] Shared `workspace.css` token/component layer is loaded after legacy layers.
- [x] Non-dashboard routes use the same light sidebar, main canvas, typography, controls, status badges, and focus treatment as Home.
- [x] Page-load `animate-fade-in`/`stagger-children` decoration is disabled; only meaningful interaction transitions remain.
- [x] Shared Modal now provides dialog semantics, initial focus, focus trapping, Escape, and focus restoration; source and screenshot viewers use it.
- [x] Browser prompts/confirms/alerts are removed; named deletion confirmations, re-review setup, and export feedback use accessible product UI.
- [x] Expandable source, requirement, review-session, screenshot, and finding controls use semantic buttons rather than clickable containers.
- [x] Evidence filters expose their selected state with `aria-pressed`, and changing sessions clears stale evidence while the next set loads.
- [x] Global background-review notification uses the same light material surface, touch targets, and status palette as the workspace.
- [x] Broad `transition: all` declarations are removed from the frontend styles; interaction motion is limited to the properties that visibly change.
- [ ] Remove migrated command-center/legacy selectors once all screens use workspace primitives.

### Screen migration status

| Screen / surface | Light migration | Terminology pass | Responsive pass | Behavior/tests |
|---|---:|---:|---:|---:|
| Home | Complete | Complete | Complete | Complete |
| Projects | Complete | Complete | Complete | Named deletion dialog + visual pass |
| Project overview | Complete | Complete | Complete | Existing behavior + 375/720/1200/1440 review |
| Sources | Complete | Complete | Complete | Semantic repository controls + named deletion dialog |
| Requirements | Complete | Complete | Complete | Semantic disclosures + named deletion dialog |
| Static review setup/progress/results | Complete | Complete | In progress | Setup and session list responsive; expanded result-state matrix remains |
| Dynamic test setup/run | Complete | Complete | In progress | Setup responsive and direct routing verified; populated run states and retry feedback covered in component tests |
| Evidence browser/viewer | Complete | Complete | In progress | Empty/narrow state, populated filters, keyboard screenshot viewer, missing-image recovery, and retry states covered; visual fixture remains |
| Findings | Complete | Complete | Complete | Dense desktop and 375 px card-layout passes + existing tests |
| Reports/export preview | Complete | Complete | In progress | Dedicated Reports destination, inline export feedback, and real project export verified; broader state coverage remains |
| Settings/providers | Complete | Complete | Complete | Desktop and 375 px visual pass + existing Settings tests |
| Settings/Usage | Complete | Complete | Complete | Desktop and 375 px visual pass + existing Settings tests |

### Required validation before calling the migration complete

- [x] `pnpm --filter centinel test` passes: 11 files, 42 tests, including safe initial focus in destructive confirmations, populated Dynamic/Evidence states, keyboard screenshot navigation, and retry feedback (2026-09-04).
- [x] `pnpm --filter centinel exec vite build` passes and emits the production frontend bundle (2026-09-04).
- [x] `pnpm --filter centinel build` passes after aligning the review-stage status contract and correcting stale test fixtures (2026-09-04).
- [ ] Inspect every route at 1440 x 900, 1200 x 900, and a narrow viewport (375–720 px).
- [ ] Walk keyboard order, visible focus, disclosure controls, dialogs, status announcements, and Escape/back recovery.
- [ ] Check empty, loading, queued/in progress, success, failure, cancelled, disconnected, and partial states where the route supports them.
- [x] Reflow-equivalent 375 px and 720 px checks pass for Home, Projects, project workspace, Static/Dynamic setup, Requirements, Findings, Evidence empty state, Settings, and dialogs; desktop browser zoom emulation remains unavailable in the current preview harness.
- [x] Reduced-motion rules and 44 px narrow targets are present in the shared workspace layer; animation is not required to understand any audited state.
- [x] A real project report export completed through the running sidecar and returned both a Markdown payload and a 274,317-byte report file headed `# Centinel QA Report` (2026-09-04).
- [ ] Sidecar baseline is not green: 231 passed, 15 failed, and 8 skipped. Current failures cover missing optional modules, graph/index expectations, absent fixture database tables, and stale report-export test contracts; none were introduced by the UI migration.
- [ ] Confirm no fake metrics, gradients, glows, AI-centric terminology, raster evidence used as decoration, or competing icon systems remain.
- [ ] Update this table and the verification matrix with links to the final screenshots and test output.

### 2026-09-04 review checkpoint

- Visually verified Home and Projects at 1440 × 900, 1200 × 900, and 720 × 900.
- Visually verified Project overview, Requirements, Dynamic test setup, Evidence, and Settings at the desktop review viewport.
- Removed the old dark Project-row skin, browser-default project tabs, and the unavailable Drive source action.
- Dynamic setup now explains test types and keeps the step limit under Advanced options, aligned to the sidecar maximum of 25.
- Dynamic run and Evidence screens now show recoverable load failures, clear empty-state next actions, and no stale evidence while a different session loads.
- Added one shared screenshot thumbnail/viewer contract: image-edge outlines, explicit missing-file state, Retry, Previous/Next controls, a live position counter, and ArrowLeft/ArrowRight navigation.
- Added populated Dynamic/Evidence component coverage for outcome-first ordering, technical disclosure, filter state, screenshot navigation, missing-image recovery, empty next actions, and load-error Retry paths.
- Populated Findings now uses labeled filters, semantic disclosure buttons, and 50-item progressive batches instead of rendering hundreds of rows at once.
- Replaced all browser-native prompt/confirm/alert flows with named dialogs or inline status feedback; confirmation focus defaults to Cancel and restores the invoking control.
- Added a dedicated Reports section so project navigation leads to a visible destination instead of immediately exporting a file.
- Direct Static/Dynamic navigation now opens and scrolls to the requested initialization form.
- Repaired 375 px layouts for action-required rows, recent-activity cards/metrics, project session lists, Findings rows, and Static review setup; document width remains bounded to the viewport.
- Static review setup now uses plain-language labels and keeps Git refs under Advanced options; its 375 px dialog no longer overflows.
- Dynamic run detail keeps screenshots and action traces primary and moves model traffic, console output, debug logs, and session bundles under Technical details. Evidence defaults to an outcome-oriented Overview with technical filters disclosed separately.
- Verified the production report-export path against a real project; broad sidecar test failures remain an existing baseline and should be repaired as a separate reliability slice.
- Remaining acceptance work: populated Dynamic/Evidence visual screenshots against a real run, expanded Static result-state matrix, browser-native 200% zoom, broader report/export state coverage, and legacy CSS removal.
