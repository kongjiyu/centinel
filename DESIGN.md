# Centinel Design System

> Status: authoritative for all user-facing Centinel interfaces
>
> Direction: calm, trustworthy office QA workspace
>
> Primary audience: office teams and non-technical reviewers, with progressive disclosure for QA and engineering detail
>
> Last revised: 2026-09-08

This document defines the product-wide UI and UX contract. It supersedes the previous dark mission-control direction. New work must follow it; existing screens should migrate toward it without changing product behavior.

## Approved Review UI amendment (September 2026)

The latest user-approved requirements supersede conflicting terminology and navigation below. The visual system and accessibility rules remain authoritative. Implementation is frontend-only; unsupported backend capabilities must be represented honestly.

- Rename the user-facing Static testing module to **Review**. Global navigation: Home, Projects, Review, Dynamic Testing, Settings.
- Project tabs: Overview, Source, Findings, Collaborations, Settings. Review and Dynamic Testing are entry actions on Overview, not project tabs. Recent activity supports search, type, and date/time filters.
- Home retains Highlights and Recommendations (one recommendation at a time); its lower section is Recent projects with available last-activity context.
- Review entry starts with Review name, then project selection and Create project access, followed by objective/instructions and optional branch/PR scope. Active sources are validated at submission without rendering an available-source count or source list. No review-type selection. Preserve existing transport identifiers while service contracts are unchanged.
- Progress presents stage/activity logs only. Review activity results contain Overview, Findings, Traceability, Risk Assessment, History, with activity-level Approve/Reject in the header. Rejection requires feedback with optional finding mentions; human feedback appears separately from system history.
- Desired lifecycle: In Progress, Pending to Review, Completed, Blocked, Cancelled, Failed. Never assert unsupported state transitions. Approval completes a review but does not resolve its findings.
- Source currency confirmation is distinct from version approval: incoming versions do not need approval. Default currency interval is 90 days since last confirmation; deprecated documents are excluded from new reviews. Durable governance, roles, and iteration behavior require service support and are not simulated in production UI.
- Implementation plan: [docs/REVIEW_UI_IMPLEMENTATION_PLAN.md](docs/REVIEW_UI_IMPLEMENTATION_PLAN.md).

### Dashboard, Projects, and Review entry refinement (September 2026)

The approved refinement keeps the interface neutral-first: white and light-grey surfaces and black/neutral text carry most of the hierarchy. Centinel green is reserved for primary actions, active selection, focus, success, and restrained hover feedback; semantic warning and danger colors remain limited to the state they communicate.

- Dashboard **Action required** items use one semantic container with a quiet light-grey header. The header contains the icon, project/module/time context, and a compact action control; the body contains only the required-action title and concise reason.
- **Recommendations** show one recommendation at a time in one white, non-nested surface. Each recommendation identifies the context and next action; no step-by-step workflow or rationale sub-card is rendered.
- **Recent projects** and the Projects directory reuse one Project / Latest activity / Current state / Actions table. The dashboard presentation is intentionally simpler: it has no activity filter, visually hides the table headers while retaining them for assistive technology, removes the action column and dashboard row dividers, keeps missing activity aligned, and preserves the dashboard's four-row limit. The full Projects directory keeps visible headers, filters, pagination, and explicit row actions.
- Projects uses a compact toolbar attached to the table, with search and Current state/activity filters. The directory keeps five-row pagination, directory-only local pin controls, and the project-only New project flow; project creation opens a labelled, focus-managed modal.
- All user-facing select fields use the shared React-library-backed `Select` primitive. It provides an accessible combobox, keyboard navigation, Escape handling, visible focus, disabled state, portal layering, and narrow-viewport sizing. Native `<select>` elements are not used in `centinel/src`.

### Dashboard and desktop shell refinement (September 2026)

The latest dashboard and shell requirements supersede the earlier Home table/filter contract above. The visual system, neutral-first tokens, Lucide-only icon rule, WCAG 2.1 AA target, and responsive breakpoints remain authoritative.

