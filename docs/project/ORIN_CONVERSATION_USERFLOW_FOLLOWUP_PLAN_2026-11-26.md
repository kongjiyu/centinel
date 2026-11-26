# ORIN conversation userflow follow-up

Use the existing Sample Shop conversations and saved Checks to improve reading, navigation, and follow-up actions. This plan records the agreed behavior and acceptance checks.

## 1. Give evidence table columns room

- Keep the table for Browser test evidence. Set column widths explicitly and let the evidence column take the remaining space. Start with roughly `15rem` for Test, `8rem` for Result, and a `28rem` minimum for Assertion results. Adjust against the actual chat width with the side panel open and closed. Keep status words such as **Passed** and **Not tested** on one line. Let test names wrap at word boundaries.
- Allow horizontal scrolling within the table wrapper when these widths exceed the available space. Keep the page and composer within the viewport. Make the scroll region keyboard accessible and keep its horizontal scrollbar available. Keep headers aligned with their cells and align rows at the top.
- Show the test name, result, and a short assertion summary in each row. Expand a row for assertion names and their recorded results, with **Expected** and **Observed** on separate lines. Open failed and blocked rows by default when showing the Browser evidence. Keep the snapshot action near its test and load the image on demand. Use the saved test result even when the record contains no assertion details, and disclose any unavailable count. An explicit zero displays as zero.
- For comparable quality and impact tables, reserve a readable first column for logical modules such as **Products** and **Inventory** when supported by saved evidence. Use **Affected files** for paths and give them their own wrapping column when requested. Keep the saved-evidence link and leave room for the impact description. Apply the same sizing principles to generated tables where generic column sizing is needed, without relying on positional styles for arbitrary Markdown tables.

## 2. Show a compact Check card with expandable mode details

Use the same compact layout for a newly run Check and a saved Check explained in chat. Keep the title, run status, mode-relevant counts, and access to the dedicated Result screen visible. Show **Found in code** for Code, **Proven in the browser** for Browser, and both for combined Checks. Keep **Requirements not met** when applicable and name the affected mode beside the outcome when coverage is blocked or incomplete. A known zero, an unavailable measurement, and no requirements provided each have distinct text. Keep counts tied to the saved Check and separate from Browser assertion totals.

The card starts collapsed. **Show Detail** at the bottom opens the saved goal, scope, and short problem list immediately, grouped by **Code** and **Browser** for a combined Check. Individual problem and test rows expand for full evidence. Omit an unsaved objective field. For a direct question about a missing objective, answer **Objective unavailable**. Allow the details to collapse again.

A collapsed Browser card for the example in screenshot 3 would read as follows.

```text
Worked for 14s ›
Signed-out catalog shows Ceramic Mug              View result ↗
Completed  ·  Proven in the browser 0  ·  Requirements not met 0
Show Detail ›
```

The count of Browser-proven problems can be zero on a successful check. The saved-verdict sentence immediately below the card should state what the agent verified. Reuse the original Problem disclosure in expanded evidence, including available frozen excerpts and saved and current statuses.

## 3. Show live work on every reply type

Every new agent turn gets one activity disclosure. While active, show **Working for Xs ›** with the current action visible and earlier actions one click away. Append completed actions as they arrive. The screenshot's Browser work log is the interaction model. Each action can show the saved source, Check, Problem, or quoted turn it used when available. Group related steps into expandable rows. References open the authorized record in ORIN while preserving the draft and chat position. When a reference can be named but cannot be opened, show its name as text. When the turn ends, keep the same activity under **Worked for Xs ›**, collapsed by default. Put activity outside and above the detail card. The card comes next, followed by the agent reply. A failed response uses an inline warning icon and the saved explanation of what stopped in the originating turn.

| Scenario | Example activity, shown only when recorded |
| --- | --- |
| Run a Check | **Found Sample Shop workspace** → **Read 3 files in `src`** → **Reviewed the selected files**. Browser work can show the app starting, the page visited, and the named behavior checked. A combined run groups the steps under Code and Browser. |
| Explain a Check | **Opened Signed-out catalog shows Ceramic Mug** → **Loaded saved Browser results** → **Preparing your explanation**. Show a second evidence section when a combined Check has saved Code results. |
| Explain a Problem | **Opened Invalid Order Lines Accepted** → **Loaded the saved excerpt from `src/orders.js`** → **Checked the current status**. Show an unavailable excerpt or status when the lookup returns that outcome. |
| Normal explanation | **Retrieved the quoted reply**, **Read the attached requirements**, or **Preparing your answer**, according to what this turn actually used. A plain answer can have a single activity row. |

