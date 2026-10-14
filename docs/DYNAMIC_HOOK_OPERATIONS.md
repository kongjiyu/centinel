# Durable preparation and cleanup operations

M2c2, 13 October 2026. Approved workspace scripts now execute from the environment
panel with durable operation history, cancellation and bounded device-local output.
The runner uses existing device-local authorization; project peers do not inherit
permission to execute repository code on another device. This is trusted repository
execution under the user's OS permissions, not an OS sandbox.

## Execution and recovery

A hook freezes the environment version, selected package script, manifest/lockfile
fingerprint and full local authorization identity. The worker rechecks authorization
before executing a fixed package-manager argv. No caller or model shell command is
accepted. Installed package managers are resolved without Corepack downloads or
metadata auto-pinning. Variables are read from the owner's encrypted local vault;
Centinel OAuth and application credentials are not inherited. Each command uses an
isolated HOME, a 60-second time limit and 256 KB output limit.

Supabase migration 202610130005 adds bearer-scoped hook operations and fenced
claim/heartbeat/finish RPCs. Hook and browser starts share the project lock. Data is
preparing/cleaning while a command runs. Cancellation retains that lock until the
worker confirms termination; cross-device workers observe the stop request on
heartbeat. Queued work can cancel immediately. A 90-second lease exceeds the
command's independent deadline, avoiding reuse while a stopped worker's child is
still terminating. A detached IPC guardian kills Unix process groups if the worker
dies. Failed, cancelled, blocked or expired operations require cleanup; a successful
setup makes the frozen profile ready and successful cleanup makes it unprepared.

Idempotent retries return the existing operation, including after authorization
changes. Expired work is interrupted, not automatically rerun. Automatic cleanup
requires explicit local consent and a selected cleanup script. It only starts for
the matching stopped browser Run or failed setup source; it never cleans a newer
Run's data. Failed automatic cleanup remains a recovery task and does not turn the
browser verdict into a defect or pass.

## Evidence and interface

Hook history includes script, exit code, bounded duration and command outcome.
Full redacted output is retained atomically on the executing device; the cloud
summary is limited to 8 KB. A device without the receipt explicitly reports it
unavailable. Partial output survives unexpected worker termination. Known local
values, escaped forms and truncated fragments are redacted before either local
or shared persistence. A command failure is a data-operation result, not a finding
about the website.

Authenticated routes are under
/projects/:projectId/dynamic/environments/:id/hooks, with operation GET,
POST cancellation and GET output. Membership and environment scope are checked
before local filesystem access. UI retries retain the original request key and
poll operation/data history without resuming interrupted work.

## Verification

Local contract tests cover authorized execution and redacted receipts, changed
permission rejection, replay, cross-profile access and source-matched automatic
cleanup. Transactional SQL covers hook/browser exclusion, claim and private token
permissions, stop acknowledgement, late finish fencing, cleanup failure, lease
expiry, successful recovery and nonmember RLS. The additive migration was applied
to Centinel Supabase without reset or deletion.

Real UI acceptance uses an isolated marker fixture, leaving the pinned RWA database
intact. Approved setup creates the marker, an actual Codex browser Run independently
passes the signed-out form check, and configured cleanup removes the marker. Output
redaction and layouts at 1440×900, 1200×900 and 390×844 were verified. Retained local
record: output/playwright/hook-ui-acceptance.json.

Live bearer acceptance also confirmed idempotent replay, failed cleanup retaining
the dirty lock, cancelled cleanup retaining the marker/output, and explicit recovery
with the good script. Full suites passed: 385 sidecar tests and 187 frontend tests;
a further stop-acknowledgement UI test passed (three hook-panel tests), and eight
workspace execution tests passed after allowing 1.5 seconds for the child process
to start in the timeout fixture. Frontend build and sidecar TypeScript passed.
An earlier simultaneous suite/build run hit test startup timeouts; complete suites
were rerun with two workers, and frontend test timeout 15 seconds. This adjustment
does not change product deadlines. Existing Vite large-chunk warning remains.
On 14 October the prior disposable PostgreSQL directory was absent; a new isolated
cluster was initialized and all five Dynamic migrations plus environment, data
lifecycle and hook SQL tests passed again. No project database was reset.
 Private shared browser evidence, browser session
references and unit-run machine-readable reports remain subsequent milestones.
