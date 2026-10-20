# Public repository reference evidence

These datasets supplement n8n. Their actual documentation is imported unchanged; this acceptance plan is not supplied as an upstream requirement. The earlier user-requested AI hold was explicitly lifted on 20 October; see [live AI results](PUBLIC_REPO_AI_ASSESSMENT_2026-10-20.md). The two libraries are deliberately small so every imported file can be accounted for. They do not cover every application type or human-interface risk.

## CORS middleware

- Repository: [expressjs/cors](https://github.com/expressjs/cors).
- Downloaded clean `master` revision: `5317ebe670db2aaebc1d496eb5d33493deefb3ed`; 17 tracked files.
- Completed reference: [PR #385](https://github.com/expressjs/cors/pull/385), merged 16 January 2026, following submitted approvals by bjohansebas and UlisesGascon. It responds to [issue #384](https://github.com/expressjs/cors/issues/384). This is an older documentation-review reference, not a newly completed security audit.
- Core inputs: [README](https://github.com/expressjs/cors/blob/5317ebe670db2aaebc1d496eb5d33493deefb3ed/README.md), `lib/index.js`, `test/test.js`, `test/issue-2.js`, `package.json`, `.eslintrc.yml` and test configuration.
- Review objective when model access resumes: verify documented origin decisions, dynamic configuration/error propagation, preflight response handling and ordinary-request continuation against source and tests. Report actionable evidence-backed discrepancies. Do not demand that this header middleware authenticate users or block non-browser requests, and do not call a documented wildcard configuration an exploitable vulnerability without an attack path and deployment context.

Measurable review checks:

1. The documentation explains the middleware's response-header role and browser enforcement; no claim that it blocks arbitrary HTTP clients.
2. Supplied origin callbacks and their errors follow the documented callback contract.
3. Preflight handling respects configured response status and continuation behavior.
4. Every alleged code defect identifies an imported file and valid line range with a concrete failing behavior; missing deployment context stays a coverage limitation.

## Serve Static middleware

- Repository: [expressjs/serve-static](https://github.com/expressjs/serve-static).
- Downloaded clean `master` revision: `109a299c26d2d532027bb6e66e50e365eeb8fcdd`; 25 tracked files.
- Completed reference: [PR #246](https://github.com/expressjs/serve-static/pull/246), approved and merged by UlisesGascon on 6 October 2026. The reference changes two spellings and explicitly claims no functional change. It is a useful false-positive control; it is not evidence of a security fix.
- Core inputs: [README](https://github.com/expressjs/serve-static/blob/109a299c26d2d532027bb6e66e50e365eeb8fcdd/README.md), `index.js`, `test/test.js`, test fixtures, `scripts/version-history.js`, `.eslintrc.yml`, `package.json`.
- Review objective when model access resumes: verify root-relative serving, dotfile policy, error/fallthrough decisions, method handling, redirects and documented response options against the selected source and tests. Distinguish implementation delegated to the `send` dependency from locally demonstrated defects. Treat the typo-only reference as behavior-preserving.

Measurable review checks:

1. The two reference spelling changes do not change middleware control flow or add dependencies.
2. Missing-file handling and error forwarding agree with the `fallthrough` option.
3. Dotfile behavior agrees with the documented default and explicit options.
4. Security claims name the input, trust boundary, reachable path and missing protection, rather than matching a dangerous-looking word.
5. Test fixture filenames such as `todo.txt` are not evidence of unfinished production behavior; CLI error messages are not automatically debug leakage.

## Readiness expectations and limitations

The deterministic repository checks require readable supported source and applicable parseable package configuration. Both clean checkouts pass these two checks. That does not certify build success, dependency safety, or complete documentation.

Requirements/design/standards outcomes remain **not assessed** while AI work is held. README API behavior, ESLint configuration and CI scripts are actual assessment inputs; a lack of a separate PRD or architecture filename must not decide a category automatically. Any eventual Completed result must satisfy every defined criterion with valid source evidence, including full-source accounting and scope coverage. Public PR approval is a reference, not an oracle that proves the current repository has zero defects.

The offline runner `sidecar/src/readiness/publicRepositoryStaticAcceptance.ts` verifies exact SHA and clean working tree, inventories Git-tracked files and content hashes, runs production deterministic readiness/rules, and writes ignored evidence. It never runs downloaded code or repository scripts, authenticates, starts a model, or mutates a project. Its inventory differs from the connected import scope; those differences must be retained explicitly.

The live GitHub adapter imports its supported text extensions. At these revisions, CORS has 17 tracked files versus 15 imported: `.gitignore` and `LICENSE` are outside that extension selection. Serve Static has 25 tracked files versus 18 imported: `.eslintignore`, `.gitignore`, `LICENSE`, `test/.eslintrc`, `test/fixtures/.hidden`, `test/fixtures/foo bar`, and `test/fixtures/snow ☃/.gitkeep` are outside it. The missing extensionless ESLint/test fixtures are an explicit coverage limitation for later review; the successful import must not be described as all tracked repository content. The offline report includes those files, so its inventory and the live Review manifest must not be conflated.
