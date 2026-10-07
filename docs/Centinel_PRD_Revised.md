# PRD: Centinel — AI-Assisted Software Quality Assurance Platform

- **Revision:** 2.0
- **Updated:** 2026-10-05
- **Status:** Consolidated product requirements; not an implementation-completion record.
- **Product:** Centinel Static and Centinel Dynamic in one desktop workspace.
- **Ownership:** Static owner (CS); Dynamic owner (JY); shared platform responsibilities coordinated by both.

## 1. Purpose and authority

This PRD defines the intended product, module boundaries, functional requirements, acceptance criteria, and delivery sequence. It consolidates the team's latest scope discussion and the supplementary Dynamic requirements agreed in that discussion.

Use this document to decide what the product must deliver. Use [DESIGN.md](../DESIGN.md) for user-facing design, navigation, terminology, accessibility, and layout. The Static module is called **Review** in the interface; Dynamic is called **Dynamic Testing**. Existing feature specifications and tests define detailed technical contracts. This PRD does not authorize silent changes to existing contracts or destructive migrations.

A requirement below is a delivery target, not a claim that it already works. Section 14 records the observed implementation baseline separately. Detailed specifications must identify and resolve conflicts with this PRD before implementation; historical proposal tabs are context rather than competing delivery baselines.

## 2. Product vision and problems

Centinel helps developers, reviewers, and testers connect software requirements, artifact review, runtime testing, findings, and reproducible evidence in one project workspace.

The product addresses four practical problems:

1. Document and code review require repetitive manual work, and findings often lack a clear connection to their source or requirement.
2. Requirement-to-implementation evidence and document currency are difficult to maintain as sources change.
3. Browser tests require setup and maintenance, while autonomous agents can mistake model, environment, or interaction failures for application defects.
4. Reports, screenshots, logs, and decisions are fragmented, making collaboration, reproduction, and coverage assessment difficult.

Centinel combines deterministic checks with AI-assisted interpretation. Programs enforce permissions, action limits, source versions, evidence integrity, and known acceptance checks; models support contextual analysis and action planning. Users retain responsibility for reviewing uncertain findings and approving review outputs.

## 3. Users and ownership

| User | Main needs |
| --- | --- |
| Developer / Static reviewer | Review documents and code, inspect security-related concerns, understand requirement coverage, and assess proposed fixes. |
| QA engineer / tester | Configure an environment, supply goals, execute browser journeys and unit tests, and inspect reproducible results. |
| Project owner | Manage project membership, sources, configuration, and access to evidence. |
| Project member / stakeholder | Inspect authorized results, findings, traceability, and reports. |

The Static owner owns artifact analysis, security-related review, source currency, review decisions, and static traceability. The Dynamic owner owns environment configuration, missions, browser execution, outcome verification, usability assessment, unit-test execution, and runtime evidence. Authentication, membership, model adapters, persistence, findings vocabulary, and report interfaces are shared dependencies. Existing role enforcement must be reused; any additional role distinction requires a scoped service specification.

## 4. Scope and delivery boundaries

### 4.1 Required product scope

| Area | Included |
| --- | --- |
| Desktop workspace | Centinel runs as a desktop application with local browser and process execution. |
| Static / Review | Document and source-code review; cross-artifact consistency; security-related analysis and research; requirement coverage; evidence-backed findings and fix recommendations; document currency; human decisions. |
| Dynamic browser testing | Web E2E/user journeys, smoke, exploratory, saved-mission regression, and usability assessment using screenshots and browser state. |
| Environment support | Reusable profiles, environment variables, test accounts, startup recommendations, preflight checks, test-data preparation and cleanup. |
| Static-to-Dynamic context | Versioned requirements, acceptance criteria, source references, and risk priorities supplied to missions. |
| Unit testing | A separate runner for existing tests in one initially supported framework, with imported results and logs. |
| AI backends | Configured API providers and an optional Codex-backed mode using the user's Codex sign-in. |
| Collaboration | Project membership, permission-controlled shared results and evidence, and attributable review decisions. |
| Reporting | Structured Static and Dynamic reports with scope, versions, outcomes, evidence, and limitations. |

