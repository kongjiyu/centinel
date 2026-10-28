# Independent acceptance review — token optimization, 25 October 2026

**Verdict:** No open actionable source defect remains in the reviewed scope after remediation. Local accounting, context preservation and catalog behavior pass the checks below. Full UI acceptance still requires the root agent's build/viewport evidence. Live semantic quality is not accepted by this review.

## Scope and intent

Independent read-only subagent review of the current working tree, based on HEAD `476a506054c4987fce3fb89f450d7e10955df175`, limited to the usage ledger/projection, prompt deduplication, embedding reuse, Codex account catalog, Settings picker and Review usage UI. Existing unrelated changes were excluded. Applied repository AGENTS.md/DESIGN.md and review/test/UI-UX/ADHD skills. Coordinator-verified reviewer dispatch: GPT-6.1 Sol, high reasoning. This is one independent reviewer, not a model-diverse panel. The reviewer authored this report; the coordinator corrected this dispatch attribution and separately recorded live/visual evidence.

Intent: report available actual tokens per Review/stage/phase and version-aware unique files, reduce repeated context while preserving source/evidence gates, and choose an actually available account model without substituting a fabricated choice. Current policy identifies these changes as `review-2026-10-25-semantic-support-token-context-v11`.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Usage accounting | Preserve reported/derived/unknown totals, cache semantics, phases, frozen identities and owner/project/session filters | Passed locally | Historical missing usage remains unavailable; concurrent pagination is not a transactional snapshot |
| Context optimization | Exact frozen-version deduplication; complete source packets and canonical validation map retained | Passed locally | Saved five-repository character benchmark is not measured provider savings or semantic-quality proof |
| Embedding reuse | Exact member/project/version/owner/config/source/chunk identity; no synthetic usage on a hit | Passed locally | Retrieval and live savings were not measured by this reviewer |
| Model selection and usage interface | Account/native choices, explicit catalog warning, separate workflow settings, known image capability and phase detail | Functional checks passed; final layout acceptance belongs to root | No independent desktop visual QA/build in this review |
| Live model quality | Complete live evaluations with reproducible outcomes and actual usage | Not accepted | Existing structural v10 acceptance is preserved; v11 semantic efficacy remains unmeasured here |

## Findings and dispositions

All initially substantiated P2 accounting findings were remediated and rechecked:

1. **Resolved:** Re-sanitizing a previously truncated/invalid source list upgraded `sourcesComplete` to true, producing a false exact file count. `usageContext.ts:90` now preserves false monotonically. Direct double-sanitization reproduction now retains false and one known reference.
2. **Resolved:** Logical phases contained call counts without token subtotals. Projection and `ReviewUsageDetails.tsx:191` now retain/display provider, canonical, raw/cache and unknown token counts per phase.
3. **Resolved:** Provider-reported totals were conflated with adapter arithmetic, including Anthropic/cache and embedding input counts. Raw totals and provenance-tagged normalized totals are now distinct; historical Anthropic unknowns stay unavailable.
4. **Resolved:** Known usage disappeared on late cancellation and on invalid structured JSON. `retry.ts:530` retains observed usage while keeping the cancelled outcome; `modelProvider.ts:90` carries extracted usage into parse errors. Mock reproductions changed from unknown to the original 100 input/10 output/110 total values.
5. **Resolved:** Failed/cancelled stages with recorded calls displayed Not reached; embedding capacity pauses incorrectly marked model analysis stopped. `modelUsageSummary.ts:141` now infers the observed uncompleted paused stage, with regressions for both terminal and indexing-pause cases.

Additional concerns were resolved or dismissed:

- **Resolved:** A mandatory public account-catalog lookup could block previously working native models after HTTP 403. The adapter now retains actual native choices with an explicit catalog warning; no requested model is invented. Native missing image modalities remain unknown, disabling screenshot selection.
- **Resolved consideration:** Usage pagination now has a stable ID tie-break and row-ID deduplication. Read-side totals can still change while a Review is running; Refresh obtains current records.
- **Dismissed:** Cache reuse does not create a demonstrated cross-owner/project access path. Membership, exact frozen-version query, owner/config metadata, source hash and chunk-policy matching gate reuse. Public catalog credentials go only to a fixed vendor endpoint with redirects disabled and bounded response processing. No prompt/source body/new secret exposure was found in allowlisted output.
- **Dismissed:** Removing ranked excerpt bodies does not remove the original frozen source. Deduplication requires the same path/version and exact substring; source packets and source-validation gates remain intact. Prompt map projection preserves global counts/limitations and leaves the complete validation/audit map unchanged.

## Checks actually executed

- Sidecar targeted suite: **129 tests / 11 files passed**: usageContext, stageUsageProjection, modelUsageSummary, reviewRetry, modelProvider, knowledgeIndex, assessmentBatches, sourcePrompt, accountModelCatalog, codex and supabaseReviewRepository.
- Sidecar safety/auth suite: **133 tests / 4 files passed**: providerPause, staticReviewOrchestrator, assessmentValidation and integration/activeHttpAuth.
- After the final indexing-pause fix: **modelUsageSummary 8 tests passed**, and **sidecar `tsc --noEmit` passed** again.
- Frontend targeted suite: **82 tests / 5 files passed**: ReviewUsageDetails, CodexProviderPanel, SettingsScreen, ReviewActivityScreen and api/client.
- Read-only tsx mock reproductions checked sanitizer idempotence, cancelled-result usage and invalid-JSON usage. No provider/network calls were made by these reproductions. An interim sidecar run failed three stale/new fixture assertions; the test owner corrected the fixture API-format override and raw-total expectations, and the later 129-test rerun passed.

