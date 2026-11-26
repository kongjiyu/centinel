# ORIN conversation detail follow-up

| Workstream | Deliverable | Acceptance criteria |
| --- | --- | --- |
| Evidence and completion | Preserve saved explanations and identify incomplete coverage. Make the original Problem component the chat card. Show Check details directly with the saved name and mode. | A stopped or partial run shows the saved explanation as a possible cause and identifies what remains unchecked. Existing evidence stays available. Both card types use an accessible top-right arrow to open the original. The Problem card uses its inline timeline for snapshots. |
| Agent replies | Put the reply time and existing actions in one compact row outside the bottom-left of the message. | Discoveries read as normal replies. Actual response and execution errors still show their warning icon. Hover and keyboard focus reveal the time and actions in one row. |
| Attachments | Add a full outline around the quoted reply and reveal the complete attachment label or quote on hover and focus. | Draft and sent Check, Problem, document and source tiles reveal their complete name. Quotes preserve the compact preview and show the full available reply on demand. |

The three tracks can run concurrently. Evidence owns card and projection files, message presentation owns reply rendering, and attachment presentation owns the tile, quoted reply, and composer wiring. Keep work on shared conversation files to the assigned regions.

Run focused frontend and sidecar suites, build the frontend, and check the responsive card and action layout at 1440×900, 1200×900, and a narrow viewport. Verify a saved stopped-run explanation, a complete result, an actual error, and long attachment names or quotes.

The integrated Edge fixture verified both record arrows, a stopped-run explanation and coverage notice, a saved Check's expanded measurements, the bottom-left reply footer, and attachment previews at 1440×900, 1200×900, and 390×840. The navigation regression verifies a saved Check can open without a device-local Check index entry. These checks used test records. No fresh Sample Shop run was needed to exercise presentation of saved evidence.

The frontend build, 112 focused frontend tests, 158 focused sidecar tests, and the sidecar TypeScript check passed.
