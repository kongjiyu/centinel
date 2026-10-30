# Review Workflow and Approval Evidence Specification

Status: ready for implementation  
Date: 10 September 2026  
Scope: Review entry, Review activity, approval, Review result, and the Project workspace surfaces that summarize those states

## Problem Statement

Centinel currently treats a technically successful automated run as ready for a human decision, but its **Pending to Review** screen exposes the reasoning conversation and objective without an equivalent way to inspect the review's findings, severity, priority, location, evidence, recommendation, or traceability. The reviewer is therefore asked to approve or request changes without the decision evidence the product says they are approving.

The same workflow is represented differently across the application. A persisted `success` session can appear as **Completed** in Project Recent activity even when no reviewer has approved it, while the Review screen calls it **Pending to Review**. Failure and blocked states exist in frontend and service code with different type definitions. Review configuration such as selected directories is collected by the UI but is not enforced as a structured service contract. Changed-file scope can fall back to a full review without making that scope substitution prominent. These mismatches weaken auditability and can produce a materially misleading approval.

The current presentation also duplicates information and increases cognitive load:

- the Review Activity header repeats scope and explanatory text that is also represented in the objective and configuration;
- the activity surface repeats a Centinel actor, stage status, checkpoint icon, progress line, timestamp, summary, and raw activity paragraph for every stage;
- the pending screen repeats human decision history before the decision is made, yet omits the findings required to make it;
- the Review Result uses a second, reduced findings table instead of the established Project Findings interaction;
- result tabs sit inside an additional completion card instead of forming stable page navigation below the header;
- Review Result repeats scope and completion language in the header, completion banner, overview, and decision rail;
- Project Overview presents Risk assessment even though risk is a separate evidence domain shared by Review and Dynamic Testing;
- History separates system and human records without preserving a single chronological handoff sequence.

The supplied screenshots are evidence of these current-state problems, not product instructions. They show the full-width objective, timeline decorations, repeated labels, oversized feedback composer, and the absence of approval evidence navigation.

## Solution

Adopt one explicit Review lifecycle and one evidence-led approval workspace.

`queued` and `running` reviews remain Review Activity. A technically successful review without an approval decision becomes **Need Approval**. In that state the header-level tabs expose **Activity**, **Findings**, and **Traceability** before the decision controls. The Findings tab reuses the same scoped findings presentation and finding actions as Project Findings. Traceability renders real persisted relationships when available and an honest unavailable state otherwise. Approval and request-changes controls remain disabled while required evidence is loading or failed, with an explanation and Retry action. A reviewer must never be asked to decide from model reasoning alone.

Only an approved review becomes a Review Result. Its tabs are directly below the common page header: **Overview**, **Findings**, **Traceability**, and **History**. The Overview uses an 8/4 evidence-and-decision layout. Findings reuses the shared findings workspace, scoped to the current review. History shows the complete activity conversation on the left and human feedback/decisions on the right while preserving chronological timestamps.

Review Activity becomes a calm conversation workspace. The main activity and objective use an 8/4 layout. Each stage shows a stage name followed by readable activity paragraphs and compact source tags, without timeline rails, checkpoint ornaments, actor repetition, or per-stage status badges. Failed stage payload text is not echoed as a conversation message; a single page-level failure message retains the failure and recovery state. The objective is a concise side panel with an accessible expand control and a scrollable centered dialog for long content.

The feedback composer is compact, centered, fixed to the bottom of the Review content rail, and limited to 45% of the available content width on desktop. It uses icon-only attach and submit controls with accessible names and tooltips. While a review is running the user may stop it but cannot submit feedback. Once automated reasoning has stopped, completed, failed, or been cancelled, feedback can be submitted and is appended as a human message in the activity history. A later automated continuation must only appear if the service actually executes another review iteration; the UI must not fabricate one.

