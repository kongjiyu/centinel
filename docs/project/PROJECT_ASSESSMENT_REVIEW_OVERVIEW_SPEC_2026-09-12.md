# Project Assessment and Review Overview Refinement Specification

Status: implemented in the working tree; issue publication remains optional  
Date: 12 September 2026  
Scope: Project Overview, Project Assessment, Project Findings, Review Overview, Review Traceability, and the persisted review evidence contracts that support them

## Problem Statement

Centinel presents related quality information across Project Overview, Assessment, Findings, Review Overview, and Traceability without sufficiently distinct responsibilities. Project Overview and Assessment repeat broad risk and evidence signals; Assessment currently mixes source availability, Review signals, Dynamic Testing signals, and inferred risk dimensions; Review Overview summarizes severity and priority even though it should explain what happened in one Review; and detailed findings or traceability can be repeated where a summary and a link would be clearer.

This overlap makes it difficult for a project member to answer a simple question at each destination. Project Overview should identify what needs attention now. Assessment should report the project's current finding-derived risk. Project Findings should remain the complete finding inventory. Review Overview should summarize one persisted Review session. Review Traceability should contain the detailed requirement-to-evidence relationships for that Review.

The current data contracts cannot yet support the proposed reporting honestly:

- finding severity is persisted, but finding priority is only optional in the frontend finding model and is not stored in the primary finding record;
- no shared deterministic Severity + Priority policy currently produces a canonical Risk Level;
- Review execution receives the project's current artifact collection, but it does not persist an immutable manifest of the sources actually included or consumed by that Review;
- the Review's supportive-document configuration and generated Review artifacts are not an authoritative input-source manifest;
- Review Traceability currently combines project-level requirements, mappings, artifacts, finding categories, and free-text token matches in the client, so it is not a trustworthy session-scoped evidence snapshot;
- missing historical data can be rendered as a numerical zero unless every new metric has an explicit unavailable state.

Without correcting these contracts first, polished risk counts, artifact totals, and traceability attention counts could look authoritative while describing current project state, inferred text relationships, or absent data rather than the Review the user is inspecting.

## Solution

Refine the existing screens without replacing Centinel's visual system or established navigation.

Project Overview remains a concise briefing and navigation surface. Its existing Need attention section gains at most three recurring finding patterns computed across distinct completed, approved Review sessions. Project Readiness and Recent activity remain in place. Full risk distributions, risk-item tables, and traceability details do not appear on Overview.

Assessment becomes a focused project risk report containing only a Risk Summary and the five most relevant unresolved Critical or High Risk findings. Risk counts are derived from a single versioned Centinel policy that combines persisted Severity and persisted Priority. The page also summarizes requirements needing traceability attention from the latest completed, approved Review and links directly to that Review's Traceability tab. An accessible information dialog explains Severity, Priority, Risk Category, Risk Level, and the exact Centinel Risk Matrix v1 without presenting the policy as an ISO/IEEE mandate.

Project Findings remains the complete finding inventory and the destination for detailed inspection and filtering. Assessment links into that existing workspace with Critical/High Risk and unresolved filters when the shared navigation contract can represent them.

Review Overview keeps its current Overview/Decision 8/4 composition, Objective, Summary, decision facts, and visual treatment. Its three metrics become Reported Findings, Artifacts Reviewed, and Traceability Attention, all scoped to the selected Review. A full-width Sources Used section below the 8/4 row lists the Review's persisted input sources, grouping repository and directory inputs and keeping individual documents as separate rows.

At Review execution time, Centinel records a session-scoped Review Source Manifest and session-scoped traceability result. These persisted records—not the project's later contents—become authoritative for Review Overview, Sources Used, Review Traceability, Assessment's latest-Review attention count, and applicable exports. Historical sessions without these records show **Not available for this review** or an equivalent honest fallback; they do not report zero.

The refinement reuses existing cards, tables, tabs, badges, spacing, typography, modal behavior, responsive breakpoints, and shared Findings presentation. It adds no gradient, decorative dashboard treatment, nested-card hierarchy, or invented operational metric.

## User Stories

