# Review Result and Review Activity Design Specification

Status: Ready for implementation  
Requested triage label: `ready-for-agent`  
Date: 10 September 2026

## Problem Statement

Centinel's Review Activity and completed Review Result currently present related review information through different visual hierarchies. The activity view resembles a technical timeline, the result view concentrates several summaries and actions into a separate presentation, and lifecycle actions compete with the page identity in the header. This makes it harder for office reviewers to follow how Centinel reached a result, identify the evidence behind an observation, and add human feedback without losing context.

The current progress payload also stores stage-level `thoughts` without a reliable relationship between an individual activity paragraph and the sources that support it. Presenting those values as exact per-paragraph citations would overstate the available provenance. Review feedback supports text today, but it does not support durable supportive-document attachments. The redesigned interface must represent both limitations honestly until the service contracts exist.

## Solution

Rebuild Review Activity as a calm, conversation-style evidence record and align Review Result with the established Project Detail layout.

Both pages use the exact same outer content width, horizontal gutters, header geometry, and responsive behavior as the Project Overview header container. The page header contains only back navigation, project/review identity, and lifecycle status. It contains no action dropdown or action-button list.

Review Activity places the review objective in a sticky context block at the top of the scrolling body. Supportive documents supplied with the objective appear as source tags directly beneath the objective value. Below it, the activity is presented as an ordered conversation of stages. Each stage contains one or more concise, auditable activity summaries. When precise provenance is available, source tags appear beneath the specific summary they support. The page ends with a bottom-fixed message composer that accepts written feedback and supportive documents without covering conversation content.

Review Result uses the same header/body frame and a compact tabbed body for Overview, Findings, Traceability, and History. Risk Assessment is removed from this page and belongs in the Project Detail experience, where risk from Review and Dynamic Testing can be compared. Findings and traceability use accessible tables with progressive detail. Export remains available as a direct secondary action inside the Result Overview content, not in the header or a dropdown.

The redesign preserves existing review lifecycle behavior, keeps activity-level decisions separate from finding status, and never exposes private chain-of-thought as a product feature.

## User Stories

