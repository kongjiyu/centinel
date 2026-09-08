# Centinel Monitor 1 UI/UX remediation plan — 7 September 2026

## Scope and authority

This plan covers UI inconsistencies observed in the running Centinel frontend on Monitor 1 that are not already resolved by `docs/UI_UX_AUDIT_2026-09-05.md`. `DESIGN.md` remains authoritative. Preserve current sidecar contracts, persisted data, and unrelated working-tree changes.

The review used the live app at `http://localhost:1420/` with existing local project data and inspected Home, Projects, project Overview, Source, Collaborations, Project Settings, Review setup, Dynamic Testing setup, and global Settings. No review, dynamic run, provider test, source mutation, deletion, or export was triggered.

## Design outcome

Centinel should feel like one trustworthy QA workspace rather than a collection of partially connected panels. Every global action must name its project before work starts, setup flows must share one predictable surface, and unavailable capabilities must be presented as unavailable—not simulated with placeholder people, policies, or integrations.

The revised interaction model is:

```text
Global Review / Dynamic Testing
  -> choose a real project when no project is in context
  -> open one consistent task dialog
  -> start work or cancel back to the same context

Project workspace
  -> Overview / Source / Findings / Collaborations / Settings
  -> real persisted data, or one honest unavailable state
  -> never disabled fake configuration values
```

Visual treatment stays within the existing approachable-enterprise system: light sage canvas, white structural surfaces, forest-green action, Lucide outline icons, 40 px desktop controls, token radii, borders for structure, and shadows only for overlays. Do not introduce a new styling system.

## Findings and implementation

### 1. Global module launch silently targets the latest project

**Observed:** From Home, Projects, or Settings, the Review and Dynamic Testing navigation buttons open setup for the most recently updated project. The target is only revealed after navigation. Inside a project, the same controls correctly have context.

**Risk:** A user can prepare or start work in the wrong workspace. This is a conceptual-model and error-prevention failure.

**New design:**

- When a project is already in context, retain the direct launch behavior.
- Outside a project, open a labelled project-selection dialog titled `Start a review` or `Start Dynamic Testing`.
- Show a visible `Project` label, the selected project's real name and description/path, a secondary Cancel action, and one primary Continue action.
- With no projects, route to Projects and explain that a project is required.
- Preserve keyboard focus trapping, Escape, focus restoration, and 40 px minimum targets through the shared `Modal` and button primitives.

**Acceptance:** No global module action chooses a project invisibly. The selected project is announced before the setup form opens.

### 2. Review and Dynamic Testing setup use competing presentation patterns

**Observed:** Review opens a centered modal while Dynamic Testing expands an inline nested panel inside the project overview. The inline form repeats a `New test` header and close control inside a card, while Review uses the shared dialog shell.

**Risk:** The same class of action has different focus, cancellation, density, and narrow-window behavior. The nested Dynamic panel also creates avoidable card-within-card framing.

**New design:**

- Use the shared modal shell for both setup flows.
- Keep the forms task-specific, but align their title, intro, field rhythm, advanced disclosure, error placement, and action order.
- Remove the Dynamic form's internal duplicate header/close control; the modal owns title and dismissal.
- Keep entered values after validation or request failure. Disable and relabel the submit button during submission.
- Cancel returns to the same project/section and restores focus to the invoking action.

**Acceptance:** Review and Dynamic setup behave as one family at desktop and narrow widths without nested-card clutter or duplicate dismissal controls.

### 3. Collaborations simulates identities and roles

**Observed:** The live Collaborations section displays `You · Admin`, `Assigned reviewers`, and `Developers` even though the screen states that collaborator management has no backing service.

**Risk:** The interface implies authorization and participation data that does not exist, violating Centinel's data-integrity rules.

**New design:**

- Remove all invented identity and role rows.
- Keep the destination only because it is part of the agreed project information architecture.
- Show one neutral unavailable state: collaboration data is not connected in this build; no invitations or roles are being represented.
- Keep `Invite collaborator` disabled only if it has an adjacent explanation; otherwise omit it.

**Acceptance:** The section contains no person, role, count, or invitation state unless it comes from a real service response.