1. As a project member, I want Project Overview to remain a concise briefing, so that I can understand what needs attention without reading a full report.
2. As a project member, I want Need attention to include recurring finding patterns, so that I can recognize issues that repeatedly survive across Reviews.
3. As a project member, I want recurring patterns counted by distinct completed, approved Review sessions, so that carry-over and duplicate rows do not exaggerate recurrence.
4. As a project member, I want recurring patterns grouped by persisted category first, so that stable domain classification is preferred over wording variations.
5. As a project member, I want normalized finding titles used only when category is unavailable, so that unclassified findings can still contribute to a useful pattern.
6. As a project member, I want at most three recurring patterns on Overview, so that the section remains a short attention list.
7. As a project member, I want to open Project Findings from a recurring pattern, so that I can inspect every matching finding.
8. As a project member, I want the corresponding category or search filter applied when I open a recurring pattern, so that the destination preserves my context.
9. As a project member, I want Project Readiness to remain separate from risk, so that source availability is not mistaken for project safety.
10. As a project member, I want Recent activity to remain available on Overview, so that I can navigate to the Review or Dynamic Testing session that produced evidence.
11. As a project member, I do not want the full risk distribution on Overview, so that Assessment remains the single project risk destination.
12. As a project member, I do not want the traceability table on Overview, so that Review Traceability remains the evidence-detail destination.
13. As a project member, I want Assessment to answer what risk the project currently carries, so that the page has one unambiguous purpose.
14. As a project member, I want Assessment limited to Risk Summary and Risk Items, so that readiness, recurrence, trends, and complete inventories are not duplicated.
15. As a project member, I want Critical, High, Medium, and Low Risk counts, so that I can scan the distribution of current project risk.
16. As a project member, I want those counts based on derived Risk Level rather than raw Severity, so that impact and remediation urgency both affect classification.
17. As a project member, I want resolved and dismissed findings excluded from current risk counts, so that the summary describes current exposure.
18. As a project member, I want informational findings retained in Project Findings but excluded from risk aggregation, so that information is not silently promoted to Low Risk.
19. As a project member, I want an explicit unavailable state when a finding lacks persisted Priority, so that incomplete historical data is not assigned a fabricated risk.
20. As a project member, I want requirements needing traceability attention summarized inside Risk Summary, so that important evidence gaps are visible alongside current risk.
21. As a project member, I want Missing and Incomplete counts shown separately, so that I can distinguish absent evidence from partial evidence.
22. As a project member, I want Complete requirements excluded from the attention total, so that the count is actionable.
23. As a project member, I want missing or incomplete traceability described as attention rather than failure, so that lack of evidence is not misrepresented as proof of implementation failure.
24. As a project member, I want traceability attention linked to the latest completed, approved Review, so that I can inspect the evidence behind the project summary.
25. As a project member, I want the link to open that Review's Traceability tab directly, so that I do not have to rediscover the relevant evidence.
26. As a project member, I want a clear fallback when no completed, approved Review has a traceability snapshot, so that absence is not rendered as zero attention.
27. As a project member, I want Assessment to show at most five current Critical or High Risk findings, so that the page remains an attention surface rather than a second inventory.
28. As a project member, I want each Risk Item to show Risk Level, Severity, Priority, title, category, and status, so that I can understand why it is prominent.
29. As a project member, I want Risk Items sorted by Risk Level, Priority, Severity, and recency, so that the most consequential and urgent current work appears first.
30. As a project member, I want See More Findings to open Project Findings, so that detailed investigation uses the established workspace.
31. As a project member, I want See More Findings to preserve Critical/High Risk and unresolved filters when supported, so that I can continue the same task.
32. As a project member, I want an information icon beside Assessment, so that unfamiliar risk terminology is explained at the point of use.
33. As a keyboard user, I want the Assessment information control and dialog fully operable, so that the explanation is accessible without a pointer.
34. As a keyboard user, I want the dialog to have a labelled title, initial focus, focus containment, Escape close, a visible Close control, and focus restoration, so that it follows Centinel's dialog contract.
35. As a project member, I want Severity explained as potential impact, so that I do not confuse it with urgency.
36. As a project member, I want Critical, High, Medium, and Low Severity described consistently, so that I can interpret finding impact.
37. As a project member, I want Priority explained as remediation or review urgency, so that I understand why it may differ from Severity.
38. As a project member, I want Priority limited to High, Medium, and Low, so that risk derivation uses a canonical vocabulary.
39. As a project member, I want an example where Severity and Priority differ, so that their independence is concrete.
40. As a project member, I want Risk Category explained as the concern's domain, so that Security or Requirement is not treated as impact or urgency.
41. As a project member, I want Risk Level explained as a derived classification, so that I know it is not another author-entered label.
42. As a project member, I want the complete Centinel Risk Matrix v1 visible in the dialog, so that risk calculation is transparent and reproducible.
43. As a project member, I want the dialog to state that the matrix is Centinel policy rather than an ISO/IEEE mandate, so that standards provenance is represented honestly.
44. As a reviewer, I want Review Detail to preserve its breadcrumb, Review name, lifecycle badge, tabs, and established composition, so that this refinement does not disrupt navigation.
45. As a reviewer, I want Review Overview to explain one Review session, so that project-wide risk does not obscure what happened in this run.
46. As a reviewer, I want Reported Findings to count persisted findings produced by this Review, so that the value is session-scoped.
47. As a reviewer, I want carry-over findings distinguished from findings newly produced by the Review, so that Reported Findings does not silently overstate new output.
48. As a reviewer, I want Artifacts Reviewed to count unique persisted inputs actually included or consumed by this Review, so that later project changes cannot alter the metric.
49. As a reviewer, I want unreadable or excluded artifacts omitted from Artifacts Reviewed, so that the number does not claim coverage Centinel did not obtain.
50. As a reviewer, I want Traceability Attention to show Missing plus Incomplete requirements for this Review, so that evidence limitations are visible in the session summary.
51. As a reviewer, I want the Traceability Attention metric to open the Review's Traceability tab, so that summary and proof stay connected.
52. As a reviewer, I want Review Overview to omit Critical Severity and High Priority metric cards, so that per-Review summary is not confused with project risk reporting.
53. As a reviewer, I want Objective and Summary to retain their current layout, so that familiar Review context remains stable.
54. As a reviewer, I want a missing objective shown as **Not specified**, so that an absent value does not consume excessive space or imply a system failure.
55. As a reviewer, I want Summary to describe the Review outcome without repeating the project risk report, so that each page remains focused.
56. As a reviewer, I want the Decision panel to retain decision, reviewer, scope, completion time, duration, and supported rationale, so that the Review remains auditable.
57. As a reviewer, I want missing Decision facts labelled as unavailable or not supplied, so that Centinel does not invent reviewer or timing data.
58. As a reviewer, I want Review approval kept separate from finding lifecycle, so that approving a Review does not resolve its findings.
59. As a reviewer, I want a full-width Sources Used section below Review Overview and Decision, so that I can identify the evidence packet without crowding the summary.
60. As a reviewer, I want Sources Used to list Source, Type, and Review Scope, so that I can understand what material the Review consumed.
61. As a reviewer, I want repository and directory inputs grouped, so that a large tree does not produce an unusable file dump.
62. As a reviewer, I want grouped sources to show their reviewed file count, so that the effective scope remains measurable.
63. As a reviewer, I want uploaded requirement, coding-standard, and design documents listed individually, so that named governing documents remain identifiable.
64. As a reviewer, I want source labels and kinds persisted with the Review, so that renamed or removed project sources do not rewrite history.
65. As a reviewer, I want historical Reviews without a source manifest to show an honest unavailable state, so that absence is not reported as zero artifacts.
66. As a reviewer, I want Review Traceability to use the same Complete, Incomplete, and Missing states as every summary, so that state meaning is stable.
67. As a reviewer, I want Review Traceability to show structured persisted requirement-to-source relationships, so that evidence is auditable.
68. As a reviewer, I do not want arbitrary free-text matches to manufacture traceability relationships, so that plausible wording is not mistaken for proof.
69. As a reviewer, I want current project edits to leave a completed Review's traceability unchanged, so that the Review remains a reproducible snapshot.
70. As a project member, I want one deterministic risk policy used by Assessment, Findings, and exports, so that the same finding never receives different Risk Levels.
71. As a project member, I want the risk policy version associated with derived output, so that future policy changes do not silently reinterpret historical reports.
72. As a project member, I want Priority persisted independently from Severity, so that urgency can be changed or reviewed without rewriting impact.
73. As a project member, I want Risk Category persisted independently from Severity and Priority, so that domain classification remains intact.
74. As a project member, I want Project Findings to expose Severity, Priority, Risk Level, Risk Category, status, description, evidence, and recommendation when available, so that it remains the complete record.
75. As a project member, I want the same finding lifecycle used throughout the product, so that unresolved, resolved, and dismissed mean the same thing in every view.
76. As a report consumer, I want exported Review information to use the Review's source manifest and traceability snapshot, so that exports agree with the on-screen Review.
77. As a report consumer, I want exported risk classification to use the shared deterministic policy, so that exports agree with Assessment and Findings.
78. As a product owner, I want every new metric derived from persisted application data, so that Centinel never presents a mocked operational result.
79. As a product owner, I want unknown values displayed as unknown, so that a zero always means a measured zero.
80. As a product owner, I want the existing Centinel visual language preserved, so that the refinement feels native to the product.
81. As a product owner, I want no new Risk Assessment tab in Review Detail, so that project-level risk remains at Project Detail.
82. As a product owner, I want Review Activity, Findings, and Traceability behavior preserved, so that the information-architecture change does not remove existing capabilities.
83. As a narrow-screen user, I want the Assessment, Review Overview, Decision, and Sources Used layouts to reflow without horizontal loss, so that the experience remains usable at supported widths.
84. As an assistive-technology user, I want tables, metric links, tabs, buttons, dialog pages, and status text to retain semantic names and states, so that the refinement remains perceivable and operable.

