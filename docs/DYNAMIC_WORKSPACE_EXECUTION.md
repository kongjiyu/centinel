# Authorized workspace and bounded execution foundation

M2c1, 13 October 2026. This slice supplies read-only repository prerequisites,
explicit device-local script authorization and a reusable bounded process engine.
It does not yet expose setup/cleanup or unit execution actions in the product.

The environment's workspace panel reads package.json, dependency lockfiles,
.node-version and template variable names. Actual .env values are never read.
Template names may be optional: they are not automatically made preflight gates.
Canonical realpath containment rejects metadata symlinks outside the chosen folder.
Inspection returns the actual available script definitions for review, with known
local values redacted. No package installation or repository command runs during
inspection/authorization. Git rev-parse is bounded and used only for commit metadata.

Authorization requires an explicit selected script list, package manager and
consent. The current fingerprint must match the inspected package/lockfiles.
Authorization is encrypted in generated local data, mode 0600, partitioned by
account/project/environment. Execution must verify the same folder and fingerprint
again; changed scripts/locks require a new inspection. Account peers and other
devices do not inherit this local authorization. Node runtime bin selection is
optional and validated, matching the external RWA's pinned Node 22.20.0 setup.

The internal process engine accepts an already authorized executable/argv and
uses shell=false, fixed cwd, isolated HOME and a small environment whitelist.
Centinel's own OAuth/Supabase/encryption values are not inherited. Reserved loader
and process-variable names are rejected. It bounds time/output, cancels Unix
process groups, and distinguishes pass, test/command failure, missing executable,
timeout, cancellation and excessive output. Output redaction handles values split
across chunks, JSON/URL-escaped forms and partial truncation boundaries.

This is explicit trusted repository execution, not an OS sandbox. Authorized
package scripts may themselves use a shell or the user's filesystem permissions.
Unix process groups are verified on macOS; Windows command execution currently
fails closed until process-tree termination is supported. No model-generated
shell command is accepted. Hook/unit runners must additionally bind this engine
to their durable lifecycle, locks and cancellation contracts.

## Interface

GET `/projects/:projectId/dynamic/environments/:id/workspace` returns only the
current caller's local authorization. POST with operation=inspect reads the named
folder's bounded metadata. POST with operation=authorize requires allowScripts,
expectedFingerprint and named scripts actually present in that manifest. Normal
AuthGateway/project/environment checks precede filesystem access.

## Verification

- Eight backend tests cover metadata names-only inspection, consent/fingerprint,
  owner/project/profile isolation, symlink escape, argv/inherited-secret isolation,
  output redaction/limits, timeout/cancel/process-group termination and runner error.
- Full suites: 380 sidecar tests, 185 frontend tests; TypeScript and production build
  passed. Existing large-chunk warning remains.
- Real RWA workspace inspection showed the pinned commit and Node/package-manager
  hints; its test:unit:ci script was explicitly authorized through the UI without
  executing it. 1440×900, 1200×900 and 390×844 inspection/authorization views passed.
- Live HTTP rejected stale inspection fingerprints and unauthenticated access.
- Retained local UI record: output/playwright/workspace-ui-acceptance.json.

Next: durable setup/cleanup operation orchestration and automatic configured
cleanup, then browser credentials/redaction/budgets. The same engine is reused by
P6's separate machine-readable Vitest runner; authorizing a script is not proof
that its tests passed.
