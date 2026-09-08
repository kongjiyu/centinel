# Centinel UI/UX audit — 5 September 2026

Review proposal for the owner. No application changes are proposed as already approved.

## Assessment and evidence

Centinel has a coherent light sage foundation, but the working screens do not yet deliver the same clarity as Home. The largest problems concern trustworthy results, preservation of context, and evidence readability. Adding artwork alone would leave those problems intact.

Method: read DESIGN.md, the canonical PRD, the existing redesign plan, frontend components and CSS; inspect the running React frontend against existing local data. Observed Home, project workspace, a failed Static review, unified findings, Projects and Settings. Inspected the project screen at 1440×900, 1200×900 and 600×900. Dynamic run behavior, informational-finding omission, failed-request handling and some accessibility findings below are source-based, not end-to-end reproductions. No AI runs, provider tests, uploads, review decisions or exports were triggered. Browser inspection does not validate Tauri-native folder picking or clipboard behavior. This is a heuristic review, not a user study or full accessibility certification.

Verification: `pnpm --filter centinel test` passed 11 test files / 42 tests during this audit. These tests do not establish visual accessibility or invalidate the observed layout and state problems. No implementation files were edited; existing working-tree changes were retained.

## Domain and target users

Centinel is a local-first software QA decision-support workspace. Static testing compares requirements, documents and code; Dynamic testing exercises a live website and collects evidence. Its value is the chain from requirement/source to finding, evidence, human decision, follow-up test and report.

The PRD names QA engineers, testers and reviewing developers as primary users, with team leads and stakeholders secondary. DESIGN.md instead names office teams and non-technical reviewers as primary. The existing redesign plan explains the move toward an approachable office workspace, but the persona priority remains inconsistent across the source documents.

Recommendation for owner review: design the default workflow for a reviewer who understands the project's intended behavior but may not know the tooling. Preserve fast access to scope, provenance, reproducible steps and technical details for QA engineers and developers. Keep the authoritative light visual direction. Reconcile the audience statements before another broad redesign.

Users need to answer: What needs my attention? What was checked? What failed or remains unknown? What evidence supports it? What decision should I make next?

## Findings and mitigations

### 01 — High: Failed reviews use the completed-review presentation

**Observed:** Home's Inspect action opened the failed review “test findings 6”. The detail showed 71 findings, a success-style summary and Approve / Request Changes / Comment controls, without its failure reason. The surrounding row said Failed. In ProjectDetailScreen.tsx, every non-active review uses ActiveSessionComplete, which does not receive the execution status or failure reason.

**Impact:** A reviewer cannot distinguish complete analysis from partial output. Conflicting signals weaken confidence in approval.

**Mitigation:** Give failed/cancelled/partial runs explicit result states. Lead with failure reason and completed scope, label retained findings as partial, and offer a recovery action. Define whether partial results may receive a decision; if allowed, make that scope explicit. Keep execution outcome separate from the human decision.

**Acceptance:** Opening a failed run explains its failure before findings; no success icon implies full completion. Decisions clearly identify whether they apply to complete or partial work.

### 02 — High: Expanded results retain unreadable dark-theme styles

**Observed:** The Static summary computed to rgb(217,237,240) text on rgb(234,242,232), at 11px. Group headings were 10px; severity chips use 9px in command.css. Legacy dark translucent groups and pale controls are visibly washed out against the light workspace.

**Impact:** The most decision-critical part of the application is harder to read than navigation or setup.

**Mitigation:** Migrate the entire review result subtree to semantic tokens, including severity chips, locations and decision controls. Use 14px dense content and 12px only for technical metadata, following DESIGN.md. Remove superseded rules after parity, rather than adding another global override layer.

**Acceptance:** Review text and all semantic variants meet the design's contrast target, remain readable at 200% zoom, and use the same palette in inline results and overlays.

### 03 — High: Project navigation is a long page, with weak context restoration

**Observed/source:** Overview, Static testing, Dynamic testing, Findings and Reports call scrollIntoView. Overview is the content grid, without a separate setup/outcome summary. Active section is component state; App.tsx stores navigation only in useState. Detail back actions construct a generic project destination. Home's failed-review deep entry left Overview selected.

**Impact:** Users must navigate spatially through unrelated work, and returning from evidence or requirements loses the meaningful subsection and filter context.

**Mitigation:** Implement restorable project destinations using routes or equivalent persisted state. Overview should summarize setup, latest outcomes and the next action. Preserve project, section, selected run, filters and scroll position. Keep a project breadcrumb on child screens.

