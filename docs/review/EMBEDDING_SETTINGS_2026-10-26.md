# Embedding model settings — first phase

The user authorized embedding-model selection and usage presentation first. Shared Supabase index snapshots downloaded for local `open-codebase-index` searches are a separate next phase. Context compaction and index replacement remain deferred. Existing sources, vectors, findings and evidence must not be deleted or rewritten.

## Settings contract

1. Add a Voyage AI provider choice with a published model selector for `voyage-4-lite`, `voyage-4`, and `voyage-4-large`. Preserve the existing custom OpenAI-compatible provider and its saved settings. A new unconfigured form may suggest Voyage and `voyage-4-lite`, but nothing is saved or called until the user acts.
2. Save the selected model and embedding protocol/dimensions in the existing owner-scoped, encrypted model configuration. Keep text/vision providers unchanged. Require a fresh key when switching credential destination/provider; never forward an old saved key to a newly selected endpoint.
3. A deliberate connection test uses saved settings and one small input. Voyage uses its native request contract with `output_dimension:1024`, `output_dtype:'float'`, `truncation:false`, and `input_type:'document'`. Validate finite, nonzero, correctly sized vectors and safe usage values. Saving settings, selecting models and refreshing usage do not request embeddings.
4. Show the selected model's recorded Centinel token usage with incomplete/unknown counts preserved. Show **Remaining usage: Not reported** when the provider has no documented balance endpoint. Link to the provider dashboard; a published free allowance is not an account balance and must never be reduced by local-only usage to fabricate remaining credits. Model choices come from published documentation, not verified account entitlement or a live quota probe.
5. This phase prepares credentials and connection tests for the local-index integration. The existing 1536-dimensional Review index must not receive 1024-dimensional Voyage vectors or make incompatible paid calls. It must report the integration limitation explicitly rather than mixing vector spaces.

## Sources verified on 26 October 2026

- [Voyage embeddings API](https://docs.voyageai.com/reference/embeddings-api): separate query/document input types; Voyage 4 supports 1024 by default, with 256/512/2048 alternatives. It does not support the existing 1536-dimensional index.
- [Voyage pricing](https://docs.voyageai.com/docs/pricing): published free allocations are finite; usage beyond them is billed. No automatic model fallback, account entitlement, free-only guarantee, or reset date is inferred.
- [Voyage API reference index](https://docs.voyageai.com/llms.txt): no public account-remaining-balance endpoint was identified. This is an API capability limitation, not evidence that an account has zero or full allowance.
- [Upstream index architecture](https://github.com/Helweg/open-codebase-index/blob/be56035e960764163338ae03acc9960252c21c9a/ARCHITECTURE.md): the proposed next phase must distinguish local SQLite/usearch search artifacts from the authenticated server backup and prove snapshot compatibility before sharing them.

## Acceptance

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Model selection | Voyage model dropdown, preserved custom configuration, explicit save; no automatic inference/fallback | Passed automated and browser fixture checks | Published catalog is not account entitlement |
| Secure settings | Owner scoped, encrypted keys, no cross-destination credential reuse | Passed unit and authenticated HTTP integration checks | Real credential save remains user entered |
| Connection test | Correct protocol/dimensions; safe success/failure usage; no vector persistence | Passed mocked provider, HTTP contract and browser fixture checks | Live credentialed Voyage test unverified |
| Usage | Per-model recorded Centinel usage; unknown remaining balance and partial usage labelled honestly | Passed aggregation, transport, component and browser fixture checks | Other applications/account activity are not visible; real remaining balance unavailable |
| UI and integration | Relevant tests/build plus 1440×900, 1200×900 and narrow inspection | Passed; independent review has no remaining actionable findings | Shared index/local search integration remains separate |

## Verification completed

1. Backend: **109 tests passed** across `embeddingSettings`, `modelSettings`, `embeddingProvider`, `embeddingConnectionTest`, `knowledgeIndex`, and `activeHttpAuth`. These cover owner isolation, encrypted public views, cross-destination key requirements, native Voyage requests, safe failure accounting, and rejection of incompatible vectors before legacy indexing can call the provider. Sidecar TypeScript checking passed.
2. Frontend: **42 tests passed** across `EmbeddingProviderForm`, `SettingsScreen`, and API client transport. Frontend production build passed; Vite retains the existing large-main-chunk warning. Regression coverage includes catalog reload after a saved-settings change, overlapping manual/test-triggered refreshes, stale diagnostics, and preserving safe failure messages.
3. Browser: rendered the actual `SettingsScreen`, `AppShell`, and embedding component in a separate Playwright context with isolated API fixtures, at **1440×900, 1200×900, and 390×844**. Exercised model selection, keyboard menu use, reveal/hide key, save confirmation and key clearing, saved connection pass/fail messages, provider-change credential guard, readonly Voyage endpoint, and partial/empty/unavailable usage. No horizontal overflow or clipped controls were found; the narrow screen scrolls vertically. The model menu stayed within the viewport. No new browser errors were observed.
4. Independent read-only GPT-6.1 Sol review identified and rechecked the diagnostic-contract bug and two catalog-loading races; all were fixed with regression coverage. Final verdict: no remaining actionable findings in this scoped change. Local browser evidence is retained under ignored `evidence/embedding-settings-2026-10-26/` (`final-1440.png`, `final-1200.png`, `final-390-top.png`, `final-390-actions.png`).

No live Voyage API request, real credential save, model quota probe, schema migration, index replacement, shared-index download, or compaction was performed for this verification. Numeric values shown in the browser evidence are labelled test-fixture context in the browser title/account, not measured production usage. Published free tokens must never be interpreted as a verified balance. Embedding usage is grouped by the owner's model name across recorded calls; it is not a credential-level billing statement.

## User setup

Open **Settings → Model Provider → Embedding model provider**, select **Voyage AI** and a model, enter the key in the application, and choose **Save**. **Test saved connection** is a deliberate provider request and can consume tokens; changing the dropdown or refreshing usage does not. The live provider connection remains unverified until this user action succeeds. The Supabase backup/local-search integration is the following phase and is not enabled by saving these settings.

## Subsequent index integration

The production local-index and compaction phase now uses the separate 1024-dimensional Voyage-compatible MCP index and private Supabase archive. The earlier settings-only phase and its verification above remain historical; see `LOCAL_REPOSITORY_INDEX_2026-10-26/SPEC.md` for the current architecture, verification and live comparison status. The user saved and tested Voyage 4 Lite successfully (5 reported tokens); this does not establish the remaining account allowance.
