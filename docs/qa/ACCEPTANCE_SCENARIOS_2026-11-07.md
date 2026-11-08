# PRD §13.2 acceptance walk-through (7–8 November 2026)

Build: packaged macOS app built locally with `pnpm build` from `main` (first at `39612eb`, rebuilt at
`c4d1a42`, and again with PRs #76, #77 and #79), run from the repository build folder with its bundled sidecar.
Signed in to the hosted Supabase project as the test owner. Static Review model: Codex through the
user's ChatGPT login; embeddings: Voyage. Targets: the bundled Sample Shop (app copy in
`~/Library/Application Support/com.centinel.app/samples/sample-shop`, port 4100) and the Cypress Real
World App (port 3000).

Legend: **Pass** = shown in this build with the evidence listed. **Partial** = part shown here, the
rest relies on earlier recorded evidence. **Blocked** = needs something not available in this session.

| # | Scenario | Result |
|---|---|---|
| 1 | Import, Review with evidence and traceability, attributable decision | Pass |
| 2 | Update a source, show currency without rewriting old snapshots | Partial |
| 3 | New shared project runs Dynamic through its own identity | Pass |
| 4 | Static requirement → mission, execute, keep criteria and evidence | Pass |
| 5 | Normal path, seeded defect, provider outage, unreachable target | Partial |
| 6 | Exploratory mission discloses unvisited scope | Pass |
| 7 | Repeat a saved mission, keep both runs and history | Pass |
| 8 | Cancel, and reconcile an interruption without a false state | Pass |
| 9 | Test-data preparation, repeatable state, collisions, cleanup failure | Partial (earlier evidence) |
| 10 | Usability observation with evidence, subjective kept separate | Pass |
| 11 | Passing and failing unit tests, runner errors distinguished | Partial (earlier evidence) |
| 12 | API and Codex modes independently | Blocked (no API key configured) |
| 13 | Export report; member can, non-member and revoked member cannot | Partial |
| 14 | No seeded secrets in prompts/logs/reports; endpoint authorization | Pass |

## Scenario details

### 1. Import, Review, traceability, decision — Pass
- Review `ca34f0c1` "Acceptance S1 sample shop" on project Sample Shop (`982f9847…`): succeeded, 6 findings:
  account enumeration `server.js:45` (planted REQ-1), missing server-side quantity validation
  `server.js:65` (planted REQ-3), order identifier collision `src/orders.js:30` (real), and 3 rule
  findings (hard-coded secret `src/users.js:3`, `innerHTML` `public/app.js:19`, `console.log`).
  The planted REQ-4 order-ownership bug was correctly not reported: this app copy already had that fix
  since 5 November.
- Decision "changes requested" with a comment, recorded with the actor at 15:10:08 UTC. The revision
  Review `05da0e6a` (refreshed sources) succeeded with 7 findings, again including REQ-1 and REQ-3.
- Traceability tab: 21 requirements shown as Missing (no confirmed links). Finding: suggested
  requirement links were never saved in production because the refreshable repository proxy did not
  forward `saveRequirementLinkSuggestions`; fixed in PR #73.

### 2. Source update and currency — Partial
- Added server-side quantity validation to `server.js` in the app copy, refreshed sources and ran Review
  `51cb8572` "Acceptance S2 updated source": succeeded, 6 findings. The REQ-3 quantity finding is no longer
  reported; earlier Reviews keep their own quantity findings unchanged (four stored rows, status new).
- Correlation against 4 earlier Reviews: 11 carried over, 5 recurring, 2 new, 0 resolved, 1 ambiguous. The
  old quantity issue stays *carried over*: the independent support check contradicted one AI observation
  in `server.js` (`candidate_contradicted`), so `server.js` has no inspected-location proof and absence
  cannot resolve the issue. This is the conservative rule working, not a defect, but resolution was not
  shown live.
