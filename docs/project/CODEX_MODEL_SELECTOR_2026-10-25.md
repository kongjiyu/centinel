# Codex model selection and Review usage — 25 October 2026

Codex settings prefer the connected account’s live model catalog. If it is unavailable, the installed CLI's actual model choices remain usable with an explicit freshness warning. Review and Dynamic testing retain separate saved assignments. A saved model missing from the catalog remains visible; the UI does not substitute a default or first result. Loading, empty, failure and refresh states are explicit. Dynamic testing remains disabled until screenshot support is confirmed.

When Review uses Codex, the API provider editor stays collapsed so its API key, endpoint, and free-text model fields cannot imply that Codex is an API endpoint. **Configure API provider** reopens the existing API setup flow without changing API configuration until it is saved.

Settings token totals use provider-aware `totals.totalTokens` and `byGroup[].totalTokens`. Cache read and creation counts stay in the breakdown and are not added to the total. Older services that omit canonical totals display `—`.

Review Activity has a collapsed **Model usage** disclosure. It requests owner/project/session-scoped usage only when opened and supports manual refresh. The report distinguishes input, output, cache, known totals, and unknown totals; shows the five pipeline stages rather than batch operation rows; and deduplicates file identities for the review-wide AI source total. Exact frozen-source paths, version IDs, phases, and ranges are expandable. Physical source reads remain separate from AI context. Legacy missing values remain unavailable rather than becoming zero; request-context token estimates are labelled separately from provider usage.

The review usage request includes all Review scopes, including embeddings, while retaining project/session filters and `callKind=review`.

## Verification

- `pnpm --filter centinel exec vitest run src/components/CodexProviderPanel.test.tsx src/screens/SettingsScreen.test.tsx src/components/ReviewUsageDetails.test.tsx src/screens/ReviewActivityScreen.test.tsx src/api/client.test.ts` — passed, 83 tests after the final cache-unknown display regression.
- `pnpm --filter centinel build` — passed; Vite reported the existing large-chunk advisory.
- Root verified the updated official CLI's seven-model catalog, saved `gpt-6.1-sol` for Review, and completed a two-call live Review with that exact model. The public catalog's rejection is disclosed through native catalog fallback.
- Root inspected Settings at 1440×900, 1200×900 and 390×844 with no page-width overflow; screenshot and live accounting evidence are linked in [LIVE_VERIFICATION.md](../acceptance/TOKEN_OPTIMIZATION_2026-10-25/LIVE_VERIFICATION.md).
# Windows startup follow-up (10 November 2026)

Centinel could not launch Codex because its local executable override pointed to a removed installation. The resolver now skips missing paths and falls back to the native CLI on PATH. The local override was updated to the installed executable. Restart the development launcher to load both changes.

The installed Windows CLI answered the app-server account-status request and returned an OpenAI browser sign-in link in an isolated credential home. The test sign-in was cancelled before account authorization. The Model Provider layout passed Chromium checks at 1440×900, 1200×900 and 390×844. Live account sign-in and model inference are still unverified.

After restarting the development sidecar, Settings showed the existing Codex account as Connected. The installed catalog did not offer the saved GPT-6.1-Sol model, so GPT-5.6-Sol was saved for the authorized S2 Sample Shop runs. Readiness completed with a current snapshot. Review `f3a65fb8` was in its behaviour assessment when handed back. The development process was scoped to the sample project through environment overrides. Persistent pause configuration remained in place.

Settings now shows every model returned by the Codex catalog, with text-only and unverified screenshot choices labelled. Those choices can run Static Review. The saved screenshot capability blocks Dynamic Testing when screenshots are unsupported or unverified. Gemini OAuth reads every page of the connected Google Cloud project's generation catalog. Local Gemini OAuth setup is still required to verify the live catalog.

## GPT-6.1 Sample Shop follow-up (11 November 2026)

The old standalone Codex CLI (0.144.1) listed only GPT-5 models. The ignored local executable override now points to the installed Codex desktop app's bundled CLI (0.167.0-alpha.3.2). Centinel displayed GPT-6 and GPT-6.1 choices from the installed CLI catalog. GPT-6.1 Sol was still selected after reopening the desktop app.

The fresh Sample Shop Readiness run reached a current snapshot. Repository was Completed, requirements and design were Incomplete, and coding standards were Missing. Requirements identified the cart behavior gap. All six design criteria were unverified because the cited material was not corroborated as design content. The earlier run labeled design Missing.

Review `c4eeeb3f` read 10 files and paused after 3m 36s when the provider reported a quota limit during behavior analysis. Its saved detail and the Review list showed Paused. Home showed Need Approval for the same ID. The three retained findings were Hard-coded Secret, Console Logging Issue and Unsafe HTML Assignment. Traceability listed six items and displayed Requirements not identified, even though the selected repository included a requirements file. The run used the repository import without a separately confirmed requirements attachment or mapping.

An independent local check confirmed acceptance of seven invalid quantities under REQ-3. It also found that REQ-1's login error responses differ and REQ-4's ownership check fails. These observations describe the Sample Shop fixture. The provider pause prevented measuring completed GPT-6.1 Review coverage. The temporary evaluation route was removed before reopening the saved result.

### Follow-up status correction

Home selected an older approval action ahead of the latest provider pause because the pause had lower action priority. Provider-paused Reviews now receive the same intervention priority as blocked work. A regression test loads both Reviews and verifies that the paused Review supplies the project state and required action. The focused project-summary, Dashboard and Review view-model suites passed all 27 tests. The frontend TypeScript and Vite build passed.

Traceability capture reads confirmed requirement records and confirmed, version-bound mappings. A repository requirements document alone does not create those records. The saved Sample Shop run therefore cannot establish formal requirement coverage. The provider quota pause remains the blocker to a completed GPT-6.1 assessment.

Live desktop verification after restarting Centinel showed Paused for Review c4eeeb3f in Home's Recent projects and a provider-quota Paused action for Sample Shop.
