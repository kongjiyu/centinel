# Dynamic environment profiles and preflight

Milestone M2a, 13 October 2026. This delivers reusable conditions and read-only
preflight, not the complete P2 preparation/cleanup lifecycle.

Profiles are project-member metadata in bearer-scoped Supabase. They contain
website, allowed-origin configuration, viewport, account-role/preparation note,
required variable names, manual startup instructions and target version. Saving
creates an incremented profile version. Every new environment-backed Run freezes
the database-owned profile and sanitized preflight conditions. Later profile
edits do not rewrite historical Runs. A changed profile version during preparation
rolls back a new start; idempotent replay preserves the original snapshot.

Variables are encrypted with the existing AES-GCM token vault key in device-local,
owner/project/profile-scoped files under generated data/. Writes use mode 0600
and atomic rename. The values endpoint returns names only; an empty value removes
a name. Missing/unreadable values fail closed. Values are not supplied to the
model, shared profile, Run DTO or screenshot. Known local values in shared fields
are rejected. Do not enter passwords in profile notes or test goals.

Variables currently establish prerequisites only. Browser authentication/session
injection is a separately controlled follow-up. An account-role note is not proof
that a browser is authenticated. No environment command is automatically run.
Startup instructions are explicit manual text; inspection of authorized target
workspace templates and approved hooks comes with the preparation lifecycle.

Preflight checks declared names, provider readiness and a bounded HEAD request.
It does not follow external redirects; it does not equate an HTTP authentication
response with a passing journey. Failed preflight records a blocked/not-tested Run
without starting a browser. Successful preflight is still provisional: execution
and independent checks determine the result. API-provider readiness means its
configuration is available; live API capability acceptance remains a P0/P7 gate.
The configured viewport is passed to Playwright. Broad browser origin/action
policy remains P4; profile configuration alone is not its acceptance.

## Interfaces

All paths require normal AuthGateway/project membership:

- GET/POST `/projects/:projectId/dynamic/environments`
- POST `/projects/:projectId/dynamic/environments/:id` — new profile version
- GET/POST `/projects/:projectId/dynamic/environments/:id/values` — names/write-only values
- POST `/projects/:projectId/dynamic/environments/:id/preflight`
- POST `/projects/:projectId/dynamic/runs` may include `environmentId`.

Legacy/manual Runs remain compatible when environmentId is omitted. Reusing a
request key with a different profile, actor or revision is rejected. Run replay
works after profile edits without rerunning preflight or browser work.

Migration `202610130003_dynamic_environments.sql` was applied transactionally
under the user's continuous milestone delivery authorization, after two isolated
applications and SQL acceptance. Bootstrap fixtures were never applied remotely.
The environment table has member RLS; mutation and snapshot creation use guarded
RPCs with no runtime service-role key.

## Retained acceptance

- Eight focused backend environment tests: validation, encryption, file mode,
  owner/project/profile isolation, missing config, redirect checks, immutable
  snapshots, authorization-before-read and decoded secret detection.
- Full sidecar suite: 371 tests; sidecar TypeScript passed.
- Frontend: 182 tests; production build; three viewport checks (1440×900,
  1200×900 and 390×844). The existing large-chunk warning remains.
- SQL member/nonmember access, secret-field whitelist, immutable historical
  environment, old-key replay and stale-version transaction rollback passed.
- Real UI QA flow: save profile; missing variable blocked; save local value;
  preflight ready; real Codex browser Run passed; edit profile v2; Run retained v1.
  Names-only UI displayed no seeded value. Live HTTP also rejected known local
  values before shared profile/Mission writes, preserved replay after a profile
  edit and denied mismatched environment/unauthenticated requests. Local report:
  `output/playwright/environment-ui-acceptance.json` (generated/ignored).

Remaining P2: target workspace declaration/template comparison, preparation and
cleanup records, exclusive dirty-data locks, bounded explicitly approved hooks,
credential/session references and seeded-secret redaction in actual browser/hooks.
