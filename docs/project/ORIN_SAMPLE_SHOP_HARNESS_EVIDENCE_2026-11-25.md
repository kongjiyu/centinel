# ORIN Sample Shop harness evidence

25 November 2026 · Local ORIN desktop and Supabase · Baseline `00bee32` plus working changes. The fixture contains ten imported files, including its requirements document. The records below capture desktop observations and read-only local database receipts. Scenario results and app test verdicts are separate.

| Feature | Acceptance criteria | Status | Risk flags |
|---|---|---|---|
| 1. Default Code and Browser | One Check starts both children and retains independent results. | Both children completed on MiMo. Code completed with gaps. | The test used Auto permission. Startup denial remains untested. |
| 2. Code only | A bounded Code Review saves evidence without a Browser child. | Passed for the three-file Sample Shop scope. Four analysis batches and one finding were saved. | The receipt covers `src`. |
| 3. Browser only | Use explicit expected behavior and retain an independent Browser verdict. | Passed. The positive assertion passed, the false expectation failed with a saved observation, and a missing criterion prompted clarification. | Verdicts apply to the recorded assertions. |
| 4. Explain a saved Check | Resolve the selected Check, report scope and separate counts, and explain quality impact without starting a child. | Partial. A scoped Check explanation reported the saved objective and three source paths. The combined saved overview completed after restart with separate partial counts. | Generated combined quality attribution remains unverified live. |
| 5. Explain a saved problem | Show the original record and provide a grounded walkthrough. | Saved Browser evidence rendered. The Code problem card showed its saved recommendation and opened the original finding. | The generated customer walkthrough stopped in planning. The selected Code finding lacked a verified original excerpt. |
| 6. Conversation continuity | Resolve a recent turn and an earlier Check after reopening. | Exact previous reply matched after reopening, the Check picker honored an older choice, and a later question cited a turn beyond the six most recent. | Live cross-account and cross-project checks remain unverified. The owner restriction passed the local database regression. |

## Saved IDs and observed text

1. **Full Check.** Code Review `57d88893-1b11-44b2-b5ec-8c53eb593e60`, Browser session `9bef5752-59d3-4a26-a08d-30d7d35ac0c8`. ORIN displayed **Code and browser** and **Started the app** in the same card. The Browser record verified catalogue name and price visibility and the guest checkout control. The Browser UI preserved the saved failed sign-in assertion and an unclear discount result.
2. **Code request.** Conversation turn `ed0c9fcf-54bd-45d5-8f1f-214abd5d70d9`, Review `efe26a36-820e-483a-af0b-24405f34f4c2`. The input was “Review src”. The saved reply was “Code Review scope”, “Folder or file: src”, and “Saved repository files: 3”. The composer switched to Code and the saved conversation turn did not have a Browser child.
3. **Browser request.** Session `c622bf98-4fb2-45c1-9f6b-3e2897f4edef`. Input was “Test that the signed-out Sample Shop catalog shows \"Ceramic Mug\".” ORIN replied “I’ll verify that signed-out visitors can see Ceramic Mug in the Sample Shop catalogue.” The saved assertion passed. Negative control `f07a3b39-a590-4876-9898-24b0f70795bf` asked for “Origami Telescope” and saved `provider_paused` before a verdict.
4. **Check explanation.** Conversation turn `446c5ca1-8ce2-4a18-8abb-c42b7617c49c` referenced the two full-check children. The saved evidence rendered a Code findings count and Browser assertions, with a limitation for unavailable results. The generated answer stopped at planning and ORIN displayed “ORIN could not prepare a response”. The explanation request created no child.
5. **Problem walkthrough.** Turn `82b87d27-e105-46e2-80f0-29ed83d9cc76` attached the saved Browser problem “Unknown-email sign-in has generic error” and asked for a customer walkthrough. The evidence card showed one failed Browser assertion, the expected generic sign-in message, and the saved observation that the expected visible text was absent. The planner call was cancelled at approximately 120 seconds. The Check explanation planner call was also cancelled around its two-minute deadline. Both turns kept the saved evidence.
6. **Continuity.** Seed turn `ab330668-1fb1-4534-8d83-56b85f391b39` asked “Run a code review” and ORIN asked which folder or file. After leaving and reopening Sample Shop, “Repeat your previous reply.” produced completed turn `e688c548-fe8b-4c88-aace-a202db89ff74` with the exact earlier reply and a saved citation to the seed turn. “Explain that check.” opened “Which Check do you mean?” with the latest catalog Check marked **Recommended**. Selecting the older **Source Code Review** produced turn `7d56b2ea-37ea-4907-980c-d46bbe6850da`, bound to the older Check ID and its Review ID.