## Implementation Decisions

- Treat this specification, once approved, as a narrow amendment to the current design contract for Project Assessment and Review Overview. It preserves the visual system and interaction rules while replacing the existing source-separated Assessment composition with the finding-derived risk report described here. Update the design source of truth in the same change so implementation guidance does not remain contradictory.
- Preserve the Project Detail tab order and the Review Detail tab set. Do not add Risk Assessment to Review Detail or move Project Findings into Assessment.
- Use the existing Project Detail and Review Detail screens as the highest frontend composition seams. Extend existing card, table, tab, status, dialog, and shared Findings primitives rather than creating parallel presentation systems.
- Use the sidecar HTTP boundary as the primary integration seam. Expose session-scoped Review evidence and project-scoped Assessment data through stable response contracts so screen code does not reconstruct persistence rules independently.
- Introduce a shared risk-domain module owned outside React. It normalizes canonical Severity and Priority values and implements `deriveRiskLevel(severity, priority, policyVersion)` as the only risk-classification function.
- Define Centinel Risk Matrix v1 as follows:

  | Severity ↓ / Priority → | High | Medium | Low |
  |---|---|---|---|
  | Critical | Critical | Critical | High |
  | High | Critical | High | Medium |
  | Medium | High | Medium | Low |
  | Low | Medium | Low | Low |

