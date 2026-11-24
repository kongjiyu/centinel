# Auto test: autonomous Dynamic testing (12 November 2026)

The user gives Centinel an app folder. Centinel reads the repository, starts the app, explores it, writes browser tests from the requirements and code, and runs them while the user watches live browsers with moving cursors. It ends with results: what failed, expected vs actual, where in the code, and what was not covered.

## User decisions

These were made by the user on 12 November 2026:

- **Starting the app is fully automatic**, with no approval click. This amends the earlier rule that no suggested command runs automatically, but only for this flow and only within the recipe table below.
- **Generated tests run immediately**, without a review step.
- **The live view should look like computer use.** Several browsers run at once, each with a visible moving cursor.
- **One active Run per environment** instead of one per project. This is migration `202611120001`, applied to hosted. Runs without an environment still share one slot per project.

## Flow

The Auto test panel on Dynamic testing has an App folder field (it defaults to the project's workspace path) and **Start Auto test**. The stages are:

1. **Read the code.** `autonomous/repoDigest.ts` builds a bounded digest of about 60,000 characters.
   - Contents: README and docs (including requirements), manifests, routes (`routeDetector.ts`), HTML forms, and seed/fixture files.
   - `.env` values and secret-like files are never included.
2. **Start the app.** `autonomous/recipes.ts` and `launcher.ts` pick a start command from a fixed recipe table:
   - Node `dev`/`start`/`serve`/`preview` scripts, using the package manager the lockfile indicates.
   - Plain `node server.js`.
   - Django, Flask or FastAPI.
   - A built-in static server.

   Node dependencies are installed when missing; only that install step may use the network. `workspace/managedServer.ts` runs the app on a free port. It uses the same isolation as `runBoundedProcess`, and a guardian kills the whole process group when the session ends or the sidecar disconnects. Monorepos, Docker-only apps and folders with no entry point get a plain explanation instead.
3. **Explore pages.** `discoverControls` scans up to 19 pages and 60 controls. Only Auto test raises these limits.
4. **Write tests.** `autonomous/planner.ts` makes one structured model call and gets back up to 10 tests. Every test is validated: start page on the app, controls seen in the scan or declared in source forms, no secret-like values, at least one independent check, and `validateMission` passes. Anything else is dropped and listed with a reason.
5. **Run tests.** `autonomous/orchestrator.ts` runs up to 3 lanes at once (configurable from 1 to 4).
   - **Isolation:** each lane has its own app instance, its own "Auto test – folder · lane N" environment, and its own headless browser. The lane's app restarts before every test, and data preparation and cleanup are recorded honestly.
   - **Fallback to one lane:** when the digest shows external persistence, or the app ignores the assigned port.
   - **Ordinary Runs:** Runs go through the ordinary Run route, so history, evidence, reports and verdict rules are unchanged.
   - **Codex:** each lane uses its own Codex process (`getCodexBackend(owner, slot)`), so lanes do not wait on each other and one lane's cancel never closes another's.
6. **Results.** Counts come only from Run verdicts. Each failed test shows expected vs actual, an optional AI explanation (labelled as AI), source lines and **Open run evidence**. The results also list what was not covered.

Cancel stops the Runs and every app Centinel started.

## Live view

- **Frames:** `page.screencast` (Playwright 1.60) streams JPEG frames at about 8 fps into an in-memory hub. Frames are never written to disk and are served only through the authenticated, member-checked SSE route `GET /projects/:p/dynamic/autonomous/:id/live`.
- **Cursor:** the cursor, click ripple, target highlight and typing caret are drawn by Centinel over the frame, from action events that carry the target's bounding box. Nothing is injected into the website under test.
- **Typed text:** typing events carry only a length, plus a masked flag for private fields, never the text itself.
- **Retained evidence:** evidence still goes through `captureProtectedPage`.

## Routes and storage

- `POST/GET /projects/:p/dynamic/autonomous`
- `GET …/:id`
- `POST …/:id/cancel`
- `GET …/:id/live`

Sessions are journalled in the existing `audit_events` table (`dynamic_autonomous_session`). A session left running by a sidecar that has restarted is marked interrupted.

## Verification

- **Unit tests:** launcher (18), digest and route detector (15), orchestrator, planner and routes (13), live hub and runner (from #86), and frontend panel and helpers (7).
- **Real signed-in app on local Supabase:** Sample Shop ran 3 tests in 3 lanes in about 1.5 minutes.
  - The planted REQ-1 bug failed, and the AI explanation pointed at the missing-user branch in `server.js`.
  - Sign-in and wrong-password tests passed.
  - Cancel left no app or browser processes.

## Limits

- **Not exhaustive.** Only the listed journeys are tested; the model chose 3–4 tests per run on Sample Shop, mostly about sign-in.
- **Run speed** depends on the configured vision model. Slower models make each step take longer.
- **Accumulating saved tests.** Each session saves its generated tests as ordinary saved tests, so the saved-test list grows.
- **Not yet verified:**
  - RWA (Vite plus Express with a seeded database).
  - Python recipes against real apps.
  - The narrow-viewport layout in the signed-in app.


## Project conversation (13 November 2026)

The user asked for browser tests to be added and changed by talking to Centinel instead of editing forms (DESIGN.md §4.4–4.5). This reuses the Auto test pipeline:

- `POST /projects/:p/dynamic/autonomous` accepts `request` (up to 2,000 characters), `base` (a saved test to revise), `rerun` (saved tests to run without new planning) and `pinned` (saved tests added to a full check). Conversation sessions default to one lane. Earlier requests in the project (up to ten) are passed to the planner so test data given before is reused.
- The plan schema has a `reply` field. A request the browser cannot test finishes with a reply and no tests. A request is limited to three tests, or one when revising a test.
- Each planned test keeps its allowed `controls`, so it can be run again later. `presetToTest` rebuilds and revalidates a saved test against the app's current address.
- Controls may be marked `repeatable` only when they are clickable and a step uses them more than once; the existing one-use default stays for everything else.
- Control discovery and the agent's page observation gained the same positional selector fallback (`#list > li:nth-of-type(2) > button`) for repeated unnamed controls. Discovery labels such controls with their row text.
- Test accounts typed in the conversation may be used as test data on the local app (user decision, 13 November 2026). The frontend adds a one-time reminder that the AI sees them.

Verified live on 13 November 2026 against the Sample Shop: "Test that adding the Ceramic Mug twice makes the cart total $24.00" started the app, wrote one test, clicked Add to cart twice in the live view and failed on the independent check, with an AI explanation. Not verified live: revising a test with Change it, and a full check that includes saved tests.

## Browser tests in the project report (14 November 2026)

Report generator `project-report-v5` adds an optional `browserTests` section to the snapshot JSON (older saved reports stay valid). It holds the latest finished full Auto test only; conversation requests and reruns are excluded. Each test keeps its name, steps, requirement, related code, Run ID and, per check, the expected value, verdict and what the page showed (the runner's "Expected visible text absent." note becomes "Not shown on the page."). AI explanations are not included. Part 1 of the report summarises this full check whenever it exists ("1 of 3 failed"); a single test run later still appears in Part 2 under the existing Dynamic Test section. Verified by generating a report for the Sample Shop project against local Supabase.

## Fixed tests in a full check (18 November 2026)

At the user's request, a full check (no typed request, new tests planned) adds three fixed tests to the ones the AI writes. They live in `sidecar/src/dynamic/autonomous/suite.ts`, and the session records them in `suite`.

| Test | How it runs | What can fail it |
|---|---|---|
| **Smoke** – "Pages open without errors" | Read from the page scan Centinel already does (`discoverControls` with `collectHealth`). It adds no AI call and no extra browser. | A 5xx page status, a script error on the page, or a same-origin request answering 5xx. A 404 alone does not fail it. |
| **Exploratory** – "Explore the app" | One Run in the existing exploratory mode, up to 25 steps, first in the queue. It may press only click controls the scan saw. Controls that sign out, delete, pay, place orders, send, save or submit are left out. | Only its own check, that a page is still shown after exploring. Screens visited are never a pass. The result reports screens reached, controls pressed and controls seen but not tried. |
| **Usability** – "Usability of the first page" | One Run on `/` that does not click. It applies the existing rule-based checks: labels, keyboard reach and focus, as a first-time persona. | Deterministic `labels` or `keyboard` failures. Focus results stay uncertain. There are no AI suggestions. |

Rules:
- If the first page answers 5xx, planning and the other browser tests are skipped, and the session says why.
- The smoke result is saved as soon as the scan finishes, so it survives a later planning failure.
- Fixed tests carry `kind`.
  - They are not saved presets, and they get no AI failure explanation.
  - Their failures become Browser problems, using Expected and Observed lines built from the smoke pages or the usability rules.
- Typed requests in the project conversation do not run fixed tests.
- Older sessions without `suite` are unchanged. No migration was needed.

**Unit tests (user decision, later on 18 November 2026).** A full check also runs the project's own unit tests (`sidecar/src/dynamic/autonomous/unitTests.ts`).
- **Which script.** A `package.json` script that is exactly `vitest`, `vitest run` or `vitest --run`. Names containing unit, ci or run are preferred.
- **How it runs.** Through the existing `runVitestWorkspace`, which uses the installed Vitest CLI and a JSON reporter. It runs beside the browser lanes, after the app start has installed dependencies. The time limit is five minutes. No shell text, extra flags or repository `.env` values are used.
- **Authorisation.** It uses the check's own inspection of the folder (fingerprint, script). Nothing is written to the manual workspace registry.
- **Results.**
  - Pass and fail come only from Vitest's report.
  - Jest, Mocha or a wrapped Vitest command is reported as "not run" with the reason.
  - The Result shows a Unit tests block, apart from Code and Browser problems.
  - The real run on Cypress RWA (`test:unit:ci`) took 10 seconds: 54 tests, 44 passed, 10 skipped, 0 failed.

Not included yet:
- **Browser verification of code-review problems.** This needs the finished Review.

Verification:
- **Unit tests:** `autonomousOrchestrator.test.ts`, `controlDiscovery.test.ts` (page health with a real headless browser) and the frontend `check/result.test.ts`.
- **Real-browser scan of Sample Shop:** 3 pages returned 200 or 404 and none failed. The exploration controls excluded "Place order".
- **Live run on Sample Shop:** it stopped at planning because the selected Codex model was unavailable. No end-to-end run with the model was completed.