Project navigation becomes **Overview, Assessment, Findings, Source, Collaborators, Settings**. Assessment owns shared Review and Dynamic Testing risk information. Project Recent activity derives a user-facing state from both the technical session status and the review decision: **Queued, In progress, Need Approval, Completed, Cancelled**, plus **Needs attention** for failures or blocked work so operational failures are never hidden.

A deterministic mock project, review, and findings dataset is added at the test/development seam. It is clearly identified as mock data and cannot silently appear as production operational data.

## User Stories

1. As a reviewer, I want to inspect findings before approving a review, so that my decision is based on the reported evidence.
2. As a reviewer, I want to see finding priority and severity together, so that I can evaluate both urgency and impact.
3. As a reviewer, I want to inspect a finding's description, source, location, recommendation, and evidence, so that I understand what the system is asking me to accept.
4. As a reviewer, I want finding status to remain separate from the review decision, so that approving a review does not falsely resolve its findings.
5. As a reviewer, I want to inspect traceability before approval, so that I can verify whether requirements are connected to implementation evidence.
6. As a reviewer, I want an honest unavailable state when structured traceability is not persisted, so that absence is not mistaken for successful traceability.
7. As a reviewer, I want approval controls blocked when findings or traceability evidence fails to load, so that I cannot accidentally approve an incomplete view.
8. As a reviewer, I want a Retry action when approval evidence fails to load, so that a transient service error does not force me to leave the workflow.
9. As a reviewer, I want a clear **Need Approval** state, so that technical completion is not confused with human approval.
10. As a reviewer, I want request-changes to remain available after inspecting evidence, so that I can return a review with an auditable explanation.
11. As a reviewer, I want approval and request-changes to be recorded at review level, so that they do not mutate individual findings.
12. As a reviewer, I want the Review Result to appear only after approval, so that “result” consistently means a completed human-reviewed outcome.
13. As a reviewer, I want result tabs directly below the header, so that navigation is stable and consistent with Project Detail.
14. As a reviewer, I want the result Overview to lead with a concise summary and only three decision-useful metrics, so that I am not overloaded by repeated counts.
15. As a reviewer, I want the metrics to show total reported findings, critical severity, and high priority, so that the most consequential review signals are immediately visible.
16. As a reviewer, I want the decision rail to show the assigned reviewer, review type or pull-request identifier, completion time, and duration, so that the result is auditable.
17. As a reviewer, I want Review Result Findings to behave like Project Findings, so that filtering, selecting, reviewing, resolving, and dismissing findings work consistently.
18. As a reviewer, I want History to preserve automated stages and human messages, so that I can reconstruct how the review evolved.
19. As a reviewer, I want human feedback visually distinct from automated activity, so that authorship remains clear.
20. As a reviewer, I want human feedback ordered by timestamp with the activity it follows, so that the audit trail preserves causality.
21. As a reviewer, I want attached supportive documents represented as compact source tags, so that I can identify the material used without reading long filenames.
22. As a reviewer, I want source tags to expose the complete name through accessible text and a tooltip, so that truncation does not lose identity.
23. As a reviewer, I want an expanded objective dialog for long objectives, so that I can read the full instructions without widening the conversation column.
24. As a keyboard user, I want the objective dialog to trap focus, close with Escape, and restore focus, so that the disclosure is fully operable.
25. As a reviewer, I want the compact objective to show roughly seven or eight readable lines, so that it remains useful without dominating the activity.
26. As a reviewer, I want the objective panel to leave the activity column visible while I scroll, so that I can compare reasoning with the stated goal.
27. As a reviewer, I want stage names and activity paragraphs without repeated Centinel labels and timeline ornament, so that the conversation is easier to scan.
28. As a reviewer, I want raw failed-stage text omitted from the conversation, so that internal fetch noise does not masquerade as reasoning.
29. As a reviewer, I want one clear page-level failure or blocked message, so that failures remain visible and recoverable.
30. As a reviewer, I want only the stop action while reasoning is running, so that I cannot send feedback into a workflow that does not yet support mid-run iteration.
31. As a reviewer, I want the feedback composer enabled only after automated reasoning stops, so that the interface matches the service's actual sequencing.
32. As a reviewer, I want feedback appended inside the conversation, so that I can see exactly where human input entered the process.
33. As a reviewer, I want later automated reasoning below my message only when a real subsequent iteration occurs, so that the audit trail does not imply work that never ran.
34. As a reviewer, I want a compact fixed composer with an arrow-up submit icon, so that feedback remains reachable without covering the activity.
35. As a reviewer, I want the composer textarea non-resizable, so that it cannot obscure the evidence workspace.
36. As a reviewer, I want attachment and submit icon buttons to have accessible names and tooltips, so that compact controls remain understandable.
37. As a project member, I want Assessment separated from Overview, so that shared Review and Dynamic Testing risk information has one stable home.
38. As a project member, I want the project tab labelled Collaborators, so that the navigation names the people rather than the abstract collaboration activity.
39. As a project member, I want Project Recent activity to derive **Need Approval** from a successful review with no approval decision, so that I can find work awaiting me.
40. As a project member, I want failed or blocked work to remain visibly **Needs attention**, so that a narrowed vocabulary does not hide operational failures.
41. As a project member, I want approved reviews to appear as **Completed**, so that project summaries agree with Review Result.
42. As a project member, I want the same derived status in Project Detail, Projects, and Dashboard, so that navigation does not change the meaning of a review.
43. As a project member, I want search and state filtering to use the displayed lifecycle labels, so that filtering matches what I see.
44. As a product tester, I want a deterministic mock project with a pending review and representative findings, so that the approval workflow can be verified without depending on external AI services.
45. As a product tester, I want the mock fixture isolated from production data, so that screenshots and tests cannot be mistaken for live customer results.
46. As a product owner, I want review scope preserved as structured data, so that an approval accurately names what was reviewed.
47. As a product owner, I want a changed-file fallback to full scope to be explicit and decision-blocking, so that reviewers do not approve a misrepresented scope.
48. As a product owner, I want selected directories transmitted and enforced by the service, so that UI scope choices have operational meaning.
49. As a product owner, I want frontend and sidecar session-status contracts aligned, so that blocked and failed states cannot be lost at the API boundary.
50. As a product owner, I want model reasoning summarized into safe activity records, so that private chain-of-thought or sensitive prompts are not exposed as product evidence.

