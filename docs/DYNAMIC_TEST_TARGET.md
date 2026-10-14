# Dynamic evaluation target: Cypress Real World App

Selection date: 7 October 2026. Updated: 13 October 2026. Status: local target
running; browser and unit baselines verified. Bounded Codex/QA-bearer Supabase
smoke and equivalent read-only repeat acceptance passed. Broader journeys, API
mode and seeded defect evaluation remain pending.

## Repository and pinned baseline

- Repository: [cypress-io/cypress-realworld-app](https://github.com/cypress-io/cypress-realworld-app).
- Inspected default branch: `develop`; pin commit
  `9dfcb9869533ce8a8963c556facc0d80457f9d39` for the first baseline.
- [MIT license](https://github.com/cypress-io/cypress-realworld-app/blob/9dfcb9869533ce8a8963c556facc0d80457f9d39/LICENSE).
- [Pinned setup documentation](https://github.com/cypress-io/cypress-realworld-app/blob/9dfcb9869533ce8a8963c556facc0d80457f9d39/README.md).

This educational payment application provides a realistic local full-stack target
with seeded users and a JSON-backed database, without an external database
service. It offers more stateful testing opportunities than a single-page todo
example. These characteristics make it our first target, not evidence of broad
coverage across arbitrary applications. See the upstream [project overview](https://learn.cypress.io/real-world-examples/cypress-real-world-app-overview).

Its name does not require Centinel to execute Cypress. Centinel drives the
application with Playwright; upstream tests are a baseline reference. Existing
unit tests use Vitest, matching our initial P6 adapter. Verify the exact scripts
in the [pinned package.json](https://github.com/cypress-io/cypress-realworld-app/blob/9dfcb9869533ce8a8963c556facc0d80457f9d39/package.json).

## Setup plan

Keep the external checkout outside the Centinel pnpm workspace. Do not vendor its
source, dependencies, lockfile or generated database into Centinel. Record the
absolute target workspace in the environment profile when installed.

1. Clone the external repository to a separate evaluation workspace and check out
   the pinned commit. Record any patches, runtime version and lockfile state.
2. Use its pinned runtime: `.node-version` specifies Node `22.20.0`.
   Upstream specifies Yarn Classic `1.22.22` and uses Yarn internally in scripts.
   This is an external-target prerequisite, not a change to Centinel's pnpm tooling.
   Do not convert either repository's lockfile or globally install tools as part
   of this selection task. Installation remains a distinct setup step.
3. Follow the upstream platform setup instructions and frozen lockfile. Use local
   authentication, not the optional external identity-provider configurations.
4. Start the local application with its `dev` script. Default frontend/API ports
   are `3000` and `3001`; reserve both and verify actual bindings before testing.
5. Select a seeded user from the target's development-user listing. Resolve test
   credentials locally; do not embed them in incoming context or model prompts.
6. Run a manual login/payment/logout baseline and existing unit tests before
   scoring Centinel. Capture the actual running target version separately from
   the checked-out source commit.

The target's `test` script opens Cypress; it is not the unit-test entrypoint.
P6 should invoke the existing `test:unit:ci` script with supported Vitest JSON
reporter arguments via explicit executable/arguments, then verify the parsed
counts against raw output. No browser interaction substitutes for unit results.

## Initial scenario matrix

These are planned cases, not claims that defects already exist upstream. Confirm
actual labels, locators, outcomes and seed accounts on the installed baseline.

| Case | Intended Dynamic verification | Data / expected evaluation outcome |
| --- | --- | --- |
| RWA-01 | Sign in and sign out | Seeded local account; protected-page/auth checks |
| RWA-02 | Invalid login | Deliberately incorrect credentials; visible rejection without an authenticated session |
| RWA-03 | Payment form validation | Incomplete fields; verify submission cannot create a transaction |
| RWA-04 | Create and inspect a local payment | Seeded sender/recipient and unique `qa_<runId>` note; verify recorded amount/note |
| RWA-05 | Saved-mission regression | Repeat RWA-03/04 on a recorded target version; retain independent results |
| RWA-06 | Bounded exploratory run | Selected transaction/account screens; disclose visited and unvisited scope |
| RWA-07 | Usability checks | Keyboard reachability, labels, focus and error feedback on login/payment; suggestions remain provisional |
| RWA-08 | Controlled seeded defect | Local patch changes one validation behavior; preserve patch and verify a failed criterion |
| RWA-09 | Blocked/interrupted run | Stop local API or disconnect provider; expect blocked/interrupted, not a confirmed app defect |
| RWA-10 | Existing unit suite | Passing baseline, local failing-test variant, invalid runner and cancellation outcomes |

RWA-04 uses fictional local payments only. Upstream mutations may not support
per-record deletion; do not assume a generic CRUD cleanup flow. Use a dedicated
single-run target instance or a serialized, explicitly configured baseline reset.

### Isolated release instance

M4h1 extracted the pinned commit into a separate `rwa-dynamic-release-20261014`
evaluation directory with its own database, Vite cache and ports 3014/3015. The
primary instance on 3000/3001 stays running and is not reseeded or mutated. Real
Codex correct/incorrect-password checks and the recorded login bypass defect
were verified there; authentication source was restored afterward. See
[private input/authentication acceptance](DYNAMIC_BROWSER_CREDENTIALS.md) for
exact Run IDs, isolation evidence, retained patch and remaining release gates.

## Repeatability and evaluation ground truth

Application startup reseeds the development database. The upstream
[test-data router](https://github.com/cypress-io/cypress-realworld-app/blob/9dfcb9869533ce8a8963c556facc0d80457f9d39/backend/testdata-routes.ts)
also exposes a seed operation. Both affect shared test state: never restart or
reset an instance while another run uses it. A reset is an explicitly configured
local-target operation, not a default cleanup action or an agent-chosen command.
Keep Centinel's own database/evidence outside this target lifecycle.

Freeze the source commit, seed-file checksum, accounts, profile, browser,
mission/context revisions and provider/model before evaluation. Preserve
baseline/defect/fixed variants as separate patch records; demonstrate the defect
manually or with an independent scripted check. Do not feed ground-truth labels
or fix instructions to the agent being evaluated. A missing field or changed
selector is not sufficient proof of a functional defect.

## Next setup acceptance record

Record workspace path, runtime/package-manager versions, install result, ports,
seed checksum, manual scenario outcomes and Vitest counts. Then run one real
Centinel journey per selected provider and retain evidence. Until this is done,
target suitability is source-based and its live acceptance remains pending.

## Local baseline verified on 13 October 2026

Checkout: `/Users/kongjy/Documents/School/FYP/centinel-test-targets/cypress-realworld-app`.
Source remains at `9dfcb9869533ce8a8963c556facc0d80457f9d39`; only the runtime
JSON database changed during tests. Runtime: Node **22.20.0**, Yarn **1.22.22**.
Dependencies were installed with the available Node 22.23.1, using the frozen
upstream lockfile, and the server/unit baseline ran on the pinned 22.20.0 runtime.
Cypress binary download was skipped because this baseline uses Playwright and
Vitest; no Cypress E2E suite was run.

- Frontend: `http://localhost:3000`; backend: `http://localhost:3001`.
- Upstream Vitest: **44 passed, 10 skipped, 0 failed** (54 total tests).
- Wrong-password login: rejected with visible invalid-credentials feedback.
- Seeded valid login: authenticated home and Account Balance observed.
- Payment without an amount: validation message and disabled Pay/Request buttons.
- Valid local payment: submitted $2.00 with `qa_baseline_20261013`; confirmation,
  Personal history entry and exactly one persisted transaction of 200 cents verified.
- Sign-out: protected `/transaction/new` redirects to `/signin`.
- Independent Checker demo: one Mission, two real-browser completed Runs
  (`passed` and deliberately `failed` after sign-out), plus synthetic cancelled
  and provider-blocked cases. No model/provider was called in this demo.

Seed-file SHA-256:
`694f9f9e955211cc6037a1d58eb020671375491ea670a3fcf6183a81a34da715`.
The current working database contains baseline test mutations. It is not a
frozen evaluation dataset; the next controlled setup/start must restore the
recorded seed once no Run uses the instance.

Local evidence is under
`/Users/kongjy/Documents/School/FYP/centinel-test-targets/evidence/`:
`payment-history-20261013.png`, `dynamic-baseline-20261013/baseline.json`,
per-Run screenshots/check results, `upstream-unit-baseline-20261013.json`, and
`postgres-concurrency-20261013.json`. Generated evidence is outside Centinel Git.

Observed upstream warnings: legacy XState transition syntax, SVG property names,
Vite configuration migration notice and an outdated Browserslist dataset.
The incorrect-login request also produced its expected HTTP authentication error.
These observations did not prevent the inspected workflows; they are baseline
notes, not automatically confirmed findings. The skipped unit tests are unverified.

To start this target again in its checkout (startup restores development seed):

```bash
PATH=/Users/kongjy/Documents/School/FYP/centinel-test-targets/runtime/node-v22.20.0-darwin-arm64/bin:$PATH corepack yarn dev
```

See [Mission/Run foundation](DYNAMIC_MISSION_RUN_FOUNDATION.md) for the scripted
Checker demo and current runtime limitations.
