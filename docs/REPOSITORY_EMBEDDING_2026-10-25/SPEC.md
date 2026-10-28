# Repository retrieval and bounded evidence packets

## Intended behavior

Index frozen repository functions/classes and document sections as searchable units. Combine semantic ranking with keyword ranking, then use code structure and selected dependency relationships to construct smaller source packets. Retain exact source evidence and independent source-wide checks. This is an additive improvement to policy v11 token accounting, not a whole-program security proof.

1. Chunk source without losing bytes, original offsets, CRLF, comments or duplicate occurrences. JS/TS uses the installed TypeScript parser; unsupported formats and oversized units use explicit bounded text fragments. Documents use section/paragraph boundaries when available.
2. Persist current-policy chunks in the existing member-scoped `artifact_chunks` index with exact version, source/body hash, offsets, owner and embedding-configuration provenance. Preserve historical rows; do not reset schemas or delete source/index history. Reuse only compatible real vectors. Embedding configuration remains separate from the configured GPT text model.
3. Rank current-policy candidates using query identifiers/words and compatible semantic results. Stale, wrong-owner/configuration/version or malformed candidates cannot enter the evidence packet. Capacity errors stop the workflow. Missing embeddings retain a real keyword-search path and explicitly disclosed limits.
4. Construct exact line-range source packets around mapped operations, related callers/callees, mandatory module context and selected dependencies. Never mask omitted source with blank lines and label the result a complete file. Ambiguous code falls back to original full source. Retrieval may add bounded relevant complete units; similarity never deletes required evidence.
5. Run unchanged independent full-source sweeps and deterministic checks over every selected source. Keep all four feature domains, semantic candidate support, exact citations, attempt budgets and conservative absence-resolution requirements. Confirmed requirements/standards and whole document context remain available until safe authority-specific narrowing is proven.

## Compatibility and implementation constraints

- Use the existing Supabase tables and owner/member authorization. No service-role key, local Static fallback, hardcoded embedding model, synthetic vector, new credential or provider substitution.
- Preserve `vector(1536)` and the existing OpenAI-compatible embedding contract.
- Current-policy index rows use a reserved ordinal namespace and policy-qualified position/content identity to coexist with old chunk rows. A contradictory occupied slot fails closed before provider access or mutation. Immutable version changes get new parent version IDs.
- Preserve exact original numbered source lines and file hashes. Domain assessment references, primary/secondary finding references and support references must lie within the actual packet, not merely a selected full file.
- Keep the existing eight-feature, 64,000-source-character and 128-request ceilings. Required context that cannot fit fails before provider execution. Optional retrieval context never displaces required context.
- Stored diagnostics contain only safe method/fallback enums, counts and versioned references; never prompt bodies, rejected responses, provider secrets or private reasoning.

## Acceptance

| Feature | Acceptance criteria | Required checks | Status |
| --- | --- | --- | --- |
| Semantic chunks | Exact ordered byte reconstruction; sensible function/document boundaries; bounded large-unit fallback | Positive/negative/CRLF/Unicode/repeated-text fixtures | In progress |
| Compatible vector reuse | Same identity/configuration cache hit makes no embedding request; mismatch cannot be retrieved | Owner/project/version/policy/config/offset fixtures | In progress |
| Hybrid ranking | A relevant late-file keyword match can beat early irrelevant chunks; compatible semantic matches contribute | Query ranking, bounded scan, malformed and capacity fixtures | In progress |
| Evidence packets | Preserve mapped refs, guards, connected code and every independent sweep; omitted lines cannot be cited | Dependency/global-state/dynamic fallback plus orchestrator validation tests | In progress |
| Real cost and quality | Same five frozen selections before/after; compare source/prompt chars and coverage separately from actual provider usage | Immutable baseline, static parser benchmark, optional configured-provider live check | In progress |

The baseline is frozen in `baseline-packets.json` before the planner implementation changes. Its five cases contain 192 files and 991 mapped features. Neither character reductions nor source inclusion alone establish live finding precision/recall. The existing five-repository gold and its acceptance thresholds remain unchanged.