## Implementation Decisions

- Use the Review Activity screen as the highest workflow seam. It owns the derived lifecycle, header tabs, evidence loading, decision gate, activity/objective layout, and transition to Review Result.
- Introduce one shared lifecycle mapper consumed by Review Activity, Project Recent activity, Dashboard summaries, and Projects summaries. The mapper combines technical session status and the latest non-comment decision.
- Map queued to **Queued**, running to **In progress**, success without a decision to **Need Approval**, success with `approved` to **Completed**, success with `changes_requested` to **Need Approval** with the decision visibly identified, cancelled to **Cancelled**, and failure/blocked to **Needs attention**. Do not discard failure states merely because the requested happy-path vocabulary omitted them.
- Treat **Need Approval** as a review workspace, not a completed result. Its tab set is **Activity, Findings, Traceability**. Put the tabs below the common header and above the 8/4 workspace.
- Keep decision actions near the approval evidence. Approve and Request changes are enabled only when the session is technically successful, no terminal approval exists, and the current findings request has loaded successfully. If structured traceability is unavailable by contract, the honest unavailable state is acceptable; if the request itself fails, decisions remain disabled until Retry succeeds.
- Reuse the shared findings implementation by extending it with an optional review/session scope and controlled data support. Do not maintain a separate Review Result findings table.
- Preserve finding actions and the three-state user-facing finding lifecycle: **Unresolved, Resolved, Dismissed**.
- Add a traceability adapter that consumes persisted relationship data if available. Until the sidecar exposes structured relationships, render a concise unavailable state and do not infer “no traceability issues” from an empty result.
- Move result tabs out of the nested completion surface and into the header-adjacent navigation region.
- Build Review Result Overview as an 8/4 layout. The left side contains Review Overview status, Summary, and only total findings, critical-severity count, and high-priority count. The right side contains Decision, assigned reviewer, structured review scope, completion time, and duration.
- Derive duration from persisted start/end timestamps. Show **Not supplied** if either timestamp is absent or invalid; never invent a duration.
- Present pull-request scope using the persisted review mode and pull-request identifier. Otherwise show the structured review type. Do not repeat scope in the page header.
- Move Risk assessment from Project Overview into a new Assessment tab and treat it as a shared Review/Dynamic Testing domain. Preserve its explicit unavailable state until risk dimensions are persisted.
- Set Project tabs in this order: **Overview, Assessment, Findings, Source, Collaborators, Settings**.
- Simplify Review Activity stages to semantic headings and paragraphs. Remove the visual timeline, checkpoint/connector elements, repeated actor label, per-stage badge, and repeated timestamps. Retain a polite live announcement for the active stage without adding visible duplicate text.
- Filter failed internal activity strings from the conversation. Preserve one page-level failure/blocked/cancelled state with the actionable reason when available.
- Stop rendering raw model `thoughts[]` as final product reasoning once a safe activity-event contract exists. In Phase 1, sanitize and label existing summaries as activity details. In Phase 2, add a structured event contract containing a safe summary, evidence references, provenance, author, and timestamp.
- Place the activity surface and objective panel in an 8/4 desktop grid. At narrow widths they stack with activity first and objective second.
- Clamp the objective panel to approximately eight lines and use an icon-only expand button with an accessible name and tooltip. Open the full objective in the shared Modal primitive with a readable maximum line length and internal scrolling. Do not implement an opaque scroll animation that can strand focus; a sticky panel may compact and then leave view using opacity/transform only, with reduced-motion support.
- Render the compact feedback composer fixed to the bottom of the page-content rail, centered at 45% width on desktop and near-full-width on narrow screens. Reserve matching bottom padding so it does not cover the final messages.
- Make attachment and send controls icon-only visually, with accessible names, tooltips, and at least 40×40 px hit targets. Use `ArrowUp` for submit. Disable textarea resizing.
- Disable feedback submission while the session is queued or running. The only workflow action during that period is Stop/Cancel review.
- Append comment decisions to the chronological activity presentation as human messages. The existing API records comments; a real continuation/re-run endpoint is required before the UI can show subsequent automated reasoning.
- Gate Review Result on an approved decision. A technically successful session remains **Need Approval**. A requested-changes decision remains in the approval workspace.
- Create one deterministic fixture at the frontend/sidecar test seam containing a clearly named mock project, a successful unapproved review, a critical/high-priority finding, a lower-severity finding, source references, and representative activity stages. Production screens must not seed or display this data automatically.
- Preserve existing data and migration compatibility. Any service contract extension must tolerate historical sessions without the new fields.

