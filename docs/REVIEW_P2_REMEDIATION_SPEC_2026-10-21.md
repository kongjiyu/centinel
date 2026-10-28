# Review quality remediation specification — P1 and P2

Date: 21 October 2026. Status: implemented locally; see [acceptance evidence and limits](REVIEW_REMEDIATION_ACCEPTANCE_2026-10-21.md). The requirements below remain the behavioral contract; the original planning table is retained for traceability.

## Purpose and scope

Address all ten findings in the [quality audit](REVIEW_QUALITY_AUDIT_2026-10-21.md): six P1 and four P2. Invalid AI output must not resolve issues, unsupported observations must not inflate risk, and human decisions must refer to complete, frozen, correctly scoped evidence. Reviewers must also be able to follow assessments to findings, distinguish current issues from historical observations, identify the latest execution independently of decisions, and recognize stale readiness results. The existing P2 filenames are retained to preserve links; this document and its companion plan now cover both priorities.

| ID | Audit finding | Desired outcome |
| --- | --- | --- |
| P1-01 | Invalid model responses create false clean results and resolution | Invalid/incomplete assessments cannot establish successful completion or absence-based resolution |
| P1-02 | Unsupported model claims remain risk-bearing findings | Only sufficiently grounded observations enter ordinary findings and risk |
| P1-03 | Failed traceability reads do not block approval | Evidence read failures block decisions until successful recovery |
| P1-04 | Historical Review sources display current editable inventory | Review evidence shows frozen reviewed versions and scope |
| P1-05 | Traceability reuses stale mappings outside scope | Frozen, scoped requirements and version-backed mappings determine traceability |
| P1-06 | Retry excludes repaired sources | Users explicitly choose saved-source or updated-source recovery |
| P2-01 | Grounding sanitation removes feature/path/domain links | Validated associations survive persistence and open the supporting finding |
| P2-02 | Report inventory presents historical occurrences as current | Exports distinguish canonical current issues from immutable occurrences |
| P2-03 | Mutable timestamps choose the wrong latest Review | Later human decisions cannot reorder Review executions |
| P2-04 | Stale readiness verdicts are unqualified | Previous assessment results and current assessment progress are visibly distinct |

Authority: [DESIGN.md](../DESIGN.md), [PRD](Centinel_PRD_Revised.md), [approval evidence specification](REVIEW_WORKFLOW_APPROVAL_EVIDENCE_SPEC_2026-09-10.md), [finding reconciliation](PROJECT_FINDING_RECONCILIATION_2026-10-20.md), [source-update contract](SOURCE_UPDATE_REVIEW_FINDINGS_2026-10-19.md), and [readiness specification](PROJECT_READINESS_SPEC_2026-10-19.md). This document corrects assessment validation, resolution eligibility, evidence presentation and approval/recovery gates while preserving attributable human decisions and immutable history.

No live AI evaluation, pause resumption, provider change, historical-data rewrite, destructive migration, or Dynamic Testing behavior change is authorized by this documentation request. Prefer additive fields in existing snapshots and contracts; any necessary persisted-schema change must be separately documented before implementation. Offline acceptance establishes mechanism correctness, not real-model semantic accuracy.

## P1-01 — Reject invalid assessment success and false resolution

1. Validate the provider response before normalizing findings or setting model success. Require a JSON object with explicit `findings` and `featureAssessments` arrays. Reject missing/wrong types, malformed finding entries, unknown/duplicate feature-domain rows and contradictory status/outcome combinations; do not silently drop invalid entries and treat the rest as a clean result. Use a versioned static-response contract shared by prompt/schema construction and runtime validation. Legitimate `findings:[]` is distinct from missing findings.
2. Require all expected feature/domain slots to be represented, permitting explicitly unverified outcomes. An empty feature map may legitimately use an empty assessment array; it does not establish complete path coverage. Distinguish valid response structure, partial/unverified coverage, and actual review completion. Unsupported languages, unresolved paths and missing business evidence remain disclosed limitations.
3. A structurally invalid response ends the attempt as failed with explicit incomplete model status and actionable, sanitized failure guidance. Preserve already completed deterministic checks and safe partial evidence. It must not reach Need Approval, write resolution eligibility, lower current risk, or be relabeled successful by the deterministic-only fallback. Do not automatically retry invalid output or switch providers.
4. Absence-based resolution additionally requires validated assessment completion for the compared source/feature scope, the existing successful-review/config/policy/scope guards, changed-source proof and readable frozen evidence. Unverified coverage relevant to the old finding prevents resolution. If the old issue cannot be mapped safely to assessed scope, keep it open with a verification reason. Successfully reported recurring issues can still be matched conservatively; lack of a match is not proof of resolution.
5. Persist safe validation/coverage metadata with policy version for new executions and correlations. Historical records without that proof cannot acquire new derived resolutions solely because they contain `modelStatus:succeeded`. Do not rewrite old snapshots or saved finding decisions; historical potentially affected derived states are conservatively re-evaluated in the current projection. Old human approval is retained as a decision, not upgraded into proof of valid analysis.