On resumption both Code Reviews had reached durable `blocked` / `provider_paused`. Their model usage recorded `quota_exhausted`. The combined Browser session was complete with seven passed tests, one failed test, one uncertain test, and one unit-test item that did not run. The older Check explanation completed while that Review was still active. ORIN replied that its objective was “Review src” and that the saved focused scope contained `src/orders.js`, `src/products.js`, and `src/users.js`.

After restarting the updated sidecar, “Run a Browser check.” produced `cebda149-76bc-4d2b-8df6-c635e3bbba0b` and asked “Which behavior should I verify in the browser, and what should the page show when it works?” “Explain the attached check.” with @Overall Quality Check produced `ea94c102-06ed-4a64-b736-38eb81c351bd` from saved evidence. Its Code section showed a full requested scope, ten files in the saved manifest, six partial findings, and blocked status. Its Browser section showed one partial failed assertion. Neither turn recorded a model call.

“Explain the attached problem.” with @Invalid Order Lines Accepted completed as `50e2dd04-5844-44d5-9337-459f3afc2ce6` and cited finding `c3cf0159-bef0-4737-8c7a-d25e7b4e2d43`, with no model call. The desktop card showed its saved explanation, affected location `src/orders.js:22`, saved recommendation, and an explicit unavailable-excerpt message. **View original problem** opened the same finding in Review details.

## Automated verification

- 96 sidecar conversation tests passed. These cover retrieval beyond six turns, citation validation on compact excerpts, owner-scoped pagination, separate saved counts, missing Browser criteria, saved evidence when a planner deadline expires, and read-only planner actions.
- 44 frontend tests passed across Check flow, runner, and conversation screens. These cover explicit combined dispatch and selection of a Check other than the recommendation.
- Sidecar TypeScript checking and the production frontend build passed.
- Applied the conversation owner policy to local Supabase. The rollback-only SQL regression verified owner transcript access and updates, and verified that a project viewer could still see a shared audit row while the conversation was private.

## Remaining acceptance

Keep the moderate and large repo runs gated on all six Sample Shop scenarios. The implementation includes paginated history, bounded retrieval and excerpting of relevant older discussion, and UI Check selection. A canonical ID shared across devices for all Checks, transcript removal, and durable compaction remain open. The required responsive viewport matrix and live older semantic recall remain unverified.

## Provider switch retest

ORIN's enabled Code and Browser configurations both used MiMo `mimo-v2.6-flash`. On the Sample Shop Project Page, “Run both” created a single combined Check with Review `39982b30-04e9-4a24-942d-4352e6c1dede` and Browser session `3f3548f2-73b9-4c61-b32a-5535df6a05d3`. “Review src” produced turn `a21f6c5d-d7f9-4dcc-8522-0f4fecc02cf5` and Code Review `099e6b8e-56c8-4e72-8508-a7b45bbe92e5`, with a saved scope of three files and no Browser child.

The read-only Code problem walkthrough `5d1c8de1-9382-4807-b5ce-f4593e559053` reached the planner. Its response failed scope validation and ORIN preserved the cited problem card, recommendation, and unavailable-excerpt disclosure. No child started and no generated walkthrough was accepted.

The combined Browser session completed with ten passed tests, one failed test, one uncertain test, one blocked test, and one unit test that did not run. The standalone Browser negative control completed as session `b64b28c9-993e-47d9-a2ec-c852da4b52eb`, run `c09a16d9-d7d9-4ebc-ac04-017329a38e0d`. Its recorded expected text was “Origami Telescope” and the independent assertion returned failed with “Expected visible text absent.” Together with the earlier positive assertion and missing-criterion clarification, this fulfills the Browser-only acceptance scenario.

The planner schema now limits a read-only question to explanation, suggestion, or clarification. The Code and Browser execution validators remain in force. The regression test and sidecar type check passed. The earlier live walkthrough used the previous schema.

