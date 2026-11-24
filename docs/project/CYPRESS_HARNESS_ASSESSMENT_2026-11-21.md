# Centinel harness assessment on Cypress Real World App

21 November 2026 · Windows 11 · Centinel working tree based on `a62ceee` · Node `22.21.1` · Yarn `1.22.22`

The assessment used the [Cypress Real World App](https://github.com/cypress-io/cypress-realworld-app/tree/9dfcb9869533ce8a8963c556facc0d80457f9d39) at `9dfcb9869533ce8a8963c556facc0d80457f9d39`, in an isolated checkout under ignored `evidence/harness-assessment/`. The local seed file SHA-256 was `c2449435bbf44bcef412a178fb51b8561d3c2d7ba9fc55b10d0b8a09ea66c3a1`. Installation used the upstream frozen lockfile and skipped the Cypress binary. Centinel's Browser scenario used Playwright Chromium.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Context handling | Bound repository input, retain attached source identity and validate an exact quote | Local probe passed. Digest contained 52 entries, 45 routes, and seven forms, with zero reported omissions. The scoped turn recorded its attached evidence hash and version. | The probe used a local evidence adapter and one attached source file. Hosted retrieval, context saturation and model grounding remain unverified. |
| Conversation | Record a grounded explanation and enforce approval for execution | Local probe passed. The explanation carried one validated citation. Code and Browser scenarios rejected stale approval revisions and required the current approval before executing. | Action selection was scripted. Live-provider interpretation and hosted request lifecycle remain unverified. |
| Memory | A follow-up can reuse an earlier turn when needed | Gap confirmed. The earlier turn existed in the local store and was absent at the evidence-backed planner boundary. The legacy Browser prompt builder included a synthetic earlier message when supplied. | Repeated follow-ups can lose a prior referent. This assessment made no memory behavior changes. |
| Code mode | Freeze a scoped source and build an assessment plan | Deterministic preparation passed for `src/components/SignInForm.tsx`. One source parsed, two features, two batches and three unresolved edges. | The analysis map remained unverified. No provider assessment or end-to-end Review child ran. |
| Browser mode | Restore the saved test, preserve its bound scope, and observe the page with independent checks | The direct-start Chromium probe discovered the real username control and typed into it. The saved sign-in heading check passed, the deliberately wrong expectation failed, and altered start-path binding was rejected. | Centinel automatic startup stopped at `tool_missing`. The direct Vite probe covered the sign-in form with an in-process Playwright executor. Backend authentication and the production Dynamic Run pipeline remain unverified. |

## Findings

1. **Evidence-backed conversation has no turn recall.** The planner sends the current request, mode and resolved evidence. A follow-up with no attachment supplies project inventory in production, with no earlier conversation turns. Evidence-backed Browser child creation also passes an empty `history`. The legacy standalone Browser route builds history separately from earlier Auto test requests. These paths give the person different recall behavior. See [`conversation/plan.ts`](../../sidecar/src/conversation/plan.ts), [`index.ts`](../../sidecar/src/index.ts), and [`autonomous/routes.ts`](../../sidecar/src/dynamic/autonomous/routes.ts).
2. **Windows automatic startup cannot select the installed Yarn shim.** Corepack Yarn Classic installed the target dependencies successfully. Centinel reserves automatic startup for an eligible native executable or JavaScript entry point on Windows and rejects Corepack shims. The probe recorded `tool_missing` before any app process or startup output. A direct Vite launch isolated Browser execution from this prerequisite. The compound upstream `dev` recipe and backend readiness after resolving Yarn still require verification. See [`workspace/packageManager.ts`](../../sidecar/src/dynamic/workspace/packageManager.ts).

## Temporary logs and display

The renderer can show a collapsed **Harness trace** under the signed-in request owner's evidence-backed conversation turns. It displays the selected mode and action, counts for attachments, resolved or unavailable evidence, citations, code files and Browser targets, the recorded child type, and elapsed times from saved request stages. A completed request stage describes the orchestration lifecycle. Test verdicts remain in saved execution results.

Set `VITE_CENTINEL_HARNESS_TRACE=1` before starting the development renderer. The flag defaults to off and production builds omit the disclosure. The trace contains stage labels and metadata counts. Raw prompts, source bodies, process output, selectors, credentials, identifiers and hashes are outside the disclosure.

The temporary probe output is in `evidence/harness-assessment/rwa-trace.jsonl`. Its local runner `rwa-probe.mts` uses Centinel's conversation state machine, Code analysis functions, Browser target binding and checker. Model responses, evidence storage and execution adapters are local fixtures. Run it from this checkout with `pnpm --filter @centinel/sidecar exec tsx ../evidence/harness-assessment/rwa-probe.mts` after installing the pinned target dependencies.

## Verification

- Upstream RWA `test:unit:ci` reported **44 passed, 10 skipped, 0 failed**. Machine-readable results are under `evidence/harness-assessment/rwa-unit.json`.
- Centinel conversation, launcher, orchestrator, HTTP and Browser suites reported **75 passed, 1 skipped** across seven files.
- Centinel trace, Project conversation and Project/Check navigation suites reported **21 passed** across three files. Trace coverage includes development opt-in, owner gating, production exclusion and filtering of non-allowlisted events.
- A Chromium fixture rendered the actual conversation-turn component at 1440 × 900, 1200 × 900 and 390 × 844. Keyboard activation, viewport fit and the narrow tap target passed. The trace was absent for a different owner. Screenshots are in `evidence/harness-assessment/`.
- The production frontend build passed. This assessment did not use a live provider, hosted project writes or signed-in native Tauri.