Acceptance: reproduce the audit's first ownership issue followed by a changed-source `{message:"I could not complete the review"}`. The second attempt must fail, retain the original open issue/risk, and produce no resolution eligibility. Cover null/array results, missing arrays, malformed finding members, duplicate/missing domain rows, valid empty results with complete scope, explicit unverified coverage, no mapped features, cancellation and provider pause. A valid comparable assessed change must still permit the existing resolution behavior.

## P1-02 — Separate unsupported observations from grounded findings

1. Validate required finding fields before applying presentation defaults. A title alone is not a finding. Require actionable description, allowed severity/confidence, category, recommendation and structured frozen-source evidence. Normalize safe formatting only after validation; do not invent evidence or severity for malformed output.
2. Evidence must identify an unambiguous frozen artifact/version and a valid source range or supported document locator. Validate quoted source excerpts against that frozen content, allowing only defined line-ending normalization. Narrative explanation is separate from the excerpt. Arbitrary line existence is insufficient. Document evidence without code lines is valid only when its supported locator/excerpt can be verified; missing-behavior claims cite a relevant inspected range rather than fabricating a quote for absent code.
3. Invalid paths, conflicting IDs, out-of-range locations, invented excerpts and missing content must not be repaired into ordinary locationless risk-bearing findings. Retain safe diagnostic reasons and valid references as unverified assessment limitations, separate from confirmed findings/totals and resolution evidence. Reuse the existing evidence-sufficiency record and safe audit counts; never place raw rejected provider payloads or credential-bearing excerpts in audit logs. If richer candidate presentation needs a new contract, add an explicit optional candidate envelope rather than disguising candidates as findings.
4. A response containing rejected observations cannot establish clean success or absence-based resolution for affected scope. Preserve valid observations as partial evidence, explain what requires another assessment, and apply P1-01's completion gate. Candidate exclusion must not make an incomplete assessment look clean.
5. Source anchoring proves provenance, not semantic truth. UI copy must describe model findings as issues to inspect; it must not call source-range validation proof of vulnerability. Existing valid deterministic checks remain unchanged.

Acceptance: the audit's fabricated Critical `missing.ts:999`, real-line/nonexistent-excerpt claim and title-only object must not enter ordinary finding/risk totals. Safe limitations remain discoverable; the attempt cannot resolve prior issues. Cover valid code/document evidence, duplicated basenames, CRLF, contradictory source versions, redaction, a genuine zero-finding response and partial valid/invalid observations. No metadata may leak source bodies, prompts, provider secrets or private reasoning.

## P1-03 — Gate decisions on successfully loaded evidence

1. Track not requested/loading, loaded, unavailable-by-contract and failed states separately for required findings, frozen source manifest and traceability. Known endpoint errors, malformed responses or mismatched project/review IDs are failures, not contract-level unavailability. Only documented capability absence or an explicit valid unavailable result qualifies for legacy unavailable copy; do not blanket-convert every 404 into compatibility success.
2. While any required evidence read is loading or failed, disable Approve and Request changes and explain the missing evidence beside the action. Permit explicit unavailable legacy contracts only with honest labels and the existing trustworthy-scope rules. Incomplete/model-invalid executions remain ineligible under P1-01 regardless of successful evidence fetches.
3. Provide **Retry evidence** to reload failed evidence for the same Review without starting a new assessment. Keep successfully loaded evidence visible; only clear the failure gate after fresh valid responses arrive. Ignore late responses from a previous Review/unmounted screen. Polling failure after a successful load must display staleness and block a new decision until recovery.
4. Recheck eligibility in the decision handler to prevent submitting through stale local state. Preserve backend membership, lifecycle, scope and idempotency checks; do not substitute a client checkbox for those controls. A server cannot prove the browser completed a read, so frontend read-state gating and server durable-evidence validation remain distinct responsibilities.

