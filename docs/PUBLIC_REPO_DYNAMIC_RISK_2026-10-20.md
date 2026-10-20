# Dynamic regression risk follow-up

AI assessments remain held by the user. All checks here use deterministic tests and local synthetic HTTP/TLS targets; no public-site probing, model request or live project finding decision was performed.

## Results

- The earlier saved broad run had 47 failed assertions. With the currently installed project Playwright browser available, the first new full run reported **750 passed / 21 failed / 0 pending**. This is an observed environment improvement, not a claim that all earlier failures were fixed in code.
- Two TLS fixtures assumed a Unix OpenSSL path or a working PATH-selected OpenSSL configuration. The Windows PATH-selected UCRT binary did not have the expected configuration. The new test helper uses Git for Windows' bundled OpenSSL and explicit bundled configuration, with an ephemeral localhost certificate and SANs. Unix tests continue to use OpenSSL on PATH. Missing tooling produces an explicit error, not a skipped test.
- The TLS origin-policy, download and protected-capture suites passed **29/29** after that change. The prior screenshot failure did not reproduce; no screenshot production code was changed and no general flake fix is claimed.
- The final complete sidecar run reported **753 passed / 18 failed / 0 pending**. Its JSON report is `evidence/public-repositories-2026-10-19/sidecar-regression-final-2026-10-20.json`. Sidecar TypeScript and scoped whitespace checks passed. No failed test was skipped or weakened to obtain this result.

## Remaining risks

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Browser origin/TLS restrictions | HTTPS destination checks and authorized synthetic download behavior remain enforced | Passed focused tests and final broad run | Does not certify arbitrary application security |
| Protected pixel capture | Known values/passwords are masked without changing application values | Passed focused and final broad run | One earlier screenshot transport failure; no production change or general reliability claim |
| Repository process containment | Timeout/cancellation must terminate the entire authorized process tree and release leases safely | Not supported on Windows; execution remains blocked | Requires a proper Windows containment design such as Job Objects and crash/recovery tests; do not replace the guard with parent-only termination |
| Symlink/path-escape checks | Real link fixtures prove metadata/evidence/report isolation | Blocked for several fixtures by Windows symlink privileges | No Developer Mode/security changes made; no replacement with ordinary files that would stop exercising link behavior |
| Private local vault files | Verify access is limited using the platform's real permission mechanism | POSIX 0600 assertions fail on Windows; Windows ACL acceptance remains unverified | Node's Windows mode bits are not an ACL proof; neither privacy acceptance nor a confirmed public-data exposure is established by that assertion alone |

The 18 remaining failures are in `dynamicEnvironment` (1), `dynamicHooks` (1), `dynamicProcessLease` (2), `dynamicSessionVault` (1), `dynamicSharedEvidence` (1), `dynamicUploads` (1), `dynamicVitestRunner` (6) and `dynamicWorkspace` (5). They concern the platform limitations above. The full backend suite remains **unaccepted**. The Static public repository import and deterministic assessment results must not be reported as acceptance of these Dynamic capabilities.
