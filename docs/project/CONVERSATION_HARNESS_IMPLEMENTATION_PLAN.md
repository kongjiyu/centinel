# Conversation and Check Harness Implementation Plan

Status: in progress. The first implementation slice covers Project and Check conversation recovery.

## 1. Stabilize ordinary conversation

Use the same planning contract from Landing and Project. Capture the project, requested mode, goal, objective, scope and success criteria. Landing uses the selected project. Project uses the current project and the references in the draft.

- An explanation request starts no Code or Browser execution. A problem attachment should produce a plain-language explanation, the saved code excerpt and Browser snapshot where available, a recommended fix and a **Verify fix** action. If an excerpt is missing, explain what the saved record supports. If the record is unavailable, ask the user to reattach it.
- A blocking ambiguity about the target, scope or expected outcome gets one focused question. Preserve the draft and attachments. Show the inferred plan when the request can proceed.
- Preserve drafts, attachments, selected replies and admitted child runs through failed sends, refresh and restart. Recover an existing request before offering to resubmit it. Show the stage that stopped and its safe reason. Keep prompts, source bodies, secrets and private model reasoning out of diagnostic events.

## 2. Save and reuse Browser cases by project

Keep the test library project-scoped. Reuse the existing Dynamic mission and revision records where they can support the workflow. A saved case records its goal, route, preconditions, allowed actions, independent assertions and links to requirements or findings. Each run records its case revision, target version, verdict, and available snapshot and action trace.

1. **Find relevant cases first.** Filter the project library by route, scope, assertion and linked requirement or finding. Supply matching summaries to the planner and load full case details only for selected candidates.
2. **Reuse, revise or add.** Reuse compatible cases. Save a new revision when controls, steps or expectations change. Add new cases for uncovered behavior. Earlier runs retain their original revisions.
3. **Verify readiness and execute.** Validate the selected actions and assertions. For API-dependent cases, verify readiness for the exact declared service and retain origin enforcement. A startup failure records a blocked case and its reason.
4. **Check evidence freshness separately.** Reuse a compatible case definition and rerun it when prior proof is stale. Link compatible evidence when it already establishes the requested outcome. Record why a case or run was reused, revised, added or skipped.

## 3. Schedule Code and Browser execution

| Mode | Execution | Follow-up |
| --- | --- | --- |
| Code | Start Static Review for the selected source scope. | Offer **Test in Browser** for findings with an observable UI behavior. Clicking starts a separate Browser Check. |
| Browser | Reuse or revise the selected project cases, then run Dynamic Testing. | Offer **Review related code** when the journey maps to source. |
| Code and Browser | Start Static Review and initial Browser testing as separate children so they can overlap. | Match key Code findings to saved and in-flight Browser assertions. Prepare a second list only for important, observable findings without compatible proof. |

Match proof to the behavior and assertion, including preconditions and target version. A shared route alone is insufficient. Record omissions such as a finding with no observable UI behavior or a test that could not reach its assertion.

Keep **Attach Check** available from History and the saved Check card. Inherit the baseline Check's goal, objective and relevant scope. Apply the currently selected mode. A Browser follow-up to Code uses the Review as its baseline. A Code follow-up to Browser scopes the Review to related source and can offer **Test in Browser** afterward. Show inherited scope and material version differences before running.

**Verify fix** links the original finding and selects the mode or modes needed for current proof. Update the Problems list only when the required evidence supports resolution. Keep a blocked or inconclusive finding open. Retain the original finding and link the verification result.

## 4. Approve the whole Browser list

| Permission | Behavior |
| --- | --- |
| Ask First | Ask before the planned Review or Browser action. Present the entire Browser case list as a single approval, with scope, actions and assertions. Present a later list once if cases are added or the approved plan materially changes. |
| Auto | Ask about key decisions that materially affect target, scope or success criteria. Run clear in-scope plans without routine approval prompts. |
| Bypass | Skip interactive approval prompts. If missing information blocks a valid run, ask in the conversation and wait for an answer. Project authorization and execution controls still apply. |

Bind approval to the saved plan revision. A stale approval must not dispatch a changed plan. On cancellation or restart, retain any admitted child IDs and avoid duplicate dispatch.

Keep the requested mode and show independent Code and Browser outcomes. **Completed** means the requested coverage was verified. **Completed with gaps** means useful verified coverage was saved and the remaining gaps are explicit. **Failed** means neither child established the requested outcome. Show cancellation separately.

## 5. Acceptance and rollout

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Conversation recovery | Plain chat, problem and Check attachments, and Reply to recover the intended context. Explanations launch zero checks. | In progress | Landing parity, explicit Reply, Verify fix, and signed-in acceptance remain open |
| Small Cypress scope | Save and reuse a sign-in assertion, approve the whole list once, and retain the verdict and snapshot. | Planned | Duplicate send, changed revision, cancellation |
| Moderate Cypress scope | Start scoped Code and Browser together, verify invalid login, and show independent outcomes. | Planned | Frontend and API readiness skew, startup failure, provider interruption |
| Large Cypress scope | Reuse cases across authenticated routes. Add Browser follow-ups only for uncovered key Code findings. | Planned | Post-login discovery, stale proof, scope drift, duplicate coverage |
| Problem resolution | Verify a fix against the current target and update the Problems list only after the required evidence passes. | Planned | Changed assertion, partial result, stale build, recovery after restart |

Implement in this order: conversation recovery, project Browser library and list approval, combined execution and coverage matching, then finding resolution. Verify each stage with targeted sidecar and frontend tests before running the signed-in Cypress scenarios. Apply the repository build and viewport checks to frontend design changes. Save one receipt per scenario with the requested scope, approved plan, actual outcomes and evidence links.

## Implementation progress

