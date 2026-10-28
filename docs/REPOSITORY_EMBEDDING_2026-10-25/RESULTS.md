# Repository retrieval implementation evidence

Date: 2026-10-25 (Asia/Makassar). Policy: `review-2026-10-25-repository-retrieval-packets-v12`.

## What the measurements establish

The trusted static benchmark reads the same five frozen repository selections as the existing evaluation. It does not execute repository code, call a model, or access an embedding service. The historical packet baseline is immutable; current input hashes, feature IDs, original line slices and independent sweeps are checked against it before an optimized report can be written. Character counts describe application input, not provider tokenization or Codex allowance usage.

The chunk benchmark passes exact byte reconstruction for all 192 files. The old 2,400-character windows with 240-character overlap would submit 723,979 characters before duplicate-body suppression. The function/document policy indexes 667,819 characters once, a reduction of 56,160 characters (7.76%). There are 1,035 semantic/text chunks versus 426 historical windows. Those counts are not provider attempts: whitespace needs no vector request, compatible cached chunks need no request, and provider errors can stop indexing.

## Causes and mitigations

| Finding | Implemented mitigation | Observable limit |
| --- | --- | --- |
| Arbitrary window boundaries repeat text and split operations | Function/class and document-section boundaries; explicit fragments for oversized units; exact offsets and byte reconstruction | Unsupported languages retain bounded text chunks; fragments do not prove complete operations |
| Early source order can displace relevant evidence | Lexical scoring scans up to 5,000 durable rows and fuses verified semantic ranks; deterministic ties | The scan is bounded and disclosed; semantic top-32 results can be consumed by incompatible historical rows before application filtering |
| Stale or incompatible vectors can contaminate context or force repeated calls | Exact project/member/version/owner/configuration/model/dimensions/policy/source/body/position checks; preserve historical slots and reject collisions | Reconfigured owners/models need compatible new vectors; no cross-owner or cross-version cache assumption |
| Feature requests repeat unrelated function bodies | Exact original ranges around mapped operations and selected dependency context; conservative full-source fallback; unchanged independent source sweeps | Confirmed authority records and non-code document context remain broad; dynamic/import side effects are not a whole-program initialization proof |
| A full-file citation could refer to omitted packet lines | Domain, primary/related finding and semantic-support references must lie in the actual request packet | Exact quotations establish source provenance, not semantic correctness |
| Fine chunks increase cold-index HTTP calls | Reuse exact compatible vectors; skip whitespace embedding without disabling later substantive requests | Provider batch embedding is not implemented; cold indexing can involve more requests despite less source text |

## Live verification boundary

The last inspected Source indexing settings had no endpoint or embedding model configured. No real-vector quality, production database-cache hit, cold-index latency or provider-token saving is claimed for v12. The prior v11 one-file text Review demonstrated accounting and `gpt-6.1-sol` access; it does not verify this new retrieval policy.

The separate five-repository semantic-quality benchmark remains unaccepted. Source coverage and smaller character packets cannot substitute for its frozen precision, recall, occurrence coverage and citation criteria.

Retrieval currently uses one bounded Review objective/grounding query (up to 8,000 characters), not a separate semantic query for every operation. Feature packets use the static selected-source graph and may add validated retrieved units. Selected side-effect imports and runtime initialization effects remain visible boundaries; this is not whole-program dependency or security proof. Every selected source still receives its independent sweep.

Local acceptance and final packet-comparison results are recorded after the remaining checks complete.
