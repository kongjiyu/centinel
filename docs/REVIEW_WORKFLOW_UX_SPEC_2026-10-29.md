# Review workflow UX specification

Status: implemented and verified in frontend tests/browser fixtures; packaged desktop and live-provider release verification pending. See [implementation checks](REVIEW_WORKFLOW_UX_IMPLEMENTATION_2026-10-29.md).
Date: 29 October 2026.
Scope: Review entry, Activity, Overview, Review-owned source browsing, Project Sources navigation/synchronization, and a dedicated Help page.

## 1. Intended outcome

Help a developer preparing a product for a Product Owner or client answer:
“What should I do next, and what does the recorded Review evidence support about handover?”

Lead with action and outcome. Explain findings, coverage and limitations in plain language. Preserve the distinction between automated execution, an evidence-based recommendation, human approval and individual finding decisions. A Review does not certify the entire product or replace live Dynamic Testing.

The user explicitly requires a written specification before implementation and confirmation of shared understanding before code changes. This document records decisions; it does not authorize implementation.

## 2. Confirmed interview decisions

| Area | Agreed behavior |
| --- | --- |
| Primary audience | Person preparing handover, supported by the developer's fix list. |
| Result | Evidence-based handover recommendation, findings and coverage; a person makes the final decision. |
| Recommendation evidence | Use existing saved Review evidence without an additional AI assessment. An unsupported conclusion remains Insufficient evidence for handover. |
| Reading order | Next action; recommendation and reasons; findings; coverage; supporting evidence and sources. |
| Priority actions | Up to three, each linked to its finding or coverage gap; View all actions exposes the remainder. |
| Priority order | Confirmed handover blockers first, remaining risks second, evidence gaps third. Evidence gaps still affect the recommendation even when their actions appear third. |
| Automatic blocker threshold | Unresolved, evidence-verified Critical and High findings block a Ready for handover recommendation. Medium, Low and informational findings remain visible as remaining risks/observations. Uncertain evidence is not promoted to a confirmed blocker and can require Insufficient evidence. |
| Overview summary | Orient a new reader: review purpose, work actually completed, supported results, why work stopped if applicable, and the specific next action. General usage guidance belongs on Help, not in an Overview tutorial or disclosure. |
| Help | New dedicated Help page, reached from a labelled Help navigation item with a question-mark icon under the sidebar Settings category. |
| Project Sources sync | Remove the separate bottom Source updates panel. Automatically check connected sources on a minute cadence and provide a manual Sync action on each eligible source row, with its state and recovery guidance nearby. |
| Project Sources navigation | Confirmed persistent source/repository tree on the left and stable content area on the right. Selecting a source, folder or file changes the content area; retain selected-item visibility and each source's last location. |
| Action content | What to do, why it matters for handover, and what evidence would demonstrate completion. |
| Visual direction | Structured assessment report with clear headings, concise explanations and compact findings rows. |
| Finding navigation | Open finding details on a separate full-width page. Back restores list filters, pagination and scroll position. |
| Finding detail structure | Action and impact first, then the problem, source evidence/cause, and how to verify resolution. Use short sections with consistent headings and direct jumps among affected occurrences. |
| Multiple occurrences | Keep the shared problem and recommendation visible, with a compact location selector and one selected occurrence's explanation/evidence at a time. Do not append all occurrence details into an expanding page. |
| Finding source traceability | Make the relevant portion easy to locate in the file with clear source identity, original locations and evidence highlighting. Distinguish verified citations from uncertain candidate matches. |
| Source preview interaction | Hovering a filename/source indicator opens a large fixed-size, internally scrollable popover above or below it, positioned at the exact relevant lines with highlighting. Clicking its preview opens that source at the same location. |
| Supporting copy | Remove routine descriptive filler around features. Put general instructions on Help. Retain meaningful labels, actionable errors, evidence limitations and context necessary to understand the result. |
| Entry | One compact page. |
| Entry source selection | Repository-level selection only for repositories; no directory tree, individual file selection or file inspection. All attached documents initially included and individually deselectable. |
| Repository default | First repository selected by default; other repositories available for selection. |
| Retry scope | Retain the prior Review's saved source selection. Apply first-repository/all-documents defaults only to new independent Reviews; make scope changes explicit. |
| Activity | Plain-language current task, completed stages, elapsed time, blockers and required human action; detailed events expandable. |
| Overview Sources | Collapsed compact scope summary; View reviewed sources opens an on-demand bounded browser. |
| Reviewed-source browser | Source groups with nested directory trees, search and saved-version file preview. Fixed-height source regions with internal scrolling; repository size and directory expansion must not increase page height. |
| Coverage | Product features and requirements first, with technical details underneath. Explicit assessed results, needs-attention areas and unverified areas. |
| Missing evidence | Important unverified areas require Insufficient evidence for handover even if no blockers were found. |