- Home's Recent projects section has no activity-type filter. **View more** is aligned to the far right of the section header and opens the unfiltered Projects directory.
- Dashboard Recent projects keeps Project, Latest activity, and Current state data, but does not show a visible header row, trailing action buttons, row dividers, or right-arrow/chevron glyphs. Rows remain hoverable, focusable, and operable with Enter or Space to open the project overview. Current state is the rightmost, right-aligned column. These presentation rules do not change the Projects directory.
- The dashboard right rail starts with a bare Quick actions grid above Recommendations. It has no enclosing panel or visible heading: Create project spans the grid's full 12-column row; Review and Dynamic Testing each span six columns at desktop widths and stack below 720 px. Actions use visible labels, Lucide icons, and no right-arrow glyphs.
- Dashboard content controls do not render `>`/right-arrow affordances. Breadcrumb separators are the intentional exception and are decorative to assistive technology.
- The application shell renders a light custom desktop title bar with a restrained 14–16 px Centinel mark, functional File/Edit/View/Help menus, and working minimize, maximize/restore, and close controls. It is followed by one white workspace split into a navigation-panel container and a page-content container. The navigation panel has its own header with the sidebar collapse/expand control and an independently scrolling body; the page-content container has a rounded top-left corner, its own breadcrumb header, and an independently scrolling body.
- The sidebar has no product brand/logo block or service-readiness footer. Its labelled groups are Dashboard (Home), Activities (Review and Dynamic Testing), Settings (Settings), and a lightweight **Pinned** disclosure for locally persisted project shortcuts.
- **Pinned** is a local desktop preference, not shared project state. Pin/unpin controls appear in the full Projects directory; stale project IDs are removed and the empty state is the subdued text **No pinned projects** without an additional navigation action.
- Settings keeps four visible content headings: **App Version**, **Model Provider**, **Usage**, and **Connections**. Provider credentials remain one cohesive API-key flow; usage exposes only real `getAiUsage` values: a processed-token total, total requests, Input, Output, Cache creation, and Cache reads. App Version reads the running application version, checks the published GitHub release, and offers **Open update** only when a newer release exists. It never claims an in-app installer while the Tauri updater is inactive and unsigned. Connection values are shown only when the running application can retrieve them; unavailable capabilities are labelled explicitly.
- The approved refinement removes the Home greeting block, keeps the dashboard right rail deterministic with a fixed desktop recommendation height, removes the visible Navigation label and shell divider lines, and uses a semantic page-width Review form rather than a nested setup card. These are presentation refinements only; existing navigation and service contracts remain unchanged.

## 1. Product experience

Centinel helps a team answer two plain questions:

1. **Are our files and requirements consistent?** Centinel Static reviews work products without running the application.
2. **Does the live website behave as expected?** Centinel Dynamic executes a real browser workflow and records evidence.

The interface should feel like dependable office software: understandable on first use, calm during long-running work, and rigorous when a user needs evidence. It is a workspace, not a developer console, marketing page, or science-fiction command center.

### Experience principles

1. **Start with the task.** Use user language before implementation language.
2. **Show the summary, then the proof.** Put outcome and next action first; expose logs, model traffic, file paths, and traces on demand.
3. **Make system state visible.** Every long-running action has a clear status, current step, elapsed context, cancel action, and completion result.
4. **Keep the user in control.** AI output is proposed evidence, never an unexplained final authority. Decisions and destructive actions remain human actions.
5. **Use real data.** Never invent metrics, readiness, telemetry, activity, or success.
6. **Prefer recognition over recall.** Preserve context, use familiar labels, provide examples, and show available actions near the object they affect.
7. **Be consistent before being novel.** The same concept must use the same component, label, icon, status, and interaction everywhere.

## 2. User mental model and terminology

Use these terms consistently in UI copy, navigation, documentation, and accessibility labels.

| Product concept | Preferred label | Supporting explanation |
|---|---|---|
| Centinel Static | Review | Review files without running the application |
| Centinel Dynamic | Dynamic testing | Test a live website in a real browser |
| Artifact | Source | A document, requirement, coding standard, or source-code file |
| Static session | Review | One saved static-testing run |
| Dynamic session | Test run | One saved browser-testing run |
| Mission goal | Test goal | What the browser should verify |
| Finding | Finding | An issue or observation that needs review |
| Evidence | Evidence | Screenshots, actions, logs, and supporting details |
| Review decision | Review decision | Approve, request changes, or comment |
| Test item | Suggested test | A test generated from review findings |

Avoid labels such as “QA node,” “analysis channel,” “observation channel,” “traceability registry,” “autonomous validation,” and “agent thought.” If internal reasoning must be shown for audit purposes, label it **activity details** and keep it collapsed by default.

