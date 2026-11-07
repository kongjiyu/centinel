# Cypress Real World App evaluation (Centinel 0.2.3)

Target: `cypress-realworld-app` backend (19 files in `backend/`) plus `REQUIREMENTS.md`
(REQ-1 to REQ-8), project "RWA Payments Demo", 20 confirmed requirements.
Answer key: `docs/qa/PRESENTATION_DEMO_FLOW_2026-10-30.md` (5 known issues).
Model: Codex `gpt-6.1-sol` through the user's ChatGPT login. Generation limit per request: 20 minutes.

Goal text: "Check the payment backend against REQ-1…REQ-8, especially that users can only read or
change their own account, transactions and bank accounts, and that sessions are protected."

## Run 1 — Review `3af027d5-21d9-467e-82aa-4f363e783434`

The computer was shut down while the run was in progress (03:00–04:00 UTC). When Centinel reopened at
08:02 UTC the Review recovered its lease and restarted model analysis from the first batch, re-running the
batches it had already finished. Duration and tokens below therefore count only the recovered run.

| Measure | Value |
|---|---|
| Result | Completed with gaps (`pending_approval`, coverage partial) |
| Duration (recovered run) | 08:02:52 → 10:22:48 UTC, 2 h 20 min |
| Findings | 27 (2 deterministic, 25 model); 6 rows still need citation verification |
| Model requests (recovered run) | 54: 46 success, 5 malformed response (repaired or retried), 3 timeouts |
| Tokens (recovered run) | 1,741,495 input (42,112 cached), 203,736 output; 3 requests with unknown usage (timeouts) |
| Tokens incl. interrupted part | 2,095,065 input, 256,750 output over 67 requests |
| Unverified parts | 5: 3 × model timeout (20 min), 1 × domain coverage, 1 × semantic support |
| Typical batch | 2–3 min generation + 15–90 s support check |

### Answer key

| Known issue | Found | Finding |
|---|---|---|
| REQ-2 `PATCH /users/:userId` no owner check (`user-routes.ts:81`) | Yes | "Missing Account Update Authorization", `user-routes.ts:87` |
| REQ-5 `PATCH /transactions/:transactionId` no owner check (`transaction-routes.ts:171`) | Yes | "Missing Transaction Participant Authorization", `transaction-routes.ts:179` |
| REQ-6 `DELETE /bankAccounts/:bankAccountId` no owner check (`bankaccount-routes.ts:51`) | Yes | "Missing Bank Account Deletion Authorization", `bankaccount-routes.ts:56` |
| REQ-7 hard-coded session secret (`app.ts:60`) | Yes (rule only) | Deterministic `secrets-api-key`, `app.ts:60`; the model did not report it |
| REQ-8 logout redirects to a missing `/` (`auth.ts:49`) | Partly | "Competing Logout Responses", `auth.ts:51`: correct location; describes the double redirect, not the 404 |

Recall: 5/5 locations, 4 fully explained plus 1 at the right line with a different explanation.

### Findings beyond the answer key

Checked by reading the code. 27 rows describe about 17 distinct issues: the rest are the same issue
reported twice (one verified row and one needing verification, or two titles for the same line).

| Issue | Location | Assessment |
|---|---|---|
| `GET /bankAccounts/:id` returns any user's account | `bankaccount-routes.ts:32` | Real (not in answer key) |
| GraphQL `deleteBankAccount` has no owner check | `graphql/resolvers/Mutation.ts:7` | Real (same flaw as REQ-6 via GraphQL) |
| `PATCH /users/:userId` accepts `balance` from the client | `user-routes.ts:89`, `validators.ts:46` | Real |
| Payment amount not required to be positive | `validators.ts:87`, `database.ts:535` | Real |
| Any request-status update pays the request, even a rejection | `database.ts:585` | Real |
| Query fields can override the user scope of transaction lists | `database.ts:379` | Real (needs verification) |
| `updateNotificationById` ignores the user | `database.ts:781` | Real |
| Okta token failure never responds (request hangs) | `helpers.ts:70` | Real |
| `GET /users` returns full user records of everyone | `user-routes.ts:26` | Debatable: list is needed for contacts, but fields are not reduced |
| `GET /users/profile/:username` is public | `user-routes.ts:72` | False positive: returns only name and avatar by design |
| `console.log` in auth helper | `helpers.ts:72` | Low-value rule hit |

