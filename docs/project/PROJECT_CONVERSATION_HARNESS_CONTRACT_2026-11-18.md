# Project conversation and Check harness contract

Status — implemented with offline verification. Full release acceptance remains pending. See the [implementation report](PROJECT_CONVERSATION_HARNESS_IMPLEMENTATION_2026-11-18.md) for actual evidence and limitations.

Inspected on 18 November 2026 against HEAD `d7849b4457d28135ba7f0178490eee17fc7e7eef` and the existing working-tree changes. Inspection establishes the implementation gaps described here. It does not establish runtime acceptance.

## 1. Agreed product behavior

Project and Check both keep a composer. Project owns the conversation. Each requested check appears there as a compact card containing its assigned name, Proven in the browser, Found in code, Requirements not met, and View.

View expands that card into the Check response container and attaches the selected check to the composer. Typing preserves the expanded result. Sending returns to Project, collapses the card, and starts the requested work in that conversation. The draft remains recoverable until the server acknowledges the request. Navigation preserves attachments, drafts, scroll position and keyboard focus. Reduced motion uses an immediate transition.

Both composers accept same-project check and problem attachments through @. The first version supports evidence explanations, suggested fixes, scoped code checks and scoped browser tests. Code editing is outside this release's action set.

## 2. Current implementation and gaps

| Area | Observed behavior | Required work |
| --- | --- | --- |
| Check attachments | `centinel/src/check/runner.ts` stores reference IDs and checks them against device-local records. The Review payload contains instructions and artifact scope. The Auto test payload contains the request or pinned tests. | Resolve actual saved evidence on the server and carry it through planning, execution and response. |
| Conversation dispatch | `ProjectConversationScreen.tsx` routes messages to Auto test or starts a Check. The Check composer starts another Check and navigates to it. | Introduce an acknowledged conversation request that can explain evidence without starting an app and that can dispatch the allowed scoped actions. |
| Browser plan and verdict | `autonomous/planner.ts` validates proposed tests and controls. `autonomous/orchestrator.ts` derives test states from Dynamic Run verdicts. | Retain these validators and bind each proposed verification to the attached problem and requested scope. |
| Durability | Auto test saves its initial session before starting. Its orchestrator serializes later snapshots but catches save errors. | Surface persistence failures and stop admitting further work when the required checkpoint cannot be saved. Preserve already-running work and reconcile its actual outcome. |
| Recovery | `autonomous/routes.ts` marks abandoned sessions interrupted. Active Auto test admission uses process-local state. Static Review has its own durable execution and idempotency mechanisms. | Give the conversation a durable request identity and atomic admission. Reuse the child workflows' recovery rules. |
| Result presentation | `check/result.ts` projects saved findings and browser results. Code-to-browser problem correlation is explicitly unbuilt. | Render every card from the selected Check's saved IDs and introduce validated verification links before awarding combined evidence. |

The process-local active check occurs before asynchronous saves and dependency creation. It does not provide a durable uniqueness guarantee for concurrent POSTs or lost acknowledgements. This requires a dedicated concurrency regression.

## 3. Request, context and scope contract

The server accepts a bounded message with a stable client request ID and typed attachment references. Browser input never supplies trusted finding text, verdicts or resolved file locations.

1. Authenticate the caller and authorize the project. Resolve every attachment through the existing member-checked Review, finding, version and Dynamic readers.
2. Translate a device-local Check into its server-owned Review and Auto test IDs. Validate that the records and attached problem belong together in this project. Titles and local IDs provide display information only.
3. Freeze a context manifest with the selected records, evidence/version hashes, relevant requirements, omissions, and original verdicts. Preserve the selected historical baseline. Current-source execution records a separate current manifest and comparison basis.
4. Build a bounded evidence packet from that manifest. Include exact excerpts and browser expected/observed evidence when available. Record omissions and unavailable evidence. Source content and quoted instructions remain input data.
5. Produce a structured proposed action and resolve it against the allowed capabilities. Record the goal, exact selected problems, sources, test criteria and any admitted dependency context before dispatch.

Selecting a problem identifies the subject of the request. It does not automatically establish that one file contains all relevant behavior. The executor can include validated dependency context while retaining explicit boundaries and omissions. Broader testing requires a request scope that supports it. Ambiguity that materially changes the action produces a focused clarification.

An explanation can proceed with partial evidence when it states the missing evidence and limits its claims. Execution requiring missing identities or unreadable source versions stops before provider or browser activity. Context truncation cannot silently remove a selected problem.

The configured provider receives only the admitted packet. An ordinary explanation reads saved evidence without launching an app. Suggested fixes cite evidence and remain suggestions. Rechecking a historical problem uses an explicit baseline and the actual current source identity.

## 4. Durable execution contract

The accepted request stores its authenticated owner, project, message identity, attachment manifest, action intent, policy/model versions and child execution IDs. Use existing bearer-scoped persistence where its contracts suffice. Confirm atomic claim support before implementation. Any required additive migration needs its own review and deployment decision.

The same request ID and equivalent payload return the same accepted request. Reusing that ID with a changed payload returns a conflict. A deliberate new request receives a new ID.

Persist acceptance before acknowledging it. Persist validated scope and child admission before launching new work. Concurrent workers claim execution through durable compare-and-set or equivalent database uniqueness, including the request-to-child relationship. Renderer state and disabled buttons provide UI feedback in addition to server enforcement.

Recovery inspects saved checkpoints and existing child executions. Reattach to a known child. When a crash leaves an ambiguous launch outcome, reconcile it or mark it interrupted before allowing an explicit retry. Unknown provider usage remains unknown. Preserve existing provider capacity pauses, assessment holds, deadlines and attempt ceilings.