Acceptance: successful findings plus a rejected traceability or manifest request leaves decisions disabled; Retry evidence recovery enables them only when all other gates pass. Cover findings failure, loading, explicit legacy unavailability, authorization/500 errors, invalid identity, polling failure, rapid navigation and attempted stale submission. No test may record a live approval.

## P1-04 — Present frozen Review sources

1. Replace the mutable project `ArtifactsPanel` inside Review Overview with a read-only view of that Review's saved manifest. List only reviewed artifacts, source identity and recorded version/hash with honest unavailable states. Reviewed counts and listed artifacts must derive from the same manifest, not today's inventory.
2. Source preview/download must retrieve the saved version through existing authenticated project/member and Review-ownership checks. If exact frozen content cannot be read, show that limitation; never substitute current content under a historical version label. Add a narrowly scoped version-read contract only if the existing one cannot support this safely.
3. Importing B or updating/removing A after a Review must not change its evidence list or preview. Renamed/current project paths cannot replace saved identity. No Add/remove/sync/edit controls appear inside historical evidence; a clearly labeled **Manage project sources** navigation action may open the project Source area separately.
4. Legacy missing/incomplete manifests show unavailable evidence rather than a current-project fallback. No historical backfill or data mutation is performed.

Acceptance: review A at version 1; update it to version 2, import B and remove A from current sources. The Review still names/previews A version 1 when retained content exists, excludes B and shows one reviewed artifact. Missing retained bytes, partial manifests, cross-project requests, narrow layouts and keyboard disclosures are covered.

## P1-05 — Freeze scoped traceability and verify mapping versions

1. Freeze selected confirmed requirement records, applicable standards and mapping context with the source manifest before provider/deterministic execution, using additive versioned snapshot fields. Apply effective scope: explicit requirement selection limits requirement records; artifact selection limits applicable mappings; full-scope reviews retain the full selected project context. Record the effective inclusion basis and never expand an explicit selection during finalization.
2. Final traceability is derived from that frozen context, not a fresh query over mutable project requirements at completion. Requirement or mapping edits during execution belong to a later Review. Reused retries preserve the original context; refreshed retries capture a new one. Confirmed requirements remain distinct from inferred candidates.
3. A mapping can support Complete only if its target exists in reviewed frozen scope and its implementation evidence is bound to the reviewed version under the existing mapping contract. An old `complete` string alone is insufficient. Changed/deleted/unreadable targets or absent version proof produce explicit stale/unavailable evidence, not Complete or a fabricated runtime failure.
4. Preserve established Complete/Incomplete/Missing vocabulary and unavailable evidence distinctions. No mapping can still mean Missing; a mapping to unverifiable content must expose its unavailable basis. Scope-excluded requirements are not reported Missing. Summary attention totals use the same scoped records and do not count unavailable as a clean zero.
5. New snapshots record requirement/mapping/source identities and version provenance without duplicating secrets into audit logs. Old snapshots remain historical evidence; current displays identify missing version proof. Do not retroactively infer verified traceability from current files or mark old evidence Complete.

Acceptance: the audit's complete mapping to `deleted-file` cannot certify Complete; unselected requirements are absent from scoped results. Cover changed source hash, unchanged verified mapping, missing version proof, requirement/mapping edits mid-run, full scope, explicit artifact/requirement selections, inaccessible sources, no mapping, legacy context, reused retry and refreshed retry. Overview, traceability, approval and export must consume the same saved records.

## P1-06 — Make retry source choice explicit

1. Provide **Retry saved sources** and **Review updated sources** choices with concise explanations of the frozen inputs each uses. For a provider interruption recommend saved-source retry; for evidence/source repairs recommend updated sources. Do not silently refresh or silently reuse inputs after telling the user repaired evidence will be assessed.
2. Reuse existing `refreshSourceManifest` service behavior and linked-attempt lineage. Saved-source retry reuses all frozen source/requirement/mapping context. Updated-source retry captures a new readable source set and P1-05 context, preserving the original objective/scope and recording the refresh choice. If an explicitly selected source was removed, show actionable scope failure rather than silently broadening to all sources.
3. Both choices create/return an idempotent linked attempt without changing the original Review, its decisions or findings. Disable duplicate submission and distinguish retrying the same request from intentionally creating a later attempt after another repair. Verify current retry-key deduplication does not return a terminal child instead of executing a newly requested attempt.
4. Explain source read/capture errors and preserve the user's choice. Do not claim the refreshed attempt used new versions unless its manifest proves that. Keep source import available under the existing AI hold, but preserve provider pause and manual-resume semantics: these UI changes must not disable the hold, automatically resume work, retry capacity failures, or switch provider.