Codex is an alternative AI backend to direct provider API calls. It is not Centinel account authentication, and a successful Codex login does not itself establish browser-control or vision capabilities. API-backed operation must remain available when Codex is not selected or unavailable.

### 4.2 Time-permitting extensions

- Testing other native desktop applications, initially on one explicitly selected operating system. This is distinct from packaging Centinel itself as a desktop application.
- AI generation or modification of unit tests. Running existing tests is required; generating new test code is an extension.
- Interaction-friction visualization or a heatmap based on observable repeated actions, failures, backtracking, and delays. It must not claim to measure real human frustration.
- Broader test-framework and operating-system support.

### 4.3 Excluded from this delivery

- Exhaustive behavioral coverage or a guarantee that an application is defect-free.
- Formal certification against ISO or IEEE standards.
- Dedicated penetration testing, active exploit research, load testing, or performance benchmarking of arbitrary targets.
- Full enterprise CI/CD, real-time co-editing, or an always-on distributed test fleet.
- Unrestricted autonomous control of a user's computer or arbitrary production systems.
- Automatic application-code fixes, commits, deployment, or external report publication.

Security-related document/code review and authorized observations from tested workflows remain included. Native desktop testing is an extension rather than permanently excluded.

## 5. Primary user journeys

### 5.1 Static review

1. A member opens a project and imports documents or source code.
2. Centinel records source provenance, versions, availability, and currency information.
3. A reviewer selects the objective and effective scope; the Review freezes its source manifest.
4. Deterministic analysis and the selected AI backend produce findings and requirement mappings with evidence.
5. The reviewer inspects Activity, Findings, and Traceability, then approves or requests changes according to the existing decision contract.
6. An approved Review is completed; approval does not automatically resolve its findings.

### 5.2 Dynamic browser validation

1. A tester selects a project, target environment, test account/role, and execution limits.
2. The tester supplies a goal or selects requirements from a specific Static Review snapshot.
3. Centinel generates editable missions with acceptance checks and records the selected context versions.
4. Preflight validates environment and backend readiness, then starts an isolated browser run.
5. The observer captures sanitized state; the planner proposes an action; the policy guard permits or blocks it; the executor performs it.
6. Acceptance checks and evidence verification determine observed outcomes. Recovery is bounded.
7. The tester inspects results, findings, coverage, and evidence, and exports a report or reruns a saved mission.

A manually authored mission does not require a prior Static Review. Missing context must be visible and must not be fabricated.

### 5.3 Unit-test execution

A tester selects an authorized local workspace and a configured test command, checks its environment, runs existing tests through the supported framework adapter, and receives structured results plus raw diagnostic logs. This path does not use browser clicks to simulate unit tests. Browser journey coverage and unit-test/code coverage are reported separately.

## 6. Static functional requirements

Every requirement includes an observable completion condition. All Static requirements below are required scope.

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| STA-01 | Accept supported documents and source code with provenance. | Record source identity, version/hash, import time, and extraction outcome; show unsupported or unreadable inputs explicitly. |
| STA-02 | Review consistency across selected requirements, documents, standards, and implementation artifacts. | Each reported inconsistency cites both relevant sources; uncertain or contradictory inputs are visible instead of silently reconciled. |
| STA-03 | Analyze security-related code/document concerns and consult supporting material when needed. | Findings identify affected source locations, rationale, applicable rule or external reference, and limitations; unsupported suspicions remain candidates. Dedicated penetration testing is excluded. |
| STA-04 | Assess requirement completeness and implementation traceability. | Distinguish Complete, Incomplete, Missing, and unavailable evidence using the existing mapping contract; absence of evidence is not presented as proof of runtime failure. |
| STA-05 | Produce structured findings with risk inputs and suggested fixes. | Include evidence, category, severity, priority, confidence, recommendation, and source version; deduplicate overlapping analyzer output; recommendations are not automatically applied. |
| STA-06 | Show document version and currency separately. | Show the reviewed version and known remote update state; record currency confirmation, last successful synchronization, and deprecation. Unknown freshness remains unknown. Default currency interval remains 90 days per DESIGN.md. |
| STA-07 | Freeze review context and retain attributable decisions. | Later source changes do not alter historical Review evidence; approval/change requests and subsequent iterations preserve author and history. |
| STA-08 | Export a reproducible Review report and context for Dynamic. | Export scope, versions, findings, decisions, and traceability; a Dynamic mission can reference the exact Review snapshot and selected requirements. |

