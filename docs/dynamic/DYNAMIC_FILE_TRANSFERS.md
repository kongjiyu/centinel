# Dynamic file transfers

Authority: DESIGN.md → Centinel_PRD_Revised.md → DEVELOPMENT_PLAN.md.
M4g2 delivers approved uploads; M4g3 delivers bounded downloads and independent
file fingerprint checks. Remaining browser gates and M5–M7 are still required.

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
  Downloads outside separate approved permissions and native choosers remain blocked.
- Hidden upload inputs, native chooser automation, drag-and-drop, arbitrary local
  paths and multi-file inputs as a batch are not supplied by the upload slice.
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

Remaining normal/defective login/form/CRUD and crash
gates, M5 usability/reviewed findings/shared evidence/reports, M6 unit execution and
M7 release acceptance remain required. Live API-provider acceptance is separately
user-deferred; supported API contract tests remain in scope.

## M4g3 approved download workflow

In environment management, open **Approved downloads**, authorize a unique control,
its HTTP(S) file URL, expected MIME type and maximum size (at most 1 MiB), and
confirm public test data. Record preparation for the new profile version. Add a
**Downloaded file fingerprint** check with the public file URL and known SHA-256.
The browser planner uses `download_file`; ordinary click grants cannot authorize
file downloads. Operator-approved control effects remain part of the test-data
approval; an allowed address does not make a website read-only.

Download permissions freeze the URL's origin/path. A target-generated query may
carry private authentication parameters; it is not retained or a new permission.
The request must be a direct browser GET with status 200. Redirects to another
file path, blob/data URLs, download popups and unsupported content encodings stop
as execution limitations. Public-file approval is an operator declaration, not a
classifier for every confidential file format.

Chromium Fetch response interception pauses headers before native download
persistence. Centinel reads sequential 64 KiB chunks, checks declared size and
decoded byte limits, expected MIME and current execution lease, and rejects known
private values before retention. Browser-native persistence remains disabled.
After bounded capture, a matching native download event is required; its filename
joins the private-value redaction set. Only then are bytes encrypted into an
account/project/Run-scoped local copy. A second response/event, unapproved control,
missing file event or lost click acknowledgement cannot trigger an automatic retry.

Identity, gzip, deflate and Brotli responses are supported. Chromium's decoded
stream is measured and captured; replay removes encoding/transport-length headers
and supplies the bounded decoded body. Binary data, UTF-8 across chunk boundaries
and actual empty files retain exact byte fingerprints. Source-declared size and
decoded file limits both apply; this is not a global browser bandwidth/RAM cap.

The independent `download_sha256` checker compares the captured file's SHA-256 to
the frozen expectation and references a hashed `file_manifest` evidence record.
No unique capture or missing manifest proof remains uncertain. A mismatched
fingerprint is failed; a model terminal declaration or link visibility cannot
make it pass. Receipts and partial manifests contain only safe IDs, public
permission URLs, byte counts, MIME and hashes, excluding contents and filenames.

**Downloaded files on this device** shows availability, allows an integrity-checked
binary export and removes encrypted copies separately from historical results.
Desktop export uses an explicit native save dialog; browser preview requests a
Blob download. Files are not opened automatically. Copies are available for seven
days and remain encrypted until removed; shared uploads and retention automation
are still M5 work. Another account/device does not gain access through membership
alone. Existing Run fingerprints and criterion results survive copy removal.

## M4g3 persistence and acceptance

Migration `202610140014` validates optional download grants, enforces approved
origins and consistent edit lock ordering, and freezes file protocol 2/checker 3
on fresh Runs. It adds versioned permission edits and actual download exploration
actions. Existing policies, revisions and replay payloads stay unchanged.

Live integration exposed a stale general environment editor overwriting a newer
download permission. Migration `202610140015` and the sidecar now compare a supplied
editor version atomically; stale edits return 409. Older callers without a supplied
version remain compatible. **Refresh environments** obtains current profiles
without silently replacing unsaved drafts. Both migrations were locally verified
and applied/registered to Centinel Supabase without data resets.

- 515 sidecar tests, 219 frontend tests, TypeScript/build, twenty Dynamic SQL suites
  and retained-data upgrade fixture passed. Rust `cargo check` passed after adding
  the native save-dialog permission. The known frontend chunk warning remains.
- Real Codex normal Run `0ccf319e-0c4f-4d5b-8fb6-e63077ffb7b0` passed; defective
  Run `2956fc49-e1c5-4052-9684-6db8995db2e5` failed its independent fingerprint
  check; oversized Run `59638193-1e36-42b6-adae-328d98e2972e` blocked/not_tested
  without a saved copy. Each fixture received one request. Preparation/cleanup
  recorded; no RWA/production data changed. Retained model/log records excluded
  original filenames and file contents.
- Real UI approval, recorded immutable permissions and local-copy views checked
  at 1440×900, 1200×900 and 390×844 without overflow. Browser copy export SHA-256
  matched captured bytes, then local copies were removed. Native dialog behavior
  is compiled/contract-tested; packaged native acceptance remains an M7 gate.
- Actual API checks retain the exact earlier Run payload after profile edits and
  copy deletion, reject anonymous/cross-project reads and stale general edits,
  and allow one winner for concurrent same-version permission edits. Chromium
  modules exercise HTTP/HTTPS through the Run proxy, compressed/binary/empty
  bodies, size/MIME/private-value rejection, cancellation and lost acknowledgement.

This completes the approved file-transfer slice. Remaining browser login/CRUD,
cancellation/crash release gates and M5–M7 still require implementation/acceptance.