Acceptance: block on missing/unreadable evidence, repair it, select updated sources and verify a linked child uses the repaired versions/new context while the parent is unchanged. Saved-source retry must use old versions explicitly. Cover repeated clicks/network retries, multiple intentional attempts, removed selections, capture failure, provider pause and cancellation. Verify guidance matches actual submitted choice.

## P2-01 — Preserve validated analysis associations

1. Treat feature/path/domain association and requirement/standard provenance as independent validated namespaces. Keep the existing `sourceLocator.analysis` transport shape; do not introduce a second source of truth.
2. Preserve only an association accepted by `linkFindingToAnalysis` against the current frozen map and finding location. Validate or recheck it against the final normalized location before persistence. A removed/contradictory location cannot leave a misleading association behind.
3. Build requirement/standard provenance from trusted records as today. Add the separately validated analysis object after that sanitation; provider-supplied unrelated locator fields must not bypass validation. Invalid requirement/standard IDs must not erase an otherwise valid association, and a valid requirement must not legitimize an invalid analysis object.
4. Save and read the association through the repository and frontend finding contract. The Activity feature disclosure must open the exact saved finding in Findings. Existing historical findings lacking an association remain unlinked; no inferred backfill.

Acceptance: ordinary code findings and requirement/standard-grounded findings retain valid links; unknown feature/path/domain, contradictory evidence location, and forged provenance do not. An orchestrator-to-repository round trip must catch the original overwrite, beyond testing the link helper alone.

## P2-02 — Separate current issues and historical occurrences in exports

### Data contract

- Preserve existing `findings` as raw persisted historical inventory for backward compatibility. Do not mutate it to represent derived resolution or collapse its occurrence IDs.
- Add an optional `currentFindings` envelope to the report snapshot: `status: available | unavailable`, `reason: string | null`, and `items`. Newly generated production reports must populate it. Old saved report JSON lacking it remains readable and renders an explicit unavailable current inventory, never inferred from historical rows.
- Each current item retains its canonical original finding ID, persisted status, effective status, latest occurrence reference when present, lineage references, and available resolution evidence. Reuse the existing reconciliation projection and effective-status semantics; do not invent a second resolution algorithm or persist derived statuses back to source rows.
- Both current risk and current inventory must be built from one captured reconciled projection within a report generation. Include resolved, dismissed, informational and unclassified issues in current inventory; apply the existing risk policy separately. Their counts need not equal the count of active risk items.
- Keep Static and Dynamic provenance explicit. Dynamic rows retain existing behavior and are not joined into Static correlation chains. Readiness gaps remain outside persisted Project Assessment risk.
- Production projection read failure must fail report generation, matching existing risk/export fail-closed behavior. Contract-level absence in legacy snapshots/adapters is distinguishable as unavailable, not an empty inventory. No fallback may claim raw rows are a successfully reconciled current inventory.

### Rendering

JSON, Markdown and PDF must agree. Use separate **Current project findings** and **Historical finding occurrences** sections. Explain that historical entries retain their saved states and may repeat a canonical issue. Current items show effective disposition and resolution basis when recorded. Per-review findings remain immutable and session-scoped. Bump the generator version for new exports; keep the existing report schema identifier and fields compatible through additive optional fields.

Acceptance: two recurring occurrences export as one canonical current issue plus two historical rows; derived resolution shows Resolved in current inventory and leaves both saved rows unchanged. Missing comparison proof keeps the issue unresolved. Later recurrence reopens it according to the existing projection. Human dispositions retain their existing precedence. Failure, legacy absence and legitimate zero findings produce distinct outcomes. All renderers preserve these distinctions.

## P2-03 — Order latest Static Review by execution context

