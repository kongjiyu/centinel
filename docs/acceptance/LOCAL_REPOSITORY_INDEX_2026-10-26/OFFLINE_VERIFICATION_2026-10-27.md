# Offline mitigation and verification — 27 October 2026

This report records the completed quota-free phase. At its end, root `.env` set `CENTINEL_AI_ASSESSMENT_PAUSED=1`; the file remained Git-ignored and no development listeners were running. That phase made no assessment/embedding provider calls and started no replacement Review. The user subsequently authorized provider work again; current runtime/resumption status is recorded in `PROGRESS.md` rather than inferred from this historical offline report.

## Preserved live result

Review `740df8ee-619c-4cec-b391-ef2a9c0a9615` is cancelled. The agent deliberately stopped the experiment after repeated response-validation failures; this was an agent-initiated controlled termination, not a provider capacity failure or an explicit human cancellation. Captured terminal usage is dated `2026-10-27T02:45:16.030Z` (10:45 Makassar). Historical records are unchanged.

| Phase | Requests | Known input | Known output | Known total | Unknown totals |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial analysis | 4 | 171,684 | 29,120 | 200,804 | 0 |
| Domain repair | 4 | 129,537 | 19,822 | 149,359 | 1 |
| Semantic support | 3 | 108,341 | 4,823 | 113,164 | 0 |
| Support repair | 1 | 37,785 | 2,412 | 40,197 | 0 |
| Reasoning subtotal | 12 | 447,347 | 56,177 | 503,524 | 1 |
| Query embedding | 1 | 64 | 0 | 64 | 0 |

These known totals are a lower bound. The unknown cancelled request is not zero. Reasoning has six successful, five malformed and one cancelled/unknown request. Known repair consumption is 189,556 tokens, approximately 37.6% of known reasoning consumption; the unknown request is also a domain repair. Malformed responses may still contain valid partial evidence and are not synonymous with fabricated findings.

The same 52 frozen versions match the baseline manifest SHA-256 `669a3ea464b6c3184f87dc29526db66e587c9226e754c4e69b56937bbdf99c64`. Physical reads cover 52 files. Model requests supplied 16 unique files with 108 appearances before cancellation. There were zero document-embedding requests. Three distinct feature batches have saved evidence; the independent source sweeps were not reached. This is neither a complete-run precision/recall result nor a token-saving result.

Derived evidence: `evidence/repository-index-evaluation-2026-10-26/run-2026-10-27T02-23-25-347Z/final-cancelled-usage-summary.json`. Original terminal session, usage and harness captures remain alongside it. No historical usage is rewritten.

## Implemented mitigation

Prepared policy: `review-2026-10-27-bounded-assessment-schema-v16`.

1. Initial feature requests now structurally couple `assessed` to an evidenced non-unverified outcome and `unverified` to the unverified outcome. Honest unknown conclusions remain possible. Existing four-row cardinality and nonempty summary requirements remain.
2. Domain-repair requests receive an exact per-feature allowlist of complete artifact/path/line/version tuples through closed `$defs`/`$ref` objects. They cannot combine individually valid values into an invalid tuple. The allowlist derives from the actual prompt map, which is filtered to the supplied packet. The response format stays unchanged; short dictionary links are not accepted as responses.
3. If specialization exceeds conservative schema budgets, use the entire generic full-reference schema with status coupling. Do not truncate features, sources or evidence inventories. Canonical, packet, excerpt, domain uniqueness and semantic-support validation still run; they remain authoritative even when the schema is generic.
4. Context admission and persisted usage diagnostics use the actual repair schema. The stricter schema is cached per batch, avoiding repeated construction. Attempt budgets, cancellation, capacity stops and provider selection remain unchanged.

Safe terminal metadata identifies four `domain_coverage` failures but does not retain raw rejected responses. It therefore does not prove that reference mismatch or a particular status contradiction caused each rejection. The change prevents these structural classes; reduced live repairs remain unverified. Duplicate domains/features and private or empty public conclusions still require runtime checks. The schema never supplies a favorable verdict.

## Size tradeoff

The saved 22 initial batch maps were replayed without providers. The old initial schemas total 72,148 JSON characters. The prepared initial schemas total 84,403: **12,255 additional characters**, or 645 per feature batch. Independent sweeps retain their old schema size.

Using the exact-reference schema on every initial call would total 360,226 characters, adding 288,078. That approach was rejected for routine initial requests. Larger exact schemas apply only to bounded domain repairs. All 22 replayed schemas compile with the existing MCP SDK's public AJV validator, permit honest unverified responses, and preserve canonical maps. Nineteen feature batches support exact repair specialization; three are featureless sweeps.

`measure-assessment-schema.mts` and the saved `assessment-schema-character-comparison.json` reproduce this measurement. JSON character counts are not provider tokens, a cache-hit guarantee, semantic acceptance or an estimate of completed-review savings.

## Acceptance

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Status consistency | Reject inconsistent status/outcome pairs and empty assessed evidence before generation | Offline checks passed | Live provider compliance unverified |
| Repair references | Full tuple identity bound to each supplied feature; preserve null/unknown provenance; reject shortened references | Offline checks passed | Oversized schema uses generic guidance plus unchanged runtime validation |
| Safety and quality gates | Preserve honest unverified outcomes, canonical map, actual-packet checks, semantic support and source sweeps | Regression checks passed | Complete model quality/recall remains unverified |
| Accounting | Record actual repair schema size; keep cancelled usage unknown and disallow partial savings claims | Regression checks passed; terminal report saved | One cancelled request has unknown consumption |
| End-to-end comparison | Complete the same frozen scope and independently adjudicate unchanged acceptance criteria | Deferred under user's no-provider instruction | No optimization or five-repository acceptance claim |

Final checks: 222 tests passed across 15 relevant sidecar files; 13 comparator tests passed; sidecar TypeScript checking passed. Tests use fake providers or local data. The new schema has root self-review; no additional model-backed independent reviewer was invoked during this quota-free phase. Earlier independent reviews of retrieval/CommonJS delivery apply only to their recorded revisions. No UI changes were made in this phase.

Next provider-enabled action, after a later user request: enable assessments, restart the sidecar with recorded runtime hashes, then explicitly create a saved-source child of the cancelled Review using a fresh idempotency key. Freeze comparison settings and known provenance discrepancies; do not restart the old candidate, import evaluator gold, or lower quality gates.