The Code-only Review reached its completed stage with four saved analysis batches and one saved finding. The original conversation turn completed with no Browser child. The persisted Review status is `pending_approval`, which ORIN treats as a completed Code Review.

The combined Code Review reached its completed stage with six saved analysis batches and nine findings, including three deterministic findings and six model findings. Its saved result explicitly retained two unverified parts. The combined Check has independent saved Code and Browser outcomes.

The older-history question `482dba43-b292-4317-80fe-845408da5e71` completed while retaining six turns in its bounded context. After the original turn was outside the latest six completed turns, it cited `ab330668-1fb1-4534-8d83-56b85f391b39` and included the saved reply verbatim within its answer. The question dispatched no child check.

The sidecar was reloaded after the active checks finished. `pnpm dev:check` confirmed the sidecar, demo and frontend were healthy. Windows reported a responding ORIN window. The desktop automation helper returned “foreground window did not report a process id” after reselecting the window, blocking the post-reload generated explanation retests. This session did not reach the moderate or large repo gate.

## Fresh Sample Shop run after the conversation layout change

The user approved clearing this project's chat and run history. The local database transaction removed 13 conversation turns, 5 Browser sessions, 31 Browser runs, 4 Code Reviews, their 22 Review findings and related journals. The device-local list lost 4 cards. ORIN showed an empty Sample Shop timeline before the first new run. The reset verified the same project, 1 source, 10 artifacts and 0 dedicated requirement records. The saved repository includes `docs/requirements.md`. The local fixture had no Git HEAD, so Review manifests and saved run IDs identify the checked content.

| Scenario | Fresh desktop evidence | Remaining acceptance |
| --- | --- | --- |
| 1. Code and Browser | “Run both” created Review `f686e4aa-f397-4196-a7a4-702dd4cb5c67` and Browser session `39c63467-f8c6-4c5e-b34f-b50557bdabbd` in one card. Code saved 18 findings with 2 unverified parts. Browser saved 8 passes, 5 blocked tests and 1 unit-test entry that did not run. The card appeared before the outcome. | The toolbar and controlled startup-failure variants still need fresh live receipts. Scoped startup fallbacks passed the sidecar unit fixtures. |
| 2. Code only | “Review src” created turn `8718fc59-cff8-409e-9981-258c1be8b16f` and focused Review `f5233191-6613-4dd1-8054-b3c715fa3641`. The manifest covers three JavaScript files. The completed turn showed one Code card before “I finished the Code Review and saved 5 findings.” The old scope block was absent and the request had no Browser child. | The fixture had zero saved requirement records, so requirement-linked Code traceability remains unverified. |
| 3. Browser only | The negative `Origami Telescope` assertion failed in run `220117e0-a8d7-4ca9-9599-2a9fb9016de5`. The card preceded the expected-versus-observed message. The fixture displayed Ceramic Mug and $12.50 in run `f7e4c696-5a0b-412c-ae59-d672ab371da5` and “Sign in to place an order.” in run `dec2ab72-6b76-4812-a3a1-b43f3c9e7645`. ORIN asked for expected behavior when given “Run a browser check.” An earlier positive prompt used $12.00 in error, and the saved run correctly failed that price assertion. | The tested Browser-only paths passed acceptance. |
| 4. Explain Check | Partial combined explanation `a705da84-9917-4163-8b0c-247dd5546049` kept the objective, manifest scope, partial Code counts and the Browser table. A generated answer failed exact-quote validation and the turn disclosed it. After the validator change the completed combined explanation `1112b46a-cf61-4c52-a71f-a257c05d95b2` showed evidence first and returned both objectives, 18 Code findings, 2 unverified parts, limited Browser evidence, and examples supporting Security. A separate zero-failure Browser Check displayed its saved objective and count of 0. | The generated reply described other Review domains without explaining each quality impact. |
| 5. Explain Problem | Browser problem turn `c6fe1403-45e7-466c-9674-0e4c1dfc1087` put its saved assertion card before the requested shopper explanation. The saved screenshot loaded in the turn. View original problem opened the exact Browser run. Follow-up `c180267c-5c8b-4a6f-934f-90e30ec99325` distinguished a failed test expectation from an unconfirmed product requirement. Code problem turn `40514440-b125-4db0-90f0-4e839ebe031c` showed the original frozen excerpt and saved recommendation before a shopper walkthrough that disclosed runtime limits. Neither explanation started a run. | The missing-excerpt and frozen-hash paths are covered by live observations and automated tests. A changed working-tree variant was not run. |
| 6. Continuity | After reload, `a4a765b3-1fb9-4d7e-ba83-dd65d3adc391` quoted the prior scope question and cited its original turn. An explicit Reply to selected that same earlier message after several intervening turns. “Explain that check” recommended the latest match and allowed the older Source Code Review to be selected. After seven intervening turns and reload, `3ecc4d85-ace7-4364-bfc3-00287eae14ea` retrieved the earlier priority of checkout totals before catalogue polish. | Persistent compaction, transcript removal and live cross-account isolation remain open. A two-owner SQL fixture passed and rolled back. |

