# Shared stopped-run diagnostics and captured files

Authority: DESIGN.md → Centinel_PRD_Revised.md → DEVELOPMENT_PLAN.md.
M5b2 extends private evidence sharing to diagnostic derivatives from stopped Runs
and explicitly approved captured download files. Usability, versioned reports,
unit-runner delivery and final release/packaged acceptance remain required.

## Contract and workflow

The original executing account chooses **Share diagnostics and captured files**
after execution stops. Project members can then inspect shared JSON or save a
captured test file. Diagnostic data has `criterionProof: false`: its existence
cannot turn a cancelled, blocked or interrupted Run into a pass or a finding.
The Run, original local logs and independent check evidence remain immutable.

Trace, network, console, budget and bounded before/after observations are read
from fixed local slots. A privacy-versioned derivative removes local paths,
known private values, credential-bearing URL fragments, headers/cookies and raw
planner reasoning. Both original-source and shared-copy hashes remain recorded.
The sharing envelope is bounded to 4 MiB per artifact/8 MiB total and fifty page
observations. JSON previews are inert text and limited to 20,000 characters.

A separate shared availability manifest records which bounded local artifacts
were present and omitted at publication. Another device can see missing final
network/console/budget records after abrupt worker loss; absent usage is not zero.
This manifest describes available local artifacts, not an exhaustive history or
proof of completed coverage. It is a generated diagnostic record; its source
hash is its own canonical manifest hash.

Captured bytes require the immutable file-manifest receipt, the original
account's encrypted download vault, a matching frozen `publicTestData` permission,
size/MIME/hash consistency, and the independently observed download fingerprint.
Empty files remain supported. Publication is denied for another account and for
unapproved captures. Missing/cleaned local copies remain unavailable; historical
fingerprints are not used to fabricate replacement bytes. Other members read
only the resulting authorized shared copy. Binary content is served as an
attachment and saved with the existing checksum-verified export helper.

The new artifact registry uses member read RLS and producer-only guarded
registration. Identity/source/derivative hashes are immutable and registration is
idempotent. Existing private copy leases, no-overwrite upload recovery, uncached
verified reads, expiry and attributed deletion apply to the new artifact kinds.
The independent-copy signature and original validator remain compatible.
`202610150001_dynamic_shared_artifacts.sql` is additive and preserves existing
Runs, findings, registered independent copies and local data.

## Retained acceptance

- Cancelled real-Codex Run `4a1a6b2b-56b9-4aba-8dc9-07585ceb6e03`: seven shared
  diagnostic artifacts including availability manifest, reader-side size/hash
  checks, idempotent replay and unchanged `cancelled/not_tested` Run.
- Interrupted Run `786697d6-f9b5-4dfc-94b8-e593f168581f`: four artifacts shared;
  network, console and final budget explicitly unavailable in the shared manifest.
  Reader verified all bytes; the interrupted outcome remained unchanged.
- An older download Run correctly refused sharing because its local captured
  copy had previously been cleaned. That unavailable result was retained as a
  scope limitation. Fresh real Codex Run `fd05d165-9229-4e7f-954d-7d373e9855b2`
  downloaded the declared public synthetic fixture exactly once from an owned
  in-memory target on 3016, passed its hash criterion, then published the actual
  encrypted captured bytes. Reader-side attachment/hash checks and idempotent
  replay passed; original Run and independent proof stayed unchanged.
- Actual reader UI displayed scrubbed trace, cross-device missing-artifact
  disclosures and disabled producer actions at 1440×900, 1200×900 and 390×844.
  No page overflow. A captured-file browser export was requested through the
  verified helper; native packaged export acceptance remains M7.
- Additive migration applied/registered on Centinel Supabase after isolated SQL
  tests and preservation of fourteen existing Dynamic tables in the upgrade
  fixture. Other producer/non-member registration, changed-hash rejection,
  zero-byte capture and frozen permission/MIME cases passed.

Local audits: `shared-artifacts-live.json`, `artifact-download-live-audit.json`,
`shared-artifacts-ui.json` and `shared-artifacts-<width>-preview.png` under ignored
`output/playwright/`. Test-account credentials remain only in local configuration;
no admin key is used by the runtime. API-provider live acceptance is user-deferred.

Final checks: 538 sidecar tests, 235 frontend tests, sidecar TypeScript/frontend
build and twenty-four Dynamic SQL suites passed. Build retains its known large
chunk warning. Remaining P5/M6/M7 work is tracked in DEVELOPMENT_PROGRESS.md.
