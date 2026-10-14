# Dynamic setup, demo and recovery guide

Use with LOCAL_RUNTIME_SETUP.md and DYNAMIC_RELEASE_CHECKLIST.md. Final native/JWT gate evidence is in DYNAMIC_RELEASE_EVALUATION.md.

## Setup

1. Use the pnpm version declared by packageManager and run `pnpm install`.
2. Configure repository-root ignored `.env` (0600): public Supabase URL/anon key,
   corresponding public VITE auth values, server-only encryption key, installed
   Codex executable and matching sidecar/frontend endpoint. Follow
   LOCAL_RUNTIME_SETUP.md; never use a service-role key or VITE secret.
3. Sign into Centinel with a Supabase application account. In Settings connect
   Codex, choose a catalog model and save it for Dynamic. Codex connection and
   application sign-in are separate. The optional expressly authorized local
   desktop binding must identify exactly one Centinel owner and server-only auth
   file; desktop Codex owns token refresh. No API key is needed for Codex mode.
4. Prepare a separate authorized Web target at the commit in DYNAMIC_TEST_TARGET.md.
   Keep primary, browser and unit data independent. Do not reset another running
   target's DB. Start its frontend/backend and inspect its initial state.
5. Start the sidecar using `pnpm --filter @centinel/sidecar start` and the frontend
   using `pnpm --filter centinel exec vite --host 127.0.0.1`. Use `pnpm dev` for
   the full local Tauri workflow only when its ports are available. This acceptance
   uses sidecar 37711 and browser UI 1420 because 37701 is another application's
   service. Match `.env` endpoints; don't kill another application's listener.
6. For native local build use `pnpm build`. The current desktop requires the
   separately configured local sidecar; a build is not a bundled installation
   readiness claim. Native launch/save acceptance and its startup interventions are recorded in the checklist.

## Demo a verified journey

1. Create/select the shared project. Add a Run environment with exact target,
   allowed frontend/API origins, viewport, declared version, budgets and independent
   data resource. Add required private values locally; ordinary fields hold names
   and references only. Inspect and authorize a workspace only if hooks/unit tests
   are needed; no suggested command executes automatically.
2. Select an explicit mock snapshot, choose one criterion and review the generated
   mission. Confirm mock-static provenance and a supported independent check. A
   manual mission can omit context. Save to create an immutable revision.
3. Record manual preparation with a verified baseline, or run already authorized
   setup. Review preflight. Start once; inspect the separate execution state,
   verdict, required checks, proof availability and frozen environment/source.
   A model's terminal declaration is not a pass.
4. Use the retained seeded-defect fixture to demonstrate a failed independent
   check or a declared usability violation. Collect a candidate, inspect expected
   versus actual result and reproduction evidence, then record an attributable
   confirm/reject/investigate decision. Label operator QA simulations accurately.
5. After an explicitly verified fix and preparation, run a pinned regression.
   Inspect both Runs and condition changes, then explicitly record remediation.
   Do not edit old checks or declare an unrelated pass proof of the fix.
6. Stop and clean up every prepared data resource. Successful execution can still
   require cleanup. Failed cleanup blocks reuse until explicit verified recovery.
7. Sync allowed evidence. As a second authorized member inspect shared results,
   finding history and proofs. Create an immutable report; export JSON/Markdown/PDF
   through authenticated downloads and checksum verification. Unsynced, expired
   or local-only artifacts remain visibly unavailable to the other member.
8. For existing unit tests use Run environment → Manage environments and local
   values → Existing unit tests. Inspect/authorize a standalone Vitest command in
   an independent workspace; prepare data and execute. Show counts/cases/logs,
   command/framework/version, exit outcome, cleanup and separate unit report.
   Unit suite outcomes do not satisfy browser criteria.

## Recovery

- Missing configuration/provider/website: inspect failed preflight and fix the
  declared prerequisite. The blocked attempt stays in history; start a new Run
  after preparation. Do not promote it to a tested pass.
- Cancellation: request Cancel, wait for worker acknowledgement and inspect
  partial proof/state. Then inspect cleanup requirements. Do not replay uncertain
  non-idempotent submissions.
- Lost worker/browser: restart the owned sidecar, allow the original lease to
  expire and read the project to reconcile interruption. Old worker completion is
  fenced; recovery does not replay browser actions. Verify actual stopped processes
  and target state before cleanup/repreparation.
- Busy local workspace: wait for active authorized command and guardian release.
  A corrupt/leftover private process lease fails closed. If worker and guardian
  are both gone, inspect exact owner/process group and physical workspace before
  manual recovery. Never delete every lock or infer data cleanliness from its age.
- Upload unavailable: retain local proof and failed sync receipt. Retry when
  transport returns; original copy identity, checksum and expiry remain fixed.
  Retry does not extend retention. Other members cannot retrieve unsynced bytes.
- Membership revoked/expired auth: access is denied. Renew a legitimate session
  or ask the actual project owner to restore membership; no auth bypass. A restored
  membership does not retroactively make prior denied access succeed.

## Reproducing evidence safely

Acceptance scripts are explicit operator tooling, not production background jobs.
Use only the dedicated QA/Reader configuration and owned synthetic/isolated targets.
Review each harness's prerequisites before running; some mutate isolated fixtures,
revoke/restore one exact membership or SIGKILL an explicitly verified owned PID.
Never rerun a fault harness against primary data. accessExpiryLive.ts must finish
its original genuine token wait rather than repeatedly minting replacement tokens.
Use the release protocol's fixed samples for metrics; additional debugging Runs
are retained but do not replace declared samples. Preserve ignored audit artifacts
and link exact Run/report IDs in the implementation record.
