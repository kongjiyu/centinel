# Dynamic report snapshots

Dynamic-only immutable exports capture one stopped Run, its frozen Mission revision,
mock incoming source versions when supplied, environment/target/engine versions,
independent checks, usability rules and separately labeled subjective suggestions,
related finding observations and attributable decision/remediation history, recorded
preparation and Run-linked cleanup events, private-copy availability and available
model-usage ledger rows. This work does not aggregate Static risk or implement Static.

## Capture and access

`POST /projects/:project/dynamic/runs/:run/reports` accepts only a fresh UUID
`reportId`. `capture_dynamic_report` reads authoritative shared records; it never
accepts client-supplied results. Only completed/blocked/cancelled/interrupted Runs
can be captured. The same ID from the same actor/Run replays the exact snapshot;
a different actor cannot reuse it. A new ID creates a new historical snapshot.

The additive `202610150007_dynamic_report_snapshots.sql` migration is applied and
registered on Centinel Supabase. The table exposes member-scoped SELECT only;
ordinary users cannot INSERT/UPDATE/DELETE it. Capture uses the existing project
membership model and project mutation lock. Nonmember and revoked access fails.

`GET /projects/:project/dynamic/runs/:run/reports` returns the latest 100 metadata
records. `GET /projects/:project/dynamic/reports/:id` reads a recorded snapshot;
`/json`, `/markdown`, `/pdf` export that selected version. Each request checks the
current bearer and project membership; there are no public/signed report URLs.
Responses are no-store attachments with SHA-256. Snapshots are capped at 4 MiB;
renderings/downloads at 8 MiB. The frontend checks the digest before a user-selected
native save or browser download, and cancels stale selection writes.

Reports remove runtime leases, idempotency/session references, credentials and
local OS paths. They contain no provider prompts or hidden reasoning. Local vault
values are never part of source records. Evidence references do not contain object
paths or grant access. Copy status is explicitly frozen at capture; later expiry,
deletion, finding decisions or cleanup require a new snapshot. Reports are retained
as project history; deleting the parent project removes them. Already-downloaded
exports cannot be remotely revoked.

## Formats and interpretation

JSON and Markdown retain exact Unicode content. PDF reuses PDFKit with fixed
capture metadata and paginated, human-readable sections. The built-in Latin font
replaces unsupported characters with `?` and explicitly discloses that fallback;
use JSON/Markdown for exact non-Latin text. A future renderer change must preserve
version-1 export behavior or add a supported renderer version.

No completed usability assessment is reported as not tested, even if a diagnostic
checkpoint exists. Uncollected findings do not prove absence of defects. Unsynced
proof is local-only, not shared. Missing model token values remain unavailable,
not zero; cost is not inferred. Functional verdict, rule observations, subjective
advice and human finding decisions remain separate. Detailed reproduction records
identify original Run/revision/actor and proof IDs.

## Verification on 15 October 2026

- 569 sidecar tests, 244 frontend tests, TypeScript and frontend build passed.
  One full frontend attempt timed out in an existing exploration test during
  concurrent builds/tests; the complete frontend rerun passed without changes.
- All 30 isolated Dynamic SQL suites passed, including stopped-only capture,
  replay/history, direct mutation denial, member/nonmember and revoked access,
  local-path/credential-key removal and preservation of unknown usage values.
- Real Codex cancelled Run `763fe3b8-1da3-4b74-bd8e-4e2ee69a6b15` captured as
  report `243cd6be-c880-4479-a4ba-e00fb3153cc2`: cancelled/not_tested, zero collected
  findings, one available ledger row and partial usability diagnostics disclosed.
- Real Codex completed Run `113e965b-ef58-4a39-bdf8-0174ded5b5c8` captured as
  report `aeb26ffe-6f91-4416-b9c3-0675e9516940`: functional passed, two usability
  findings with attributable review/recurrence history, two ledger rows. A second
  member read and downloaded all formats; SHA-256 and repeated exports matched.
- Reader captured a separate snapshot through the actual UI and downloaded all
  three formats. Inspected 1440×900, 1200×900 and 390×844; the narrow table scrolls
  inside its keyboard-focusable region without document overflow. Scoped CSS.
- Final completed PDF is seven A4 pages. Inspected first/reproduction pages and
  verified exported text contains the selected Run and required sections.

Reproducible harness: `sidecar/__tests__/acceptance/reportLive.ts` requires
`CENTINEL_RWA_QA_PROJECT`, ignored QA credentials and the owned sidecar. Optional
`CENTINEL_REPORT_ACCEPTANCE_IDS` reuses the two recorded IDs in cancelled/completed
order. Local audit outputs remain ignored under `output/playwright` and `output/pdf`.
No target application was modified by report acceptance. Preliminary development
snapshots are retained and are not extra browser execution samples.

Real API-provider acceptance is deferred by the user. Packaged Tauri launch/save,
broader evaluation and unit-run report integration remain M6/M7 gates.
