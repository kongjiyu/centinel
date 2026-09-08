# Centinel Review workflow update plan

## Purpose

Update the Review entry, in-progress Review activity, and completed Review result so they form one calm, evidence-led workflow based on the user-supplied three-screen reference.

This plan is grounded in:

1. [`DESIGN.md`](../DESIGN.md), including the September 2026 Review UI amendment.
2. [`docs/Centinel_PRD_Revised.md`](./Centinel_PRD_Revised.md), especially human review, traceability, structured findings, and report generation.
3. The current React and sidecar contracts in `ReviewEntryScreen`, `StaticReviewForm`, `ReviewActivityScreen`, `ReviewProgressView`, `staticSessions`, `reviewDecisions`, and `reportExport`.
4. The supplied reference for a three-screen desktop Review workflow.

This is a plan only. It does not authorize sample data, speculative service behavior, or a change to the existing Review lifecycle.

## Recommended outcome

Keep exactly three user-facing screens in the workflow:

```text
1. Start review
   -> 2. Review activity (in progress, then pending human review)
   -> 3. Completed review result
```

The in-progress and pending-review states should remain on the same Review activity route. A review becomes a completed result only after a valid activity-level human decision. Candidate findings remain distinct from confirmed or agreed findings throughout the workflow.

## Source-of-truth decisions

Where the supplied reference differs from `DESIGN.md`, use the following resolutions.

| Reference request | Centinel decision |
| --- | --- |
| Label the module “Static Testing” | Use **Review** in global navigation, breadcrumbs, headings, and actions. Keep existing internal route and transport names for compatibility. |
| Add a Verification Type selector | Do not show a type selector. The objective and available sources guide the existing review pipeline. Preserve the internal `reviewType` value while the service contract requires it. |
| Show raw reasoning/current analysis | Show concise activity summaries and expandable **Activity details** containing auditable evidence, assessment, and outcome. Never expose hidden chain-of-thought or raw model traffic as reasoning. |
| Show human approval during processing | Do not allow decisions while the review is queued, running, blocked, failed, or cancelled. Make decisions available only after processing reaches **Pending to Review**. |
| Put approval only in a sticky composer | Keep activity-level Approve and Reject actions in the page header as required by `DESIGN.md`. Selecting either action may open a visually separate sticky decision panel for its required rationale. |
| Use per-finding approval as the review lifecycle | Keep per-finding disposition separate from the activity-level decision. Approval completes the review; it does not automatically resolve or fix findings. |
| Add an Evidence result tab | Keep the approved tabs: **Overview, Findings, Traceability, Risk Assessment, History**. Present evidence within finding detail and traceability views rather than adding a sixth or competing tab. |
| Show example people, branches, commits, requirements, and counts | Use persisted application data only. Omit, disable, or label unavailable capabilities when the service cannot supply them. |

## Current-state assessment

### What can be reused

- `ReviewEntryScreen` already owns project selection, inherited artifact loading, and transition into Review activity.
- `StaticReviewForm` already supports a name, objective-like instructions, full-project scope, and optional base/head refs.
- `ReviewActivityScreen` already maps backend status into In progress, Pending to Review, Completed, Blocked, Cancelled, and Failed.
- `ReviewProgressView` already renders four persisted stages with active, done, pending, and failed states.
- `ReviewActivityScreen` already contains the approved five result tabs and separates system progress from human decision history.
- The sidecar already exposes session findings, review artifacts, session-level decisions, finding status updates, and static report export.
- Shared `CommandPageHeader`, `StatusBadge`, `Select`, button styles, tokens, and Lucide icons should remain the visual foundation.

### Gaps that affect fidelity to the reference

