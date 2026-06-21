# Centinel Design System

This document is the authoritative visual and interaction specification for Centinel. All agents and contributors must read it before changing frontend UI, styling, branding, icons, motion, or layout.

If existing code conflicts with this document, follow this document for new work and migrate existing screens incrementally. Do not introduce a second visual language. Any intentional deviation requires explicit user approval.

## 1. Product Context

- **Product:** AI-assisted software quality assurance workstation.
- **Primary audience:** QA engineers, testers, developers, SMEs, and FYP evaluators reviewing a complete product.
- **Core jobs:** configure AI providers, manage projects, run static and dynamic tests, inspect evidence, debug failures, and export reports.
- **Brand personality:** precise, technical, evidence-driven, trustworthy, calm, and operational.
- **Primary platform:** desktop application. The web build is used for development and browser-based testing.

## 2. Visual Direction

The visual direction is a **high-tech QA command center** inspired by aerospace mission-control systems.

It should feel:

- Dense but readable.
- Technical without becoming a game HUD.
- Dark, controlled, and focused on operational state.
- Built from fine grid lines, compact telemetry, geometric borders, and restrained status illumination.
- Professional enough for repeated daily work and an FYP evaluation.

The memorable visual signature is the combination of a deep blue-black workstation, cyan structural lines, and lime-green verified states.

### Do not turn it into

- Generic neon cyberpunk.
- A marketing landing page.
- Glassmorphism or blurred floating cards.
- A purple/blue gradient interface.
- A dashboard full of decorative charts or fake telemetry.
- A collection of large rounded cards.

## 3. Color System

Use these values as semantic tokens. Do not invent near-duplicate colors when an existing token fits.

```css
:root {
  --command-bg: #06131c;
  --command-bg-deep: #030d14;
  --command-panel: #091b26;
  --command-panel-raised: #0c2230;

  --command-line: rgba(89, 180, 199, 0.22);
  --command-line-strong: rgba(103, 205, 220, 0.42);
  --command-grid: rgba(85, 160, 179, 0.055);

  --command-text: #d9edf0;
  --command-muted: #7898a3;
  --command-faint: #4c6c77;

  --command-cyan: #66c9d6;
  --command-success: #9bdd63;
  --command-warning: #d9b45c;
  --command-danger: #e57a78;
}
```

### Color roles

- **Lime green:** verified success, online state, completed checkpoints, and the Centinel brand mark.
- **Cyan:** structure, navigation emphasis, focus, links, neutral active processes, and technical decoration.
- **Red:** failures, destructive actions, offline state, and blocked execution only.
- **Amber:** warnings that require attention but are not failures.
- **Muted blue-gray:** secondary information and metadata. Never use low-contrast gray on dark backgrounds.

Glow must be subtle and state-driven. Do not apply glow to every border or text element.

## 4. Typography

- **UI font:** `DM Sans`.
- **Technical metadata:** `JetBrains Mono`.
- Use monospace only for timestamps, IDs, counts, paths, status codes, and telemetry.
- Keep body text between 12px and 14px in dense workstation views.
- Use 20px to 24px for page titles and 11px to 13px uppercase labels for panel headings.
- Letter spacing is normally `0`. The uppercase `CENTINEL` wordmark may use `0.13em`.
- Avoid oversized hero typography and avoid negative letter spacing.

## 5. Brand Assets

- Sidebar shield: `centinel/public/assets/centinel-shield.svg`.
- App icon source: `centinel/src-tauri/app-icon.svg`.
- App icon raster source: `centinel/src-tauri/app-icon.png`.
- Tauri-generated icons: `centinel/src-tauri/icons/`.

The mark is a lime geometric shield with an integrated `C/G` path. Do not replace it with a generic shield-check icon. The wordmark is uppercase `CENTINEL`.

App icons use `#06131c` as the background and must preserve transparent outer corners. Do not use Quick Look thumbnail output as an icon source because it composites transparency onto white.

## 6. Layout

- Desktop-first workstation layout with a persistent left sidebar.
- Default sidebar width: `224px`.
- Main content maximum width: `1360px`.
- Target viewport for primary QA: `1200x900` and `1440x900`.
- The primary dashboard should expose its important sections in one viewport at these sizes.
- Use compact spacing, with 12px to 16px between related panels and larger separation only between major workflow regions.
- Use CSS Grid for stable workstation layouts.
- Adapt at `980px` and `720px`; do not merely scale everything down.
- Fixed or sticky edge telemetry must reserve content space and must never obscure controls.

## 7. Surfaces And Borders

