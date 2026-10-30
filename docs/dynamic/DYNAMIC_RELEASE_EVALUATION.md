# Dynamic release evaluation checkpoint

Historical checkpoint: this records the predeclared six-sample Codex corpus on engine `44916ff991439a6f824a1347798e3578c9ce88e6`. Final agreed-scope acceptance is recorded in the closure below. Static is excluded; real API-provider acceptance is deferred by direct user decision. At that checkpoint native Centinel GUI/export was blocked by Mac lock and CLI Accessibility; the later native closure below supersedes that status.

## Fixed-corpus outcomes

| Variant / repeat | Run | Functional | Rule failures | Criterion coverage | Reader proof | Elapsed ms | Steps / model calls |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| normal / 1 | `bdd3ef8f-c490-4ac5-863b-a82248981292` | passed | None | 1 / 1 | 3 / 3 | 8194 | 5 / 1 |
| normal / 2 | `12ae1bad-ca4a-41d8-87e9-d2ab13a92080` | passed | None | 1 / 1 | 3 / 3 | 8073 | 5 / 1 |
| normal / 3 | `d69dadc5-e3e0-41cc-89f4-36dab263e619` | passed | None | 1 / 1 | 3 / 3 | 6021 | 5 / 1 |
| defect / 1 | `ede449eb-8191-42e1-b5fe-13b04f79c762` | passed | labels, keyboard | 1 / 1 | 3 / 3 | 6614 | 5 / 1 |
| defect / 2 | `88a9141c-06c0-4dfa-a36c-8268f17e0924` | passed | labels, keyboard | 1 / 1 | 3 / 3 | 6066 | 5 / 1 |
| defect / 3 | `20acb82a-f549-453e-a42e-5283a6415a76` | passed | labels, keyboard | 1 / 1 | 3 / 3 | 6724 | 5 / 1 |

All six functional outcomes matched the declared Ready criterion. Normal had 0/3 failed label/keyboard observations; both planted rule failures repeated in 3/3 defect Runs. All 18 recorded proof slots were fetched by Reader with matching SHA-256. Median elapsed time was 6669 ms; this corpus has no latency or cost threshold.

These are two planted rule defects on a tiny public fixture. There is no broad usability recall, real-user-study or complete accessibility claim. Explicit QA simulations confirmed the two correlated candidates; this is not stakeholder approval. The final report is `3c479bb7-faae-4a02-af4a-a946970a3628`, preserving three observations per finding, attributable review and mock source coverage.

One budget receipt was absent at its first terminal read and collected afterward from the same immutable Run’s device-local receipt. No sample was rerun or replaced. A setup attempt supplied an unsupported mock deployment version and was rejected before any browser Run; its local audit is retained. Mock deploymentVersion remains unknown/null.

## Scripted baseline and available usage

Installed Codex CLI: **0.162.1**. An independent script used Playwright accessible-role lookup and four explicit Tab presses, without importing the Centinel assessor. Normal exposed the name field and reached it by keyboard; defect exposed no configured name and Tab did not reach it. Baseline elapsed times were **222 ms normal / 46 ms defect**, with **0 model calls**. These pre-scripted selectors do not include AI planning; the timings are not a general comparative performance result.

| Sample | Model calls | Input | Output | Cache read | Cache creation | Accounted tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| normal 1 | 1 | 12399 | 38 | 4608 | Unknown | 12437 |
| normal 2 | 1 | 12399 | 38 | 9600 | Unknown | 12437 |
| normal 3 | 1 | 12399 | 37 | 9600 | Unknown | 12436 |
| defect 1 | 1 | 12397 | 38 | 9600 | Unknown | 12435 |
| defect 2 | 1 | 12397 | 36 | 4608 | Unknown | 12433 |
| defect 3 | 1 | 12397 | 36 | 4608 | Unknown | 12433 |

The two declared planted rule failures were detected in all three defect repetitions (6/6 declared observation opportunities). Zero failed label/keyboard observations occurred on the normal page. Both correlated candidates were reviewed under the documented QA simulation, with three matching observations apiece. Broader finding precision/recall remains unmeasured; no additional application defects or cost values are inferred.