| Gap | Current behavior | Planning consequence |
| --- | --- | --- |
| Immutable code snapshot | Base/head refs are stored, but resolved SHAs are not persisted; ref lookup can soft-fail into a full review. | Do not claim that a review is bound to a commit until the service returns and persists a resolved snapshot. |
| Branch and PR selection | The UI accepts manual refs; there is no branch list, commit metadata endpoint, or pull-request integration. | Keep Advanced options as the honest fallback. Feature-gate the segmented Branch/PR selector and commit card. |
| Inherited baseline | Artifact types and hashes exist, but the session does not expose an immutable artifact-baseline record. | Summarize currently available sources, but do not claim an immutable evidence baseline until it is persisted. |
| Reviewer assignment | Decisions can store a free-form reviewer, but no user directory, role model, or assignment API exists. | Do not manufacture reviewer choices. Hide or disable assignment with an availability explanation until backed by real data. |
| Conversational events | Progress is stored as stage summaries plus string arrays, not as durable structured events. | Build the conversation presentation from safe stage data; do not invent evidence lists, requirement links, or analyzer events. |
| Candidate-finding evidence | `Finding` is flat and does not carry structured requirement, code, traceability, analyzer, or multidimensional risk evidence. | Use current fields in the first pass and gate the richer evidence composition on a new service contract. |
| Finding completeness | The activity endpoint returns AI findings from `findings`, while rule-based analyzer observations are stored separately in `static_analysis_results`. | Add a unified session-findings response before claiming that activity/result counts represent every candidate produced by the review. |
| Finding adjudication | Finding status can be changed, but no per-finding rationale, reviewer, or decision timestamp is stored. | Keep activity-level decisions as the supported workflow. Treat full per-finding human adjudication as deferred service work. |
| Automatic reprocessing | `changes_requested` records a decision but does not rerun the same session. | Use “Reject review” or “Request changes”; do not promise “Reject & reprocess” until the sidecar implements it. |
| Final metrics | Requirement coverage, evidence-limited relationships, candidate/agreed/rejected totals, and risk dimensions are not all available. | Render only metrics derivable from persisted data. Omit unavailable metrics instead of showing zero or examples. |
| Report fidelity | Static export omits the source baseline, human decision history, structured traceability, and risk assessment. | Update export only after the corresponding data is real and stable. |

## Screen 1 — Start review

### User outcome

The user should be able to define what the review should examine, understand which project sources are inherited, select a truthful code scope, and start the review with confidence.

### Page structure

- Breadcrumb: `Review / New review`.
- Title: **Start review**.
- Subtitle: “Configure the objective, project context, code scope, and human review ownership.” Use the reviewer clause only when assignment is supported.
- Center one main surface within the existing page shell; use a readable form width of approximately 760–860 px.
- Organize the form with dividers and section headings rather than nested cards around every field.

### Section 1: Review details

- **Review name** — required, maximum 120 characters.
- **Review objective** — required for the new workflow, maximum 1,000 characters.
- Explain that Centinel uses the objective to determine review emphasis.
- Do not add a visible review-type control.
- Preserve input after validation and service errors.

### Section 2: Project context

- Use the existing Project selector when the flow is launched globally.
- When launched from a project Overview, preselect and retain that project.
- Add an **Inherited project context** summary computed from real artifacts:
  - repository/source code available;
  - requirement specification available;
  - coding standard available;
  - design or supporting documents available.
- Use “Available,” “Not available,” or “Could not be checked,” not a green check for missing or unknown state.
- State that sources are inherited and managed from the project Source tab.
- Keep source errors local, actionable, and non-destructive.
- Do not add upload controls to this page.

### Section 3: Code scope

Deliver this in two levels:

1. **Supported first pass:** keep Full project scope as the default and manual base/head refs under Advanced options. Clarify that refs define changed-file scope but are not yet a persisted immutable snapshot.
2. **Feature-gated target:** when repository metadata is supplied by the service, replace manual inputs with a Branch/Pull request segmented control, real options, and a latest-commit card containing SHA, message, and timestamp.

The primary action must be blocked if the chosen target cannot be resolved. Never silently fall back from an invalid selected target to the whole project while telling the user that a snapshot was bound.

### Section 4: Human review

- Show Assigned reviewer only when the application can provide a real current user or project collaborator list.
- If assignment is unavailable in local single-user mode, either omit the section or show a concise unavailable state; do not insert example identities.
- Explain that the reviewer owns the final activity decision, not that the reviewer automatically accepts every finding.

### Actions and states

