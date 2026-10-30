# Existing unit-test execution

## M6a: separate bounded Vitest adapter

The first adapter executes an already-authorized target workspace and its installed
Vitest 3.x/4.x JSON reporter contract. It supports selected scripts containing only
`vitest`, `vitest --run` or `vitest run`. Shell wrappers and additional script flags
are rejected. It invokes an absolute selected Node executable and installed local
`node_modules/vitest/vitest.mjs` using fixed argv (`run`, JSON reporter, owned
report file, cache disabled); no shell string, model-generated command, global
Vitest fallback, dependency install or generated tests are involved.

Authorization uses the existing account/project/environment registry and current
package/lock fingerprint. Missing dependencies, stale/other-account authorization,
unsupported script/framework and escaping metadata are distinct prerequisite
failures. Direct filesystem resolution avoids Node resolution-cache/fallback
surprises when an installed dependency is removed after an earlier run.

`runVitestWorkspace` reuses the bounded process engine: 100–300000 ms timeout,
256000 bytes combined output, stripped inherited app credentials, explicit local
variables, cancellation and Unix process-group termination plus orphan guardian.
Its owned temporary report directory is private and removed after normalization.
A fixed JSON slot is opened without following symlinks, checked as a regular file,
and read up to 1000001 bytes even if it grows after stat. Machine reports are capped
at 1 MB, 500 files and 5000 tests. Raw model prompts are never involved.

The parser compares summary counts against every per-test status. Skipped and todo
counts are retained separately; malformed JSON, inconsistent counts, missing
reports, zero tests and all-skipped/todo results cannot become a passing suite.
Passed requires successful process exit, a successful machine result and at least
one actually passed test. Suite errors, process failures, timeout, cancellation,
output bounds and runner errors remain distinct outcomes. Test failures and logs
are redacted before truncation; absolute local paths are removed. Detail truncation
is disclosed, never substituted for counts.

Result schema 1 records framework/version, logical executable/argv, selected script,
workspace/authorization fingerprint and observed git commit (null if unavailable),
process exit/signal/duration, counts, test cases, suite errors, bounded output,
execution outcome and limitations. It contains no browser criteria or model verdict.
Authorized repository code executes on the local machine; this is not an OS sandbox.

## Verification on 15 October 2026

- Sidecar TypeScript and full 576-test / 81-file suite passed.
- Real installed Vitest 4 fixture exercised passed, failed, no tests, all skipped,
  todo, timeout and cancelled results. Tested malformed/inconsistent JSON, escaping
  metadata, absent dependencies, stale/other-account authorization, shell-wrapper
  rejection and a symlink report slot. Existing process-group/orphan and environment
  isolation tests remain in the full suite.
- Created an independent unit-only archive of pinned RWA commit
  `9dfcb9869533ce8a8963c556facc0d80457f9d39` at
  `centinel-test-targets/rwa-unit-release-20261015`. Only installed dependencies are
  shared; source/data/cache are independent. The cache-directory override is recorded
  in its local baseline marker. Git metadata is absent in an archive, so the runner
  honestly records gitCommit null; acceptance separately records the pinned source.
- Real RWA **Vitest 3.2.4** / Node 22.20.0 completed in **9494 ms**: **54 tests,
  44 passed, 0 failed, 10 pending/skipped, 0 todo; 20 framework suites, 0 failed**.
  Parsed per-test counts match the framework JSON. No API/model call was needed.
- Unit-only data was restored in finally. Primary RWA database hash stayed
  `8656de87f3db7a09e85297e1e1e1b28e018c96866b9f611c2363c673a91ed219`;
  browser acceptance copy stayed
  `a8e70a2ebc23d9a36aa59394bd58c75e30c24136e9064944af69bf19161def2a`.

Reproducible harness: `sidecar/__tests__/acceptance/unitRunnerLive.ts` requires an
explicit `CENTINEL_UNIT_TARGET` with its isolated/unitOnly baseline marker and
`CENTINEL_UNIT_RUNTIME_BIN`. Outputs are ignored under `output/playwright/unit-runner`.
The framework tests mutate only their independent unit data and it is restored.

## M6b: shared lifecycle, history and reports

`dynamic_unit_runs` is a separate bearer/member-scoped durable Run contract. The
executing actor, selected environment/version, script/authorization fingerprint,
installed CLI hash, observed repository commit, actual Node/Vitest versions and
timeout are frozen. Repository changes after start block execution. Variables are
captured locally before claim, remain local and are not copied into records.

- `POST/GET /projects/:project/dynamic/environments/:environment/unit-runs` starts
  or lists the latest 100 unit Runs. POST accepts only idempotencyKey and timeoutMs.
- `GET .../unit-runs/:id` reads/reconciles a selected Run; `POST .../:id/cancel`
  requests termination. Duplicate requests replay without launching again.
- Owner-bound worker claim, 90-second leases, heartbeat and expiry recovery fence
  late writes. Running cancellation waits for worker acknowledgement; stop wins
  over a late pass. Expired work becomes interrupted, never silently resumed.
- Execution requires a prepared profile/version and claims its data reservation.
  Unit/browser/hook/session work excludes conflicting project execution. Even a
  passing unit suite leaves cleanup_required. Failed cleanup retains ownership.
  Manual or previously authorized automatic cleanup records attributable events.
  Local-value/session operations also reject active unit work.
