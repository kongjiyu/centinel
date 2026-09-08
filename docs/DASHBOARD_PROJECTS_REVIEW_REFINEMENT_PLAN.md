# Dashboard, Projects, and Review Entry Refinement Plan

> Status: implemented and verified
>
> Date: 2026-09-08
>
> Scope: frontend interaction and presentation only; preserve existing routes, persisted data, project creation behavior, and sidecar contracts
>
> Acceptance review: `docs/DASHBOARD_PROJECTS_REVIEW_ACCEPTANCE_REVIEW.md`

## 1. Design diagnosis

The current screens use several competing visual and interaction patterns for the same kind of work. Native selects differ by screen, directory controls are presented as a separate information block, project rows alternate between oversized and under-padded, and the dashboard repeats secondary information before exposing the next action. This creates a broken scan path: users must interpret the container before they can identify the project, its state, and the action.

The revised mental model is object-first:

1. Identify the project or task.
2. Understand its current state or recommendation.
3. Take the nearest relevant action.

The implementation should therefore use shared controls, quiet neutral surfaces, consistent row anatomy, and progressive disclosure. White and light-grey surfaces carry the structure. Black and neutral text carry the hierarchy. Green is reserved for actions, selection, and restrained hover feedback.

## 2. Implementation work

### A. Shared select system

- Add one accessible React select-library integration and expose it through a shared Centinel select component.
- Replace every user-facing native `<select>` in the frontend, including dashboard, project directory, project overview filters, review entry, dynamic testing, findings, requirements, settings, and shell controls.
- Preserve the existing values, labels, disabled states, callbacks, form semantics, and filtering behavior.
- The shared component must support visible labels or accessible names, keyboard navigation, focus-visible styling, disabled states, long option labels, modal layering, and narrow viewports.
- Keep select surfaces neutral; selection and focus may use restrained Centinel green.

### B. New project modal

- Replace the Projects page inline creation form with the existing shared project-creation modal pattern.
- `New project` opens the modal, the modal gathers the same required details, validation remains local and understandable, successful creation refreshes the directory and opens or selects the created project according to existing behavior.
- Closing or cancelling does not create a project. Focus enters the modal, Escape/close works, and focus returns to the trigger.

### C. Projects directory hierarchy and density

- Remove the visible copy `Search projects`, `Search every project and filter...`, `Open a project to review...`, and the registered-project count.
- Retain a concise Projects title with subdued supporting treatment; do not reduce primary text contrast below accessibility requirements.
- Present search and filters as one compact toolbar visually attached to the table, without a separator line between them.
- Keep pagination at five projects per page and preserve filter/search state behavior.
- Use the same Project / Latest activity / Current state content sequence as Recent projects.
- Increase useful horizontal and vertical row padding while removing artificial fixed/minimum row height and excess whitespace.
- Normalize project-name typography to the shared component-title scale. Rows with short or missing activity must remain aligned with rows containing longer activity.
- Preserve directory-only functionality such as workspace location and permitted project actions, but do not reintroduce a Remove action where the approved directory design excludes it.

### D. Dashboard Action required

- Replace green-tinted item headers with a quiet light-grey header surface.
- Keep each item as one semantic container with a clearly separated header and body.
- Put the representative icon, project, activity/module, and timestamp in the header.
- Move the contextual action into the header's right edge and reduce it to a compact control while retaining a minimum accessible hit target.
- Keep the body reason-first: required-action title followed by a concise explanation. Do not duplicate module, timestamp, or status metadata in the body.
- Preserve semantic danger/warning meaning in icons and text, not large filled surfaces.

### E. Dashboard Recommendations

- Remove the three-step workflow and any supporting copy whose only purpose is to explain those steps.
- Retain one recommendation at a time with a clear title, one concise project-specific explanation, pager when multiple recommendations exist, and one trailing action.
- Use a single white panel with a restrained Centinel watermark; do not add a nested card.
- The recommendation must answer: what is recommended, for which project/context, and what action follows.

### F. Dashboard Recent projects

