# Strict validated-batch memoization

## Scope

`sidecar/src/review/batchCheckpoint.ts` provides an owner-bound immutable memo store for a deliberately narrow case: a structured generation result whose findings and domain assessments passed Review validation, with one fully validated `supported` semantic-support record for every finding. Storage access uses authenticated project-member RLS plus a verified same-owner client; the object contents are encrypted before upload. The Review integration must additionally exclude uncertain citations, packet conflicts, and every other non-clean outcome before calling `save`.

This is not a Review checkpoint or a way to resume arbitrary partial state. It does not cache negative, contradicted, insufficient, uncertain, or conflicted batches. Existing v19 audit events and partial findings are not migrated into this format.

## Identity and use

The caller supplies a SHA-256 `requestHash` over all semantic inputs for that batch:

- owner, project and lineage-root identity, Review policy and validation versions;
- canonical base prompt, system prompt, and output-schema hashes;
- the ordered exact source-packet identity, including versions, hashes, and ranges;
- authority/traceability identity; and
- the saved provider-configuration fingerprint.

The `providerFingerprint` field is independently required and validated. The store checks that a record matches the requested owner, project, and hash. It does not derive `requestHash`; the integration must use one canonical identity builder consistently for loads and saves. A fresh Review must skip cache reads. Only a saved-source Retry with an exactly matching request identity can consume a hit.

On a hit, the integration reruns domain, citation, source-evidence, and semantic-support validators against current frozen inputs, then applies the ordinary cross-batch reconciliation in normal order. It also requires the candidate's assessment rows to exactly match the direct parent's retained feature conclusions and every cached finding to remain a verified model finding in that parent. A later parent contradiction, removal, or uncertainty vetoes reuse. The cache record's origin must be the direct parent or one of its ancestors; an unrelated Review is never an eligible origin. Cache data never bypasses a validator or establishes absence proof by itself.

## Persistence and failure behavior

Records are allowlisted public generation fields plus validated support records. The store rejects unknown fields, non-supported dispositions, missing support coverage, invalid references, and owner mismatch. It stores canonical JSON compressed to the private `project-artifacts` bucket at:

`<project>/_review-batch-cache/v1/<owner>/<project>/<requestHash>/<archiveSha256>.json.gz`

The uncompressed record and compressed object are each limited to 4 MiB. Before compression, the canonical allowlisted record is authenticated-encrypted with the sidecar's `CENTINEL_TOKEN_ENCRYPTION_KEY`. An immutable `upsert: false` upload happens before the `review_batch_cache_saved` audit receipt. The receipt contains only safe identity fields, object path, byte count, and SHA-256 hashes; the encrypted model result, findings, and validated excerpts stay in the private object. No prompt, source body, provider secret, or private reasoning field is part of the allowlisted payload. A read requires a matching receipt and verifies the archive and encrypted-record hashes, decrypts and validates the schema and identity, before returning a hit.

An absent receipt is a cache miss. An orphan object without a receipt is never used. Content-hash paths prevent the application from overwriting divergent objects; existing exact bytes require byte-for-byte verification before receipt publication. Randomized encryption usually produces a new envelope after an interrupted publication. The earlier orphan is not silently consumed, and the first valid receipt wins within the exact lineage-bound request. Corrupt archives, invalid receipts, and incompatible records are rejected as misses and suppress writing for that request; they never become hits. Actual Supabase, authorization, or persistence failures stop the Review instead of silently triggering paid provider calls. The application never overwrites existing objects or receipts. The adapter resolves the current client on each operation, verifies its Supabase user matches the configured owner, and checks project membership before Storage access. Project-member RLS is not owner-only isolation or a server-enforced immutability guarantee: members may disrupt availability by deleting/tampering with objects and receipts. AES-GCM authenticates the full internal owner/project/request tuple; rewritten public hashes alone cannot forge a result. Failed authentication becomes a safe miss.

The record, encrypted envelope and compressed archive each have a 4 MiB ceiling; base64 encoding makes the effective plaintext limit smaller. The server key must match the writer to decrypt a cache. Key rotation or another device with a different server key causes a conservative miss. Codex-only installations without that key omit the optional cache and retain fresh Reviews/ordinary Retry. Explicit reuse requires the encrypted cache and saved sources, otherwise it rejects before creating a child or paid model call.

Usage retains actual new provider calls/tokens on the current Review and earlier costs on their origin Reviews. `reusedAssessments` separately reports validated batches, origins and manifest-checked historical file identities. It never adds synthetic zero-token provider rows or counts historical evidence as newly sent AI context. Whole-workflow optimization comparisons must include all ancestor execution and source-preparation costs.

## Integration and acceptance status

`ValidatedBatchCache` and `SupabaseValidatedBatchCache` are storage ports; Review integration adds the direct-parent basis checks described above. This strict subset is not a cumulative checkpoint and does not restore earlier negative, uncertain, or conflict-ledger state. Orchestrator eligibility, request-hash construction, validation on hits, normal conflict reconciliation, and usage attribution remain part of the caller contract. The Review retry panel now offers an explicit, unchecked-by-default cache reuse choice for saved sources and binds that choice to retry request identity. See [saved-source cache reuse UI](../../review/REVIEW_SAVED_SOURCE_CACHE_REUSE_2026-10-29.md) for acceptance and verification. Offline checks do not establish live Supabase, key-rotation, or provider acceptance.

Live v20 verification subsequently exercised encrypted publication and a real production hit in Review `ff0b73a7-fc6b-446b-a4fd-b024f30532d1`: one clean batch covering seven historical files was restored from `1deb8b4b`, with no new model-attempt rows for that generation/support pair. Production proxy forwarding and finding-metadata read-back defects found during integration were corrected and regression-tested. The cache-bearing run later failed at an uncached provider request, so complete-run quality and token savings remain unaccepted. The retry UI now passes the explicit cache option only for saved-source retries; updated-source retries remain fresh. Synthetic UI and unit checks cover this wiring, but live cache availability and full Review quality remain unverified. A generic `codex_turn_failed` still does not establish the upstream cause or whether a later complete Review will succeed.
