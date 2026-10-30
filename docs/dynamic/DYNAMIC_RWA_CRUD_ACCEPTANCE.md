# RWA CRUD real-provider acceptance

Authority: DESIGN.md → Centinel_PRD_Revised.md → DEVELOPMENT_PLAN.md.
M4h2 verifies normal CRUD and a seeded persistence defect with real Codex.
Static supplies no implementation here. API-provider live acceptance is user-deferred.

## Reproduce

Use the isolated RWA copy and direct servers described in
[DYNAMIC_BROWSER_CREDENTIALS.md](DYNAMIC_BROWSER_CREDENTIALS.md), pinned to
`9dfcb9869533ce8a8963c556facc0d80457f9d39`, frontend/API ports 3014/3015.
Keep its own database and Vite cache; never reseed the primary 3000/3001 target.
The harness refuses a missing isolation marker or the same real database path.

Set these local environment variables without committing their values:

- `CENTINEL_RWA_EVALUATION_ROOT`: owned isolated target directory.
- `CENTINEL_RWA_PRIMARY_DATABASE`: primary target database path, read only for hashing.
- `CENTINEL_RWA_QA_PROJECT`: the authenticated account's QA project UUID.
- `CENTINEL_RWA_USERNAME` / `CENTINEL_RWA_PASSWORD`: fictional isolated target user.
- `CENTINEL_DEV_ACCOUNT_EMAIL` / `CENTINEL_DEV_ACCOUNT_PASSWORD`: Centinel QA login.
- `CENTINEL_RWA_BANK_ID`: active synthetic account from the create audit, for read/delete.
- Optional `CENTINEL_RWA_SIDECAR_URL`: defaults to localhost:37711.

With Node 22 and installed pnpm dependencies, from repository root:

```sh
node --env-file=.env sidecar/node_modules/tsx/dist/cli.mjs sidecar/__tests__/acceptance/rwaCrudLive.ts create normal
# Set CENTINEL_RWA_BANK_ID from the local create audit before these cases.
node --env-file=.env sidecar/node_modules/tsx/dist/cli.mjs sidecar/__tests__/acceptance/rwaCrudLive.ts read normal
node --env-file=.env sidecar/node_modules/tsx/dist/cli.mjs sidecar/__tests__/acceptance/rwaCrudLive.ts update normal
node --env-file=.env sidecar/node_modules/tsx/dist/cli.mjs sidecar/__tests__/acceptance/rwaCrudLive.ts delete normal
```

These are explicit online acceptance commands, excluded from the offline Vitest
suite. Run cases sequentially. Each freezes a profile/mission, reserves the shared
resource, imports a device-local session, and grants only required controls.
Creation/update/delete require one dispatched click; reading grants no writes.
Independent URL/text/field checks determine the verdict. The harness compares all
pre-existing tables/rows, allowing only the declared mutation, hashes the primary
DB, checks retained logs for password/cookie leakage, records cleanup and forgets
the imported session. Mutations remain auditable in the disposable copy.

If a check or connection fails, retain the Run and inspect its actual terminal
state and database before cleanup. Do not rerun an uncertain write. Local audits
are under ignored `output/playwright/rwa-<mode>-<variant>-live.json`; do not publish
raw sessions or credentials.

## Seeded defect

Apply [the profile no-op patch](../acceptance/evaluation/rwa-profile-update-noop.patch) only to
the owned copy's `backend/database.ts`. Restart only its API directly, without
prestart/reset commands. The patch preserves the previous First Name while
returning the ordinary successful response. Run `update defect`; independent
navigation and a `field_value` check must fail despite the model finishing.
Restore the exact original source and restart the API afterwards.

The scripted browser control confirmed HTTP 204 with the old persisted value.
Real Codex Run `380dddca-3df5-4e5a-babb-3e9fc4118ae2` completed with verdict
`failed`, one submit, no unrelated table changes, and unchanged primary DB.
The environment was cleaned and its imported session forgotten.

An earlier attempt lost its sidecar connection after Run creation. Run
`fd6b847a-9f8b-4a06-80d7-6b2a292a0cc9` was retained as `interrupted` after expired
lease recovery. Data was inspected and cleanup recorded before a new Run. This
observation is not a controlled active-browser crash/restart release gate.

## Scope and remaining gates

Normal creation/read/soft-delete use an owned synthetic bank account. Update
changes only the fictional user's First Name and checks persistence after leaving
and returning to settings. Bank deletion in upstream RWA is a soft delete.
No payments, balances or unrelated accounts are modified.

This milestone does not complete P4 or the release: controlled active browser
cancellation/crash, finding lineage, M5–M7, and packaged Centinel launch remain.

A repeated delete attempt, Run `241b6ae5-aabb-4e3f-a17a-c7bbf46647d7`, was
blocked before dispatch because the model supplied a CSS selector as `elementRef`
instead of an observed reference. Its trace had no dispatched click; the bank
remained active. The original blocked result is retained, cleanup was recorded,
and a fresh revision explicitly instructed use of observed references. It is not
counted as a successful CRUD case or silently retried within the same Run.

The next attempt, Run `c8fa3f0f-288a-4bba-9ff0-9598838d1871`, exposed a real
observer limitation: repeated `Delete` buttons fell back to an ambiguous role/name
binding. It was blocked before dispatch and retained. Observation now tries up to
five nearby ancestors with a globally unique test attribute or ID, then verifies
the combined row/control selector identifies that exact element. It never uses a
positional selector. Dispatch and policy still require current uniqueness and the
explicit approved control. A Chromium test verifies the intended row is clicked
once and a newly duplicated row is rejected before another dispatch.

## Normal acceptance retained after the stronger data audit

| Case | Real Codex Run | Independent result |
| --- | --- | --- |
| Create | `3d57eed7-ac6d-4a65-9a41-62844d3a6d89` | Passed visible created name and bank-list URL; one added owned row |
| Read | `bb92002b-54a6-4d62-a077-5d191b5b264a` | Passed visible owned account; no clicks or data changes |
| Update | `f92216a9-dca0-4d62-b3d4-0a4b2a54863a` | Passed persisted First Name after independent navigation; one Save |
| Delete | `bdc29244-003b-41a6-9347-59aa966f6ac2` | Passed deleted label and database soft-delete; one Delete |

Every listed case passed the unrelated-table comparison and primary DB SHA-256
check, then recorded cleanup and forgot its imported session. The original normal
four cases also remain in durable Run history. A first scripted profile baseline
reused an existing value and was insufficient to prove a changed value; the
unique-name real update cases above provide the persisted-change proof.

Validation: all 519 sidecar tests (72 suites), sidecar TypeScript, explicit online
harness typecheck and diff checks passed. No UI or schema changes in this slice.
