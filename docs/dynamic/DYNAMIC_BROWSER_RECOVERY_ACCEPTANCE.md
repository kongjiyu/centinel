# Active browser cancellation and recovery acceptance

Authority: DESIGN.md → Centinel_PRD_Revised.md → DEVELOPMENT_PLAN.md.
This M4h3 slice verifies controlled browser stops with real Codex. It does not
complete M5–M7 or shared evidence/report delivery.

## Runtime contract

An unexpected browser disconnect now aborts the pending provider request and
halts execution. It records a browser-disconnection reason with a blocked outcome,
not an application defect or an ordinary timeout. Explicit cancellation retains
its cancelled outcome. Normal browser closure during teardown does not trigger
this failure path. The provider unit test verifies abort, no additional model
call, no product finding, and retained partial trace/network/console/budget files.

## Reproduce controlled failures

Use the same owned isolated RWA, QA account, environment variable names and direct
servers as [CRUD acceptance](DYNAMIC_RWA_CRUD_ACCEPTANCE.md). Run sequentially.
`sidecar/__tests__/acceptance/rwaActiveCancelLive.ts` launches a read-only Mission
with no interaction grants. After one completed navigation it performs the
selected failure. It checks no additional completed action, not-tested verdict,
unchanged isolated/primary databases, retained local evidence and cleanup.

```sh
node --env-file=.env sidecar/node_modules/tsx/dist/cli.mjs sidecar/__tests__/acceptance/rwaActiveCancelLive.ts cancel
# For process cases, set CENTINEL_RWA_SIDECAR_PID to this owned QA sidecar's PID.
node --env-file=.env sidecar/node_modules/tsx/dist/cli.mjs sidecar/__tests__/acceptance/rwaActiveCancelLive.ts browser_crash
node --env-file=.env sidecar/node_modules/tsx/dist/cli.mjs sidecar/__tests__/acceptance/rwaActiveCancelLive.ts worker_restart
```

Process cases reject a PID without the sidecar command or anything other than one
direct Playwright Chromium child. They never kill the user's ordinary browser.
The browser-crash case kills only that child. The worker-restart case kills the
provided owned sidecar and its captured child, emits `owned_sidecar_stopped`, then
waits for an operator to restart the same QA sidecar. Project-scoped polling
reconciles the expired lease; it does not replay the interrupted Mission.
Do not target unrelated services, including the separate server on port 37701.

Abrupt worker loss retains files already written, including a before-observation
and partial action trace. It cannot promise final budget/network/console files
whose writer was killed. `finalBudgetAvailable` records the actual local presence.
These are local evidence gates; second-device availability is still M5 work.

## Retained cases

- Cancellation Run `4a1a6b2b-56b9-4aba-8dc9-07585ceb6e03`:
  `cancelled/not_tested`, one navigation before and after cancellation; partial
  trace/network/console/budget retained; both databases unchanged; cleanup recorded
  and imported session forgotten.
- Browser-crash Run `09f8cdc0-c4c6-45c8-bff1-037188f8ef0a`:
  `blocked/not_tested` with browser-disconnected reason, one navigation before and
  after controlled crash, partial evidence retained; both databases unchanged;
  cleanup recorded and session forgotten.

Local audits are ignored under `output/playwright/rwa-<failure-mode>-live.json`.
All 520 sidecar tests (72 suites), TypeScript and the explicit online-harness
check passed after the disconnect fix. No UI or schema changes in this slice.
- Worker-restart Run `786697d6-f9b5-4dfc-94b8-e593f168581f`:
  `interrupted/not_tested` after expired-lease recovery on the restarted sidecar;
  one navigation before and after termination, no replay, before-observation and
  partial trace retained, final budget file unavailable. Both databases unchanged;
  cleanup recorded and session forgotten. The initial cleanup note used generic
  stop wording; the retained audit's `finalBudgetAvailable: false` is the accurate
  availability record, not evidence of a complete final budget.
