# Project conversation and Check implementation

Status: implemented and verified offline on 18 November 2026. Release acceptance remains pending live-provider, hosted-storage and signed-in native checks. This report supplements the [contract](PROJECT_CONVERSATION_HARNESS_CONTRACT_2026-11-18.md); it does not mark every original acceptance gate complete.

## Observable behavior

Project owns the conversation. Compact cards show a Check's assigned name and saved browser, code and requirement results. View expands the selected card into its Check response and attaches that Check to the composer. Typing leaves the response open. An acknowledged send returns to Project with the request in the conversation. A failed send preserves the draft, attachments and retry identity; text typed while a send is pending survives its acknowledgement.

Both composers share account/project-scoped session drafts and support Check and problem mentions. Project position and composer focus are restored on return. The transition lasts 220 ms and respects reduced motion. Unknown requirements and unavailable evidence remain explicit rather than appearing as zero problems. Counts come from the selected Check's saved executions. Explanations are labeled AI analysis.

Allowed conversation actions are explaining evidence, suggesting fixes, scoped code assessment and scoped browser tests. A request dispatches one selected action. Code edits are outside this action set. Ambiguous execution intent or unsupported browser criteria produce clarification.

## Harness boundaries

`sidecar/src/conversation/` contains the request types, durable store, runtime, evidence resolver, structured planner and browser target validator. Frontend integration lives in `check/conversation.ts`, `problemMentions.ts`, `checkTransition.ts`, `projectNavigation.ts`, `ProjectCheckCard.tsx` and `ConversationTurn.tsx`. Routes and existing child-workflow adapters live in `sidecar/src/index.ts`.

Requests use the existing bearer-scoped `audit_events` table, with atomic UUID insertion, canonical payload identity and revision compare-and-set updates. Duplicate equivalent sends return the saved request; changed payloads conflict. Each worker renews a two-minute lease every ten seconds. Reads respect another worker's live lease. Expired or ambiguous work becomes interrupted without silently replaying external actions. Child execution IDs are checkpointed before dispatch. No exactly-once external execution guarantee is claimed.

Project authorization and original-owner checks guard admission and subsequent boundaries. Verified same-owner credential adoption follows JWT issuance ordering. Ask first requires a current revision confirmation. Restricting permission to Ask first cancels already-running conversation requests; action admission checks prevent subsequent launches. Cancellation is durable, and late work cannot revive the request. Required persistence failures stop later work and prevent terminal success publication. Capacity pauses and assessment holds retain their existing stop behavior. No migration or service-role credential was introduced.

The resolver reads actual saved Review/browser records and original source versions. It validates attachment relationships, exact excerpts and evidence hashes. Selected evidence exceeding the packet bound stops explicitly. Current-source execution records a separate manifest and retains the historical comparison context. Planner prompts treat evidence as data. Structured output, citation IDs, exact supporting quotes, scope and mode are validated before execution. AI prose cannot award a new saved verification or resolution outcome.

Browser verification reuses an attached saved test's controls and assertions, or requires an explicit positive visible-message criterion tied to the selected source. Quoted input values do not become expected output. Conflicting or negated criteria require clarification. Every generated test must match an admitted target; adding an unrelated test in the same file is rejected. Broader assertion types and semantic entailment of free-form AI analysis remain limitations. Existing saved Run and Review validators remain the authority for results and resolution.

Dynamic orchestration now surfaces checkpoint failures, stops further admission after persistence errors, checks permission before app/run admission, propagates capacity stops, bounds cancellation acknowledgement, and preserves cleanup errors. Paid model calls reserve their usage record before execution and update the same record afterward; accounting failures stop work rather than trigger another paid call.

