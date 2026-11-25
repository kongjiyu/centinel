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

## Conversation and Auto Test history

The sidecar stores new conversation turns and Auto Test sessions in `data/project-history.sqlite` under its writable home. Development uses the checkout root. Packaged builds use the app data directory. History lists, direct lookups, conversation recall, Auto Test attachments, and report browser summaries read that database by signed-in owner and project. Hosted membership, project metadata, frozen sources, Review orchestration, and other Dynamic execution records are still migration dependencies.

Existing hosted history rows remain in Supabase until explicitly exported and imported. Wait for active sessions to finish. Export only the authorized project's rows with the matching `actor_id`. Save a local JSON object with two arrays, `conversations` containing the original `payload.request` objects from `project_conversation_request` rows, and `autoTests` containing the original `payload.session` objects from `dynamic_autonomous_session` rows. Keep the export in a private location. The importer verifies the account, project and terminal state, preserves IDs, and skips any record already present on-device.

```powershell
pnpm --filter @centinel/sidecar migrate:history <owner-uuid> <project-uuid> <absolute-json-path>
```

For packaged data, run the importer with `CENTINEL_HOME` pointing to the same app data directory used by the packaged sidecar.

## Local project, source, and requirement data

The workspace pilot serves authenticated project lists, project details, source inventories, frozen source previews, and saved history from the device. Owners can edit the project name and description, manage requirements, and view imported requirement mappings. It verifies a source's bytes against the recorded SHA-256 before returning them. Owner and project scope apply to current versions, historical versions, and mutations.

The importer takes an authorized snapshot with a `project` object and a `sources` array. Use the project fields `id`, `ownerId`, `name`, `description`, `workspacePath`, `createdAt`, and `updatedAt`. Each source entry contains the existing client `artifact` metadata with its original `versionId` and `contentHash`, a `mimeType` or null, and the original file bytes in `contentBase64`. Use `currentVersionIds` to select the current version of each active artifact. Other included versions stay available by exact ID. Older pilot fixtures that omit this array still select the last listed version per artifact.

Include `traceability: { requirements, mappings }` to seed confirmed requirements and their saved mappings. Each array takes its original API records. Supply empty arrays when the source workspace has no records. An omitted traceability snapshot leaves the requirement endpoints unavailable. Re-importing preserves device edits to the project and requirements. Requirement mapping changes and Review traceability snapshots remain separate work.

```powershell
pnpm --filter @centinel/sidecar migrate:workspace <owner-uuid> <absolute-snapshot-json-path> <absolute-staging-directory>
```

An explicit staging directory requires `currentVersionIds`. The database records the snapshot file digest in the import transaction. Repeating the same file preserves local edits and deletions. A different file for the same project requires a fresh staging directory. To open the stage with a pilot sidecar, import to the isolated home's `data/local-workspace` subdirectory and set `CENTINEL_HOME` to that isolated home with `CENTINEL_LOCAL_WORKSPACE_PILOT=1`. Hosted Auth verifies the bearer. The Windows CLI smoke imported a synthetic snapshot twice and verified one project and one receipt.

Review orchestration, model settings, Readiness, project creation and source writes, broader Dynamic execution, connected-source sync records, and report persistence remain on the migration plan. Import of real hosted data follows end-to-end local verification and the cutover rehearsal.

## Local Review records and frozen source previews

The pilot stores Review records, operation idempotency keys, and frozen source manifests in `workspace.sqlite`. Review transitions compare the stored revision before writing. A manifest binds every artifact to an owner- and project-scoped version hash and keeps its original selection once saved. The existing Review list, detail, and frozen source preview response formats are available from the pilot for saved records.

The HTTP fixture closes and reopens SQLite, reads a saved Review through the sidecar, and verifies that its preview returns the older bytes from the manifest even after a newer current version is available. It also tests a concurrent transition, repeated operations and manifests, cross-account denial, and tamper rejection with hosted application data blocked.

The local store now persists finding observations, progress, model attempt reservations and outcomes, audit events, evidence sufficiency, and correlation snapshots. Review findings and the public harness event view use the same HTTP routes as the existing workspace. The fixture verifies that a repeated finding keeps its ID, uncertain evidence stays separate, a repeated model reservation preserves its terminal outcome, late progress cannot replace newer progress, and a rejected audit batch rolls back entirely.

Frozen traceability uses the same mapping checks as the hosted repository. A local requirement mapping can carry `mappingVersionId` and `mappingContentHash`. Missing version proof stays unavailable, and a saved-source retry reuses its parent's frozen snapshot when it points at the same manifest. The pilot serves this snapshot through the ordinary Review traceability endpoint.

Review leases and checkpoints also persist in SQLite. The fixture reopens the database after a worker owns a lease and writes a checkpoint. It verifies that a second worker can claim after expiry and that the previous token cannot write or release that lease. The local runtime checks for expired leases when an account first reads or starts a Review and during subsequent polling. An active assessment hold prevents recovery for that project.

