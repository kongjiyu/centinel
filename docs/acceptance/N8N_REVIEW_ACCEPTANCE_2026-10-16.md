# n8n Review workflow acceptance

Prepared 16 October 2026; final checks 17 October 2026 (Asia/Makassar). The authorized model-backed review completed and awaits the user's human decision. **Overall workflow acceptance is partial**, with import, traceability, output-quality and build gaps recorded below. This is a scoped code-review benchmark, not acceptance of the entire n8n platform. The dated preparation history below records earlier states; this current verdict supersedes those states.

## Current acceptance verdict

Project: **n8n PR #41134 Acceptance**. Finished review: **558cc99b**, **n8n Observer N1-N5 Acceptance - 250f2610 (Retry) (Retry)**. All five production harness stages completed; one successful Codex/gpt-5.6-sol attempt; five frozen inputs were read and hash-checked. Human decision: **not recorded**.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| C1 Project and connected source | Persist project, URL, import state and readable sources | Partial | Broad n8n sync imported 423 items then timed out saving a source item; Error / Not Synced Yet, not complete |
| C2 Reproducible review scope | Read pinned final sources without mixing moving-branch inputs | Passed for five-input benchmark; evidence UI gap | Final/base provenance verified; retry Overview shows artifact count unavailable despite five hash-checked harness reads |
| C3 OpenAI provider | Account-scoped connection, saved model and actual inference | Passed in executed run | Login renewal may be required for future runs |
| C4 Start and progress | Normal launch, durable history, actual attempts and stage outcomes | Passed | Initial queue stall required lease/checkpoint adapter fix |
| C5 Grounded output | Real paths/lines and trustworthy actionable findings | Partial | Model locations valid; two critical deterministic alerts are test-fixture false positives; no requirement links |
| C6 Reference comparison | Compare final revision with the completed upstream review | Partial | No false claim that resolved COMPLETED-marker defect remains; two extra model concerns predate PR; no criterion-by-criterion model verdict or historical detection replay |
| C7 Failure honesty | Failed work stays failed and does not invite approval | Partial after fixes | Failed alias corrected and tested; generic overview copy/count and terminal toast behavior beyond failed alias remain limited |
| C8 Human decision and persistence | Saved evidence remains readable; explicit human approval/rejection | Partial | Analysis awaits user decision; no confirmed requirement records; source-manifest count unavailable on final retry |
| C9 Privacy and usage | Metadata excludes prompts/source bodies/private reasoning; usage is actual | Passed for inspected evidence | One attempt: 40,700 input / 1,429 output tokens; not an exhaustive privacy audit |

No approval, finding dismissal, source deletion, commit, push, schema reset, or GitHub comment was performed. Web end-to-end parity and packaged-release acceptance remain unverified. Existing build/retry-test failures prevent release acceptance.

## Findings adjudication

The final review persisted **12 findings: 10 deterministic and 2 model**, with no automatic human decision.

| Finding | Evaluator assessment | Acceptance implication |
| --- | --- | --- |
| `fe97c0be`, critical secret alert, observer test line 361 | Deliberate dummy token in the redaction test at lines 338–410; the test asserts it does not appear in rendered output. False positive as a credential-leak claim. | Do not accept Critical risk at face value or remove the fixture |
| `9cbc8d8b`, critical secret alert, observer test line 352 | Deliberate dummy API-key fixture in the same redaction test. False positive as a credential-leak claim. | Context-aware deterministic triage is needed |
| `7fc559a0`, medium, parser/output-schema mismatch, observer source line 31 | Parser allows hyphens/arbitrary indentation while prompt lines 35–43 and 138 prescribe star bullets and one child depth. Real consistency concern; regex already exists in the base revision. Upstream intent should decide whether tolerant parsing is deliberate. | Grounded additional concern, not a newly introduced PR defect |
| `a587c729`, medium, non-atomic persistence, observer source line 317 | Source appends entries individually, then advances the cursor. A later storage failure could retain earlier entries; persistence adapter behavior and failure injection were not tested. Loop already exists in base. | Plausible pre-existing reliability concern; not evidence that malformed-response rejection fails |
| Eight `cq-deep-nesting` warnings | Generic maintainability heuristics over the supplied production/test files, not demonstrated N1–N5 functional failures. No project coding-standard records were selected. | Keep separate from behavioral acceptance and correctness defects |