## New-project identity

New shared project `be7c5caf-d667-4b60-88d1-1ef5aac7748c` created and executed Run `f49ab001-249e-414f-b7bb-c6e8c15517b3` through bearer Supabase and real Codex: completed/passed, one check and two proof slots. No old local project record existed before start. A local legacy mirror became observable in a fresh process later; it was not a prerequisite. An authenticated member of the other QA project was denied with HTTP 403.

An initial harness incorrectly expected the local mirror to be immediately present after the terminal response. The preserved completed Run was re-read after correcting that assertion; no replacement Run was created. Empty project source inventory and explicit mock context were used; no Static Review was performed.

## Packaged build checkpoint

On macOS 26.6.2 (25G83), arm64, `pnpm build` passed and produced `Centinel.app` and `Centinel_0.0.1_aarch64.dmg` (application version 0.0.1). DMG SHA-256: `87fa002565278f72f2a004a068cef5b5de9c2a20e36a4188aea9c41cd494c690`.

Launched the built app in the background through the native launcher and verified its running executable points inside this worktree’s release bundle. This proves process launch, not sign-in, rendered UI, Codex use or native save. Those remain required after unlock. The package is a local development build, with a separately configured local sidecar and no signing/notarization claim.

## Remaining M7 work

- Broader metric/coverage and acceptance matrix audit beyond this declared tiny corpus.
- Explicit PRD 3–14 evidence matrix; scenario 12 API live portion remains deferred, and 1–2 Static scenarios are excluded.
- Current runtime interruption/recovery, offline upload, expired/refreshed/revoked access, authorization and seeded-secret checks where existing evidence is insufficient.
- Packaged client sign-in, live Codex/executable configuration and native verified report save.
- Setup/demo/recovery guide, known limitations, release checklist and full completion audit.

Raw snapshots and audit JSON remain ignored under output/playwright and output/pdf. No primary or browser-target data was changed by this read-only corpus.

## Final agreed-scope acceptance — 15 October 2026

The two remaining gates were exercised after the user unlocked the Mac. Native
UI actions used the available bound-app computer-use tool; the separate
cua-driver CLI still lacks Accessibility permission and was not used to bypass it.
No application permissions or security settings were weakened.

### Genuine expired and refreshed access

The original Reader token issued at 2026-10-14 20:44:35 UTC expired at 21:44:34 UTC.
At 21:44:40 UTC (05:44:40 on 15 October, Asia/Kuala_Lumpur), the same expired JWT
received 401 for both retained report and private proof. Explicit refresh returned
a new legitimate token, report access returned 200, and proof SHA-256 matched.
No project-wide Auth setting changed; no token was forged/logged or replaced to
avoid the actual expiry wait. Audit: output/playwright/access-expiry-live.json.

### Packaged native client

The exact local app bundle described above was inspected through its native
WKWebView (`tauri://localhost`). The previously locked/backgrounded window first
appeared blank; one normal Reload displayed sign-in. QA email/password sign-in
succeeded. The first workspace load encountered a transient server-side
`JWT issued at future`; one visible Retry loaded the workspace. These are retained
interventions, not a claim of flawless unattended cold startup. After the workflow,
the exact owned app was terminated/relaunched; persisted sign-in and rendered
workspace restored directly without either intervention. No startup code changed.

Settings discovered the configured Codex CLI, showed Connected, loaded the real
model catalog and passed both Test text and Test screenshot with `gpt-5.6-sol`.
Review settings and API provider configuration were left unchanged.

Through the packaged UI, selected the new shared project and reran its immutable
read-only Ready mission. Run `6b8f4ce3-62cc-4a14-ae05-a95556b31b8a` completed/passed
with one independently passed check and two evidence slots. Model usage records
one successful Codex/gpt-5.6-sol call. This manual mission deliberately has no
incoming source denominator and no saved environment; it adds no sample to the
predeclared six-Run corpus and performs no writes to the target fixture.

