# Centinel FYP Project Plan

> **For agentic workers:** This is the high-level FYP roadmap, not a sprint task list. Before implementation, derive a bounded plan and confirm each roadmap item against the current code and requirements.

**Goal:** Build Centinel as a complete FYP-grade desktop software quality assurance platform with static artifact review, dynamic web application testing, structured evidence, and report generation.

**Architecture:** Centinel will be a local-first desktop app. The desktop shell manages projects, files, sessions, reports, and user workflows. Static testing uses MiMo for text-based artifact analysis. Dynamic testing uses Playwright as the browser automation engine and Gemini as the multimodal reasoning layer for screenshot-based understanding when DOM/accessibility information is insufficient.

**Tech Stack:** Tauri, React, TypeScript, SQLite, Playwright, MiMo, Gemini, Markdown/HTML/PDF reporting.

---

## 1. Project Positioning

Centinel should be built as a complete academic product, not a throwaway prototype. The system should have a controlled scope, working end-to-end flows, clear evaluation evidence, and defensible technical choices.

The core product is:

- A desktop app used by developers, QA engineers, testers, and small software teams.
- A static testing assistant for reviewing software artifacts without executing the app.
- A dynamic testing assistant for executing web application user journeys.
- A shared reporting platform that stores findings, evidence, and generated QA artifacts.

The product should not attempt to replace enterprise QA platforms. The FYP target is a practical, local-first AI-assisted QA tool that demonstrates how static and dynamic testing can be supported in one workflow.

---

## 2. Scope Boundaries

### 2.1 Core FYP Scope

The following must be completed for the final product:

- Desktop application with local project workspace support.
- Static testing module for artifact review.
- Dynamic testing module for web applications.
- AI-generated findings and reports.
- Session/evidence storage.
- Human review of AI-generated results.
- Evaluation using sample projects and test applications.

### 2.2 Controlled Dynamic Testing Scope

Centinel Dynamic will focus on **web applications only** for the core FYP deliverable.

Supported dynamic testing targets:

- Localhost web apps.
- Public staging/demo web apps.
- Login flow, form submission flow, CRUD flow, checkout-like flow, or multi-step workflow.

Not required for core scope:

- Native desktop app testing.
- Mobile app testing.
- Load testing.
- Penetration testing.
- Full CI/CD integration.
- Full browser farm execution.

### 2.3 Optional/Future Scope

The following can be documented or built only if the core product is stable:

- Native desktop app testing through OS-level automation.
- CI/CD pipeline integration.
- Team collaboration and cloud sync.
- Advanced regression suite management.
- Advanced visual heatmaps.
- Plugin system for multiple language/framework analyzers.

---

## 3. Recommended Team Split

The project has two members, so ownership should be clear.

### Member A: Centinel Static Owner

Responsibilities:

- Artifact upload and parsing.
- Requirement/design/code review workflows.
- MiMo prompt design for text review.
- Static finding schema.
- Static report generation.
- Traceability between artifact sections and findings.
- Static module evaluation.

### Member B: Centinel Dynamic Owner

Responsibilities:

- Playwright automation engine.
- Gemini screenshot interpretation.
- Web testing session execution.
- Action planning and execution loop.
- Runtime evidence collection.
- Dynamic bug report generation.
- Dynamic module evaluation.

### Shared Responsibilities

Both members should jointly own:

- Desktop app shell.
- Project/session data model.
- Shared report format.
- UI consistency.
- Final demo scenario.
- FYP evaluation methodology.
- Final documentation and presentation.

---

## 4. Product Architecture

### 4.1 Desktop App Layer

Recommended stack:

- Tauri for the desktop shell.
- React + TypeScript for the user interface.
- SQLite for local metadata.
- Local filesystem folders for artifacts, screenshots, logs, and exported reports.

Why desktop:

- Static testing needs direct access to local requirements, source code, and design files.
- Dynamic testing needs local evidence storage.
- A local-first workflow is easier to justify for privacy and SME use cases.
- It avoids requiring a deployed backend for FYP evaluation.