**Acceptance:** Open a filtered finding or run, visit its evidence, return, and recover the same list state. Reload restores the meaningful destination. Highlighted navigation matches the displayed work.

### 04 — High: Review rows sacrifice the title to metadata

**Observed:** At 1200px, “test another findings” wrapped into a narrow vertical column while timestamp, status and Re-review retained space. At 600px, the title was partly clipped. The Sources panel stretches beside a much longer Static list, leaving a large blank region.

**Impact:** Users struggle to recognize runs and scan history even at ordinary desktop window sizes.

**Mitigation:** Give the title the primary row and move date/type/status into a secondary line at reduced widths. Prefer a full-width review list or stack Sources above it. Use content-aware grid sizing and wrapping for actions; do not solve this by shrinking text further.

**Acceptance:** Long titles and all actions remain readable/reachable at 1440, 1200 and 600px, without clipped text or a disproportionately empty Sources column.

### 05 — High: Unified findings obscure history and repeat content

**Observed:** The project listed 426 findings. Several top rows repeated the same title with different statuses, including fixed, dismissed, accepted and new, without run identity in the row. A separate Static result list exposes title/location only; users must find the issue again in the unified list to read evidence and recommendations.

**Impact:** Users cannot easily tell a current issue from an older occurrence, or determine which instance a decision changes.

**Mitigation:** Reuse one finding detail component in run and project contexts. Add visible run provenance and a run filter. Offer current/open and historical views. Where stable identity exists, group occurrences while retaining the original evidence; never silently merge findings by title. Show concise issue titles and move recommendations out of titles into details. Explain the distinction between accepting a finding and approving a review.

**Acceptance:** A reviewer can identify the originating run, inspect proof and act on one finding without searching a second list. Historical occurrences remain accessible and counts state their scope.

### 06 — High: Failure can masquerade as empty data or an ignored action

**Source:** Project session loaders and FindingsPanel swallow request errors. An initial failure can leave an empty list; finding-status updates also swallow failures. Dynamic cancellation has the same silent catch pattern. EvidenceBrowser already provides a stronger error/Retry pattern.

**Impact:** “No findings” can mean unavailable data, and users cannot tell whether a decision was saved.

**Mitigation:** Reuse explicit loading, empty, stale and error states. Keep previous data visible when refresh fails, with an unavailable/stale notice. Add pending and failure feedback beside finding actions and cancellation, with safe retry.

**Acceptance:** A failed request never produces a clean empty-result claim. Failed updates visibly explain that the change was not saved.

### 07 — High: Informational findings are counted but not listed in Static results

**Source:** ActiveSessionComplete counts findings.length but groups only critical, high, medium and low. FindingsPanel supports info.

**Impact:** The review summary can advertise findings that cannot be opened there.

**Mitigation:** Use a shared severity model, include informational and unknown severities, and reconcile visible group counts with the total.

**Acceptance:** A review containing informational findings exposes them and every finding contributes to exactly one displayed group.

### 08 — Medium: Home activity does not provide a direct path to its run

**Observed/source:** Recent activity shows named historical runs, but the available disclosure expands project metrics. Active reviews and indexed-source counts repeat for multiple rows from the same project. Hover inserts content into the table. Quick starts silently select the latest project; their labels do not name it.

**Impact:** Users see the item they want but cannot directly open it. Historical rows reveal current project metrics without clearly distinguishing the scope.

**Mitigation:** Make each run name a direct navigation target. Keep metrics available through an explicit disclosure and label them as current project totals. Avoid hover-driven row-height changes. Name the selected project in quick starts and allow switching it before submission.

**Acceptance:** Every activity opens the exact run; metrics identify their time/project scope; quick starts make the destination project unambiguous.

### 09 — Medium: Home attention needs a resolution lifecycle

**Observed/source:** Home prioritizes an older failure even though newer completed reviews exist. Highlight selection scans historical failures without an acknowledgement/resolution state. It takes one item per project and at most four projects, displaying that truncated count.

**Impact:** Historical failures can persist as urgent work indefinitely, while the displayed count can be mistaken for all pending actions. A later success alone is not sufficient evidence that an older failure is resolved.

**Mitigation:** Define explicit resolved, acknowledged or superseded relationships. Preserve failed history, but let the attention queue represent outstanding human work. Provide “Showing 4 of N” and a view-all destination when capped.

