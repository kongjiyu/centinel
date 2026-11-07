# Readiness relevance, stale failure reasons and criteria disclosure (7 November 2026)

Addresses QA item G-S6 (`docs/qa/QA_FULL_SYSTEM_FLOW_REVIEW_2026-10-30.md` items 10–11, `docs/qa/SYSTEM_GAP_PLAN_2026-10-30.md`).

## Problems reproduced

| # | Problem | Was it real? | Reproduction |
|---|---------|--------------|--------------|
| 1 | Unrelated documents produced a Completed Coding standards (or Design) category | Yes | `readinessEngine.test.ts` "G-S6 never completes coding standards…" and "…design from a coding-standards rule…" failed before the fix (state was `completed`). The engine only checked that quotations were exact, never that they were the right kind of content. |
| 2 | An old failure reason stayed on screen after configuration changed | Yes, for configuration failures | `projectReadinessCoordinator.test.ts` "G-S6 stops presenting a configuration failure…" failed before the fix. A failed job with an unchanged source fingerprint was returned as-is on every status read, so "No Model Provider is configured" stayed after a provider was configured. |
| 2b | Failure reason stays after sources change | No | "G-S6 clears a failure reason when changed sources requeue…" passed before the fix: a changed fingerprint already queues a new job with no error. Paused (capacity) jobs still require manual Resume by design. |
| 3 | Criteria had no explanation | Yes | Snapshots already stored `criteria[].basis/references`, but the card showed only the category state. |

## Changes

1. **Content corroboration (policy `readiness-2026-11-07.1`).** After batch merge, `applyClassificationCorroboration` checks that at least one classification quotation of a present category reads as that kind of content. Coding standards need a code subject (language, tool, code construct, naming/formatting, review/testing of code) together with rule wording; Design needs implementation-structure wording (service, component, interface, data store, flow, endpoint, design…). Only quotation text counts, never filenames or extensions. If the check fails, every criterion becomes `unknown` with an engine-written basis, `checksPassed` becomes 0, the category becomes Incomplete, criterion gaps become "Evidence is needed" gaps, and a `category_classification_uncorroborated` gap cites the offered quotations. The gate is a necessary condition only; all earlier validation still applies. Requirements has no lexical gate. The prompt now tells the model what counts as classification evidence. Diagnostics schema `readiness-validation-2026-11-07.4` adds `classificationCorroborated` and reason `classification_uncorroborated`; older .1–.3 snapshots remain valid. The policy change alters the source fingerprint, so older snapshots show as previous results and are reassessed through the normal source-check path.
2. **Stale configuration failures.** When a job fails with `not_configured` or `secret_unavailable`, the coordinator stores `configurationRevision` (a SHA-256 of the configuration identity; secrets and base URLs are hashed again, never stored) in the existing `audit_events` job payload. A status read presents such a job as `idle` with no error once the current revision differs. A legacy `not_configured` job without a revision is superseded once any configuration exists. Lookup errors keep the stored failure visible. The failed job stays in the journal, and no assessment starts until the user selects Start.
3. **Criteria disclosure.** `ProjectReadinessCard` shows a chevron button on each category that has saved criteria. Expanding it lists each criterion with its saved verdict (Met / Gap / Not verified), basis and up to three cited excerpts. Only stored snapshot data is shown.

No migration. The HTTP contract is additive (`configurationRevision` on the job payload; `idle` is an existing status).

## Verification

- `pnpm --filter centinel build`: passed.
- `pnpm --filter centinel test`: 85 files, 590 tests passed.
- `pnpm --filter @centinel/sidecar test`: 160 files, 1,579 passed, 1 skipped.
- Visual check of the card with a temporary harness at 1440×900, 1200×900 and 375×812 (light workspace theme; no horizontal overflow; styles scoped under `.command-project-detail .project-readiness-*`).

## Limits

- No live or paid model run was made. The prompt change and the lexical gate were not measured against the live gold corpus. Earlier evaluation reports describe policy `.3` and are not rewritten.
- The lexical gate can still pass text that mentions code or design words without being that kind of document, and it can mark a real standards document Incomplete if its quotations lack the expected vocabulary. Both outcomes are conservative: neither can produce Completed without the model's validated verdict.
- `codex_not_connected` failures are not cleared automatically because Codex sign-in is device state, not a stored configuration. `assessment_paused` and capacity pauses keep their manual Resume behaviour.
