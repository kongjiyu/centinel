# Failed-request usage accounting

## Contract

Provider-reported counts and adapter-derived arithmetic retain separate provenance. A failed request that explicitly received no provider response receives a separate accounting assumption of **0 tokens**, as requested by the user. Its actual consumption remains unknown. A response without usage, unfinished request, partial counters, or an unknown receipt state cannot become a measured zero.

The durable ledger retains the original reservation UUID, nullable actual counters, `responseReceived`, safe `usageObservation` provenance, and optional `usageAccounting: {basis:'assumed_zero_no_response',accountedTokens:0}`. Only terminal errors/cancellation with no receipt and no observed usage qualify. Read projections reject contradictory success/in-progress/response/usage records carrying this assumption. Historical rows are not rewritten.

Safe HTTP error-envelope extraction uses a cloned response, a 16 KiB limit and a one-second deadline; only validated numeric counters leave the reader. Raw error text, prompts, source bodies, credentials and private reasoning are not journaled. Successful malformed envelopes also retain their returned usage before validation rejects them. Capacity errors still pause immediately without retry/fallback.

Codex retains the latest correlated usage for each fresh ephemeral generation thread. A cumulative thread total takes precedence over a legacy last-turn total; cumulative usage from another thread is not added. Failure, timeout and active cancellation retain streamed counts. Presence of provider output can establish receipt without retaining that output. A queued cancellation does not start provider work.

Embedding source-index and query requests retain safe usage from HTTP errors and malformed vectors. If cancellation or timeout occurs during error processing, previously parsed counters survive in a decorated error and the durable bridge row. No-response assumptions remain separate from Voyage admission estimates. Explicit saved-settings probes use the same safe fields.

## Presentation

Summary, pipeline-stage and logical-phase projections expose assumed-zero counts and accounted subtotals alongside unknown actual counts. Provider/model group tables and Settings recent calls preserve nullable values; unknown input/output/cache counts are not converted into measured zeros. The UI explicitly says that no-response zero accounting is an assumption and that actual provider consumption remains unknown. Cache reads remain a subset where the provider's protocol requires it, not an extra total.

`accountedTokens` is a subtotal, not a complete provider bill. Unknown responses outside the explicit no-response rule remain unresolved. Neither token totals nor these accounting assumptions can be converted reliably into a Codex five-hour allowance percentage.

## Verification and acceptance limits

The implementation agent passed 137 focused tests and sidecar TypeScript checking. Independent Sol review exercised 109 sidecar and 27 frontend tests; root fixed the reported storage-overwrite, cancellation/timeout retention and unknown-as-zero presentation issues. The reviewer then independently passed 21 embedding-provider cases after the final timeout fix, with no blocking findings remaining.

Root's embedding bridge/provider/probe check passed 38 tests after both 17-token cancellation/timeout regressions. Root's final affected frontend run passed 89 tests. The broad sidecar unit run reported 1,254 passing and 19 failing checks: 18 failures concern Windows file-mode/symlink permissions or Unix-only Dynamic process execution. The pinned-repository feature-map case exceeded its deadline under concurrent load and passed all 39 cases when rerun alone. The full suite is therefore **not green**; these failures were not hidden or patched as part of this Static Review change.

These are offline/local checks with controlled provider fixtures. A new authenticated live execution is still required to verify real provider event ordering, total consumption and semantic acceptance. No savings or complete quality pass follows from the accounting tests.
