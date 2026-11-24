# Centinel local-first migration pilot

24 November 2026 · Base `8ea48be6` · Branch `codex/local-first-migration`

The first fixture imports one synthetic project and links two exact frozen source versions to a Review ID. It writes source bytes to files and metadata to SQLite, imports the metadata twice, then closes and reopens the database to verify the original IDs, paths, lengths, and SHA-256 hashes. It also verifies that a different owner cannot create or read the source links. The fixture runs in a temporary directory with the bundled Windows Node runtime and no network calls. [Migration plan](LOCAL_FIRST_MIGRATION_PLAN_2026-11-24.md) · [Runnable pilot](../../scripts/local-workspace-pilot.mjs)

## Current dependency inventory

| Workflow | Current data path | Migration work |
| --- | --- | --- |
| Identity and membership | Supabase Auth supplies the account identity. The sidecar also checks project access through PostgREST, using projects, membership records, and collaborator RPCs. | Keep hosted account identity. Bind pilot access to the verified owner and route project checks through the local workspace. Shared membership and GitHub collaborator operations need a later design. |
| Projects, sources, and requirements | Application repositories read and write projects, requirements, standards, mappings, artifact versions, and sync records. `project-artifacts` holds original source bytes, frozen evidence, and index and batch archives. | Preserve project and version IDs. Import only owner-authorized records and byte-verified copies. Move each sync cursor and its retry state with the source. |
| Conversation, Review, and Readiness | `audit_events` carries conversation requests, harness events, source-index jobs, Auto Test history, and Readiness. Review tables also store sessions, snapshots, findings, decisions, operations, checkpoints, and worker leases. | Give the pilot local conversation and Review journals. Carry revision checks, idempotency, project scope, and restart recovery into each local writer. |
| Dynamic execution and artifacts | Dynamic testing uses PostgREST tables and RPCs for sessions, missions, runs, leases, permissions, unit results, and finding history. Bytes can be device-local or stored in `dynamic-evidence`. Saved reports and attachments also use `project-reports` and `decision-attachments`. | Inventory local and hosted copies before import. Preserve run IDs and trace/evidence links. Leave the legacy SQLite reader available for the explicit migration path. |
| Model settings and retrieval | Model settings and usage are owner-scoped hosted records. `open-codebase-index` already runs on-device. Hosted archives, retention RPCs, and older chunk data are still present. | Move usage and settings metadata to the device and credentials to OS-protected storage. Keep the pilot on exact frozen-file reads. Move compatible indexes and provider budgets in the following phase. |
| App Connections | GitHub, Google Drive, and Slack connections use the sidecar OAuth routes, hosted integration records, and source sync RPCs. Development currently uses loopback callbacks. | Define the hosted callback handoff and token renewal boundary before moving connector records. Keep connected-source content and sync bookkeeping local. |

The development desktop loaded a signed-in project's history and saved Review findings with a source snippet. Connections showed Google Drive and Slack connected. GitHub repository access showed expired and disconnected while the GitHub identity session remained signed in. Hosted Auth and Storage health checks passed. A fresh provider grant and provider-side source browsing still need live verification.

## Reproduce the fixture

From the repository root, run:

```powershell
node scripts/local-workspace-pilot.mjs
& .\centinel\src-tauri\binaries\centinel-node-x86_64-pc-windows-msvc.exe scripts/local-workspace-pilot.mjs
```

The bundled copy tested here uses Node 22.21.1 and SQLite 3.50.4. Its built-in SQLite API emits an experimental warning. The next gate is to connect local project and frozen-source reads and a conversation journal to a fixture sidecar, then run the scoped desktop Review with hosted application-data endpoints blocked. Packaged installation, live data import, backup restore, and desktop cutover remain later gates. [Node.js SQLite API](https://nodejs.org/download/release/v22.21.1/docs/api/sqlite.html)