The ADHD-oriented presentation preference applies to product content: small information groups, visible progress, concrete next actions and recognition instead of recall. Do not fabricate task durations, completion criteria, metrics or evidence to satisfy presentation preferences.

## 3. Entry: define the work without browsing a repository

Use shared application primitives and the existing neutral-first DESIGN.md system. Keep name, project, goal, source selection and Start review on one semantic page. Advanced context stays collapsed. Source-selection lists use fixed-height regions with internal scrolling; increasing file count must not increase entry height. Entry still has no file tree or inspection.

Show repositories as compact labelled selection rows. Never expand repository contents here. Show attached documents in a compact selectable list with a visible included state and clear inclusion summary. Do not silently turn selected directories/files into an alternative scope mechanism.

For a new independent Review, initialize the first repository and all eligible attached documents as selected. Manual selection survives ordinary refreshes; new data must not reset the user's choices. Scope remains project-scoped and is validated before submission. A retry retains its previous saved source selection rather than applying new-review defaults; make any scope changes explicit. Exact ordering of “first,” projects without repositories, requirement/standard records, and comparison details require resolution before implementation (section 9).

Keep existing frozen-scope and backend contracts. Selection of a repository must resolve to its actual imported eligible artifacts, not just a display name. Missing, stale or unavailable source state must be explained without suggesting verification occurred.

## 4. Activity: understand progress without reading a log

The first visible content explains the current task, elapsed time and whether the user needs to act. Show a compact stage summary that distinguishes completed, current, waiting, failed and unreached stages. Stage details are collapsed unless needed to explain a blocker.

Use recorded boundaries for durations; unknown timing stays unavailable. A running operation is not evidence of success. Keep cancellation accessible and preserve safe partial findings on failure. Pause, capacity hold and cancellation must retain their actual existing recovery rules; displaying this page must never resume work or trigger a new paid assessment.

Keep authored objective and selected-scope context available without repeating long lists. Exclude private reasoning, prompts and raw provider errors. Explain blockers in user language with a concrete available recovery action. Announce meaningful progress accessibly without repeatedly moving focus.

## 5. Overview: decide the next action

Use a structured assessment report, not a grid of decorative metric cards. The first screen should answer: What should I do? What is the recommendation? Why? What remains unknown?

Present up to three priority actions. Each identifies the affected feature/requirement or issue, explains handover impact, states a supported completion condition, and links to the recorded evidence. Missing completion criteria remain explicit. A proposed action is not an approved remediation and does not automatically change finding status.

The user explicitly ranked actions: confirmed handover blockers, then remaining risks, then evidence gaps. Do not fill three slots with duplicates or invent actions to reach three. Preserve visibility of important evidence gaps in the recommendation/coverage even if higher-priority actions occupy all three slots. Severity ordering within each group and how a finding qualifies as a handover blocker still require a documented saved-evidence basis; do not equate every finding with a blocker.

### Summary and first-time orientation

