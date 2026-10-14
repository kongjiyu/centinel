# Dynamic file transfers

Authority: DESIGN.md → Centinel_PRD_Revised.md → DEVELOPMENT_PLAN.md.
This is the M4g2 upload delivery. Approved downloads remain the next required
browser milestone; this document does not declare all P4 or the release complete.

## Operator workflow

1. Select a saved environment and open **Test file uploads** in environment
   management. Choose a non-empty public synthetic test-data file up to 1 MiB,
   with a simple filename and explicitly approve sending it to the target.
2. Save the encrypted local copy, select that fixture and approve one unique,
   visible, enabled `input[type=file]` selector. A filename is not a shared field.
   Permissions store an immutable fixture ID, SHA-256, byte count and MIME type.
3. Record preparation for the new environment version and start a saved test.
   Run preflight verifies every declared fixture on the executing account/device.
   The planner may choose `upload_file` from the recorded permissions; it cannot
   provide file paths or arbitrary bytes. Normal clicks cannot open a chooser.
4. Inspect the independent website checks and local action receipt. An upload
   receipt proves dispatched bytes; it does not itself prove a requirement passed.
   Clean up the target's test data and record cleanup before reusing it.
5. Remove unused local copies and permissions separately. Removing local bytes
   blocks their future use and preserves Run history. It cannot undo an upload
   already sent to the website.

## Execution and privacy contract

- Copies use AES-GCM through the existing local token vault, account/project/
  environment scoping, private directories/files and immutable random IDs. At most
  ten files per environment/account, with seven-day availability. Expired copies
  cannot be used; they remain encrypted until explicitly removed. Full retention
  automation is part of the later evidence/privacy milestone.
- Byte contents are never placed in planner prompts, action JSON or shared profile
  metadata. Uploads are restricted to operator-approved public test data, not
  credentials, personal or production data. Known local variable/session values
  in decoded file contents or filenames are rejected before storage; this is not
  a classifier for every possible confidential or encoded file format.
- Runtime resolves the private copy immediately before dispatch and verifies the
  frozen fingerprint, byte count, MIME type and expiry. Removing the copy makes
  further uploads unavailable. The original user file is never read by path or
  modified. A selected upload filename joins the observation redaction set before
  dispatch; native file controls stay masked in protected screenshots.
- Actual target/input, allowed origin and frozen grant are checked in code. The
  executor sets one Playwright in-memory file payload, with a single-use ledger
  per input and website path. Approved selector/file aliases do not permit another
  upload. Lost acknowledgement stops execution without retrying. Existing leases,
  cancellation, runtime budget and network proxy remain enforced.
- Local receipts retain fixture ID, SHA-256, bytes and MIME type, excluding filename,
  contents and local paths. Shared checks still require independent evidence.
  Unexpected downloads and native choosers remain blocked.
- Hidden upload inputs, native chooser automation, drag-and-drop, arbitrary local
  paths, multi-file inputs as a batch and downloads are not supplied by this slice.
  Missing capabilities stop as execution limitations, not fabricated website bugs.

## Durable permissions and compatibility

Additive migration `202610140013_dynamic_upload_permissions.sql` accepts optional
`actionPolicy.uploads` with strict bounded metadata and freezes file protocol
version 1 on fresh Runs. Existing policies without uploads and historical replay
payloads remain unchanged. An authenticated member's dedicated upload-permission
RPC locks the profile and compares its version, preserving unrelated fields and
rejecting stale edits. It cannot change a Run's frozen policy. Private starter
helpers are revoked, and exploratory checkpoints now accept actual upload actions.

The migration passed isolated Postgres and retained-data upgrade checks and was
applied/registered to Centinel Supabase. Desktop runtime uses QA bearer access;
no service-role runtime key or database reset is introduced.

## Retained acceptance

- 495 sidecar tests, 213 frontend tests, TypeScript and frontend build; eighteen
  Dynamic SQL suites and preserved-data upgrade fixture. The build's existing
  large-chunk warning remains.
- Real Codex Run `860f2102-a103-47dc-bc8b-818d0ffaa442` passed an independent
  visible-text check after uploading once to the isolated synthetic web fixture.
  Server SHA-256 equalled the frozen permission. Retained JSON/Markdown contained
  neither original filename nor fixture contents/base64. Cleanup was recorded;
  forgetting the copy made upload preflight fail. No RWA/production data changed.
- Real QA UI selected and encrypted a file, required public-data approval, saved
  permissions without a shared filename, and removed both copy and permission.
  1440×900, 1200×900 and 390×844 screenshots inspected without horizontal overflow.
  Actual Chromium submission covers native file validity beyond JSDOM's support.
- Authenticated live API rejected known-private-value uploads and oversized bodies;
  anonymous upload returned 401. Rejected requests retained no local file bytes.
  Chromium module tests cover byte integrity, actual input authorization, origin,
  cancelled execution, repeat/alias denial and lost-acknowledgement single dispatch.

Approved download execution, remaining normal/defective login/form/CRUD and crash
gates, M5 usability/reviewed findings/shared evidence/reports, M6 unit execution and
M7 release acceptance remain required. Live API-provider acceptance is separately
user-deferred; supported API contract tests remain in scope.