Native UI synchronized both proof slots, displayed verified shared screenshot,
and captured report `f9880041-ba15-4b19-8e0c-2cf108c19438`. Keyboard focus exposed
the JSON/Markdown/PDF export buttons, and all three were saved through actual
macOS Save Dynamic report dialogs. The UI reported Report saved. Files were read
back from Documents and compared byte-for-byte with authenticated downloads:

| Format | Bytes | SHA-256 |
| --- | ---: | --- |
| JSON | 5613 | fffaa341b2975748e9ced9c06d4145c890307734de2f554cee0af6a8c11b2f32 |
| Markdown | 5490 | 90fff3689273138afd81be0e11b624027cde69788f0ed898a36871461a8ce981 |
| PDF | 5273 | 52d1c20f99cf0310e4f2ed595778eb555e9e9040853015ffc3cb7f81c1e6ce7a |

The snapshot's retained Run fields matched the shared Run, and both private proof
hashes matched. The other project's Reader remains intentionally a nonmember of
this new project and was denied report/proof access (403); authorized Reader
exports on the original QA project are recorded in the earlier corpus/report
gates. No membership was expanded for this test.

The readback harness initially assumed that Reader belonged to this new project,
and then compared the report's deliberately reduced Run projection with the full
Run DTO. Those two assertions were corrected to the actual membership/projection
contracts; original files, Run, report and permissions were preserved. Final
readback passed without rerunning/replacing the native mission. Harness:
`nativeExportVerifyLive.ts`, requiring CENTINEL_NATIVE_EXPORT_DIRECTORY. Audit:
output/playwright/native-export-verified.json; observed final UI screenshot:
output/playwright/native-report-saved.png. Native artifacts remain in Documents
with the report ID in their filenames and are not committed.

### Completion audit and limits

The requirement/scenario map in DYNAMIC_RELEASE_CHECKLIST.md was inspected against
retained browser, lifecycle, finding, report, unit, corpus and security audits.
Static scenarios 1–2 remain excluded; scenario 4 uses mock provenance; scenario
12's real API portion remains explicitly user-deferred. Within that agreed scope,
P0–P7 required implementation and bounded acceptance gates are satisfied.

Current sidecar TypeScript passes; the process-change suite passed 582 tests / 83
files. Before the summary correction, the frontend suite passed 246 tests / 48 files;
afterward the complete suite passed 247 tests / 48 files with two workers and
a 15-second test bound. A default-parallel attempt had 16 unrelated 5-second
timeouts, all retained in the local log; no assertion failures were suppressed. The 31 Dynamic SQL suites
were rerun successfully against the isolated PostgreSQL upgrade fixture. No SQL source changed since engine 44916ff; client changes after that package
are limited to the explicitly recorded summary correction below; the later runtime
change is local process exclusion, with actual worker SIGKILL/restart and post-change
RWA unit acceptance retained in DYNAMIC_RELEASE_RESILIENCE.md. Runtime sidecar is
8e2f849 plus documentation/harness-only commits. The acceptance harness/records do not change execution or persisted schemas. There are no hosted CI checks; these are local/live checks.

This is the agreed local Web Dynamic release, not whole-product Static acceptance,
API live acceptance, a native-desktop SUT adapter, a signed/notarized installer,
a bundled-sidecar distribution, broad accessibility certification, real-user
research or a general defect-recall benchmark. Known limits in the checklist
remain visible; no missing metrics are inferred as zero.

### Late native-discovered summary correction

The restored Home screen exposed a misleading legacy summary: a blocked private
check with reason Independent checks: uncertain was titled Failed. Commit
029c778 keeps blocked Dynamic sessions labeled Blocked and generic legacy failures
labeled Needs attention. The canonical Run still displays its independent verdict;
no free-text reason is parsed into an invented verdict. Projects' existing
needs_attention filter now uses the matching Needs attention label. Static
session status/logic, CSS, risk aggregation and persisted contracts are unchanged.
A focused uncertain-result regression joins the existing blocked/filter tests.