The ordinary Review start and cancel routes now use the production orchestrator in pilot mode. Scoped runs read immutable files and imported requirements, candidates, and rules from the device, and record their output and model attempts in SQLite. Supply `traceability.candidates` and `traceability.standardRules` explicitly, including empty arrays when applicable. The importer accepts optional project-scoped `modelConfigurations` with the canonical provider settings fields and encrypted credentials. A configured provider is resolved from this local store. Interactive provider editing, OS-managed key storage, provider-backed PDF visual assessment, retrieval and embedding index lifecycle, and the remaining Review, Dynamic, and Readiness workflows are still pending.

The HTTP integration fixture completed a scoped Review with the real orchestrator and a mocked model provider, rejected a cross-account cancel, then restarted the sidecar and reopened the completed Review and exact frozen source. PostgREST and hosted Storage were blocked throughout. It also verified that the normal provider resolver could decrypt and resolve a locally stored synthetic configuration. Hosted import remains after live desktop verification and the cutover rehearsal.

## Local project chat

Pilot chat uses the same conversation runtime, validation, and HTTP routes as the hosted-backed workspace. Turns and recent conversation recall come from `project-history.sqlite`. Project inventory, saved findings, exact source excerpts, and planner attempts come from the device. The planner uses the locally stored model configuration. A general question can be answered without an attachment. Recent completed turns are included by default for conversational context, subject to the existing six-turn and character limits. Code Review scope comes from the selected, version-checked files.

The HTTP fixture blocks hosted PostgREST and Storage and uses a mocked model provider. It checks a general question, a grounded follow-up with automatic recall, an inline excerpt from the original Review even when a newer source version exists, and a Code Review that starts after the user selects Code in the question container. The completed turns and their links reopen after restart, and an explicit reply can quote the restored history. Browser execution from pilot chat remains unavailable pending the Dynamic storage migration. Live provider, native desktop, and hosted-data import checks are still pending.

## Create a project from local folders

Pilot project creation accepts the desktop's existing folder selection request. It seeds empty local requirement authorities and uses the same file eligibility, limits, and Git provenance as the hosted repository importer. A second folder uses its own source ID and path prefix. Explicit folder imports reuse the current version for unchanged bytes and Git commit, and save an immutable new version under the same artifact ID after a change. Partial imports report skipped files and individual failures. Folder polling, removal reconciliation, and connected sources remain migration work.

The HTTP fixture creates an owner-scoped project from two folders containing the same filename, refreshes one folder, and reads both the original and current versions. It verifies owner isolation and reopens the project and both sources after a sidecar restart. Hosted PostgREST and Storage are blocked throughout. The relevant sidecar suites passed 98 tests, and TypeScript reported no errors.

## Documents, findings, and project reports

The desktop document and reference upload routes persist exact bytes locally, including folder-relative names and files larger than the old pilot JSON request limit. The upload limit matches the desktop picker at 10 MiB. Currency controls update the current artifact. Removing an artifact from the current library retains its frozen Review evidence. Project settings can relink an accessible local folder after moving devices.

Project Findings and Assessment use the existing reconciliation and risk rules. A manual status change appends a device-local event and leaves historical Review observations intact. The report builder reads the same saved findings, requirements, frozen sources, Review usage, and Auto Test history. JSON, Markdown, and PDF are generated from one snapshot and retain their checksums. Private downloads use short-lived loopback links. After a sidecar restart, report history can issue fresh links to the same bytes. Shared Dynamic Run evidence and hosted Review decisions still need their migrated repositories in the report source.

Windows HTTP tests exercised upload, removal, frozen preview, owner-scoped status changes, report generation and download, and restart with hosted PostgREST and Storage blocked. CI is configured to run the local fixture on Windows and macOS. Packaged macOS workflows and live OAuth and App Connection acceptance still need direct verification.

## Local Project Readiness

Pilot Readiness uses the existing GET and POST routes. It reads verified artifact versions, saved requirements, and enabled standard rules from the local workspace. The coordinator records jobs, assessments, and sanitized provider attempts locally. Project description edits, document and repository changes, and requirement edits notify the coordinator. Active repository imports defer assessment, and an unfinished import left by a restart appears as a coverage gap.

A provider-capacity pause keeps the previous snapshot and requires a manual restart. If the sidecar exits during a local assessment, polling shows its interrupted state and preserves any saved snapshot. An explicit Start is required before repeating provider work. The Windows HTTP test uses a mock model and blocks hosted PostgREST and Storage calls. Live provider, connected-source Readiness, and packaged desktop checks remain pending on the migration path.

The workspace snapshot importer accepts an optional `readinessJobs` array of the original `payload.job` objects from authorized `project_readiness_job` journal rows. It seeds history within the project import transaction, retains request IDs, and preserves an existing local journal on repeated import. Cross-project jobs and snapshots are rejected. Historical provider-usage import is separate.

## Local Model Provider settings