Status labels use sentence case and plain language:

- Not started
- Queued
- In progress
- Completed
- Needs attention
- Failed
- Cancelled

Backend-specific statuses may remain in data contracts, but presentation components map them to this vocabulary.

## 3. Information architecture

### Global navigation

The persistent application shell provides these grouped destinations:

- **Dashboard / Home** — required actions, quick starts, and recent activity.
- **Activities / Review** — open the Review start flow or its most relevant project context.
- **Activities / Dynamic testing** — open the Dynamic testing start flow or its most relevant project context.
- **Settings / Settings** — versions, model-provider credentials and usage, and connection boundaries.
- **Pinned** — expand or collapse locally pinned project shortcuts. The exhaustive Projects directory remains reachable from Home actions and breadcrumbs.

Integrations belong inside Settings. Authentication, authorization, storage, verification frameworks, and integration services are implementation details and do not appear as navigation labels.

Do not place project-specific Evidence or Reports in global navigation. When a project is selected, show a breadcrumb and project navigation.

### Project navigation

Each project workspace has five stable destinations:

1. **Overview** — project summary, setup progress, recent runs, and the next recommended action.
2. **Source** — active project sources and source setup.
3. **Findings** — unified Review and Dynamic findings with filters and review actions.
4. **Collaborations** — project review context and collaboration history.
5. **Settings** — project-specific configuration.

Review and Dynamic Testing are entry actions on Overview, not project tabs. Use tabs or a compact secondary navigation bar for the five stable destinations above. Preserve the selected project and selected subsection when the user returns from a detail view.

### Screen hierarchy

```text
Centinel
├── Home
├── Projects
│   └── Project
│       ├── Overview
│       ├── Source
│       ├── Findings
│       ├── Collaborations
│       └── Settings
└── Settings
```

Screens must have a stable route or equivalent restorable state. Back actions return to the previous meaningful list state, including filters and expanded items.

## 4. Core workflows

### Project setup

1. Create a project and choose its local folder.
2. Add sources by uploading files or importing a repository.
3. Show whether Text AI and Vision AI are ready only when that state is retrieved from the application.
4. Offer one recommended next action: start a static review or create a dynamic test.

Do not block project creation on optional provider configuration. Explain the dependency when the user starts a task that requires it.

### Static testing

```text
Add sources -> Review setup -> Review in progress -> Findings
            -> Review decision -> Suggested tests -> Re-review / report
```

- Default to a full review.
- Put Git base/head scope under **Advanced options**.
- During a review, show the four user-meaningful stages and the latest activity summary. Keep detailed activity collapsed.
- On completion, show severity summary, primary findings, and the next decision.
- Keep per-finding status separate from the session-level review decision.
- A re-review must explain its relationship to the previous review and show what is fixed, dismissed, still open, and new.

### Dynamic testing

```text
Test setup -> Browser run in progress -> Outcome -> Evidence -> Report
```

- Ask for a website address and a plain-language test goal first.
- Explain **User journey** and **Smoke test** at the selection point.
- Put step limits and future expert controls under **Advanced options**.
- Show the current step and latest action without streaming raw model traffic by default.
- On completion, lead with the result and failure reason, then screenshots and action trace.
- Raw AI requests, AI responses, console output, and debug data are advanced evidence.

### Findings and reports

- Findings use one shared list pattern across modules.
- Default sorting is severity, then recency.
- Filters are visible, named, keyboard accessible, and reflected in an active-filter summary.
- Reports must say which runs and sources are included.
- File export and Copy path are secondary actions; report content and outcome are primary.

## 5. Norman and Shneiderman interaction rules

Donald Norman’s interaction principles and Shneiderman’s eight golden rules are applied as concrete product requirements.