- Primary: **Start review**.
- Secondary: **Cancel**.
- Loading: **Starting review…** with stable button width and repeat submission disabled.
- Cover empty project, no sources, source-loading, source-error, invalid-ref, offline sidecar, and active-review-conflict states.
- Move focus to a focusable error summary after failed submission and retain inline errors connected through `aria-describedby`.

## Screen 2 — Review activity

### User outcome

The user should understand what Centinel is doing, what evidence has been considered, what candidate findings have emerged, and when human action is allowed—without reading raw logs or hidden model reasoning.

### Header

- Breadcrumb: `Review / <stable review identifier>`.
- Title: the saved review name.
- Metadata: target ref or scope and snapshot SHA only when persisted.
- Status: In progress, Pending to Review, Blocked, Failed, or Cancelled.
- Include Cancel only for a genuinely cancellable queued/running session.
- Show Approve and Reject only in Pending to Review.

### Activity column

- Use a centered reading column approximately 800–900 px wide inside the application shell.
- Present chronological Centinel activity as a timeline/conversation hybrid, not a dashboard or a generic spinner.
- Each stage message contains:
  1. actor and timestamp;
  2. plain-language stage label and status;
  3. one concise summary;
  4. an optional disclosure button;
  5. expanded Activity, Evidence examined, Assessment, and Outcome sections when those fields are actually available.
- Map the existing stages to user language consistently:
  - Understanding Context -> Source readiness check;
  - Code Review -> Facts gathering;
  - Requirement Validation -> Connecting facts;
  - Summarizing Findings -> Reviewing.
- Keep failed-stage detail visible and recovery guidance close to the failure.
- Show only the latest active status in an `aria-live="polite"` region so screen readers are not flooded by the full timeline.

### Candidate findings

- A finding created by automation is labeled **Candidate finding** while it remains unadjudicated.
- The card should show only persisted values: finding ID, title, severity, requirement/category when supported, location, and evidence availability.
- Severity is impact; independent fix priority is shown only when supplied by the service.
- **View full evidence** opens or expands the evidence detail using the same order as the shared finding contract.
- Never relabel a candidate as a defect merely because the model assigned critical severity.

### Activity details safety

- Rename “View reasoning” and “Show current analysis” to **View activity details**.
- Present source references, retrieved facts, an evidence-grounded assessment, and the generated outcome.
- Do not display raw prompts, raw responses, tokens, or private chain-of-thought in the default workflow.
- Treat model traffic as advanced evidence only if a separate audited feature later exposes it.

### Human decision interaction

- Decisions are unavailable during processing.
- In Pending to Review, the header exposes activity-level **Approve** and **Reject**.
- Selecting an action opens a bottom-centered decision panel that remains visually separate from Centinel activity.
- The panel repeats the selected action, review name, and scope; it does not pretend to target a single finding unless per-finding adjudication exists.
- Require a written rationale for both actions to follow the supplied reference. Enforce the requirement in the service as well as the UI before making this a production contract.
- Add enough bottom padding and `scroll-padding-bottom` that the sticky panel cannot cover content or keyboard focus.
- After submission, append the persisted human decision to History and update the page state from the server response.
- Until reprocessing exists, rejection copy must not say that Centinel is reprocessing the same activity.

## Screen 3 — Completed review result

### User outcome

The user should be able to understand the completed scope, inspect agreed and unresolved evidence, trace findings back to sources, see the human decision, and export a trustworthy report.

### Header and completion summary

- Breadcrumb: `Review / <review identifier> / Result`.
- Title: the saved review name.
- Metadata: scope and immutable snapshot only when persisted.
- Status: **Completed** only after the supported approval transition.
- Primary action: **Export review report**.
- Lead with **Review completed**, not a global Pass/Fail verdict.
- The summary must name the reviewed scope and evidence limits. It must not imply the entire software is correct.

### Summary metrics

Render metrics from persisted records only. Preferred metrics, once supported, are:

- Requirements reviewed.
- Traceability resolved.
- Evidence limited.
- Candidate findings.
- Agreed findings.
- Rejected or reprocessed findings.

If only finding totals and severity are available, show only those values. Never substitute zero for unknown.

### Risk summary

