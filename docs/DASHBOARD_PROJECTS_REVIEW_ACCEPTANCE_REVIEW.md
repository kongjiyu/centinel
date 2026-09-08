# Dashboard, Projects, and Review Entry Acceptance Review

> Review date: 2026-09-08
>
> Plan reviewed: `docs/DASHBOARD_PROJECTS_REVIEW_REFINEMENT_PLAN.md`
>
> Verdict: completed

## Acceptance results

| ID | State | Evidence |
|---|---|---|
| AC-01 | completed | Projects `New project` opens the shared labelled modal. At 375 px, initial focus moved to Project name; Cancel closed without mutation and restored focus to `New project`. Existing creation validation and success callbacks are covered by Projects and modal tests. |
| AC-02 | completed | `@radix-ui/react-select` backs `centinel/src/components/Select.tsx`; repository search found no native `<select>` or `</select>` in `centinel/src`. |
| AC-03 | completed | Direct browser inspection confirmed named combobox/listbox semantics, expanded state, selected option, Escape dismissal, visible focus, and a portal-contained menu at 375 px. Shared Select tests cover keyboard selection and disabled state. |
| AC-04 | completed | Rejected directory copy/count strings are absent. Search and filters form one toolbar immediately above the table with no separating rule. |
| AC-05 | completed | Projects renders five rows on page 1, shows `1–5 of 7`, and exposes two-page navigation. Test coverage verifies paging and filter reset. |
| AC-06 | completed | Projects and Recent projects reuse `ProjectSummaryTable`, one typography scale, aligned Project / Latest activity / Current state / action anatomy, and content-driven row height with consistent padding. |
| AC-07 | completed | Action-required items use light-grey headers, semantic icon/context, compact header-right action, and a reason-only body. The 375 px refinement gives long context a readable row without overflow. |
| AC-08 | completed | Recommendation workflow markup and step data were removed. The rendered card shows recommendation title, project-specific summary, pager where applicable, and one CTA in a single white surface. |
| AC-09 | completed | Dashboard retains its Radix activity filter, four-row cap, row/disclosure navigation, and `View more`; descriptions remain omitted. |
| AC-10 | completed | Browser DOM order is Review name → Project → Review instructions → optional scope. No inherited/available source count or list is rendered; source readiness remains a submission constraint. |
| AC-11 | completed | All migrated select call sites compile and the full 65-test frontend suite passes, covering Dashboard, Projects, Review Entry, Dynamic Testing, Findings, Requirements, Settings, and AppShell behavior. |
| AC-12 | completed | `DESIGN.md` now records the neutral-first color ratio, shared Radix select contract, project modal, directory density, neutral action headers, simplified recommendation, and Review-entry order. |
| AC-13 | completed | `pnpm --filter centinel test`: 19 files / 65 tests passed. `pnpm --filter centinel build`: passed. `git diff --check`: no whitespace errors (Windows line-ending notices only). |
| AC-14 | completed | Dashboard inspected at 1440×900, 1200×900, 720×900, and 375×812. Projects, project modal, Review entry, and an open select menu were inspected at 375 px. Every inspected viewport had `scrollWidth === innerWidth`; no clipped actions or menu/modal overflow was observed. |

## Interface-polish coverage

| Category | Evidence inspected | Result |
|---|---|---|
| Typography | Dashboard headings/action context, project-name rows, directory toolbar, Review form | Clear after narrow-header refinement |
| Surfaces | Neutral headers, recommendation surface, directory/table relationship, modal, select menu | Clear |
| Animations | Existing transition declarations and reduced-motion branch; no new repeated/page-load animation | Clear |
| Icons | Lucide controls and semantic action icons; decorative watermark hidden from accessibility tree | Clear |
| Performance | Production bundle and live interaction; no new runtime console warnings/errors | Clear, with the existing Vite large-chunk warning retained |

No actionable interface-polish findings remain in this scope.

## Verification

- `pnpm --filter centinel test` — passed, 19 files / 65 tests.
- `pnpm --filter centinel build` — passed; existing bundle-size advisory only.
- `git diff --check` — passed; Windows line-ending notices only.
- Live browser console — no warnings or errors during the inspected flows.
- Running development services — sidecar `/health` returned `ok`; demo and Vite returned HTTP 200; Centinel desktop process is open.

## Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| Projects title | Render the main title in light grey | It would weaken the page's primary landmark and conflict with the approved black-text hierarchy; the supporting eyebrow is the subdued grey element instead. |
| Action-required mobile header | Keep project context and action on one 375 px line | Long real project names became difficult to scan. The action remains right-aligned in the header but moves to a second header row below 480 px. |
| Recommendation | Keep the three-step explainer for perceived richness | It duplicated an obvious flow and competed with the recommendation and CTA, recreating the cognitive-load problem. |