Reuse the conversation progress and saved worker events. Add user-facing, allowlisted events for reference resolution, evidence reads, and answer preparation where coverage is missing. Emit the current stage when it begins and add resolved references or counts when it finishes. Persist safe IDs and display metadata so the timeline survives refresh and older-history paging. Keep quick replies concise and preserve truthful paused, cancelled, blocked, and failed states. User-facing activity can show authorized project-relative paths and saved item names. Model reasoning, prompt text, credentials, and raw tool output stay outside the timeline. For historical turns, display the activity the app actually saved.

## 4. Clean up chat actions and navigation

- Put message timestamps below the trailing edge, outside the user bubble or agent reply content. Use the recorded message time where available. Reveal timestamps with message hover, keyboard focus, or a touch interaction that reveals message actions. Use local calendar time and a 12-hour clock. Format today as `7:18 PM`, earlier dates in the same year as `25 Nov 7:18 PM`, and earlier years as `25 Nov 2025 7:18 PM`. Use a semantic time element and reserve enough space to prevent hover from moving adjacent messages.
- Show icon-only **Copy** on user messages and **Copy** and **Quote** at the bottom-left of agent replies. Keep accessible names, hover and focus tooltips, and clipboard feedback. Keep the existing Markdown copy behavior and explicit quote attachment behavior. An automatically associated answer needs no extra reply label.
- Center **Jump to latest** horizontally within the conversation pane at its existing height above the composer. Clicking it smoothly scrolls from the current reading position to the bottom. Respect reduced motion and allow the user to interrupt by scrolling manually. Keep the animated dots for a progressing newest reply when away from the bottom. Keep the older-history skeleton at the top while paging and preserve the reading position after prepending messages. Hide the chat body's vertical scrollbar while keeping wheel, touch, and keyboard scrolling enabled. Scope the styling to chat.

## 5. Make attachments and Library sources recognizable

- Show a compact tile above the message for each explicit attachment. Use an icon, filename or saved item name, and a short type label. Show file size when available. Use existing color tokens, visible focus, and full names on hover when labels truncate. Quotes keep their quoted excerpt treatment. Use the same tile in the composer and sent message.
- Render an attached combined Check as one item when both records resolve to that Check. Keep separately attached Checks distinct. Omit **Code Check** and **Browser Check** labels that represent the execution mode rather than an explicit attachment. Keep the mode in its existing selector and on the actual result where it helps interpret the counts. Use the existing resolved reference IDs for navigation and preserve sent history.
- Build Library rows from saved project source identity. Show one item per repository or workspace source, with its saved name and optional origin. Imported repository paths such as `src`, `docs`, and `public` stay under their repository. Show each uploaded document by its filename in the Library and the @ picker. A read-only explanation can send a Library reference in Browser mode. For older data, group only where persisted source or origin metadata supports the mapping and use a generic source row when the display name is unavailable.
- Reuse the source grouping in Project and Check. Clicking a local repository row opens its saved folder in File Explorer. Clicking a Git remote repository row opens its saved, validated remote URL in the default browser. A repository with an unavailable destination keeps its name visible with an explanation when needed.
- Provide a separate **Browse files** action in the attachment picker for choosing files from a repository for a focused Review. This action uses the existing file-level scope and limits. **Run a full check** remains the whole-project path. Existing file attachments and historical frozen snapshots continue to resolve to their original IDs and versions.

## 6. Write short, readable agent replies