Source currency confirmation is not version approval: incoming source versions do not require approval merely to exist. An old currency confirmation and a remotely newer document are different conditions and must be displayed separately.

## 7. Dynamic functional requirements

### 7.1 Required requirements

The DYN identifiers preserve the supplementary requirements established in the scope discussion.

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| DYN-01 | Save reusable environment profiles containing target URL, browser settings, account role, and execution limits. | Select a saved profile for another run; record a profile snapshot so later edits cannot rewrite historical conditions. |
| DYN-02 | Accept environment variables and suggest missing configuration and local startup instructions from project metadata. | Compare configured names against templates or explicit prerequisites; show missing values without inventing secrets; sensitive values never appear in ordinary logs, model prompts, or reports. |
| DYN-03 | Perform environment and AI-backend preflight before execution. | Check target reachability, required configuration, selected account/session readiness, and supported backend capabilities; failures produce actionable blocked reasons. |
| DYN-04 | Support test-data prerequisites and optional setup/cleanup operations. | Manual preparation is a valid mode; record setup and cleanup results separately; a repeat run has a documented initial state; concurrent runs use distinct data or an explicit exclusive lock. |
| DYN-05 | Consume selected Static requirements, acceptance criteria, risks, and source versions. | Store Review/snapshot identifiers and relevant source references; expose incomplete, conflicting, stale, or unapproved context; permit explicit use of identified unapproved context without mislabeling it approved. |
| DYN-06 | Create editable, reusable missions with separate execution histories. | One mission has multiple immutable run records; edits create a new mission revision; a rerun does not overwrite earlier evidence. |
| DYN-07 | Observe screenshots and browser state and execute policy-controlled actions. | Record before/after state and action outcome; enforce configured origins, action restrictions, and step/time budgets in code, including click/redirect effects rather than only explicit navigate actions. |
| DYN-08 | Support E2E/user-journey, smoke, exploratory, and saved-mission regression testing. | Missions have explicit objectives; exploratory execution records visited states and untested paths; saved missions can be rerun against a recorded target version. |
| DYN-09 | Verify outcomes using acceptance criteria and inspectable evidence. | Distinguish passed, failed, blocked, and uncertain checks; model declarations alone cannot finalize a pass; provider failures and agent errors do not automatically create confirmed application defects. |
| DYN-10 | Support bounded retries, recovery, cancellation, and termination. | Stop active work and backoff on cancellation; preserve partial evidence; interrupt or time out hanging work; unsafe actions are not blindly retried; an interrupted process is reconciled to an honest state on restart. |
| DYN-11 | Assess usability using explicit rules and configured personas. | Findings cite observed behavior and evidence; separate deterministic rule violations from subjective AI suggestions; persona simulation is not represented as a real-user study. |
| DYN-12 | Produce reviewable findings with reproducible steps and evidence. | Include expected/actual outcome, category, severity, priority, confidence, and evidence; record confirmed, rejected, or needs-investigation verification decisions separately from remediation status; link repeated observations. |
| DYN-13 | Show requirement-to-test coverage. | Report tested criteria and passed/failed/blocked/uncertain/not-tested states against a declared denominator; distinguish runtime validation from Static implementation mappings; historical passes are not silently applied to changed requirements. |
| DYN-14 | Generate Dynamic reports from recorded results. | Include environment and source versions, mission scope, outcomes, findings, reproducible steps, evidence references, untested areas, and limitations; retained files are available only to authorized readers. |
| DYN-15 | Share results and verification records with authorized project members. | Record executor and reviewer; test non-member access denial for metadata and files; revoked membership cannot start new work or retrieve project evidence. |
| DYN-16 | Offer API-provider and Codex-backed AI modes through a common adapter boundary. | Explicitly select a backend; test sign-in/capability readiness, image and action/tool exchange, cancellation, and error handling; record backend/model identity where available; do not treat Codex credentials as generic provider API keys. |
| DYN-17 | Run existing unit tests through a separate framework adapter. | Support one documented initial framework; save command, exit outcome, counts, test failures, and logs; an invalid command or runner failure is distinguished from a failing test; restrict execution to the authorized workspace. |