1. As a reviewer, I want Review Activity to use the same width as the Project Overview header, so that navigation between project and review screens feels consistent.
2. As a reviewer, I want the Review Activity header and body to align exactly, so that the page has one stable reading frame.
3. As a reviewer, I want Review Result to use that same shared width, so that completed and in-progress states feel like one workflow.
4. As a reviewer, I want the page header to contain only identity and status, so that I can understand where I am before considering an action.
5. As a reviewer, I do not want an action dropdown in either page header, so that important actions are visible in the context where they apply.
6. As a reviewer, I want the review objective to remain visible while I scroll through activity, so that I can judge every stage against the original request.
7. As a reviewer, I want the sticky objective to compact when space is limited, so that it preserves context without obscuring the conversation.
8. As a reviewer, I want to expand a compacted objective, so that I can reread the complete request at any time.
9. As a reviewer, I want supportive documents listed beneath the objective, so that I know which documents were deliberately supplied with the review request.
10. As a reviewer, I want long supportive-document names truncated visually, so that tags do not overwhelm the objective block.
11. As a keyboard or assistive-technology user, I want every truncated source name to retain its complete accessible name, so that visual truncation does not remove information.
12. As a reviewer, I want selecting an objective source tag to open its source detail or preview, so that I can inspect the original material without losing my activity position.
13. As a reviewer, I want Review Activity presented in chronological stages, so that I can follow the review from source readiness through completion.
14. As a reviewer, I want every stage to have a clear name and status, so that I can distinguish completed, active, pending, and failed work.
15. As a reviewer, I want stage content written as concise paragraphs, so that I can scan the reasoning without reading raw logs.
16. As a reviewer, I want activity summaries rather than private model chain-of-thought, so that the audit record is useful, safe, and understandable.
17. As a reviewer, I want the sources used for a specific activity summary shown beneath it, so that evidence provenance is easy to verify.
18. As a reviewer, I want source tags to appear only when Centinel can support the exact relationship, so that the interface does not imply false provenance.
19. As a reviewer, I want stage-level source tags when only stage-level provenance exists, so that the interface remains useful without overstating precision.
20. As a reviewer, I want completed stages to reveal additional activity progressively, so that long reviews remain readable.
21. As a reviewer, I want the active stage visible without opening a disclosure, so that I can understand what Centinel is doing now.
22. As a reviewer, I want live updates to avoid pulling me away from content I am reading, so that I remain in control of the scroll position.
23. As a reviewer, I want a visible new-activity affordance when updates arrive above my current scroll position, so that I can choose when to return to the latest event.
24. As a reviewer, I want a fixed feedback composer at the bottom of Review Activity, so that I can respond while keeping the review context visible.
25. As a reviewer, I want the composer to use the same horizontal boundaries as the header and body, so that it feels part of the same workspace.
26. As a reviewer, I want to write multiline feedback, so that I can provide meaningful review direction.
27. As a reviewer, I want to attach supportive documents to my feedback, so that later activity and decisions have the necessary context.
28. As a reviewer, I want attached documents shown as removable tags before sending, so that I can verify and correct my submission.
29. As a reviewer, I want an empty feedback submission prevented, so that accidental blank records are not created.
30. As a reviewer, I want my unsent draft preserved during recoverable errors and in-page navigation, so that I do not lose work.
31. As a keyboard user, I want to reach the objective, activity, source tags, composer, attachments, and send control in a logical order, so that the workflow is fully operable without a pointer.
32. As a reviewer, I want the final conversation item to remain visible above the fixed composer, so that content and focus are never covered.
33. As a reviewer, I want cancellation available only while a review is genuinely cancellable, so that the interface does not offer impossible actions.
34. As a reviewer, I want approval and request-changes controls available only when the review is pending human review, so that decisions cannot be recorded too early.
35. As a reviewer, I want lifecycle decisions presented as direct contextual controls rather than a dropdown list, so that their consequences remain clear.
36. As a reviewer, I want written feedback to remain distinct from approval, request changes, and finding resolution, so that the audit history accurately represents my intent.
37. As a reviewer, I want the Review Result header to match the Project Detail header, so that a completed review remains visibly connected to its project.
38. As a reviewer, I want Review Result organized into Overview, Findings, Traceability, and History, so that I can move from summary to evidence without excessive information on one screen.
39. As a reviewer, I want Risk Assessment removed from Review Result, so that review and dynamic-testing risk can be evaluated together at project level.
40. As a reviewer, I want Overview to lead with the completed scope, evidence limits, and persisted human decision, so that completion is not mistaken for a whole-product pass.
41. As a reviewer, I want only persisted metrics shown on Overview, so that unknown values are not presented as zero.
42. As a reviewer, I want Export report as a direct secondary action in Result Overview, so that it remains discoverable without competing with page navigation.
43. As a reviewer, I want findings presented in a structured table, so that I can compare priority, severity, description, and state efficiently.
44. As a reviewer, I want finding detail revealed progressively, so that the table remains scannable while evidence stays available.
45. As a reviewer, I want finding lifecycle state kept separate from severity, so that impact is not confused with remediation progress.
46. As a reviewer, I want traceability presented in a table only when structured relationships exist, so that derived guesses are not shown as verified mappings.
47. As a reviewer, I want an honest evidence-limited empty state when structured traceability is unavailable, so that I understand the service limitation.
48. As a reviewer, I want system activity and human feedback distinguishable in History, so that the audit trail preserves authorship and intent.
49. As a reviewer, I want the selected Result tab preserved when I return from finding or source detail, so that I can resume where I left off.
50. As a narrow-window user, I want the layout to retain every important action while stacking safely, so that desktop resizing does not block the workflow.
51. As a user at 200% zoom, I want the sticky objective and fixed composer to avoid overlapping content, so that the page remains readable and operable.
52. As a reviewer using reduced motion, I want non-essential transitions removed, so that live activity remains comfortable to follow.
53. As a project stakeholder, I want Review and Dynamic Testing risk summarized together in Project Detail, so that project risk is not fragmented across activity pages.
54. As an auditor, I want feedback, attachments, source relationships, timestamps, and decisions loaded from persisted data, so that the review record remains trustworthy after reload.