In pilot mode, the existing Settings routes read and save model settings on-device. Provider drafts remain owner-scoped. Activating a saved provider writes the shared text and vision configuration in one SQLite transaction. Imported project overrides retain precedence when enabled. Provider model discovery can use the saved local credential for the existing supported endpoints. A provider or endpoint change requires a fresh key.

The Windows HTTP fixture verifies saving a draft, rejecting a stale activation, activating text and vision, owner isolation, project override precedence, and restart persistence with hosted application-data calls blocked.

The local Settings API records text, vision, Codex and embedding connection-test usage in SQLite. The usage view combines those records with the Review, conversation and Readiness journals. Review details use the saved manifest and harness events for source and stage accounting. The embedding catalog reads the same owner-scoped ledger. Unknown provider counts remain unknown. The explicit embedding connection test writes usage only and does not create an index. Dynamic execution usage and historical hosted usage import remain pending.

The Windows HTTP fixture ran two probes against a loopback model server with hosted application data blocked. It checked the reported token totals, embedding catalog, Review scope, account isolation, and restart persistence. The targeted suites passed 37 tests. The sidecar type check also passed.

## Device-protected Model Provider keys

The packaged launcher provisions a device encryption key through Windows DPAPI or the macOS login Keychain and passes it to the sidecar over the child process's standard-input pipe. New local Model Provider credentials use owner-bound encryption. Existing imported credentials stay readable with their original encryption key. Re-entering a provider key or activating a saved API draft writes device-protected ciphertext. Restoring a workspace on another device requires re-entering those device-bound credentials.

The native Windows test verified DPAPI key creation and reopening with resource bundling disabled for the test build. The sidecar subprocess fixture verified the pipe, account isolation, legacy read compatibility, and creating and reopening a new saved setting without the legacy environment key. Native macOS Keychain execution and the full packaged desktop smoke test are still pending.

## Connected source data on-device

In pilot mode, project source routes use local SQLite for the connected source, item status, sync cursor, idempotency, run history and worker leases. Provider adapters and hosted App Connection credential lookup and refresh continue unchanged. Provider content is stored in the workspace's verified object store. Reimports preserve artifact IDs and exact saved versions. Removed remote items disappear from the current source list while their saved versions remain readable. Established GitHub revision selections are checked against the local source and item versions before Review starts.

Project creation with a GitHub link queues the initial run in the local journal. An authenticated source or Readiness read recovers queued or resumable work. A successful run publishes its source revision and cursor in the same SQLite transaction. Readiness defers healthy imports and records terminal failures or unavailable content as coverage gaps.

The workspace importer accepts an optional `connectedSources` object containing `sources`, `items` and `runs` in the existing connected-source API shape. Include every referenced artifact version in the workspace's source export. A missing or mismatched version rejects the transaction, and repeated imports preserve the device journal. Hosted worker claims are cleared when seeding so resumed work uses a local lease.

The Windows HTTP fixture uses a synthetic GitHub adapter and allows only hosted App Connection record lookup. It exercises project creation with a GitHub link, file updates, history and queued-run recovery after restart, removed files, owner isolation, exact historical bytes and repeated staging imports. Live provider OAuth and sync, importing real hosted records, and packaged macOS verification remain outstanding.

## Repository source search on-device

The pilot builds its repository index from hash-verified frozen source versions in the workspace. Review runs and source preparation share the existing index coordinator. The build journal, leases, pause state, and embedding usage are stored in owner- and project-scoped SQLite records. The pinned native index and its completion receipt live under the workspace index directory. A saved index can be reused when the owner, frozen manifest and embedding configuration match. Retrieved ranges are reconstructed from frozen source and validated before entering Review evidence.

The existing source status and Resume routes now work in local mode. Ordinary GET requests recover recorded work. Source changes and explicit preparation can queue builds, while an assessment or capacity pause requires explicit Resume. The sync route checks the device cache. The workspace owns cache admission and reuse. Configured embedding providers still receive their existing bounded requests and usage is journaled before each call.

New builds check available space before staging and embedding calls. The check accounts for frozen text and the bounded SQLite index and writer. Available space can change between checks. The owner/project retention journal keeps the three most recently used completed indexes, the newest completed whole-project index, and queued or paused work and live claims. Idle incomplete entries are eligible after seven days. Builds run a bounded cleanup pass and remove superseded stages after publishing their replacements. The cleanup targets journaled cache directories and preserves frozen sources and Review records. A valid older device cache enters the journal on its next use. A completed index whose receipt fails validation is rebuilt instead of being reopened as interrupted work.

The account exporter reads published index archives by their recorded project and path. Export and staging verify the archive digest, portable file inventory and each frozen source link. The export receipt separates exported, unavailable and incompatible indexes. A staged archive is scoped to the importing owner and project. Local builds restore it only when the exact source, engine, policy and embedding configuration match. The pinned engine must report a compatible index before its local pointer is published. A native readiness rejection starts a fresh build under the normal space, model and approval rules.

