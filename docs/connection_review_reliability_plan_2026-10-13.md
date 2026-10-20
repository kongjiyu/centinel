# Connection, project import, and Review reliability plan

## Phases and ownership

1. Reproduce and stabilize: Luna Max auth diagnosis/recovery; Luna Max Review iteration and retry seam; coordinator project-loading/query-count baseline.
2. Deliver background import and visible states: Luna Max source worker/Source UI; Luna Max Review retry activity; coordinator progressive project metadata and bulk artifact versions.
3. Integrate and verify: coordinator functional/regression/build/viewport checks; agent-led security/usability review; fix blocking findings and synchronize acceptance evidence.

User requested implementation directly. Retry-count elicitation recommended 3/5 total attempts including first; optional clarification pending. No live database/schema change or clock mutation authorized/performed.

## Acceptance traceability

| Feature | Criterion | Acceptance | Test cases | Status | Risk flags |
| --- | --- | --- | --- | --- | --- |
| F1 Auth/status | AC1 | Future JWT classified and bounded; no validation bypass; transient failure preserves known connector state | T-AUTH-01..04 | Pending | Security, Functional |
| F2 Project loading | AC2 | Rows render before optional settings/summary work; unresolved states truthful; versions bulk-loaded under RLS, all pages retained | T-LOAD-01..04 | Pending | Usability, Performance |
| F3 Background import | AC3 | Project creation returns while importer blocked; durable queued work, full pagination, dedup, valid-session recovery, failure persistence | T-SRC-01..05 | Pending | Security, Functional |
| F4 Source UX | AC4 | Actual progress/history/recovery visible, polling bounded, keyboard/live-region and three viewports pass | T-UI-01..04 | Pending | Accessibility, Usability |
| F5 Review payload | AC5 | Root Review iteration never null; child metadata preserved; idempotent creation remains valid | T-REV-01..03 | Pending | Functional |
| F6 Retry policy | AC6 | At most 3 non-AI/5 AI total calls; increasing waits; permanent errors stop; cancellation and recovery budgets respected | T-RETRY-01..06 | Pending | Security, Functional |
| F7 Retry presentation | AC7 | Retry service/attempt/limit/wait shown in Review Activity/Playground and Source without secrets | T-UI-05..06 | Pending | Accessibility, Usability, Security |
| Delivery | AC8 | Required builds/regressions and agent security/usability reviews pass with no blocking findings | T-VERIFY-01..04 | Pending | Verification |

## Findings and decisions

- Initial code evidence: POST /projects awaits `importSource(sync:true)` before returning; project summaries await all project detail calls; listClientArtifacts lists versions separately for each artifact; createReview sends `iteration:null` when absent.
- JWT failure supplied by user occurs after auth validation in a Supabase integration query. The provider connection must not be treated as revoked merely because that query failed.
- Existing dirty Playground/harness changes must be retained. Any unavoidable overlap is integrated surgically.
- Required test/run results and review findings are maintained in the Tests document. Acceptance remains pending until evidence is recorded.
