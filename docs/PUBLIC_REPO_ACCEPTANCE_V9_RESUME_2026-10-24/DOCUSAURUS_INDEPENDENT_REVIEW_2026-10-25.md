# Docusaurus v9 adjudication — independent continuation review

**Disposition: saved adjudication verified; benchmark NOT_ACCEPTED.** No blocking defect was found in the scoped adjudication or verification output. No judgment correction was required. This is an independent review of an existing adjudication, not a second production execution or general accuracy certification.

Reviewed on 25 October 2026 against frozen case `facebook__docusaurus-9897`, base `0589b1475d56b0b541348aa56f201ec7c56c56d5`, benchmark revision `846e647b9f33c0b51b739d005d13d85493c9af09`. Production Review `2bae2cf4-a5d0-4705-9eb3-77d893dac421` is in `evidence/public-repo-outcomes-2026-10-22/run-2026-10-24T15-46-37-089Z`, using policy `review-2026-10-24-batch-domain-coverage-v9`. Observed production provider/model is `codex/gpt-5.6-sol`; it is distinct from independent review work.

## Judgment review

All 43 returned findings (29 model, 14 deterministic) were read alongside their 61 atomic adjudication rows. Relevant frozen helper bodies, public exports, selected callers, normalization, comments and guards were inspected; selected-source searches checked caller absence claims.

1. **Supported conditional helper facts remain bounded.** These include extension-case inconsistency, raw inherited-key grouping failure, UTF-8 byte truncation, heading fence-state rewriting, regex directive interpolation, malformed link decoding, parent-path filesystem behavior, short hash noninjectivity, shell-sensitive filename interpolation, incomplete port parsing and loader-limit value types. These facts do not establish an exploitable deployed application. The data-file and generated-file APIs document relative paths; their missing containment checks support the stated conditional behavior, without proving a violated security boundary.
2. **The three false unique claims have concrete counter-evidence.** Tag normalization explicitly promises uniqueness by permalink and leaves collision behavior undetermined (`tags.ts:64–83`, `91–98`). A rooted later argument does not reset `path.join`, unlike `path.resolve` (`emitUtils.ts:76–85`; trusted Node controls confirm both POSIX and Windows examples). Port zero permits an OS-assigned server port and is not intrinsically unusable; no selected consumer prohibits it (`constants.ts:85–88`).
3. **The 12 Unknown unique claims retain missing causal evidence.** Downstream credential disclosure, installation compromise, actual asset overwrite, untrusted filesystem access/write, supported application shell execution, startup failure and loader rejection need omitted caller, dependency, environment or trust evidence. In particular, ordinary front matter prepends `tagsPath` before grouping (`tags.ts:34–83`); this prevents crediting a raw `__proto__` helper example as a demonstrated ordinary build exploit.
4. **Gold remains missed.** None of the 29 model findings identifies `unwrapMdxCodeBlocks`, CRLF versus LF and its extraction boundary. The exact source (`markdownUtils.ts:70–84`) requires immediate LF after `mdx-code-block`; CRLF cannot satisfy that opening boundary. Heading-ID fence tracking and directive interpolation concern different operations. The deterministic TODO is not a CRLF prediction. The registered compilation consequence was not reproduced. Intentional three/four-backtick scope is preserved. Credit remains zero issues and zero occurrences, with canonical occurrence `occurrence-1`.

Unique model verdicts are **14 true / 3 false / 12 Unknown**: provisional resolved-claim precision **14/17 = 82.35%**, Unknown-inclusive bounds **48.28–89.66%**. Deterministic verdicts are **14/14 true** for literal TODO/physical-span observations, without certifying defects or severity. Aggregate resolved-claim precision is **28/31 = 90.32%**, bounds **65.12–93.02%**. These bounds are verdict bounds, not statistical confidence intervals. Duplicate manifestations share a key, including tilde and longer-backtick heading fence-state failures.

## Acceptance and checks

| feature | acceptance criteria | status | risk flags |
| --- | --- | --- | --- |
| Frozen provenance | Preserve gold, selected bytes and imported identities/versions | PASS: 3 frozen bundle files; 31 staged originals; 29 selected files / 129,497 bytes; all byte/Git-blob/import/manifest checks pass | Bounded module selection |
| Completed Review | Successful provider-backed workflow and saved evidence | PASS: `pending_approval`, `modelStatus=succeeded`; 25/25 saved batches; 28 attempts (25 success, 3 malformed responses repaired) | No approval submitted; execution success is not semantic success |
| Adjudication/reference integrity | Cover every finding and validate citations | PASS: 43/43 findings; 844/844 production references; 121/121 adjudicator references; 1,514/1,514 topology references | Exact citations alone do not prove causal conclusions |
| Inspection/domain disclosure | Inspect selected code and disclose four domains | PASS: 23/23 selected JS/TS files; 192 preserved inferred features; 768/768 domain pairs | Only 474/768 rows are evidence-supported non-N/A outcomes; bounded graph has unresolved/runtime boundaries; no independent validation of every no-issue conclusion |
| Registered semantic acceptance | Meet frozen five-project/seven-occurrence requirements with resolved adjudication | NOT_ACCEPTED: Docusaurus gold recall 0/1; 12 model Unknown keys remain | Other cases and Readiness are outside this review; fixed denominators remain 5 issues / 7 occurrences |

Executed `node docs/PUBLIC_REPO_ACCEPTANCE_V9_RESUME_2026-10-24/adjudicate-docusaurus.mjs` successfully. The trusted evaluator and its local scorer imports were inspected before execution. It read/parsed upstream files but did not import or execute upstream modules. An additional independent Node reader verified all 121 adjudication excerpts by exact starting line and all 12 captured source-artifact hashes. All 211 captured runtime source files match their runtime manifest. The rerun reproduced both saved JSON outputs byte for byte.

No upstream install, upstream tests/code, network, provider, browser/app operation, production code change, gold/source change or historical-report revision occurred. Application tests/builds were not run because this work changes only this review document. Remaining semantic gaps are disclosed above, not execution blockers for saving this audit.

## Final reviewed SHA-256 values

| File | SHA-256 |
| --- | --- |
| `adjudicate-docusaurus.mjs` | `59fa7648762d30aae851fbe57e7877a675bf36d506697107d42ac441a68dc3f5` |
| `review-docusaurus-adjudication.json` | `592b62312ce8ff324ab945907572134cf7ecc1f41cc085b1014384bff5063bcb` |
| `review-docusaurus-verification.json` | `fdd0e33b19e3670ecba18b5ed28c7f692827ec2cec7e8830a8091d97eae33b9b` |
| Run `0087-review-session.json` | `fc778d895964c1513f6208698c6699c72d761a9bcb17b6a91724be7f50f96e9c` |
| Run `0088-review-findings.json` | `7bbf5bb1e6b748c752f47327344f5e75537f97bc0e3af0663e4a719cb7a7ec46` |
| Run `0089-review-manifest.json` | `c891114a4a8530aa6e50de0036c1bbced41e5e78762e0a14787757e9952f54d4` |
| Run `0092-review-harness.json` | `72fcd7a226f868867ab08630d2d294430452b3d16f4a7e818c61a4c03eb71cb4` |
| Run `runtime-code-manifest.json` | `462cf1973f8e914f0cf51c21da665d6348de0c89a1f3e1d01335eb5b3039da80` |
