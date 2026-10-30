# Static Review Playground and engineering harness

## Scope

The Activities → Playground entry observes the same authenticated, durable Static Review runner used by Review. It is not a second analysis implementation or a mock-data execution mode. Choose a project and Review, expand a stage/step, inspect execution metadata, or start a Review using the normal scope/configuration form and return to its live trace.

Queued/running Reviews refresh every 1.5 seconds; terminal runs display saved history. Older runs without harness events explicitly show “Not recorded”; history is never synthesized. Refresh recovers failed reads. Open review navigates to the existing Review detail page.

## Workflow

| Stage | Observable work |
| --- | --- |
| Freeze and validate sources | Select sources, freeze/reuse manifest, optional source inspection, read/hash-check each artifact, load grounding/traceability/dispositions, assess and save evidence readiness |
| Build review context | Index frozen artifacts and retrieve scoped context |
| Run deterministic checks | Run the analyzer and record each applicable rule/artifact pair, including zero findings |
| Review with configured model | Build request metadata, resolve configured provider, run bounded retries/fallback with individual model-attempt records, validate grounding references |
| Validate and save evidence | Validate model location claims, deduplicate findings, save traceability/findings, correlate review iterations |

Optional or unreached work is marked “Not recorded,” not passed. Artifact reads and rule checks have distinct execution IDs, so repeated work does not overwrite earlier outcomes. A started execution without an outcome is “Interrupted” after the Review becomes terminal. Source read failures can be recoverable; the evidence-readiness gate determines whether the overall Review can proceed. Model unavailability preserves existing deterministic-only behavior and is visible in the model step/attempts.

`ReviewHarness.step` records start/completion/failure/cancellation boundaries with elapsed time and explicitly selected metadata. Source bodies, model prompts/completions, raw exceptions, credentials, and private model reasoning are excluded. This is operation-level observability, not tracing every database query or exposing model chain-of-thought.

Audits use the existing bearer/RLS-scoped Supabase `audit_events` table; no new migration, service-role access, or local Static Review database is introduced. The harness endpoint checks project membership and matches the Review's project before returning events. All event pages are retrieved, including traces larger than Supabase's row cap.

## Reference and adaptation

Reference inspected: [Alibaba Open Code Review](https://github.com/alibaba/open-code-review), commit `357c3f09a264563ab64d8f4fc3b25b186cd3c4a4`. Its `internal/agent/agent.go` runner separates input resolution, deterministic selection, dispatch, coverage/manifest finalization, and model-driven work. Centinel adopts the engineering-owned boundaries and auditable run history, rather than installing or shelling out to the Go CLI.

Centinel keeps its own frozen Supabase artifacts, requirement/standard grounding, model settings, leases, cancellation, retry budget, approval lifecycle, and iteration correlations. Added location validation checks a model-provided artifact/path/line against the readable frozen inputs, canonicalizes supported locations, and clears invented/out-of-range claims while retaining the observation for human review. This validates location claims, not the semantic correctness of every finding. No autonomous tool loop, extra model reflection call, or new paid model invocation is added.

## Development startup

`pnpm dev` now runs `scripts/dev.mjs`, without nested npm. It probes sidecar `37701`, demo `37702`, and Vite `1420` before launching. Healthy recognized services are reused; Windows listeners must belong to this checkout. Occupied/unrecognized services fail with an actionable port-inspection message. New backend services must become ready before the app starts. Shutdown/failure cleans up only child processes owned by that invocation; existing listeners are never killed.

Use `pnpm dev:check` for read-only diagnosis. Reusing a listener does not update its code. Close the original dev terminal and relaunch after backend changes to load the new harness endpoint. A healthy Vite listener is reused rather than starting another desktop/Vite process. Direct sidecar/demo launches also report readable port conflicts instead of an unhandled stack trace.

## Verification inventory

- Startup: reproduce the original occupied-port failure, test recognized/unrecognized/free ports, run the root command against existing services, and verify no nested npm warnings.
- Runner: successful full review records step boundaries; failure/cancellation preserves exceptions without leaking details; each applicable deterministic rule is audited; location validation clears unsupported claims.
- HTTP: require a bearer, deny another user, deny a mismatched owned project/Review, return only the requested Review trace.
- UI: project/Review controls, expand/collapse steps, stage navigation, Refresh, Start review/Open review destinations, automatic polling until terminal, older-history warning, empty/error states and recovery.
- Visual: desktop 1440×900 and 1200×900, narrow 390×844; inspect initial view and expanded metadata, keyboard/select interactions, wrapping and horizontal fit. Browser checks use isolated fixture data, not live operational metrics.
- Integration boundary: a live authenticated Supabase Review with a configured model is not exercised by the fixture browser checks; this remains a runtime acceptance check after restarting the sidecar.

### Results (2026-10-11)

- Original demo invocation reproduced `EADDRINUSE`; final `pnpm dev` and `pnpm dev:check` successfully reused the three existing workspace services without nested npm warnings.
- Direct sidecar startup on the occupied port exited with the new actionable message, without an unhandled Node stack trace.
- `pnpm test:dev`: 1 passed. `pnpm --filter @centinel/sidecar test`: 308 passed. `pnpm --filter centinel test`: 171 passed.
- Sidecar TypeScript check and frontend production build passed. Vite retains its large-chunk advisory.
- Isolated browser QA exercised stage selection, expanded metadata, Start/Open navigation, Review selection, older history, errors/Refresh recovery, and live display at the required viewports. No browser page errors were observed. A narrow run-summary wrapping issue was fixed and rechecked; no horizontal clipping remained in the inspected controls/metadata.
- Screenshot evidence is local-only at `C:/Users/PREDATOR/AppData/Local/Temp/centinel-playground-qa-20261011/`.
- The running sidecar was deliberately not killed or replaced; it requires a restart to expose the new endpoint. Cold-start Tauri compilation and a live configured-model/Supabase execution were not re-run.