- Reuse the shared project-summary table structure and activity filter.
- Increase useful row and panel padding without fixed-height whitespace.
- Normalize project-name typography with the Projects directory.
- Keep the dashboard-specific compact scope: no project description, maximum four rows, row navigation plus a labelled accessible disclosure control, and `View more` beside the heading.

### G. Review entry sequence

- Make Review name the first field in the entry flow.
- Follow it with project selection and the existing Create project modal link, then review instructions/options in a natural task sequence.
- Remove the visible available/inherited source count and source list from the entry page.
- Preserve source validation required to start a review, but surface any blocking condition only when it affects submission, in plain language near the action.
- Continue to use the shared select component for project selection.

### H. Design-system documentation

- Update `DESIGN.md` so the implemented neutral-first palette and component contracts are authoritative.
- Record that white/light-grey/black dominate; green is restricted to primary actions, active selection, focus, success, and restrained hover feedback.
- Update Dashboard, Projects, Review entry, form/select, row-density, and recommendation guidance to match this plan and remove contradictory legacy instructions such as the recommendation step workflow or green action-item headers.

## 3. Acceptance criteria

| ID | Acceptance criterion |
|---|---|
| AC-01 | Selecting `New project` on Projects opens a labelled modal containing the existing project-detail inputs; cancel/close creates nothing, successful submission refreshes the real project list, and keyboard focus is managed correctly. |
| AC-02 | Every user-facing select in `centinel/src` uses one shared React-library-backed select primitive; no visible native `<select>` remains, and all migrated controls preserve their previous values and callbacks. |
| AC-03 | Shared selects have an accessible name, visible focus, keyboard option navigation, Escape behavior, disabled styling, modal-safe layering, and no horizontal overflow at narrow width. |
| AC-04 | The Projects page no longer displays the four rejected copy/count strings, and search plus filters read as a compact toolbar directly associated with the project table without an intervening separator. |
| AC-05 | Projects pagination continues to show at most five matching projects per page and correctly updates after search/filter changes. |
| AC-06 | Project rows on Projects and Recent projects use consistent project-name type, content sequence, alignment, and intentional padding; they do not rely on oversized fixed/minimum heights and remain aligned for missing or long activity. |
| AC-07 | Action required item headers use neutral light-grey surfaces; each header contains icon, project/module/time context and a compact right-aligned action, while the body contains only the action title and concise reason. |
| AC-08 | Recommendation cards contain no step-by-step workflow; each visible recommendation still identifies the recommendation, relevant context, and CTA inside one non-nested white surface. |
| AC-09 | Recent projects retains its activity filter, maximum-four-row behavior, row navigation, accessible disclosure action, and `View more`, with improved padding and no project description. |
| AC-10 | Review entry begins with Review name, then project selection/create-project access, then remaining review inputs; no available/inherited source summary is rendered. |
| AC-11 | Existing Dashboard, Projects, Review Entry, Dynamic Testing, Findings, Requirements, Settings, and shell select-driven behavior remains functional after migration. |
| AC-12 | `DESIGN.md` describes the neutral-first color ratio, shared select contract, modal project creation, compact directory toolbar/rows, neutral Action required headers, simplified Recommendations, and Review-entry order without contradicting the implementation. |
| AC-13 | Relevant frontend tests pass and `pnpm --filter centinel build` succeeds. |
| AC-14 | At 1440×900, 1200×900, and a narrow viewport, the affected screens have no unintended horizontal page overflow, clipped actions, inaccessible dropdown menus, or broken modal/table composition. |

## 4. Verification protocol

1. Run targeted tests while implementing, updating them to use accessible role/name queries supported by the shared select.
2. Run `pnpm --filter centinel test`.
3. Run `pnpm --filter centinel build`.
4. Inspect Dashboard, Projects, New project modal, Review entry, Dynamic Testing, Findings, Requirements, Settings, and shell selectors with keyboard and pointer.
5. Verify Dashboard and Projects at 1440×900, 1200×900, and a narrow viewport; verify the modal and dropdown menu at narrow width.
6. Compare the result to every acceptance criterion and classify each as `completed`, `partial fix`, or `unresolved`, with evidence.
