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