Playwright attached to the Windows development WebView. Screenshots are in `evidence/orin-sample-shop-fresh/`. Status showed three bullet markers without horizontal overflow at 1440×900, 1200×900 and 390×844. The frontend build, 36 targeted frontend tests, 101 conversation sidecar tests and the sidecar TypeScript check passed.

## November 26 follow-up

- **Browser execution.** Four tests stopped on invalid model actions and one stopped at a saved interaction permission boundary. Some of the JSON was syntactically valid and lacked a display label. ORIN now supplies that label for an action that already contains an explicit locator. A missing locator or missing text still prevents execution. The existing target and interaction checks still apply. The targeted authorization test exercises an ordinary fixture input and confirms the parsed proposal cannot pass without a grant.
- **Code coverage.** Two parts lacked adequate semantic support. The journal recorded an invalid authority reference, an incomplete selected path, and a missing reference. The Code result retains its verified findings and the two unverified parts. The repository had no saved requirement records for requirement-linked Review.
- **Check explanation.** A bounded example for each supported quality category now includes a saved impact and its Review-manifest path when available. Informational and closed findings are excluded from that summary. The Browser card explicitly reports 8 passed tests and 5 without a verdict on the historical run. A fresh desktop explanation displayed a concrete checkout rendering impact in `public/app.js` and the Browser count. Prompt tuning alone left a contradictory answer about the unknown failed-assertion count. The direct count question now reads the saved record. Desktop turn `6250f33d-01e8-40ed-b335-45964e1c6fc7` reported the count as unavailable and listed the five blocked Browser tests without starting a run.
- **Verification.** Both combined-entry routes passed the frontend component tests. A fresh signed-out checkout run `90caaecd-1595-482b-a5ab-a6ec339e1c86` completed with two passing independent assertions. That run covers the ordinary signed-out fixture flow. The four earlier signed-in tests still need fresh live receipts. The sidecar TypeScript check, 139 targeted sidecar tests, and 22 targeted frontend tests passed. Durable transcript compaction, transcript removal, and live cross-account continuity are separate acceptance gaps.

## Conversation plan preflight, 26 November 2026

The local n8n project has 2,000 saved artifacts. The shared index and retention policy allow 1,024 sources per snapshot. The initial authenticated runtime probe returned HTTP 422 with `repository_index_scope_too_large` and guidance to select a narrower Review scope. Sample Shop index sync returned `unchanged` in the same desktop session. The background route now treats that scope limit as an incompatible index, verified by the route test. An explicit oversized build retains the scope error. The oversized selection regression also verifies that no embedding configuration or index engine is opened.

The ORIN desktop rendered Add Document and Add Repository with a light full-window backdrop. Document picker captures at 1440×900, 1200×900, and a narrow desktop viewport are in local `evidence/orin-sample-shop-fresh/`. These checks precede the history reset and the six-scenario rerun.

## Fresh Sample Shop run after the UI and saved-evidence changes

The scoped local reset removed 33 conversation turns, six Browser sessions with 25 linked runs, two Reviews, 23 Review findings, and four device-local Check cards. The project, its one saved source, all ten artifacts and versions, and the requirements baseline matched the pre-reset records. The app read back zero conversation requests, Reviews, and Browser sessions before starting new work.

The refreshed n8n index response was `incompatible` with `repository_index_scope_too_large`. The app no longer treated the 2,000-file project as a malformed frozen source identity.