## Implementation Decisions

- Use the existing Project Overview header container as the single layout-width contract. Review Activity and Review Result must consume the shared container primitive or shared layout token rather than reimplementing its maximum width and gutters.
- The header and every primary body region align to the same left and right edges at 1440 px, 1200 px, and narrow widths.
- Neither Review Activity nor Review Result renders a header action dropdown or a header action-button list.
- The header retains back navigation, project context, review name, scope metadata when persisted, and one lifecycle status badge.
- Review Activity is the non-completed activity state; Review Result is the completed result state. They retain the current stable route and load through the same screen-level data boundary.
- Review Activity uses a semantic main region containing a sticky objective, an ordered activity conversation, and a fixed composer.
- The objective block sticks below the application title and breadcrumb headers. It never covers those headers and never leaves the shared content container.
- The objective renders the complete persisted objective initially. When it becomes sticky, it may compact to two lines with an explicit expand/collapse control. At narrow widths it may compact to one line.
- Objective source tags represent only supportive documents attached to the review objective. They must not include inherited project sources unless those sources were explicitly selected as supportive documents.
- Activity source tags represent evidence used for a stage or an individual activity summary. Objective and activity tags use the same visual primitive but distinct accessible group labels.
- Source tags use neutral text, a light-grey surface, a subtle border, and the shared compact radius. Green is reserved for focus, selection, and success rather than general tag decoration.
- Source names longer than 15 displayed characters are truncated with an ellipsis. The full name remains available to assistive technology and through pointer hover or keyboard focus.
- Selecting a source tag opens the existing source detail or preview experience. Returning restores the activity route and previous scroll position.
- Review Activity stages are rendered as an ordered list. Each stage has a heading, text status, semantic status icon, optional persisted timestamp, and one or more activity-summary paragraphs.
- Replace user-facing references to `thoughts` or reasoning chains with **Activity details** or **Activity summary**. The product does not expose private chain-of-thought.
- Existing legacy `thoughts[]` remain readable through a compatibility adapter, but they are treated as unstructured stage activity and are not assigned fabricated source relationships.
- Add a structured, backward-compatible progress-event contract that can associate a safe activity summary with zero or more persisted source references. New structured events coexist with legacy progress records.
- When only stage-level evidence is available, render one source-tag group at the end of the stage. Per-paragraph tags render only when the relationship is persisted explicitly.
- Completed stages show a concise default amount of content and expose remaining items through a named disclosure. The active and failed stages remain expanded enough to communicate current state and recovery information.
- Only the latest active update is announced through a polite live region. Historical items are not repeatedly announced during polling.
- Incoming updates auto-scroll only when the user is already near the end of the conversation. Otherwise a visible **New activity** control moves focus and scroll position to the latest item on request.
- The bottom composer is fixed to the bottom of the Review Activity scrolling viewport and constrained to the same width as the shared header/body container. It does not span beneath the sidebar.
- The conversation reserves composer height through bottom padding and scroll padding. Focused elements and the final conversation item must remain completely visible.
- The composer contains a persistent feedback label, a multiline text input, an attachment control, an attached-document list, submission status, and a direct Send feedback action.
- The composer accepts feedback text, supportive documents, or both. Send is disabled only when both are empty, while an upload is in an invalid state, or while the current submission is pending.
- Supported attachment rules reuse the application's source validation and preview capabilities. Invalid type, inaccessible file, size rejection, and upload failure are shown beside the affected attachment without clearing the written draft.
- Feedback attachments are persisted as review-scoped supportive documents with stable identifiers and provenance. They are not silently added to project sources.
- Sending feedback creates a human-authored history event. It does not approve the review, request changes, resolve findings, or trigger reprocessing unless a separately supported action explicitly does so.
- Review cancellation, approval, and request changes remain state-gated direct controls. They may be placed adjacent to the composer or in a clearly separated decision region, but they must not be folded into the feedback send action or a dropdown.
- Request changes retains its required rationale contract. Approval follows the current supported decision contract unless the service requirement is changed separately.
- Review Result contains four tabs: Overview, Findings, Traceability, and History. Risk Assessment is not a Review Result tab.
- Risk moves to Project Detail as a shared project-level view that can aggregate persisted Review and Dynamic Testing data without inventing cross-module scores.
- Result tabs use `tablist`, `tab`, and `tabpanel` semantics, support arrow/Home/End keys, and preserve the selected tab during meaningful return navigation.
- Result Overview presents scope, evidence limitations, available finding totals, severity distribution when known, and the current persisted review decision. Unknown values are omitted rather than rendered as zero.
- Export report is a direct secondary action in the Overview section heading. Export loading preserves control width and prevents repeated submission. Success and failure feedback appears near the action.
- Findings use the established shared findings table and detail pattern. Default order remains severity followed by recency unless the user changes it.
- Finding status is independent from severity and activity-level decision. Approval of a review does not resolve its findings.
- Traceability renders structured requirement-to-source relationships only when the service supplies them. Otherwise it renders a concise evidence-limited state and does not manufacture relationships from finding text.
- History uses one chronological record with a clear actor/type distinction or an equivalent system/human filter. Human feedback and attachments remain visually distinct from Centinel activity.
- Use the Centinel design tokens, Plus Jakarta Sans, JetBrains Mono only for technical identifiers, Lucide icons, 4 px spacing rhythm, shared radii, and restrained borders. Avoid nested cards, bento presentation, gradients, glows, and decorative motion.
- Preserve the current API and persisted-session compatibility while introducing structured events and attachments through additive fields or endpoints.
- The existing frontend view-model adapter remains the normalization boundary for lifecycle state, legacy progress, unknown values, decisions, and capability flags.
- Any unsupported feature is omitted or labelled unavailable. Production UI must not simulate source provenance, traceability, attachment persistence, or project-level risk.