1. Replace mutable `updatedAt` ordering for Static Review selection with an explicit execution timestamp resolver: valid dedicated execution-completion time, then valid frozen `progress.completedAt`, then valid `createdAt` for legacy/unfinished terminal attempts. Never use approval, comment, decision, or generic update times as execution completion.
2. Expose dedicated completion metadata additively through the report-facing session adapter/type when persisted evidence supports it. Do not fabricate a completion timestamp or silently reinterpret `progress.updatedAt`. Keep the fallback basis available for diagnosis; use stable ID ordering to break equal/unknown timestamps. Missing execution time is displayed as unavailable rather than converted into a date.
3. Retain the current export eligibility policy: latest terminal Static attempt, including failed, blocked and cancelled attempts with explicit status. This is different from the Project Overview's latest successful source baseline. Do not silently change export selection to successful-only as part of this fix.
4. Label the section **Latest Static Review attempt** and distinguish execution time from last activity and decision time. A newer failed attempt is shown honestly; its missing evidence is not borrowed from an older success. Project source currency continues using its existing successful-baseline policy.
5. Do not change the shared Dynamic selection behavior merely because it currently uses the same generic helper.

Acceptance: October 1 execution approved October 21 cannot displace an October 20 execution. Test dedicated/progress completion metadata, legacy creation fallback, malformed/missing timestamps, equal-time stable ordering, input-order independence, and a newer failed attempt. Changing only `updatedAt` or a human decision must leave selection unchanged. Existing currency tests must remain valid.

## P2-04 — Identify retained readiness as a previous assessment

1. Retain category verdicts from the last valid snapshot. When `stale:true`, show visible text **Previous assessment — sources have changed** near those verdicts and the saved assessment date when valid. Never imply a fresh semantic result.
2. Describe job state separately: queued, checking updated sources, awaiting manual assessment, failed, or paused. Preserve existing Start/Retry/Resume controls and disabling rules; the display change must not trigger work or resume paused AI.
3. Cover stale idle, queued, running, failed and paused states. Previous-result context must remain visible even without an error. With no snapshot, show the existing dash and current job state, not a fabricated previous result/date. Omit an invalid date with honest unavailable copy.
4. Continue excluding stale readiness gaps from the current Findings list. In the existing Project Findings context, show a concise explanation when such gaps are withheld: **Readiness findings describe previous sources and are hidden until a current assessment is available.** A zero-result empty state must not imply no current readiness gaps were found. Preserve other findings and filters; do not add stale gaps to risk totals.
5. Once a valid fresh assessment is saved, remove stale messaging and expose its current gaps. Errors and pauses preserve prior results with recovery guidance. Use neutral-first design tokens, readable wrapping and accessible status text without repeated live-region announcements on every poll.

Acceptance: card and Findings consistently distinguish previous results, no result, active work, pause, failure and fresh results. Source updates alone do not cause an old Completed verdict to be presented as current. Verify keyboard access and 1440×900, 1200×900 and narrow layouts without leaked styles.

## Acceptance and residual risk

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| P1-01 | Invalid/partial output cannot establish clean completion or absence-based resolution | Planned | Historical derived states lack new validation proof; semantic truth remains separate |
| P1-02 | Grounded findings separated from unsupported observations; risk excludes candidates | Planned | Anchored text alone does not prove a defect |
| P1-03 | Failed/loading evidence blocks decisions; evidence retry recovers safely | Planned | Client read-state gate complements durable server validation |
| P1-04 | Saved manifest and exact source versions drive historical evidence | Planned | Retained historical bytes may be unavailable |
| P1-05 | Scoped frozen requirements/mappings use version-backed evidence | Planned | Legacy mappings may lack sufficient version provenance |
| P1-06 | Explicit source choice produces correct immutable linked attempt | Planned | Removed selections and repeated intentional retries require honest handling |
| P2-01 | Valid links survive full pipeline; invalid links/provenance rejected | Planned | Existing historical links cannot be reconstructed safely |
| P2-02 | Current inventory and risk share captured projection; history unchanged; all formats agree | Planned | Depends on P1 validation/resolution safeguards, not a new resolution algorithm |
| P2-03 | Decision-independent deterministic ordering; terminal eligibility explicit | Planned | Legacy rows may lack actual completion time |
| P2-04 | Stale result provenance visible in card and Findings; controls preserved | Planned | Semantic assessment accuracy remains independently unaccepted |

Acceptance requires the [implementation plan's](REVIEW_P2_REMEDIATION_PLAN_2026-10-21.md) relevant checks, no blocking review findings within scope, and disclosure of unrelated failures. Each of the ten audit findings closes only on its own acceptance evidence. Offline passage does not establish real-model judgment accuracy; live semantic corpus/four-domain evaluation remains separately unverified until authorized and executed. Writing this specification closes no findings.
