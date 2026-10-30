# CargoChain in-app assessment outcome

Project: `c1ffced6-6a0d-4a5b-9b2a-7e8813ddf509`. These are Centinel workflow observations, not a substitute manual review of CargoChain.

| Feature | Acceptance criteria | Status | Risk flags |
|---|---|---|---|
| Drive attachment import | Accept original up to 100 MiB with bounded download and preserved bytes | Implemented; requested 11,435,236-byte report reimported and hash matched | Local exact 100 MiB boundary tested; actual 100 MiB cloud upload unverified |
| Original PDF assessment | Frozen source reaches semantic assessment with verifiable provenance | Blocked in full-source Review `13fbb92d` | Binary-to-UTF-8 conversion does not reproduce original byte hash; diagrams unverified |
| Saved index resume | Explicit Resume releases same-owner paused saved identity without automatic capacity retries | Fixed; native retry `4bd96441` passed the earlier `assessment_paused` blocker | Final publication did not complete |
| Supported text Review | Finish indexing, deterministic and four-domain model assessment | Paused by provider rate limit during indexing after about 20 minutes | Model code assessment was not reached; no semantic acceptance |
| Readiness polling | Slow GETs update status without overlapping invalidation | Fixed; 15 component tests and frontend build passed | Live category verdict still unavailable at checkpoint |
| Readiness sync identity | Unchanged head checks do not discard model work; real changes still invalidate | Prepared fix passed 46 tests, final TypeScript and independent review; backend restart initiated | Post-restart live outcome pending; interrupted usage remains unknown without returned counters |

## Recorded causes

1. The first historical Review was cancelled by the operator, not rejected by the model.
2. Earlier Readiness failures correlated with exact-time local diagnostics indicating selected-model capacity. Generic saved `codex_turn_failed` / `assessment_failed` obscured that cause. This does not establish exhausted account quota.
3. Full-source Review rejected two binary originals at frozen text/hash validation. Importing bytes and extracting a PDF's semantic content are separate capabilities. The guard was preserved; explicitly labelled text companions were used for the subsequent 285-source run.
4. A stale index pause survived explicit Resume because the saved Review used a different fingerprint from the current full project. Explicit owner/project snapshot plus revision CAS fixes this without ordinary polling unpausing jobs.
5. The subsequent real native-app Review advanced into indexing, then received an explicit rate-limit response. It recorded 81,163 provider-reported embedding tokens across 23 successful calls, plus one call with unknown usage. Total consumption remains incomplete. Its inventory identified 15 files, but 10 attempts lacked exact file attribution, so no exact unique-file total is claimed. UI evidence: `evidence/cargochain-2026-10-28/review-rate-limit-ui.txt` and `review-rate-limit-usage.png`.
6. Readiness sync-progress identity and overlapping frontend polls are separate reproduced software defects. The stability fix preserves completed model work while an unchanged import check settles under the existing deadline, revalidates evidence and latest job, and reacquires refreshed owner credentials before persistence. See `READINESS_SYNC_STABILITY_2026-10-28.md`.

## Remaining acceptance limits

- Seven Solidity source files were excluded by the current GitHub importer; no whole-system or smart-contract security coverage is established.
- No confirmed requirement records/mappings existed in the selected text Review. Supplied documents do not by themselves establish complete requirement-to-code traceability.
- PDF diagrams and the original binary-document assessment path remain unverified. Extracted companions are snapshots requiring regeneration after source updates.
- Provider rate limits are external execution constraints. No automatic retries, provider fallback or fabricated passing findings were used.