### 7.2 Extension requirement

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| DYN-18 | If time permits, test native desktop applications. | Select one OS and a bounded application set; provide a separate control adapter, required OS permissions, application/window boundaries, cancellation, evidence, and repeatable acceptance scenarios. Do not label browser execution as native desktop coverage. |

The initial unit-test framework and supported application OS are release decisions listed in Section 17. Unit-test generation is not implied by DYN-17.

## 8. Shared platform requirements

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| SHR-01 | Authenticate members through the shared Centinel account system. | Reuse canonical Supabase identities and the existing safe identity-linking contract; identity sign-in, connector authorization, and Codex sign-in remain distinct. |
| SHR-02 | Enforce project membership for every protected read, write, execution, and evidence download. | Server/RLS authorization uses verified identity; guessed identifiers and cross-project substitutions are denied; desktop runtime contains no service-role key. |
| SHR-03 | Share stable identifiers and versioned contracts across modules. | Static context resolves to the same project as the Dynamic mission; dangling or mismatched references are rejected; legacy records and existing local data are preserved during migration. |
| SHR-04 | Protect and minimize credentials and sensitive observations. | Use secret references and protected credential storage; redact passwords, tokens, environment secrets, personal data where configured, and sensitive URLs before storage or model submission; UI explains which provider receives observations. |
| SHR-05 | Preserve auditability and handle repeated submissions safely. | Attribute starts, cancellations, retries, decisions, source updates, and exports; repeated submissions do not duplicate runs or confirmed findings. |
| SHR-06 | Provide honest model usage and limits. | Record available usage for successful, failed, and retried calls; represent unavailable tokens/costs as unavailable; do not promise API-style cost estimates for Codex mode; limits produce actionable outcomes. |
| SHR-07 | Reuse the shared findings vocabulary and explicit risk policy. | Severity, remediation priority, confidence, category, and derived risk remain distinct; missing historical inputs remain unclassified rather than receiving invented values. |
| SHR-08 | Retain portable, versioned reports and evidence bundles. | Report snapshots include provenance and generation time; formats and schema version are documented; authorization and retention apply to exported evidence within Centinel. |

The existing Project Assessment policy currently aggregates Review/static findings. Dynamic outputs must remain separately identified until a specified and tested cross-module aggregation policy exists. This PRD does not silently change Assessment or treat every Dynamic candidate as current project risk.

## 9. Environment and test-data lifecycle

The lifecycle describes the conditions before a test, the data created during it, cleanup after it, and how equivalent conditions are restored for another run.

| Stage | Required behavior |
| --- | --- |
| Configure | Select a target environment, account role, variable names/secret references, data prerequisites, allowed origins/actions, and budgets. |
| Prepare | Check service readiness and account access; verify manual prerequisites or perform explicitly configured setup; assign a run-specific data namespace or reserve exclusive use. |
| Execute | Inject variables only into the configured target subprocess when relevant; use browser credentials/session state separately; record created resources needed for cleanup without exposing secret values. |
| Finalize | Preserve evidence and execution outcome; run configured cleanup after success, failure, or cancellation when safe; record cleanup failure without overwriting the test result. |
| Repeat | Restore or confirm the initial state; create a new Run and retain the original one; prevent collisions with retained or concurrently used test data. |

For example, a create-customer test needs an account with the right role and a customer name that does not already exist. Each run uses a distinct test name or restores the fixture. If cleanup fails, the next run reports that condition instead of misclassifying a duplicate-name rejection as a new application bug.

An initial delivery may connect to an already-running website and use manual setup. Local service launching is a later sub-increment of environment support: propose the executable/arguments, let the user configure or confirm them, check readiness, track only processes Centinel owns, and stop those processes according to the selected lifecycle. Environment variables typed into Centinel do not reconfigure an already-running remote website.

Seed/reset/cleanup commands and unit-test commands execute local code. Their workspace, executable/arguments, timeout, and intended data effects must be explicit. Arbitrary model-generated shell commands are not automatically executed. Database resets are not a default cleanup operation.

## 10. Context, records, and outcome semantics

### 10.1 Static-to-Dynamic contract

The logical contract contains:

