# UI Feedback Refinement Plan

Date: 2026-09-08

## Objective

Apply the approved desktop-shell, dashboard, Review entry, and Settings refinements from the supplied screenshots while preserving current navigation, review creation, provider configuration, usage reporting, and local-pinning behavior.

## Confirmed implementation decisions

1. **Use one continuous workspace canvas.** Remove the visible `Navigation` label and the decorative divider lines below the title bar, below the sidebar/page headers, and between the sidebar and page container. Keep the breadcrumb header, but give it the same canvas background as the page body.
2. **Make the dashboard right rail deterministic.** Place Quick actions and Recommendations in one right-rail wrapper with a controlled gap instead of relying on a two-row grid stretched by the Action required column. Give every recommendation type the same fixed desktop height so changing recommendations cannot resize the page. Return to content-driven height below the narrow-layout breakpoint.
3. **Use familiar Lucide window controls.** Keep the horizontal `Minus` glyph for minimize; replace diagonal expand/collapse glyphs with a single-square maximize glyph and overlapping-squares restore glyph. Preserve accessible names and working Tauri actions.
4. **Reposition the recommendation watermark.** Inset it from the right edge and lower it slightly so its visual center sits farther inside the card while remaining predominantly top-right.
5. **Remove the dashboard greeting block.** Start the page directly with Action required and Quick actions; do not render the time-based greeting or its orientation sentence.
6. **Make Review entry a true form page.** Remove the nested panel/modal visual treatment and redundant setup header, widen the flow to the page content area, and render `StaticReviewForm` as a semantic form with normal submit behavior. Keep source validation, project creation, advanced scope, cancellation, and error focus behavior unchanged.
7. **Use a right-pointing pinned disclosure.** Show Lucide `ChevronRight` (`>`) when Pinned is collapsed and `ChevronDown` when expanded.
8. **Replace framework versions with App Version.** Read the running Centinel app version, provide a real `Check for updates` action against the repository's published GitHub releases, and show an `Open update` action only when a newer release exists. Do not claim an in-app installer because the Tauri updater is not configured or signed in this repository.
9. **Flatten Settings.** Keep only the visible top-level content headings `App Version`, `Model Provider`, `Usage`, and `Connections`. Remove the outer model-provider heading, eyebrow/support copy, repeated provider descriptions, `Provider credentials`, `Model activity`, and decorative section/subsection rules. Apply the same low-chrome treatment to App Version and Connections while retaining truthful unavailable/empty states and real usage values.

## Files and workstreams

### Desktop shell and controls

- `centinel/src/components/AppShell.tsx`
  - remove the visible Navigation label;
  - change the Pinned disclosure icons.
- `centinel/src/components/WindowHeader.tsx`
  - use Lucide square/overlapping-square window-state icons;
  - keep minimize, toggle maximize/restore, close, focus labels, and browser-safe behavior.
- `centinel/src/workspace.css`
  - remove the shell divider rules;
  - align the sidebar toggle without a text label;
  - unify breadcrumb/page-body backgrounds;
  - retain independent scrolling and collapsed-sidebar sizing.

### Dashboard

- `centinel/src/screens/DashboardScreen.tsx`
  - remove greeting calculation and markup;
  - introduce one right-rail wrapper around Quick actions and Recommendations.
- `centinel/src/screens/DashboardScreen.css`
  - remove the stretch-based two-row layout;
  - set a stable recommendation card height at desktop/tablet widths;
  - use a compact explicit rail gap and inset the watermark;
  - preserve stacked narrow behavior.

### Review entry

- `centinel/src/screens/ReviewEntryScreen.tsx`
  - remove the redundant card heading/wrapper visual hierarchy;
  - keep a single page heading followed by the form.
- `centinel/src/components/StaticReviewForm.tsx`
  - use a semantic `<form>` and submit button while preserving the existing async validation contract.
- `centinel/src/screens/ReviewEntryScreen.css`
  - neutralize generic `.form-card` styling with sufficient specificity;
  - use page-width spacing and section rhythm rather than a centered modal card.

### Settings and updates

- `centinel/src/screens/SettingsScreen.tsx`
  - replace `Versions`/Tauri reporting with `App Version`;
  - compare the running version with the latest published GitHub release;
  - expose check/open-update states with loading and error feedback;
  - flatten provider/usage/connections headings and remove requested support copy.
- `centinel/src/workspace.css`
  - remove Settings section/subsection borders and card chrome;
  - preserve field boundaries, provider state badges, responsive tables, and focus states.

### Design contract and tests

- `DESIGN.md`
  - record this approved refinement so the previous greeting, natural-height recommendation, visible Navigation label, and framework-version wording no longer conflict with implementation.
- Update focused tests for shell labels/disclosures, window controls, dashboard layout/content, semantic Review form behavior, Settings hierarchy, and update-check states.

## Verification

1. Run focused frontend tests for `AppShell`, `WindowHeader`, `DashboardScreen`, `ReviewEntryScreen`, `StaticReviewForm`, and `SettingsScreen`.
2. Run `pnpm --filter centinel test`.
3. Run `pnpm --filter centinel build`.
4. Visually inspect Home, Review entry, and Settings at 1440x900, 1200x900, and a narrow viewport. Confirm:
   - no removed divider reappears;
   - collapsed and expanded sidebar controls remain reachable;
   - recommendation slides keep a stable height with no dead grid space;
   - Review entry reads as one form page;
   - Settings retains labelled inputs, visible focus, truthful update status, and usable narrow layouts;
   - unrelated screens retain their existing surfaces and scrolling.

## Capability boundary

The repository has `tauri.updater.active: false` and no signed updater endpoint/public key. This change therefore provides a genuine release check and opens the published release for updating; it does not simulate automatic installation. A future signed in-app update requires release infrastructure and signing configuration outside this UI refinement.
