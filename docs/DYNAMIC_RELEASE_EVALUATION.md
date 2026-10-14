# Dynamic release evaluation checkpoint

This checkpoint records the predeclared six-sample Codex corpus on engine `44916ff991439a6f824a1347798e3578c9ce88e6`. It is not final release acceptance. Static is excluded; real API-provider acceptance is deferred by direct user decision. Native Centinel GUI/export is still unverified because the Mac is locked and the CLI automation binary lacks Accessibility permission.

## Fixed-corpus outcomes

| Variant / repeat | Run | Functional | Rule failures | Criterion coverage | Reader proof | Elapsed ms | Steps / model calls |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| normal / 1 | `bdd3ef8f-c490-4ac5-863b-a82248981292` | passed | None | 1 / 1 | 3 / 3 | 8194 | 5 / 1 |
| normal / 2 | `12ae1bad-ca4a-41d8-87e9-d2ab13a92080` | passed | None | 1 / 1 | 3 / 3 | 8073 | 5 / 1 |
| normal / 3 | `d69dadc5-e3e0-41cc-89f4-36dab263e619` | passed | None | 1 / 1 | 3 / 3 | 6021 | 5 / 1 |
| defect / 1 | `ede449eb-8191-42e1-b5fe-13b04f79c762` | passed | labels, keyboard | 1 / 1 | 3 / 3 | 6614 | 5 / 1 |
| defect / 2 | `88a9141c-06c0-4dfa-a36c-8268f17e0924` | passed | labels, keyboard | 1 / 1 | 3 / 3 | 6066 | 5 / 1 |
| defect / 3 | `20acb82a-f549-453e-a42e-5283a6415a76` | passed | labels, keyboard | 1 / 1 | 3 / 3 | 6724 | 5 / 1 |

All six functional outcomes matched the declared Ready criterion. Normal had 0/3 failed label/keyboard observations; both planted rule failures repeated in 3/3 defect Runs. All 18 recorded proof slots were fetched by Reader with matching SHA-256. Median elapsed time was 6669 ms; this corpus has no latency or cost threshold.

These are two planted rule defects on a tiny public fixture. There is no broad usability recall, real-user-study or complete accessibility claim. Explicit QA simulations confirmed the two correlated candidates; this is not stakeholder approval. The final report is `3c479bb7-faae-4a02-af4a-a946970a3628`, preserving three observations per finding, attributable review and mock source coverage.

One budget receipt was absent at its first terminal read and collected afterward from the same immutable Run’s device-local receipt. No sample was rerun or replaced. A setup attempt supplied an unsupported mock deployment version and was rejected before any browser Run; its local audit is retained. Mock deploymentVersion remains unknown/null.

## Scripted baseline and available usage

Installed Codex CLI: **0.162.1**. An independent script used Playwright accessible-role lookup and four explicit Tab presses, without importing the Centinel assessor. Normal exposed the name field and reached it by keyboard; defect exposed no configured name and Tab did not reach it. Baseline elapsed times were **222 ms normal / 46 ms defect**, with **0 model calls**. These pre-scripted selectors do not include AI planning; the timings are not a general comparative performance result.

| Sample | Model calls | Input | Output | Cache read | Cache creation | Accounted tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| normal 1 | 1 | 12399 | 38 | 4608 | Unknown | 12437 |
| normal 2 | 1 | 12399 | 38 | 9600 | Unknown | 12437 |
| normal 3 | 1 | 12399 | 37 | 9600 | Unknown | 12436 |
| defect 1 | 1 | 12397 | 38 | 9600 | Unknown | 12435 |
| defect 2 | 1 | 12397 | 36 | 4608 | Unknown | 12433 |
| defect 3 | 1 | 12397 | 36 | 4608 | Unknown | 12433 |

The two declared planted rule failures were detected in all three defect repetitions (6/6 declared observation opportunities). Zero failed label/keyboard observations occurred on the normal page. Both correlated candidates were reviewed under the documented QA simulation, with three matching observations apiece. Broader finding precision/recall remains unmeasured; no additional application defects or cost values are inferred.

## New-project identity

New shared project `be7c5caf-d667-4b60-88d1-1ef5aac7748c` created and executed Run `f49ab001-249e-414f-b7bb-c6e8c15517b3` through bearer Supabase and real Codex: completed/passed, one check and two proof slots. No old local project record existed before start. A local legacy mirror became observable in a fresh process later; it was not a prerequisite. An authenticated member of the other QA project was denied with HTTP 403.

An initial harness incorrectly expected the local mirror to be immediately present after the terminal response. The preserved completed Run was re-read after correcting that assertion; no replacement Run was created. Empty project source inventory and explicit mock context were used; no Static Review was performed.

## Packaged build checkpoint

On macOS 26.6.2 (25G83), arm64, `pnpm build` passed and produced `Centinel.app` and `Centinel_0.0.1_aarch64.dmg` (application version 0.0.1). DMG SHA-256: `87fa002565278f72f2a004a068cef5b5de9c2a20e36a4188aea9c41cd494c690`.

Launched the built app in the background through the native launcher and verified its running executable points inside this worktree’s release bundle. This proves process launch, not sign-in, rendered UI, Codex use or native save. Those remain required after unlock. The package is a local development build, with a separately configured local sidecar and no signing/notarization claim.

## Remaining M7 work

- Broader metric/coverage and acceptance matrix audit beyond this declared tiny corpus.
- Explicit PRD 3–14 evidence matrix; scenario 12 API live portion remains deferred, and 1–2 Static scenarios are excluded.
- Current runtime interruption/recovery, offline upload, expired/refreshed/revoked access, authorization and seeded-secret checks where existing evidence is insufficient.
- Packaged client sign-in, live Codex/executable configuration and native verified report save.
- Setup/demo/recovery guide, known limitations, release checklist and full completion audit.

Raw snapshots and audit JSON remain ignored under output/playwright and output/pdf. No primary or browser-target data was changed by this read-only corpus.