### 4.2 AI Layer

Text generation and static review:

- Use MiMo for requirement review, code review summaries, inconsistency detection, and report generation.

Multimodal reasoning:

- Use Gemini for screenshot analysis and visual UI interpretation in dynamic testing.

Important design rule:

- AI outputs should be structured JSON first, then rendered into user-friendly reports.
- The system should preserve raw AI responses for debugging and auditability.
- Every AI-generated finding should be reviewable by a human.

### 4.3 Dynamic Testing Layer

Playwright should be used as the browser execution engine.

Playwright can:

- Open target URLs.
- Capture screenshots.
- Read DOM/accessibility snapshots.
- Locate elements.
- Click, type, scroll, navigate, and wait.
- Capture console logs and network-related evidence.

Playwright cannot independently understand visual UI semantics like a multimodal LLM. Therefore, Centinel Dynamic should use a hybrid loop:

1. Capture browser state using Playwright.
2. Extract DOM/accessibility snapshot and screenshot.
3. Ask Gemini to interpret the current screen against the testing goal.
4. Convert Gemini's decision into a Playwright action.
5. Execute action.
6. Record evidence.
7. Repeat until success, failure, or step limit.

The preferred strategy is:

- First use DOM/accessibility information when reliable.
- Use Gemini screenshot reasoning when the DOM is ambiguous.
- Use coordinate-based actions only as a fallback.

---

## 5. Data Model

The exact schema can evolve during implementation, but the product should include these core entities.

### Project

Represents a software project being reviewed or tested.

Fields:

- `id`
- `name`
- `description`
- `workspacePath`
- `createdAt`
- `updatedAt`

### Artifact

Represents uploaded or linked files used for static review.

Fields:

- `id`
- `projectId`
- `type`
- `fileName`
- `filePath`
- `contentHash`
- `createdAt`

Artifact types:

- requirement
- design
- source_code
- coding_standard
- other

### Static Review Session

Represents one static testing run.

Fields:

- `id`
- `projectId`
- `name`
- `reviewType`
- `status`
- `createdAt`
- `completedAt`

Review types:

- requirement_review
- design_review
- code_review
- cross_artifact_consistency
- requirement_to_code_traceability

### Dynamic Test Session

Represents one dynamic browser testing run.

Fields:

- `id`
- `projectId`
- `targetUrl`
- `missionType`
- `goal`
- `status`
- `startedAt`
- `completedAt`

Mission types:

- smoke
- regression
- exploratory
- user_journey

### Finding

Represents a static or dynamic issue.

Fields:

- `id`
- `projectId`
- `sessionId`
- `source`
- `severity`
- `title`
- `description`
- `evidenceRef`
- `recommendation`
- `status`
- `createdAt`

Sources:

- static
- dynamic

Severity:

- critical
- high
- medium
- low
- info

Status:

- new
- accepted
- dismissed
- fixed

### Evidence

Represents supporting material for findings or sessions.

Fields:

- `id`
- `projectId`
- `sessionId`
- `type`
- `filePath`
- `summary`
- `createdAt`

Evidence types:

- screenshot
- console_log
- action_trace
- ai_response
- report
- uploaded_artifact

---

## 6. MVP Definition

The MVP should prove the full Centinel workflow with minimal but real functionality.

### MVP User Flow

1. User opens Centinel desktop app.
2. User creates a project.
3. User uploads requirement/source/design artifacts.
4. User runs a static review.
5. User enters a web app URL and dynamic testing goal.
6. Centinel runs a browser session.
7. Centinel collects evidence.
8. User reviews findings.
9. User exports a report.

### MVP Static Features

Required:

- Upload requirement document.
- Upload source code file or folder.
- Run MiMo review.
- Generate structured findings.
- Display findings in the app.
- Export static review report.

MVP review categories:

