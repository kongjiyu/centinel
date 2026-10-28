# Review Usage Accounting

## Purpose

Static Review usage is summarized from the authenticated `model_usage_records` ledger and the existing `audit_events` journal. The response is additive on the existing `/settings/ai/usage?callKind=review&projectId=…&sessionId=…` contract through the optional `reviewUsage` property. No endpoint, table, migration, service-role credential, or local database fallback is added.

The route requires project membership, verifies that the Review belongs to the requested project, and filters usage rows by the authenticated `owner_id`, project, and Review session. The source-manifest and audit reads use the same bearer-scoped Supabase client and exact project/session predicates.

## Provider attempts

Every primary, fallback, validation repair, semantic-support, and support-repair request retains its existing durable operation key (`stage`) and five-total-attempt budget. Each reservation and final usage row upserts under the existing stable Review + operation stage + attempt ID. `logicalPhase` is stored alongside that key in `metadata.usageContext.phase`; it does not change the stage key or reset the attempt count. A reservation with no final usage remains an in-progress call with unknown token counts.

The phase values are `initial_analysis`, `domain_repair`, `citation_repair`, `semantic_support`, `support_repair`, `response_repair`, `source_indexing`, and `context_retrieval`. Request wrappers select the phase before each provider call, so a citation/domain repair remains attributed correctly if a later transient network retry occurs.

Request metadata may include bounded source packet references (`artifactId`, `artifactVersionId`, `contentHash`, `filePath`, and original `lineStart`/`lineEnd`), component character counts, and a character-based input estimate. These counts and estimates are diagnostics only. Actual input, output, cache, and provider total values come from provider usage. The ledger stores the exact raw total in `metadata.providerReportedTotalTokens` only when the provider response contains one. A separate `normalizedTotalTokens` plus `normalizedTotalTokensSource` marker keeps adapter-derived totals usable without presenting them as raw provider totals. If cancellation arrives after a provider returned, the attempt is recorded as cancelled with its observed usage.

Only allowlisted, bounded metadata is persisted. Prompts, source bodies, provider responses, credentials, error messages, and private model reasoning are excluded. References are joined against the Review's frozen source manifest; an off-manifest, malformed, overlong, or truncated reference list marks that attempt's file inventory incomplete and is not exposed as a trusted file.

## Stage and file projection

`reviewUsage.byStage` presents the five pipeline stages: `freezing_sources`, `indexing_context`, `deterministic_analysis`, `model_analysis`, and `persisting_evidence`. Model analysis operation keys (including batch IDs) are listed in `operations`; indexing/context embedding rows are grouped under `indexing_context`. Logical phase subtotals remain available inside the stage.

Each stage includes call outcomes, repairs, raw input/output/cache totals, provider-reported totals, derived totals, and counts for unknown values. Each logical phase contains the same per-token subtotals and unknown counts. A stage with no provider attempts reports zero token use and retains its `not_reached`, `running`, `completed`, or `stopped` state. Failed/cancelled Reviews mark observed, unfinished stages as stopped; provider pauses mark the first observed, unfinished stage as stopped. Missing usage is counted as unknown rather than converted into a successful zero-token measurement.

AI-supplied file references are distinct from physical source reads. `sourceInventory.files` counts unique file identities across all AI stages, keyed by artifact, frozen version/hash, and normalized path. A new source version is a separate identity. `appearances` counts requests that supplied that file; repeated appearances do not increase the unique total. Stage-level unique counts overlap and must not be summed.

Physical reads are projected from existing `harness_step_*` `read_source` events and joined to the frozen manifest's metadata-only artifact descriptors. This inventory includes read outcomes, verified hashes, character/line totals when present, and unique files. It does not fetch source content. Missing historical manifest or audit data is `unavailable`/`partial`; exact totals are null when the full inventory cannot be established. File lists are bounded and report a truncation flag.

## Token totals and cache accounting

Input, output, cache-read, and cache-creation fields preserve provider usage values. Cache is never added to a total when that provider's input count already includes cached input. `canonicalTotalTokens` uses a raw provider total where available; it can also use a provenance-tagged adapter-derived total (including Anthropic-compatible input/output/cache totals). Otherwise it is safely derived from input + output for providers whose input count includes cache. Historical Anthropic-compatible rows without a stored total provenance remain unavailable because the cache contribution cannot be reconstructed reliably. Separate provider-reported totals and unknown counts remain visible.

Usage reads order by creation time and stable row ID, then deduplicate overlapping rows before aggregation. Supabase offset pagination does not provide a cross-page snapshot, so rows inserted or reordered while a multi-page read is in progress can still be missed; the summary is a best-effort point-in-time read.

## Verification

Unit coverage exercises repeated files across stages, new frozen versions, stable reservation/final rows, unavailable token usage, off-manifest metadata, bounded reference lists, owner/project/session filters, physical read joins, cache-total accounting, and secret/source-body exclusion. Retry and provider-pause suites cover the unchanged attempt cap, cancellation, and capacity-stop behavior.