False positives: 1 clear, 1 debatable, 1 low-value rule hit, out of about 17 distinct issues.

### Observations

- Three batches hit the 20-minute limit. Before 0.2.3 a single timeout failed the whole Review; now the
  Review continues and reports those parts as "Completed with gaps".
- Restart recovery re-runs finished batches instead of reusing their saved results, which repeated about
  350k input tokens of finished work. Candidate improvement.
- Duplicate rows for the same issue (verified + needs-verification, or reworded titles) inflate the
  count from about 17 to 27. The Findings screen groups them, but raw counts in reports are higher.
- The Start a Review estimate for run 2 said "about 7h 22m": it measured run 1 from creation to finish,
  including the hours the computer was off. The estimate should use active run time.
- On Start a Review, the "Recent Reviews" list appears after the form and pushes it down, so a click
  aimed at the Review name field can open an old Review instead.

Fixed in the working tree (not yet released): Review durations and the estimate now count active time,
skipping gaps longer than 35 minutes between recorded steps (longer than the 30-minute maximum AI
request), and Recent Reviews moved below the Start form. Reusing finished batches after recovery is
proposed as a separate change because it alters the documented batch-cache rule.

## Run 2 — Review `aaa7cc1e-bc79-49fb-93ce-add70c7cd739`

Same goal and sources, uninterrupted.

| Measure | Value |
|---|---|
| Result | Completed with gaps (`pending_approval`, coverage partial) |
| Duration | 10:25:41 → 12:04:50 UTC, 1 h 39 min |
| Findings | 39 (2 deterministic, 37 model); 11 rows still need citation verification |
| Model requests | 57: 52 success, 4 malformed response (repaired or retried), 1 timeout |
| Tokens | 1,876,187 input (0 cached), 219,219 output; 1 request with unknown usage (timeout) |
| Unverified parts | 3: 1 × model timeout, 2 × semantic support |

### Answer key

| Known issue | Found | Finding |
|---|---|---|
| REQ-2 user update | Yes | "Missing Account Update Authorization", `user-routes.ts:87` (plus 2 rewordings at `:91`) |
| REQ-5 transaction update | Yes | "Missing Transaction Participant Authorization", `transaction-routes.ts:179` (and `:174`) |
| REQ-6 bank account delete | Yes | "Missing Bank Account Deletion Authorization", `bankaccount-routes.ts:58` |
| REQ-7 session secret | Yes (rule only) | Deterministic `secrets-api-key`, `app.ts:60` |
| REQ-8 logout | Partly | "Duplicate Logout Response", `auth.ts:51`: right line, double-response explanation |

Same result as run 1: 5/5 locations, 4 fully explained.

### Findings beyond run 1

Every extra issue from run 1 appeared again. New in run 2:

| Issue | Location | Assessment |
|---|---|---|
| Comment notifications: `a !== s \|\| a !== r` is always true, so the other branches never run | `database.ts:675` | Real (low impact) |
| Email-only profile update rejected (`email` missing from `oneOf`) | `validators.ts:24` | Real (minor) |
| Missing transaction gives an unhandled error | `database.ts:335` | Real (minor robustness) |
| `/testData` seed/read has no authentication | `testdata-routes.ts:13`, `:19` | Debatable: mounted only when `NODE_ENV` is test or development |

The public-profile finding (`user-routes.ts:72`) appeared again with a new title; still a false positive.
About 22 distinct issues: 1 clear false positive, 2 debatable (users list, test-data routes), 1 low-value rule hit.
More rows (39) are rewordings of the same issue: for example, six rows at `validators.ts:87`.

## Run 3 — Review `e5fc2d39-8809-4048-80fb-163bcc52d5ee`

Same goal and sources, uninterrupted.

