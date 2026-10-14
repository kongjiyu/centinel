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

## Remaining M6 gates

M6a is an adapter foundation, not a finished end-user runner. Add durable member-
scoped unit-run history, leases/recovery, fixed command snapshots, project/resource
exclusion, explicit dirty-data cleanup, cancel acknowledgement, UI controls and
shared reports. Verify those through real two-account acceptance before marking M6
complete. Packaged client and broader release evaluation remain M7. API-provider
live acceptance remains deferred by user decision.