- Count agreed findings only when per-finding adjudication is available.
- Otherwise label the section **Reported findings by severity** and do not imply human agreement.
- Use restrained semantic color plus text/icons; red is reserved for critical/destructive meaning.
- Do not rely on color alone.

### Result tabs

Use the approved five-tab structure:

1. **Overview** — completion summary, scope, leading findings, traceability preview, and final human review.
2. **Findings** — sortable list with candidate/agreed/rejected/fixed state kept separate from severity.
3. **Traceability** — requirement-to-implementation relationships with Resolved or Evidence limited labels.
4. **Risk Assessment** — technical impact, requirement impact, business impact, review priority, and rationale when supported.
5. **History** — chronological system activity and a visually distinct human-decision column or filter.

Implement the tabs with proper `tablist`, `tab`, and `tabpanel` semantics, arrow-key navigation, focus management, and a restorable selected tab.

### Finding detail

Expanded detail follows one consistent order:

1. Finding description.
2. Requirement evidence.
3. Primary and supporting code evidence.
4. Technical/analyzer evidence.
5. Verification assessment.
6. Recommendation.
7. Confidence and provenance.
8. Risk assessment.
9. Human adjudication and rationale when persisted.

Use monospaced text only for IDs, commit SHAs, refs, file paths, symbols, and line numbers. Long technical tokens must wrap without forcing horizontal page overflow.

### Traceability language

- Use **Resolved** when a relationship is supported by evidence.
- Use **Evidence limited** when the available evidence is insufficient.
- Do not use Failed or Unimplemented as a synonym for missing evidence.
- Provide direct navigation from a traceability row to the related finding or evidence detail where data permits.

### Final human review

- Show the persisted reviewer, reviewed finding count, disposition counts, decision rationale, and timestamp only when supplied.
- If only the current session-level decision exists, label it **Review decision** and do not fabricate per-finding counts.
- Keep prior decisions in History rather than overwriting the audit trail.

## Frontend architecture

Refactor the current large screens into state-specific components while preserving route and API compatibility.

### Existing files to update

- `centinel/src/screens/ReviewEntryScreen.tsx`
- `centinel/src/screens/ReviewEntryScreen.css`
- `centinel/src/components/StaticReviewForm.tsx`
- `centinel/src/screens/ReviewActivityScreen.tsx`
- `centinel/src/screens/ReviewActivityScreen.css`
- `centinel/src/components/ReviewProgressView.tsx`
- `centinel/src/types.ts`
- `centinel/src/api/client.ts` only when a real service field or endpoint is added
- `sidecar/src/reportExport.ts` only after the required evidence and decision data exists

### Recommended components

- `InheritedProjectContext` — data-backed source availability summary.
- `CodeScopeSelector` — current full/diff scope; later enhanced by repository metadata.
- `CommitSnapshotCard` — rendered only from a persisted resolved commit.
- `ReviewActivityTimeline` — chronological stage and event presentation.
- `ReviewActivityMessage` — actor, summary, disclosure, and status.
- `ActivityDetails` — safe structured evidence/assessment/outcome disclosure.
- `CandidateFindingCard` — compact unadjudicated finding preview.
- `ReviewDecisionPanel` — action-specific rationale and submission state.
- `ReviewResultOverview` — completion summary, scope, and final decision.
- `FindingDetail` — shared evidence-first expanded detail.
- `TraceabilityTable` — accessible, dense evidence relationship table.
- `RiskAssessmentList` — risk dimensions without decorative dashboard treatment.
- `ReviewHistory` — separate system and human events.

Prefer a reducer or explicit view-model adapter for the related Review activity states rather than adding more interdependent `useState` flags to `ReviewActivityScreen`.

## Data mapping and feature gates

Create one frontend adapter that turns the current session, findings, decisions, requirements, review artifacts, and progress payload into a `ReviewActivityViewModel`. The adapter should:

- normalize legacy progress payloads;
- derive the lifecycle label from persisted state;
- distinguish unknown from zero;
- distinguish candidate status from severity;
- keep session decisions separate from finding status;
- expose capability flags such as `canResolveSnapshot`, `canAssignReviewer`, `hasStructuredTraceability`, `hasRiskDimensions`, and `hasFindingAdjudication`;
- supply safe empty/error states without example operational data.