- Project ID; Review ID; immutable snapshot/iteration ID and approval state.
- Requirement ID/revision, description, acceptance criteria, and available implementation references.
- Artifact/source IDs, version/hash or remote revision, deprecation/currency state, synchronization time, and known code commit.
- Related findings, risk inputs, and unresolved context conflicts.

Dynamic returns mission revision and Run IDs, checks actually exercised, result status, runtime findings, evidence references, and coverage gaps. Requirements and observations may be many-to-many. A missing deployment version is recorded as unknown; a repository commit is not assumed to prove the running application's version.

Updating a document or requirement flags affected saved missions for revalidation. Historical evidence remains pinned to its original snapshot. Existing missions may intentionally use an older snapshot, but that choice must remain visible.

### 10.2 Logical records

| Record | Meaning |
| --- | --- |
| Project / Membership | Shared project identity and authorized participation. |
| Source / ArtifactVersion / ReviewSnapshot | The test basis, its version, and the material actually reviewed. |
| EnvironmentProfile / CredentialReference | Reusable runtime configuration and protected secret references. |
| TestMission / MissionRevision | Objective, persona, prerequisites, linked criteria, limits, and verification plan. |
| TestRun | One execution of one mission revision under a recorded environment and backend. |
| Step / Observation / CheckResult | Actions, before/after state, and explicit acceptance-check outcomes. |
| Finding / VerificationDecision / Evidence | Candidate or supported issue, attributable review, and proof. |
| ReportSnapshot | A versioned summary of selected results and evidence at generation time. |

These are product concepts, not instructions to rename existing tables or reset schemas. Several concepts may be represented within one implemented record where the required history and constraints are preserved.

### 10.3 Distinct state dimensions

- **Execution:** queued, running, completed, blocked, cancelled, or failed. Completed means execution ended normally, not that every check passed.
- **Check verdict:** passed, failed, blocked, uncertain, or not tested. A failed check is not automatically a verified application defect.
- **Finding verification:** candidate, confirmed, rejected, or needs investigation; mapped explicitly to existing service vocabulary.
- **Finding remediation:** the existing finding-state contract, such as new, resolved, or dismissed; verification and remediation are separate.
- **Static human decision:** Need Approval until approved; Completed only after approval, following DESIGN.md and the existing Review contract.

A run with unfinished required checks cannot be presented as an overall pass. Reports may describe it as partial without requiring an incompatible new transport enum. Provider outages, invalid model output, service startup failures, permission problems, and exhausted action budgets are operational outcomes, not confirmed defects. A model's finish_success is a proposed terminal decision that still requires applicable acceptance checks.

## 11. Findings, evidence, and reports

### 11.1 Minimum finding contents

A finding includes project/module identity, Review or Run reference, title/category, expected and observed behavior, affected source or runtime location, evidence references, reproduction steps where applicable, severity, priority, confidence and its basis, suggested remediation, verification state, remediation state, and history.

Use a stable correlation strategy to relate repeated findings. Retesting records new evidence and whether the earlier issue was reproduced; approval or a new passing run does not silently delete historical findings.

### 11.2 Evidence contract

Capture evidence needed for the selected checks: before/after screenshots, relevant DOM or accessibility fragments, action trace, console/network diagnostics where applicable, assertion outcomes, and reproduction configuration. Record timestamps and integrity identifiers. Evidence completeness is verified before a confirmed finding is published. Raw secrets and hidden model chain-of-thought are not report content.

Local browser execution and temporary evidence capture remain local. Authoritative shared records use bearer-scoped Supabase; private evidence uploads use the authorized storage path. If persistence or upload fails, show incomplete synchronization and retain recoverable local output according to policy. Do not label it fully shared or silently fall back to another user's/local project records.

### 11.3 Minimum report contents

Both report types include project, module, author/executor, generation time, source/target versions, selected scope, findings with evidence, review status, and limitations. Static reports add artifact manifest, requirement mappings, currency context, and approval history. Dynamic reports add environment, mission revision, account role, backend/model, check outcomes, untested scope, reproduction steps, setup/cleanup status, and available usage.

Plan for machine-readable results and human-readable Markdown/PDF reports, reusing existing report services where compatible. Exact layout and schema remain detailed-spec decisions. A summary.md alone is not proof that report scope, evidence access, and reproducibility requirements are met. Reports do not claim exhaustive coverage, real-user satisfaction, formal standards compliance, or unsupported live validation.