**Acceptance:** Reviewed historical failures can leave the queue without deleting history or being silently cleared by an unrelated successful run.

### 10 — Medium: “Ready” overstates what is known

**Source/observed:** AppShell computes readiness from hasApiKey plus the initial service load. The UI says “Services ready — Ready”; Settings says “Configured”. These do not establish successful authentication, model capability or a current connection.

**Mitigation:** Distinguish Configured, Connection verified, Check failed and Unknown, with a last-checked time where available. Use a neutral “Services” label. Explain the relevant dependency when starting a task.

**Acceptance:** A saved but unverified key produces Configured, not a verified readiness claim.

### 11 — Medium: Dynamic results and reports prioritize setup/export over interpretation

**Source:** DynamicSessionScreen repeats goal, test type and start time between header and info block; summary/failure follows setup metadata. While running, it offers a generic running message without a clear current step/elapsed context. Action trace items show summaries and raw file paths. Project Reports primarily offers export and a saved path, without visible run inclusion or preview.

**Mitigation:** Lead Dynamic results with outcome, scope, failure and next action; show current step during execution. Put setup facts in a compact disclosure. Pair actions and screenshots in an ordered evidence timeline. Give Reports an inclusion summary and preview before export; keep paths secondary.

**Acceptance:** A reviewer can explain what ran, what failed and which evidence supports it without exporting or opening raw files. Report inclusion identifies actual run names/times, not just “latest”.

### 12 — Medium: Settings repeats headings and exposes implementation detail too early

**Observed:** Text AI appears as both eyebrow and heading, followed by a nested Text Generation card; Vision has the same pattern. Provider, key, Base URL, Model and disabled API Format are all exposed together.

**Mitigation:** Use one provider section per purpose, with one heading and a concise capability explanation. Put endpoint/format in advanced settings where appropriate; custom providers may expand these automatically. Give connection feedback a clear location beside Save/Test.

**Acceptance:** Each provider has one readable identity, one configuration region, and clearly separated saved configuration versus tested connection state.

### 13 — Medium: Form accessibility is inconsistent

**Source:** Projects, Requirements and Settings contain adjacent label/input elements without htmlFor/id association; DynamicTestForm has explicit associations. Static finding group toggles lack aria-expanded, unlike the unified findings disclosure.

**Mitigation:** Standardize a shared labelled field and disclosure primitive. Associate helper/error text, expose invalid and expanded state, and verify keyboard focus and accessible names.

**Acceptance:** Each field can be located by its visible label; disclosures announce their state; validation provides a usable route to the affected field.

## Appearance and art direction

The sage canvas, forest interaction color, local font and restrained outline icons are worth retaining. Home is the strongest current composition. The appearance gap comes from uneven execution: a large greeting beside tiny operational text, repeated rounded containers, excessive framing, stretched blank panels, and multiple token layers that leave legacy colors active.

Proposed art direction: an approachable evidence workspace. Use typography and alignment to create hierarchy; put findings and screenshots in the best visual positions. Use borders for table structure and reserve elevation for genuine overlays or the approved Home panels. Keep one consistent icon stroke and shared spacing/radius tokens. Make concise finding titles visually dominant over tags and IDs.

Home already has a custom review illustration, but it is barely perceptible in the inspected composition. Refine its placement and silhouette so it contributes to the header area without sitting under working text. Keep it restrained and decorative. Do not spread illustrations into result rows; screenshots and trace relationships are the appropriate visual material there. A stronger illustration is optional polish after the reading and workflow defects are fixed.

Normalize “Test Plan” to “Suggested tests”, source/module labels and sentence case. Place suggested tests within Static testing rather than after Reports. The execution handoff from suggested tests is not implemented in the inspected TestPlanPanel; label that boundary clearly rather than imply that acceptance runs a browser test.

## Suggested review order

1. **Trust and readability:** findings 01, 02, 06, 07 and 10. Correct misleading state and unreadable evidence first.
2. **Workflow and density:** findings 03, 04, 05, 08, 09 and 11. Resolve navigation, history and result structure together.
3. **Consistency and visual finish:** findings 12 and 13 plus shared tokens, terminology and restrained illustration refinement. Accessibility remains a requirement throughout.

Owner decisions before implementation: reconcile primary persona; choose partial-review decision policy; choose default current/open findings scope and history treatment; agree attention-item resolution rules. The existing DESIGN.md remains authoritative until any changes are explicitly approved.