- Treat `Info` as a valid finding Severity where legacy and informational findings require it, but return no Risk Level for `Info`. Do not coerce `Info` to Low.
- Persist finding Priority using canonical lowercase storage values `high`, `medium`, and `low`. Normalize casing at the service boundary and reject unsupported new values rather than silently defaulting them.
- Migrate historical finding records backward-compatibly. A historical finding without trustworthy Priority remains unclassified for risk aggregation until Priority is supplied or a documented migration rule can recover it from persisted source data. Do not default old records to Medium solely to populate the UI.
- Keep Risk Level derived instead of storing a mutable duplicate. Include the risk-policy version in Assessment/report metadata or the persisted evidence snapshot so historical output remains explainable if a later policy is introduced.
- Compute project Risk Summary from current unresolved findings only. Current means the existing product lifecycle's unresolved states; resolved/fixed and dismissed findings are excluded. Deduplicate carry-over and re-review representations by stable lineage when available so one logical current finding contributes once.
- Order Risk Items by Risk Level descending, then Priority descending, then Severity descending, then latest persisted update/creation time descending. Limit the Assessment surface to five items with Risk Level Critical or High.
- Extend the shared Findings filter/navigation contract to accept initial Risk Level, lifecycle status, category, and search state. If URL-like screen state cannot yet preserve multiple Risk Levels, open Project Findings and apply the closest supported filter without creating a second findings implementation.
- Compute recurring patterns only from distinct completed, approved Review sessions. Group by non-empty normalized persisted category; otherwise group by a conservative normalized title key. Count each pattern at most once per Review and exclude Dynamic Testing sessions from this Review recurrence metric.
- Add a session-scoped Review Source Manifest with a manifest header and normalized source items. Each item records session identity, stable source identity when available, source kind (`repository`, `directory`, `document`, or `drive`), display label, unique artifact identities, file count, and capture time. Preserve enough immutable identity, including content hashes where available, to explain the reviewed snapshot after project changes.
- Build the manifest from the effective execution scope, not from the project source list when the Review is later opened. Record artifacts successfully accepted by the static-analysis/prompt/tool-read pipeline, deduplicate artifact identities, exclude inputs that could not be read, and finalize the manifest with the Review's terminal execution evidence.
- Group repository and directory manifest items in Sources Used and show their unique reviewed-file counts. Keep individual documents as individual manifest items. Do not infer directory membership from filename text when the ingestion layer has a source relationship it can persist.
- Define Artifacts Reviewed as the number of unique artifact identities recorded in the finalized Review Source Manifest. If the manifest is unavailable or incomplete, return an unavailable state rather than `0`.
- Keep generated Review artifacts separate from input sources. Analysis summaries and generated reports do not count as Sources Used unless they were independently supplied as inputs to a later Review.
- Persist a session-scoped traceability snapshot that records the requirement identity/version, linked source or artifact identities, canonical state, confidence/evidence metadata where supported, and capture time. The snapshot is the authority for completed Review Traceability.
- Introduce one shared `TraceabilitySummary` calculation over persisted snapshot records with `complete`, `incomplete`, `missing`, and `attention = incomplete + missing`. Use it for Review Overview, Review Traceability filters/counts, Project Assessment's latest-Review attention summary, and applicable exports.
- Stop using free-text finding-title/description token matching to establish traceability. Category equality may support discovery in a non-authoritative UI, but it must not change a requirement's persisted traceability state.
- Select the latest completed, approved Review for Project Assessment traceability attention. Technical `success` without approval remains Need Approval and is not treated as a completed project evidence baseline.
- Preserve session immutability in Review Overview. Later project artifact, requirement, or mapping changes must not change a completed Review's Reported Findings, Artifacts Reviewed, Sources Used, or Traceability Attention.
- Define Reported Findings as findings whose originating session is the selected Review. Present or separately identify carry-over findings so they are not silently described as newly reported by that Review.
- Keep Review execution lifecycle, human Review Decision, and per-finding lifecycle as separate contracts. An approved Review can contain unresolved findings; approval never mutates finding status.
- Render unknown service values with a consistent **Not available for this review**, **Not supplied**, or em dash presentation appropriate to the surface. Reserve numeric zero for a successfully loaded, measured empty set.
- Use one accessible Assessment information dialog with three navigable pages: Severity, Priority, and Risk Measurement. Reuse the shared dialog primitive and either semantic tabs or Previous/Next controls. The dialog must satisfy the design system's focus, Escape, close-control, and focus-restoration requirements.
- Preserve the Review Overview/Decision 8/4 desktop row and add Sources Used as the next full-width row. At narrow widths, stack Review Overview, Decision, and Sources Used in reading order.
- Keep Objective and Summary compact. Render a missing Objective as **Not specified**. Summary remains a session outcome narrative and does not restate the project Risk Summary.
- Keep the Decision panel sourced from persisted Review decision/configuration/progress records. Do not infer the decision author from assignment or invent completion time or duration.
- Update report generation to consume the same Review Source Manifest, Traceability Summary, and risk-domain module used by the UI when the report includes those concepts.
- Preserve backward compatibility for existing databases and API consumers. New response fields should be additive, and historical sessions without new snapshots remain readable with explicit availability metadata.