| Rule | Centinel requirement |
|---|---|
| Visibility and informative feedback | Show connection, queue, progress, success, failure, and cancellation close to the action that caused them. |
| Match and natural mapping | Place actions beside their object: review decisions under review results; finding actions inside the finding; evidence filters beside evidence. |
| Signifiers and affordances | Interactive rows have a visible disclosure control. Icon-only buttons always have labels or tooltips and accessible names. |
| Constraints and error prevention | Disable impossible actions with an explanation; validate URLs, refs, required fields, limits, and provider readiness before starting work. |
| Conceptual model | Static testing always means file review; Dynamic testing always means browser execution. Do not mix their setup forms or status models. |
| Consistency | Reuse one component and vocabulary for buttons, fields, badges, dialogs, progress, empty states, and errors. |
| Closure | Multi-step work ends with a clear result summary and a recommended next action. |
| Reversal and recovery | Cancel non-destructive work; confirm destructive work; preserve inputs after failure; provide Retry where retry is safe. |
| User control | Do not auto-approve findings, auto-delete data, or hide material AI uncertainty. |
| Reduce memory load | Preserve form context, explain options in place, remember list filters, and use visible breadcrumbs. |
| Universal usability | Support keyboard-only use, zoom, reduced motion, plain language, and both novice and expert detail levels. |
| Shortcuts for frequent users | Add shortcuts only after the visible workflow is complete; shortcuts never replace discoverable controls. |

## 6. Visual direction

### Style

The design language is **approachable enterprise minimalism**:

- light-first for office environments;
- muted sage surfaces and clear hierarchy;
- accessible forest green for primary interaction;
- restrained semantic color for state;
- evidence-oriented tables and lists rather than decorative dashboards;
- enough density for QA work without shrinking text or controls.

Centinel’s distinctiveness comes from disciplined evidence presentation, not visual effects.

### Explicit anti-patterns

Do not use:

- radar, scan lines, telemetry grids, crosshairs, or ornamental “system online” graphics;
- neon glows, glassmorphism, purple gradients, or gradient text;
- a marketing hero inside the application;
- bento-card layouts where a list, table, or workflow is clearer;
- a card around every small group of content or nested cards without hierarchy;
- oversized headings, excessive empty space, or tiny technical labels;
- fake statistics, fake activity, fake readiness, or generated operational prose;
- emoji as application icons;
- multiple icon libraries or inconsistent icon weights;
- page-load animation, decorative stagger, or motion on frequently repeated actions;
- AI-centric copy that obscures the user’s task.

## 7. Design tokens

Tokens are the only source of reusable visual values. Components must not introduce one-off colors, radii, shadows, or timing values without updating this document and the token layer.

### Color

The default theme is light. A dark theme may be added only after all semantic tokens have parity and both themes pass the same accessibility and visual tests.

```css
:root {
  --color-canvas: #f2f3f3;
  --color-surface: #ffffff;
  --color-surface-subtle: #f5f6f5;
  --color-surface-hover: #f8fbf7;
  --color-surface-selected: #edf4ee;

  --color-border: #d9ddda;
  --color-border-strong: #bcc3bf;

  --color-text: #171a18;
  --color-text-muted: #505651;
  --color-text-subtle: #6b716d;

  --color-primary: #28623c;
  --color-primary-hover: #1f4f30;
  --color-primary-subtle: #deeee0;

  --color-success: #047857;
  --color-success-subtle: #ecfdf5;
  --color-warning: #9a5b00;
  --color-warning-subtle: #fff7e6;
  --color-danger: #b42318;
  --color-danger-hover: #991b1b;
  --color-danger-subtle: #fff1f0;
  --color-info: #0f766e;
  --color-info-subtle: #e8f6f3;

  --color-focus: #2f6f44;
  --focus-ring: 0 0 0 3px rgba(47, 111, 68, 0.24);
}
```

Color rules:

- Forest green means action or selection, never general decoration.
- Teal-green distinguishes Dynamic testing where a module accent is useful.
- Green means successful or verified, never “currently running.”
- Amber means caution or needs attention.
- Red means failed, destructive, or invalid.
- Status always includes text or an icon; color is never the only signal.
- Every text/background pair must meet WCAG 2.1 AA contrast before release.

### Typography

```css
--font-ui: 'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', 'Segoe UI', sans-serif;
--font-technical: 'JetBrains Mono', 'Cascadia Mono', monospace;
```

Use Plus Jakarta Sans for the interface. Package or self-host it so the desktop app does not depend on a network request. Use the technical face only for code, file paths, refs, URLs, IDs, and log content.

| Role | Size / line height | Weight |
|---|---:|---:|
| Page title | 24 / 32 px | 650 |
| Section title | 18 / 26 px | 650 |
| Component title | 15 / 22 px | 600 |
| Body | 15 / 23 px | 400 |
| Dense table/list | 14 / 20 px | 400 |
| Supporting text | 13 / 19 px | 400 |
| Technical metadata | 12 / 18 px | 450 |

