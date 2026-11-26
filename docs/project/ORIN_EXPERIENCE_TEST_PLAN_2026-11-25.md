# ORIN experience test plan and harness requirements

Draft for discussion. Baseline `00bee32`. Run the six scenarios manually in the ORIN desktop app. Record actual behavior before accepting a scenario.

## Start ORIN on Windows

From PowerShell, open the checkout and start the development launcher.

```powershell
Set-Location C:\Cstan\Projects\centinel
pnpm dev
```

Keep that terminal open. This checkout uses local Supabase. After a reboot, check [Supabase Studio](http://127.0.0.1:54323). If it is offline, start Docker in the existing WSL distribution in a separate PowerShell terminal and keep that terminal open.

```powershell
wsl -d CentinelLocal -- dockerd
```

Once Docker is ready, use another terminal to run the following from the checkout if the existing Supabase containers did not come up automatically.

```powershell
wsl -d CentinelLocal -- supabase start
```

If the stack is already up and only the Edge Runtime container is stopped, use `wsl -d CentinelLocal -- docker start supabase_edge_runtime_centinel`. Sign in with your local ORIN account and check **Open AI settings** for a provider before starting a live check. Run `pnpm dev:check` if the launcher reports a port conflict.

## Fixtures and receipts

- **Sample Shop** is the baseline for all six scenarios. Attach its `docs/requirements.md` to the check when testing requirement traceability.
- **Mystic Home Creation** repeats scenarios 1–3 at moderate scope. Before Browser runs, confirm the app starts and write down the expected behavior. Use the repo's own requirement evidence where available.
- **n8n** is the large-scope test. First confirm that ORIN discloses its partial import, which saved 2,000 files. For a functional test, bound the request to a named feature and record the paths or Browser flow actually covered.

For each run, record the repo revision, mode, request, attached requirement and source IDs, approval decision, Code Review ID, Browser run ID, saved verdicts, and any scope omissions. Capture what the user sees and the evidence that supports it. Record **Blocked** when startup or provider setup prevents execution. Review the receipt before moving to the next repo.

## Manual acceptance scenarios

| Feature | Acceptance criteria | Status | Risk flags |
|---|---|---|---|
| 1. Default Code + Browser | From the Sample Shop project, choose **Run a full check**. Confirm the initial mode is Code and browser. Approve the detected Browser startup when prompted. Verify a saved Code Review and a saved Browser run with independent verdicts. Repeat with a controlled startup failure and verify the attempt and failure remain visible and Code can finish. | Pending live run | A failed or missing Browser run must remain visible in the result. |
| 2. Code only | Select **Code** and ask “Review checkout total calculation and order validation. Explain which code paths cause discrepancies with the attached requirements.” Verify scope and frozen file citations, the affected branch and observable consequence, and any unsupported or omitted scope. Confirm the journal has a Code Review and no Browser run. | Pending live run | Broad requests can be narrowed. Confirm the proposed paths before execution. |
| 3. Browser only | Select **Browser**. In Sample Shop, verify a signed-out visitor can see product names and USD prices with two decimals (REQ-2), and the normal checkout UI requires sign-in (REQ-3). Verify a deliberately different expected message yields a failed assertion with a saved observation. Repeat with missing criteria and verify ORIN asks for an expected outcome. Confirm no Code Review is created. | Pending live run | A verdict applies to the saved assertions and tested state. |
| 4. Explain a saved check | `@` a completed check and ask “What did this check focus on, what was its objective, how many problems were saved, and which quality attributes were affected?” Verify the answer identifies the selected Check, distinguishes Code findings from Browser assertions, and grounds scope, counts, and any quality labels. Repeat for a failed or partial check and for a check with zero findings. Confirm no new run. | Pending live run | Current saved presentation has incomplete objective and quality coverage. |
| 5. Explain a saved problem | `@` a problem with a saved recommendation and source excerpt. Ask “What is the fix?” and compare the answer with the saved record. Then ask “Walk me through how an ordinary customer would see this issue.” Verify that the saved detail, recommendation, and affected code are visible and that the walkthrough adds only grounded explanation. Repeat with a missing excerpt and with a newer working-tree revision. Confirm no new run. | Pending live run | Saved text has display limits. Missing historical evidence must be explicit. |
| 6. Conversation continuity | State a distinctive preference, discuss a saved check, and ask a follow-up without reattaching it. Verify the last message and reply are recalled. Add seven unrelated completed turns, reopen the project, and ask for the earlier preference, the earlier assistant answer, and the check objective. Repeat with an explicit **Reply to**, then in a different project and account. Compare against the originals. Confirm historic text cannot silently authorize execution. | Pending live run | Current ambient recall is bounded and does not hydrate check IDs. |

## Harness architecture assessment

### Act on before acceptance

1. **Separate project context from conversation history.** The planner retrieves up to six completed earlier turns under an 8,000-character recall cap. Its ambient projection carries request text, assistant reply, and selected option. It drops structured Check and finding references. A user can return after seven turns and ask about a Check that ORIN can no longer resolve from ambient recall. Keep a paginated transcript and a project-scoped index of typed references. Resolve the canonical Check record on demand. See `sidecar/src/conversation/service.ts` and `store.ts`.
2. **Give saved Check explanations a stable contract.** The current deterministic presentation can show counts and example findings for Code and bounded saved outcomes for Browser. It has no required objective or quality breakdown. Persist or resolve the original objective, executed scope, omissions, and canonical quality domains. Define counts per result type and deduplicate only where the saved records prove a relationship. See `sidecar/src/conversation/evidence.ts` and `savedExplanation.ts`.
3. **Preserve a path to the full saved problem.** The inline presenter caps saved description at 480 characters, recommendation at 280, and excerpt at 1,200. Keep the concise card and offer access to the complete original record and frozen source when available. Answer scenario questions using those records and label inferences. See `sidecar/src/conversation/savedExplanation.ts` and `plan.ts`.

### Keep and verify

- **Execution authority.** The full-check runner can start both children. Project conversation uses one validated planner action for a turn and can fall back from Browser startup only under supported conditions. Accept both entry points using explicit tests. Keep approval, mode enforcement, target matching, and expected-result validation outside the model. See `centinel/src/check/runner.ts`, `sidecar/src/conversation/service.ts`, and `verification.ts`.
- **Skills boundary.** The existing planner prompt, action schema, and application validators are the observed mechanism. A generic skills registry is unnecessary for this draft. Treat Code verification, Browser acceptance, saved explanations, and recall as explicit intent contracts. Keep shared authorization and evidence verification in the harness. Browser checks should use approved fixtures, ordinary UI actions, and saved assertions for product behavior and defensive controls.

## Proposed continuity requirements

1. Fetch the recent transcript in order and retrieve older turns by explicit reply or relevance. Store references as stable IDs with provenance and bind reads to the authenticated owner and project. Resolve current questions about a historical check from its saved run and source versions.
2. Compact older discussion into user preferences, decisions, unresolved questions, and typed references with source turn IDs. Retain the full transcript for paging and exact quotation. Show a clear fallback if history or compaction is unavailable. Validate that compaction preserves corrections and rejected decisions.
3. Cache derived context only if measured retrieval latency warrants it. Bind cache keys to owner, project, transcript revision, compaction schema, and referenced record versions. Revalidate access on use. Treat cached and compacted text as discussion, with execution authority coming from the current request and applicable approvals.
4. Capture safe diagnostics for selected turn and check IDs, truncation, and cache outcomes without prompt bodies, source contents, or secrets.

## Confirmed harness requirements

1. An explicit “run both” request on the Project Page should start Code and Browser using the same workflow as **Run a full check**. Verify both produce the same child execution records, apply the same approval rules, and report Browser startup failure consistently. A request to explain a saved check leaves the existing runs untouched.
2. By default, conversation context carries a relevant Check ID and a brief description of its requested focus or objective. Derive that description from saved intent or the configured default scope. Mark unavailable intent as unknown for older records. Keep the executed scope and results in the linked records.
3. Resolve detailed Check context when the current question needs it or the user explicitly `@` mentions the Check. Resolve only the evidence relevant to the question. Test a follow-up that needs Check details without an `@` mention, an explicit mention, an unrelated turn that needs no detail fetch, an ambiguous reference, and a Check outside the active project or account.
4. The current Check ID is device-local. Its record contains the requested focus, mode, optional selected source IDs, and child Review and Auto test IDs. The app can build a result summary from those records. The conversation sidecar currently receives the child IDs for a Check mention. A server-resolvable Check ID needs an authorized mapping to those records. Verify that older checks without a mapping can still be opened through their existing child references.
5. Combined Check explanations show saved Code findings and failed Browser assertions as separate counts by default. Show a connection between them when saved evidence supports it. Distinguish zero from unavailable when either part could not run or its results could not be loaded.

## Confirmed conversation behavior

| Feature | Acceptance criteria | Status | Risk flags |
|---|---|---|---|
| Transcript and retention | Keep the full transcript retrievable by the same account within the project until the user removes it. Preserve cancelled turns with their status and display unfinished turns with their current state. Give the planner recent context and retrieve relevant older turns as needed. Verify pagination, recall after reopening, cancellation display, and account and project isolation. | Pending implementation and live verification | Historical turns provide discussion context. |
| Check selection | Use an explicitly attached Check when the question refers to it. If the immediately preceding message clearly discussed one Check, resolve “that check” to it directly. Use a single clear match where available. If several Checks still fit, show a choice prompt in the conversation, mark the latest matching Check as recommended, and wait for the user to choose. Verify an older attached Check wins over a newer one, an unambiguous previous turn skips the prompt, and a non-recommended choice controls the answer. | Pending implementation and live verification | Keep candidates within the active project and account. |
| Quality attributes | Determine which attributes are affected from the saved Review domains, Browser outcomes, the problem itself, and the affected modules and scope. Explain the evidence for each label and allow multiple labels when supported. Verify a problem with corroborating Code and Browser evidence, a failure with several supported attributes, and a result with insufficient evidence for a label. | Pending implementation and live verification | An assertion failure or a module name alone may leave the quality impact uncertain. |
| Saved problem detail | For an explicit `@problem` mention, show a concise card with the saved explanation, fix recommendation, and affected code location or available frozen excerpt. **View original problem** opens the complete saved record. Answer the specific follow-up using saved evidence and identify unavailable fields. Verify the card, original record, and a scenario walkthrough anchored to the same problem. | Pending implementation and live verification | Preserve historical source links and distinguish the saved record from the explanation. |

## Verification for this draft

ORIN's desktop process was running, and the frontend, sidecar health endpoint, and local Supabase Auth returned HTTP 200. Existing targeted tests passed (88 sidecar and 19 frontend). The architecture assessment is based on source inspection and those tests. All six manual scenarios remain pending.

## Harness tuning plan

### 1. Establish the baseline

Use the [Sample Shop receipts](ORIN_SAMPLE_SHOP_HARNESS_EVIDENCE_2026-11-25.md) and keep each accepted historical result attached to its original run. Use the saved MiMo combined Check and finding for read-only retests. The baseline has a completed three-file Code Review, a passing Browser assertion, a deliberately false assertion with the expected failure, and a clarification when criteria were missing. The combined run saved nine Code findings, two Code coverage gaps, and independent Browser results. Older recall and the Check picker worked live. The generated problem walkthrough fell back to the saved card, and the post-reload retests were blocked by desktop automation.

Record the working revision, provider/model, project and run IDs, input, selected evidence IDs, response or fallback, validation result, elapsed time, and number of children dispatched. Keep credentials and private source contents out of diagnostic receipts. Use saved findings for explanations so a tuning run does not change the expected evidence.

### 2. Tune the two explanation paths

1. Reopen Sample Shop with the latest sidecar and run scenarios 4 and 5 on the saved records. Include the same prompts on both the original and tuned path when comparing a behavior change.
2. For `@check`, resolve the Check ID and load the requested objective, actual saved scope, coverage gaps, Code findings count, and failed Browser assertion count. The harness should render these facts directly. Use the planner for the explanation of quality impact, with a saved domain, outcome, problem, or affected module supporting each label. Show a Code–Browser relationship only when the saved evidence establishes it.
3. For `@problem`, show the saved explanation, recommendation, and source location or historical excerpt. **View original problem** must open that same finding. Test a question the saved card already answers and a customer walkthrough that needs additional reasoning. The walkthrough should identify what is recorded, what follows from the evidence, and what remains unknown.
4. Keep the planner's available actions tied to the current intent. Both explanation scenarios must dispatch zero Code or Browser children. An invalid action, invalid citation, or timeout must preserve the saved card and visibly disclose that the generated answer is unavailable. Count that as a successful fallback and an unsuccessful generated answer.

Retest one completed record, one partial or unavailable record, and one record with a verified zero count where applicable. Keep the successful path and the fallback path separate in the receipts.

### 3. Close continuity gaps

- Add an owner- and project-scoped mapping from Check ID to its saved Review and Browser records. The agent receives the relevant ID and one-line purpose by default. Fetch details only when a question requires them or the user `@` mentions the Check. Verify older records can still resolve through their saved child references.
- Confirm an explicit attachment or a clear reference in the preceding turn resolves directly. With several plausible matches, show the choice card, recommend the latest, and verify that choosing an older Check loads its evidence.
- Keep the transcript retrievable until the user removes it. Verify pagination, cancellation status, removal behavior, and access isolation. Compact older material into preferences, decisions, unresolved questions, and references with original turn IDs. Compare old quotations against the transcript. Add a cache only if measured retrieval latency justifies it, with account and project scope and invalidation on transcript changes.
- After reopening the project, verify recent recall, an earlier decision after seven intervening completed turns, a correction that supersedes an older decision, and exclusion of another account's or project's records.

### 4. Rerun the acceptance gate

| Feature | Required acceptance evidence | Current evidence | Risk flags |
|---|---|---|---|
| 1. Full Check | Each entry point produces one combined Check with two independent child records. Controlled Browser startup failure remains visible while Code continues. | Both children saved with MiMo. | Startup-failure path still needs a live receipt. |
| 2. Code only | The saved scope, root cause, and source citations agree. No Browser child starts. | Live three-file `src` run completed. | Reuse this receipt unless scope or routing changes. |
| 3. Browser only | Positive, negative, and missing-criterion cases produce their expected independent outcomes. | All three observed on Sample Shop across the recorded runs. | Limit Browser verification to the approved local fixture and ordinary UI controls. |
| 4. Check explanation | The generated answer cites the Check, distinguishes the two counts, supports the quality labels, and starts zero children. | Saved combined overview observed. | Generated quality explanation requires a live retest. |
| 5. Problem explanation | The answer adds a grounded customer walkthrough and starts zero children. The original problem link opens the same record. | Saved card and original problem navigation observed. | Generated walkthrough requires a live retest. |
| 6. Continuity | Check selection, paginated history, compaction, removal, and isolation meet the criteria above. | Live recent and older recall and older Check selection observed. | Remaining lifecycle and cross-account checks are open. |

Run the targeted sidecar and frontend suites, the frontend build, and applicable SQL regression tests. Check the conversation UI at 1440×900, 1200×900, and a narrow viewport. Record each scenario as passed, failed, blocked, or pending against its own criteria. Move to Mystic Home Creation only after all six Sample Shop scenarios pass. Move to n8n after the moderate run passes and use a named scope with the import and coverage limits visible.

### 5. Decide whether model training is needed

Start by tuning the harness: intent constraints, evidence projection, deterministic presentation, and validation. If repeated, comparable retests still show a model-specific failure on well-formed evidence, first build an evaluation set from reviewed, sanitized examples and reserve a separate holdout set. Compare the current provider and configuration against that set before proposing any model-weight changes.

## Agreed conversation presentation

| Turn | Presentation | Acceptance check |
|---|---|---|
| Project status | Give a short opening sentence and up to three bullets for Code, Browser, and what remains open. Use the latest Check by default. Include another run when the user asks about it. | Ask “Where are we now?” after a standalone and a combined Check. Verify each answer uses the intended saved run and identifies any missing part. |
| Recall or simple Q&A | Use brief conversational prose and keep the reference to the earlier turn where applicable. | Verify exact quotations and their original attribution. |
| Browser result | Show the Browser card directly after the request. Follow it with a brief first-person reply grounded in the saved verdict, expectation, and observation. | Verify card-first order for passed, failed, and unclear outcomes. |
| Explain a Problem or Check | Show the saved evidence card first. Answer the user's actual question beneath it. Use a customer perspective when the question asks for it. | Ask about a fix, scope, and customer impact separately. Verify each answer addresses its own question, with no new execution. |
| Conduct a Review | Keep the Review card in the turn that requested it. Once a Review record exists, its card replaces the separate Code Review scope block. Show the approval scope while an approval decision is pending. After the Review ends, add a short first-person outcome based on saved records, including any reported gaps or failure. | Send “Review src”. Verify the order is request, one Review card, then brief outcome. Verify the approval scope is available before approval and the scope block does not reappear under the finished Review. |

Use prose for a single answer, bullets for distinct points, and a table when several items share fields the reader needs to compare. Show saved screenshots for visible Browser evidence, replay for sequences, and frozen code excerpts for Code evidence. Keep those assets accessible from the relevant card.