## Testing Decisions

- Prefer the highest observable seam. Use sidecar HTTP contract tests as the primary evidence that persisted Priority, Review Source Manifest, session traceability snapshot, Risk Summary inputs, and availability states survive write/read cycles. Do not test SQL statement text when the same behavior can be proven through the service boundary.
- Use the existing Project Detail and Review Activity screen-level React tests as the primary UI seams. Assert roles, accessible names, displayed values, navigation results, filter state, and honest fallbacks rather than CSS class names or component internals.
- Add focused pure-domain tests for the complete Centinel Risk Matrix v1 because it is a small deterministic policy with safety-critical edge cases. Cover all twelve Severity/Priority combinations, case normalization at the boundary, `Info`, missing Priority, and unsupported values.
- Add focused pure-domain tests for `TraceabilitySummary` and recurrence grouping because these calculations must be identical across multiple consumers. Cover complete-only, mixed, empty-but-known, unavailable, duplicate mapping rows, duplicate findings within one Review, carry-over findings, missing categories, and normalized-title fallback.
- Test database migration through the sidecar boundary with both a fresh database and a representative pre-migration database. Verify historical findings and Reviews remain readable and do not acquire fabricated Priority, Risk Level, source totals, or traceability totals.
- Test Review execution with a repository group, a directory group, individual documents, duplicate artifact references, an unreadable artifact, and a scoped Review. Verify the finalized manifest contains only the effective unique inputs and remains unchanged after project sources are added, renamed, or removed.
- Test both Review execution paths so pre-fetched content and tool-read content record the same manifest semantics. A metric must not depend on which path the dispatcher selected.
- Test that generated Review reports/analysis artifacts are not counted as input sources.
- Test Review findings at the service boundary. Verify Reported Findings is session-scoped, project findings from other sessions are excluded, and carry-over items are not silently counted as newly produced findings.
- Test session-scoped traceability persistence using structured mappings. Verify Complete, Incomplete, and Missing states survive reload, produce the expected summary, and remain unchanged after project-level mappings change.
- Test that free-text overlap between a requirement and finding does not create or upgrade a traceability relationship.
- Test Project Overview with zero, one, three, and more than three recurring patterns. Verify distinct approved-Review counting, category-first grouping, title fallback, deterministic ordering, the three-item cap, and navigation into Project Findings.
- Test that unsuccessful, cancelled, running, Need Approval, Dynamic Testing, and unapproved Review sessions do not contribute to completed-Review recurrence.
- Test Assessment with all risk levels, more than five high-risk items, equal-ranked items, resolved/fixed findings, dismissed findings, carry-over duplicates, informational findings, historical findings without Priority, and service failures.
- Verify Assessment renders only Risk Summary and Risk Items as primary sections. Confirm recurring patterns, Open Risk Trend, readiness/evidence coverage, full Findings, and full Traceability do not appear there.
- Verify Risk Summary counts derived Risk Levels rather than Severity counts using examples where the two differ.
- Verify traceability attention selects the latest completed, approved Review, shows Missing and Incomplete separately, excludes Complete, never calls them failed requirements, and opens that Review's Traceability tab.
- Verify Risk Items show at most five unresolved Critical/High Risk findings in the specified order and See More Findings opens the shared Findings workspace with the supported filter state.
- Verify the Assessment information icon opens one dialog with all three pages, the full risk matrix, the distinction among Severity, Priority, Risk Category, and Risk Level, and the statement that the matrix is Centinel policy.
- Verify the information dialog's initial focus, keyboard navigation, Escape handling, visible Close action, focus trap, and focus restoration using the shared dialog behavior tests where possible.
- Test Review Overview for queued/running, Need Approval, approved Completed, failed, cancelled, and historical sessions. Verify metrics show persisted values only when available and do not substitute zero during loading, failure, or missing-manifest states.
- Verify Review Overview replaces Critical Severity and High Priority with Reported Findings, Artifacts Reviewed, and Traceability Attention while preserving Objective, Summary, Decision, Reviewer, Review Scope, Completed, Duration, and supported decision rationale.
- Verify a missing Objective renders **Not specified** and does not create an oversized empty surface.
- Verify Traceability Attention opens the Review's Traceability tab and that detailed requirement relationships do not appear on Overview.
- Verify Sources Used follows the 8/4 plus 12-column structure at desktop widths, groups repository/directory inputs, lists documents individually, exposes full source names accessibly, and uses an honest historical fallback.
- Reuse prior art from the existing screen tests for accessible tabs, shared Findings behavior, direct Traceability navigation, decision separation, dialog behavior, and project attention surfaces.
- Run targeted frontend tests for Project Detail, Review Activity, and shared Findings while iterating; then run the complete frontend suite and frontend production build.
- Run sidecar TypeScript validation and the smallest complete sidecar suite that covers database migration, static-session routes, execution paths, report export, and finding persistence. Add missing sidecar contract coverage where no prior test exists.
- Visually verify at 1440×900, 1200×900, and a narrow viewport. Confirm the 8/4 and full-width rows, risk table, modal content, source grouping, tab navigation, table overflow, and focus indicators remain usable and that styles do not leak into unrelated screens.