- Suggested requirement links (PR #73) now save in production: `requirement_links_suggested` with 2
  suggestions and 2 `requirement_mappings` rows with `coverage_status = 'suggested'`.
- The Review stalled for about 9 hours before this run (PR #76) and did not resume after a quick
  restart (PR #77). After both fixes it recovered (`review_lease_recovered`, attempt 2) and finished.
  Lease-recovery batch reuse (#65/#73) was not observed in this Review: the restart came 7 seconds after
  the first batch's support check, before its cache record was saved, so that batch ran again.
- Dedicated reuse check (8 November): Review `69d85356` was quit 6 s after batch `294295c1` was cached
  and relaunched once its lease expired. Recovery started at once (PR #77), but the batch ran again with no
  reuse or rejection event: its cache key differed between runs (`0232…` vs `37a9…`). Cause: the prompt
  embedded the frozen traceability records with `JSON.stringify`, and the resumed run reads them back
  from `jsonb`, which reorders keys. Fixed in PR #79. Repeated on the fixed build with Review `a99b594b`:
  quit 13:47:57, relaunched 13:48:20, and batch `294295c1` was reused
  (`review_batch_cache_reused`, `reuseKind: lease_recovery`, 1 provider call avoided, same
  `requestHash` `fff25237…`). The Review succeeded with 5 findings. Batch `2d450356` was not cached
  either time because its support check contradicted a candidate, which correctly prevents reuse.

### 3. New shared project — Pass
- Project "Acceptance S3 new project" created in the UI from a local folder; Dynamic Run `0021ad2e`
  completed / passed against the Real World App with 1 check passed. No earlier local project record
  was involved.

### 4. Requirement → mission — PENDING
- "Test in Dynamic Testing" from a Review prefilled Criteria source = Requirements from a Review, the
  source Review marked "Not approved", and required an acknowledgement before saving (verified).
- First run `70d28d9b` was blocked: the browser agent only received the goal, not the selected
  criteria. Fixed in PR #74 ("What this test checks" section and a prefilled goal naming the criteria).
- Rerun on the build with PR #74 (8 November): Run `06313068` of the same saved test (revision 1)
  completed / passed in about 13 s. Its one check kept the Review-sourced criterion ID
  (`…:statement`, "Catalogue accessible without sign-in"), observed "Expected visible text found" and
  linked an evidence ID; the Run stored 2 evidence items. The earlier blocked Run `70d28d9b` stays in
  the history.

### 5. Normal, defect, outage, unreachable — Partial
- Normal path: Run `0021ad2e` passed (scenario 3).
- Unreachable target: Run `d4115c8e` against `localhost:3999` ended blocked / not tested in about
  1.5 s with "Browser target connection unavailable", an environment block, not a defect. The open Run
  panel kept showing "Running" until reload; fixed in PR #75.
- Seeded defect and provider outage: not re-run in this build; earlier evidence in
  `docs/dynamic/` acceptance notes.

### 6. Exploratory mission — Pass
- Run `c3159a39` (before PR #74) recorded `mode: exploratory`, `exhaustive: false`, limits of 25 actions
  and 51 states, and limitations including "Unvisited controls are not a complete inventory"; it stopped
  on the home page because the prompt lacked the checks.
- Rerun on the build with PR #74 (8 November): Run `8bf6d700` of "S6 exploratory catalogue" completed /
  passed. Its objective check ("Products" visible) passed with screenshot evidence on the first state, so
  the explorer took 0 actions. The Run records `mode: exploratory`, `exhaustive: false`, `truncated: false`,
  1 sampled state, **9 unvisited controls** (the "Add to cart" buttons and others) and the three stated
  limitations, including that unvisited controls are not a complete inventory and that visits do not
  establish a pass.

### 7. Repeat a saved mission — Pass
- Three Runs of the same test kept as separate history (passed, cancelled, passed). Rename and archive
  (PR #70) keep the revision and history; archived tests cannot be edited or run until unarchived.

### 8. Cancel and recover — Pass
- Cancel: Run `17ff3fe5` stopped mid-run ended cancelled / not tested, "Cancelled by a project member";
  the earlier Run was kept. While running, a second start was refused ("A test is already active").
- Interruption: quitting the app during Review `ca34f0c1` and relaunching produced
  `review_lease_recovered` (14:59:12), reused the source manifest, and resumed model analysis.

### 9. Test data — Partial
- Not re-run in this build. Earlier live evidence: `docs/dynamic/DYNAMIC_DATA_LIFECYCLE.md`.

### 10. Usability — Pass
- Run `0021ad2e`: 18 deterministic observations (labels, keyboard, focus; passed / failed / uncertain)
  and 3 subjective suggestions stored with `kind: subjective`, evidence IDs and a caveat that they do
  not establish a defect. The UI states that Dynamic findings stay separate from Project Assessment.

### 11. Unit tests — Partial
- Not re-run in this build. Earlier live evidence: `docs/dynamic/DYNAMIC_UNIT_TESTS.md` (RWA Vitest:
  54 tests, 44 passed, 10 skipped).

### 12. API and Codex modes — Blocked
- Only Codex (Static Review, vision) and Voyage (embeddings) are configured. API mode needs a provider
  key from the user; Codex alone does not pass this scenario.

### 13. Export and member access — Partial
- Member export (8 November): "Create report" on the Sample Shop project produced a report with PDF,
  Markdown and JSON download links, labelled "Pre-release review", with links that expire after
  15 minutes ("Export again for fresh links").
- Collaborators tab lists members and adds by e-mail with an access level. Second-member and revoked
  access were not re-run (they need a second hosted sign-in); earlier evidence:
  `docs/dynamic/DYNAMIC_PRIVATE_EVIDENCE.md` (reader could read; non-member got 403).

### 14. Secrets and authorization — Pass
- Secret scan of 23,290 local files and 1,174 tracked files: 0 hits for the three seeded secret names.
- Packaged `runtime.env` holds only the public Supabase URL and publishable key.
- Six protected sidecar routes return 401 without a bearer and with a fake bearer.
- The anon role reads no rows from projects, Reviews, findings, members or artifacts, cannot read
  Dynamic runs (42501), lists no Storage objects, and cannot call `update_dynamic_mission`
  (grant tightened in PR #71).

## Problems found and fixed during the walk-through

| PR | Problem |
|---|---|
| #71 | New `update_dynamic_mission` RPC was executable by the anon role |
| #72 | Projects list showed a project as Failed from an older failed Review after a newer success |
| #73 | Suggested requirement links and recovery-journal reuse never ran in production (proxy did not forward the methods) |
| #74 | Browser agent did not receive the selected criteria of a test |
| #75 | Open Run panel kept showing "Running" after the Run ended |
| #76 | A Review stalled 9 hours: the TypeScript callback checker searched the real disk for `node_modules/@types`, and in a build under `~/Documents` that read waited on an unanswered macOS privacy prompt, blocking the sidecar. The checker now reads only frozen sources; Supabase bodies also time out after 15 s without data |
| #77 | After a quick restart, Review recovery ran before the old lease expired and never checked again, so the Review stayed "running" with no worker. Later requests now re-check at most once a minute |
| #79 | Lease-recovery batch reuse never hit after a restart: frozen traceability records read back from `jsonb` had reordered keys, so the prompt bytes and the batch cache key changed. Prompt now uses sorted-key JSON |

## Limits
- Scenarios 9 and 11 rely on earlier recorded evidence; 12 needs an API key; 13's second-member and
  revoked checks need a second hosted account (this session does not sign in to hosted accounts).
- Scenario 2 did not show a resolved issue live; see its details.
- Run from a build inside `~/Documents`, so macOS privacy prompts appeared after each rebuild. An
  installed app in `/Applications` asks once per protected folder.
