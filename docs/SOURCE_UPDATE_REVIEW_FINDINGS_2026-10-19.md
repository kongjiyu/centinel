# Source updates, review reminders and finding reconciliation

## Agreed behavior

- Compare a trustworthy completed review's saved source versions with the project's current synced source versions. A detected content update, addition or removal within the applicable review scope should remind the user to conduct another review.
- A failed or incomplete newer attempt must not clear that reminder. If the comparison evidence is unavailable, say currency cannot be verified rather than asserting that the review is current.
- A source update alone never resolves a finding. The project Findings list may derive a Resolved state only from a successful comparable re-review with adequate versioned source coverage and resolution eligibility. Keep the original review evidence and manual finding decisions intact.
- The reminder opens Review setup with the previous Review as its comparison parent and prefills the saved objective and scope. Only explicit submission starts a child Review, capturing fresh source versions. An unavailable comparison blocks submission until retried or explicitly changed to an independent Review. The authenticated backend verifies parent ownership, completion, model success and saved source evidence; idempotency keys cannot be reused across different parents.
- Failed, cancelled, partial, unrelated-scope, legacy or unreadable comparisons retain unresolved findings. A later recurrence must appear as a current unresolved issue.
- A review-derived Resolved state means the finding was not reproduced in the comparable re-review after the relevant source changed. It is not a claim of independent runtime verification or complete security. Show that basis alongside the later review reference.
- Reminders compare sources already imported or synced into Centinel. The later [automatic GitHub sync](GITHUB_AUTOMATIC_SYNC_2026-10-20.md) checks remote heads while the signed-in workspace is open and brings changed snapshots into that comparison. No remote webhook, Drive polling or external filesystem watcher is added by the reminder mechanism.

## Root cause of the reported unavailable-source result

Read-only inspection of **Test Project → Source → CargoChain → History** showed a failed import on **13 October 2026 at 19:47**: GitHub rejected the saved authorization, with zero imported, updated, unchanged or removed files. Readiness had received an unavailable-source marker for that failed import. It had not demonstrated a defect reading an existing saved document. The earlier explanation, “unreadable sources,” did not make this distinction clear enough.

The readiness findings now retain a safe source-availability cause and static recommended action. Authorization/import failure, unsupported extraction, unavailable saved content, missing versions and hash mismatch are distinguished where reliable structured evidence exists. Raw upstream messages, credentials and source bodies are never copied into this guidance. Unknown failures keep generic access/import guidance. The current policy, `readiness-2026-10-19.4`, causes prior snapshots to be reassessed using the clearer explanation and the clarified Missing-category contract.

The CargoChain source was inspected only; it was not reconnected or synced. Its recorded October failure does not establish whether today's GitHub authorization would still fail.

## Model request diagnosis

Earlier controlled generation requests failed with structured `responseTooManyFailedAttempts` and HTTP 429, before any final answer. Sign-in and model discovery succeeded. A later read-only rate-limit query reported 32% usage in the five-hour window and 26% in the weekly window, with no limit-reached flag. Thus exhausted advertised quota was not established. Do not attribute the 429 to a specific account limit without further evidence.

A subsequent controlled request using `gpt-5.6-sol` and the complete-document fixture succeeded: requirements, design and standards all matched Completed, with zero criterion mismatches, invalid evidence, invalid basis or engine/model-state mismatches. The missing-category fixture also passed. The model selected some valid alternative quotations; those are diagnostic differences, not failures.

The first vague-requirements assessment exposed a genuine model-contract mismatch: requirements stayed Incomplete, but the absent design and standards became Incomplete rather than Missing because the model also returned individual gap verdicts for those absent categories. No category was falsely Completed. That batch then stopped on a 429. The instructions now explicitly require unknown criteria for an absent category and distinguish a named but uncovered feature from unidentified scope. The unchanged vague fixture passed a later live retest under policy `.4`, including all criterion verdicts and citations. Its report is `evidence/readiness-outcomes-2026-10-19/live-codex-results.json`; earlier positive and negative attempts are preserved separately. The full 11-case corpus still has not completed real-model acceptance. Do not present successful individual cases as a complete semantic-accuracy score.