## Out of Scope

- Redesigning Project Detail, Review Detail, global navigation, the desktop shell, or Centinel's visual system.
- Adding a Risk Assessment tab to Review Detail.
- Replacing Project Findings or Review Traceability with new duplicate workspaces.
- Adding an Open Risk Trend, composite project score, readiness score, or any other invented metric.
- Treating Dynamic Testing evidence as finding-derived Review risk in this specification. Existing Dynamic Testing functionality remains intact, but a future cross-module risk model requires its own explicit policy and comparable persisted evidence.
- Treating missing or incomplete traceability as proof that a requirement failed implementation.
- Treating Review approval as resolution, acceptance, or dismissal of individual findings.
- Converting informational findings to Low Severity or Low Risk.
- Backfilling historical Priority, source manifests, or traceability snapshots from guesses, current project state, filenames, or free-text similarity.
- Persisting a mutable Risk Level that can drift from the shared policy; Risk Level is derived from canonical inputs and a named policy version.
- Listing every repository or directory file in Sources Used.
- Changing the AI provider, core Review analysis algorithm, collaboration model, authentication, or Review lifecycle beyond the evidence contracts required here.
- Destructive database resets or incompatible API/schema migrations.
- Mocking production operational metrics or returning zero for unavailable data.

## Further Notes

