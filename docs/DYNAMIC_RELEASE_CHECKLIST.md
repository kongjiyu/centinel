# Dynamic release acceptance checklist

Checkpoint: 15 October 2026, engine `8e2f849`. Required scope is Web Dynamic and
shared dependencies. Static implementation/scenarios 1–2 and native desktop SUT
adapter DYN-18 are excluded. The packaged Centinel client is still a required
gate. Real API-provider acceptance is deferred by direct user decision; local
adapter tests remain required. Final agreed-scope closure is in DYNAMIC_RELEASE_EVALUATION.md; historical checkpoint details remain below.

## PRD acceptance scenarios

The retained audit JSON was inspected for the following references. Raw audits,
screenshots and reports are ignored local artifacts, not published credentials.
Older acceptance remains tied to its documented engine; it is not represented as
a fresh rerun of every scenario after each merge. The latest change only touches
bounded repository processes; its full suite and post-change RWA unit execution
are recorded in DYNAMIC_RELEASE_RESILIENCE.md.

| Scenario | Evidence and result | Gate |
| --- | --- | --- |
| 1–2 Static | Separate team's implementation and acceptance | Excluded |
| 3 New shared identity | Project be7c5caf / Run f49ab001; real Codex pass, no old local project prerequisite; other-project member denied. DYNAMIC_RELEASE_EVALUATION.md | Passed bounded live case |
| 4 Requirement → mission | Explicit mock-static source, frozen revision and criterion; six real Codex Runs with 1/1 coverage. DYNAMIC_CONTEXT_COVERAGE.md and DYNAMIC_RELEASE_EVALUATION.md | Passed mock consumer; no real Static integration claim |
| 5 Normal/defect/outage | Pinned RWA login/CRUD checks plus fixed usability fixture; unavailable provider Run 8babdf29 and unreachable Run 55d22906 blocked/not_tested. DYNAMIC_BROWSER_CREDENTIALS.md, DYNAMIC_RWA_CRUD_ACCEPTANCE.md, DYNAMIC_RELEASE_RESILIENCE.md | Passed bounded cases |
| 6 Exploration gaps | Runs 292fd4e1 and 3aecc46d retain sampled states, unvisited controls, exhaustive=false, honest step-limit result. DYNAMIC_BROWSER_EXECUTION.md M4e | Passed; sampled scope only |
| 7 Fix/retest/history | Failed 380dddca → pinned passed 3a7565ad; finding 491031d1 retains verification and explicit remediation events; original baseline unchanged. DYNAMIC_REVIEWED_FINDINGS.md | Passed QA simulation; no stakeholder sign-off |
| 8 Cancel/interruption | Active browser cancel 4a1a6b2b, browser disconnect 09f8cdc0, worker restart 786697d6; actual unit SIGKILL 700c1b77 after process-lock change. DYNAMIC_BROWSER_RECOVERY_ACCEPTANCE.md and DYNAMIC_RELEASE_RESILIENCE.md | Passed retained state/recovery cases; no unsafe automatic replay |
| 9 Data lifecycle | Manual preparation/dirty reuse block; authorized marker setup and cleanup; failed cleanup retains ownership, explicit recovery succeeds. Resource Run 80ee94ea; DYNAMIC_DATA_LIFECYCLE.md, DYNAMIC_HOOK_OPERATIONS.md, DYNAMIC_RESOURCE_BUDGETS.md | Passed bounded lifecycle; unrelated DBs preserved |
| 10 Usability | Declared labels/keyboard defects repeat 3/3; deterministic violations separate from metered optional suggestions. DYNAMIC_USABILITY.md and DYNAMIC_RELEASE_EVALUATION.md | Passed tiny fixture; no full accessibility or real-user-study claim |
| 11 Existing unit tests | Shared pass/fail/timeout/cancel/config/dependency/no-tests/parser histories and reports; actual RWA 54 total, 44 pass, 10 skipped. DYNAMIC_UNIT_TESTS.md and DYNAMIC_RELEASE_RESILIENCE.md | Passed Vitest-only bounded scope |
| 12 Providers | Real Codex text/image/action, failure and cancellation; API contracts tested locally. CODEX_PROVIDER.md and LOCAL_RUNTIME_SETUP.md | Codex live passed; API live user-deferred |
| 13 Shared report/proof | Reader verified JSON/Markdown/PDF and proof hashes; anonymous/nonmember/direct signed access denied; exact same-bearer membership revocation denies report/proof/Storage and exact restore succeeds. DYNAMIC_REPORTS.md, DYNAMIC_PRIVATE_EVIDENCE.md, DYNAMIC_RELEASE_RESILIENCE.md | Passed service/browser and native JSON/Markdown/PDF save with byte verification |
| 14 Privacy/auth | Real private-input dispatch, 13 text artifacts plus shared JSON/report exact sentinel scan; viewed screenshot fully masks field; uncertain private-state check not counted as pass. Cross-project/file and revocation checks retained. DYNAMIC_SESSION_PROTECTION.md, DYNAMIC_FILE_TRANSFERS.md, DYNAMIC_RELEASE_RESILIENCE.md | Passed synthetic sentinel case; not universal privacy guarantee |