The current screenshot's generic wording (“couldn't finish,” a finding count, a technical pause code and “address the issue above”) is insufficient. A new reader must understand this specific Review without having followed its execution or interpreting internal status codes.

Present a concise explanation next to the action/recommendation, using saved public evidence:

1. Purpose and scope: what the Review was intended to check, expressed in ordinary language, with repository/document context when recorded.
2. Work completed: which assessment stages or areas actually produced usable evidence. Distinguish selected/read/indexed sources from semantic assessment and successful checks.
3. Results and limitations: what was established, which findings matter, what stopped completion and which planned areas remain unverified. Say when the record cannot establish these details.
4. Next action: a specific supported task linked to its finding, limitation or available recovery control; explain what completing it would enable.

Do not restate the objective as an achieved result, use finding totals as the whole summary, display raw `assessment_paused` as the explanation, or infer provider misconfiguration from an application hold. Preserve authored instructions separately. Summary generation uses saved evidence and deterministic presentation, with no additional AI assessment. Historical insufficient records use explicit unavailable context rather than fabricated explanatory prose.

The user rejected an inline or expandable “How to read this review” guide. Put general usage guidance on the dedicated Help page instead. The Overview summary must still explain this specific Review's evidence, results and next actions without requiring Help to understand its outcome.

### Dedicated Help page

Add Help under the sidebar's existing Settings category, after Settings, with a Lucide outline question-mark icon and the visible label Help. Follow shared icon, navigation, active-state, focus and narrow-sidebar conventions. A collapsed navigation item still needs an accessible name and tooltip. Open Help as a normal page within the existing app shell, with a route-aware breadcrumb, page title and keyboard-accessible content.

Help explains the Review workflow in small task-oriented sections:

1. Start a Review: choose a project, state the goal, select repositories/documents, and understand new-Review defaults versus retained retry scope. Entry does not inspect repository files.
2. Follow Activity: understand the current task, completed/unreached stages, duration, interruptions and available recovery actions. Explain that waiting, pausing and retrying are different; do not imply viewing Help resumes work.
3. Read the result: use the handover recommendation, blocker/risk/evidence-gap action order and feature/requirement coverage. Explain included versus actually assessed sources, important unknowns and the separate human decision.
4. Inspect evidence: Findings opens a separate full-width issue page; Back restores the list. Traceability explains recorded requirement coverage. Reviewed sources exposes the saved-version directory browser with fixed-height scrolling.

Use plain explanations and numbered steps; keep each section focused on an observable task and result. Describe supported product behavior, without exposing runtime implementation details or inventing automatic fixes. Help is explanatory and does not start, retry or resume a Review or change user settings. Keep Help copy consistent with final implemented behavior before release. No external sharing, new support integration or remote service is required by this request.

Recommendation labels agreed in the interview:

- Ready for handover.
- Changes needed.
- Insufficient evidence for handover.

Always qualify the recommendation by the recorded Review scope/version and explain its basis. A ready recommendation is not whole-product certification, human approval or a project risk score. Missing evidence must not become a successful result. The exact recommendation derivation, important-gap classification and within-group priority ranking remain an implementation gate in section 9; do not introduce a heuristic that silently treats missing records or zero findings as ready.

Findings must retain severity, domain, uncertainty, disposition and source evidence. Coverage leads with supported product features/requirements, then technical detail. “Assessed” does not mean “passed”: assessed areas may also need attention. Display these as understandable facets rather than implying mutually exclusive counts unless a documented partition exists. Unknown totals remain unknown; no fabricated global percentage.

### Finding detail readability and source traceability

The user confirmed the following structure for the separate full-width finding page:

1. What to do: a specific recorded recommendation and its impact on handover.
2. What is wrong: expected behavior versus the observed issue, in plain language where recorded evidence supports that distinction.
3. Where and why: source identity, relevant evidence and the supported causal explanation.
4. How to verify the fix: supported checks or evidence required for resolution; state explicitly when verification criteria were not recorded.

