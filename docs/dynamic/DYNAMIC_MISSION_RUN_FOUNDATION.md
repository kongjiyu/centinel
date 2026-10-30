# Dynamic Mission / Run / Checker foundation

Implementation record: 13 October 2026. Scope: Mission/Run/Checker foundation,
worker recovery and a saved-test/history UI. Static supplies explicit mock input.

## Records and outcomes

A Mission is the reusable identity. Saving an edit creates a new immutable
MissionRevision. A Run pins the complete revision, its incoming mock context,
configured checks, actor and target URL. Editing the mission cannot alter an old
Run. Reusing an idempotency key returns the same Run; a different request using
that key is a conflict. One queued/running Run is allowed per project.

Execution state and check verdict are separate:

- State: `queued`, `running`, `completed`, `blocked`, `cancelled`, `interrupted`.
- Verdict: `passed`, `failed`, `uncertain`, `not_tested`.
- A completed Run can contain a failed or uncertain verdict. Provider/runtime
  outages and cancellation do not become confirmed application defects.
- Required checks determine the aggregate. Missing/duplicate required results
  cannot pass. Conclusive results without retained evidence become uncertain.
- Final state changes use compare-and-set. Cancellation wins over a late
  completion; completed Runs cannot be rewritten through the lifecycle API.

The independent checker supports exact URL, visible text and one visible CSS
selector match. Ambiguous selectors or unavailable observations are uncertain.
These checks cover terminal page state only: they do not yet prove intermediate
journey steps, backend side effects or broad usability outcomes. A visible text
match is not a complete login/payment verification by itself; configure the
appropriate combination and expand verification in subsequent slices.

## Storage and execution

Production uses `SupabaseDynamicRepository` with the verified caller's bearer/RLS
client. Apply [the additive migration](../../supabase/migrations/202610130001_dynamic_mission_run_foundation.sql)
through the project's deployment workflow. It creates three new tables and
membership-scoped reads, immutable revisions, actor-bound mutation RPCs,
atomic start idempotency and an active-project uniqueness constraint. No runtime
service-role key, cloud-to-local fallback or legacy-data deletion is introduced.
The migration was tested on isolated PostgreSQL and subsequently applied to the
existing Centinel Supabase project with explicit user approval on 13 October.

The new route handler uses the existing AuthGateway. The browser bridge adapts a
Run into a legacy local Dynamic session, retaining its ID for cancellation and
local evidence access. When the model proposes either terminal result, the
independent checker determines the Mission Run verdict. This path does not use
the legacy failed-goal finding with fixed confidence/severity. Old session routes
remain compatible; their older verdict behavior is not retroactively upgraded.

Evidence includes SHA-256 hashes and local availability. The registered legacy
evidence IDs match the Run manifest IDs. Files remain local and are readable
through existing authorized evidence routes on the executing device. There is no
claim of private cloud upload, second-device availability or tamper-proof storage.

`InMemoryDynamicRepository` is explicitly injected only in tests/development.
It does not substitute for Supabase when runtime configuration is missing.

## Worker recovery

[Recovery migration](../../supabase/migrations/202610130002_dynamic_run_recovery.sql)
adds database-clock worker leases, heartbeat and recovery RPCs. It was applied
to Centinel Supabase with explicit user approval on 13 October 2026, after local
SQL verification. Migration history records `202610130002` as applied; RLS and
all three new RPCs were verified, then the local sidecar was restarted.

Claiming a queued Run atomically attaches a process identity and private token.
Workers renew a 60-second lease every 15 seconds. Finalization requires the
unexpired token, so a delayed worker cannot overwrite an interrupted Run. Project
members can still cancel. Read/list/start requests reconcile expired work within
the authenticated project; healthy workers on other devices remain active.
Recovery runs on the first project access after startup, not an unauthenticated
global startup sweep. Abandoned queued work expires after 90 seconds; historical
unleased running work has a six-minute grace period. All deadlines use database
time. Recovery retains revision, check/evidence metadata and legacy session ID,
records `interrupted` / `not_tested`, and never automatically replays actions.
An explicit rerun creates a new Run with a new request key.

Live QA-bearer acceptance verified claim/heartbeat, healthy preservation across
an actual sidecar restart, natural lease expiry, interruption reconciliation,
expired renewal/old completion rejection, immutable recovered history and
idempotent replay without execution. This was an infrastructure-only Run with
no browser actions; active browser/provider crash coverage remains pending.
See [runtime acceptance](../LOCAL_RUNTIME_SETUP.md).

## Saved-test and history UI

Dynamic Testing navigation opens the project's saved-test workspace. Users can
write manual criteria or explicitly select mock requirement criteria, save an
immutable revision, start/stop work and inspect history. Execution state and
verdict remain separate. An earlier revision's pass cannot validate an edited
test. Lost start responses reuse the same request key on retry. Project-scoped
polling discards stale responses when the project changes.

