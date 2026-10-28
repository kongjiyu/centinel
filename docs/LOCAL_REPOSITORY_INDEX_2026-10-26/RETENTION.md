# Shared repository index retention contract

Migration: `202610260001_repository_index_retention.sql`.

## Snapshot metadata and path

Uploads to the existing private `project-artifacts` bucket use this user metadata:

```json
{
  "schemaVersion": 1,
  "fingerprint": "<64 lowercase hex characters matching the object filename>",
  "artifactIds": ["<distinct current artifact UUID>"]
}
```

The reserved object path is:

```text
<project UUID>/_repository-index/open-codebase-index-0.38.1/<fingerprint>.json.gz
```

The readiness RPC `repository_index_storage_ready()` returns integer `1` only when the migration is installed and callable by the authenticated user. Sidecar must check it before making repository embedding requests or uploading a shared snapshot.

## Access and deletion behavior

- Member reads require a signed-in project member, metadata schema version 1, a fingerprint equal to the filename, 1–1024 distinct UUID artifact IDs, and every listed artifact still present in that same project.
- New snapshot uploads require the same checks. Updates to the reserved index namespace are denied; members can delete derived snapshots through the existing member delete policy.
- When an artifact is deleted, the trigger creates or reuses its artifact cleanup job and adds every current project index snapshot path to that job. If a project cleanup job already exists, the trigger leaves the full-project manifest in charge.
- The existing cleanup actor can select objects named in its exact deletion manifest only during Storage delete operations after the source artifact disappears. Ordinary downloads and signed URLs are denied. Current-source reads use authenticated download operations only; creation of reusable signed links is excluded.
- The migration does not enumerate or remove existing Storage objects when applied. Objects already present without valid user metadata remain stored but are unreadable to ordinary members until rebuilt and uploaded with the new metadata.

## Race and retention limits

The metadata check makes a deleted-source snapshot unreadable immediately after the artifact deletion commits, even if Storage cleanup has not run. Uploads that begin after deletion are denied by the insert policy. An upload that began before deletion and commits after the trigger captured its manifest can leave an inaccessible orphan object. The current artifact job contains a snapshot inventory as of the delete transaction; a bounded orphan sweep, including during project deletion cleanup, is still needed to catch that late commit. The deletion trigger itself does not call Storage or remove bytes.

All new policies and functions are additive and idempotent. Applying the migration performs no project, artifact, snapshot, or bucket deletion.

## Live verification — 26 October 2026

The migration applied successfully in the Centinel Supabase project. The checked-in `retention-regression.sql` ran successfully through the dashboard SQL editor with all fixture writes rolled back. It verified authenticated readiness RPC, valid member download, outsider denial, signed-link denial, artifact deletion queueing, deleted-source download/signing denial even for the cleanup owner, and exact cleanup-object selection during delete_many. No real project/source was deleted and no object bytes were removed. Proof: `evidence/repository-index-evaluation-2026-10-26/retention-regression-pass.png`.