The export fixture rejected a corrupt hosted archive and reopened a valid archive under its original scope. The Windows native fixture restored a hybrid index in a separate workspace with no embedding call during restore. It then retrieved exact lines from the staged frozen source. The sidecar type check and all 36 focused tests passed.

The Windows HTTP fixture blocks hosted application data and exercises a native hybrid build, exact code retrieval, job and usage persistence, index reuse after restart, account isolation, low disk space, and explicit Resume. Its provider is a loopback fixture. The sidecar type check and 143 targeted tests passed. Packaged Windows and macOS acceptance and live-provider smoke testing remain pending.

The retention regression passed alongside the native Windows workspace fixture, index snapshot validation, and source-index job tests. The tests verified preservation of the whole-project index, frozen source bytes, paused work, and live claims, and rebuilt a damaged completed index in a fresh stage. A redirected cache directory stayed untouched. The sidecar type check and all 48 focused tests passed.

## Dynamic history and environments on-device

Staged workspace snapshots can include `dynamicHistory: { missions, revisions, runs, evidence }`. Use the original mission, revision and run payload shapes. An optional evidence entry supplies the original bytes in `contentBase64`, keyed by `runId` and `evidenceId`. The import verifies project and revision links and each supplied evidence checksum. A missing file leaves its historical reference available and its bytes unavailable. A queued or running imported record becomes interrupted with the partial observations retained. The original run ID, test revision and recorded outcomes remain available through the existing read routes. Reports use the recorded checks and verdict. The local Review context route provides frozen requirement and source versions for Dynamic authoring.

The same staged snapshot can include `environments: { profiles, data }` using the saved environment profile and data status payloads. Local routes read and edit profiles, record manual preparation and cleanup, and preserve reservations across profile changes and restarts. Imported in-use data requires explicit cleanup before reuse. Local values stay in the environment vault. New packaged writes use the device-protected key with account, project and profile binding. Existing on-device values can be read from the legacy vault when the previous encryption key is available.

The Windows HTTP fixture verifies frozen revisions, original Run links, reference-only evidence, verified screenshot bytes, import interruption handling, report projection, profile version conflicts, and cleanup before a second environment can use the same data. Hosted application-data calls are blocked in that fixture. The staging and encryption tests use synthetic data. Live Runs, legacy session import, workspace commands, unit and hook receipts, capture leases, Dynamic findings, and remaining evidence types still need migration.

## Saved-test authoring and historical Reviews

Existing Dynamic test authoring routes create, revise, rename, archive and restore saved tests in the local workspace. Edits advance an immutable revision, and a rename changes the saved test display name. Creating a test from a Review rebuilds requirements and source references from the frozen local Review. Local environment values are screened before saving test fields.

An archive can include `reviewHistory` with `reviews`, `manifests` and optional `operations`, `findings`, `attempts`, `audit`, `traceability`, `sufficiency`, `correlations`, `decisions` and `decisionFiles`. Provide preserved IDs, original timestamps and the exact artifact versions. Unavailable historical files can be identified in `missingSourceVersionIds`. A missing file remains unavailable, and the source manifest reports incomplete coverage. Imported queued or running Reviews appear blocked with their saved evidence retained. Existing saved-source retries can point to their original shared Review manifest.

For a saved decision file, provide `reviewId`, `decisionId`, `attachmentId`, `contentHash` and `contentBase64`. Decision history and reports include the original decisions. An account that can read the Review can request a short-lived loopback download of its verified attachment. Attachments with missing bytes keep their history entry.

On Windows, the HTTP fixture verified frozen Review context in test authoring, preserved the original test and run after a revision, and reopened archived Review decisions, findings, source versions and attachment bytes with hosted application-data calls blocked. The sidecar type check and 109 targeted tests passed. Real hosted export, packaged desktop checks on both platforms and remaining execution workflows are pending.

## Read-only export and staging rehearsal

`migrate:export` uses the verified Supabase account session and the public project key. It accepts an owned project ID and a new absolute archive path in a private directory. Its HTTP transport allows GET and HEAD and rejects redirects. The command writes the completed archive as a new file and emits counts and timestamps.

The current archive includes projects, current and historical source versions, requirements and mappings, current standard rules, connected source history, Readiness history, owner chat and Auto Test turns, Dynamic tests and runs, environments and data events, and historical Static Reviews. Eligible decision files and Dynamic independent evidence are downloaded by exact recorded path and verified against their original length and hash. Expired Dynamic copies and historical references without verifiable bytes remain references. The receipt counts those gaps.

The exporter checks project, source, Dynamic evidence, index publication, and Review batch cache inventories again. The receipt identifies the result as a multi-read export with `cutoverReady: false`. A final consistent export boundary and reconciliation are still required.

For an authorized fixture, supply the short-lived owner session as `CENTINEL_MIGRATION_ACCESS_TOKEN` in the export process environment. Both import commands use the same isolated home. Place the workspace data at its `data/local-workspace` subdirectory.