- Apply antialiasing to the application root.
- Use `text-wrap: balance` for short headings and `text-wrap: pretty` for body copy where supported.
- Use tabular numbers for counts, duration, tokens, percentages, and timestamps.
- Do not use all caps for general navigation, headings, or field labels.

### Spacing, size, and radius

Use a 4 px base rhythm: `4, 8, 12, 16, 20, 24, 32, 40, 48`.

- Standard desktop control height: 40 px.
- Compact table control height: 36 px, only in dense data regions.
- Narrow/touch control height: at least 44 px.
- Icon-only hit target: at least 40 x 40 px desktop and 44 x 44 px narrow.
- Content gutter: 32 px at 1440, 24 px at 1200, 16 px below 960.
- Maximum readable page width: 1440 px; reading columns: 720 px.

```css
--radius-control: 8px;
--radius-panel: 12px;
--radius-overlay: 12px;
--radius-pill: 999px;
```

Use concentric radii: an outer container radius equals the inner radius plus the visible padding between them. Do not mix arbitrary 2, 3, 4, 8, 10, and 20 px radii.

### Borders and elevation

- Borders communicate structure; shadows communicate elevation.
- Default panels use a 1 px border and no shadow.
- Home workspace panels may use the shared low-elevation layered shadow to separate prioritized work from the canvas. Nested lists and table dividers continue to use structural borders.
- Menus use `0 8px 24px rgba(23, 32, 51, 0.12)`.
- Dialogs use `0 20px 48px rgba(23, 32, 51, 0.18)`.
- Focus uses the focus ring token, not a glow.
- Do not add inner glows or colored drop shadows.

### Icons

- Use Lucide only.
- Use `currentColor` and a 1.5 px stroke for regular UI icons.
- Standard sizes: 16 px inline, 18 px controls, 20 px primary navigation, 24 px empty states.
- Use outline icons by default and filled state only to indicate a selected or saved state where supported.
- An icon does not replace a label for primary or unfamiliar actions.

## 8. Layout and responsive behavior

### Application shell

- Expanded sidebar: 232 px. Collapsed sidebar: 72 px.
- The sidebar contains grouped navigation only. Product identity belongs in the title bar, and connection/provider state belongs in Settings; the sidebar has no brand block or service footer.
- Main content scrolls independently; the sidebar remains stable.
- A light 44 px desktop title bar appears at the top of the shell with a restrained 14–16 px Centinel mark, functional File/Edit/View/Help menus, and working minimize, maximize/restore, and close controls. Unsupported commands are not exposed; browser/Vitest fallbacks remain safe when the Tauri bridge is unavailable.
- The workspace is split into a navigation-panel container and a page-content container. The navigation panel has a compact header with a right-aligned, real sidebar collapse/expand control and an independently scrolling navigation body. The page-content container has a visible rounded top-left corner and its own header containing the semantic, route-aware `Home > …` trail. Ancestor crumbs are actionable, the current crumb is plain text with `aria-current="page"`, and separators are decorative.
- The title bar and each container header remain fixed above their independently scrolling bodies. Page content must reserve space for the title bar and breadcrumb header and cannot be hidden behind them.
- Page header includes breadcrumb, title, optional description, and at most one primary action.

### Home dashboard

Home is an action-oriented workspace, not a reporting dashboard. Start directly with the work and actions that need attention; do not render a time-aware greeting or orientation message above them.

The first row uses a 12-column grid at desktop widths:

- **Action required** occupies eight columns on the left. It shows up to three projects that require a human action, ordered by urgency and then most recent update. Each item is a clearly separated container with a quiet light-grey header containing its representative semantic icon, project, module, updated time, and compact action control, plus a body with only the required-action title and concise reason. When more projects need attention, a single footer routes to Projects with **Needs attention** already selected.
- **Recommendations** occupies the right rail below Quick actions and shows one recommendation at a time inside a single white surface. The heading, compact previous/next chevron pager, `N of M` position text, recommendation title, concise summary, and next action belong to that surface; no step-by-step workflow or rationale sub-card is rendered. A restrained green Centinel shield watermark is inset within the top-right area and the forest-green CTA aligns to the trailing edge. Every recommendation type uses the same fixed desktop height so paging does not shift surrounding content; narrow layouts return to content-driven height. Pager controls appear only when more than one recommendation is available and wrap deterministically.