Use clear visual hierarchy, short readable paragraphs and appropriately sized code/document excerpts. Do not split one explanation into multiple nested cards, repeat the same remedy for every identical occurrence, or bury the action under identifiers and history. Show a compact affected-location selector and only the selected occurrence's explanation and evidence. Keep the shared problem and supported common recommendation visible while selecting locations. Keep distinct remedies and evidence attached to their occurrence; never present one occurrence's remedy as universal unless the recorded recommendations support that. History and technical provenance remain available on demand. Existing decisions and historical finding records remain intact.

Switching occurrences changes the occurrence-specific content in place without navigating away from the finding detail page or appending more full sections. The selector identifies source/path/location and relevant status so duplicate filenames are distinguishable. For large occurrence sets, contain and search/paginate the selector rather than expanding page height. Preserve the chosen occurrence when returning from its source preview or full source view. Actions apply to the selected occurrence unless a separately supported action explicitly names a wider scope. Keep raw occurrence counts and individual dispositions unchanged.

Verify that selection updates the heading, location, explanation, evidence, uncertainty, remedy, verification criteria and available actions together. Close/reset the previous source popover on an occurrence switch; late source responses must not attach to the newly selected occurrence. Verify keyboard selection, meaningful focus/announcement, source-view return and distinct per-occurrence decisions. Missing fields remain explicit and cannot be borrowed from a sibling occurrence.

Relevant evidence must be visually highlighted against sufficient surrounding context with original line numbers or document locations where available. Show source/repository, relative path and saved-version context consistently. Provide a direct way to inspect the corresponding file at that location and return to the same finding/occurrence. Highlight only the validated recorded range; do not invent character-level precision when only line-level evidence exists. For unsupported document formats, show the supported page/section/excerpt locator instead of faking a code-line jump. Missing source/version evidence gets an explicit unavailable state.

A highlight locates evidence; it does not prove the finding. Uncertain candidate matches must carry their verification state and cannot look like verified citations. Use accessible labels and line/range markers in addition to color. Never substitute a newer project file for the Review's saved version without an explicit current-versus-reviewed distinction.

The user specified a hover preview rather than requiring a large always-expanded excerpt for every file reference. Hovering a filename or source indicator opens a large popover above or below its anchor. Use consistent fixed width/height at a given viewport, clamped to available screen space. Flip its placement to avoid clipping; keep its source label and location visible while its body scrolls vertically and, where needed for code, horizontally. Initial scroll positions the recorded relevant range in view with original line numbers and highlight. Source content must not stretch the popover or the surrounding finding page.

Keep the popover open while the pointer crosses from its anchor into the preview and while the pointer or keyboard focus remains inside it. Avoid flicker, unexpected closure during scrolling and repeated fetches on incidental pointer motion. Load only the authenticated saved-version source for this finding, using bounded cached reads where possible. Show loading, unavailable, empty and error states within the same dimensions; late responses cannot replace a different selected file's preview.

A deliberate click on preview content navigates to that exact source/version/location in the source viewer. Preserve a return route to the originating finding and occurrence with its scroll/list context. Scrolling, dragging a scrollbar or selecting/copying source text must not accidentally navigate. Provide an explicit accessible Open source control inside the preview as well as the requested clickable content behavior. The destination retains the approved source-navigation structure and clearly identifies reviewed-version content; never fall through to a newer file merely because it has the same path.

The preview must also open through keyboard focus/activation and touch activation so evidence is not hover-only. Support Escape dismissal, sensible focus restoration and an accessible source/location label. Do not trap focus or move it unexpectedly on pointer hover. Narrow screens retain the same source identity, highlighted range and navigation behavior within viewport-fitting dimensions.

Acceptance checks include top/bottom viewport anchors, pointer travel into the popover, internal scrolling, text selection, deliberate navigation, Escape/focus return, keyboard/touch access, duplicate paths in different sources, unavailable historical versions and out-of-order preview responses. Verify the destination opens the same saved version and highlighted range and Back restores the finding context.