```text
pnpm --filter @centinel/sidecar migrate:export <project-uuid> <new-absolute-archive-path>
pnpm --filter @centinel/sidecar migrate:workspace <owner-uuid> <absolute-archive-path> <absolute-isolated-home/data/local-workspace>
pnpm --filter @centinel/sidecar migrate:history <owner-uuid> <project-uuid> <absolute-archive-path> <absolute-isolated-home>
```

The CLI rehearsal uses a loopback Supabase fixture. It checks owner scope, source inventories, exact historic code, saved Review findings and decisions, environment reservations, owner chat history and original evidence bytes. It also checks that an existing destination stays intact. Live hosted account data remains pending for cutover.

### Historical project reports

The export receipt counts report records and verified packages. The exporter reads the original JSON, Markdown and PDF from the report's private project path and verifies the stored package checksum. Import preserves the original report ID, author, timestamp, checksum and file bytes. A legacy report with no verifiable package or a confirmed missing object remains visible in history. Its download request explains that the original files are unavailable. The pilot renews expiring local download links for verified packages and checks each file again when it is downloaded.

The Windows CLI fixture stages an intact package and a report with a missing PDF. It verifies all three intact downloads through the sidecar endpoints with hosted application-data calls blocked, account isolation on link renewal, and rejection of corrupt hosted and local bytes.

### Saved Model Provider settings

The archive includes the owner's active text, vision and embedding settings, saved provider drafts, and supported project overrides. The export uses the newest hosted owner row per purpose and counts superseded or unsupported settings in the receipt. The importer preserves owner settings already saved in the destination when staging another project. The archive carries encrypted provider credentials and the metadata used by the app. Keep it in a private directory. Imported credential ciphertext still requires its original encryption key. Saving a replacement key in the packaged app uses its device-protected vault. OAuth sessions and App Connection credentials follow their existing sign-in and connection paths.

The Windows fixture verifies the restored Settings endpoint with hosted reads blocked, selects the original project override using its synthetic legacy credential, and checks that a second import cannot replace existing owner settings. It also verifies that an invalid credential field rolls back the staging transaction.

### Historical model usage

The snapshot includes the authenticated account's saved project and account-level usage rows from `model_usage_records`. The import preserves original call IDs, Review and browser session links, call scope and kind, safe outcomes, and recognized accounting fields. Unknown counters remain unknown. Account-level records appearing in more than one project export are counted once. Review attempt history remains available for the retry budget, and the usage projection counts each imported attempt once.

The Windows fixture exercises the existing Settings usage route and a generated project report with hosted application data blocked. It verifies saved provider-test, project index, Review and browser totals, duplicate prevention, and account isolation. Migration of separate legacy usage journals and local recording of new Dynamic calls remain pending.

### Legacy Dynamic sessions

The archive carries hosted legacy browser sessions, public action fields, and evidence descriptors. Browser history and project reports read those records locally. A saved Run that mirrors a legacy session remains authoritative in reports. In-progress imported sessions appear blocked. Missing or unreadable original objects keep their evidence entries. The export verifies a saved checksum when present and binds the staged bytes to a checksum. The desktop's existing evidence endpoint serves images from owner- and project-scoped records.

For older sessions saved on the original device, append `--legacy-db <absolute SQLite path>` after the staging directory in the workspace import command. The explicit reader opens that database read-only, selects the authorized snapshot's project, and copies registered evidence only from its resolved session directory. It can fill an unavailable hosted evidence entry with the original local bytes. The staged import rejects conflicting bytes for the same saved evidence ID and fingerprints the selected device snapshot along with the hosted archive.

The Windows rehearsal exported synthetic hosted history, recovered a missing screenshot from a synthetic legacy SQLite database, and imported the same inputs twice. The desktop sidecar served the exact staged screenshot and denied access to another account. A file outside the recorded session directory remained unavailable, and a damaged local screenshot failed verification. The source SQLite file remained byte-identical. The sidecar type check and 23 targeted tests passed.

### Current Browser Run storage

The pilot's saved Browser Run routes read, replay, recover and cancel Runs in owner- and project-scoped SQLite. The repository saves the frozen test revision. Starting the same operation reuses its Run, and a second active Run without an environment is rejected. A worker claim has a private token, expiration and heartbeat. Expired Runs become interrupted and retain their saved observations. Claims are cleared at cancellation or completion.

For an admitted environment Run, insertion and the transition from prepared data to `in_use` share a transaction. It rechecks the exact saved profile version and origin, and keeps the resource reserved until cleanup is recorded. A failed preflight leaves preparation alone. Completion, cancellation and interruption mark the original Run's reservation `cleanup_required`. A completed Run and its verified evidence references commit together. The evidence loader reads only the known output files and verifies their size and SHA-256 before storing the bytes.

The desktop's saved-test Start and Cancel requests now drive the existing Browser worker against the local Run store in pilot mode. The Run ID identifies its owner- and project-scoped session files. The sidecar reads the model configuration locally and saves reported usage, including known counts on partial receipts. The final-screenshot route verifies the retained object against the Run. The hosted workspace path continues to use its existing session journal.

