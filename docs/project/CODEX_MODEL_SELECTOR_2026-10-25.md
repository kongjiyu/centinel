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