## Testing Decisions

- Tests assert externally observable behavior, accessible roles and names, persisted API interactions, state gating, and restored navigation context. They do not assert component internals, CSS class names, implementation-specific state hooks, or pixel coordinates.
- Use the Review Activity screen as the primary and highest test seam. It already loads project, session, findings, and decisions and renders both activity and result states, allowing most workflow behavior to be verified through one public boundary.
- Extend the existing screen test prior art for API mocking, activity lifecycle states, decision gating, result tabs, keyboard tab navigation, and export behavior.
- Keep a focused conversation component test only for behavior that is cumbersome through the screen seam: progressive stage disclosure, exact source-tag association, legacy stage-level fallback, live-update announcement, and the opt-in jump to new activity.
- Keep a focused sticky-context test for objective expansion, objective supportive-document tags, complete accessible source names, preview navigation, and empty objective-document state.
- Keep a focused composer test for text-only feedback, attachment-only feedback, combined feedback, invalid attachments, removal, duplicate-send prevention, draft preservation, keyboard submission behavior, and success/error announcements.
- Add sidecar contract tests for structured progress events. Verify stable order, safe activity summaries, exact source identifiers, timestamps, backward compatibility, and absence of raw prompts, secrets, credentials, or private chain-of-thought.
- Add sidecar contract tests for review feedback attachments. Verify review/session ownership, persisted file metadata, accessible storage, deletion/cleanup rules, reload behavior, and non-promotion to project sources.
- Verify that legacy `thoughts[]` sessions still render and that the UI does not fabricate per-item citations for them.
- Verify that source tags longer than 15 displayed characters truncate visually while retaining the full accessible name and keyboard-accessible disclosure.
- Verify that selecting a source tag opens the correct source detail and returning restores the activity scroll position.
- Verify that the objective remains below the application headers and that the final activity item remains above the composer at the required viewports and at 200% zoom.
- Verify that incoming polling updates do not change scroll position when the user is reading earlier activity and that **New activity** moves to the latest event only when activated.
- Verify queued, running, pending-review, blocked, failed, cancelled, and completed lifecycle states using persisted data.
- Verify cancellation is available only for cancellable states and approval/request changes only for Pending to Review.
- Verify ordinary feedback submission cannot change the review decision or any finding status.
- Verify that neither screen exposes an action dropdown or header action-button list.
- Verify Review Result exposes exactly Overview, Findings, Traceability, and History with accessible tab behavior.
- Verify Risk Assessment is absent from Review Result and that Project Detail shows risk only from real Review and Dynamic Testing data.
- Verify Result Overview omits unknown metrics and does not describe completion as a whole-product pass.
- Verify findings retain separate severity and lifecycle state and that approving a review leaves finding states unchanged.
- Verify Traceability renders data-backed relationships when available and an evidence-limited state when not.
- Verify export loading, success, failure, repeat prevention, and consistency between exported and displayed persisted scope.
- Perform visual QA at 1440×900, 1200×900, and a narrow viewport, plus 200% zoom. Confirm exact shared container alignment, stable sticky/fixed regions, no horizontal overflow, visible focus, 40 px desktop targets, 44 px narrow targets, and no style leakage into Project Detail or Dynamic Testing.
- Run the focused frontend suites while iterating, then the complete frontend test suite and frontend production build. Run sidecar tests when structured event or attachment contracts are implemented.