- Panel radius: `3px` to `4px`.
- General control radius: no more than `4px` unless the shape is naturally circular.
- Use 1px tinted cyan borders and restrained inset highlights.
- Technical corner marks may be used on primary panels.
- Use the faint 32px grid only on main workstation backgrounds.
- Avoid generic drop shadows. Prefer border contrast and subtle inset depth.
- Do not place cards inside cards. Flatten section hierarchy.

## 8. Components

### App shell

- Deep blue-black sidebar with the Centinel shield and uppercase wordmark.
- Active navigation uses a lime left rail, faint cyan fill, and a small live-state dot.
- Footer status rows display real Sidecar, Text AI, and Vision AI state.
- Radar and telemetry decoration must be tied to real system state where possible.

### Page header

- Compact command header, not a marketing hero.
- May contain a technical badge, page title, short operational description, readiness state, and a restrained radar motif.
- The product or page name must remain the strongest first-viewport signal.

### Panels

- Uppercase cyan section label.
- Thin separator under the heading.
- Dense rows with predictable alignment.
- Pending, running, success, and failure states must be visually distinct without relying only on text.

### Status and progress

- Lime means completed or validated.
- Cyan means active or neutral progress.
- Muted blue-gray means pending.
- Red means failed or blocked.
- Dynamic testing timelines must display real session data. Never fabricate timestamps, checkpoints, percentages, or system metrics.

### Buttons

- Use Lucide icons for familiar actions.
- Icon-only buttons require an accessible label and tooltip when the meaning is not obvious.
- Primary actions use lime sparingly.
- Secondary actions use transparent or panel-colored surfaces with cyan borders.
- Destructive actions use red only at the point of risk.

### Forms

- Inputs use dark raised surfaces, 1px cyan-tinted borders, and a clear cyan focus ring.
- Labels remain visible; placeholders are not substitutes for labels.
- Advanced provider settings should use progressive disclosure.
- Errors appear near the field and include a specific recovery action.

### Evidence and reports

- Optimize for scanning, comparison, and repeated inspection.
- Screenshots must open into a larger inspection view.
- Logs and paths use monospace text.
- Severity, source, and session status must remain easy to distinguish.
- Markdown reports should render in-app using the same dark technical theme.

## 9. Motion

Motion communicates state; it is not decoration.

- Use opacity and transform for entrances and hover feedback.
- Use restrained status pulses, radar sweeps, and checkpoint illumination.
- Typical interaction duration: 150ms to 220ms.
- Page reveal duration: 300ms to 500ms with subtle staggering.
- No bounce, elastic motion, or continuous movement across large regions.
- Always support `prefers-reduced-motion` and reduce animations to effectively instant transitions.

## 10. Responsive Behavior

- At medium widths, reduce sidebar width and allow two-column metrics to wrap.
- At narrow widths, collapse the sidebar to icons while retaining all navigation destinations.
- Timelines may become scrollable, but their labels and current state must remain available.
- Never hide critical testing, evidence, or export actions.
- Text must wrap or truncate intentionally; no component may overflow its parent.

## 11. Accessibility

- Maintain WCAG AA contrast for essential text and controls.
- Every interactive element must have a visible `:focus-visible` state.
- Do not use color as the only state indicator; pair it with text or an icon.
- Respect keyboard navigation and semantic button/link behavior.
- Decorative radar, grid, and telemetry elements must be hidden from assistive technology.

## 12. Data Integrity

The command-center aesthetic must not imply capabilities that do not exist.

- Use real project, provider, session, evidence, and readiness data.
- Empty states must clearly say when no run or evidence exists.
- Do not show fake geographic coordinates, latency, percentages, charts, or timestamps.
- Decorative elements must remain visually secondary to real product information.

## 13. Implementation Rules For Agents

1. Read this file before frontend work.
2. Preserve existing behavior unless the user explicitly requests a workflow change.
3. Reuse existing tokens and Lucide icons.
4. Scope migrations by complete screen; do not leave one screen half light and half command-center themed.
5. Keep CSS selectors local to the screen or shell being changed.
6. Do not add dependencies for effects achievable with CSS.
7. Verify visual changes at `1440x900`, `1200x900`, and a narrow viewport.
8. Run the frontend production build before reporting completion.
9. Check that other screens did not inherit unintended styles.
10. Ask for approval before changing this design direction or brand mark.

## 14. Visual Review Checklist

- Does the screen look like one operational system rather than unrelated cards?
- Are all displayed metrics and statuses real?
- Is lime reserved for verified/ready states?
- Are borders and glows restrained?
- Can the main workflow be understood within the first viewport?
- Are controls identifiable without explanatory text inside the application?
- Does the page avoid nested cards, oversized headings, purple gradients, and glass effects?
- Are desktop and narrow layouts free of overlap and clipping?
- Does keyboard focus remain visible?
- Does reduced-motion mode remain usable?