The Windows HTTP fixture blocks hosted application-data access. It covers replay, account isolation, stale profile checks, claim fencing, reservation and cleanup, and a failed checksum leaving the original Run unchanged. A second HTTP fixture starts Chromium on a loopback page using a local stub model, verifies a passed check, matches the final screenshot hash, and replays the same Run after reopening the sidecar and workspace. A Chromium fixture also reopens check JSON and usability evidence. Packaged desktop tests and a live model check remain pending.

### Auto Tests and Browser checks from conversation

Auto Test starts, progress, cancellation, startup answers, and the live stream use the local Run service and the owner/project history journal in pilot mode. With a saved local app folder, the launcher uses its existing recipe and startup permission rules. Model attempts and Browser Run usage use local Settings accounting. The process marks unfinished Auto Tests interrupted after a restart. Conversation Browser execution uses the same verification target and approval checks as the hosted workspace path. The chat turn stores the new Auto Test ID and hashes of the verified criteria, and the child session retains its own Browser Run and verdict.

The Windows HTTP rehearsal used a local static project and a loopback stub model. It planned and completed a new Auto Test, reopened the result as a chat attachment, waited for owner approval, and reran the exact saved assertions. Both sessions and the chat link survived a sidecar restart with zero hosted application-data calls. The sidecar type check and 144 targeted tests passed. Managed execution folders for connected-only projects, configured setup/cleanup hooks, and additional diagnostics are still pending.

### Dynamic findings and decisions

The pilot uses SQLite for functional and usability observations, human verification decisions, and remediation history. It collects new observations from completed Runs with retained evidence. Recollecting the same Run leaves its finding version unchanged. A confirmed finding can be resolved only from a completed, evidenced regression tied to the failed observation and frozen test revision. A later failure reopens the finding and keeps the earlier decisions.

The hosted exporter includes finding, observation, and decision rows with their original IDs. Staging validates project, Run, revision, and evidence links. Historical references remain readable when their bytes could not be exported. The Windows fixture verified read and decision routes with hosted application data blocked, preserved an original decision actor, and rejected a stale version and a cross-account read. Additional tests covered recurrence, an unpinned regression, and usability evidence generated by Chromium. The sidecar type check and 34 targeted tests passed.

### Browser Run reports

The existing report panel captures stopped Browser Runs using owner/project SQLite. Capture freezes the Run, its linked finding histories, Run-linked environment events, available usage and the checksum verification status of on-device evidence. It strips runtime-only fields and redacts known local values and paths before persisting the report. Evidence bytes are separate. The authenticated JSON, Markdown and PDF downloads render the stored snapshot and return checksums. Reusing a capture ID in the original scope returns the original snapshot. Historical hosted reports keep their original Run and capture identities during staging.

The Windows export and HTTP rehearsal reopened an archived report from the local store, captured a new report, and verified the three download hashes with hosted application data blocked. Later finding changes and damaged evidence affected a new report while the earlier export remained frozen. The sidecar type check, 34 targeted sidecar tests and two frontend report panel tests passed. Additional diagnostics are still pending.

### Dedicated Unit Runs and reports

The pilot's workspace inspection and authorization routes use the existing installed-Vitest adapter. Packaged authorizations use the device key and are scoped to the owner, project, and environment. SQLite holds Unit Run states, bounded framework results, private worker leases, cleanup events, and frozen reports. Prerequisite failures acquire no environment reservation. An admitted Unit Run excludes new Browser Runs in the same project; terminal or expired work leaves the environment requiring cleanup. Hosted archive staging preserves Unit Run, cleanup, and report identities and marks imported live work interrupted.

The Windows HTTP fixture authorized and ran the installed Vitest suite with hosted application data blocked, recorded manual cleanup, and reopened the original result and report after restart. It verified a PDF checksum and account isolation. The lease fixture checked cancellation fencing and cleanup after expiry. The packaged-key subprocess reopened a device-protected authorization without the legacy environment key. The sidecar type check and 31 targeted tests passed, with six platform-specific tests skipped. Automatic cleanup hooks and packaged desktop execution remain pending.

### Setup and cleanup history

The pilot stores authorized setup and cleanup operations and worker claims in SQLite. Admission reserves environment data and excludes concurrent Browser and Unit work in the project. A successful setup prepares the current profile version. A successful cleanup releases the reservation, and a failed or interrupted operation keeps cleanup required. Configured automatic cleanup rechecks its source Run or setup operation at admission. The hosted exporter and staging preserve operation IDs and mark imported active operations interrupted.

On Windows, the focused suite passed 13 tests with one platform skip. It covered local reservations, exclusion, worker fencing, rejection of a mismatched cleanup source, linked Unit cleanup and hosted archive reads with application-data access blocked. The actual package-manager hook process remains unverified in the Windows pilot.

### Browser sign-in capture