## Out of Scope

- Exposing raw model prompts, responses, tokens, hidden chain-of-thought, or unfiltered diagnostic logs in the activity conversation.
- Fabricating per-paragraph citations from existing stage-level `thoughts[]`.
- Automatically adding feedback attachments to the project's reusable Source inventory.
- Automatically rerunning or reprocessing a review after feedback or request changes.
- Treating an activity-level approval as resolution, dismissal, or acceptance of individual findings.
- Replacing the established source preview/detail experience.
- Creating project-level risk scores when the service does not persist comparable Review and Dynamic Testing risk data.
- Redesigning Review Entry, Project Overview, Project Findings, Source, Collaborations, or Settings beyond the shared primitives needed by these two pages.
- Changing the underlying review engine, finding-detection logic, or report format beyond fields required to represent persisted feedback, source provenance, and the approved screen content honestly.
- Collaborative editing, threaded replies, mentions, presence, or external notifications for review feedback.
- Mobile-native layouts; narrow desktop behavior remains required.

## Further Notes

- This specification intentionally supersedes the older Review UI amendment where it conflicts on Result header actions, the five-tab Result structure, and the placement of Risk Assessment. The latest approved design removes header actions/dropdowns, uses four Result tabs, and moves risk to Project Detail.
- The primary testing seam is the public Review Activity screen because it already owns both activity and completed-result presentation. Three narrow component seams are justified for sticky positioning/context, conversation behavior, and the fixed feedback composer.
- The current tracker is GitHub at `kongjiyu/centinel`, but the local environment does not provide an authenticated issue-publishing client. This document is ready to publish as one issue with the `ready-for-agent` label after outbound publication is authorized and tooling is available.
- Before implementation, update the authoritative design amendment so its Review workflow language matches this approved specification and no longer directs agents toward the superseded header actions, Risk Assessment tab, or raw stage-thought presentation.