The root agent separately reported an actual updated CLI catalog with seven choices including `gpt-6.1-sol`, and verified saving that Review model in the UI. Those are attributed observations, not checks independently run here. Tiny live generation and final viewport/build evidence should be recorded by root before claiming those criteria complete. This review made no provider calls, commits, service restarts, source changes or runtime configuration changes.

## Reviewed source identity

SHA-256 values below bind this report to the source read after remediation. Later source changes require relevant rechecks.

| File | SHA-256 |
| --- | --- |
| sidecar/src/aiClient.ts | 6caaaf75051c79fa43c5cce942f1ca203205cf703f9d10785461d97006cacbb0 |
| sidecar/src/tokenUsage.ts | 11ab05e8badf75cd316be1e2c37cc1d085547cad33f792d185a2e5939d3f4a25 |
| sidecar/src/modelUsageSummary.ts | 623ccbb216af461217c8c4e02e53de4cf40aa9584e82189d97695dc101295d7d |
| sidecar/src/index.ts | e36a5be169b40f9eb1f211e073e28c97656205a06a06c81172eeea300725ebc3 |
| sidecar/src/model/accountModelCatalog.ts | 94866bb80b73bb91a70a9921b47115afb7492714fbdcb3aa69940aa220dc8302 |
| sidecar/src/model/codex.ts | 3ea19b2d1cb3859e34b747bd0868286f70ddbeee9b5e18766c0d26408563b7d5 |
| sidecar/src/review/usageContext.ts | 151a1ed83acb32c5c8f18c12fbf417ba7b9cc7a6892ddde6d1782f65a603f76d |
| sidecar/src/review/stageUsageProjection.ts | 7d0692b319603250ed318e2b97f152ab064c116da1cc622086c4d730cecbed4f |
| sidecar/src/review/usageAudit.ts | 17111b4c1138b7fb430abe40b9f21ccd85c0d04fa57cab9cdfdb75a763d35c15 |
| sidecar/src/review/retry.ts | a8f4956bc7ade89964f182a6167f54b6d3dba743b4022f29c732234e15fe6876 |
| sidecar/src/review/modelProvider.ts | bb3050a0efbf00dfcb8362f1aebcff6e48a2a74682a36f421f93d5ede20992b1 |
| sidecar/src/review/orchestrator.ts | 47e69860e64ed70f4efafa260e047995cd67a93eb422c986d11e2bb42bddb43a |
| sidecar/src/review/supabaseRepository.ts | a55baec9bd7907f7f4c558feb00d44106e209d56f46ad4ea6d302f77f94f7a69 |
| sidecar/src/review/knowledgeIndex.ts | 8d4dc19aead96e347bd91532c6621110cbc62e7d0c4a2b880f9d7d3120447ebd |
| sidecar/src/review/embeddingProvider.ts | 3c4e6a7b510e1e304b02e66723a36c8c1f17a6d64f4bc53576c38bc6962a0bce |
| sidecar/src/review/assessmentBatches.ts | d8c03de5e896eb27a88db81d32cb3a58544e4d36e218b1dd18a97f4260d01bbf |
| sidecar/src/review/sourcePrompt.ts | ac0b19427bea4632c15bc167479daa7b942b64637bef8a505c57139f2d3d71a8 |
| centinel/src/components/CodexProviderPanel.tsx | 3a6ec0d9c6834697be297c9f080dc6e70eb14724f6ab1549f24ab18ff94cfaee |
| centinel/src/components/CodexProviderPanel.css | 4d79aec56588f65eecbce892ffc26eb5c9e3239837bb5aeba832ed437ad3bb77 |
| centinel/src/components/ReviewUsageDetails.tsx | b310110970b04456401733ed1ad53eb653d7358a1dbfefd9624f27f7cb1c0fad |
| centinel/src/components/ReviewUsageDetails.css | fef716597b1d6b273481f8e1f2c91ec863ad0c0996fbb2b74baaac3f957362af |
| centinel/src/screens/SettingsScreen.tsx | 39bd35c808f78977bacbc58c353945576835bdfc319e2e5b0cb88652543f9a5c |
| centinel/src/screens/ReviewActivityScreen.tsx | f2803c10f683711fa79a567f701206a1d4b625bacb90b7b91b0add50504fdbc8 |
| centinel/src/types.ts | af78e162f0f27dec92ffe5dc72bf6d2dcd2bc7e617f735cb8039e70afa641d8c |
| centinel/src/api/client.ts | c836950743702df36f71884cf8fe8af656b2f016437ef0eb66184c98ea3ff0ba |


## Final UI unknown-value follow-up

Independently reviewed the subsequent scoped `ReviewUsageDetails.tsx` correction. The four Review-wide raw token metrics now aggregate unknown-call counts from every stage; an entirely unreported metric displays a dash plus its unknown-call count, while partial known usage retains its known subtotal and explicit unknown count. No actionable finding remains in this correction. The source hash above was updated.

Re-ran the five frontend suites listed above: **83 tests / 5 files passed**, including the regression for wholly unreported cache creation. No other production changes were made or accepted by this follow-up.

The root agent now reports a real `gpt-6.1-sol` one-file smoke execution: **30,745 tokens, two calls, one unique AI source and one physical source, all five stages complete**. This is attributed live-smoke evidence and supersedes the earlier pending tiny-generation note; it does not establish full gold-corpus semantic quality. Final build and three-viewport visual acceptance remain owned by root.

