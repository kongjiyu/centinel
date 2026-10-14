# Private browser inputs and RWA authentication acceptance

Authority: DESIGN.md → Centinel_PRD_Revised.md → DEVELOPMENT_PLAN.md.
M4h1 supplies private value references and real normal/negative/defective login
acceptance. CRUD, active cancellation/crash gates and M5–M7 remain required.

## Operator workflow and contract

Save required variable names in an environment, enter their values in **Local
variables**, then open **Private browser inputs**. Explicitly approve a variable
name for one unique field and one already-allowed website origin. Passwords and
other values remain encrypted on the executing account/device. The planner sees
only public variable references and uses `type_secret`; it cannot supply a value
or a local file path for this action.

The executor verifies the actual origin, unique visible/enabled fillable input
and frozen selector/variable grant before resolving a value. Missing references,
wrong variables, other origins and ambiguous controls are blocked. Values are
captured privately in memory during Run preparation and injected only into approved
inputs. They are never stored in shared profiles, Run payloads or model prompts.
Changes/removal affect future Runs; stop a current Run to withdraw its execution
approval. Local variable storage has the existing explicit-removal lifecycle;
this feature does not claim a new credential expiry policy.

Private selectors are masked from the first DOM/visual observation. Known values
join the existing recursive log/report redaction boundary before dispatch. Trace
receipts record the variable name, selector and dispatch outcome, never its value.
An already-matched input is observed without another input event. A lost fill
acknowledgement stops execution without retrying. Independent page checks verify
login outcomes rather than inspecting a private password field or trusting a
model's terminal declaration. Ordinary typing permissions remain a separate grant.

`202610140016_dynamic_private_inputs.sql` adds bounded optional reference grants,
origin/required-name validation, versioned edits, exploratory action support and
fresh-Run private-input protocol version 1. Existing policies and replay payloads
remain compatible. Private RPC helpers are revoked. Scalar-invalid policy inputs
retain their rejected-input contract. The migration passed isolated suites and
preserved-data upgrade checks and was applied/registered to Centinel Supabase.

## Isolated target and evaluation ground truth

The primary Cypress Real World App on ports 3000/3001 remains untouched. A separate
copy at `centinel-test-targets/rwa-dynamic-release-20261014` was extracted from pinned
commit `9dfcb9869533ce8a8963c556facc0d80457f9d39`, with its own database and ports
3014/3015. Installed dependencies are reused; its Vite cache is separate. The API
and frontend are launched directly with Node 22.20.0, without upstream prestart
scripts or reseeding the existing target.

A scripted browser baseline confirmed correct sign-in and invalid-password
rejection before Codex evaluation. The rendered rejection message differs from
the backend error string. An initial test used the backend wording and failed its
configured check; that Run remains intact. Its values were removed and cleanup
recorded before a new test used the actual rendered message. This is a corrected
expectation, not a confirmed application defect or an overwritten historical result.

The deliberate [login bypass patch](evaluation/rwa-login-bypass.patch) changes only
the disposable copy's password-validation branch to accept an incorrect password.
A separate browser baseline confirmed the defect before the Codex Run. The patch
was then removed, restoring the exact original authentication source. The normal
copy is retained for subsequent isolated CRUD acceptance.

## Retained evidence

- Correct login Run `1f273556-3e7a-43f9-a939-15a3cda7a2e9`: passed authenticated
  home URL and logout visibility checks.
- Normal invalid-password Run `fc5d664e-3b3f-4e52-a6aa-afbbfb74c817`: passed
  sign-in URL and rendered rejection-message checks.
- Seeded login defect Run `fd950a5a-8712-4e9a-b781-fef58e296772`: failed those
  independent rejection checks, despite reaching an authenticated page.
- Each real Codex Run used two private-reference fills and one sign-in click.
  Retained JSON/Markdown and shared Run payloads excluded the username/password
  values. Preparation/cleanup recorded, local values removed and primary target
  database SHA-256 stayed identical.
- 518 sidecar tests, 221 frontend tests, TypeScript/build, twenty-one Dynamic SQL
  suites and retained-data upgrade fixture passed. Build retains its known chunk
  warning. Chromium module tests cover actual input/origin checks, missing/wrong
  variables, protected observations, matched-value skips, cancellation and one
  dispatch after lost acknowledgement.
- Actual private-input UI inspected at 1440×900, 1200×900 and 390×844 without
  overflow. Approval is explicit; saved settings contain names/origins/selectors
  only. Current API-provider live acceptance remains user-deferred.

These cases verify the browser/credential/checker path. They do not claim general
application security, all CRUD cases, complete P4 or overall release completion.