Live browser Home was inspected at 1440×900, 1200×900 and 390×844: actual blocked
state and uncertain reason remain visible, no Failed heading and no page overflow.
This revealed an acceptance-harness assumption that the actual blocked fixture
should be Needs attention; the assertion was corrected to Blocked without changing
the retained data. The existing package's native workflow above remains evidence
for the unchanged sign-in/provider/run/export implementation; the final label-only
package build and rendered status check are recorded below.

During a diagnostic process listing, command arguments inadvertently exposed the
dedicated synthetic QA password. It was immediately rotated through authenticated
Supabase Auth, repository-root ignored .env updated (0600), and this run's CLI text
artifacts checked (no password found). No other account was changed. Subsequent
process observations omit command arguments containing credentials. No password,
token or refresh secret is included in committed evidence. This operator incident
is distinct from the seeded private-input engine acceptance.

### Final package after summary correction

`pnpm build` completed both bundles with the existing large-chunk warning; no
signing/notarization claim is made. Source commit 029c778, final DMG SHA-256:
`d35dcc609b301750640d8db81257cb55bb2e9b2fc00855e94174ba0704486fb2`.
The exact rebuilt bundle was relaunched and signed in with the rotated QA
credential. Synthetic keystroke entry initially produced invalid credentials;
replacing the secure field with bound-app paste succeeded. A brief authentication
loading error was superseded by the rendered workspace without a successful Retry
click. The final native Home shows Blocked with Independent checks: uncertain;
no Failed heading. Screenshot: output/playwright/native-summary-final.png.
No sign-in/provider/execution/report-save implementation changed in the summary
commit, so the preceding full native workflow/three-format readback remains
applicable to those unchanged paths. The label fix additionally passed the full
247-test suite, production build and Home/Projects screenshot/overflow checks at
1440×900, 1200×900 and 390×844. CSS was unchanged and unrelated screens' existing
full tests stayed passing. Audit: output/playwright/summary-final-acceptance.json.

The completed test logs, original expired-token result, native export readback,
current native rendering and unchanged shared contracts close the required-scope
release audit. Remaining exceptions are exactly the explicit scope decisions and
known limitations in DYNAMIC_RELEASE_CHECKLIST.md; they are not silently passed.

## Representative authenticated RWA repeat closure

The complete-scope audit reopened the representative repeated-flow gate: the
original 3+3 Ready/usability fixture alone was too narrow. Protocol commit
`916a027` fixed the new counts, mission, expected outcome and restoration rules
before any new eligible Run. This supplement uses the real pinned RWA on
3014/3015, not a simplified replacement webpage. The tiny usability corpus remains
separate; its samples were not replaced or mixed into these six outcomes.

All six Runs used revision `072ec941-59f0-48f2-a774-f6805b7f76e7`, changing only a
fictional user's First Name, submitting Save once and independently navigating
away/back to verify persistence. Normal source produced 3/3 passes. The declared
no-op source returned success but retained the old value, producing 3/3 independent
failures. Source hash, exact original database hash, account, field expectation,
allowed origins and budgets were controlled; variant names were not injected into
the goal. Existing seeded data was preserved; no seed/reset command was run.

| Variant / repeat | Run | Check verdict | Durable elapsed ms | Steps / calls | Recorded accounted tokens | Reader proof |
| --- | --- | --- | ---: | --- | ---: | --- |
| normal / 1 | `cf177170-366b-4a06-8c2d-89bcf18484da` | passed | 46825 | 6 / 6 | 76985 | 2 / 2 |
| normal / 2 | `10f8c346-00e4-4a94-b9f3-c0d3be737b17` | passed | 48231 | 6 / 6 | 76991 | 2 / 2 |
| normal / 3 | `3297ddea-09a6-4f99-a036-acdfbcbe9f2c` | passed | 43019 | 6 / 6 | 77023 | 2 / 2 |
| defect / 1 | `fbf00e40-03ba-4aef-ae55-4b987793e5da` | failed | 43806 | 6 / 6 | 77014 | 2 / 2 |
| defect / 2 | `d5880119-ee07-47fa-9257-4283b26738a7` | failed | 42748 | 6 / 6 | 77082 | 2 / 2 |
| defect / 3 | `f3a7ef93-b116-499c-ae47-f17365a87298` | failed | 39573 | 6 / 6 | 76977 | 2 / 2 |