All twelve were inspected across three Findings pages. Their application dispositions remain unchanged. The upstream resolved untimed COMPLETED-marker defect was **not** reported as present on the fixed head. This observation does not measure detection sensitivity: no exact vulnerable-revision replay was conducted.

## Behavioral evidence assessment

This evaluator inspection is separate from Centinel's model output. n8n tests were **not executed**, so none of these rows is a runtime pass.

| Criterion | Inspected frozen evidence | Assessment |
| --- | --- | --- |
| N1 | Observer parser detail append at lines 125–157; test at line 241; observer-loop test at 585 | Positive source/test coverage present |
| N2 | Punctuation join at line 156; tests at 270 and 284 | Punctuation and ordinary uppercase-detail cases present |
| N3 | NON_DETAIL_PATTERN at line 38; negative response table at test line 706 | Timed/untimed malformed markers, fences, sentinel mixtures, stray/pre-entry detail covered in source/tests |
| N4 | Malformed-response early return; valid append/cursor loop; tests at 585, 622 and 706 | Expected valid/invalid-response tests present; storage-failure atomicity unverified |
| N5 | Observer prompt, especially lines 35–43 and 138, compared with parser | Meaningful guidance present; tolerant bullet/depth parsing differs from prescribed output |

Traceability tab explicitly states **No requirement records were captured for this review** and **No traceability records are available for this review**. The requirements Markdown was read as an artifact, not promoted to confirmed requirement records. Therefore zero traceability attention is not proof that N1–N5 are covered.

## Public reference and frozen scope