## 12. Non-functional requirements

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-01 | Reliable bounded execution | Inject model errors, slow navigation, malformed actions, and cancellation; verify limits, accurate outcomes, resource release, and retained evidence. |
| NFR-02 | Reproducibility and provenance | Repeat a mission on a fixed application/data baseline; verify recorded prerequisites, versions, checks, evidence, and reproducible findings. |
| NFR-03 | Access isolation and privacy | Test authorized/unauthorized users and private file access; inspect prompts, logs, traces, and reports for seeded secrets; verify no service-role key in desktop runtime. |
| NFR-04 | Accessible, understandable workspace | Follow DESIGN.md, distinguish unavailable data from zero, support keyboard/focus behavior, and verify relevant screens at 1440x900, 1200x900, and a narrow viewport. |
| NFR-05 | Maintainable adapters | Browser control, model backends, persistence, reporting, and unit-test framework adapters have separate contracts and focused tests. |
| NFR-06 | Honest autonomy and resource use | Enforce action, time, retry, and configured usage limits in code; disclose data transmission and unavailable accounting; surface blocked policies rather than bypassing them. |
| NFR-07 | Compatible evolution | Preserve unrelated edits and local data; use incremental migrations and reconciliation; record schema versions and handle legacy unavailable fields explicitly. |

## 13. Evaluation and release acceptance

### 13.1 Evaluation baseline

Choose an authorized, self-hosted representative web application. Freeze its version, environment configuration, seeded data, test accounts/roles, selected requirements, and a manually reviewed set of known defects and negative cases. Record any difference between the deployed application and repository version.

Use repeated runs under equivalent starting conditions. Compare relevant journeys against manually reviewed or conventional scripted baselines. Evaluate candidate detection separately from human-confirmed findings. The system is standards-informed; references to testing-process or quality models are not certification claims.

| Metric | Definition |
| --- | --- |
| Task completion | Missions whose required acceptance checks pass / attempted eligible missions; show blocked and cancelled outcomes separately. |
| Requirement/criterion coverage | Criteria actually checked / selected testable criteria; show exclusions and unavailable test basis. |
| Finding precision | Correctly reported defects / reported defects, judged against reviewed ground truth. |
| Finding recall | Known in-scope defects detected / known in-scope defects in the fixed evaluation set. |
| Evidence completeness | Findings with every required reproduction/evidence field / assessed findings. |
| Repeatability | Agreement of verdicts and reproducibility of findings across repeated fixed-baseline runs. |
| Recovery success | Eligible recoverable interruptions successfully resumed / attempted recoveries. |
| Effort and resource use | Execution time, action count, available model usage, human interventions, and manual/scripted baseline effort. |

An unobservable or unreviewed defect corpus cannot support a recall claim. Set numerical thresholds before evaluation, after fixing the corpus and supported environment; do not select thresholds after seeing results.

### 13.2 Mandatory acceptance scenarios

1. Import document/code sources, complete a Review with evidence and traceability, and record an attributable decision.
2. Update a source and show remote-version/currency information without rewriting old Review snapshots.
3. Create a new shared project and run Dynamic through that project's identity rather than requiring an old local project record.
4. Turn a selected Static requirement into a mission, execute it, and retain linked criteria and evidence.
5. Verify a known normal path and a seeded defect; distinguish both from a provider outage and an unreachable target.
6. Perform an exploratory mission and disclose unvisited or unverified scope.
7. Repeat a saved mission after a fix and preserve both runs and the related finding history.
8. Cancel during an action/model call or retry, and reconcile a process interruption without leaving a false running/pass state.
9. Demonstrate manual and configured test-data preparation, repeatable initial state, collision prevention, and visible cleanup failure.
10. Inspect a usability observation with evidence and separate subjective recommendations from objective checks.
11. Run passing and failing existing unit tests through the documented framework; distinguish runner/configuration errors.
12. Demonstrate API and Codex modes independently, including authentication/capability errors and cancellation; Codex login alone does not pass this scenario.
13. Export a report; a second authorized member can inspect referenced evidence, while a non-member and revoked member cannot.
14. Inspect captured prompts/logs/reports for seeded secrets and verify authorization across project and file endpoints.

