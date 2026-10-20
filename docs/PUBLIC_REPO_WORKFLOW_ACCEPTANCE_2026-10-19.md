# Two public repository workflow acceptance

## Goal and boundaries

Run two additional independently verifiable public repositories through the production project import, readiness and Static Review workflow. Compare outcomes with independently recorded upstream documentation, tests and completed-review references. Keep the projects separate from n8n and preserve human approval and finding decisions. Read-only public repository access is allowed; do not publish reviews or comments upstream.

The production UI runs in the existing signed-in hidden browser so the user's desktop remains available. **The user subsequently requested that all AI outcome assessment be held because model usage is unavailable.** Model-backed project readiness, reviews and fixture outcomes therefore remain pending; no new model generation was started during this follow-up. Test datasets retain their actual source revision; generated acceptance notes are not presented as upstream requirements or added to make readiness appear complete.

## Acceptance inventory

| ID | Feature | Measurable acceptance criteria | Evidence |
| --- | --- | --- | --- |
| P1 | Public references | Two public repositories, pinned revisions, readable behavior documentation/tests, and a verifiable completed PR review per repository | Public reference report with links and independently judged expectations |
| P2 | Import | Source import completes with nonzero readable files and revision provenance; any skipped/unsupported material is explicit | Live Source history and artifact inventory |
| P3 | Readiness | Every category uses its defined rules; absent or inadequate design/standards need not become Completed; evidence must point to supplied content | Saved readiness state/findings compared with the reference expectations |
| P4 | Review | Explicit scoped objective, production source manifest, completed model attempt, stage activity, source-backed findings and honest coverage limitations | Live Review result plus independently checked reported locations and issues |
| P5 | Update lifecycle | Source updates prompt a linked review; missing/failed/partial results never resolve old findings; any resolved issue shows comparison evidence | Existing regression suite, plus live re-review if a meaningful verifiable before/after change is available |
| P6 | Model failure | Bounded recovery of eligible transient failures; semantic failures remain failures; no busy retry or fabricated Missing/Completed results | Adapter/evaluation tests and unchanged 11-case corpus report |
| P7 | Regression/environment | Relevant type checks, tests and build pass; previously flagged Dynamic failures are either addressed or explicitly retained with their cause | Focused and broader test results |

## Execution record

- Created **CORS Public Acceptance** from `https://github.com/expressjs/cors` using the normal signed-in GitHub project form.
- Initial live import failed with the application's explicit saved-GitHub-authorization rejection. No files were imported. The user was asked to reconnect GitHub in Settings; no new credential was read or copied.
- The user reconnected GitHub. Retrying the existing CORS source succeeded with **15 imported files**; creating **Serve Static Public Acceptance** from `https://github.com/expressjs/serve-static` succeeded with **18 imported files**. Both normal Source history panels showed `success`.
- A local `CENTINEL_AI_ASSESSMENT_PAUSED=1` setting now stops configured text assessments before settings resolution or provider/network access. Both Codex and HTTP provider paths have regression coverage. The readiness failure is classified safely as `assessment_paused`, with the previous snapshot preserved by the existing coordinator failure contract. The owned sidecar was restarted with this setting; Serve Static Overview visibly reported the hold, showed no semantic results, and offered Retry.
- Downloaded separate clean Git checkouts at the pinned revisions in the [reference report](PUBLIC_REPO_REFERENCE_2026-10-19.md). The production deterministic readiness check passed **2/2** repository checks for both. This offline result does not replace a live semantic snapshot: source/configuration presence is the only accepted result.
- The offline production rule pass initially produced 7 CORS and 38 Serve Static candidates. **33 Serve Static candidates were filename matches (`todo.txt`/`todo.html`) rather than TODO notes.** Requiring a marker separator removes those matches while retaining TODO/FIXME/HACK notes. The unchanged datasets now produce 7 and 5 untriaged candidates respectively. Remaining indentation/logging heuristics are not accepted as confirmed defects. This bounded fix is not a complete comment parser or general false-positive solution.
- No model-backed Review was started, no live finding disposition was changed, and no upstream content was published. Completed PR references are recorded for later comparison; they are not assumed to prove zero defects.

## Current acceptance

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Public datasets | Two accessible repositories, exact clean checkout SHA and completed review reference | Passed: CORS #385 and Serve Static #246 | Small libraries do not exercise a full human-facing application |
| Live import recovery | Successful normal import with nonzero files after reconnect | Passed: 15 CORS, 18 Serve Static | Connected import scope differs from all Git-tracked files; no whole-repository coverage claim |
| Repository readiness | Production static source and parseable package checks | Passed offline: 2/2 for each pinned checkout | Does not prove a build, dependency safety or semantic documentation completeness |
| Assessment hold | No configured provider/network call; explicit paused guidance | Passed unit checks and live Overview observation | Flag is installation-wide for configured text assessment and must be explicitly resumed |
| Filename false positives | Fixture filenames do not become TODO notes; real markers remain detected | Passed: 33 false matches removed on unchanged public data, positive/negative regressions pass | Other heuristic warnings still require triage |
| AI readiness and review | Semantic evidence, review findings and measurable real-model outcome comparison | Held by user | Not run or accepted; the earlier full 11-case model corpus remains open |
| Dynamic regression risk | Environment failures are resolved or truthfully documented | Final broad run: 753 passed, 18 failed; portable TLS fixture failures fixed | Windows process containment, symlink fixtures and ACL verification remain open; full suite is not accepted |

Verification so far: **131 sidecar tests in 7 files passed**, sidecar TypeScript check and frontend production build passed, deterministic public runner completed with **zero model requests**, and the two live Source histories showed successful imports. Serve Static's saved README also rendered successfully in the normal file preview. The build retains its existing large-bundle warning. The existing source-update/linked-review/resolution safeguards are covered in the focused suites; no live before/after AI finding resolution is claimed. The reference report lists the exact extensionless files outside the live import scope.

AI-dependent acceptance remains intentionally incomplete. Resume it only after the user requests continuation with available usage; retain these revisions and references as the comparison baseline.

### Non-AI verification completed on 20 October 2026

The [Dynamic risk follow-up](PUBLIC_REPO_DYNAMIC_RISK_2026-10-20.md) records the complete regression reruns and remaining Windows-specific gaps. The TLS fixtures now work on Windows without weakening origin/download checks. Their focused browser/capture suites passed 29/29, the final complete backend run reported 753 passed and 18 failed, and sidecar type checks passed. No model generation or semantic readiness/Review result was produced. The local assessment hold remains enabled. Full risk closure and AI outcome acceptance are not claimed.

Restarted the owned sidecar with the final code and restored the background frontend. Health returned `ok`. The signed-in browser reloaded both saved public projects; Serve Static Overview still showed its explicit AI pause and no semantic verdicts. Live screenshot: `evidence/public-repositories-2026-10-19/serve-static-ai-held.jpg`.


## AI resumption on 20 October 2026

The user explicitly requested continuation of AI assessment after the historical hold above. The hold was disabled and the sidecar restarted. Both public projects completed live readiness. CORS completed its production Review, with one model issue independently reproduced; Serve Static also completed after correcting a false evidence-conflict blocker. Both Reviews await human approval. The full readiness corpus passed two cases, then stopped on a provider rate limit; one case is blocked and eight were not attempted. See [the AI execution and acceptance report](PUBLIC_REPO_AI_ASSESSMENT_2026-10-20.md) for current results; earlier Held rows describe the prior run, not current runtime state. No approval decisions or upstream publications were made.