## Testing Decisions

- Test external behavior through the existing screen-level React tests and sidecar HTTP/API tests. Do not assert implementation-only class names or internal hook calls when a role, label, state, or request payload can be observed instead.
- Use Review Activity as the primary frontend seam. Cover queued/running, Need Approval, evidence-loading failure, approved, changes requested, failed, and cancelled states.
- Verify that queued/running screens expose Stop and disable or omit feedback and review-decision submission.
- Verify that Need Approval exposes Activity, Findings, and Traceability tabs before decision actions.
- Verify that approval is unavailable until findings load and remains unavailable after a load failure; Retry restores it after a successful reload.
- Verify that a reviewer can open a finding, inspect priority, severity, location, description, recommendation, and evidence, then resolve or dismiss it through the shared findings contract.
- Verify that approval does not mutate finding status.
- Verify that an approved review exposes Overview, Findings, Traceability, and History and that a success session without approval does not render Review Result.
- Verify that Result Overview reports total findings, critical severity, and high priority only; verify review type/PR scope, reviewer, completion time, and duration use persisted data or honest fallback values.
- Verify that Activity stages expose stage names and safe paragraphs without Centinel actor repetition, visible status badges, checkpoint controls, candidate-count copy, or raw fetch-failed text.
- Verify the objective is clamped in the side panel, opens in an accessible dialog, closes with Escape, and restores focus.
- Verify the composer is disabled or absent while running, accepts feedback and supported attachments after reasoning ends, and appends the resulting human message after reload.
- Verify Project navigation order and labels, and that Risk assessment appears only under Assessment.
- Verify Project Recent activity and project-summary derivation for Queued, In progress, Need Approval, Completed, Cancelled, and Needs attention.
- Add a sidecar API test rejecting `commented` feedback for queued/running sessions and accepting it once reasoning has stopped.
- Add a contract test for scope mode and selected-directory persistence/enforcement. If Phase 1 does not add the service support, retain a failing/pending specification test rather than claiming the behavior works.
- Use the deterministic mock fixture in tests for one pending approval and multiple findings; verify no production bootstrap path imports it.
- Run targeted frontend tests for Review Activity, Project Detail, Findings, Dashboard/Projects status summaries, and Review Entry.
- Run the complete frontend test suite and `pnpm --filter centinel build` after targeted tests pass.
- Run sidecar review-decision and static-session tests plus sidecar TypeScript validation. Report unrelated baseline failures separately; do not relabel them as regressions.
- Visually verify at 1440×900, 1200×900, and a narrow viewport. Confirm the composer does not cover content, tabs remain reachable, the objective dialog is keyboard-operable, and styles do not leak.

