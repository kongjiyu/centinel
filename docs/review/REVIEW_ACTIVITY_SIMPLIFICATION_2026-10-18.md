# Review explanation refinement — acceptance

The user's follow-up supersedes the earlier detailed activity disclosures. Shared React components serve browser and desktop. No review execution, approval, or live-data write is required for this refinement.

## QA inventory

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Plain language | Objectives, summary and stage messages use familiar terms. Exact authored instructions remain in the objective dialog. | Pass | Text substitution simplifies display; it does not invent business requirements. |
| Duration | Overview and Activity show execution time from saved step boundaries, including duration metadata when timestamps tie. Nested/parallel steps are not added together; approval time is excluded. Each stage shows its own duration. | Pass | Runs without timing evidence say Not recorded. |
| Usage | Overview has no Model Usage section or usage request. | Pass | Usage elsewhere is unchanged. |
| Document findings | Saved document gaps and a recorded lack of confirmed requirements appear in the review's Findings list, totals, and Activity links. Details show evidence and the required action. | Pass | These are immutable views of the saved assessment, not editable code-finding records; update documents and run a new review to reassess. Project-wide reports/exports retain their existing stored-finding contract. |
| Stage messages | A horizontal divider precedes the messages. Short engineer-style messages explain the work and next step. Only finding names/types appear in the stage; clicking opens the matching finding detail. | Pass | Unknown finding provenance is labelled separately; no invented stage attribution or private reasoning. |
| Controls and responsive layout | Verify tabs, exact finding selection, objective expansion, 1440×900 / 1200×900 / 390×844, and style isolation. | Pass | No live decision submitted during QA. |
| Off-happy paths | Missing history retains finding links; failed/partial/running checks stay honest; unknown/invalid timing does not become zero. | Pass | Historical gaps remain explicit. |

## Verification

- **54 targeted tests passed** across narrative, saved document findings, Review Activity, shared Findings, harness state, and lifecycle view-model tests.
- **Production frontend build passed**. Vite retains the existing large-bundle warning.
- Browser functional/visual checks passed at **1440×900, 1200×900, 390×844**: total and stage durations, divider, short messages with no full descriptions, exact security/document finding selection, original objective dialog and Escape, no Model Usage section, missing-history fallback links, and no review-screen horizontal overflow. No browser page errors and no API writes occurred.
- Home remains outside the scoped narrative styles. Native Centinel was read without activation or input; it is currently on Home. This turn did not navigate its actual Review detail, so the new detail behaviour is verified in the shared browser frontend rather than separately in native WebView.
- Document gaps are derived from persisted review assessments with stable scoped IDs; they do not write synthetic code-finding records or offer unsupported status updates. Their counters apply to this Review workspace. The earlier persisted finding-correlation and project/export contracts are unchanged.
- Review-in-progress finding links remain inspectable with read-only details; polling no longer forces the Activity tab back over the user's chosen Findings tab.
- Direct review covered correctness, regressions, security and usability. Unknown origin is kept outside stage-specific messages; missing timing is explicit; private thoughts and arbitrary step metadata remain excluded.
- Screenshots are local generated artifacts under `evidence/review-simplification-2026-10-18/`. Synthetic fixture: `scripts/review-narrative-qa-fixture.mjs`.
- Full frontend and native packaged-build suites were not run; the pre-existing source-panel error-copy test mismatch from the previous task is outside this change.
