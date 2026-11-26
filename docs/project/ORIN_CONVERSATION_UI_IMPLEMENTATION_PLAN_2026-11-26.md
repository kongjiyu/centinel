# ORIN project conversation UI implementation plan

Agreed interaction decisions, 26 November 2026. This document records the plan for future implementation. The [saved evidence harness plan](./ORIN_SAVED_EVIDENCE_HARNESS_PLAN_2026-11-26.md) covers data retrieval and evidence semantics. Durable memory and context compaction are deferred.

## 1. Chat history and navigation

- Open the project conversation at the latest message. Initially display the newest 10 user turns, including each turn’s response, result card, and question history. A result card within a turn uses no additional slot.
- Reuse the project and account-scoped history cursor. Fetch older turns when the user scrolls near the top. Show conversation-shaped skeletons above the loaded turns while fetching. Preserve the visible reading anchor when earlier turns are prepended. Prevent duplicate page requests and duplicate turns. If a page cannot load, retain the loaded history and offer a retry at the top.
- Show a floating **Jump to latest** button above the composer when the user is away from the bottom. Its arrow becomes animated dots with a bouncing dot while ORIN is working on a new response. Keep the button clickable in both states, with the same accessible name. Use static dots when reduced motion is enabled.
- Sending a message jumps to the bottom. Incoming replies and live progress follow the conversation only while the reader is at the bottom. Returning with **Jump to latest** restores that behavior.

## 2. Live progress and result order

- Put **Working for Xs ›** above the result card, or above the response when there is no card. Use real conversation, Review, and Browser events for activity text. While a model request is pending without a more specific event, show **Waiting for the model**. Keep the saved result card ahead of the explanation.
- For a single mode, show its current activity in the main progress panel. For Code + Browser, open the main panel during execution and initially collapse the **Code** and **Browser** sections inside it. Each section header shows the lane state. Put that lane’s working message and activity history inside its section, and preserve the reader’s expansion choices as updates arrive.
- When work finishes, show a collapsed **Worked for Xs ›** disclosure with the recorded activity. Keep explicit paused, failed, and incomplete states visible when applicable.

## 3. Message actions and attachments

- Put **Copy** and **Quote** at the bottom left of the ORIN response. **Copy** copies the reply in Markdown, preserving its structure. **Quote** adds a removable preview of the selected reply above the composer and focuses the input without sending it.
- Put **Copy** beside the sent time on user messages. Copy the original message text. Reveal message actions on hover and keyboard focus, and provide a tap interaction on touch devices. Give icon actions accessible names and visible focus states.
- Display attachments, including an explicit quote, above the text of the sent user message. Keep Code, Browser, and Both in the mode control and result card. Remove **AI Analysis**, **Response saved**, and the automatic **Reply to** label.

## 4. Saved cards and project entry

- When explaining a saved Problem, render the original Problem component first and place the answer below it. Preserve the selected historical occurrence’s risk, category, source highlights, issue overview, and recommendation. Show its separately sourced **Current status** even if resolved. If an excerpt is unavailable, show that state in the original component.
- Reuse the original Check result presentation for saved Check explanations. Show **Found in code** for Code, **Proven in the browser** for Browser, and both for a combined Check. Preserve the original requirements, coverage, and problem treatments. Display the saved objective and scope when available. Omit a missing objective from the card. When an explanation requests it, report **Objective unavailable**. Keep findings, Browser proof, and assertion totals distinct. Place the answer below the card.
- Render **Module** as a readable column for logical product areas such as Products or Inventory. Give it enough width for natural wrapping. Show source paths separately under **Affected files** or **Source**, with wrapping and access to the full path. Use an affected-files list or table when only file-level evidence is available. Keep supporting details outside the table when they need more space.
- Retain the Check ID and short focus for ordinary follow-ups. Resolve explicit `@` references to authorized saved records before the model is called, and load additional details on demand for implicit references. Bind each answer and card to the selected Check or Problem.
- **Add Document** and **Add Repository** open above the entire app surface. Use a light, translucent blur across the navigation, conversation, composer, and project side panel. Keep the dialog sharp and readable. Use an app-level overlay, keep keyboard focus in the dialog, and restore focus to the initiating control on close.
- Opening a project with an existing Check expands the latest saved Check using the existing result panel and presentation. Keep the return-to-chat action available.

## 5. Questions and continuation

- Anchor a non-modal question panel directly above the composer. Show which user request it belongs to, the question, radio choices with descriptions, and a **Send answer** action. Append **(recommended)** to the first choice’s description. Include a separate **Custom answer** radio option with a text field for every question, including Yes/No questions. Require non-empty text to submit that option.
- Show the oldest pending question first. Give the next question its own 5-second window when it becomes active. While a question is pending, display a question icon at the right end of its project’s sidebar row.
- Allow an initial 5 seconds. If Centinel is inactive or another project is open when that window ends, begin the 10-second countdown. Use the same deadline for the panel and the sidebar’s decreasing ring. The ring appears only during the countdown.
- Returning to the active project during the countdown ends automatic selection for that question. Leaving again keeps the question available for manual submission. If the countdown expires first, submit the first option for an eligible clarification. Keep explicit execution and installation approvals on their existing permission paths.
- Save the question and answer together in the originating turn, and label automatic selections. Resume the original request from the selected option or custom text. Use the saved question identity and revision to accept only one answer and prevent duplicate continuation when a manual answer and timeout race. If ORIN needs more information, show the next question in the same turn.

## 6. Implementation order and verification

1. Update the project conversation guidance in `DESIGN.md` and its decision log. Start with history paging and scroll anchoring in the conversation hook and screen. Test initial entry, paging, scope changes, and scroll position before adding progress indicators.
2. Wire live progress to the existing conversation, Review, and Browser state. Update message actions, quote attachments, and result ordering. Exercise plain responses and Code, Browser, and combined runs.
3. Reuse original Problem and Check components. Verify old and current saved evidence, each Check mode, missing metadata, module tables with long paths, the first view on project entry, and both full-app picker overlays.
4. Update the clarification flow and sidebar together. Keep question, answer, countdown, and continuation tied to the same project and request. Cover manual selection, custom text, timeout, return during countdown, queued questions, and a manual submission racing expiry.
5. Run targeted frontend and sidecar tests and the frontend build. Capture Sample Shop evidence for live progress, Copy, Quote, older-history loading, and question continuation. Verify at 1440×900, 1200×900, and a narrow viewport. Check keyboard access and verify the picker backdrops across the entire app surface.
