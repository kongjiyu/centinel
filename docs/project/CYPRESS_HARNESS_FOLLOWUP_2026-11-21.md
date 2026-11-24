# Cypress harness follow-up

21 November 2026 · Centinel development build on Windows · [Cypress Real World App at `9dfcb986`](https://github.com/cypress-io/cypress-realworld-app/tree/9dfcb9869533ce8a8963c556facc0d80457f9d39)

This follow-up builds on the [initial assessment](CYPRESS_HARNESS_ASSESSMENT_2026-11-21.md). Scenario receipts are local under `evidence/harness-assessment/` and contain the recorded observations, provenance, and evidence references. The Windows Browser run used a disposable Cypress checkout on two explicitly scoped loopback origins. Its application and API processes were stopped after the run.

| Feature | Acceptance criteria | Status | Evidence and limits |
| --- | --- | --- | --- |
| Context | Source-grounded answer with exact evidence and a bounded payload | Live answer passed and an oversized packet failed before model work in the regression | `rwa-live-codex.jsonl`, `explain-source`. Exact quote, pinned sign-in source hash, one validated citation. Context-limit regression resides in `conversationHarness.test.ts`. |
| Conversation | Save a native request and read it back after reload | Passed for both approved hosted requests | `rwa-native-hosted-receipt.json`. The first request saved a correct cited inventory answer. The second request saved its failure state. Cross-account hosted RLS and duplicate-write concurrency were outside these two requests. |
| Memory | Use only earlier completed turns from the same person and project. Cite the quoted prior turn | Live Codex fixture passed after the prompt correction. Hosted delivery worked and the answer failed | `rwa-live-codex-recall.jsonl` proves exact wording and a valid earlier-turn citation. The native trace recorded one earlier turn, then stopped before a validated response. A subsequent verbatim-only citation repair is regression-tested. Hosted recall after the repair remains open. |
| Code | Obtain approval, freeze the selected file, run the real Review orchestrator, and persist its terminal analysis state | Passed with in-process storage and live generation | `rwa-live-codex-code.jsonl`. Scoped async utility hash, exact quote, approval checkpoint, Review `pending_approval` with stage `complete`, and completed parent request. The repeat used the signed-in CLI after the app-server credential-directory check failed. The earlier app-server run also reached `pending_approval`. |
| Browser plan | Bound verification to an explicit required expectation and wait for approval | Live planning passed. Negated criterion clarified. Invented source instruction did not displace the user request | `rwa-live-codex.jsonl` records `browser-plan`, `clarify-negated`, and `ignore-source-instruction`. Local regression rejects unrelated, optional, or unbound assertions. |
| Browser execution | Start the actual full-stack app and produce evidence-backed verdicts | Passed through Chromium, the normal checker, and a test `DynamicService` repository | `rwa-browser-evidence-retest.jsonl` holds four scenario receipts. Checker actions were scripted and the profile listed both local origins explicitly. The separate production conversation-to-Dynamic worker path did not run in this evaluation. One earlier API start timed out, so repeated Windows startup reliability remains unverified. |

## Browser scenario evidence

| Scenario | Saved result | Evidence |
| --- | --- | --- |
| Signed-out form | Passed | Both named controls were visible. Shared screenshot proof in `browser-evidence/signed-out-form.png`. |
| Invented login rejected | Passed | Local API HTTP 401 and expected text found. Masked screenshot proof in `browser-evidence/invalid-login.png`. |
| Deliberately wrong expectation | Failed as expected | Local API HTTP 401 and wrong expected text absent. Masked screenshot proof in `browser-evidence/wrong-expectation.png`. |
| Missing evidence | Uncertain as expected | Receipt records the observation, empty evidence IDs, and final uncertainty. |

## Implementation and display

- Recall supplies at most six completed turns from the same owner and project. The combined planner packet is bounded at 64,000 characters, with up to 8,000 for recall. Recall text serves as conversation evidence and has no executable source identity. A requested exact repeat can receive a reconstructed citation only if the returned words are literally present in the previous reply. Other invalid responses fail validation. The development trace shows recall count, truncation or unavailability, and the stage where a failure occurred.
- Windows startup runs the exact cached Yarn Classic version when the repository pins it and its Corepack metadata matches. It invokes the cached CLI directly. Parallel Vite recipes preserve repository ports, wait for a successful HTML response, and prefer an otherwise identical startup recipe that omits the watcher. The successful Cypress retest used `node-script:start` and verified both listeners before testing.
- Check cards remain visible in all modes and show only applicable mode counts in the card and expanded result. Standalone Browser runs with saved tests also show the card and retain their replay actions. A Check entry for a standalone run is added to the device-local list when the user opens it.

Two independent read-only reviews examined the initial recall, criterion binding, and Windows launch changes. Both reported no blocking findings in that scope. The later verbatim recall recovery and Check card changes were exercised by the targeted regressions.

## Verification

- Seven focused sidecar suites passed 85 tests with one skipped. After the final escaped-quotation case was added, the conversation and HTTP suites passed 26 tests, including that case.
- Five frontend suites passed 42 tests. The frontend production build and sidecar TypeScript check passed.
- Chromium verified keyboard trace disclosure, owner-only visibility, and all three Check card layouts at 1440 × 900, 1200 × 900, and 390 × 844. Test fixture captures are `check-modes-1440.png`, `check-modes-1200.png`, and `check-modes-390.png` under the local evidence directory. Native Centinel also displayed the Browser-only card for the previously saved Cypress smoke run alongside its replay action.