| Scenario | Fresh record | Observation |
| --- | --- | --- |
| Combined Check | Check `42152827-28a8-4ec7-a6c9-c2f07c38cb9a`, Review `db8b662b-c1be-4363-8a16-c5a791ae4f4e`, Browser `b544afc8-b780-4194-9f26-9bf4436f4a75` | The toolbar started both lanes and both saved results. Code completed with gaps and recorded 18 raw findings, of which 14 counted as problems in the Check. Browser saved ten passes, two failures, one blocked item and one untested item. The controlled startup failure is covered by automated tests. A fresh live startup-failure run remains outstanding. |
| Code only | Turn `d0217284-4852-4c2a-9253-cb783281efbd`, Review `b2bf7305-b60c-4394-9a0a-a2efbf24ba04` | `Review src` scoped three saved files, finished with two saved findings, and attached no Browser session. No dedicated requirement records were selected. |
| Browser only | Sessions `5edc4a05-308b-43b3-80d6-e800dd6052d5`, `a5dfbdee-2538-47a1-8115-00ca15752151`, and `4aa7a92e-ec9a-4861-906a-121cb5edeaf3` | The real catalogue expectation passed. The deliberately wrong catalogue expectation failed. Missing criteria opened the fixed questionnaire. Its first custom answer exposed a scope-validation problem. On the corrected runtime, the same turn `3abb3abb-c915-45a6-9f41-04b791b4e4b1` resumed once and saved a passing independent assertion. |
| Check explanation | Turns `94986e0a-d883-4290-ab77-4c7149822eae`, `52137a87-116d-4633-9f4e-ae0bfba856de`, and `df5b9e80-52a2-490a-8e0a-0b554a1cf04e` | The in-progress explanation rendered both metric labels. The first completed-record attempt exposed an oversized evidence payload. After bounding detail rows, the same completed Check reported 14 Code problems, two Browser-proven problems, and two recorded failed Browser assertions with partial coverage. A generated follow-up grounded three quality labels in the saved Check. Neither reply dispatched child work. |
| Problem explanation | Turns `34689105-215c-4f6e-bed0-9c8a181d66bb`, `268a0b44-b06c-4329-83c3-52d0c1092617`, and `791b5090-cbaa-4399-b936-50dc727ced56` | The original issue disclosure displayed saved Browser evidence and a distinct unavailable current status where a current finding could not be established. The generated catalogue walkthrough described the recorded observation and missing support. The Code Problem returned frozen references and current status Open. These explanations started no child runs. |
| Continuity | Turns `4957fa92-f889-4691-8ac0-e58be1f3e9ea`, `480376c0-40fb-4a79-925c-41336bceef09`, `5374925e-5f57-4aa2-9c88-da56fa6399b6` | ORIN cited and recalled the preference after desktop reload. With intervening turns, it recalled the same preference through the earlier cited explanation. |

Captures are stored locally in `evidence/orin-sample-shop-ui-harness-2026-11-26/`. The renderer fit 1440×900, 1200×900, and 390×840 with global navigation collapsed at the narrow width. The project conversation initially showed ten turns and fetched older turns on upward scroll while preserving the reading position. The questionnaire continuation was retested against a temporary local sidecar so the original combined Review could finish independently.

The live gate remains partial. The rerun did not link dedicated requirement records to the Code Review, exercise controlled Browser startup failure in the native app, or repeat continuity with a second signed-in account. The timer, startup fallback, and owner scope have automated coverage. Durable memory compaction and the larger repositories remain outside this acceptance run.

Verification passed for 115 targeted frontend tests, 210 targeted sidecar tests, the frontend production build, sidecar type checking, and the local owner-scope SQL fixture. The normal desktop launcher was restored after the temporary testing listeners closed.

## Conversation userflow follow-up, 26 November 2026