## Requirement map

| Requirements | Canonical implementation/acceptance record |
| --- | --- |
| DYN-01–04 | DYNAMIC_ENVIRONMENT_PROFILES.md, DYNAMIC_DATA_LIFECYCLE.md, DYNAMIC_WORKSPACE_EXECUTION.md, DYNAMIC_HOOK_OPERATIONS.md |
| DYN-05, DYN-13 | DYNAMIC_CONTEXT_STUB.md, DYNAMIC_CONTEXT_COVERAGE.md (explicit mock only) |
| DYN-06 | DYNAMIC_MISSION_RUN_FOUNDATION.md, DYNAMIC_BROWSER_EXECUTION.md |
| DYN-07–10 | DYNAMIC_BROWSER_EXECUTION.md, DYNAMIC_RESOURCE_BUDGETS.md, DYNAMIC_BROWSER_RECOVERY_ACCEPTANCE.md |
| DYN-11–12 | DYNAMIC_USABILITY.md, DYNAMIC_REVIEWED_FINDINGS.md |
| DYN-14–15 | DYNAMIC_PRIVATE_EVIDENCE.md, DYNAMIC_SHARED_ARTIFACTS.md, DYNAMIC_REPORTS.md |
| DYN-16 | CODEX_PROVIDER.md; live API exception above |
| DYN-17 | DYNAMIC_UNIT_TESTS.md; independent runner, no generated tests |
| SHR-01–03 | LOCAL_RUNTIME_SETUP.md, DYNAMIC_MISSION_RUN_FOUNDATION.md, DYNAMIC_CONTEXT_COVERAGE.md; bearer/RLS identities, additive contracts |
| SHR-04 | DYNAMIC_SESSION_PROTECTION.md, DYNAMIC_BROWSER_CREDENTIALS.md, DYNAMIC_FILE_TRANSFERS.md; local private references |
| SHR-05–07 | DYNAMIC_RESOURCE_BUDGETS.md, DYNAMIC_REVIEWED_FINDINGS.md, DYNAMIC_USABILITY.md; explicit usage/risk/audit semantics |
| SHR-08 | DYNAMIC_REPORTS.md, DYNAMIC_UNIT_TESTS.md; immutable report schemas and authenticated bounded exports |
| NFR-01–02,05–07 | Focused runtime/SQL suites, pinned target baselines, repeated protocol, additive upgrades and recovery evidence |
| NFR-03–04 | Two-user/private-file/security evidence and per-screen 1440×900, 1200×900, 390×844 checks in implementation records |

## Final gate closure

- Genuine issued JWT expiry/explicit refresh passed at 05:44:40 on 15 October
  (Asia/Kuala_Lumpur): expired report/proof 401; legitimate refresh restores report
  200 and exact proof SHA. Original one-hour token wait completed without forgery
  or project Auth changes.
- Packaged client passed Supabase sign-in, configured Codex discovery/catalog,
  actual text/image tests, native-started independent-check Run, shared proof,
  immutable report and native JSON/Markdown/PDF save with byte-for-byte readback.
  One initial Reload and one transient JWT-future Retry are disclosed; a separate
  owned process relaunch restored session/rendering directly. The client execution/export source is unchanged since 44916ff; a later summary-label
  correction was rebuilt and inspected natively (029c778), while the current
  sidecar includes process exclusion and its verified worker recovery.
- Final required-scope evidence audit is recorded in DYNAMIC_RELEASE_EVALUATION.md.
  API live remains user-deferred, Static excluded and native SUT optional. These
  are scope decisions, not passed tests. Existing corpus/production limits remain.

## Known limits

One initial Chromium/Web execution path and Vitest 3/4 JSON adapter are supported.
Repository scripts are authorized but remain arbitrary local code, not an OS
sandbox. Same physical cwd is excluded across projects/processes; unrelated cwd
can still point to one external DB, so isolated data/resources remain an operator
responsibility. Dirty data never becomes clean from process lease expiry.

The corpus is six simple Ready checks with two planted rule defects. It supports
that declared fixture's repeat agreement and proof completeness; broad defect
precision/recall and production performance remain unmeasured. QA review is
explicit simulation. Recovery records interrupted work without automatically
resubmitting uncertain business actions. Already-downloaded files cannot be
revoked. Shared retention is enforced, but previously exported bytes remain with
the recipient. PDF may use a Latin fallback; JSON/Markdown preserve Unicode.
Codex cost/cache creation may be unavailable; no values are invented. Local
package build is not signing/notarization or turnkey sidecar distribution proof.