## Acceptance evidence

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Ownership and frozen evidence (H01–H02) | Reject mismatched references; preserve original versions and unavailable evidence | Offline unit/HTTP tests passed | Hosted RLS/CAS and native account switching unverified |
| Scope and analysis (H03–H04) | Validate citations, exact quotes, mode and action; explanations do not launch execution | Offline tests passed | Exact quotes do not prove semantic entailment of every sentence; live injection/quality corpus pending |
| Independent verification (H05) | Same relevant assertion fails a planted defect and passes the repaired fixture; reject unrelated tests | Real Chromium fixture and target-validation tests passed | Live generated-plan relevance and broader assertion types unverified |
| Duplicate admission (H06) | Equivalent concurrent IDs converge; changed payload conflicts | Unit and real HTTP tests passed with test storage | Hosted database uniqueness/CAS behavior unverified |
| Faults and recovery (H07–H08) | Save failures stop later work; retain children; respect healthy leases; interrupted work is not replayed | Fault-injection and recovery tests passed | Full native process-kill boundary matrix pending |
| Cancel, permission and capacity (H09–H10) | Late responses cannot revive cancelled work; restrictive changes stop admission; holds and capacity stop calls | Automated tests passed | Live provider cancellation/accounting outcomes pending |
| Result consistency (H11) | Cards and Check use saved result projection; missing requirements remain unavailable | Frontend regressions passed | Hosted historical-data sampling pending |
| Navigation and drafts (H12) | Expand View, attach Check/problem, retain typing, preserve failed-send/newer drafts, return on acknowledgement | Frontend tests plus Chromium at 1440×900, 1200×900 and 390×844 passed | Signed-in Tauri and assistive-technology acceptance pending |

Independent read-only review by GPT-6.1 Sol identified missing browser-target binding, missing historical execution context, insufficient citation support, permission rechecks, navigation preservation and criterion polarity mistakes. Those findings received implementation changes and regression coverage. The final targeted recheck confirmed the last polarity finding addressed and identified no remaining blocker in that recheck; it did not independently rerun tests. Live semantic reliability remains an open acceptance gate.

## Commands and results

Final checks ran successfully against the working tree on 18 November 2026:

1. Sidecar Vitest: seven conversation/orchestrator/usage/browser/HTTP files, **56 tests passed**, plus `integration/activeHttpAuth.test.ts`, **45 tests passed**: **101 total**.
2. Frontend Vitest: Project conversation, Check flow, Start, AppShell and runner files, **67 tests passed**, plus `CheckScreen.test.tsx`, **6 tests passed**: **73 total**.
3. `pnpm --filter centinel build`: passed TypeScript and production Vite build.
4. `pnpm --filter @centinel/sidecar exec tsc --noEmit`: passed.
5. Temporary Chromium UI fixture using actual AppShell/Project/Check components: round trip, problem context and an active 220 ms expansion animation passed at all three required widths. A separate reduced-motion fixture passed earlier. Fake API records were used; this was not a native or live-provider test.

Screenshots were inspected for desktop and narrow layouts; the narrow composer overlap found during verification was corrected. Fixture screenshots are local temporary evidence, not committed product assets. No live provider quality or hosted persistence acceptance follows from these checks.

## Project header and compact check card

Project Sources, history and Run a full check remain above the conversation when it scrolls. The compact card's Not checked badge opens the coverage entries. Export report saves a Markdown summary from the card's own saved Check, including browser-only checks. A cancelled native save leaves no file.

The four targeted frontend suites passed 32 tests, including mocked native save and cancellation. With fixture data, Edge verified scroll position, Sources, history, the gap disclosure, downloaded report contents and View at 1440×900, 1200×900, 720×900, 390×844 and 375×812. Live Windows save and the reported browser runs were not exercised.

## Remaining release verification

Use a fictional, frozen eight-case corpus, repeated three times (24 complete live cases): saved code explanation; saved browser explanation; suggested fix; scoped code recheck; saved browser rerun; explicit positive-message browser check; ambiguous/negative criterion clarification; adversarial source instructions. Freeze fixture versions, expected action/scope, relevant evidence and expected assertions before running. Record provider/model/policy provenance, real usage, child IDs and validation outcomes. Score action, evidence relevance, criterion relevance and unsupported claims separately; execution failures cannot count as semantic passes. Any unauthorized action, unrelated verification or unsupported resolution blocks acceptance. This live corpus has **not run**.

Also verify hosted insert/CAS/RLS behavior, signed-in native navigation, restart/cancel fault boundaries and provider capacity handling. Restart the original development terminal to load backend changes; an already-running sidecar is not automatically refreshed by this implementation. Existing user processes were not restarted.