## Acceptance and QA inventory

| Feature | Acceptance criteria | Evidence needed |
| --- | --- | --- |
| Cause-specific readiness | Failed zero-file authorization import remains Incomplete and recommends connection/sync recovery; no raw provider text | Runtime/engine/privacy tests and live Source history inspection |
| Update reminder | Changed synced content produces a reminder and Review action; unchanged, missing, scoped and failed-review cases remain honest | Pure comparison tests, Project Overview interaction and viewport checks |
| Project Findings | Eligible later resolution is reflected in the final list with basis; original history is preserved | Correlation, reconciliation, authenticated API and Findings UI tests |
| Unsafe resolution prevention | Empty, failed, partial, unreadable, changed-rule or incomparable-scope review cannot resolve old findings | Negative regression tests |
| Regression/appearance | Required type checks, builds and relevant tests pass; reminder fits 1440×900, 1200×900 and 390×844 without leaking styles | Targeted suites, build, isolated browser screenshots |

The proposed four-domain Review workflow remains separate from these source-currency and finding-lifecycle fixes.

## Implemented behavior and verification

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Cause-specific readiness | Zero-file authorization failure produces Incomplete plus safe connection/sync guidance | Passed runtime, engine and privacy tests; live import history inspected | Historical import was not retried, so current GitHub authorization is unknown |
| Source reminders | Changed and post-capture added synced sources prompt a review; unavailable evidence is explicit; a later human decision does not change the execution baseline | Passed pure/UI tests and isolated browser interaction | Remote changes must first be imported/synced into Centinel |
| Linked follow-up | Reminder opens prefilled setup; explicit submission binds the prior Review and captures fresh content; invalid parent is blocked or explicitly detached | Passed authenticated API, orchestrator, component and isolated browser checks | Changing objective, scope or configuration can prevent automatic resolution; no live Review was started during acceptance |
| Latest project findings | Valid recurring/regressed chains collapse to the latest issue; eligible resolution is visible with its comparable-review basis and link | Passed correlation, API, reconciliation and UI tests | Unlinked or legacy findings are retained; resolution means not reproduced, not independent runtime proof |
| Unsafe-resolution prevention | No resolution from empty coverage, failure, partial model results, mismatched project/session, unchanged source versions or changed scope/configuration/feedback | Passed negative regression cases | Existing legacy correlation rows lack the eligibility metadata and are not retroactively certified |
| Shared risk and statuses | Effective Resolved status removes an issue from current unresolved risk without overwriting saved decisions; status labels stay visible on narrow shared tables | Passed component and browser checks | Historical Review displays remain historical |
| Model outcomes | Complete, missing-category and corrected vague-requirements cases match independently authored labels | Individual live cases passed | Intermittent 429 and an incomplete live corpus keep full production outcome acceptance open |

Focused sidecar checks: **208 tests / 16 files** and `tsc --noEmit` passed. The repeatable `node scripts/source-update-review-qa.mjs` browser runner uses only fictional application/auth responses, verifies 1440×900, 1200×900 and 390×844, and tests the reminder, expanded explanation, prior objective/scope prefill, explicit linked submission and Resolved evidence. It verifies no automatic Review start and no finding-decision write; its one explicit Review POST is intercepted and fictional. Results/screenshots are generated under ignored `evidence/source-update-review-2026-10-19/`. Frontend final checks are recorded below. Earlier broad-suite Dynamic Testing failures remain outside this change; no full-suite pass is claimed.

Final frontend checks: **118 tests / 9 files** passed, including linked setup, invalid-parent/detach behavior and the existing activity/readiness regression cases. The frontend production build passed with its existing large-bundle warning. Scoped `git diff --check` passed. The isolated browser runner passed again after the final parent-validation change. The owned sidecar was restarted with the final implementation; no live Review generation, source sync or finding decision was performed by these checks. The earlier broad run still has 47 Dynamic Testing failures, so overall-suite acceptance remains open.