- unclear requirement
- missing requirement detail
- possible inconsistency
- possible code issue
- missing requirement-to-code coverage

### MVP Dynamic Features

Required:

- Accept target URL.
- Accept natural-language testing goal.
- Launch Playwright browser session.
- Capture screenshot and page snapshot.
- Ask Gemini for next action.
- Execute click/type/navigation actions.
- Stop on success, failure, or step limit.
- Save screenshots and action trace.
- Generate dynamic test summary.

MVP mission examples:

- "Check whether the login page rejects invalid credentials."
- "Submit the contact form and verify that a success message appears."
- "Create a new item and verify it appears in the list."

### MVP Shared Features

Required:

- Project dashboard.
- Session history.
- Finding list.
- Finding detail view.
- Report export.
- Local storage of artifacts and evidence.

---

## 7. Full FYP Product Definition

The complete FYP product should extend the MVP into a polished, evaluated tool.

### Static Module Complete Features

The final static module should support:

- Multiple artifact uploads per project.
- Requirement quality review.
- Design document review.
- Source code review.
- Cross-artifact consistency checking.
- Requirement-to-code traceability suggestions.
- Static review summary.
- Defect report generation.
- Human accept/dismiss workflow for findings.

### Dynamic Module Complete Features

The final dynamic module should support:

- Smoke testing mission.
- User journey mission.
- Exploratory testing mission with bounded step count.
- Regression replay using a previously saved goal or session outline.
- Screenshot evidence.
- Action trace evidence.
- Console log capture.
- Structured bug report generation.
- Clear failure reason when the agent gets stuck.

### Shared Platform Complete Features

The final shared platform should support:

- Project workspace.
- Static and dynamic session history.
- Unified findings list.
- Evidence browser.
- Exportable project quality report.
- AI response audit log.
- Basic settings for MiMo and Gemini API keys.

---

## 8. Development Phases

### Phase 0: Project Setup and Technical Spike

Goal:

- Validate the technical stack before building product features.

Deliverables:

- Tauri + React desktop app starts successfully.
- SQLite can store and read a project record.
- MiMo API test call works.
- Gemini API test call with screenshot input works.
- Playwright can open a URL and capture screenshot.

Acceptance criteria:

- The team can run the desktop app locally.
- A sample project record persists after app restart.
- A browser screenshot is saved to local evidence storage.
- A simple MiMo response and Gemini response are displayed in a debug screen or terminal output.

Recommended owner:

- Both members.

Estimated effort:

- 1 week.

### Phase 1: Desktop App Foundation

Goal:

- Build the shared Centinel shell and local data foundation.

Deliverables:

- App navigation.
- Project creation.
- Project dashboard.
- Local workspace folder creation.
- SQLite schema.
- Settings page for API keys.

Acceptance criteria:

- User can create, open, and delete a project.
- Project metadata persists.
- Each project has a local evidence/artifact folder.
- API keys can be saved locally or entered per session.

Recommended owner:

- Shared.

Estimated effort:

- 1 to 2 weeks.

### Phase 2: Static MVP

Goal:

- Complete the first end-to-end static testing workflow.

Deliverables:

- Artifact upload.
- Artifact type selection.
- MiMo review prompt.
- Static finding extraction.
- Static findings UI.
- Static review report export.

Acceptance criteria:

- User uploads a requirement document and source code.
- User runs static review.
- System returns structured findings.
- User can accept or dismiss findings.
- User can export a static review report.

Recommended owner:

- Static owner.

Estimated effort:

- 2 weeks.

### Phase 3: Dynamic MVP

Goal:

- Complete the first end-to-end dynamic web testing workflow.

Deliverables:

- Target URL input.
- Natural-language test goal input.
- Playwright browser session runner.
- Screenshot and DOM/accessibility snapshot capture.
- Gemini action decision prompt.
- Action executor.
- Evidence capture.
- Dynamic summary report.

Acceptance criteria:

- User enters a URL and test goal.
- System opens the web app.
- System performs at least one meaningful click/type/navigation sequence.
- System records screenshots and actions.
- System reports success, failure, or blocked state.
- User can export the dynamic session summary.

Recommended owner:

- Dynamic owner.

Estimated effort:

- 2 to 3 weeks.

### Phase 4: Unified Reporting and Evidence

Goal:

- Merge static and dynamic outputs into a coherent Centinel QA report.

Deliverables:

- Unified finding schema.
- Evidence browser.
- Project-level report.
- Session-level report.
- Export to Markdown and HTML.
- Optional export to PDF if time permits.

Acceptance criteria:

- User can view all findings from static and dynamic sessions together.
- Each finding links to evidence.
- Report includes project details, sessions, findings, severity, evidence, and recommendations.
- Exported report is readable without the app.

Recommended owner:

- Shared.

Estimated effort:

- 1 to 2 weeks.

### Phase 5: Product Hardening

Goal:

- Make the product stable enough for FYP demonstration and evaluation.

Deliverables:

- Error handling for failed AI calls.
- Error handling for failed browser sessions.
- Loading/progress states.
- Session cancellation.
- Basic input validation.
- Empty states.
- Consistent UI styling.
- Demo data set.

Acceptance criteria:

- App does not crash when API keys are missing.
- App does not crash when a target URL fails to load.
- Dynamic session stops safely after a step limit.
- User can understand why a session failed.
- Demo flow can be repeated reliably.

Recommended owner:

- Shared, with each member hardening their own module.

Estimated effort:

- 1 to 2 weeks.

### Phase 6: Evaluation and FYP Documentation

Goal:

- Produce academic evidence that Centinel works and is useful.

Deliverables:

- Evaluation plan.
- Sample projects/artifacts.
- Sample web app for dynamic testing.
- Test scenarios.
- Result tables.
- Screenshots.
- Final report content.
- Demo script.

Acceptance criteria:

- Static module is evaluated on sample requirement/code artifacts.
- Dynamic module is evaluated on repeatable web test flows.
- Report includes limitations and future work.
- Demo can show a complete static and dynamic workflow.

Recommended owner:

- Shared.

Estimated effort:

- 2 weeks.

---

## 9. Suggested Timeline

This timeline assumes approximately 10 to 12 focused development weeks.

| Week | Focus | Main Output |
| --- | --- | --- |
| 1 | Phase 0 | Stack validation |
| 2 | Phase 1 | Desktop app foundation |
| 3 | Phase 1 | Project/session storage |
| 4 | Phase 2 | Static MVP |
| 5 | Phase 2 | Static report and findings |
| 6 | Phase 3 | Dynamic runner foundation |
| 7 | Phase 3 | Gemini + Playwright loop |
| 8 | Phase 4 | Unified reporting |
| 9 | Phase 5 | Hardening and UI polish |
| 10 | Phase 6 | Evaluation setup |
| 11 | Phase 6 | Results and final documentation |
| 12 | Buffer | Demo rehearsal and fixes |

If the actual FYP timeline is shorter, reduce scope in this order:

1. Remove PDF export and keep Markdown/HTML export.
2. Remove regression replay and keep smoke/user journey testing.
3. Remove design document review and keep requirement/code review.
4. Remove advanced evidence browser and keep session folder links.

---

## 10. Static Module Plan

### 10.1 Static Input Handling

Support these artifact formats first:

- `.txt`
- `.md`
- `.pdf` if extraction is reliable
- source files such as `.js`, `.ts`, `.py`, `.java`, `.cs`

For FYP reliability, plain text and markdown should be the primary evaluation formats. PDF support can be included if extraction works consistently.

### 10.2 Static Review Workflows

Workflow 1: Requirement quality review

- Input: requirement document.
- Output: unclear, incomplete, ambiguous, or unverifiable requirements.

Workflow 2: Code inspection support

- Input: source code files.
- Output: possible defects, maintainability issues, missing validation, risky logic.