The desktop walkthrough used the existing Sample Shop account, saved conversation, and Checks. Local Supabase authentication recovered after starting the CentinelLocal Docker daemon and selecting Retry in ORIN. The prior history remained available.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Check cards | Saved combined Check starts compact. Show Detail opens saved measurements and problem rows. Worked for sits below details and above the reply. | Verified on a saved combined Check in the desktop. Component tests cover the Code and Browser card paths. | A full sequence of fresh Code, Browser, and combined runs was not repeated in this pass. |
| Evidence tables | Preserve separate Test, Result, and Assertion results columns. Keep the verdict readable and constrain horizontal overflow to the wrapper. | Browser component fixture verified at 1440×900, 1200×900, and 390×840. At 390px the document stayed 390px wide and the 296px table wrapper contained the 714px table. | Responsive captures are component fixtures. They do not establish all three widths for the signed-in desktop shell. |
| Chat and Library | Expose icon-only actions and the timestamp outside replies. Center Jump to latest. Display one repository source and keep file browsing scoped. | Hover and jump behavior and one Sample Shop repository row observed in the desktop. Date and file-selection fixtures passed. | Desktop File Explorer and remote browser destination activation were not exercised. |
| Live work and reply formatting | Show actual running and saved activity. Format short explanations with Markdown. | Activity and Markdown rendering passed frontend checks. The live normal question reached the provider and saved a 7s work disclosure, but the reply was rejected by citation validation (`quote_unmatched`, turn `bbb4a5b3-cb88-435e-ad0c-fef07f2bfb7d`). | Successful fresh generated reply, post-reload named references across reply types, and live run parity need verification. |
| Remaining functional flow | Exercise timed clarification, Browser startup failure, and dedicated requirement traceability. | Open. | Keep the earlier automated coverage and the documented live gaps available for the user's acceptance decision. |

Responsive evidence captures are under `evidence/orin-conversation-followup-2026-11-26/`. The targeted suites passed 57 frontend and 118 sidecar conversation tests. The frontend production build, sidecar TypeScript check, and `git diff --check` passed.

### Conversation layout corrections

The frontend regression uses a saved `report.pdf` under `uploads/report.pdf`. It verifies the filename in Library, selection through `@report.pdf`, the PDF tile, and submission of the saved artifact reference for an explanation in Browser mode. Separate tests confirm activity precedes saved evidence and a response failure stays in its originating turn. All 58 targeted frontend tests passed. The production build passed.

An isolated Playwright fixture using the actual conversation components verified activity, card, and inline response order at 1440×900, 1200×900, and 390×840. It found no document overflow and both timestamps showed `7:18 PM`. The saved document fixture verifies the UI and outgoing request. A live model answer from the user's PDF was outside this verification pass.

### Opening Library sources

The Project conversation regression opens `report.pdf` by clicking its Library row and verifies that the existing version-aware file reader receives the saved artifact. Component tests verify dispatch to the file manager for a local repository and the browser for GitHub and Google Drive. An isolated Playwright fixture verified the icon stays aligned as it appears on hover and keyboard focus, with no horizontal page overflow at 1440×900, 1200×900, and 390×840. All 64 targeted tests and the frontend production build passed. The actual File Explorer and connected provider handoffs were covered by mocked calls.

### Recorded work activity, 27 November 2026

The conversation regression checks named references, the 40-character explicit quote preview, the saved Code scope, and questionnaire continuation. The Code Review fixture renders saved batch and coverage notes separately from action rows. The Browser fixture supplies one saved click and a planned second click and verifies that only the recorded click appears as an action. Playwright verified the conversation action list and long path wrapping at 1440×900, 1200×900, and 390×840. The fixture used the production components with saved-record data. No fresh Sample Shop Check was run in this pass.

Verification passed for 57 frontend tests, 221 sidecar tests, the frontend production build, and sidecar TypeScript checking. Two sidecar tests were skipped by their existing test configuration.

### Clean-history desktop retest, 27 November 2026