UI sections should render from these capability flags rather than guessing from labels or hard-coded demo records.

## Deferred service contracts required for full reference fidelity

These are not part of the frontend-only implementation unless separately approved.

1. **Repository metadata and immutable scope**
   - List real local branches and resolved commit metadata.
   - Resolve and persist the exact review commit before queuing work.
   - Return a validation error instead of silently broadening an invalid requested scope.
   - Add pull-request selection only through a real provider integration or a documented local-ref adapter.

2. **Immutable source baseline**
   - Persist the source IDs, content hashes, types, and versions used by each review.
   - Return the baseline with the Review activity and export payloads.

3. **Structured progress events**
   - Persist stage event type, safe summary, evidence references, assessment, outcome, status, and timestamp.
   - Never persist private chain-of-thought as a product feature.

4. **Structured traceability and risk**
   - Persist requirement relationships and explicit Resolved/Evidence limited state.
   - Persist technical, requirement, and business impact separately from severity and fix priority.

5. **Unified finding feed**
   - Return AI findings and rule-based analyzer observations through one normalized session endpoint.
   - Preserve provenance so the UI can distinguish requirement, code, traceability, and analyzer evidence without double counting.

6. **Finding adjudication**
   - Add append-only per-finding decisions with accepted/rejected action, required rationale, reviewer, and timestamp.
   - Preserve existing finding lifecycle states for remediation; adjudication must not mean fixed.

7. **Reviewer identity and assignment**
   - Provide a real local identity or collaborator source before showing a user selector.
   - Persist the assigned reviewer snapshot on the review.

8. **Reprocessing lifecycle**
   - Define whether rejection updates the same session or creates a linked re-review.
   - Persist the link and emit explicit processing events before the UI says reprocessing has started.

9. **Evidence-complete report export**
   - Include immutable scope, source baseline, findings, traceability, risk, human adjudication, activity decision, and history.
   - Exclude secrets and raw model traffic.

## Implementation sequence

### Phase 1 — Lock vocabulary and view model

- Add the Review activity view-model adapter and capability flags.
- Normalize statuses and technical labels in one place.
- Define candidate, agreed, rejected, fixed, and activity-decision semantics in types and tests.
- Keep old session and progress records renderable.

**Gate:** no UI state claims data that is absent from the current response.

### Phase 2 — Rebuild Review entry

- Restructure `ReviewEntryScreen` and `StaticReviewForm` into the four reference-inspired sections.
- Make objective required and improve field-level validation.
- Add the inherited project-context summary from real artifacts.
- Retain the honest full-project/manual diff scope until repository metadata exists.
- Add the reviewer section only behind real capability data.

**Gate:** starting a review sends the existing compatible payload, preserves failures, and never includes mock metadata.

### Phase 3 — Convert progress into an activity conversation

- Replace the visual stepper emphasis with the centered chronological activity column.
- Preserve the existing four-stage order and failure visibility.
- Add accessible disclosures for prior activity strings and structured details where available.
- Introduce candidate-finding cards only from returned findings.
- Keep all decision controls hidden during processing.

**Gate:** live updates are announced once, disclosures are keyboard operable, and no raw reasoning is exposed.

### Phase 4 — Refine Pending to Review

- Keep Approve/Reject in the header.
- Open the separate decision panel after action selection.
- Require and validate rationale for both actions only when the service contract also enforces it.
- Preserve activity-level decision semantics.
- Show persisted decisions in History after reload.

**Gate:** decisions cannot be submitted early, repeated, or lost during a recoverable error.

### Phase 5 — Rebuild completed results

- Add the completion summary and data-backed metrics.
- Refactor the five tabs into accessible shared tab components.
- Align finding detail with the evidence-first order.
- Make traceability and evidence limitation language precise.
- Make risk summaries honest about whether counts represent reported or agreed findings.
- Add the final human decision block from persisted data.

**Gate:** Completed never means whole-product Pass, and unknown metrics are omitted.