Workflow 3: Requirement-to-code traceability

- Input: requirement document and source code.
- Output: possible requirement coverage mapping and missing implementation indicators.

Workflow 4: Cross-artifact consistency

- Input: requirement and design/source artifact.
- Output: mismatched terminology, missing entities, conflicting behavior.

### 10.3 Static AI Output Format

MiMo should return structured JSON with:

- `title`
- `severity`
- `category`
- `artifactReference`
- `description`
- `evidence`
- `recommendation`
- `confidence`

This enables consistent rendering and report generation.

---

## 11. Dynamic Module Plan

### 11.1 Dynamic Testing Loop

Each dynamic session should follow this loop:

1. Open target URL.
2. Capture screenshot.
3. Capture DOM/accessibility snapshot where possible.
4. Build current state summary.
5. Ask Gemini for next action.
6. Validate action format.
7. Execute action with Playwright.
8. Capture evidence.
9. Check success/failure condition.
10. Continue until complete, blocked, failed, or step limit reached.

### 11.2 Supported Action Types

For FYP scope, support:

- `click`
- `type`
- `press_key`
- `scroll`
- `wait`
- `navigate`
- `assert_visible`
- `finish_success`
- `finish_failure`

Avoid complex actions in the core implementation:

- drag and drop
- file upload
- multi-tab workflows
- CAPTCHA handling
- payment gateway testing

### 11.3 Dynamic Safety Limits

Each session should have limits:

- Maximum step count, such as 15 or 25.
- Maximum runtime, such as 3 to 5 minutes.
- Allowed domain restriction.
- No destructive actions unless explicitly allowed by the user.

For demo and evaluation, use test applications where destructive actions are harmless.

### 11.4 Dynamic Evidence

Each dynamic session should save:

- Initial screenshot.
- Screenshot after each action.
- Action trace.
- Final screenshot.
- Console logs if available.
- AI decisions.
- Final summary.

Evidence should be stored in the project workspace folder and referenced from SQLite.

---

## 12. UI Plan

### Main Screens

Centinel should include:

- Project list.
- Project dashboard.
- Artifacts page.
- Static review page.
- Dynamic test page.
- Findings page.
- Evidence page.
- Reports page.
- Settings page.

### UI Principles

The UI should feel like a practical QA tool:

- Clear navigation.
- Dense but readable information.
- Strong status indicators.
- No decorative landing page.
- No unnecessary marketing-style content.
- Findings and evidence should be easy to scan.

### Important States

Each major workflow should handle:

- Empty state.
- Loading state.
- Success state.
- Failed state.
- Partial result state.

---

## 13. Testing Strategy

### Unit Testing

Test:

- AI response parsing.
- Finding schema validation.
- Report generation.
- File path and workspace handling.
- Dynamic action validation.

### Integration Testing

Test:

- Project creation and persistence.
- Artifact upload and review session creation.
- Static review to findings flow.
- Dynamic session to evidence flow.
- Report export.

### End-to-End Testing

Test with:

- Sample requirement document.
- Sample source code.
- Sample web application.
- At least three dynamic missions.

Recommended dynamic test missions:

- Invalid login rejection.
- Successful form submission.
- CRUD item creation and verification.

---

## 14. Evaluation Plan

### 14.1 Static Evaluation

Evaluate using prepared artifacts with known issues.

Measure:

- Number of known issues detected.
- Number of useful findings.
- Number of false positives.
- Quality of generated recommendations.
- Time required compared with manual review.

Suggested evaluation table:

| Artifact | Known Issues | Detected Useful Findings | False Positives | Notes |
| --- | ---: | ---: | ---: | --- |
| Requirement Sample A | 0 | 0 | 0 | Fill during evaluation |
| Code Sample A | 0 | 0 | 0 | Fill during evaluation |
| Requirement + Code Pair A | 0 | 0 | 0 | Fill during evaluation |

### 14.2 Dynamic Evaluation

Evaluate using a controlled sample web app.