Native desktop testing has separate acceptance scenarios only if the extension is scheduled. Unit-test generation and heatmaps are not required for the core release.

## 14. Observed baseline and implementation gaps

Baseline inspected at commit `d7d229b` during PRD authoring. This is a source inspection, not a fresh build, runtime test, live OAuth check, or database-migration acceptance.

| Area | Observed foundation | Remaining delivery gap |
| --- | --- | --- |
| Static/shared platform | Supabase repositories, source integrations, Review orchestration/decisions, report services, traceability, and risk policy exist. | Existing acceptance audits contain live provider, RLS/Storage, migration, and corpus gaps; implementation presence is not completion evidence. |
| Dynamic entry | URL, natural-language goal, journey/smoke selection, and step limit exist. | Environment profiles, lifecycle, persona, explicit criteria, and versioned Static context. |
| Dynamic execution | Playwright, screenshot/page-context observation, API adapters, retries, logs, cancellation, and summary capture exist. | Programmatic policy enforcement, verified terminal outcomes, richer checks, bounded recovery, and durable runtime reconciliation. |
| Project/data boundary | New project creation is Supabase-backed; Dynamic resolves local projects and saves sessions/findings in sql.js. | Shared identity/authorization and persistence contract; do not delete legacy data or assume new projects exist in SQLite. |
| Dynamic findings | Runner writes findings for failed/blocked outcomes with fixed severity/confidence. | Distinguish operational failure from application defects; verify, deduplicate, and preserve attributable review before treating issues as confirmed. |
| AI settings | Dynamic uses the existing text/vision setting path. | Shared configured-provider compatibility and Codex adapter; verify vision/action capability and usage semantics per backend. |
| Unit/usability/native desktop | No complete dedicated paths established by this inspection. | Implement required unit/usability paths; schedule native desktop only as the extension. |

## 15. Delivery sequence and ownership checkpoints

| Milestone | Deliverable | Exit condition |
| --- | --- | --- |
| M1 — Shared runtime foundation | Project identity, authorization, persistence boundary, model-setting compatibility, honest failures, cancellation, and duplicate-start handling. | A new shared project completes one real browser run, retains accessible evidence, and records provider failures as blocked rather than confirmed defects. |
| M2 — Environment and mission context | Profiles, variables, readiness checks, manual/setup-cleanup lifecycle, mission revisions, and Static snapshot exchange. | A repeatable mission can be authored manually or from Static and records its prerequisites and versions. |
| M3 — Verified browser testing | Observer/planner/guard/executor/checker boundaries, criteria, evidence verification, exploration, regression, and bounded recovery. | Known good and defective paths are distinguished from infrastructure errors; reruns retain independent history and coverage gaps. |
| M4 — Usability, reports, collaboration | Persona/rule assessment, finding review, evidence bundles, report export, member visibility, and compatible module labeling. | Another authorized member reproduces a reported issue from the exported evidence; non-members are denied. |
| M5 — Unit and Codex completion | One existing-test framework adapter and complete Codex-backed model execution through the shared adapter. | Passing/failing unit cases and full Codex image/action/error/cancel flows meet their independent acceptance checks. |
| M6 — Evaluation and hardening | Fixed corpus, repeated evaluation, authorization/privacy checks, interrupted-run recovery, and release evidence. | Mandatory scenarios pass or blockers are explicitly recorded; metrics are reproducible and reported with limitations. |
| Extension — Native desktop | A separate OS/application control adapter and bounded evaluation cases. | Scheduled only after core milestones are accepted and time remains. |

Run the Codex capability spike early, alongside contract definition, so unsupported backend behavior is discovered before M5. Its integration is still required scope. Static implementation continues under its existing phase specifications; the shared milestones require coordination rather than transferring all Static work to JY. Establish report and evidence fields at M1 even though full report presentation is delivered at M4.

The sequence does not imply a fixed calendar commitment. Estimates depend on the existing platform's live acceptance, supported test framework, evaluation subject, and backend capability results.