1. Project and Check drafts retain their text, mode and saved attachment references across a desktop restart under the same account. Ordinary Project messages in Browser mode use the saved conversation planner. Explicit standalone Browser commands and test revisions continue through the existing Browser workflow.
2. An unacknowledged send retains its request ID. Reopening the composer looks up that ID. When the request exists, the composer restores the saved turn and clears only the original submitted draft. A retry of an unchanged message checks the same ID before posting again.
3. Unavailable references identify the context stage and ask for reattachment. Full first-stage acceptance still requires the Landing handoff, explicit Reply context, the Verify fix action and signed-in scenario evidence.

Verification on 2026-11-23 passed the frontend production build, 51 sidecar conversation tests, and the six frontend files rerun with two workers (82 tests). The default full frontend run passed 781 of 791 tests and reported nine timeouts and one missing-text assertion. All ten passed in the smaller rerun. A local Edge fixture with mocked responses verified draft recovery and visible composer controls without horizontal overflow at 1440×900, 1200×900 and 390×844. The signed-in native desktop check is pending.

A follow-up fixed a saved finding link that resolved back to the same Review page on every render. Review Findings and finding detail now use the shared Findings panel within the saved Review. The regression test opens a legacy finding link and leaves it for Landing, Settings and Project. The frontend build and 81 focused tests passed.

Sent conversation turns show their attachment references and render Markdown replies, saved Code snippets, Browser assertion tables and available snapshots inline. Older and failed turns can load evidence from the original saved references through the owner-checked read route. A nearby frozen source window is labeled separately from an exact saved excerpt and does not become verification evidence. The conversation suites passed 28 frontend and 55 sidecar tests. An Edge fixture displayed the inline evidence at 1440×900, 1200×900 and 390×844. Signed-in desktop verification is pending.

Attached problem questions use the configured model with saved evidence. The conversation displays the evidence first and the validated Markdown answer below it. Named module Reviews resolve a bounded list of current versioned repository files or ask for an explicit folder. A history read failure returns HTTP 503 with a safe database error code in the service log when available, while the client retains loaded turns and backs off polling. The prior generic error did not include a database cause. Signed-in provider and Supabase behavior remain unverified.

An explicit module Review from Browser mode switches the composer to Code after acceptance. The desktop cue uses a one-shot outline and a screen-reader announcement. Typing “proceed” or “go ahead” approves a currently displayed plan by its saved ID and revision. Without a waiting plan the sidecar explains the next step without invoking a model or running a check. Model-backed turns retain default same-owner, same-project recall of up to six completed turns within the 8,000-character recall limit and the shared planner budget. Verified with the frontend build, sidecar type check, 103 focused tests, and a mocked Edge check at 1440×900, 1200×900 and 390×844 with reduced motion. Signed-in desktop verification is pending.

Choice-based clarifications open at the top of Project chat. Choosing an option saves it on the original turn through an owner-checked revision update, then displays the question and selection in chat. The answer is available to normal recall and does not dispatch a Check. Older questions in the supported Markdown format follow the same flow. Open-ended questions stay inline. The sidecar tests and mocked Edge viewport checks passed. Signed-in desktop verification is pending.

The newest failed, paused or interrupted Project response opens an error dialog at the top of chat. Its explanation and recovery guidance come from allowlisted failure reasons or the saved stage. The original turn retains a control to reopen the dialog. The production build, sidecar type check, 93 focused tests and three mocked Edge viewport checks passed. Signed-in desktop verification is pending.

Questions and response errors now use non-blocking cards above the transcript and can appear together. Validation failures retain an allowlisted reason and log only that reason and the request ID. The older failed continuation retained only the validation stage, so its exact rejection is unavailable. An HTTP fixture reproduced the symptom with a model plan lacking eligible file scope and verified the new diagnostic. The sidecar type check, 94 focused tests, production build, and three mocked Edge viewport checks passed. Signed-in desktop verification is pending.

“Proceed with Code only first” now uses the same revision-bound approval as “proceed” when the latest saved plan is Code and no Browser attempt has been admitted. A waiting Browser plan remains available for separate approval. If no matching plan is available, ORIN asks for a repository folder or files without calling the planner or starting a Check.

A Code Review choice continues on the same saved turn. Explicit module requests resolve current files and honor the saved permission, with the current Ask first preference able to tighten it. Older answered module questions can recover a matching owner/project request and require a new scope approval. The selected choice and original question remain visible. If the required scope or browser success criterion is missing, ORIN asks directly for it. Repeated answers reuse the same turn and cannot admit another Review. Signed-in desktop verification is pending.

The reported “proceed a review on automation module” wording now uses named-module planning without history recall. If the history list fails, Project chat retains loaded turns and polls up to three known active requests by ID. A directly refreshed plan can still be approved by its saved revision. Legacy scope recovery asks for the folder if history is unavailable. Migration `202611230001_conversation_history_lookup.sql` adds the ordered audit index without changing RLS. In a local PostgreSQL fixture of 100,000 audit events the history query changed from a sequential scan and sort to an index scan, and migration replay succeeded. Hosted deployment and signed-in desktop verification are pending.

The automation Review log records 32 artifacts and 12 deterministic findings. Its saved gap label maps to `semantic_support`, while the attached log records independent statement timeouts on Review harness and source-index journal reads. In semantic-support follow-up, matching sources larger than the remaining budget now contribute bounded exact line excerpts from frozen packets. A regression verifies that a citation inside the appended range is accepted and the same citation outside the original packet is rejected. Migration `202611230002_review_journal_lookup.sql` indexes both timed-out query shapes. On a local 100,000-row PostgreSQL fixture both reads use their new indexes, and migration replay succeeded. The affected saved Review remains historical and the hosted migration and signed-in rerun are pending.
