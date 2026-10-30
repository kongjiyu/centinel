# Provider capacity pauses — implementation and acceptance

The user supplied evidence of remaining account allowance and requested immediate workflow pauses for rate-limit, exhausted-quota, exhausted-credit and billing errors. A generic HTTP 429 is a provider rejection, not proof that the account has no usage left.

## Behavior

- Structured capacity errors stop the affected Review or readiness check on the first rejected request. No application retry, repair request, provider fallback, completion/approval transition or finding-resolution correlation follows the stop.
- Rate limits, exhausted usage, exhausted credits and payment/spending limits have separate safe reason codes. HTTP 429 without a specific code is rate_limited; HTTP 402 is billing_required. Raw messages are not used to infer exhausted allowance. Known provider codes are allowlisted; unknown failures keep their existing failure handling.
- Configured text and embedding HTTP providers inspect at most 16 KiB of error JSON for recognized codes. A one-second error-body deadline prevents a stalled body from hiding an already-known HTTP capacity block. Provider bodies, credentials and private reasoning are not persisted.
- Codex reacts to structured capacity error notifications immediately and closes its isolated app-server process, stopping CLI-internal retries rather than waiting for final turn completion. Already-started upstream work cannot be undone. Source content that merely mentions quotas/credits is not a capacity error.
- Source indexing and context-retrieval embedding capacity failures propagate to the Review pause, after recording their failed usage attempt. Ordinary non-capacity indexing outages retain the existing lexical fallback.
- Review reuses durable status blocked with progress.stage=provider_paused and pauseCode. It is displayed as Paused in detail, project summaries, dashboard actions and toast. Successfully completed deterministic findings are retained where persistence succeeds; persistence limitations are disclosed. Later checks and correlation are not run.
- Retry review creates a linked immutable child attempt using the existing source-manifest policy. It is a manual retry, not continuation within the same paid model call. The paused parent remains paused and retains its history.
- Readiness stores paused and preserves its previous snapshot. Category states remain Missing, Incomplete and Completed; no provider failure is converted into a documentation verdict. Status reads, source changes, sync notifications and restarts cannot release a capacity pause. Manual Resume (POST) can start a new attempt. Legacy failed capacity jobs are recovered as paused without model calls. A source-change replacement queued during the failed request is paused too.
- Recovery copy can expand the Readiness overview row so the full reason remains readable at narrower desktop widths. Unrelated overview rows without recovery guidance retain their existing sizing.

## Account diagnosis

The read-only Centinel-managed Codex capacity probe recorded 7% used in the five-hour window and 38% used in the weekly window, with no reached-limit state. A later read-only desktop account tool also confirmed ordinary usage was allowed (15% / 39% used at that later moment). These are separate observations, not an assertion that the accounts are identical. Both support the supplied screenshot: exhausted included usage has not been established. Zero purchased credits alone does not prove the remaining included allowance is unavailable. No quota reset, credit purchase or inference request was made.

The earlier generic 429's exact cause remains unconfirmed. The new behavior preserves that uncertainty rather than claiming insufficient credits. Safe Centinel probe: evidence/provider-pause-2026-10-20/capacity-check.json. Reproduce explicitly with pnpm --filter @centinel/sidecar exec tsx ../scripts/codex-capacity-diagnostic.mjs <existing-managed-home>; it exports no account ID or authentication.

## Measurable acceptance

| Feature | Acceptance criteria | Status | Risk flags |
|---|---|---|---|
| Model retry policy | Exactly one attempt on capacity failure; no sleep, fallback or repair; safe attempt metadata | Passed unit checks | Provider-internal work is stopped on its first observable capacity event |
| Review lifecycle | Pause before completion/approval/correlation; preserve deterministic findings; explicit linked retry succeeds | Passed orchestrator checks | No live paid request was deliberately exhausted |
| Embedding stages | Stop indexing/retrieval on capacity errors, retain failed usage metadata, make no downstream model call | Passed provider/index/orchestrator checks | Unknown/unrecognized provider error formats retain generic failure handling |
| Readiness lifecycle | Preserve prior snapshot, survive restart/source changes, stop replacement job, resume only manually | Passed coordinator checks | Durable pause depends on successful database persistence |
| UI and recovery | Show Paused/Resume/Retry, hide approval, retain categories and readable reason at 1440×900, 1200×900 and 390×900 | Passed isolated browser and frontend checks | Signed-in native WebView parity remains unverified |
| Existing live account | Inspect remaining usage without inference, reset or purchase | Passed read-only probe | Does not identify the exact cause of the earlier 429 |

## Verification

- Backend focused suite: 170 tests in 12 files passed; additional source-indexing suites: 17 tests in two files passed. A final added indexing-stage stop and capacity-filter regression check passed with the orchestrator/Codex suite (50 tests in two files). This represents 188 distinct backend tests across the covered files, not the sum of repeated runs.
- Frontend: 50 tests in five files passed (Readiness card, Review lifecycle/detail/narrative, project summaries). An initial new hook test created an unstable project-array reference and exhausted its test worker; the fixture reference was corrected and the complete focused suite passed. No product failure is inferred from that test-only issue.
- Sidecar TypeScript passed. Frontend production build passed with the existing large-bundle warning. Scoped whitespace checks passed.
- Isolated browser checks intercept auth and application traffic and use fictional data. Verified no automatic Readiness POST across viewport changes, exactly one POST after manual Resume, disabled Start while running, visible Review retry and hidden approval at all three widths. Activity displayed explicit pause guidance when detailed history was unavailable. Screenshots/check reports are under evidence/provider-pause-2026-10-20/. Final layout checks confirmed the entire pause message stays inside the Readiness card at all three widths; at 1200 px the row grows to fit instead of clipping the explanation. A separate Review Activity screenshot verifies the pause guidance.
- The owned local sidecar was restarted with the final implementation; localhost health reported ok. Its listener uses localhost/IPv6 on this host; a 127.0.0.1 health probe was refused while the localhost probe succeeded.

The earlier public-repository Reviews remain saved, awaiting human approval. The remaining real-model readiness corpus was not retried in this change; the task here verifies pause behavior without another assessment charge. No live Review approval, finding disposition, upstream publication, database migration, commit or push was performed. The earlier unrelated Windows Dynamic test failures and full security/semantic acceptance remain open as documented in their reports.