Measure:

- Mission completion rate.
- Number of steps taken.
- Whether evidence was sufficient to reproduce the issue.
- Whether generated bug report was understandable.
- Failure reasons when the agent gets stuck.

Suggested evaluation table:

| Mission | Expected Result | Actual Result | Completed | Evidence Quality | Notes |
| --- | --- | --- | --- | --- | --- |
| Invalid login | Error message displayed | Fill during evaluation | Yes/No | Good/Fair/Poor | Fill during evaluation |
| Form submission | Success message displayed | Fill during evaluation | Yes/No | Good/Fair/Poor | Fill during evaluation |
| Create item | Item appears in list | Fill during evaluation | Yes/No | Good/Fair/Poor | Fill during evaluation |

### 14.3 User Evaluation

If possible, ask classmates, developers, or testers to try the system.

Collect:

- Ease of use rating.
- Usefulness rating.
- Trust in findings.
- Clarity of reports.
- Suggested improvements.

---

## 15. Risk Management

### Risk: Dynamic AI agent is unreliable

Mitigation:

- Use bounded missions.
- Use DOM/accessibility snapshots before screenshot reasoning.
- Add step limits.
- Use controlled demo apps.
- Record blocked states clearly.

### Risk: MiMo output is inconsistent

Mitigation:

- Require structured JSON.
- Validate AI output.
- Retry or ask model to repair invalid JSON.
- Store raw response for audit.

### Risk: Tauri integration with Playwright is awkward

Mitigation:

- Keep Playwright in a Node.js sidecar service if needed.
- Let Tauri UI communicate with the sidecar locally.
- Validate this during Phase 0.

### Risk: Scope becomes too large

Mitigation:

- Keep web testing as core scope.
- Keep desktop app testing optional.
- Prioritize static review, dynamic web session, and reporting.
- Defer advanced heatmaps, CI/CD, and collaboration features.

### Risk: API costs or limits

Mitigation:

- Cache AI responses during development.
- Use small sample artifacts.
- Limit dynamic session step count.
- Provide manual retry instead of automatic unlimited retry.

---

## 16. Optional Desktop App Testing Extension

Desktop app testing should be treated as optional future work.

Why it is optional:

- Playwright is designed for browser automation, not native desktop automation.
- Native desktop testing requires OS-specific APIs.
- macOS, Windows, and Linux have different automation models.
- Permissions and reliability are harder to manage.

Possible future architecture:

- Use OS accessibility APIs for element discovery.
- Use screenshot-based Gemini reasoning for visual understanding.
- Use coordinate-level mouse/keyboard control for execution.
- Record screen evidence and action traces.

Recommended FYP positioning:

- Mention desktop app testing as future enhancement.
- Do not include it in core evaluation.
- Do not let it delay the web dynamic testing module.

---

## 17. Final Deliverables

By submission, the team should have:

- Working Centinel desktop app.
- Static testing module.
- Dynamic web testing module.
- Unified findings and evidence system.
- Exportable QA reports.
- Demo project/artifacts.
- Demo web application or selected test target.
- Evaluation results.
- Final FYP report.
- Presentation/demo script.

---

## 18. Minimum Demo Script

The final demo should show:

1. Open Centinel.
2. Create or open a project.
3. Upload requirement and source artifacts.
4. Run static review.
5. Review static findings.
6. Run dynamic web test on a sample app.
7. Show screenshots and action trace.
8. Show dynamic bug/session summary.
9. Open unified findings page.
10. Export final QA report.

This demo proves the complete product story without depending on unfinished optional features.

---

## 19. Success Criteria

Centinel can be considered FYP-grade complete when:

- Both static and dynamic modules work end-to-end.
- A user can complete the main workflow without developer intervention.
- AI-generated outputs are structured and reviewable.
- Evidence is stored and linked to findings.
- Reports are exportable.
- The team has evaluation results, not only screenshots.
- The final scope is clearly separated from future work.

