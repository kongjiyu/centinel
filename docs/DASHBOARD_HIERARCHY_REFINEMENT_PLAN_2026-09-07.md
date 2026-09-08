# Dashboard hierarchy refinement plan

## Objective

Refine the current Dashboard implementation to remove the remaining nested-card appearance and make Action required, Recommendations, and Recent projects faster to scan. Preserve real-data derivation, navigation, filtering, bounded dashboard limits, accessibility, Centinel identity, and the shared Dashboard/Projects table model.

## Design interpretation

The attached screenshot is a visual reference only. The user's written requirements are authoritative.

### Recommendations

- Keep one semantic `section`, but remove the outer white panel treatment so it does not appear as a card containing another card.
- Make the tinted recommendation surface the only visual container. Integrate the `Recommendations` heading, pager, recommendation title, concise summary, workflow, and CTA into that surface.
- Remove the entire “Why this is recommended” block and its supporting rationale from the visible card. The recommendation selection can remain deterministic from real application state.
- Retain the recommendation background tint and the three-step workflow, but increase attention through stronger title/icon hierarchy, spacing, and a clearer accent edge—not additional containers.
- Replace the decorative CSS circle with the existing Centinel shield asset (`/assets/centinel-shield.svg`) as a low-opacity watermark.
- Change the CTA to a transparent or lightly translucent background. Its text, icon, and border use the recommendation accent color. Hover and active states remain visible without turning it into a solid nested block.
- Remove the desktop equal-height requirement. Action required and Recommendations use natural content height at every breakpoint.

### Recent projects

- Preserve the shared table, filter, project limit, state model, navigation, and Projects-page reuse.
- Remove the bordered/tinted message-box treatment from Latest activity.
- Restore an unboxed activity stack: module/type, activity title, and timestamp. The empty state is plain supporting text rather than another container. Do not restore the redundant word “Project.”
- Increase scan contrast through typography: stronger project name and activity title, clearer module label, quieter description and timestamp, and consistent alignment.
- Reduce Current state tag radius from a pill to the shared control-style radius (approximately 6–8 px), while retaining semantic text, border, and color.
- Keep the narrow layout as a stacked semantic row with no horizontal overflow.

### Action required

- Keep the section-level panel, but render items as flat rows separated by restrained dividers. Do not add a card or colored message container inside each item.
- Give every action state a representative Lucide icon rather than choosing only from danger/wrench:
  - Review failed or blocked: review/file alert icon.
  - Changes required: file-edit or revision icon.
  - Review required: review/check icon.
  - Dynamic test failed or blocked: monitor alert icon.
  - Setup required: source/folder setup icon.
- Each item has two semantic regions:
  1. Header: representative icon, project name, activity type, and updated datetime.
  2. Body: required-action title first, then a 12-column row with the explanatory message occupying nine columns and the action occupying three.
- Use natural copy in the header: `<project name> · <Review | Dynamic Testing> · <updated datetime>`. This preserves the requested meaning without the grammatically unclear phrase “happeneds on.”
- At narrow widths, collapse the 9:3 body row into one column and keep the action directly after its message.
- Retain urgency ordering, the three-item cap, overflow navigation, exact destinations, and the existing state/reason derivation.

## Implementation sequence

1. Update `DashboardScreen.tsx`:
   - Add an explicit icon mapping for action type/state.
   - Recompose Action required into header and body regions.
   - Remove visible recommendation rationale markup.
   - Integrate the recommendation section heading/pager into the single tinted surface.
   - Add the Centinel shield watermark element.
2. Update `DashboardScreen.css`:
   - Remove outer Recommendation panel styling and equal-height coupling.
   - Restyle the single recommendation surface and translucent outlined CTA.
   - Implement flat action rows and the 9:3 body grid.
   - Preserve focus, hover, active, reduced-motion, and narrow-screen behavior.
3. Update `ProjectSummaryTable.tsx` and `ProjectSummaryTable.css`:
   - Replace activity message boxes with plain semantic activity stacks.
   - Strengthen the scan hierarchy and reduce state-tag radius.
   - Keep both Dashboard and Projects variants aligned.
4. Update `DESIGN.md` to record the approved removal of visible recommendation rationale, equal-height coupling, message-box activity treatment, and action-row composition.
5. Update tests:
   - Verify “Why this is recommended” is absent.
   - Verify recommendation workflow, pager, and navigation remain functional.
   - Verify action rows expose project, module, datetime, state, reason, representative action, and correct navigation.
   - Verify Latest activity remains unboxed semantically and testing counts remain absent.
   - Preserve filter handoff and Projects search/filter coverage.

## Verification

- Run targeted Dashboard and Projects tests while iterating.
- Run `pnpm --filter centinel test`.
- Run `pnpm --filter centinel build`.
- Visually verify Dashboard and Projects at 1440×900, 1200×900, and a narrow viewport.
- Confirm no horizontal overflow, no hidden actions, logical keyboard order, visible focus, minimum control targets, and no style leakage.
- Confirm the production UI continues to use persisted data only; no example project data is added.

## Acceptance checklist

- Recommendations has one visual container, no rationale sub-card, a Centinel shield watermark, and an outlined translucent CTA.
- Recommendations draws attention without exceeding the information density appropriate to a secondary dashboard section.
- Action required items read as header/body rows with representative icons and a 9:3 message/action composition.
- Recent project activity is plain and typographically scannable, without a message-box container.
- State tags are compact rounded rectangles rather than pills.
- Dashboard and Projects remain one coherent component system across desktop and narrow layouts.