| Measure | Value |
|---|---|
| Result | Completed with gaps (`pending_approval`, coverage partial) |
| Duration | 12:06:53 → 13:22:48 UTC, 1 h 16 min |
| Findings | 30 (2 deterministic, 28 model); 6 rows still need citation verification |
| Model requests | 55: 54 success, 1 malformed response (repaired), 0 timeouts |
| Tokens | 1,841,312 input (17,664 cached), 210,604 output; usage known for every request |
| Unverified parts | 2: 1 × semantic support, 1 × uncertain citation |

Answer key: same as runs 1 and 2. REQ-2 `user-routes.ts:87`, REQ-5 `transaction-routes.ts:176/179`,
REQ-6 `bankaccount-routes.ts:56`, REQ-7 rule only at `app.ts:60`, REQ-8 partly at `auth.ts:51`.

No new issue types. Compared with run 2 it did not report the `/testData` routes, the email-only profile
update or the transaction-list scope override. The public-profile false positive appeared again
("Public Account Name Disclosure"). About 18 distinct issues.

## Summary across runs

| | Run 1 (recovered) | Run 2 | Run 3 |
|---|---|---|---|
| Result | Completed with gaps | Completed with gaps | Completed with gaps |
| Duration | 2 h 20 min* | 1 h 39 min | 1 h 16 min |
| Input / output tokens | 1.74M / 0.20M* | 1.88M / 0.22M | 1.84M / 0.21M |
| Model requests (timeouts) | 54 (3) | 57 (1) | 55 (0) |
| Unverified parts | 5 | 3 | 2 |
| Finding rows / distinct issues | 27 / ~17 | 39 / ~22 | 30 / ~18 |
| Answer key, located | 5/5 | 5/5 | 5/5 |
| Answer key, fully explained | 4/5 | 4/5 | 4/5 |
| Clear false positives | 1 | 1 | 1 |

\* Counted from lease recovery at 08:02 UTC; before the shutdown a further 0.35M input tokens were spent.

- **Recall is stable:** every run located all five known issues. REQ-7 came only from the deterministic
  secret rule, and REQ-8 was always flagged at the right line as a double response rather than the 404.
- **Real extra findings are stable:** the bank-account read, GraphQL delete, client-set balance,
  non-positive amounts, request-rejection payment, notification owner and Okta hang appeared in all three runs.
- **Run-to-run variation** is in minor findings (test-data routes, email-only update, list scope) and in
  how many reworded duplicate rows are stored (27–39).
- **Precision:** one recurring false positive (public profile returns only name and avatar by design).
- **Cost and time:** about 1.85M input / 0.21M output tokens and 1¼–1¾ h per uninterrupted run. Each
  20-minute timeout adds 20 minutes and leaves a gap; run 3 had none.

## Follow-up changes (7 November 2026, not yet re-evaluated)

No live Review has been run with these changes; the effect on the RWA runs above is expected, not measured.

- **Reworded duplicate rows.** Cause: the final per-Review deduplication never merged a verified finding
  with a needs-verification copy, and otherwise required similar title words, so reworded titles for the same
  line stayed separate rows. A Review now keeps one finding per issue when observations share the file, the
  line (or overlapping lines) and the issue type; a needs-verification copy only merges into a verified one.
  Every merged observation stays on the finding as evidence (title, line, excerpt, citation state), shown under
  "Also reported in this Review". Report and Findings counts show distinct issues and the raw occurrence count.
  Earlier Reviews' stored rows are unchanged.
- **Hard-coded session secret (REQ-7).** The rule hit now carries a concrete recommendation, and a rule-only
  finding explains in plain language what the pattern means and that no AI issue covers that line. Centinel
  does not infer a requirement link for a pattern-only match; it shows one only when it is recorded.
- **Public profile false positive.** Policy `review-2026-11-07-distinct-findings-v23` asks the model to
  identify and cite the fields an endpoint actually returns before claiming data exposure. Not yet verified
  against the RWA project.
- **Logout redirect (REQ-8).** Unchanged known limitation: the model may describe the right line as a double
  response instead of a redirect to a missing page. A prompt rule about redirect targets was not added, because
  `/` is often served outside the reviewed backend and the rule could cause false positives elsewhere.