The pilot reserves the environment and records a private capture lease in SQLite. Browser, Unit, and hook admission all check for an open capture. A cancelled or expired capture leaves its environment requiring cleanup. Saving, importing, and forgetting test-target sessions validate the selected profile. Cookies and local storage live in a separately encrypted device file scoped to the owner, project, profile, and reference. The API returns availability and version metadata.

The Windows fixture opened Chromium, saved a synthetic sign-in cookie, reused it in an independent Browser Run, and reopened the session after a sidecar restart with hosted application data blocked. It also covered stale lease recovery and excluded concurrent work. The packaged subprocess read encrypted session state without the legacy environment key. The sidecar type check and 17 focused tests passed.

### Managed app folders

Projects without a selected checkout expose an owner/project managed folder under the local workspace home. The desktop project response reports when app files are present. Auto Tests and chat Browser checks use the same resolver for managed and selected app folders. Connected source sync stores analysis artifacts separately. Put the runnable app in the managed folder or select its checkout through the existing project flow.

On Windows, the HTTP fixture rejected an empty folder and ran a Chromium Auto Test and chat rerun after the fixture app was placed there. The same folder reopened after restart with hosted application data blocked. The connected GitHub fixture confirmed that a completed source import leaves the app folder empty and another owner cannot read it. The sidecar type check, nine sidecar tests, and 15 frontend Check runner tests passed.

### Browser file permissions and control discovery

The pilot stores upload and download permissions with the saved environment profile in SQLite. Changes require the current profile version and preserve the other permission type. Selected upload fixtures and retained downloads use device-scoped vaults. Packaged vault files are encrypted with identity and purpose bound to the file. Saved-session control discovery uses the local session vault and confines browser traffic to the approved target origin.

On Windows, 36 focused tests passed, including a Chromium control scan with a fixture sign-in cookie, permissions and fixture persistence after reopening, a cross-owner denial, and a packaged-key subprocess reopening encrypted vault files. The HTTP fixture verified listing, reading, and deleting a seeded retained download. Live browser download execution remains unverified in this rehearsal.

### Browser Run evidence copies

The pilot's Recorded evidence panel saves copies in the owner/project/Run SQLite scope. Save validates the size and hash, then commits copy metadata and bytes together. Repeating the same operation returns the original copy. Deletion removes the saved copy's bytes and preserves its checksum and history. Device copies have no automatic expiry. Original independent evidence remains separate from the copies, and diagnostic artifacts keep their redaction and explicit non-verdict status. New reports include copy and artifact metadata in their frozen snapshot.

The Windows fixture blocked hosted application data and verified scope, redaction, replay, restart persistence, copy deletion and report capture. Across the focused suites, 18 sidecar tests and nine frontend tests passed. The Windows fixture skipped a symlink test because the environment could not create symlinks. The sidecar type check and frontend production build passed. Packaged desktop verification remains pending.

The account exporter now includes the hosted diagnostic registry, independent and diagnostic copy records, and available copy bytes. Registered artifacts without a copy and expired or deleted copy records keep their IDs and history. The importer validates the Run and artifact links, MIME type, size, and hash in the workspace staging transaction. Diagnostics retain their non-verdict status. An available hosted copy moves with its verified bytes, and its hosted expiry remains visible as history. The receipt counts registrations, copy records, and copied files separately from independent evidence references.

The Windows command-line rehearsal staged the fixture twice and reopened the original diagnostic copy through the local API with hosted data blocked. It rejected another account, a changing hosted evidence inventory, corrupted hosted bytes, and a tampered archive. The type check, 16 focused sidecar tests and nine frontend tests passed. One symlink test was skipped on Windows. The live account export is still pending.

### Live fixture checks for setup, cleanup, and files

The Windows HTTP fixture executed an authorized `pnpm` setup script in an isolated folder. The setup marked its environment ready, and an authorized Unit Run triggered the configured cleanup script. Cleanup removed the fixture marker, released the reservation, and was linked to the Unit Run report. The hook result and checksum-verified redacted output reopened after restart. Another owner could not read the receipt.

The Chromium fixture uploaded the approved bytes to its loopback target and captured the approved download. The Run's independent checks confirmed the upload acknowledgement and download checksum. The file manifest and captured copy survived a restart, and the copy stayed available after deletion of the temporary download. Both rehearsals blocked hosted workspace data. All nine tests passed in the combined Windows workspace, hook, and export suites. The Windows CI job installs Chromium and runs those suites. Packaged Windows and macOS acceptance remains pending.

To check this in the desktop pilot, open a saved Browser Run under Dynamic testing and expand Recorded evidence. On a completed Run, select **Save independent evidence**. On a stopped Run, select **Save diagnostics and captured files** and inspect the available JSON. Restart the app and reopen the same Run. When a saved screenshot copy is deleted, the original Run screenshot remains visible if its evidence is available.

### Encrypted Review batch cache

The local Review runtime stores validated batch records in owner- and project-scoped SQLite and binds them to their origin Review and request hash. Packaged writes use the OS-protected key supplied through the private pipe. The account export carries encrypted hosted cache archives and their receipts. Staging requires the original hosted encryption key to authenticate those archives, then encrypts records under the destination workspace key when the packaged key is supplied. The import checks the staged origin Reviews before committing cache records. The real packaged import flow has yet to be rehearsed.