Independent checks, observations and authenticated local screenshots appear in
the selected Run. Advanced identifiers are disclosed on demand. Missing screenshots
on another device are labelled unavailable rather than implying cloud sharing.
The UI was inspected at 1440×900, 1200×900 and 390×844 with no document overflow;
real QA-bearer history and local evidence loaded, and Review navigation retained
its separate styles. A test saved and started through the UI also completed via the configured
Codex provider with an independent passed check persisted in Supabase. These
browser checks used the existing live foundation backend; they do not establish
live recovery acceptance.

## HTTP contract

All paths are relative to the authenticated local sidecar. Project membership is
checked before body processing or repository access.

| Method / path | Purpose |
| --- | --- |
| `GET /projects/:projectId/dynamic/missions` | List Mission identities/current revision IDs |
| `POST /projects/:projectId/dynamic/missions` | Create Mission and first revision |
| `POST /projects/:projectId/dynamic/missions/:missionId/revisions` | Create an immutable edited revision |
| `GET /projects/:projectId/dynamic/revisions/:revisionId` | Read a scoped revision |
| `GET /projects/:projectId/dynamic/runs` | List Run history |
| `POST /projects/:projectId/dynamic/runs` | Start a revision using an idempotency key |
| `GET /projects/:projectId/dynamic/runs/:runId` | Read state, verdict, checks and evidence manifest |
| `POST /projects/:projectId/dynamic/runs/:runId/cancel` | Stop an active Run and abort its attached local executor |

Example Mission body:

```json
{
  "name": "Seeded login",
  "goal": "Sign in and inspect the authenticated home page",
  "targetUrl": "http://localhost:3000",
  "maxSteps": 15,
  "contextScenario": "normal",
  "contextAcknowledged": false,
  "checks": [{
    "id": "home-url",
    "criterionId": "MOCK-RWA-AUTH-01-C1",
    "description": "Authenticated home URL",
    "kind": "url",
    "expected": "http://localhost:3000/",
    "required": true
  }]
}
```

`contextScenario` explicitly loads synthetic input. It never activates silently
on a live-service error. Store the returned revision ID, then POST a Run body
`{"revisionId":"<returned UUID>","idempotencyKey":"<unique request key>"}`.
Runtime provider settings must be configured before a new Run starts. Idempotent
replays do not require a fresh successful provider preflight. Browser credentials
are not part of Mission context; automated credential injection remains P2 work.

## Repeatable development acceptance

With the local RWA running, execute from Centinel root:

```bash
pnpm --filter @centinel/sidecar exec tsx src/dynamic/testing/baseline.ts \
  http://localhost:3000 /absolute/path/to/baseline-evidence
```

This uses an explicit in-memory repository and real Playwright observations.
It creates one Mission with a passing authenticated-home Run and a deliberately
failing post-sign-out Run, plus synthetic blocked/cancelled cases. Results and
hashed screenshots are saved in `baseline.json` and per-Run directories.
It is a scripted foundation demo, not autonomous LLM or live Supabase acceptance.
The password default is the public upstream test fixture; optional local
`CENTINEL_RWA_USERNAME`/`CENTINEL_RWA_PASSWORD` override it and are not persisted.

Tests include service/checker/route contracts, authenticated HTTP access denial,
model terminal proposals that disagree with checks, and SQL lifecycle/RLS checks.
For SQL, use a disposable PostgreSQL database, load the explicitly test-only
[bootstrap](../../sidecar/__tests__/fixtures/dynamicPostgresBootstrap.sql), apply the
migration, then run [the SQL test](../../supabase/tests/dynamic_mission_run_foundation.sql).
Never load the bootstrap in a deployed Supabase project. A separate two-connection
local test also confirmed one fresh start plus one replay under concurrency.

## Remaining P1 gates

- Broader live Supabase/member acceptance and API journeys. One real
  QA-bearer Codex smoke Mission passed; see [runtime setup](../LOCAL_RUNTIME_SETUP.md).
- Broaden live worker recovery acceptance to active browser/provider failure and
  a second device. Local SQL tests cover healthy workers, expired-token fencing,
  member isolation and immutable recovered history.
- Shared private evidence upload/recovery and local retention policy.
- Browser credential references and environment/test-data lifecycle (P2).
- Cross-path legacy/new execution coordination; the new active-run constraint
  applies to new Run records, not every historical legacy-session start.
- Full action/origin enforcement, secret redaction and richer check coverage.

This is a foundation slice, not completion of P1 or release acceptance.

Latest local checks: 363 sidecar tests, 179 frontend tests, frontend build,
sidecar TypeScript and recovery SQL acceptance passed. The frontend retains its
large-chunk build warning. SQL recovery tests are transactional and roll
back their fixtures; the test bootstrap must never run against hosted Supabase.