- Lead with the answer. A routine reply should usually be one or two sentences. Across all scenarios, let ORIN choose the style and depth that fit the question. Options include short paragraphs, one sentence per line for a breakdown, labeled bullets, numbered steps, and tables for comparable information. Use headings when they help readers navigate a longer answer.
- Put the evidence card first when one is available. Place ORIN's answer directly below it, visually distinguished by spacing and set in the normal agent typography. Explain the requested impact or answer the user's question there. Keep supporting counts, full excerpts, snapshots, and repeated metadata in the card or its disclosure. State a limitation in the reply when it changes how the user should interpret the answer. Use product-facing language for statuses and omit internal field names from ordinary explanations.
- Use inline Markdown code for file paths, functions, identifiers, routes, and literal values. Reserve fenced blocks for multiline code or logs the user needs. Show authorized saved records as in-app reference links. Render external URLs with short descriptive labels when the user supplied the destination or it was verified against a trusted source, and it passes the app's outbound link checks. Keep other URLs readable as text and raw HTML disabled.
- Apply the same writing rules to generated replies and saved-data templates. The conversation renderer currently treats replies without Markdown format as plain text and unwraps Markdown links. Save newly structured replies as Markdown and render them with the existing safe Markdown component. Preserve verbatim saved recall and historical plain-text replies. Keep lists, code, and long URLs readable at narrow widths, and keep the existing Copy action preserving the Markdown source.

### Example for the screenshot's quality question

The saved Check supports **three quality areas**:

- **Technical correctness** — Invalid quantities can lead to incorrect totals in `server.js`.
- **Security** — The Code review found an order ownership check missing in `server.js`.
- **Business behavior** — The discount in `src/orders.js` uses the subtotal. The requirement leaves the intended discount base unclear.

The Browser run recorded **2 failed assertions**. Its saved results do not verify these Code findings.

## 7. Verify the everyday flow in Sample Shop

Reuse the current signed-in session and saved history. Use saved records for presentation checks and create one fresh run only where live behavior is needed. Review the production build, targeted frontend tests, and desktop captures at 1440×900, 1200×900, and a narrow viewport. Check panel-open and panel-closed widths and keyboard and reduced-motion behavior.

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Evidence tables | Test, Result, and Assertion results are readable. Horizontal scroll stays in the table when needed. A failed test, a blocked test, a long assertion, and a snapshot remain inspectable. | Planned | Unknown measurements must stay distinct from zero. |
| Check cards and explanations | New and saved Code, Browser, and combined cards start compact. Show Detail reveals goal, scope, and problems by mode. The work disclosure appears before the card, and ORIN's reply follows the card. Check and Problem explanations reference the saved records without starting a run. | Planned | Partial coverage needs a visible status. Original Problem controls must stay usable. |
| Live activity | Observe a run, Check explanation, Problem explanation, and normal reply while each is working. Verify the live action, resolved references, and collapsed saved timeline after reload. Cover a text-only reply with no attachments and one reply with unavailable evidence. | Planned | Keep reference lookup separate from execution. Show only actions and evidence the current turn actually used. |
| Reply readability | Repeat the screenshot's quality question and try a short question and a requested walkthrough. Verify the direct answer comes first, bullets and inline code render, long paths wrap, and relevant uncertainty survives trimming. Verify allowed links, unsupported links shown as text, Markdown copy, and verbatim historical recall. | Planned | Keep the saved evidence and generated explanation aligned. Validate link targets independently of model output. |
| Chat and history | Copy, Quote, and timestamps reveal in the correct place. Test the three date formats, centered jump, older paging, active reply dots, and no visible chat-body scrollbar. | Planned | Keep the reading anchor through pagination and avoid unexpected jumps from incoming messages. |
| Sources and attachments | Sample Shop's repository appears once. A local row opens its folder and a Git remote row opens its saved URL. A document, explicit Check, Problem, and Library source are recognizable. Browse files produces the intended focused Review scope. | Planned | Older records may lack usable source metadata. Preserve distinct sources with the same display name. |
| Previously unverified live flows | Away from the project, a clarification uses the existing five-second grace period and one ten-second countdown. Return cancels it, expiry submits the first eligible option at most once, and continuation stays on the original turn. In a harmless controlled startup-failure fixture, show the Browser block and the independent Code outcome. Exercise a dedicated saved requirement in Sample Shop and open its traceability result. | Planned | Report whether each path was exercised live or with automated fixtures. |

The validation pass uses one account and focuses on the path from opening a project to running or explaining a Check, reading evidence, and continuing the conversation. Record screenshots, relevant saved Check IDs, and the remaining test-plan gaps in the Sample Shop evidence report. The user makes the acceptance decision based on the overall experience and whether the documented gaps are acceptable.