### Remove routine supporting-text clutter

Remove generic feature descriptions, repeated introductions, duplicate status explanations and prose that simply repeats a heading or button. Examples include explaining that each occurrence section contains sources/explanations/status when that structure is already visible. Use concise labels and predictable controls; keep general workflow instructions on Help.

This is a content reduction and hierarchy change, not removal of necessary evidence. Preserve the specific Review summary, finding explanation, actionable next step, meaningful empty/error states, destructive-action consequences, uncertainty and accessibility labels. A new user should understand the actual result from the page without needing decorative supporting prose or being forced to read Help.

## 6. On-demand reviewed sources

Collapsed state shows a compact repository/document scope summary derived from the frozen manifest. Never substitute current project sources or label included files as semantically assessed solely because they were in scope.

Opening View reviewed sources exposes grouped sources and nested directories in a fixed-height browser with internal vertical scrolling. Large trees use bounded rendering and do not expand the Overview into an unlimited document. The chosen height may adapt to viewport size but is independent of item count, expanded directories, loading state and search results. Keep search, source summary and navigation controls outside the scrolling inventory so they remain available. File previews are independently bounded. Prevent scroll trapping and preserve visible keyboard focus. Search across recorded sources; retain source identity when paths collide. Selecting a file shows its exact saved version and optional version metadata. Unavailable historical versions, incomplete manifests and errors remain explicit and recoverable.

Preserve membership checks, Review ownership and exact version/hash checks. Tree grouping uses recorded identity/path data; do not invent repository membership for historical manifests lacking it. Browser placement and narrow-screen behavior must be specified during visual design; all actions remain accessible.

## 7. Existing design contracts and current evidence

### Added Project Sources requirements

The user expanded scope to the Project Source page after confirming Help placement. The bottom Source updates panel is not a useful primary sync destination. Move sync status, last successful update/check context, manual Sync and relevant error/reconnect actions to the actual connected-source row. Do not create duplicate rows for the same logical source simply to expose sync controls. Preserve access to supported history/details from that source's contextual controls.

Interpret the requested minute cadence as a 60-second eligibility check while the signed-in workspace is running and connected; this is a target for checks, not a guarantee of a completed import every minute. Verify provider coverage before implementation. Current inspected code uses a five-minute GitHub due interval with thirty-second scheduler ticks, and a fifteen-minute Slack interval; no equivalent periodic Drive scheduler has been established by this inspection. The new requirement must not silently remain GitHub-only. Closed-app background execution is not implied or promised.

Use existing authenticated member-scoped sync APIs and durable workers, with bounded concurrency, fairness across sources, in-flight deduplication, provider retry/backoff and explicit disconnected/inaccessible states. Manual Sync uses the same safe job path and cannot overlap the source's active sync. Ordinary automatic and manual incremental checks preserve provider cursors; do not implicitly turn the row action into forced full resync. Keep local uploads/local repositories explicitly local with their supported refresh/reimport action; do not suggest they are remotely watched.

Source synchronization and paid model-backed indexing/assessment are different operations. Preserve application pauses, owner/project capacity holds and explicit Resume authorization; automatic sync and its row button must not clear holds, resume a stopped assessment or claim an unbuilt index is ready. Keep the required indexing pause/recovery information understandable after removing the bottom sync panel.

The reported navigation problem is supported by ArtifactsPanel.tsx: repository-directory browsing renders a table; selecting a file switches to a separate file layout with an optionally visible tree/sidebar and reader; standalone documents use another preview composition. Breadcrumbs alone do not preserve the visual workspace. Use stable project/source/repository identity, selected path and highlighted item across transitions. Preserve directory expansion, independent scroll positions and relevant search/filter/list state on return and source switching. Refreshing imported metadata must not reset the active reader or jump to a different file; a changed/removed file requires explicit feedback. Namespace remembered state by project/source so equal filenames do not mix navigation contexts.

