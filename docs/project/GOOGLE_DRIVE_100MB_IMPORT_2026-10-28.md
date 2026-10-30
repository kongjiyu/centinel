# Google Drive 100 MiB attachment import

The Drive connected-source adapter accepts files up to 104,857,600 bytes (100 MiB, displayed here as the requested 100 MB attachment limit). The limit applies to declared metadata, response Content-Length, and bytes actually received. Streaming stops and cancels the body when the bound is exceeded; there is no unbounded arrayBuffer fallback. Sync content pages are bounded to one maximum-size file under the default limit, including the changes feed. Metadata-only browsing retains its existing page size.

Explicit forced source sync discards the stored provider cursor before preparing a new snapshot. This re-evaluates unchanged files previously marked unsupported after an import-limit change. Normal incremental sync and durable partial-run recovery preserve their cursors. Existing project membership, bearer-scoped Storage and immutable byte/hash/version contracts remain unchanged.

## Verification

- 41 tests passed across `googleDriveSize`, connected-source providers/importer/routes/worker suites; sidecar TypeScript passed.
- The exact 100 MiB streamed boundary passed locally. Metadata exceeding the bound avoids download; understated metadata and oversized declared bodies are cancelled and rejected. A real-adapter/importer regression reimports a previously unsupported unchanged Drive file after the configured limit increases.
- Live authenticated full sync of CargoChain's requested Drive report succeeded. Source item `793d85b3-047b-4c9f-a8af-969f7e6f836a` now supplies artifact `93fa2a99-7625-4ff5-b7e6-512407933030`, version `edca7c8d-2026-41cd-b334-6727e35770b8`. Its SHA-256 `f95f0a68ff98ef9008b4900a33599ecc74a2291caf6458a4e2da3b7b11213f30` matches the original 11,435,236-byte PDF. Evidence: `evidence/cargochain-2026-10-28/0068-drive-100mb-reimport.json` and adjacent authenticated artifact captures.
- Live verification used that actual 11.4 MB file. A real 100 MiB Supabase upload was not performed, and remote bucket/account/global limits can impose a lower ceiling. Do not claim a verified 100 MiB durable cloud upload from the local boundary test.

## Independent execution limits

Importing PDF bytes does not provide PDF text extraction. Production Review currently converts frozen bytes to UTF-8 and then verifies text against the original byte hash. Binary PDFs do not round-trip, so Review `13fbb92d-d05b-413d-a07e-ecc0e6e6a799`, submitted through the normal Centinel Review UI, stopped at evidence sufficiency with 285/287 sources readable. Both original PDFs were unavailable to text analysis. No hash guard was relaxed. Text companions remain explicit extraction snapshots, with diagrams uninspected and regeneration required after source changes.

CargoChain Readiness failures at 15:30:04 and 15:43:56 Makassar correlate with local Codex turn diagnostics stating selected-model capacity unavailability. Saved public errors were generic `codex_turn_failed` / `assessment_failed`; these are execution failures, not semantic quality verdicts or established account-quota exhaustion. Allowlisted derived diagnostic evidence is retained locally without copying upstream messages, prompts, source text or credentials. The earlier cancelled Review was an operator cancellation, not a model failure. The app's later evidence-blocked result remains historical and distinct.