## 16. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Shared project and old local session stores diverge | Define repository boundaries first, validate membership, reconcile legacy records, and prove new-project execution. |
| AI produces a false pass or false defect | Use explicit checks, independent evidence verification, bounded re-observation, uncertainty states, and human finding decisions. |
| Stale Static context guides a current application | Pin source snapshots, identify target version when possible, flag changed requirements, and retain unknown values honestly. |
| Mutable/shared test data makes runs flaky | Use setup contracts, run-specific identifiers, explicit locks where needed, and recorded cleanup outcomes. |
| Codex login works but vision/tool integration does not | Validate the complete capability flow early; retain API mode; do not claim feature completion from authentication alone. |
| Unsafe operations or sensitive observations escape the harness | Enforce configured policies, secret references/redaction, workspace restrictions, and origin/action checks in executable code. |
| Scope expands into native desktop or generated tests too early | Keep required Web/Unit/Codex work explicit and extensions separately scheduled. |

## 17. Open release decisions

These details remain to be specified; none is a reason to invent an implementation-completion claim.

- Initial unit-test framework and supported command/result format; Vitest is a practical candidate given the repository, not a promise to support every target project.
- Representative evaluation application, version, requirement corpus, known-defect set, and predeclared metric thresholds.
- Exact role/action permissions beyond existing membership behavior, including who may execute setup/cleanup and review Dynamic findings.
- Default Dynamic execution budgets and per-profile concurrency/lock behavior.
- Local credential backend, evidence redaction rules, retention periods, cleanup ownership, and upload/recovery behavior.
- Codex runtime distribution/version support, capability availability, account/usage handling, and packaged-desktop prerequisites.
- Report presentation and machine-readable schema details; report minimum contents in Section 11 are required now.
- Native desktop target OS/application set if time permits; explicit scheduling of heatmaps or generated unit tests.

## 18. Source and specification map

### Team sources

- [Final Year Project — Requirement tab](https://docs.google.com/document/d/1KTKOt1z3e-WZPIV2oMUq5T-EiXv6qxWqbRYRZubCLhM/edit?tab=t.wr724u4n0rl9): latest feature discussion, supplemented by the confirmed Web-first/native-desktop-extension and Codex-as-backend clarifications.
- [Final Year Project — JY 2 -FYP I](https://docs.google.com/document/d/1KTKOt1z3e-WZPIV2oMUq5T-EiXv6qxWqbRYRZubCLhM/edit?tab=t.9sdr86abpunc): standards-informed Web testing, personas, policy controls, evidence verification, recovery, and evaluation design.
- Project Scope and older proposal/FYP tabs are historical context where their desktop/collaboration statements conflict with the current scope above. Academic report changes are not performed by editing this PRD.

### Repository contracts

- [Design system](../DESIGN.md).
- [Authentication and identity linking](AUTHENTICATION_IDENTITY_LINKING_SPEC_2026-09-14.md).
- [Static Review Phase 1](STATIC_REVIEW_PHASE_1_SPEC_2026-09-21.md), [Phase 2](STATIC_REVIEW_PHASE_2_SPEC_2026-09-21.md), and [Phase 3](STATIC_REVIEW_PHASE_3_SPEC_2026-09-22.md).
- [Review approval and evidence](REVIEW_WORKFLOW_APPROVAL_EVIDENCE_SPEC_2026-09-10.md).
- [Project Assessment and Review Overview](PROJECT_ASSESSMENT_REVIEW_OVERVIEW_SPEC_2026-09-12.md).
- [Phase 2 acceptance audit](STATIC_REVIEW_PHASE_2_ACCEPTANCE_AUDIT_2026-09-22.md) and [Phase 3 acceptance audit](STATIC_REVIEW_PHASE_3_ACCEPTANCE_AUDIT_2026-09-23.md): evidence and outstanding acceptance gaps, not blanket completion claims.
- [Supabase setup](SUPABASE_SETUP.md).

### External implementation references

- [Alibaba Open Code Review](https://github.com/alibaba/open-code-review): reference for deterministic engineering combined with model-driven contextual review; not a native-desktop or browser-testing engine for Centinel.
- [Official Codex app-server documentation](https://developers.openai.com/codex/app-server/): reference for Codex integration and account lifecycle. Validate the selected runtime version and capabilities during the integration spike.

This revision replaces the previous generic PRD scope. Detailed source documents and existing implementation history remain intact.