Confirmed composition: one persistent bounded navigation area on the left for source groups and repository directories, with a stable content area on the right that switches between source overview, folder contents and the selected file/document. This applies before and after file selection; the tree does not first appear only after opening a file. Expose current source plus full relative path in a consistent location and keep the selected item visible in the tree. Keep a visible All sources/parent route and useful Back behavior. File loading/errors must not replace the navigation surface. At narrow sizes an explicit navigation drawer may replace the side panel while retaining selection and path. The user's explicit confirmation approves this layout direction over the earlier DESIGN.md Source split-browser restriction; the scoped amendment is now recorded in DESIGN.md. Other design rules remain authoritative.

Help must document automatic source checks, per-row manual sync and the distinction between source updates and held model work. Final Project Sources acceptance requires captured list -> repository -> nested directory -> file -> sibling file -> different source -> Back journeys, plus automated/manual sync, active-job deduplication, failed/disconnected states and held-index behavior. Source lists, trees and readers must stay within fixed-height independently scrollable regions.

DESIGN.md remains authoritative except for explicitly approved changes recorded in this interview. The new compact repository/document selector replaces item-by-item entry scope presentation; the collapsed source summary replaces an always-expanded Overview inventory. Do not update DESIGN.md to claim final approval until shared understanding is confirmed.

DESIGN.md currently requires a table-only grouped Findings index and a separate full-width continuous finding document. The user explicitly confirmed a separate full-width detail page and subsequently approved one selected occurrence at a time instead of the continuous stack of all occurrences. This approval supersedes the older continuous-occurrence requirement; that scoped amendment is now recorded in DESIGN.md. Keep the grouped index separate from the detail page and restore its filters, pagination, scroll position and focus on Back. The compact occurrence selector belongs within the finding detail page; it does not reintroduce the full Findings index as a competing sidebar. Keep navigation within the existing app and authenticated Review context; a separate page does not imply a new browser tab or window.

Current implementation inspection:

- ReviewEntryScreen.tsx maps scope artifacts into individual selectable rows; it does not implement the agreed repository-level entry.
- ReviewActivityScreen.tsx preserves Overview, Activity, Findings and Traceability and mounts FrozenReviewSources in Overview.
- FrozenReviewSources.tsx renders every artifact as a separate bordered item, including saved version/hash metadata. Its list CSS has no viewport height bound or pagination. This supports the reported scaling concern.

Current-run capture now covers Entry with 287 selected items, a saved failed Review's Overview and Activity, and the 285-item reviewed-source inventory. Saved screenshots were reopened and inspected. See [current experience audit](REVIEW_WORKFLOW_UX_AUDIT_2026-10-29.md) for evidence and recommendations. Earlier native navigation/capture problems were recovered. Coverage remains limited to one project and a 902x731 outer window; live running/paused, successful approval, keyboard, screen-reader, zoom and required responsive sizes remain unverified. No accessibility compliance or release acceptance is claimed.

## 8. Acceptance and required verification

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Entry | One page; initial first-repository/all-documents selection; selection can change; no repository inspection; no file-count-driven height growth. | Specified, not implemented | Ordering, non-repository inputs and retry rules open. |
| Activity | Clear current task, recorded elapsed time, stages and required action; technical events on demand; actual stop/recovery semantics preserved. | Specified, not verified | Live running/paused/failed states require capture. |
| Overview | Up to three linked actions in blocker/risk/evidence-gap order; scoped recommendation; summary explains intended vs completed work, results, interruptions and next action to a new reader; general guidance stays on Help. | Specified, not implemented | Recommendation/within-group ranking derivation open. |
| Evidence | Unknown/unsupported/omitted coverage explicit; no findings never implies full verification; immutable historical evidence retained. | Required | Historical feature/requirement inventories may be incomplete. |
| Sources | Collapsed summary; grouped, searchable nested tree and exact saved previews on demand; fixed-height internally scrollable regions at large scale, including expanded directories; no list-driven page growth. | Specified, not implemented | Historical grouping and browser placement require validation. |
| Project Sources | Persistent tree/content composition for source, folder and file navigation; selected item visible; per-source navigation state retained; automatic minute-cadence checks and per-row manual Sync replace the bottom updates panel. | Confirmed direction, not implemented | Provider coverage, responsive layout, historical source identities and sync/hold integration require verification. |
| Help | Labelled question-mark navigation item under Settings opens a dedicated in-app page; concise task-oriented guidance covers setup, Activity, result interpretation and evidence; no Overview tutorial. | Specified, not implemented | Verify navigation, narrow-sidebar accessibility and consistency with implemented behavior. |

