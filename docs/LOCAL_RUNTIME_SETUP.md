# Local Centinel runtime setup

Verified: 13 October 2026. This worktree is connected to the existing **Centinel**
Supabase project `xqktjoeuwyzgebsthxeh` in Singapore. No project was recreated.

## Local configuration

Repository-root `.env` is ignored by Git and has mode `0600`. Required values:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Public project URL/client key for the bearer-scoped sidecar |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Same public configuration for frontend Auth |
| `VITE_SUPABASE_AUTH_REDIRECT_URL` | Native callback `centinel://auth/callback` |
| `CENTINEL_TOKEN_ENCRYPTION_KEY` | Local generated encryption secret, server-only |
| `CENTINEL_CODEX_BIN` | Installed Codex executable |
| `CENTINEL_CODEX_LOCAL_AUTH_FILE` | Explicitly authorized desktop ChatGPT auth file |
| `CENTINEL_CODEX_LOCAL_AUTH_OWNER_ID` | One verified QA Auth UUID allowed to use desktop OAuth |
| `CENTINEL_SIDECAR_PORT`, `VITE_CENTINEL_SIDECAR_URL` | Matching local API endpoint override |

The current sidecar uses **37711**, because 37701 belongs to an unrelated local
service. Default installations still use 37701. Frontend JSON and evidence URLs
share the configured origin. For connector OAuth, update callback base/provider
registrations to the selected port before enabling those integrations; GitHub
repository, Drive and Slack integration credentials are not needed for the
current Web smoke acceptance and remain unset.

No service-role key, admin key, database password, access token or refresh token
is placed in `.env` or `VITE_*`. A public client key does not grant user access;
AuthGateway and Supabase RLS still require a real signed-in user.

## Authorized QA identity and model

The user authorized creating an additional account. A dedicated **Centinel Local
QA** account was created with a randomly generated password and synthetic email.
Its login values are stored only in `.env` as `CENTINEL_DEV_ACCOUNT_EMAIL` and
`CENTINEL_DEV_ACCOUNT_PASSWORD`. They are local development credentials, not
frontend configuration and not fallback runtime authentication. Sign-in always
uses Supabase Auth; scripts cannot replace AuthGateway with a supplied user ID.
Existing users/accounts were preserved. Administrator access was used only by
setup tooling to create this expressly authorized account; acceptance used the
QA user's normal bearer/RLS client.

Desktop OAuth is bound only to this QA UUID. Access tokens are read from the
explicit file, supplied to isolated app-server processes, and never saved in
Supabase or sent to the frontend. Desktop config/history/tools and refresh tokens
are not copied. Desktop Codex owns refresh. Disable the local binding variables
and restart to return to isolated browser sign-in.

The QA user's Dynamic model setting is `codex` / `codex-app-server`, model
`gpt-5.6-sol` as returned by this account's live catalog. No API key is required.
Other users' model settings were not changed.

## Remote changes accepted

`202610130001_dynamic_mission_run_foundation.sql` and, subsequently,
`202610130002_dynamic_run_recovery.sql` were each explicitly authorized and
applied transactionally. They add Mission/revision/Run tables and worker leases,
RLS/read grants and scoped mutation/recovery RPCs. Legacy tables/data were not
reset or deleted. CLI migration history records both versions as applied.
The local sidecar was restarted after the recovery migration.

A dedicated project named **Dynamic Local Acceptance 2026-10-13** was created
using the QA bearer. Its sign-in-page smoke Mission ran through real authenticated
HTTP → Supabase → Codex screenshot/action → Playwright → independent Checker.
The Run completed `passed` with two passed criteria and two evidence manifest
entries. Re-reading the record from Supabase confirmed durable state. Repeating
the same request returned the same Run; unauthenticated access returned 401 and
an unavailable project returned 403. Registered local screenshot retrieval passed.

Evidence record:
`/Users/kongjy/Documents/School/FYP/centinel-test-targets/evidence/live-supabase-mission-20261013.json`.
Screenshot/check files are on the executing device. This is not cloud evidence
upload or cross-device screenshot acceptance.

## Running locally

From this worktree:

```bash
pnpm --filter @centinel/sidecar start
pnpm --filter centinel exec vite --host 127.0.0.1
```

- Centinel browser development view: `http://127.0.0.1:1420`.
- Authenticated sidecar: `http://localhost:37711`; public `/health` only.
- Separate evaluation app: `http://localhost:3000` / API `3001`.

Use the local QA login variables from `.env` for Centinel's email/password form.
For the full native app, use the repository's Tauri workflow; browser setup does
not prove packaged callback or CLI-discovery acceptance.

## Live recovery acceptance

A dedicated infrastructure-only QA Run used the normal bearer/RLS repository.
No browser actions were submitted by this fault-injection test. Claiming and
renewing its lease succeeded; the authenticated sidecar preserved the healthy
worker after an actual sidecar restart. After heartbeat stopped and the lease
naturally expired, project access reconciled it to `interrupted` / `not_tested`.
Expired renewal and old-worker completion were rejected. Replaying the same key
returned that interrupted Run without execution; another read preserved its
recovery timestamp. Selecting the private fencing token was denied.

The first harness attempt hit the service's restart connection gap and was
cancelled/retried with explicit restart coordination. The coordinated acceptance
passed. Evidence:
`/Users/kongjy/Documents/School/FYP/centinel-test-targets/evidence/live-recovery-20261013.json`.
This verifies the live lease protocol and sidecar restart, not interruption of
an active LLM-driven browser action or cross-device evidence sharing.

After deploying recovery and restarting, another real authenticated Codex
sign-in-page smoke Run completed with two independently passed checks, two local
evidence entries and a recorded worker lease. Evidence:
`/Users/kongjy/Documents/School/FYP/centinel-test-targets/evidence/live-post-recovery-mission-20261013.json`.

The basic Mission/history UI also saved and started a real Codex smoke test,
loaded durable check results/local screenshots, and passed three viewport checks.

## Current acceptance status

This document's initial observations are dated 13 October. Later milestones
verified active browser cancellation/crash/restart, revoked membership, private
Storage, upload retry, broader Web tasks and packaged process launch. See
[DYNAMIC_RELEASE_CHECKLIST.md](DYNAMIC_RELEASE_CHECKLIST.md) for exact current
service/browser evidence and remaining native GUI/save and genuine-token-expiry
gates. API-provider live acceptance is user-deferred; third-party connector OAuth
and a second physical device are not claimed by the retained two-account tests.
