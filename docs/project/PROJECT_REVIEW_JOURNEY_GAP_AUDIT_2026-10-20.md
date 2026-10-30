# Project initiation through review: acceptance audit

Date: 20 October 2026. Scope: current working tree; Static Review and Project Readiness. No upstream writes or finding decisions were made.

## QA inventory before interface verification

| Claim / control | Functional check | Visual state / evidence |
| --- | --- | --- |
| Activity explains the process and preserves timing | Existing stage, duration and finding-navigation tests; open Activity in browser | Completed review at 1440×900, 1200×900 and 390×844 |
| Feature scope and four domains follow saved outcomes | Expand feature, inspect domain outcomes, expand path questions and coverage limits | Partial assessment with unsupported source and unresolved recovery |
| Missing history is explicit | Render an older review without a feature map | Unavailable-history copy; no clean-result claim |
| Provider capacity stops work | Synthetic capacity failures stop before completion, no retry/fallback | Existing pause UI tests; real AI work remains paused |
| Resolved findings no longer count in current risk | Assessment uses the same project-wide projection as Findings | Regression checks; immutable review history retained |
| GitHub checks head before content | Read-only live adapter probe against two public repos; scheduler/importer contract tests | JSON transport evidence, separately from authenticated app acceptance |
| Readiness outcomes follow the stated rubric | Fixture engine/evaluator checks and real-model corpus | No real-model signoff until the full corpus passes |

Off-happy paths: malformed/unreadable/unsupported source; invented or mismatched model references; missing correlation evidence; provider pause; old reviews with no saved map; narrow viewport with long source paths.

## Confirmed gaps and dispositions

| Gap | Evidence / impact | Disposition |
| --- | --- | --- |
| Risk exports used raw historical findings after derived resolution | `sidecar/src/report/supabaseSnapshot.ts`, `getProjectAssessment`; Findings already reconciled project history | Fixed with shared `loadCurrentProjectFindings`; regression tests cover resolved, unavailable evidence and loading failure |
| Four-domain feature/path assessment was only a proposal | Orchestrator previously sent a generic findings prompt | Bounded JS/TS syntax map now prepared before inference, saved to existing audit journal, assessed against exact source references and shown in Activity. Runtime/dependency/unsupported-language paths stay unverified. Real-model quality remains unaccepted |
| JS/TS object indentation could become a nesting finding | `sidecar/src/rules/codeQuality.ts`, `cq-deep-nesting` counted whitespace | Fixed for JS/TS using control-flow syntax. Other-language rules remain heuristics |
| Generic secret rules could treat interpolation or symbolic values as credentials | `sidecar/src/rules/secrets.ts`, `secrets-api-key` used a name/string regex | JS/TS now requires an actual static literal, excludes environment expressions and a narrow symbolic-value list, reports a candidate rather than proved leakage, and redacts its value. Other-language rules and specific-format scanners need further precision evaluation |
| Local project creation can persist before import failure | `sidecar/src/index.ts`, POST `/projects`: create, save source, import, then readiness notify. `applicationApi.ts` can throw on coverage write | Open. A storage/coverage failure can return 400 after the project exists, without an actionable project ID. Needs durable import state and retry UX rather than a destructive rollback |
| Source labels overstate content classification | `sidecar/src/artifacts.ts`: `.md`/`.txt` default to requirement. `ArtifactsPanel.tsx` displays Category | Open. Readiness scans content semantically, but Source labeling remains a filename heuristic; show it as a hint or support confirmed classification |
| Automatic sync depends on an open authenticated workspace | `centinel/src/integrations/githubReconciliation.ts`: five-second startup, 30-second ticks, five-minute eligibility | Designed limitation. App-closed scheduling is not implemented. Authenticated scheduler→worker→Storage live verification still pending |
| Readiness model accuracy is not accepted | Saved current run stops at rate limit after criterion mismatches | Blocked on provider capacity, then full corpus rerun. No passing claim from deterministic fixtures |
| Static resolution is absence in a comparable successful changed-source review | Reconciliation requires scope/config/policy/manifest guards | Deliberate limit: not independently executed regression proof. Ambiguity or missing evidence keeps the issue open |
| Windows Dynamic Testing is not fully accepted | Existing Dynamic runner test failures: symlink privileges, POSIX permissions/process groups and one hook-runner outcome | Outside Static acceptance; do not describe the whole product as passing |

## Pending acceptance

The complete real-model readiness corpus, authenticated automatic-sync lifecycle, and real model four-domain review/reconciliation on updated imported sources are not accepted. Provider usage-limit failures stopped the AI workers; `CENTINEL_AI_ASSESSMENT_PAUSED=1` was restored. Resume only on a further user request. No retry or provider substitution was attempted.

Verification results and residual risks for this working-tree pass are recorded in `PROJECT_REVIEW_ACCEPTANCE_2026-10-20.md`.