- Repository: https://github.com/n8n-io/n8n.git
- Reference: [PR #41134 — Keep Observer detail lines instead of discarding the response](https://github.com/n8n-io/n8n/pull/41134).
- Human approval: `aaguirre-rdit`, 2026-10-14 20:26:31 UTC; merged 2026-10-15 07:21:02 UTC (15:21:02 Makassar).
- Base: `50c4ced2241430e13fa7042e976ed33f07bf5009`.
- Final head: `250f2610daf41ce646d847eff8bb43ead6cf0363`.
- Merge: `48edbef643cc2dcd9c24c18be56fa88fda06ee68`.
- Four changed files, 156 additions, 20 deletions. Focus on `packages/@n8n/agents/src/runtime/memory/observation-log-observer.ts`, `observation-log-defaults.ts`, and `packages/@n8n/agents/src/runtime/__tests__/observation-log-observer.test.ts`; retain the changed integration cassette as supporting evidence.
- [Resolved review comment](https://github.com/n8n-io/n8n/pull/41134#discussion_r4274059094): an earlier revision accepted an untimed malformed `COMPLETED` marker as ordinary detail. The author resolved the thread after a fix and documented a deliberate matching tradeoff. The automated review's suggestion is evidence to assess, not an instruction to apply blindly.

GitHub metadata, review submissions, inline thread and final diff were retrieved on 16 October 2026. This is a recent completed PR review, not a published independent audit of all n8n code. Upstream reported evaluations and tests have not been independently rerun here.

## n8n behavioral criteria

| ID | Acceptance criterion | Required evidence | Status | Risk flags |
| --- | --- | --- | --- | --- |
| N1 | Indented unmarked details attach to the preceding observation without losing content or changing its parent relationship. | Source references and positive tests, including nested lists. | Not run | Detail loss |
| N2 | Joining details preserves readable punctuation; ordinary uppercase words such as GET and API remain valid details. | Punctuation and uppercase-word regression cases. | Not run | Overly broad marker rejection |
| N3 | Malformed structure remains rejected: code fences, mixed NO_OBSERVATIONS, stray unindented text, details before any observation, and malformed marker examples with and without timestamps. | Negative tests and exact parser locations. | Not run | Historical reviewed defect |
| N4 | A valid response persists observations and advances the cursor; an invalid response changes neither memory nor cursor. | Observer-loop tests covering both outcomes. | Not run | Repeated delta processing |
| N5 | Prompt guidance agrees with parser behavior and preserves distinctions among instructions, approvals, attempts, and verified outcomes. | Prompt/source comparison and test references. | Not run | Prompt/output mismatch |

Reference test command, from `packages/@n8n/agents`: `pnpm test src/runtime/__tests__/observation-log-observer.test.ts`. Running n8n code or its optional paid Anthropic evaluation harness is outside the current preparation step.

## Original Centinel acceptance checklist (preparation baseline)

| ID | Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- | --- |
| C1 | Project and source | A real authenticated project records n8n's canonical URL. Import status, errors, file counts and revision are visible and honest; reload retains the project. | Pending | Large repository; connection required |
| C2 | Reproducible scope | Review inputs identify the pinned base/head and readable files. The final fixed revision and a historical vulnerable revision must not be conflated. Partial import or unsupported refs block a claim of complete scope coverage. | Pending | Current master is not the benchmark revision |
| C3 | OpenAI provider | Centinel reports its account-scoped Codex connection, model catalog and saved Review provider. No desktop session is assumed to be connected automatically. If sign-in is needed, hand control to the user. | Pending | Authentication; model availability |
| C4 | Start and progress | Only after the next instruction, launch through the normal Review workflow; show a durable Review ID and production harness steps, gates and actual model attempts. Reload preserves progress. | On hold | No model review authorized for this preparation step |
| C5 | Grounded output | Findings reference readable pinned paths/lines and supporting rules. Invalid locations are rejected or clearly ungrounded. Reference comments are evaluator evidence, not proof of a present defect. | Not run | Hallucinated locations; benchmark leakage |
| C6 | Reference comparison | On final head, assess N1–N5 without requiring a finding for the already-fixed historical defect. A separate historical-revision replay may measure detection only once its exact vulnerable SHA is verified. Record misses, extra findings and reviewer adjudication. | Not run | Do not count a resolved defect as still present |
| C7 | Failure honesty | Import, auth, provider, validation and rate-limit failures remain operational failures; deterministic-only results are labelled and do not count as successful model-backed acceptance. | Not run | Existing build/test failures |
| C8 | Human decision and persistence | Completed analysis awaits explicit human approval/rejection. Findings, source manifest, traceability and decision remain readable after reload. Do not auto-approve. | Not run | Analysis completion differs from acceptance |
| C9 | Privacy and usage | Evidence contains no credentials, prompts, source bodies in harness metadata, or private reasoning. Report only actual available usage. | Not run | Secret exposure; invented usage |

For an unbiased later benchmark, keep upstream review conclusions separate from model inputs; supply behavioral requirements without telling the model which defect to find. No passing verdict is implied by this document.

## Preparation record

- Public reference verified through GitHub: merged metadata, human approval, final diff, resolved inline thread.
- Development services were initially stopped; started the normal `pnpm dev` workflow.
- Project creation, repository import and OpenAI connection still require live verification. Update this record with actual project/source IDs and status.
- Earlier post-pull checks found existing local TypeScript failures, one frontend test failure and sidecar environment/assertion failures. This acceptance exercise does not waive them.

### Handoff after interruption

- User requested that automation not disrupt other computer operations. Remaining interaction uses an isolated hidden in-app browser; native desktop input has stopped.
- The prior native session restored a Centinel login and the project form was filled with `n8n Review Acceptance` and `https://github.com/n8n-io/n8n.git`. Submission did not succeed: its control was outside the window bounds. No project creation success or project ID was observed; do not assume a project exists or submit a duplicate without checking.
- After interruption, development services were restarted through `pnpm dev`. The isolated browser at `http://localhost:1420/` shows **Sign in to Centinel** and does not share the native application's saved login.
- Await user sign-in in the in-app browser before checking for an existing project, creating/importing n8n, and checking Settings → Codex with ChatGPT. OpenAI connection status remains unverified. No Review has been started.
- Web sign-in was initiated with **Continue with GitHub**. GitHub's normal sign-in page is waiting for user interaction; the OAuth request returns to `http://localhost:1420`. No credentials were entered. The browser tab is retained for handoff.
- Web/desktop parity: both development surfaces use the same React frontend and sidecar HTTP transport. A web pass supports shared workflow behavior, but does not establish native dialog, deep-link, external-browser, packaging, or desktop session behavior. Verify those separately before claiming desktop acceptance.

### Latest desktop verification (16 October 2026)

User explicitly authorized desktop control again. The native Centinel session restored successfully. Home and project Source screens show an existing `n8n Review Acceptance` project with GitHub source `https://github.com/n8n-io/n8n.git`; it was reused without creating a duplicate. No project/source UUID is exposed in the inspected UI.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Project/source registration | Persisted project and correct n8n URL are readable after native restart. | Verified | Source files not imported |
| Repository import | Sync queues and imports readable versioned files. | Blocked | HTTP 500; Supabase function absent from schema cache |
| OpenAI connection | Account-scoped Codex connection reports Connected. | User sign-in pending | Not connected; Review still uses existing API provider |
| Review execution | Start only on the next explicit instruction. | Not started | Import and provider gates unmet |

Clicking source Sync produced `Internal server error`. The sidecar identifies `public.queue_source_sync_run(p_idempotency_key, p_project_id, p_source_id)` as unavailable in the Supabase schema cache. The repository defines this function in `supabase/migrations/202610130001_source_sync_worker_leases.sql`. Applying a hosted database migration has not been authorized or attempted; missing schema cache entry does not independently distinguish an unapplied migration from a cache-refresh problem.

Settings showed GitHub Connected and Codex with ChatGPT Not connected. Connect Codex successfully started login: Centinel displays `Finish ChatGPT sign-in in your browser. This page will update automatically.` Chrome opened `Welcome back - OpenAI`. Authentication is handed to the user under Computer Use guidance; credentials were not entered. After sign-in, refresh/verify connection and select the intended model for Review before any acceptance run. No new model test or Review call was made.

After the user reported completion, Centinel showed `Sign-in timed out. Connect again to open a new browser sign-in.` Refresh connection still returned Not connected. A fresh Connect Codex attempt was initiated. Browser sign-in alone has not established a connected Centinel provider. Repository import remains blocked as recorded above.

### OpenAI connection verified

Following the user's second completion message, the native Settings screen reported **Connected** and loaded the model catalog, with `GPT-5.6-Sol` selected. Centinel's real **Test text** action returned **Codex text test passed.** The **Use for Review** action then completed; refreshed settings displayed `Review: Codex · gpt-5.6-sol` and `Codex is selected for Review.` Dynamic provider selection was not changed. Screenshot inference was not tested because this preparation targets Static Review.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| OpenAI authentication | Centinel reports its account-scoped Codex connection as Connected. | Verified | Restart persistence not retested |
| Text inference | Real structured text provider test passes. | Passed | Does not establish full Review correctness |
| Review provider | Saved Review setting resolves to Codex and an available model. | Verified: `gpt-5.6-sol` | Other acceptance gates remain |
| n8n preparation | Existing project/source URL and reference criteria are retained. | Prepared | Repository import still blocked by source-sync RPC/schema-cache error |
| Review execution | Remain unstarted until user's next instruction. | On hold | No Review findings or acceptance verdict yet |

Next work requires resolving the recorded Supabase migration/schema-cache blocker, importing and pinning the scoped n8n inputs, then executing the acceptance workflow when instructed. No hosted database migration was applied.

### Execution authorized; source-access gate pending

The user instructed `proceed`, authorizing the acceptance execution. No Review was launched because the source gate remains unmet. Workspace configuration exposes normal application/OAuth settings, but no database-admin connection or Supabase management connector is available. Native Chrome migration access could not be established: window capture continued reporting the browser minimized after the documented activation/rebinding retry. No browser safety barrier or authentication was bypassed. The user was asked to either apply the existing migration, open the Supabase SQL editor, or explicitly choose a pinned-file upload run with connected-source acceptance left blocked.

Independent preparation completed:

- GitHub's current PR metadata still matches the recorded merged benchmark base and final head.
- Downloaded the four changed files at both pinned revisions to `C:/Users/PREDATOR/AppData/Local/Temp/centinel-n8n-review-acceptance-20261016/`, with separate `base/` and `final/` trees.
- Each final file's Git blob hash matches the GitHub PR-files API. SHA-256 verification passed for all eight downloaded files; provenance, hashes and byte counts are in the fixture's `manifest.json`.
- Added `final/acceptance_requirements.md` with N1–N5 and a grounded-output contract. It excludes reviewer conclusions. Only final inputs should enter the first Review; the base remains separate comparison evidence.
- Targeted sidecar tests for connected-source worker coordination, GitHub project import handoff and Review harness: **3 files, 10 tests passed**. These tests do not prove live Supabase migration, source import or model-backed Review success.
- Local folder import preserves relative source paths but currently excludes files classified as `other`, including the changed JSON cassette. If that alternative is selected, upload the cassette separately or explicitly disclose its omission. Do not claim a complete four-file scope until every input is verified in Centinel.

No application code was changed, no database migration was applied, and no Review verdict exists at this gate.

### Retry after user-applied migration

The user reported applying the existing SQL migration. Retrying Sync through the native project Source screen passed the prior missing-RPC gate and returned a new actionable error: `GitHub rejected the saved authorization. Reconnect GitHub in Settings, then sync this source again.` Settings then showed GitHub **Disconnected**, while Codex remained connected and selected for Review. The import has not succeeded and no source revision/file coverage is claimed.

Opened Settings → Connect GitHub and initiated the normal authorization flow. Centinel confirms `The GitHub authorization page is open. Complete it, then return here.` User completion is required under the Computer Use authentication-dialog boundary. No account permission/authorization prompt was accepted by the agent. After reconnection, retry sync and verify scope before launching Review.

### Pinned project and first execution

The saved browser session completed GitHub reconnection without an authentication prompt being automated. Native Settings subsequently showed GitHub Connected. Retrying the original project's source sync imported readable n8n files; it was still Syncing when inspected. This is current-branch import evidence, not a completed or pinned repository import.

Created **n8n PR #41134 Acceptance** through the native Local repository workflow, with the final fixture as its workspace and the canonical PR URL/final SHA in its description. The original **n8n Review Acceptance** project and GitHub source remain separate. This avoids mixing a moving default-branch import into the benchmark, because the Review form currently selects every artifact by default and offers no bulk deselection.

The dedicated project's Source screen and Review form verified **five selected artifacts**: three changed TypeScript files, `acceptance_requirements.md`, and the changed JSON cassette uploaded separately. The form had no confirmed project requirement records or coding standards; N1–N5 are supplied as a readable requirements artifact and in the objective. This does not establish database requirement traceability.

Started **n8n Observer N1-N5 Acceptance - 250f2610**, displayed ID **fb7364c3**, through the normal Review form. The stored objective explicitly bounds the review to the frozen final revision and prohibits invented defects, test execution, or repository-wide coverage. After several refreshes and navigation, the review remained Queued, with every production harness step Not recorded and no model attempt observed.

Code inspection established a runtime schema mismatch: `claim_review_lease` returns `review_session_id`, but the adapter parsed only `reviewId`/`review_id`. Checkpoint writes and reads also used `review_id`, while the migration defines `review_session_id`. Corrected the adapter to consume the migrated column, retaining legacy read aliases. Added migration-shaped lease/checkpoint regression tests. No schema reset or new database migration is needed for this correction.

Verification: the new regression file passed (2 tests). The combined regression/runtime run had **15 passed, 1 failed**; the failure is the previously observed retry-budget assertion in `phase3Runtime.test.ts`. A targeted lease/checkpoint/recovery run had **8 passed, 8 skipped**. Sidecar TypeScript checking remains failed with six existing errors in `retry.ts` and `supabaseRepository.ts`; none point to the changed lease adapter or new regression file.

Restarted the agent-launched development services to load the adapter correction. The authenticated desktop session, dedicated project, five source artifacts and review persisted. Cancelled the stalled attempt through its normal control, preserving its record, then invoked **Retry review**. Actual model-backed acceptance remains pending until this retry's harness and output are verified. No human approval was recorded.

### Runtime and failure-state corrections

Retry **1e0e8aff** started successfully: production harness execution **1fddb492-f00d-4c5a-a876-39662e20f25c** recorded Select sources and Freeze manifest Completed, then Inspect source Failed before any model call. The native Activity error confirmed: `Connected-source evidence lookup failed: Could not find the table 'public.connected_source_items' in the schema cache`. Both migrations and the importer use `source_items`; corrected the resolver's table name. Tests now cover local inputs without a connected item and connected inputs with project/artifact-scoped lookup. Combined source-state/lease regressions: **7 tests passed**.

The Review screen incorrectly interpreted backend `failed` as Need Approval, offering Approve and Request changes. Added `failed` alongside the existing `failure` alias in the shared lifecycle mapper and retry eligibility; the terminal toast now handles it too. Live desktop verification showed Failed, Retry review, and the source error, with approval actions absent. The mapper and Review Activity tests passed: **2 files, 25 tests**, including both failure aliases and absence of approval actions.

Frontend build remains blocked by the pre-existing `ArtifactsPanel.tsx:152` optional `run.attemptCount` TypeScript error. No CSS/layout changes were made. Review Overview still labels the frozen manifest count as Artifacts reviewed and uses generic completed copy even after pre-model failure; these are residual failure-honesty risks, not proof that the five artifacts were analyzed. No findings, test execution, or model-backed acceptance is claimed for this failed retry. The agent-launched services were restarted again to load the source-table correction before the next retry.

### Successful model-backed execution

Second retry **558cc99b**, named **n8n Observer N1-N5 Acceptance - 250f2610 (Retry) (Retry)**, progressed through all five harness stages to **Need Approval**. This is analysis completion, not a human approval or overall acceptance verdict.

The Read source step recorded five successful reads with `hashChecked: true`:

| Input | Artifact ID | Characters | Lines |
| --- | --- | ---: | ---: |
| acceptance_requirements.md | b70f9cee-285c-4688-82d1-b69c58715c27 | 2261 | 30 |
| observation-log-observer.test.ts | 77f7c781-bafe-4526-b253-2712efd07da2 | 32759 | 1002 |
| observation-log-defaults.ts | 7aa36265-42ff-4b08-abea-7e4507d26342 | 18148 | 380 |
| observation-log-observer.ts | 0cb6f5ef-93d9-4804-b268-ed6372c81406 | 17428 | 501 |
| records-observations-and-emits-memory-task-lifecycle-events-after-generate.json | 77a7ee1b-60ec-44d0-9fdd-b5ae3d2ee893 | 12439 | 113 |

These are UI-reported character/line counts, not byte counts. The provenance fixture separately records original bytes and Git hashes.

Model attempt 1 reports **success**, provider **codex**, model **gpt-5.6-sol**, duration **35,416 ms**, **40,700 input tokens** and **1,429 output tokens**. Build request, Resolve provider, Run model and Validate grounding all recorded Completed, followed by Validate and save evidence Completed. No fallback or second model attempt was observed. Harness inspection exposed metadata only. Findings and traceability still require final inspection and adjudication.

### Final persistence and import checks — 17 October 2026

Reopened the native authenticated session and selected the dedicated benchmark in Playground. It loaded **Saved execution history**, **Need Approval**, and all five stages **Completed**. Earlier Findings/Traceability inspection and adjudication are recorded in the current verdict above. The review remains available for the user's explicit decision; no further model execution was initiated during these final checks.

In the original **n8n Review Acceptance** project's Source screen, the canonical GitHub source remains **Error / Not Synced Yet**. History records a **partial** run with **423 imported, 0 updated, 0 unchanged, 0 removed**, followed by `Supabase connected-source item save failed: Error: Supabase request timed out.` Partial artifacts remain visible. This is the observed terminal outcome of the broad import acceptance test, not successful full-repository synchronization. Source ID: `e1ae05cc-5b93-4097-9b24-20c6a2939e44`.

The bounded acceptance exercise is documented and the model-backed review is available, while the overall feature/release acceptance remains partial. Remaining work is a distinct follow-up: make large connected imports reliable, promote/confirm requirements and exercise traceability, triage contextual deterministic false positives, repair release-blocking checks, and separately verify web and packaged desktop behavior. The existing local edits and retained pre-pull stash were preserved; changes made for this exercise are uncommitted.