### Page responsibility invariant

- Project Overview answers: **What currently needs attention in this project?**
- Project Readiness answers: **Do we have suitable project artifacts and context?**
- Project Assessment answers: **What finding-derived risk does the project currently carry?**
- Project Findings answers: **What issues exist and what are their details?**
- Review Overview answers: **What happened during this specific Review?**
- Review Activity answers: **How did this Review progress?**
- Review Findings answers: **What findings were generated by or carried into this Review?**
- Review Traceability answers: **What persisted requirement-to-evidence relationships support this Review?**

Detailed evidence should have one home. Summary surfaces link to that home instead of reproducing it.

### Current-state findings that constrain implementation

1. Project Assessment currently renders inferred Review and Dynamic Testing dimensions plus source availability. This specification intentionally replaces that composition with finding-derived risk. Because the authoritative design document currently says Assessment owns source-separated Review and Dynamic Testing information and does not invent an aggregate score, implementation must update that design decision explicitly rather than leave contradictory guidance.
2. The primary finding table stores Severity, category, lifecycle, evidence, and recommendation but not Priority. A separate requirement Priority field and unrelated risk-scoring structures are not substitutes for finding Priority.
3. Review creation currently passes the complete current artifact collection into execution. It stores instructions, mode, reviewer, pull-request context, supportive-document metadata, and changed-file scope, but not an authoritative input manifest.
4. Generated Review artifacts are persisted separately and represent Review output. They must not be repurposed as the input-source manifest.
5. Review Traceability currently derives state on the client from live project requirements and mappings and augments related findings with category and token matching. That implementation cannot serve as the authoritative session traceability source required by this specification.
6. Existing Review Overview already provides the correct 8/4 Overview/Decision structure, accessible result tabs, shared Findings workspace, Objective, Summary, decision facts, and honest duration fallback. The refinement should extend those seams rather than reconstruct the page.
7. Existing Project Detail and Review Activity screen tests are useful frontend prior art. Sidecar coverage for these new persistence contracts is limited and must be added at the HTTP/service boundary.

### Metric definitions

- **Reported Findings:** persisted findings originating from the selected Review session; carry-over is disclosed or reported separately.
- **Artifacts Reviewed:** unique artifact identities in the selected Review's finalized source manifest.
- **Traceability Attention:** `missing + incomplete` in the selected Review's persisted traceability snapshot.
- **Recurring Review Pattern:** the number of distinct completed, approved Review sessions containing at least one finding in the grouped category/title pattern.
- **Current Project Risk:** derived Risk Levels for deduplicated unresolved current findings with trustworthy persisted Severity and Priority.

### Availability invariant

Every metric response distinguishes at least these states:

- **available:** calculation completed from the authoritative persisted source, including a legitimate value of zero;
- **unavailable:** the Review predates the required persisted contract or lacks trustworthy inputs;
- **loading/error:** the authoritative source has not loaded or could not be retrieved.

The UI must never collapse unavailable, loading, or error into zero.

### Delivery order

1. Add and verify backward-compatible Priority, risk-policy, source-manifest, and traceability-snapshot contracts.
2. Populate those contracts during Review execution and expose stable sidecar read models.
3. Update Review Traceability and Review Overview to consume the session snapshot and manifest.
4. Update Project Findings with Risk Level presentation and filter-state support.
5. Replace Project Assessment with Risk Summary, traceability attention, and Risk Items.
6. Add recurring patterns to Project Overview Need attention.
7. Update applicable exports and complete responsive/accessibility verification.

This ordering prevents UI surfaces from shipping ahead of the persisted evidence needed to make their metrics truthful.