### Phase 6 — Export and cross-screen consistency

- Wire the existing session export action into the result header.
- Upgrade the report only for data fields the service persists.
- Reuse one status mapping, finding presentation, evidence order, and technical typography across all three screens.
- Remove superseded screen-specific styles after the replacement states pass visual QA.

**Gate:** the exported report and UI describe the same scope, findings, decision, and limitations.

### Phase 7 — Full-fidelity service follow-up

- Implement the deferred contracts in small migrations, each backward-compatible with existing rows.
- Enable the corresponding frontend capability only after its endpoint and persistence tests pass.
- Prioritize immutable snapshot binding, source baseline, finding adjudication, and structured traceability before PR selection or collaborative assignment.

## Test plan

### Frontend component and integration tests

- Entry renders inherited context from actual artifact types and never renders an upload control or review-type selector.
- Entry validates name/objective, preserves values after failure, and focuses the error summary.
- Unsupported snapshot, PR, reviewer, and structured-evidence features are omitted or explicitly unavailable.
- Progress renders queued, running, stage-complete, stage-failed, blocked, cancelled, and legacy payloads.
- Activity disclosures have correct expanded state and keyboard behavior.
- Candidate findings remain labeled candidate during processing.
- Approve/Reject are absent before Pending to Review.
- Selecting either action opens the correct decision state; required rationale is enforced according to the active service contract.
- Result tabs expose correct roles, selected state, panels, and arrow-key navigation.
- Evidence limited is never rendered as Failed or Unimplemented.
- Agreed-only metrics are shown only when adjudication data exists.
- Export handles loading, success path, failure, and repeat prevention.

### Sidecar tests for any approved service follow-up

- Snapshot resolution persists a stable SHA and rejects invalid targets.
- Artifact baseline hashes remain tied to the session after project sources change.
- Progress events are ordered, durable, and do not contain secrets or raw reasoning.
- Finding decisions require rationale and preserve reviewer/timestamp history.
- Activity rejection does not claim reprocessing until a linked run exists.
- Report export includes exactly the persisted evidence and decisions for the selected session.
- Old database rows remain readable after migrations.

### Visual and accessibility QA

- Verify 1440 x 1024 to match the reference, plus the required 1440 x 900, 1200 x 900, and narrow viewport.
- Verify at 200% zoom.
- Confirm the sidebar remains stable and the content column scrolls independently.
- Confirm a sticky decision panel never covers the focused control or the final activity item.
- Confirm technical identifiers wrap safely.
- Confirm contrast, focus-visible treatment, 40 px desktop hit targets, and 44 px narrow hit targets.
- Confirm reduced motion and no decorative page-load/stagger animation.
- Confirm styles do not leak into Dynamic Testing, Projects, or Home.

Run the smallest relevant tests while iterating, then:

```bash
pnpm --filter centinel test
pnpm --filter @centinel/sidecar test
pnpm --filter centinel build
```

Run `pnpm smoke` only when the required local services and provider credentials are configured.

## Definition of done

- The workflow contains three coherent screens with the approved Centinel light theme, spacing, typography, status colors, borders, radii, and Lucide icon language.
- Review entry makes inherited context clear and does not ask the user to upload sources or choose a review type.
- Any displayed commit snapshot is resolved and persisted; otherwise the UI avoids the claim.
- Review progress reads as a chronological Centinel activity conversation with evidence details collapsed by default.
- Candidate findings are never presented as confirmed defects.
- Human decisions are visually and semantically separate from automated activity.
- Activity approval does not automatically resolve findings.
- Completed results preserve the available scope, evidence, traceability, risk, and human decision without a generic whole-product Pass/Fail.
- All counts and identities come from persisted data.
- Existing sessions and legacy progress payloads remain readable.
- Relevant frontend/sidecar tests, frontend build, required viewport checks, keyboard checks, and style-leakage checks pass.

## Recommended delivery split

The safest first release is the frontend-only redesign using current data and explicit capability gates. The first service follow-up should make snapshot binding and the source baseline immutable; the second should add structured traceability, risk, and per-finding adjudication. This order establishes trust in what was reviewed before adding richer approval and reporting language.
