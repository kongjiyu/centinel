# Centinel Review UI implementation plan

## Scope and authority

Implement the agreed conversation design in the React frontend only. The September 2026 requirements supersede the older navigation/workflow descriptions in DESIGN.md; its visual tokens, accessibility, and component rules still apply. No sidecar, Rust, database, provider, authentication, authorization, or persisted lifecycle changes. Preserve existing working-tree changes and existing API contracts.

Reference: `centinel-agreed-requirements.md` and `centinel-review-workspace.html` in the thread visualization directory. Prototype records are examples, never production data.

## Execution lanes

1. **Project workspace — Luna / Max.** Own ProjectDetailScreen, project-specific new components/CSS/tests. Replace project section navigation with Overview, Source, Findings, Collaborations, Settings. Overview has Review/Dynamic Testing entry actions and combined persisted activity with search/type/date-time filtering. Open running review activity in progress and finished processing in activity detail. Preserve existing source and dynamic behavior. Collaborations/settings features without APIs must state availability rather than simulate success.
2. **Review presentation — Luna / Max.** Own StaticReviewForm, ReviewModal, ActiveSessionComplete, ReviewProgressView, ReviewDecisionBar, and new review presentation components/CSS/tests. Remove visible review-type selector without breaking the existing start payload. Keep inherited sources and snapshot context. Separate progress log from results. Results show header decision controls and Overview, Findings, Traceability, Risk Assessment, History. Rejection rationale supports finding mentions and existing callbacks. Use truthful backend state mappings; unsupported same-activity refinement, governance and risk persistence remain integration gaps.
3. **Home and global navigation — Luna / Max.** Own AppShell, DashboardScreen and its CSS/tests. Navigation labels Home, Projects, Review, Dynamic Testing, Settings; preserve existing route identifiers. Home retains attention highlights and Recommendations carousel, uses real recent projects with last activity metadata, and flags available service/configuration errors. No invented metrics or fake connections.
4. **Integration — parent.** Own App.tsx, shared types/components only when required, DESIGN.md amendment, plan tracking. Ensure new project creation opens its project; reconcile lane contracts, run complete frontend checks, inspect responsive screens, report unsupported capabilities.

## Cross-lane contract

- Retain current `Screen` names and `initialAction: 'static' | 'dynamic'` internal contracts unless parent coordinates a change. User-facing label is Review.
- ProjectDetail continues importing ReviewModal and ActiveSessionComplete through their current prop interfaces. Review lane preserves those exports/props or sends an explicit integration request.
- Each lane owns narrowly scoped CSS; no parallel edits to App.css, workspace.css, types.ts, api/client.ts, or shared CommandUI.
- UI callbacks use existing endpoints only. Do not label request_changes as same-activity refinement if the API does not implement it. Do not infer durable role authority or source currency from absent fields.
- UI-only capability boundaries use explanatory empty/disabled states; do not add sample people, findings, logs, requirements, readiness, or counts to production screens.

## Acceptance criteria

- [x] Global user-facing terminology uses Review and correct navigation.
- [x] Home shows real recent projects and actionable recommendations/configuration issues.
- [x] Project tabs and recent activity filters follow the agreed information architecture.
- [x] Create project routes to the created project.
- [x] Review entry omits review type and preserves required backend payload fields.
- [x] Progress is a read-only stage/activity log without approval controls.
- [x] Results have activity-level decisions and five result tabs; history preserves available system/human events.
- [x] Required rejection feedback and finding mention selection work with keyboard input.
- [x] Severity/priority and source currency reminders are shown without inventing unsupported persistence; roles and iterations remain documented gaps.
- [x] Existing API behavior, source import, dynamic navigation and user edits remain intact.
- [x] `pnpm --filter centinel build` and relevant/full frontend tests pass.
- [ ] Visual checks at 1440×900, 1200×900 and narrow viewport; no unrelated style leakage.

## Deferred service work (not part of this execution)

Durable collaborative roles/invitations and concurrency arbitration; incoming source version/currency metadata and immutable baselines; configurable independent priority storage; same-activity refinement iterations and snapshot-linked mentions; service-block Retry orchestration; replacement-review links and state transitions. Frontend should accept future real fields through deliberate adapters, not invent backend support.

## Run status

Plan written; three independent Luna/Max lanes were dispatched. The project lane returned a usage-limit error, and no subagents remained running at the status check. No delegated implementation changes were verified; the parent completed the work in the shared checkout.

Parent implementation now includes project creation routing and entry layout, the five project tabs with activity filters, source connector availability states and currency reminder, the Review activity progress/result/history presentation, Review decision and finding-mention flow, Home Recommendations carousel, recent-project cards, and Review terminology across the migrated surfaces. Current verification: the full frontend test suite passes 12 files / 44 tests and the production build passes. Visual viewport verification remains outstanding. Deferred service work above is still not simulated by the UI.