Before implementation: complete the current-view audit or explicitly document inaccessible states; inspect current source identity/selection contracts and evidence availability; resolve section 9; obtain confirmation of shared understanding of the spec.

For implemented changes: relevant interaction and contract tests, pnpm --filter centinel build, and visual checks at 1440x900, 1200x900 and a narrow viewport. Verify keyboard/focus behavior, meaningful live announcements, 200% zoom, loading/empty/error/partial/historical states, large multi-repository fixtures, and absence of style leaks. Use fixtures only for verification, never as production evidence. Preserve unrelated working-tree changes. Report actual executed checks and residual gaps before claiming completion.

## 9. Implementation requirements and remaining verification

The user-facing direction is confirmed. Resolve routine technical details against existing contracts; raise a new question only for a material conflict with the agreed behavior. The following are engineering requirements, not another round of preference questions.

1. Finding detail placement: resolved. The user selected a separate full-width page with Back restoring list context.
2. Recommendation policy: saved-evidence-only derivation without another AI assessment, blocker/risk/evidence-gap action order and the verified unresolved Critical/High blocker threshold are confirmed. Bind these rules to canonical saved finding/evidence states during implementation planning. Use recorded severity/priority and stable ties within groups. Missing basis must remain insufficient evidence; do not create a new risk-acceptance workflow implicitly.
3. Entry edge cases: preserve existing supported source order to define the first repository and keep initialization stable through refreshes. Preserve supported document-only/local-code workflows and explicit saved retry/comparison scope. Keep requirements/standards as selectable supporting inputs with their existing identities; unavailable identities must remain explicit. Verify grouping and submission contracts before accepting the change.
4. Visual validation: prepare reviewable layouts from the agreed hierarchy and current captures, then verify implemented states at required sizes. Project Sources' persistent left tree/right content composition, fixed-height scrollable regions and Help placement are confirmed. The scoped amendments are recorded in DESIGN.md. Preserve its typography, neutral surfaces, semantic colors and accessibility rules.

## 10. Progress

Completed: interview decisions recorded including retry scope, blocker/risk/evidence-gap ordering, informative new-reader summary, fixed-height scrollable sources, a dedicated Help page under Settings and persistent Project Sources navigation. Project Sources sync direction is recorded. Current entry/frozen-source implementation inspected; current Entry, failed Overview/Activity and source inventory captured and assessed. Project Sources directory-to-file layout change reproduced and captured. Draft specification written. The user supplied a larger Overview screenshot that reinforces the summary/context concern; it is additional user-provided reference, not a capture from the audit run.
Outstanding: map the confirmed rules to canonical evidence states; verify source grouping and provider scheduling contracts; prepare layouts; implement and run the required checks. UX interview decisions are consolidated; application behavior has not changed.

## 11. Verified implementation contracts for final specification

Read-only inspection confirmed the following; these are capability findings, not implemented redesign behavior or executed regression tests.