Execution completion and expected-outcome agreement are 6/6. Functional task
completion is **3/6**: the three defective submissions did not satisfy the task,
even though their detected failures are the correct benchmark result. The selected
manual test criterion was observed in all six; this manual mission has no incoming
Static requirement denominator. Broader requirement coverage remains the separately
labeled mock-source corpus, not invented real Static coverage.

Every case dispatched one Save. Each normal edit was restored through the target's
authenticated API, with the full database bytes/hash verified back to the frozen
baseline before the next sample. Defect cases left those bytes unchanged. All six
recorded cleanup and forgot their imported local sessions. Primary and independent
unit databases stayed unchanged. Only the owned isolated API was stopped/restarted
for the exact no-op patch; its original source bytes and normal service were
restored and verified after the last sample.

An independent Playwright script (no Centinel planner/checker imports) verified
normal persistence and defective non-persistence. Task-section timings were
805 ms normal and 1493 ms defect, with zero model calls and one Save each. Its
pre-scripted locators and timing boundary differ from the agent Run, so this is
not a general speed or effort comparison. Agent elapsed time has no release
latency threshold. Costs remain unavailable; token counts are recorded budget
receipts, not an inferred bill.

All 12 check-proof slots were synchronized and downloaded by the authorized Reader
with matching SHA-256. The three failed checks correlated into finding
`5429e782-0d1f-4e3b-8f25-36d19c08e969`, with three retained observations. Reader
confirmed it under an explicitly labeled QA simulation against source/scripted
truth; this is not stakeholder approval. No normal candidate was generated.
The finding remains distinct from remediation; removing the fixture patch does
not silently resolve it without a pinned retest/decision. This one planted defect
supports only this fixed-case agreement, not broad application precision/recall.

Report `5596064a-ae0c-49ce-a707-2457ed95d5e9` preserves the reviewed finding and
three observations. Reader verified authenticated JSON/Markdown/PDF exports and
hashes. Audit: output/playwright/rwa-corpus-verified.json; every original sample
and independent baseline is retained separately. A fixture-variable probe stopped
before any Run; the known public seed credential was then verified against the
frozen account's hash. No eligible Run was discarded, retried or replaced.

Reproduction tooling: rwaCorpusCaseLive.ts (one numbered sample; refuses an
existing sample journal), rwaCorpusBaseline.ts (independent truth), and
rwaCorpusVerifyLive.ts (all samples/proofs/report readback). All require the owned
baseline and local QA/Reader configuration. The optional fixed-label/revision and
API-restore flags in rwaCrudLive.ts leave its existing modes available. Explicit
online TypeScript checks passed for the changed/new harnesses. No Centinel runtime,
UI, dependency lockfile or schema changed in this supplement; prior full-suite,
SQL and packaged checks therefore remain applicable.

This representative result closes the extra P7 gate identified by the final
fidelity audit. The complete agreed Web Dynamic/Vitest/Codex-live scope now has
both the required capability evidence and representative repeated-flow evidence.
Static and native-desktop SUT remain excluded/optional; API live remains the
user's explicit deferred item. Other documented measurement/distribution limits
remain limitations, not untested features relabeled as passed.

Source/service restoration for this supplement was performed as an explicit
operator finalization stage after all six stopped/cleaned samples; the case harness
itself does not automatically restart the target API on operator interruption.
If reproducing it, retain the current sample journal and inspect/stop active work
before restoring the exact original source and normal listener. Never discard a
pending sample or remove a dirty resource lock to continue scoring.