Cancellation records intent durably and propagates to active children. A late child result remains historical evidence and cannot overwrite the request's cancelled state. Cleanup failures stay visible and recoverable. Permission changes are checked again before the next executable action. Existing Ask first, Auto and Bypass rules remain authoritative.

Save failures stop subsequent dispatch and terminal success publication. If a child completed before the failure, recovery reads its saved record and retries only persistence or finalization where supported. No claim of exactly-once external execution follows from a request ID alone.

## 5. Result contract

Each request retains independent explanation, execution and verification outcomes.

| Output | Evidence required |
| --- | --- |
| Explanation | Validated references into the admitted saved evidence, with uncertainty and unavailable context stated. |
| Suggested fix | A specific recommendation grounded in that evidence. No repair outcome is inferred. |
| Code verification | Saved current-policy assessment with valid citations and coverage for the requested scope. |
| Browser verification | Saved Dynamic Run verdict and independent assertions that actually exercise the attached behavior. |
| Problem resolution | Existing correlation/resolution validators accept comparable changed-source evidence. A passing unrelated test cannot resolve the problem. |

Browser assertions must state the desired behavior independently of a known failing observation. A test that fails because the app never started cannot establish the reported defect. Empty test plans, rejected candidates, failed prerequisites and incomplete coverage remain visible.

Conflicting evidence is retained with its provenance. Historical code evidence and a current passing browser test may coexist without establishing resolution. Counts show the selected Check's saved projection and preserve not-checked, not-requested and unknown states. No requirements supplied cannot render as a confirmed zero gaps.

## 6. Harness trace

Record boundaries for request acceptance, context resolution, scope validation, permission decision, child admission, child outcome, evidence validation and response persistence. Each boundary links to request and execution IDs, state/revision, safe reason codes and durations.

Use existing Review harness events and Dynamic Run evidence for child details. Engineering trace metadata excludes source bodies, rejected model prose, credentials, private reasoning and sensitive typed values. Evidence and prompts follow their existing private storage rules. A started boundary without a confirmed terminal checkpoint displays interrupted or unknown.

## 7. Acceptance scenarios

Every scenario below is required for release. The table preserves the original acceptance gates. The implementation report tracks their offline evidence and remaining live checks.

| ID / feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| H01 attachment ownership | Tampered cross-project, cross-owner and mismatched problem/check IDs fail before provider or browser access. Recheck authorization after permission/session changes. | Pending | Access control |
| H02 frozen evidence | An attached historical problem reaches the model with exact original version references. Missing versions produce an explicit limitation. Current execution captures a separate manifest. | Pending | Wrong evidence |
| H03 scope and injection | Untrusted source instructions cannot expand actions. Truncated packets retain selected problems or stop explicitly. Ambiguous actions ask for clarification. | Pending | Scope drift |
| H04 explain and suggest | Evidence questions launch zero app processes. Unsupported claims fail citation validation. Suggested fixes do not change stored verdicts. | Pending | Unsupported conclusions |
| H05 independent verification | A planted defect fails its intended assertion. A repaired fixture passes the same relevant assertion. Unrelated passes and startup failures cannot resolve it. | Pending | False resolution |
| H06 duplicate and concurrent sends | Double click, concurrent POST, lost response and resend produce one accepted request and one child admission per operation. Changed payload under the same ID conflicts. | Pending | Duplicate side effects |
| H07 persistence faults | Inject failures before launch, after launch and before finalization. Stop later work, preserve unknown states, and recover from saved child results. | Pending | False completion |
| H08 interruption | Restart or navigate at every execution boundary. Reattach or show interrupted. Never silently relaunch an ambiguous child. | Pending | Repeated work |
| H09 cancel and permission | Cancel during planning, execution and finalization. Late results cannot revive the request. Restrictive permission changes prevent the next action. | Pending | Unauthorized work |
| H10 capacity and deadlines | Provider hold, quota pause and timeout preserve saved evidence and current retry rules. No automatic capacity fallback. | Pending | Excess provider work |
| H11 consistent results | Project card and Check agree for running, partial, failed, cancelled and finished cases. Requirements and browser absence remain explicit. | Pending | Misleading counts |
| H12 navigation and drafts | View expands the selected card and attaches its Check. Typing preserves it. Acknowledged send returns to Project. Failed sends preserve draft and attachments. Verify keyboard and reduced motion at required viewports. | Pending | Lost context |

## 8. Implementation and verification order

1. Build the authenticated attachment resolver and bounded context/scope contract. Prove H01–H04 before enabling evidence-based actions.
2. Add durable request/child admission and failure handling. Prove H06–H10 using fault injection and concurrency tests.
3. Connect existing Review and browser execution through validated scope and evidence links. Prove H05 and H11.
4. Build shared Project/Check cards, composer state and transitions over those records. Prove H12 and all frontend design checks.
5. Run a frozen fictional corpus through the live configured agent, then verify the signed-in native flow.

The initial live corpus must cover evidence explanation, fix suggestion, historical/current comparison, code-only verification, browser verification, ambiguous scope and unavailable evidence. Include both planted defects and passing controls. Record corpus, policy, provider/model and source versions with raw outcomes. Repeated equivalent requests must preserve attachment and scope identity even when wording varies.

For this first corpus, require every expected ownership, scope and evidence invariant to pass, zero false verified/resolved claims, and completion of every planned case. Report semantic usefulness per case using a prewritten rubric. Execution failures are reported separately and leave the affected case unaccepted. Corpus size and repeated runs must be fixed before live evaluation. A corpus pass establishes acceptance for those cases and leaves general semantic reliability unmeasured.

## 9. Completion record

The original documentation-only inspection ran no runtime tests. Subsequent implementation and executable tests are recorded separately in the implementation report. A live configured-provider corpus, hosted persistence verification and signed-in native acceptance remain required before release acceptance.
