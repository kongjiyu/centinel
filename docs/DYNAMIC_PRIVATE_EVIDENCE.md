# Private independent evidence copies

Authority: DESIGN.md → Centinel_PRD_Revised.md → DEVELOPMENT_PLAN.md.
M5b1 shares recorded independent-check screenshots, results and captured-file
manifests. Shared partial traces, captured download bytes, usability and reports
remain later work; a stored reference alone never proves remote availability.

## Operator workflow

Open **Recorded evidence** on a completed Run. **Sync independent evidence**
reads the fixed artifact slots on this device, checks the Run's immutable checksum,
then copies them into private Supabase Storage. Another authorized project member
can inspect the shared screenshot without the executing device's files. Local
fallback is also checksum-verified and explicitly labeled. Pending, failed,
expired and deleted copies remain visible; retrying an interrupted transfer does
not create another descriptor or extend retention.

Shared copies expire seven days after their recorded capture. Expiration blocks
new downloads and signed links. **Delete shared copy** presents a concrete
confirmation and removes the cloud object; its checksum/history and deleting
account remain recorded. Local and previously downloaded/cached copies remain
outside remote revocation. Expiration is an access boundary, not a claim that
expired objects are physically removed automatically; the recorded delete action
performs physical removal.

Every file request verifies membership, current copy availability, size and
SHA-256. Storage reads use a fresh nonce and no-cache/no-store settings. The
sidecar serves authenticated bytes with `Cache-Control: no-store`; it does not
issue signed download URLs. Streamed reads stop at the recorded limit (maximum
4 MiB), and transfer requests have a fifteen-second bound. The dedicated Storage
client preserves the verified request bearer even if SDK fetch options replace
headers. Neither desktop runtime nor evidence persistence uses a service-role key.

## Durable transfer contract

`202610140018_dynamic_private_evidence.sql` adds a copy descriptor and private
transfer-lease table. Fresh two-minute leases fence completion/reclamation;
concurrent owners cannot overwrite a transfer. Copy paths and checksums are
immutable. Upload uses `upsert: false`. A lost acknowledgement is recovered by
reading and verifying the exact existing object, never overwriting it or blindly
repeating a write. A failed/unfinished descriptor survives process restart and
can be retried explicitly from a device with matching files.

The new `project/dynamic-v1/run/copy/hash` namespace has restrictive Storage
policies. Actual current membership is required; pending bytes are visible only
to the fresh uploader. Download/list, upload, and recorded deletion use distinct
[Storage operation permissions](https://supabase.com/docs/guides/storage/schema/helper-functions).
Deletion gets metadata visibility only for the delete operation, preserving the
expired-download denial. Signed URL minting and renaming/overwriting these copies
are denied. Existing bucket objects outside this namespace retain their policies.

Clients supply project/Run/evidence IDs, never a local file path. Local serving
uses bounded regular-file reads within the executing workspace, rejects symlinks,
validates PNG/JSON and requires the immutable recorded hash. Only the three known
independent artifact kinds/slots are supported. Original Run payloads and finding
observation snapshots remain unchanged; current availability is a separate record.

## Retained acceptance

- Real Codex regression Run `3a7565ad-cec9-4bd3-baf2-3d6aad938eed`: screenshot and
  check results synced, authenticated reads matched both sizes/hashes, repeat sync
  reused the exact descriptors, and the Run JSON remained identical. Bucket
  `dynamic-evidence` was confirmed private. Anonymous reads and signed-URL creation
  were denied.
- Independent QA reader `c213df04-49da-41d4-ab0b-dd818fe55260` read both copies and
  finding history. After removing only its QA membership, Run, copy metadata,
  file and finding endpoints returned 403; fresh direct Storage reads were denied
  and table rows hidden. The exact QA membership was restored and read access
  rechecked. Its credentials remain only in ignored local configuration.
- An early plain-SDK error-only revocation assertion was inconsistent and was not
  accepted as a passed gate. The retained diagnostic checked actual fresh response
  bytes: HTTP 400/error JSON, no original evidence bytes, and hidden metadata.
  Full fresh-request revocation acceptance subsequently passed. Previously held
  copies cannot be remotely invalidated.
- Dedicated QA read Run `bb92002b-54a6-4d62-a077-5d191b5b264a` supplied an additional
  copy. Administrative fixture setup moved only its new check-copy expiry into
  the past to simulate time passage. API returned 409, fresh direct Storage denied
  reading, sync did not extend expiry, and physical deletion was confirmed with
  idempotent repeat and preserved checksum/deleting account. Other copies, Run
  history, local files and target business data were preserved.
- A real failed transfer exposed SDK fetch-option header replacement. The bounded
  client now pins the verified bearer; its unit test covers the exact failure.
  Explicit retry recovered the immutable object/descriptor without overwrite.
- Actual reader UI inspected at 1440×900, 1200×900 and 390×844: shared screenshot
  and two copy states visible, no page overflow; destructive confirmation can be
  cancelled. CSS is scoped to the Dynamic evidence panel.
- Slow immutable-revision hydration formerly competed with five-second polling.
  Refresh now coalesces per project/generation, publishes Run history first and
  caches immutable revisions. A delayed-response test verifies no starvation,
  project guards and no repeated revision fetches.
- 533 sidecar tests, 232 frontend tests, sidecar TypeScript/frontend build,
  twenty-three Dynamic SQL suites and retained-data upgrade preserving twelve
  existing Dynamic tables passed. Migration applied/registered on Centinel
  Supabase. Build retains the known chunk-size warning.

QA account provisioning used an external administrator-only fixture; its admin
credential stayed in process memory and was never saved in `.env` or app code.
The application and all acceptance reads/transfers use verified account bearers.
API-provider live acceptance remains user-deferred.

Local audits are ignored under `output/playwright/`: `shared-evidence-live.json`,
`evidence-member-live.json`, `evidence-retention-live.json`,
`evidence-revoke-diagnostic.json`, `shared-evidence-ui.json`, and viewport PNGs.