Used computer control in the native ORIN window with the existing Sample Shop account. The project-scoped reset removed 25 conversation turns, four Browser sessions and their 20 linked runs, two Code Reviews and their 20 findings, and two device-local Check cards. The transaction verified the project, one source, 11 artifacts and 11 artifact versions against their pre-reset records. ORIN showed an empty history before the retest. The fresh runs and turns remain available for inspection.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Default combined Check | One Check has independent Code and Browser results. A controlled startup failure preserves partial work. | Open | The full automatic run and controlled startup failure were outside this retest. |
| Code Review | Review only `src/products.js`. Show exact scope, indexing and rule actions, and a saved Review with no Browser child. | Passed | The completed Review had zero findings. Failure and cache-reuse activity were outside this case. |
| Browser | Verify a signed-out catalogue assertion, then try a deliberately incorrect product expectation. Show actual steps, a screenshot entry and the saved verdict. | Passed for the direct catalogue checks | The negative case was deliberately false. The saved Problem included an unverified typo theory. |
| Saved Check explanation | Select the exact Check with `@`. Show its named action, card and counts without dispatching work. | Passed for the Browser Check | Combined quality and coverage explanation remains unverified. |
| Saved Problem explanation | Select the Problem with `@`. Show its named action, saved evidence and status, followed by a brief explanation. | Passed for rendering and retrieval | The saved assertion used `Origomi Telescope` while the user requested `Origami Telescope`. Neither name is present in the fixture catalogue. The failed expectation does not establish the model’s claimed typo or root cause. |
| Conversation continuity | Quote an ORIN reply and repeat it. Answer a clarification and resume the original request. | Partial | The quote worked and showed a 40-character preview. The custom answer resumed the original turn and admitted a Browser session, but the plan failed target coverage validation before executing any assertions. Older-history pagination was outside this pass. |
| Normal source explanation | Attach `src/products.js` with `@`, show `Read products.js`, and return a grounded answer. | Failed after the read | The work log named the file. ORIN rejected the generated supporting quote and showed an inline error. |

**Saved receipts**

- Code Review `4df7c8db-dbc8-432c-908e-cd7a66e0fe97` completed with zero findings. The Review row retains its existing `pending_approval` storage status, while the conversation reports completion. The work disclosure showed the exact scope, frozen source versions, repository indexing and rule checking.
- Browser sessions `fa499dbe-6bfc-40c7-9e64-aa814573e774` and `d87a0691-6592-4728-8fab-954d8a7c0fc9` saved a pass for Ceramic Mug and an expected failed catalogue test for the absent product. The passing disclosure showed the live app startup, page inspection, recorded text assertion, final screenshot and verdict.
- Saved Check explanation `82538a84-349b-4bb6-b127-0bcb0e6d403f`, Problem explanation `cd12261c-16ba-4bcf-a125-6bb75f11c1f0` and explicit quote `3ccb56a1-a0b2-48f0-8b89-0369db721d32` completed without child runs.
- Questionnaire turn `7f065b1e-4c7c-407a-8fbb-f7bda97565e6` recorded `question_answered`. Its Browser session `3f9f3e65-f054-45fe-9ad8-5849ace67fc5` failed with “The proposed browser tests do not cover the selected evidence with independent expected behavior.” A separate direct catalogue phrasing was rejected earlier as `question_options` on turn `fa3f4395-ecaf-48fb-9cf9-9aacdee7cddf`.
- File explanation `5b8697e5-ff3c-45f1-861f-79c97500d9c5` reached the model after reading the named file. The source matcher rejected the response as `quote_unmatched`.

After restarting with the normal launcher, opening Sample Shop expanded its latest saved result and exposed the Browser validation error in the result notes. Returning to chat showed the new conversation and the inline citation error. The Library search returned `report.pdf` by its filename. The PDF was neither opened nor submitted for model processing during this retest.

### Nested Check work in conversation, 27 November 2026

The “Started” action now expands into the Check’s plain-language work summary and recorded actions. Browser test traces expand one level deeper. A Browser session that ends before testing can summarize the work it reached and identify where it stopped. Combined Checks expose separate Code and Browser branches. The change uses existing saved activity and does not require a model request.

The 58 targeted frontend tests passed. A Playwright fixture using the production conversation components verified independent keyboard expansion and no page overflow at 1440×900, 1200×900, and 390×840. It used synthetic records, including a Browser Check that stopped before testing.

### Provider routing and file references, 27 November 2026

Free-form project messages go through the provider's action selection in the chosen mode. The action identifies the current request or manually typed clarification as its source of intent. The service still validates project scope and permissions before executing it. An automatically answered question cannot confirm a run. The explicit full Check control and saved test actions use their existing workflows.

An attached Library file can be explained independently of a saved Check or Problem. The service supplies versioned text, including text extracted from PDFs when available, and identifies incomplete excerpts. File-level citations support paraphrases without an exact quote. Saved Check evidence and execution retain exact supporting-evidence validation. Invalid choice lists fall back to an open question.