- App.tsx mounts GitHub reconciliation only in an authenticated workspace. Slack uses its separate periodic pass. The existing repository-index sync is a separate operation and must not be mistaken for provider source refresh. The new minute scheduler must explicitly cover supported connected providers, including Drive, with fair admission rather than one source monopolizing every pass.
- The existing connected-source sync routes validate optional `force` independently of ordinary sync. Automatic checks and the primary row Sync action should use incremental behavior. Forced re-evaluation remains an explicit separate action where supported.
- ReviewSourceManifest already identifies source groups, source kinds, artifact IDs and frozen artifact versions. These support grouped reviewed-source browsing without replacing historical content with current project files. Legacy missing grouping/version data needs an unavailable state.
- ReviewAnalysisScope currently consumes an inferred feature/path map with per-domain assessed/unverified results, unsupported inputs and coverage limitations. The map explicitly excludes runtime/dependency proof. Present inferred code features as inferred; do not claim they are an authoritative complete product-feature inventory. Missing maps remain unavailable.
- Requirement traceability carries recorded requirements and evidence status. Zero missing/incomplete counts with no established requirement inventory cannot prove requirements completeness. A completed operation, a nonempty manifest and an empty findings list cannot independently establish handover readiness.
- Review entry currently selects all nondeprecated artifacts, all coding standards and structured requirements, then restores saved comparison scope when available. The repository-only default is therefore a behavior change requiring selection-contract tests. Retain attached requirement/standard inputs as labelled selectable supporting materials; do not silently drop existing authorities during grouping. Preserve explicit retry/comparison scope and flag unavailable saved members instead of substituting another repository.

### Result derivation constraints

Derive the recommendation from this Review's saved execution, validated assessments, finding states, traceability evidence and explicit coverage limits. Do not start another model call. Keep execution interruptions separate from confirmed product defects and from missing assessment evidence. Unknown inputs must not silently coerce to a passing value.

The user confirmed the automatic blocker threshold: unresolved, evidence-verified Critical and High findings. If such a blocker exists, present Changes needed and also expose important evidence gaps. Medium, Low and informational findings remain visible as remaining risks/observations; their presence alone does not trigger this automatic blocker rule. An uncertain or unverified Critical/High observation is not a confirmed blocker merely because it carries that severity; preserve its uncertainty and consider its effect on evidence sufficiency.

If no confirmed blocker exists but important selected-scope evidence is absent, incomplete, unverified or contradicted, present Insufficient evidence for handover. Ready for handover requires an affirmative supported assessment of the agreed scope with no unresolved blocker or important gap, with the scope qualification visible. Readiness is a recommendation, not human approval, proof of all runtime behavior or an automatic change to finding status.

Recommendation acceptance cases:

| Saved evidence | Expected recommendation |
| --- | --- |
| Verified unresolved Critical or High finding | Changes needed; link to the finding and its supported remedy. |
| Confirmed blocker plus important unverified coverage | Changes needed; explicitly show the coverage gap as well. |
| No confirmed blocker, but important coverage missing or assessment incomplete | Insufficient evidence for handover. |
| Unverified High/Critical observation with material unanswered risk | Insufficient evidence; do not relabel it as a verified defect. |
| Affirmatively sufficient scoped assessment; no confirmed blockers or important gaps; only Medium/Low/info findings | Ready for handover within the stated scope; retain visible risks/observations. |
| No findings but failed execution, unavailable validation or unknown scope | Insufficient evidence; never infer readiness from zero findings. |

Rank action groups in the user's confirmed order: blockers, remaining risks, evidence gaps. Within a group use recorded severity/priority where present and a stable tie-break; missing priority remains explicit. Evidence gaps outside the top three remain visible in coverage and the recommendation. Human acceptance of risk must never be inferred from an ignored/dismissed UI state without an established decision contract.

### Sync status wording

Distinguish Last checked, Last updated and Syncing where the stored data supports each. An unchanged successful check means no provider change was detected at that time, not that semantic assessment is complete. Show a timestamp or explicit unavailable value; never claim real-time synchronization or promise completion each minute. Updates arriving while a file is being read preserve its identity and navigation context and give explicit changed/removed feedback.