The local retry route supports explicit reuse with saved sources. It rejects combining reuse and refreshed sources. The orchestrator still requires prior evidence and matching request identity, then reruns its current validators before reuse. Restoring a cache record alone does not validate a batch.

The Windows fixture reopened the encrypted cache after a restart and reran only the uncached batch. The tests also exercised the local desktop retry route, receipt-backed hosted export and staging, checksum rejection, account separation, and device-key storage without the development encryption key. All 38 focused tests and the sidecar type check passed.

### Encrypted workspace backup and restore

Close Centinel and its sidecar, and finish any workspace imports before taking a backup. Supply `CENTINEL_WORKSPACE_BACKUP_PASSPHRASE` through a private process environment. Run the commands against the sidecar home and a private, separate archive directory on a filesystem that supports hard links. Restore requires a new home and an existing parent directory. The backup command reserves the sidecar's configured local port for the duration of the capture.

```text
pnpm --filter @centinel/sidecar migrate:backup <absolute-home> <absolute-new-archive>
pnpm --filter @centinel/sidecar migrate:restore <absolute-new-home> <absolute-archive>
```

The backup snapshots the workspace and project-history databases with SQLite's backup API and checks referenced immutable objects before publishing the encrypted archive. It includes Browser Run diagnostic files, hook and Unit Run receipts, and the existing encrypted vault files. Materialized index stages, external or managed checkouts, process homes, environment configuration files, and hosted OAuth sessions are outside the archive. Published index archives already in SQLite are included. Device-bound vault ciphertext still requires the original device key. Cross-device key recovery needs separate verification. Keep the source or restored workspace closed while preparing a rollback rehearsal. An interrupted process can leave a private `.orin-backup-*` scratch directory alongside the requested output.

The Windows fixture backed up committed WAL data and reopened the exact frozen source, project, chat history, and receipt. Wrong passphrase, truncated archive, damaged source, simulated low disk space, and occupied sidecar port were rejected. An existing backup and an existing destination were preserved. The Windows backup and hosted-export suites passed all five tests, and the sidecar type check passed.

### Remaining cutover work

1. Verify current workflows in the packaged Windows and macOS apps while hosted application-data endpoints are blocked. Verify hosted sign-in, OAuth callbacks and App Connection separately with real accounts.
2. Reconcile the selected staged records at a consistent export boundary before switching workspace writers. The owner deferred the remaining hosted projects and chose to generate new indexes locally as needed.
3. Rehearse switching the workspace writer and rolling back without losing new work. Cross-device recovery of device-bound keys is deferred.

### Packaged pilot checks

To open an imported stage in the packaged desktop app, close the running app and sidecar, then launch ORIN with `CENTINEL_STAGING_HOME` set to the existing absolute staging home. The native launcher uses that directory for its sidecar and enables the local pilot for that launch. The stage must contain `data/local-workspace` and `data/project-history.sqlite` if both were imported. Existing credential envelopes that still use the old server key require that key in the private stage configuration.

1. Launch the packaged executable from a shell that sets the staging home. On Windows, set `$env:CENTINEL_STAGING_HOME` and run `ORIN.exe`. On macOS, set `CENTINEL_STAGING_HOME` on the command that runs `ORIN.app/Contents/MacOS/ORIN`.
2. Sign in with the account that owns the staged projects. Open a project, its chat history, and a saved Review. Open the Review's frozen source preview and verify it matches the historical version.
3. Close and relaunch with the same staging home, then reopen the records. Open App Connections and inspect a real connection. Complete a fresh provider OAuth grant separately to verify the callback, using an account authorized for that integration.

On Windows, the optimized Tauri executable and NSIS installer built. WiX failed at `light.exe` while creating the MSI. The smoke test ran the release-sidecar resources with the bundled Node executable and a loopback Auth/App Connection fixture. It wrote and reopened a local project and exact source bytes, rejected a second account, reopened and activated an encrypted model setting, and reached the integration callback's invalid-input check. The fixture denied hosted workspace data requests. A second run used a real owner session, opened the staged workspace, source version and chat route, and listed live App Connections. The native desktop UI and a fresh provider callback remain unverified. The macOS CI job builds an app bundle and runs the same sidecar smoke inside it. It has yet to run for this worktree.

The live transfer stopped after 16 owned projects were staged. Reconciliation checked 1,643 source versions, 86 Reviews, 30 chat turns and 21 Auto Test sessions. A Windows packaged-sidecar check allowed only live Auth and App Connection requests while opening staged projects, Reviews, chat and Auto Test history. Eleven frozen previews matched their checksums. One connected-source preview returned HTTP 500. The stage is available for local development. The normal desktop configuration still uses the pre-cutover workspace.

Further legacy compatibility is outside the remaining scope. Existing staged import and historical readers stay available.
