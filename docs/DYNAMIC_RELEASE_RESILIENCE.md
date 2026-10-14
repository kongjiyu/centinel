# Dynamic release resilience and security checkpoint

Scope: Dynamic/shared runtime only. This follows the frozen release protocol;
Static remains excluded and real API-provider acceptance remains user-deferred.
It does not close the native packaged UI/save gate.

## Local process exclusion

Repository script processes now claim a private per-OS-user lease keyed by the
real workspace directory. Different projects, sidecars, aliases and TMPDIR values
cannot concurrently execute commands in that same physical workspace. A busy
workspace returns runner_error without starting another process. This augments
project-scoped database/data reservations; it does not discover shared external
services or turn arbitrary repository code into an OS sandbox. Parallel projects
still need independently prepared data/workspaces.

The guardian alone releases a started lease, only after its Unix process group
has stopped; the parent waits for an acknowledgement. Parent SIGKILL triggers the
guardian to terminate the group and release. Failed synchronous spawn releases
its unstarted lease. Corrupt/leftover leases fail closed; age never declares a
process or data clean. If both worker and guardian are lost, inspect stopped
processes and the owned lease before manual recovery; do not blindly remove locks.
Data cleanup is a separate shared lifecycle and is not implied by lease release.

The mutex initially used environment-dependent temporary roots; the real
cross-process test caught that discrepancy. It now uses a stable `/tmp` namespace
with OS uid, owner/mode/symlink checks, and exclusive file creation. Tests include
directory aliases, distinct worker process, SIGKILL/orphan termination, recovered
execution, synchronous spawn failure, time/output limits and existing Vitest runs.
Root dev script also uses pnpm consistently instead of invoking npm internally.

## Live acceptance

- Provider unavailable: Run `8babdf29-4cf9-4caf-82b3-cff761523d6f` used an owned
  isolated sidecar with a deliberately nonexistent Codex executable. It became
  blocked/not_tested with failed Model provider preflight and no criterion proof.
  This is a controlled local provider-unavailable case, not a hosted outage claim.
- Unreachable website: Run `55d22906-6aea-437c-8996-2160072f2e45` became
  blocked/not_tested with failed Website reachable preflight. Both blocked Runs
  rejected candidate collection (409), retained history and released prepared
  reservations after explicit cleanup. No user's provider settings were changed.
  The temporary outage sidecar used an independent source/data root and was stopped.
- Real worker SIGKILL: unit Run `700c1b77-2182-4b4f-8cc6-0b54b116bf9f` entered
  its real test body before the exact owned sidecar was killed. The guardian
  released the stopped process group lease. After restart and the original
  90-second lease expiry, the shared Run became interrupted/not_tested with no
  fabricated framework result. Its dirty reservation remained held until explicit
  cleanup. Report `92f996cb-2aee-4f33-ab8d-be397ae08062` retains that outcome.
- Normal post-change RWA unit Run `1518c91f-c253-475c-9d1e-eca73676c64c` passed
  on Node 22.20.0 / Vitest 3.2.4: 54 tests, 44 passed, 10 skipped, 0 failed. Unit
  data was restored and both protected database hashes remained unchanged. Reader
  downloaded all report formats (`3673e09a-8303-4603-882b-924448ea3935`).
- Real revocation: the dedicated Reader's QA-project membership was captured,
  removed and restored exactly in finally. The same authenticated bearer then
  received 403 from report and proof endpoints, direct Storage denied bytes, and
  report rows were hidden by RLS. After restoration, the original proof SHA-256
  and access were verified again. No other project/member/session was changed.
- Storage outage/retry: retained new-project Run
  `f49ab001-249e-414f-b7bb-c6e8c15517b3` used a Storage-only transport fault
  against real bearer/RLS metadata. The first sync returned 503 and persisted a
  failed copy. Explicit HTTP retry reused copy
  `d4993880-e8f2-4ade-af52-a71f6592c2e3`, original checksum and expiry, synced
  both proof slots and verified their bytes. Original Run JSON stayed unchanged.
  This is scoped network fault injection; the computer's network was not disabled.
- Seeded privacy Run `306af9eb-7b34-4ea6-b7e4-ec9e3afb6bf1` used real Codex
  to dispatch an approved private input into a required browser-local field.
  Its deliberately private-state check remained uncertain, while Ready passed;
  overall uncertain is the expected privacy boundary, not a functional pass.
  Thirteen retained text artifacts, shared JSON and JSON/Markdown reports contained
  no synthetic test value. Inspected shared screenshot masks the complete input.
  The value was removed from the local vault and browser stopped. Report:
  `05a82e02-a6f4-4016-9557-94bfbe9875d3`.

Preflight and private-check harness assertions were corrected against actual DTO
semantics. Original blocked/uncertain records remain retained; they were not
silently rewritten or counted as replaced fixed-corpus samples. The original
six-sample browser corpus remains on the unchanged browser engine base documented
in DYNAMIC_RELEASE_EVALUATION.md; this process change affects local script workers.

## Reproduction and verification

Live harnesses under sidecar/__tests__/acceptance:

- releaseBlockedLive.ts: deliberately isolated unavailable-Codex sidecar on 37712
  and verified unused website port; normal owned sidecar stays on 37711. The outage
  service must use an independent source/data root, never a second writer to the
  primary sql.js file. Resume option rereads the original blocked Run.
- unitWorkerRecoveryLive.ts: requires explicit owned listener PID, verifies its
  command/cwd/port and entered-body marker before SIGKILL, then waits for server
  restart and the real lease expiry. Never supply another application's PID.
- accessRevocationLive.ts: administrator-only membership fixture operations remain
  separate from runtime bearer reads; exact restore is enforced in finally.
- evidenceOfflineLive.ts: actual AuthGateway, Supabase records, Storage transport
  injection, then normal HTTP retry. Needs an unsynced retained QA Run.
- seededPrivacyLive.ts/privateTarget.ts: independent public synthetic fixture on
  3018. No real credential or production account is used.
- accessExpiryLive.ts: a background acceptance job holds a genuinely issued Reader
  token in memory with auto-refresh disabled, waits for its actual expiry, verifies
  denied report/proof access, then explicitly refreshes and verifies access/hash.
  No global Auth setting is shortened and no token is forged or logged.

Sidecar TypeScript and 582 tests / 83 files passed after the process change. No UI
behavior or persisted-data schema changed in this checkpoint. Generated audits,
protected screenshots and exports remain ignored. Native UI/save remains pending
Mac unlock/automation availability. The real-expiry job is pending until
2026-10-14 21:44:34 UTC; it is not yet a passed gate.