- Missing prerequisites produce blocked historical attempts with null unverified
  command/version fields; no code is launched or data reservation acquired. No
  tests, parser errors, timeout, cancellation and runner errors stay not_tested.
  Failed framework assertions are not automatically application findings.

The additive migrations `202610150008_dynamic_unit_runs.sql` and
`202610150009_dynamic_unit_reports.sql` are applied/registered on Centinel Supabase.
RLS permits project-member reads; direct table mutation and lease-token access are
not granted. Old browser/hook RPC contracts remain intact, including the boolean
session-capture acquisition return type.

Unit reports have their own immutable snapshot schema, preserving framework
outcomes, cases/failures, versions, process exit/signal/duration, bounded redacted
logs, original preparation and cleanup events at capture. Later cleanup requires
another report. Member-authenticated JSON/Markdown/PDF downloads reuse the verified
export transport/native-save helper; there are no public or signed report links.
Unknown commit/counts/duration are not invented; PDF uses the existing Latin-font
fallback and exact Unicode is retained in JSON/Markdown. Shared logs are bounded
at 8192 characters; full bounded execution receipts remain device-local.

### Use in Centinel

Choose a saved **Run environment**, open **Manage environments and local values**,
inspect the independent unit repository folder, select its existing unit script
and Node runtime, and save explicit local script authorization. Record preparation
for that unit data baseline. Open **Existing unit tests · Vitest**, choose a timeout
and run. Select a history entry to inspect its summary, expandable test cases/logs,
execution identity and report snapshots. Confirm or run authorized cleanup before
reuse. A second member can inspect shared results/reports without the original
workspace or Codex binding; executing on another device requires local authorization.

### M6b acceptance on 15 October 2026

- Sidecar TypeScript, frontend build, **580 sidecar tests / 82 files**, **246
  frontend tests / 48 files**, and all **31 isolated Dynamic SQL suites** passed.
- SQL covers duplicate starts, browser exclusion, worker identity, invalid counts,
  stop fencing, dirty-data ownership, failed/successful cleanup, immutable report
  history, expired-worker interruption/late-write rejection, member/nonmember and
  revoked member access. Existing browser/session/hook suites remain passing.
- Real shared synthetic fixture environment
  `5695a640-2e5d-4036-9d28-6ed7cfe0ce05` retained passing Run
  `fd56b3bc-ab22-4605-ae57-1393a5710913`, failed Run
  `35f2fc8d-2b96-44de-8a67-df022349d4d5`, timeout
  `7d895fe2-c172-4281-a6a1-53ce768ea330`, and cancelled Run
  `7497d17d-51b3-4885-9634-b2a41e7d9c70`. Reader inspected all four;
  cleanup before/after snapshots preserved the original report unchanged.
- Additional retained blocked Runs: missing dependency
  `f8b9f655-81a7-4baa-9caf-d4fcc820850e`, no tests
  `b166da84-a170-4e2e-973c-8b2f4280a5ce`, invalid machine JSON
  `d4e030b8-819a-4c4d-995b-7d031e4c4ce1`. Fault injection files/symlinks were
  restored. Prerequisite attempt `14c444ca-adb9-4363-8f5f-8ac1e840ea86` launched
  no code. These are labeled synthetic acceptance scenarios, not application bugs.
- Final shared RWA Run **`8650bb99-f626-4f42-99c8-4046b947771f`**, environment
  `4673a282-b301-4335-bbda-dbcc2a63014c`: Node **22.20.0**, Vitest **3.2.4**,
  **54 total / 44 passed / 10 skipped / 0 failed**, matching all retained cases.
  Independent unit data was restored; primary and browser-copy database hashes
  matched before/after. Report `5262b033-e991-4dc6-88c0-32f4084e79a7` includes
  the verified cleanup event. Reader downloaded JSON, Markdown and PDF with SHA-256.
- Reader UI showed actual counts and the disabled unprepared start, and exported
  PDF. Inspected 1440×900, 1200×900 and 390×844 without document overflow. Test
  cases/logs are progressively disclosed; tables have focusable local scrolling.
  The five-page PDF was rendered and inspected, and its selected Run, counts and
  cleanup sections were text-verified.

Reproduction: `unitHistoryLive.ts` runs controlled shared synthetic cases;
`unitFaultHistoryLive.ts` extends its saved audit with controlled faults;
`unitRwaHistoryLive.ts` runs the explicitly isolated, marked RWA archive through
shared lifecycle/report routes. All live harnesses require the ignored QA account
configuration. Outputs remain ignored under output/playwright and output/pdf.
An initial synthetic harness attempt was rejected because a public mode value
matched its profile URL; it executed no code. The fixture uses distinct mode IDs
instead. A preliminary RWA report used a generic unit label URL; the final Run
above uses the RWA address and an independent named unit-data resource. Earlier
records are retained, not silently rewritten or counted as final corpus samples.

## Remaining release gates

M7 still requires broader repeated evaluation, runtime kill/restart/offline cases,
packaged Tauri client launch/export, release/demo documentation and the final
requirement-by-requirement audit. Native applications-under-test remain optional;
packaged Centinel verification is required. Real API-provider acceptance is
explicitly deferred by the user; Codex is the live acceptance backend.