## Out of Scope

- Generating fake risk scores, traceability relationships, reviewer identities, durations, or readiness data for production.
- Treating review approval as acceptance, resolution, or dismissal of individual findings.
- Automatically re-running AI reasoning after feedback without a real service endpoint and persisted iteration model.
- Replacing the AI provider or changing the review-analysis algorithm.
- Adding multi-user authentication, durable roles, or a full collaboration backend.
- Migrating old sessions destructively. Historical records without new structured fields remain readable with explicit fallback labels.
- Publishing a product report from an unapproved review.

## Further Notes

### Formal workflow inspection

1. **Entry:** The UI collects review mode, objective, supportive documents, reviewer, and advanced scope. The service persists review mode/reviewer/documents but currently collapses the operational review type and does not enforce selected directories as a first-class scope. This is a high-integrity mismatch.
2. **Execution:** The service moves queued → running → success/failure and writes progress stages. The UI renders raw `thoughts[]`, which risks exposing internal model reasoning and duplicates stage summary/status. Product-safe activity summaries should replace raw reasoning.
3. **Pending approval:** A success session without an approval becomes Pending to Review, but only the activity conversation is visible. This is the critical decision-evidence gap and must be fixed before treating approval as trustworthy.
4. **Decision:** The service allows approval/request changes after technical success and allows comments during a running review. The latter conflicts with the requested sequential feedback model and must be gated server-side, not only hidden in the UI.
5. **Result:** Approval produces the completed result. The existing result has a reduced findings table and permanently unavailable traceability; these diverge from the shared-evidence requirement.
6. **Project roll-up:** Project Recent activity uses raw technical status, while other summary logic partly uses decisions. The same review can therefore be Completed, Review required, or Pending to Review depending on the screen.
7. **Risk:** The current risk card is in Overview and is unavailable placeholder content. Moving it to Assessment improves information architecture but does not create risk data; the unavailable state must remain honest.

### Delivery plan

**Phase 1 — evidence-led workflow and page architecture**

- implement shared lifecycle derivation and Project Recent activity mapping;
- add Project Assessment tab, move Risk assessment, rename Collaborators, and reorder tabs;
- restructure Review Activity header, 8/4 activity/objective workspace, simplified stages, objective dialog, and compact gated composer;
- add Need Approval tabs with inspectable session findings and traceability state before decisions;
- restructure Review Result header tabs and overview; reuse shared findings presentation;
- add deterministic mock fixtures and primary frontend tests;
- run targeted tests and the frontend build.