Only these actionable states belong in Action required: review required, changes required, a blocked or failed test, and setup required. Do not include completed, ready, running, or passive warning states. Do not lead with an approval count.

Each action row follows a reason-first scan path: compact semantic status icon; project, module, and updated-time context; dominant plain-language state; a plain explanatory message; and one contextual action. Use the short actions **Review**, **Resolve**, **Inspect**, and **Set up**. Do not place a decorative illustration inside each row; use one large, transparent illustration as a restrained page-level background element.

The second and final row is **Recent projects**, capped at four rows. It uses a predictable table sequence: **Project**, **Latest activity**, and **Current state** on the dashboard; the full Projects directory also exposes explicit actions. The dashboard omits project descriptions to prioritize project-name scanning and visually hides the table header while retaining its semantics for assistive technology. Latest activity is an unboxed semantic stack with the module/type, activity name, and timestamp. Current state uses a compact rounded-rectangle semantic text tag based on the project's next-action state and is pinned to the far right. Testing counts are omitted because they do not help users choose the next action. Dashboard rows have no action column or dividers, remain hoverable and keyboard-operable to open the project overview, and **View more** is aligned to the far right of the section heading and opens the unfiltered directory.

Dashboard does not filter Recent projects. Projects reuses the same table component and adds search across project name, description, and latest activity, plus **Current state** and activity filters. State groups are **Needs attention**, **In progress**, **Completed**, **Cancelled**, and **No activity**. Workspace path, pinning, and New project remain directory-only concerns; project removal is not presented in either project-summary table.

All values come from persisted application data. Omit a value or show a concise empty state when it is unavailable; never manufacture a dashboard metric.

Use consistent outline icons on tinted semantic tiles for repeated actions and statuses. A purpose-built code-native SVG may be used once as the page watermark to create attention without simulating data. Integrations may use connected service nodes only inside Settings. Do not use evidence screenshots, charts, generic AI artwork, or decorative telemetry on Home.

### Breakpoints

- **1440 x 900:** full sidebar, multi-column summaries where helpful.
- **1200 x 900:** full or user-collapsed sidebar; reduce secondary columns before reducing control size.
- **960 px and below:** collapsed sidebar or drawer; stack forms and details; keep tables horizontally scrollable with a clear affordance.
- **720 px and below:** single-column content, 16 px gutters, 44 px controls, dialogs become near-full-width sheets.

Responsive design must preserve every action. Do not hide important controls solely because the window is narrow.

## 9. Component contract

All screens use shared primitives rather than screen-specific imitations.

### Buttons

- **Primary:** one per action region; starts or confirms the main task.
- **Secondary:** safe alternative actions.
- **Quiet:** tertiary navigation and low-emphasis actions.
- **Destructive:** delete or irreversible removal; never used as the default.
- **Icon button:** only for familiar compact actions, with tooltip and accessible label.

Loading buttons preserve width, disable repeat submission, and use a verb such as “Starting review…”. Never use `transition: all`.

### Forms

- Every control has a persistent visible label.
- Required fields use text or a programmatic required state, not color alone.
- Supporting text appears before an error; errors appear beside the field and in a focusable summary when submission fails.
- Preserve entered values after an error.
- Examples supplement labels; placeholders do not replace labels.
- Advanced options are collapsed by default and remember their open state during the task.

### Status and feedback

Use one `StatusBadge` mapping across the application. Badges are compact labels, not primary calls to action.

- Inline message: local validation or status near a field/action.
- Banner: page-level service or workflow issue with recovery action.
- Toast: background completion or non-blocking confirmation.
- Dialog: user decision, not passive information.

Long-running work uses an accessible progress region (`aria-live="polite"`). Failures use `role="alert"` only when immediate interruption is necessary.

### Panels, lists, and tables

- Use panels to group a real section, not every object.
- Prefer a list for scan-and-open content and a table for exact comparison.
- Rows use a dedicated disclosure button; do not make an unlabeled container click target.
- Keep headers visible for long evidence or findings lists.
- Empty states explain why the area is empty and offer the next relevant action.

### Dialogs and overlays

Dialogs require:

- a labelled title and dialog semantics;
- initial focus, focus trap, Escape support, and focus restoration;
- a visible Close control with an accessible name;
- outside-click dismissal only when losing unsaved input is impossible;
- confirmation for destructive actions with the affected project/source named.