### 4. Project Settings renders fabricated policy defaults

**Observed:** Disabled inputs display `90` days, `Low, Medium, High, Critical`, and `Critical, High, Medium, Low`, while the screen says settings persistence is unavailable.

**Risk:** Disabled controls look like saved configuration. Reviewers cannot distinguish product defaults from mock values.

**New design:**

- Remove fabricated policy inputs and the disabled destructive action.
- Present only persisted project facts already available on the `Project` object: name, workspace location, and creation date.
- Add one concise unavailable state explaining that editable project policies will appear when persistence is implemented.
- Render facts as a definition list or compact rows, not disabled form controls.

**Acceptance:** Every displayed value is backed by the current project record, and unavailable settings do not masquerade as saved values.

### 5. Source connections look like broken controls rather than a capability boundary

**Observed:** Global Settings says `Connect the services your projects use`, then shows GitHub, Google Drive, and Slack cards all marked `Not connected`, while also stating that persistence is unavailable and exposing no action.

**Risk:** The area reads as three failed integrations and adds warning-colored clutter to an already dense configuration screen.

**New design:**

- Replace the three pseudo-connection cards with one honest availability panel.
- Explain that source connections are not configurable from Settings in this build and direct users to a project's Source section for supported local/repository input.
- Do not show provider connection statuses until real persisted connection state exists.

**Acceptance:** Settings does not imply failed or actionable integrations when none are implemented.

## Implementation slices

1. Add explicit global project selection and focused AppShell tests.
2. Wrap Dynamic setup in the shared modal and align setup form semantics/tests with Review.
3. Replace simulated Collaborations and Project Settings content with truthful states and real project facts.
4. Replace Source connection placeholders in global Settings with a single honest capability boundary.
5. Run targeted tests, the full frontend suite, and `pnpm --filter centinel build`.
6. Reinspect the live app on Monitor 1, then check 1440×900, 1200×900, and a narrow viewport where tooling permits.

## Verification checklist

- [x] Global Review and Dynamic Testing never silently select a project.
- [x] Project selection and both setup dialogs support keyboard focus, Escape, and focus restoration.
- [x] Review and Dynamic Testing setup share the same overlay hierarchy and action order.
- [x] No invented people, roles, integration states, policy defaults, or operational metrics remain in the changed surfaces.
- [x] Empty/unavailable states explain the capability boundary and next valid action.
- [x] Monitor 1 layout retains the 1440 px readable maximum and does not stretch forms or tables across the ultrawide canvas.
- [x] Relevant tests pass.
- [x] Full frontend tests pass.
- [x] Frontend production build passes.

## Implementation status

Implemented on 7 September 2026 through the requested Luna/Max delegation, followed by parent review and live correction of a Home-only legacy modal style leak.

- Live Monitor 1 verification passed for the global project chooser, Review setup, Dynamic Testing setup, Collaborations, Project Settings, and the global Settings source boundary.
- Targeted verification passed: 4 files / 11 tests.
- Full frontend verification passed: 16 files / 55 tests.
- `pnpm --filter centinel build` passed.
- Automated screenshots at 1440×900, 1200×900, and 600×900 were attempted, but the repository's Playwright package has no matching local Chromium headless-shell binary. No browser download was performed. Existing responsive rules and component tests remain green; exact screenshot verification at those three override sizes is still outstanding.

## Considered but rejected

| Candidate | Rejected because |
| --- | --- |
| Remove Review and Dynamic Testing from global navigation | The agreed information architecture requires both destinations; making project choice explicit fixes the safety problem without reducing discoverability. |
| Keep Dynamic setup inline and move Review inline | Long setup content would compete with activity/results and preserve focus inconsistencies; the shared modal already implements the required accessibility contract. |
| Keep disabled placeholder settings as a roadmap preview | Disabled values are still read as configured state. A truthful unavailable state communicates roadmap boundaries without fabricating data. |
| Expand the main column to fill the entire ultrawide monitor | `DESIGN.md` intentionally caps readable content at 1440 px. More width would weaken scanning and line length rather than improve the layout. |