Regression coverage exercises the original Browser wording, confirmation, the exact homepage text assertion, malformed options, and a paraphrase with a mismatched source excerpt. The frontend build, 57 frontend tests, 155 sidecar tests, sidecar type check and `git diff --check` passed. The tests use controlled provider responses. A fresh desktop run with the configured provider remains unverified.

### Scope coverage and evidence cards, 27 November 2026

The Sample Shop reset removed eight conversation turns, three Browser sessions and their linked runs, one Code Review, and four device-local Check cards. The reset verification matched the project, one repository source, 11 artifacts and 11 versions before and after. The native app displayed “No checks yet” before the fresh runs. Sample Shop history created during the retest was kept.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Default full Check | One Check launches both modes and preserves each lane’s results. | Both lanes saved results. | Code saved 19 findings with partial coverage. Browser saved eight passes, three failures, two blocked tests, and one test that did not run. |
| Code Review | `Review src/products.js` runs a focused Review with no Browser child. | Passed on desktop. | One saved file and zero findings. |
| Browser | The original signed-out Ceramic Mug request runs and records the actual assertion. | Passed on desktop after the scope fix. | Browser execution independently validates its page and required assertion. |
| Saved Check explanation | An explicit `@` reference opens a named card with mode, objective, evidence, and the original Check action. | Passed on desktop. | Responsive fixture also verified the revised heading and table layout. |
| Saved Problem explanation | Show recorded observations and keep any possible cause qualified when coverage is incomplete. | Passed on desktop. | The saved checkout explanation identifies incomplete Browser verification. Its possible cause remains a hypothesis. |
| Continuity | A typed clarification resumes the original request. Repeating a completed execution reply uses the outcome the user saw. | Clarification resumed and the outcome was recalled on desktop. | The provider reported a spending or payment limit before the resumed Browser run produced an assertion verdict. |
| Coverage question | Compare documented project scope with saved Browser results and version-matched Code Review manifests. | Passed on desktop for the original question. | The first reply found four requirement areas. The saved standalone catalogue assertion had no explicit requirement reference. |
| Attached file explanation | Explain the attached `src/products.js` and format its source symbols. | Passed on desktop. | The reply listed the four products and two exported functions. |
| Working indicator and Stop | Animate the ring while working. Stop the current turn from the composer. | Passed in the responsive fixture and native retest. | The indicator respects reduced motion. Cancelling kept the other in-progress Check running. |

The evidence-card fixture exercised the production components at 1440×900, 1200×900, and 390×840. It verified the top-right navigation action, single-line Objective label, horizontal containment, and spinner animation. Screenshots are under `evidence/orin-sample-shop-2026-11-27/`.

- Standalone Browser session `0b90a245-72d8-410b-b35d-47234b31e945` saved the original Ceramic Mug pass.
- Default full Check used Browser session `344e3c05-75aa-460e-b3e8-0842f335593d` and Code Review `57ad3ba8-79d4-4f5f-85fb-5c154e712c8e`.
- Scoped Code Review `5a72da29-db48-481e-8908-9b33f57c84d4` reached its completed `pending_approval` storage state.
- Saved Check explanation `7f1aadf3-3726-445b-95d1-b678a760dae7` and Problem explanation `5b6b61ab-a8e1-43cf-8a03-fbf01b5cd9dd` completed without dispatching a check.
- Composer cancellation ended turn `58313118-6a5e-4c6c-bf37-d2c508d71cb5`. The separate full Check remained active.
- After the full Check, coverage turn `68b4f442-6ebe-482c-875d-5b2463886758` named `docs/requirements.md`, showed the saved Browser outcomes and blocked paths, and distinguished one file in a complete Review manifest from ten appearing only in the partial manifest.
- Clarification turn `923d97a5-8b9b-4d78-bd6d-a8f91af21b09` resumed as Browser session `a13235ec-40af-433e-8a32-e5a33e8a590c` with the exact expected text `Origami Telescope`. The provider payment-limit stop is preserved in the saved run. A controlled regression verified the fix that surfaces this stop and prevents automatic retry or dispatch of queued tests.
- After restarting the desktop, the exact scope question also listed the current-version files named by partial Review evidence. Repeating the previous Browser reply matched the saved text shown under its card.

Verification passed for 75 targeted frontend tests, 120 targeted sidecar tests, the frontend production build, sidecar type checking, and `git diff --check`.
