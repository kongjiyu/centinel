# Automatic source indexing and cache freshness — 29 October 2026

## Scope

Source indexing follows successful source changes without waiting for a Static Review. Local repository imports, artifact uploads, artifact removals, connected-source removals, and completed connected-source syncs notify the durable `SourceIndexCoordinator`. Connected-source jobs reach that notification after their durable worker finishes; partial pages continue through the worker first. Periodic connected-source checks use the authenticated source APIs and therefore share this completion path. An unchanged source/configuration fingerprint reuses its existing job and index.

While the signed-in desktop workspace is active, the authenticated project-list poll also schedules a bounded local repository check. It rotates through owner-owned projects that have an explicit `local_repository` source row and a nonempty absolute `workspacePath`; remote GitHub/Drive/Slack projects are never scanned from their workspace path. The scanner checks a bounded path/size/mtime/ctime inventory first, then computes exact supported-file hashes only when metadata changed or an older import needs a baseline. It reimports and queues indexing only when the content/path hash set changed. A complete inventory also removes stale artifacts from that same local root; partial scans never delete artifacts or advance coverage. An unchanged-content touch only refreshes safe coverage fingerprints.

Indexing remains bounded by the existing owner/project job journal, capacity holds, leases, source fingerprint checks, and saved embedding configuration. Failed or incomplete imports do not publish an index. Source status reads recover already queued work and do not create a paid job. This change adds no database migration or provider request policy.

## Freshness contract

The repository-index fingerprint binds the exact project, artifact IDs, frozen version IDs, source content hashes, normalized paths, engine/policy, and saved embedding compatibility settings. Frozen bytes are hash-checked before indexing and retrieval. Shared archives are accepted only after archive, per-file, and full identity checks.

Every local warm-cache hit must also verify that materialized source files still match the same frozen manifest. The existing receipt checks remain required: exact identity and complete portable-index inventory with matching file hashes. If staged source bytes, paths, or filesystem entries differ, the cache hit is rejected. Retrieval then fails closed for that local cache; explicit or source-event indexing may restore a verified compatible shared archive or rebuild from frozen sources into a fresh stage.

## Acceptance criteria

| Feature | Acceptance criteria | Verification |
| --- | --- | --- |
| Source automation | Successful local import/upload/removal and completed connected-source sync queue the current exact source identity; changed local workspace contents are imported from the owner-owned local path; incomplete/failed runs do not queue an index | Source worker/coordinator tests and `localRepositoryReconciliation.test.ts` |
| Unchanged source | Repeated notifications for the same fingerprint do not repeat a completed index build | `sourceIndexJobs.test.ts` |
| Warm cache freshness | A completed local index is rejected when its staged source bytes no longer match the frozen artifact hash, even if the native-index receipt is intact | `localRepositoryIndex.test.ts` |
| Shared restore/rebuild | A rejected local stage can recover only through exact-identity, archive-validated restore or a fresh build | `localRepositoryIndex.test.ts` and snapshot tests |

## Limits

Local polling runs only while the desktop app is signed in, piggybacks the existing 60-second project-list reconciliation, scans at most eight projects and one content inventory per pass, and caps an inventory at 20,000 filesystem entries, 2,000 supported files, and 128 MiB of source bytes. Oversized or unreadable inventories fail closed and require a later smaller/cleaner scan or explicit reimport. Connected providers compare remote revisions through their existing sync adapters. Supported source text, embedding availability, deployment retention configuration, and provider/account capacity remain existing prerequisites. This work does not establish semantic recall or whole-program coverage.