**Phase 2 — residual integrity and service-contract work**

- correct any Phase 1 defects found by independent review and viewport verification;
- align frontend and sidecar lifecycle/status contracts;
- gate running feedback in the sidecar;
- persist and enforce structured review scope, including selected directories and honest changed-file fallback behavior;
- add a safe structured activity-event/provenance contract and stop exposing raw model thoughts;
- improve chronological History and structured traceability consumption where service data exists;
- run broader frontend/sidecar validation and document remaining baseline failures.

### Approval invariant

A review decision is valid only when the reviewer can identify the exact review scope and inspect all available findings and traceability evidence. Technical completion is necessary but not sufficient. If required evidence cannot be loaded or scope was silently widened, approval must be blocked and the reason must be visible.

### Red-team findings and mitigations

| Risk | Severity | Required mitigation |
|---|---|---|
| Execution `success` is shown as Completed before approval | Critical | Derive every user-facing state from execution plus decision through one shared mapper. |
| Approval has no inspectable evidence packet | Critical | Expose session-scoped Findings and Traceability in Need Approval and gate decisions on successful evidence loading. |
| Static cancellation only changes the database while the worker continues | Critical | Add cooperative abort and compare-and-set terminal writes so cancelled work cannot later become success/failure. |
| Request changes is a dead end because a current decision disables later decisions | High | Model changes requested as a nonterminal revision; provide an explicit re-run/reopen transition before a later approval. |
| Multiple direct decision posts can replace a terminal verdict | High | Enforce an allowed transition table with expected version/idempotency; require a named Reopen event after approval. |
| Configured reviewer is displayed as though they authored the decision | High | Persist the actual local/authenticated actor on each decision; never infer the author from assignment. |
| Traceability mappings are returned by the model but discarded | High | Persist session-scoped normalized mappings with source/requirement IDs, evidence, confidence, and snapshot identity. |
| Risk level overwrites severity; priority and risk are not separate persisted fields | High | Persist severity, priority, risk score/level/factors, confidence, and model version independently. |
| Assessment could look complete while both modules lack comparable data | High | Show Review and Dynamic Testing independently with coverage and unavailable states; do not calculate a composite score yet. |
| Feedback is stored separately and cannot cause AI continuation | High | Use an append-only sequenced review-event stream and implement a real pause/feedback/resume endpoint before showing continuation. |
| Running feedback is currently accepted | High | Gate comments in both the UI and sidecar to non-running states unless a true pause state exists. |
| Raw model `thoughts` are requested, logged, stored, and displayed | High | Replace them with constrained activity summaries and evidence references; redact existing logs and never request chain-of-thought. |
| Invalid Git refs silently widen to full-project scope while refs remain displayed | High | Persist scope-resolution status and immutable resolved refs; block or require explicit acceptance before a full-scope fallback. |
| Approval is not bound to an immutable evidence snapshot | High | Create a snapshot at execution completion; decisions reference snapshot ID, version, and decision-time counts. |
| Supportive-document tags can refer to deleted temporary files | High | Keep a review-scoped retrievable copy or immutable content hash and make tags open the exact reviewed content. |
| Suggested tests are generated before human approval | Medium-high | Generate after approval, or label as unapproved drafts and invalidate them after request changes. |
| Pending approval is not considered active, so a second review can start | Medium-high | Define one-open-review policy per project including Need Approval and Changes requested, or explicitly allow parallel versions. |
| Removing all stage states could hide a stalled or failed run | High | Remove repeated visual badges but retain one visible page state and accessible live progress/failure announcements. |
| Mock data could pollute local production evidence | Medium | Keep deterministic fixtures behind test/dev-only boundaries with stable IDs and no automatic user-database seeding. |

The design remains viable after these mitigations. Its strongest elements are the 8/4 activity/objective composition, a dedicated Assessment destination, a shared findings workspace, compact evidence tags, and the separation of finding adjudication from the review-level decision.
