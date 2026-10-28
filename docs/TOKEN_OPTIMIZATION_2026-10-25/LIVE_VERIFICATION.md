# Live token accounting verification — 25 October 2026

The signed-in owner's Review setting was changed through Settings to `codex / gpt-6.1-sol`; Dynamic testing remains unconfigured. The previously installed official CLI 0.144.1 listed only three 5.6 choices. The official pnpm package `@openai/codex@0.164.0` lists seven choices, including GPT-6.1 Sol. Its verified executable is installed in the device-local Centinel tools directory and selected through the Git-ignored `CENTINEL_CODEX_BIN` runtime setting. No global CLI, account credential or repository dependency was replaced.

The public account catalog returned HTTP 403 for this existing OAuth session. Centinel therefore shows the actual native CLI catalog with an explicit freshness warning; it does not fabricate model availability. The source contract follows the [official account catalog guidance](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), with conservative native fallback for an incompatible account session. A successful live inference, rather than a listed choice alone, establishes access for this configuration.

## Bounded Review

- Project: existing Axios evaluation project `3c66cb23-9805-471d-97e6-719182787d94`.
- Review: `e593fa27-1e10-4ebc-a127-05a32693a014`, named **Token accounting verification · one Axios helper**.
- Selected file: `lib/helpers/isAbsoluteURL.js`, 15 lines, 561 characters, frozen version `b234262c-aa66-473f-bec9-42856b54a43a`.
- SHA-256: `ac0012f9bca951480bb6840f67b2be295817050666287e250f167aae87aa3e7a`, matching the local pinned input.
- Saved model policy: `review-2026-10-25-semantic-support-token-context-v11`.
- Result: `pending_approval`, both model operations successful, all five pipeline stages completed. The UI retains the document-quality finding **Business requirements need confirmation**; zero model code defects is not a claim of complete requirements. No approval was submitted. This one-file instrumentation check is separate from the frozen five-repository quality benchmark.

| Stage | Calls | Input | Output | Known total | AI files | Physical files |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Freeze review sources | 0 | 0 | 0 | 0 | 0 | 1 |
| Index project context | 0 | 0 | 0 | 0 | 0 | 0 |
| Deterministic checks | 0 | 0 | 0 | 0 | 0 | 0 |
| Model analysis | 2 | 30,031 | 714 | 30,745 | 1 | 0 |
| Save evidence | 0 | 0 | 0 | 0 | 0 | 0 |

Both requests are recorded as `initial_analysis`; the planned feature packet and independent source sweep are separate operation keys. There were no repair or candidate-support calls in this clean one-file result. The two exact provider totals are 15,977 and 14,768. The stage subtotal, phase subtotal, provider/model group and review total all reconcile to 30,745. Cache reads were reported as zero; cache-creation reporting is unavailable for both calls. The distinct-file total is one, with two AI appearances and one successful hash-checked physical read. Earlier project findings remain unverified rather than being resolved by this narrower scope.

Safe evidence captures are under ignored `evidence/public-repo-outcomes-2026-10-22/token-instrumentation-live-2026-10-25/`; the terminal capture is `1792919395837-3.json`. The metadata includes no prompts, source bodies, provider secrets or private reasoning. Runtime provenance is in `evidence/public-repo-outcomes-2026-10-22/token-runtime-current.json`.

## What this measurement exposes

The minimal Settings text test recorded 12,306 input tokens and 15 output tokens on `gpt-6.1-sol`. Its visible prompt is tiny, so provider/CLI request framing is material. This is an observed baseline, not proof that any specific internal instruction or tool accounts for exactly that amount. The two Review requests used 28,252 application characters across user/system/schema components in total, whereas actual input was 30,031 tokens. Character heuristics are unsuitable for attributing the residual to a particular internal component.

The root-cause assessment must therefore distinguish repeated application source/graph/schema context from the Codex transport's fixed overhead. The shipped packet reduction and exact embedding reuse are useful, but do not remove all that fixed cost. Do not multiply the minimal test's count into an exact per-stage saving or convert it into a fixed Codex five-hour allowance percentage.

## Verification scope

Root frontend checks: 83 tests across five relevant files passed, including the live-discovered cache-unknown presentation regression; `pnpm --filter centinel build` passed with the existing large-chunk advisory. Independent source review and accounting/safety/auth checks are recorded in `INDEPENDENT_REVIEW.md`. Source hashes are verified against that report; no reviewed sidecar source was modified after the measured runtime started.

Settings and Review Activity usage were inspected at actual DOM viewports 1440×900, 1200×900 and 390×844: controls remain operable and no document-wide horizontal overflow was detected. Screenshots `token-settings-{1440,1200,390}.png`, `token-usage-stages-1440.png` and `token-usage-{1200,390}.png` are under the ignored evaluation evidence directory. The narrow table's ArrowRight scroll was verified. Viewport overrides were reset afterward. Expanded phase and source disclosures also show the actual 30,745-token initial-analysis subtotal, exact file/version/hash, lines 1–15, two appearances and one physical read.

The five frozen repository outcome evaluation remains unaccepted until its own complete live Review results and independent gold comparison pass. This instrumentation result establishes accounting behavior and actual model access, not five-repository precision or recall.