### Findings

Each finding row shows title, severity, source module, status, and location when present. Expanded detail follows this order:

1. Description
2. Evidence
3. Recommendation
4. Confidence and provenance
5. Review actions

Do not hide low-severity or informational findings from the count. Use the same finding lifecycle everywhere.

### Evidence

Screenshots are primary visual evidence. Action traces are primary textual evidence. AI requests/responses, console output, and debug bundles are advanced evidence.

- Image thumbnails use a subtle outline because image edges may match the page surface.
- The viewer supports keyboard close and previous/next navigation.
- Type filters show counts and an active state.
- Missing files show a recoverable error rather than an empty broken frame.

## 10. Motion

Motion explains change; it does not decorate the interface.

```css
--duration-fast: 100ms;
--duration-standard: 150ms;
--duration-slow: 220ms;
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
```

- Hover/focus: 100-150 ms.
- Disclosure and small overlays: 150-220 ms.
- No page-load entrance animation or repeated stagger.
- High-frequency actions such as typing, list filtering, and evidence stepping do not use custom animation.
- Animate only `opacity` and `transform` when possible.
- Declare exact transition properties; never use `transition: all`.
- Transitions must be interruptible and reverse smoothly.
- `prefers-reduced-motion: reduce` removes non-essential motion and scrolling effects.

## 11. Accessibility and content

The release target is WCAG 2.1 AA.

- All workflows are operable by keyboard.
- Focus is always visible and follows reading order.
- Provide a skip link to main content.
- Use semantic headings, landmarks, labels, buttons, tables, and lists.
- Do not attach primary actions only to hover or row clicks.
- Use real buttons for actions and real links for navigation.
- Announce async results without repeatedly stealing focus.
- Support 200% zoom without losing content or actions.
- Write short sentences, front-load the action, and define technical terms in place.
- Avoid blame (“Review could not start” rather than “You entered an invalid configuration”).
- Error messages state what happened, what remains safe, and what the user can do next.

## 12. Data integrity and trust

- Dashboard summaries must be computed from persisted application data.
- Never show placeholder readiness as a real failure or success.
- Mark AI-generated content as generated and preserve provenance where available.
- Do not expose secrets, full API keys, sensitive prompts, or credentials in UI, logs, evidence previews, or screenshots.
- Destructive actions identify scope and consequences. Project deletion must continue to state whether local workspace files are retained.
- Reports and evidence must preserve stable timestamps, session identity, source module, and status.
- A visible confidence value must explain what it represents; otherwise omit it.

## 13. Implementation rules

1. Reuse or extend shared primitives before adding a screen-specific component.
2. Put semantic tokens in one token stylesheet and component rules in one component layer. Remove duplicate command/legacy overrides as screens migrate.
3. Keep feature behavior and frontend/sidecar contracts backward compatible unless the task explicitly changes them.
4. Use real application data; do not add sample operational values to production screens.
5. Use progressive disclosure for Git refs, provider endpoints/formats, model traffic, console logs, debug bundles, and other expert controls.
6. Add component variants instead of one-off class names when a legitimate visual difference exists.
7. Test component states: default, hover, focus-visible, disabled, loading, success, warning, error, empty, and reduced motion.
8. Use accessible role/name queries in frontend tests for interaction-critical UI.
9. Do not call a migration complete while the same concept still has competing legacy and new visual implementations.
10. Any intentional deviation from this document requires explicit user approval and a recorded update to this file.

## 14. Visual review checklist

Before accepting a redesigned screen:

- [ ] The primary user task and one primary action are obvious.
- [ ] Static and Dynamic terminology matches this document.
- [ ] Summary is visible before technical detail.
- [ ] Empty, loading, partial, success, failure, cancelled, and disconnected states are handled where applicable.
- [ ] Buttons, fields, status, panels, dialogs, icons, spacing, radius, and motion use shared primitives and tokens.
- [ ] No fake metrics, decorative telemetry, gradients, glow, or nested card clutter remain.
- [ ] Keyboard navigation, focus, dialog behavior, live status, error recovery, and reduced motion work.
- [ ] The screen works at 1440 x 900, 1200 x 900, and a narrow viewport.
- [ ] Text remains readable and actions remain reachable at 200% zoom.
- [ ] The relevant frontend tests and `pnpm --filter centinel build` pass.
- [ ] Styles do not leak into unrelated screens.
