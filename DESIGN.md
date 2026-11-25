# ORIN Design System

> Status: authoritative for all user-facing ORIN interfaces
>
> Direction: give it your project, watch it being checked, read one clear result
>
> Primary audience: anyone who owns a software project, including people who are not testers or engineers
>
> Last revised: 2026-11-12

This document replaces the earlier design guide and its stack of amendments. The user approved the new direction on 12 November 2026.

The earlier guide is kept, frozen, at [`docs/design/DESIGN_LEGACY_2026-11-12.md`](docs/design/DESIGN_LEGACY_2026-11-12.md). It still applies to screens that have not moved to this design (see §14). For new work, and wherever the two disagree, this document wins.

Record a new decision by editing the section it belongs to and adding one line to the decision log in §16. Do not add dated amendment sections.

## 1. The promise

ORIN should feel like the apps people already use to hand work to an AI: you give it something, you watch it work, you get the answer.

A person does three things:

1. **Give** ORIN the project folder (or a GitHub link) and any documents.
2. **Watch** ORIN check it, live.
3. **Read** one page that says what is wrong, where, and how ORIN knows.

Everything else is detail, and detail is opt-in.

The test for every screen: a person who has never seen ORIN understands it in one look, without reading instructions.

## 2. Principles

1. **One thing per screen.** Each screen has one job and one primary action.
2. **Answer first.** Lead with the result in one sentence. Proof comes next. Technical detail is behind a click.
3. **Show the work, for real.** Progress is shown by what ORIN is actually doing: the file it is reading, the button it is clicking. Never by decoration.
4. **Say what was proven.** Every problem shows what evidence it has. Describe evidence that exists; do not label a problem by what it lacks.
5. **Count problems, not successes.** Numbers say how many things need attention. The reader never has to subtract.
6. **Plain words.** Write for someone who is not a tester. No internal names.
7. **Real data only.** Never invent a metric, a status, an activity line or a success.
8. **People decide.** AI output is evidence. Approvals, dismissals and destructive actions stay human actions.

## 3. Words

Use these words in UI copy, navigation, documentation and accessibility labels.

| Concept | Word to use | Meaning |
|---|---|---|
| One start-to-result run | **Check** | Everything ORIN did after one press of Start |
| Static review of files | **Code review** | Reading code and documents without running the app |
| Dynamic testing | **Browser test** | Using the running app in a real browser |
| Finding | **Problem** | Something that needs attention |
| Evidence from the code review | **Found in code** | The cited lines are the evidence |
| Evidence from a browser test | **Proven in the browser** | A browser test showed the problem |
| Artifact | **Source** | A code file, document, requirement or coding standard |
| Requirement result | **Not met**, **Met**, **Not checked** | See §4.3 |
| Older screens and technical records | **Details** | Where the full record lives |

Rules for wording:

- On the three main screens say **problem**, **code** and **browser**. The names Static, Dynamic, Review and Finding remain on older screens under Details until those screens migrate.
- Never write "could not be tested", "unverified" or "not reproduced" on the main screens. A problem is described by the evidence it has.
- Use sentence case for labels. The product name is always **ORIN**.
- Do not use "QA node", "analysis channel", "agent thought", "autonomous validation" or similar internal terms.

Status words, in sentence case: Not started, Queued, In progress, Paused, Completed, Needs attention, Failed, Stopped. Backend statuses map to these in one shared mapper.

## 4. The three screens

### 4.1 Start

**Job:** take the project and begin.

Home follows the familiar AI-app start page (the user chose Gamma's home as the reference): a centred headline over one large check input.

Top to bottom, in one centred column:

1. **The headline** "What should ORIN check?" and one supporting line. The agent's focus-framed aperture sits to the left of the first line. Reserve the full text footprint so the icon stays aligned during typing. The glow (§7) sits behind and below this column.
2. **The check input**, at most 600 px wide, with the hero radius and the one raised shadow (§8):
   - **Attached items** on the first line, as removable pill chips. The project chip (a folder or a GitHub repository) is dark ink with white text and a folder icon; document chips are light with a file icon.
   - **A text area** for an optional focus ("check that sign-in and checkout follow the requirements"). It maps to the existing Review goal. Focusing the field keeps the card border unchanged and adds no outline around the text area.
   - **A mode dropdown** in the composer footer shows the muted selection with a chevron and no border. Its options are **Code and browser** (default), **Code** and **Browser**.
   - **An add button** (a borderless "+" at bottom left) opens a composer-width overlay above the input. Add contains documents and repositories. Recent Checks can select the associated project and attach the earlier check. Typing @ highlights the first action without moving focus from the draft. Add comes first, followed by up to five matching checks by problem count and up to five projects by latest completed check. A typed project search can also find projects with no checks. A follow-up keeps its references and library scoped to its project. Selecting another project moves the prompt and documents to New Check for that project. Choosing a project sets it for the new check. The project selector opens below its trigger and provides project search and a fixed Add a project action. Both footer menus move from their trigger when opening and reverse that movement when closing.
   - **Check**, a filled pill at bottom right, starts the check. When the person types, it becomes an up-arrow button with the same accessible name.
3. **Recommendations**, four borderless translucent rows centered at 90% of the composer width. The first three use ranked project activity with at most two from any scenario and general prompts filling gaps. Try the Sample Shop is always fourth. Selecting a row replaces the draft, project and check mode. General prompts start without a project.

Recent checks are in the sidebar (§6), not on this screen.

Rules:

- The project is required; text is optional. The input must never look like a plain chat box:
  - with nothing attached, the placeholder says "Choose a project with +, drop documents here, or paste a GitHub link";
  - once a project is attached, the placeholder changes to the optional-focus example;
  - the start button stays visible, and until a project is attached it explains what is missing instead of starting.
- The whole input accepts dropped documents and folders of documents, and a pasted GitHub link becomes a project chip. Add Document opens a drop area with file and folder pickers. Add Repository is shared by New Check, Project and Check. Its GitHub tab has a filter, refresh button, scrollable repository list and an explicit Add repository action after selection.
- Home can select a saved project or start from a folder or GitHub link. Add a project opens the project form on Home. Projects without a registered folder get an account-scoped folder under ORIN’s writable application data directory on the current device. Browser testing needs app files in that folder.
- No environment, permission, model or scope settings on this screen. Sensible defaults apply; settings live under Details and Settings.
- Show setup notices directly above the composer with a left-aligned title and explanation. Place the settings button at the right, vertically centered, with a distinct hover background. Distinguish blocked steps from optional setup.
- Documents are optional. Without them the check still runs, and the result says requirements were not provided.
- Do not add a row of templates, sample prompts or suggestions that are not real, usable things. The Sample Shop is the only example because it ships with the app.

### 4.2 Live

**Job:** show the check happening.

Layout, top to bottom:

1. **Header:** "Checking *project*", then a clock icon and the elapsed time in tabular numbers on the heading's baseline, and **Stop** at the right.
2. **Stage strip:** Read the project → Start the app → Find and prove problems → Result. Finished stages show a check mark; the current stage is a dark ink pill with a turning loader; later stages are quiet, and Result has a flag.
3. **Two columns** at 1100 px and wider; stacked below that, code first.

**Left column, "Found in the code":**

- A line that names the file being read right now, in the technical face.
- A list of problems, newest at the bottom, added the moment each one passes validation. A problem never appears before validation and never disappears afterwards.
- Each problem shows its title, its location (`file:line`) and one status, drawn like an evidence mark (§5) with no filled background:
  - the **Code** mark (grey) once it is found,
  - a small dot and **Proving in browser N…** in that browser's lane colour while a browser works on it, then
  - the **Browser** mark (blue) when the browser test shows it.

**Right column, "Proving in the browser":**

- Up to four live browser tiles on a light, translucent stage (§8). Each tile looks like a real browser window: a bar with three dots, a globe and the address, and "Browser N" at the right; then the live picture with a Centinel-drawn cursor; then a one-line caption, with an icon, of the current action ("Clicking **Sign in**").
- A tile that is proving a problem has a 2 px ring and a soft shadow in its lane colour, the same colour as that problem's status, so the eye connects the two. Other tiles have a plain border. Colour is never the only link: the status names the browser number and the tile shows the same number.
- One tile can be enlarged; Esc returns to the grid.
- Validated code findings and failed browser assertions update their respective counts and lists while the check runs. A blocked browser test shows its reason under the test name.

Rules:

- Problems appear while the check runs. A long code review must never leave the screen unchanged for minutes; the current file line and elapsed time always move.
- If only one kind of check runs, its column takes the full width.
- If browser startup needs an install, Ask first and Auto show a questionnaire with the detected command, declared packages, a recommended answer, and an optional custom note. Bypass uses the detected recipe directly. A missing runtime or package manager can be set up manually and retried. The code review continues while browser startup waits or pauses. If browser startup fails, a combined check and its composer switch to Code only. A browser-only check stays paused with a manual retry action. When a combined check's browser lane is interrupted after startup, Retry browser tests starts a new browser run on the same check and preserves the code review.
- A pause (for example the AI provider's limit) replaces the stage highlight with **Paused**, one sentence of explanation, and **Resume**. Nothing resumes by itself.
- Leaving the screen does not stop the check. A compact progress item stays in the sidebar and returns here.
- When the check ends, the screen moves to Result by itself. If the person is elsewhere, show one toast.
- Typing is shown as dots with a length only; the text typed is never displayed.

### 4.3 Result

The Check header stays at the top of the response card. A notice near the top shows the saved reason when code review is paused or blocked, or when browser startup fails. Long check names pan on hover or focus. A folder icon returns to the project conversation and shows the project name on hover. Duration, problems, history, and export appear in that order in a blurred toolbar at 60% surface opacity. Duration is the default visible label for a completed check. Hover or keyboard focus expands the item's label. The previous label closes faster, and a stationary pointer keeps its active label while the toolbar resizes.

Add Document opens the native file chooser from each composer. Dragging files over the page displays a drop indicator across the workspace. Project and Check composers offer Add Repository directly and omit empty check or problem sections.

**Job:** say what is wrong, where, and how ORIN knows.

Layout, top to bottom:

1. **Context line:** a folder icon and the project name, a clock icon and how long the check took. **Export** sits at the right of this block.
2. **Verdict:** one sentence at verdict size, for example "5 problems found. 3 proven in the browser."
3. **Three numbers:** Proven in the browser, Found in code, Requirements not met. Each label has its icon.
4. **Problem list** in two groups, in this order:
   - **Proven in the browser**
   - **Found in code**
5. **Footer lines:** anything that was not checked, the count of items checked in the browser that showed no problem, and the link to Details.

Every problem row shows the title, its location and its evidence marks (§5). Within a group, order by saved risk level, highest first, and show the level as one word with its icon (Critical, High, Medium, Low). Each row ends with a disclosure chevron. Do not show separate Severity and Priority labels on this screen.

Opening a row shows, in order:

1. **In the code:** what the code review saw, with `file:line`.
2. **In the browser:** what was expected and what the page showed. Only when a browser test exists.
3. Three small pill buttons, each with a blue icon: **Screenshot**, **Replay the test**, **Open the code**.
4. An **AI explanation**, visibly labelled as AI, when one was saved.
5. Decisions (the existing finding decisions) under a quiet **More** control.

Only one row is open at a time.

Verdict wording:

| Situation | Verdict |
|---|---|
| Problems with browser proof | "N problems found. M proven in the browser." |
| Problems, none proven | "N problems found in the code." |
| No problems | "No problems found." followed by one line saying what was checked |
| Parts not checked | The normal verdict, plus the footer line "Not checked: …" naming the parts |
| Stopped, failed or paused | Say which, in one sentence, and show what was found before it ended |

Never write that the project is "safe", "secure" or "ready". ORIN reports what it checked.

Numbers:

- Numbers count things that need attention. Write **Requirements not met: 2** with "of 6" in supporting text. Do not write "4 of 6 met".
- When every requirement is met, write "All 6 requirements met" instead of a zero.
- Show **Not checked** for requirements only when the count is above zero. A requirement that was not checked is never counted as met.
- When no requirements were provided, say "No requirements provided" instead of a number.

### 4.4 Project conversation

Project conversation places each check card at the point it was requested. View expands the card into Check and attaches that Check to the composer. Typing keeps the result open. An acknowledged send returns to Project and collapses the card. Both composers accept check and problem references through @. The sidebar initially keeps its compact layout so the conversation remains visible. The [harness contract](docs/project/PROJECT_CONVERSATION_HARNESS_CONTRACT_2026-11-18.md) defines the evidence and execution boundaries. The [implementation report](docs/project/PROJECT_CONVERSATION_HARNESS_IMPLEMENTATION_2026-11-18.md) records verification and remaining live acceptance.

A completed Check card offers Ask, and each saved problem offers Ask about this problem when its exact evidence is available. These actions prepare a draft and never send it; keep any draft the user already typed. Once sent, a compact strip at the top of the user's message lists the first three included checks, problems, or attachment filenames. An ellipsis reveals the rest on mouse hover or with a keyboard or touch activation. Historical messages without names show the known attachment type instead of guessing. Labels from the sent message are not verification evidence. When the authorized saved item has a different name, show that name explicitly without using the sent label to resolve scope.

Project and each Check keep separate drafts with their attachments. A message sent from Check appears in the Project conversation while the Project composer restores its own draft. User messages align right and occupy up to 60% of the conversation width. Agent responses use the full width.

An explicit module Review sent in Browser mode switches the composer to Code after the request is saved. The mode control shows a brief outline and announces the change. Reduced motion uses a steady outline. Under Ask first, “proceed” or “go ahead” approves the latest saved plan shown in the conversation through the same revision check as **Run this scope**. “Proceed with Code only first” approves only a waiting Code plan with no Browser attempt. If that plan is missing, ask for the folder or files to review.

Show a clarification with choices in a card at the top of the chat container. The composer and other controls remain available. After the person selects an option and it is saved, show the question and the chosen answer in the original conversation turn. Answer later collapses the card and leaves the question available at the top of chat. Open-ended clarification stays in the conversation.

Selecting Code review only continues an explicitly requested module Review on the same turn. Show its current file scope for approval. When scope or the intended result is unclear, ask for the missing detail in the current conversation. An older saved Code choice can be continued from its turn.

Show the newest response failure in a non-blocking card at the top of chat. Explain what stopped in plain language and give a next step based on the saved failure stage or reason. The original turn keeps its evidence and a control to reopen the error.

During local harness assessment, an opt-in **Harness trace** disclosure appears on the request owner's evidence-backed conversation turns. It shows counts and saved stage timings for context, selected action, and child execution. It contains only allowlisted stage labels and metadata counts.

An explanation of an attached check or problem cites the saved record and labels missing historical evidence. If Browser cannot start for a combined request, ORIN can switch to Code only when the same attached evidence identifies the source scope. Ask first requests a fresh approval for that scope. The Browser attempt remains visible as a coverage gap.

Show attachments on the sent message. Keep explanations and evidence in the conversation. Show the saved Code excerpt, Browser assertion results and available snapshots before the generated answer to the user's question. Use Markdown tables for comparable information such as project modules and bullets for distinct points. Older turns can load evidence in place. Label a frozen source window separately when the original cited excerpt cannot be verified.

**Job:** let a person test and change a project by talking to ORIN, instead of filling in forms.

Opening a project shows a conversation with ORIN, not tabs of settings. The user approved this direction on 13 November 2026.

Layout:

1. **Header:** the project name, History, and **Run a full check** start inside the conversation card. The borderless, transparent header sticks to the top of the scrolling pane. The project name opens Sources in either position. Sources and the shared history and run toolbar use a blurred surface at 60% opacity. The run label is visible by default. Hover or keyboard focus moves the visible label to the active item. The Sources library lists repository and document groups. Opening a project with retained Google Drive sources and a disconnected Drive integration shows a dismissible attention dialog with a link to Connections. On narrow screens the toolbar can wrap below the project name.
2. **The conversation**, newest at the bottom. It opens with one sentence about the latest check.
3. **The message input** at the bottom, styled like the check input on Start, with the permission mode beside it (§4.5).
4. **A side panel** (no title; accessible name "What ORIN knows"). Collapsed (the default) it is a 280 px column with the latest check only: the problem count, how many were proven in the browser, the Browser, Code and Not met numbers, every problem with its risk icon, and Open the full result. A two-corner button at its top right (corners out; corners in to return) expands it over the whole conversation area, titled with the project name, with Download report beside the button, and Retry the code review when the latest review stopped or Run a full check otherwise. Expanded it shows what the Review page shows, plus the browser's proof: the review's own summary (when saved); problems grouped as Proven in the browser, then the Review page's categories (Document, Security, Behavior, Human manual, System); and the latest full check's browser tests. Each problem starts as one title row with its risk; opening it shows its category and behavior, the saved code with the cited lines highlighted in yellow and labelled "Highlighted: where the problem is" (the Review page's source view; the panel does not use its green), the issue overview and what to do, or for browser proof what was expected, what the page showed, the labelled AI explanation and Run it again. Run it again closes the panel and puts the saved test in the message box ("Run “…” again"); the person sends it, or types how to change it. The review state sits beside the project name and four risk counts (Critical, High, Medium, Low) open the panel. A right column shows the review scope, duration, files reviewed and time, then requirements, sources, saved browser tests, how the app is tested and past checks. Requirements come only from the project's documents: requirements the model reads from a document are listed as Found in your documents with Keep and Drop, kept ones can be edited or removed, and with no document the panel says there are none. Sources can be added (documents, which are then read for requirements), synced (folder or GitHub), resumed when source search is paused, and removed after a confirm. A finished review is not held for approval, and problems are not decided by hand: the AI's own source-change comparison resolves them. Expanding grows the panel from its column in 220 ms with the standard easing while the conversation fades out; the expanded content fades in once after 180 ms; reduced motion switches instantly. While expanded the conversation cannot be reached; the button or Esc returns to it. Whether it is open is kept per project on this device. Below 960 px the panel sits above the conversation at full width and expands to replace it. Apart from managing sources and requirements, it only reads. To change a test, say it.

Each compact check card shows the name and start time, with the check mode beneath them and the applicable mode and requirement figures below. Browser-only and Code-only checks show their respective mode count, including in the expanded result. Standalone Browser runs with saved tests show the Check card beside their conversation results and replay actions. **Unchecked**, **Export**, and **View** sit at the right of the title row. Their labels expand on hover or keyboard focus. **Unchecked** shows the listed coverage gaps and their count. **Export** saves a Markdown summary of the saved evidence. **View** focuses that check in the expanded project side panel. The expanded panel also offers an action to open the dedicated Check screen.

What a message can do (step 1: browser tests):

- **Add a test.** "Test that coupon SAVE10 lowers the cart total." ORIN starts the app if needed, explores it, writes the test and shows a **test card**: its name, plain-language steps, and "Passes only if the page shows …". The card offers **Run now**, **Save for every check** and **Change it**.
- **Run a test.** The live browser tile from Live (§4.2) plays inside the conversation, then the result appears in place: expected, what the page showed, the AI explanation (labelled), **Screenshot** and **Replay**.
- **Change a test.** "Also check that an expired coupon shows an error." ORIN answers with a **change card** that lists added lines in green and removed lines in red, and says where any test value came from.
- **Give test data.** "Use admin@test.com / test123." The values are kept as this project's test data.

Rules:

- ORIN starts the app itself, with the same fixed recipe table as Auto test. There is no address field. If the app cannot be started, the conversation says why in one sentence (no folder on this computer, several apps in one folder, a database or Docker is needed). Testing a deployed address needs the person to name it, and opening a non-local address needs their confirmation.
- The model can only use ORIN's existing actions: write, run or change a test, add a source, record test data. It never writes commands to execute.
- Pass and fail still come only from independent checks on the page.
- Test accounts may be filled by the AI: those in the project's seed, fixture or demo files, those it registers on the local app, and those the person types in the conversation. They are used only on local addresses, only in this project. The first time a person types an account, ORIN adds one line: "The AI will see this account. Use test accounts only."
- Every action that ran without asking leaves a **Done** card with **Undo**.
- The conversation is saved with the project. The tabbed project screen is retired. Project details and editing are available from the sidebar’s project options.
- ORIN uses a bounded set of recent completed turns for ordinary follow-ups. **Reply to** uses the selected reply as the conversation reference. Ask directly for the missing context when the reference is ambiguous. The current request and its verified evidence determine what can run.
- Explanations and saved source excerpts appear inside the conversation. Clarification choices and response errors appear in non-blocking containers above the conversation. When a person selects an option, the question and answer appear in the conversation and the scoped request continues under the selected permission mode.
- Settings that do not fit a sentence (before/after commands, file upload and download permissions) stay under Details for now.

### 4.5 Permission modes

A project has one permission mode, shown next to the message input and changed there. The change is recorded in the conversation. The mode stays until the person changes it.

| Mode | Run a test | Save or change a test | Change test settings (address, permissions) | Delete anything |
|---|---|---|---|---|
| **Ask first** | Asks | Asks | Asks | Asks |
| **Auto** (default) | Runs | Does it, with Undo | Asks | Asks |
| **Bypass** | Runs | Does it, with Undo | Does it, with Undo | Asks |

No mode can:

- delete without confirmation;
- let the model write commands to execute;
- open a non-local address without confirmation;
- let the model decide pass or fail.

## 5. Evidence

ORIN double-checks. A problem the code review finds is handed to a browser test, which tries to show the same problem on the running app.

### Marks

Each problem carries one or two marks:

| Mark | Meaning | Style |
|---|---|---|
| **Code** | The code review found it and the cited lines passed validation | Lucide `code` icon and the word, in `--color-text-muted`, regular weight |
| **Browser** | A browser test's own check failed in the way the problem describes | Lucide `monitor-check` icon and the word, in `--color-browser` (blue), semibold |

Marks, the risk word and Live statuses are an icon or a dot plus a word. They have no filled background, border or pill. The risk word has its level icon (§8, Icons) and uses its level colour (`--color-level-*`) at semibold weight. On a row they sit at the right in this order: risk word, Code, Browser.

- **Code + Browser:** found in code and proven in the browser. Listed under **Proven in the browser**.
- **Browser** alone: a browser test found it and the code review did not report it. Also listed under **Proven in the browser**.
- **Code** alone: listed under **Found in code**. This includes problems a page can never show, such as a secret written in the code.

### Rules

- The Browser mark needs a saved run whose independent check failed. The model saying a problem exists is never enough.
- A problem that was tested in the browser and did **not** show is not listed as a problem. Its record is kept, not deleted. The Result footer gives the count ("1 other item was checked in the browser and showed no problem") with a link that opens those records under Details.
- A problem that a browser cannot show keeps its Code mark and stays in **Found in code**. Its evidence is the code itself, which the person can open.
- Stored findings and Review history are never rewritten to produce these groups. The groups are a presentation of saved records.
- When browser testing did not run at all, every problem is **Found in code** and the footer says browser tests did not run, with the reason.

## 6. Navigation and Details

### Shell

- Use the operating system's window controls.
- One sidebar, one level. **New Check** opens the check composer and stays fixed above the scrollable **Checks** and **Projects** lists. Search sits beneath New Check. The dialog opens from Search or Ctrl/Cmd+K, puts its input in the header, and shows Checks before Projects. It shares the @ menu’s ranking, shows up to eight items per list, and opens matching Help and Settings sections. The dialog uses a 75% surface with local blur and a light shadow. The page outside the dialog remains clear. Help and Settings sit beside the profile below the scroll area. The profile menu holds Switch account and Log out. Manage account lives in Settings under Account.
- Checks and Projects use compact rows and each list collapses from its heading. The Projects heading also has an Add project action. Checks show a status icon at the right with an accessible outcome label. Projects show a folder and an ellipsis on the hovered or keyboard-focused row. Long check names, project names, and workspace paths fade at the trailing edge and pan once on hover or keyboard focus. The ellipsis opens project details and editing. Recent projects shows the five most recently updated projects. Show more reveals up to five additional projects.
- Do not add a second navigation column or an icon rail beside it. ORIN has few destinations; everything else is under Details.
- Each recent check shows the project name and, 4 px below it, its result in a few words with an icon (a warning triangle and "5 problems" in red; a check and "No problems"). Records are separated by more space than a name and its result.
- A running check appears at the top of the recent list with a live state and returns to Live.
- Opening a past check opens its Result.

### Details

The project row’s ellipsis shows a hover preview of its name, description, workspace, creation date, and source rows with import times. The fixed-height preview fades additional rows. Clicking opens the full information in a dialog. The entire divided footer is the Edit project action in both views. App-managed workspaces show “Workspace is not selected.”

Details is the door to the full record and to the older screens: Requirements and traceability, Activity, Sources, Usage, Reports, approvals, and manual Review or Dynamic testing setup.

When Browser Run copies are stored on the device, Recorded evidence uses Save and Delete saved copy. Show a copy's expiry only when it has one.

- The three main screens never require Details to understand the result.
- Details opens in the context of the current check or project and offers a clear way back.
- Reviews are not held for a person's approval and problems are not decided by hand (16 November 2026). Screens and reports show a finished review as Completed (or Completed with gaps); the stored lifecycle and any earlier recorded decisions are unchanged, and no approval is recorded on anyone's behalf.

## 7. Visual direction

The style is **Aurora**: a bright, calm page with one soft glow of colour. The user chose it on 12 November 2026 from five full-size explorations. The reference build is [`docs/design/explorations/styles.html`](docs/design/explorations/styles.html) (style 1); when this document and that page disagree, this document wins.

- **Light and warm.** An off-white canvas, white surfaces and dark ink text. Generous space around the one thing that matters on each screen.
- **One glow.** A large, blurred wash of blue, pink and orange sits behind the content at the top of the page. It is atmosphere, not decoration on components: nothing else in the app has a gradient.
- **Soft shapes.** A large rounded check input, pill buttons and chips, and rounded cards, so ORIN feels like an everyday AI app, not an admin console.
- **Ink for actions.** The primary action and the selected state are dark ink with white text.
- **Two colours carry meaning.** Blue means the browser. The risk level runs red, orange, yellow-brown, grey.
- **Light everywhere.** The live browser tiles look like real browser windows on a light, translucent stage. There is no dark area in the app.
- **Icons with words.** Every action, label, step and number has an icon beside its word (§8, Icons).
- **The technical face** for file names, paths and addresses.

Do not use:

- radar, scan lines, telemetry grids, crosshairs or "system online" graphics;
- neon glows, gradient text, or gradients on buttons, cards, chips or icons;
- a second glow, or the glow in colours other than its three;
- progress bars or percentages that are not computed from real progress;
- looping animation that does not show a real action;
- a card around every small group, or cards inside cards;
- more than three numbers at the top of a screen;
- fake statistics, fake activity or generated filler prose;
- emoji as icons, or more than one icon library.

## 8. Design tokens

Tokens live in `centinel/src/tokens.css` and are the only source of reusable visual values. Screen styles use the tokens; they do not define hex values.

These values are the target. `tokens.css` still holds the earlier Stone and Forest green values until the token change is made (§14). Token names stay the same so existing screens do not need to change.

### Colour

```css
:root {
  --color-canvas: #fbfaf7;
  --color-surface: #ffffff;
  --color-surface-subtle: #f4f2ee;
  --color-surface-hover: #f4f2ee;
  --color-surface-selected: #efecf5;

  --color-border: #e9e5de;
  --color-border-strong: #d9d4cb;

  --color-text: #1b1722;
  --color-text-muted: #6f6a78;
  --color-text-subtle: #6f6a78;

  --color-primary: #1b1722;
  --color-primary-hover: #2c2636;
  --color-primary-subtle: #f4f2ee;
  --color-on-primary: #ffffff;

  --color-browser: #2563eb;
  --color-browser-subtle: #eaf0ff;

  --color-success: #15803d;
  --color-success-subtle: #f0fdf4;
  --color-warning: #b45309;
  --color-warning-subtle: #fffbeb;
  --color-danger: #d6304a;
  --color-danger-hover: #b8243c;
  --color-danger-subtle: #fdecef;
  --color-info: #2563eb;
  --color-info-subtle: #eaf0ff;

  --color-level-critical: #d6304a;
  --color-level-high: #c2410c;
  --color-level-medium: #a16207;
  --color-level-low: #6f6a78;

  --color-lane-1: #2563eb;
  --color-lane-2: #b45309;
  --color-lane-3: #0f766e;
  --color-lane-4: #be185d;

  --color-stage: rgba(255, 255, 255, 0.5);
  --color-stage-bar: #f3f1f6;
  --color-stage-border: rgba(255, 255, 255, 0.9);

  --glow-blue: rgba(72, 120, 255, 0.55);
  --glow-pink: rgba(255, 86, 150, 0.55);
  --glow-orange: rgba(255, 150, 70, 0.5);

  --color-focus: #2563eb;
  --focus-ring: 0 0 0 3px rgba(37, 99, 235, 0.3);
}
```

Colour rules:

- Ink (`--color-primary`) is the primary action and the selected state. It is not used for decoration.
- Blue means the browser: the Browser mark, a problem being proven, the working browser tile, links inside an opened problem, and focus. Nothing else is blue.
- Red, orange, yellow-brown and grey are the four risk levels, in that order. Red also means a failure or a destructive action.
- Green means success only, and appears rarely.
- Amber means caution or paused.
- Lane colours only match a browser tile to the problem it is proving, and always come with the browser's number. Lane 1 is blue.
- The glow uses the three `--glow-*` colours, blurred by 50 px, behind the content near the top of a screen. It never sits behind body text that must be read.
- Status always has text or an icon. Colour is never the only signal.
- Every text and background pair meets WCAG 2.1 AA. The values above were checked: text colours reach at least 4.5:1 on both white and the canvas.

### Typography

```css
--font-ui: 'Onest Variable', 'Onest', 'Segoe UI', system-ui, sans-serif;
--font-technical: 'JetBrains Mono Variable', 'JetBrains Mono', 'Cascadia Mono', ui-monospace, monospace;
```

| Role | Size / line height | Weight |
|---|---:|---:|
| Start headline | 42 / 46 px | 700 |
| Verdict | 30 / 35 px | 700 |
| Page and panel title | 22 / 28 px | 700 |
| Number on a number card | 32 / 35 px | 700 |
| Body, input text | 15–16 / 23 px | 400 |
| Dense list and buttons | 14 / 21 px | 400–500 |
| Labels, marks, supporting text | 13 / 19 px | 400–600 |
| Technical metadata | 12 / 18 px | 400 |

- Headlines use tight tracking (-0.03em). Nothing renders below 12 px, except the address in a live browser tile (11 px).
- The technical face is for code, file paths, addresses and IDs only.
- Tabular numbers for counts, durations and timestamps.
- Text of different sizes on one line shares a baseline. A small label beside a large heading sits on the heading's baseline, never centred against it.
- Onest is the interface face and JetBrains Mono the technical face. Both are bundled; the app makes no network request for them.
- Exported PDF reports keep IBM Plex Sans until the report template is updated.

### Spacing

Every margin, padding and gap uses a step from this scale. No other values.

```css
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;  --space-5: 20px;
--space-6: 24px;  --space-8: 32px;  --space-10: 40px; --space-12: 48px; --space-16: 64px;
```

Choose the step by how closely two things are related. The closer the relationship, the smaller the space:

| Relationship | Step | Examples |
|---|---|---|
| An icon and its word; a title and its one-line detail | 4 | The Code mark; a project name and "5 problems" under it |
| Items in the same group | 8 | Mode chips; the three action buttons in an opened problem; stacked problem cards on Live |
| Parts of one component | 12–16 | Inside the check input; card padding; a row's top and bottom padding |
| Different components on one screen | 24 | Stage strip to the two columns; number cards to the problem list; one group to the next |
| The edge of a screen's main content | 32–64 | Page gutters; space above the Start headline |

- Inner spacing is never larger than outer spacing. Card padding (16) is smaller than the space between cards and their neighbours (24).
- An icon and its word use 4, or 8 in buttons and navigation at 14 px and larger.
- Control height is 40 px; at least 44 px on narrow or touch layouts.
- Content gutter: 32 px at 1440, 24 px at 1200, 16 px below 960.
- Reading and form columns: at most 720 px. The check input: at most 600 px.

### Shape

```css
--radius-inner: 14px;   /* blocks inside a card */
--radius-card: 18px;    /* cards, rows groups, number cards */
--radius-panel: 22px;   /* a screen's outer panel, the app shell */
--radius-input-hero: 26px; /* the check input on Start; nothing else */
--radius-tile: 10px;    /* live browser tiles */
--radius-pill: 999px;   /* buttons, chips, the current step */
```

- Buttons, chips and round icon buttons are pills.
- Radii are concentric: an outer radius equals the inner radius plus the padding between them, rounded to a token.
- Evidence marks and risk words have no shape (§5).
- Do not introduce other radii.

### Borders and elevation

- Surfaces have a 1 px border in `--color-border`.
- Cards carry a barely visible shadow: `0 1px 2px rgba(30, 20, 60, 0.04)`.
- The check input is the one raised element: `0 24px 60px -18px rgba(60, 40, 120, 0.28), 0 2px 6px rgba(30, 20, 60, 0.06)`.
- A live browser tile has `0 14px 34px -14px rgba(60, 40, 120, 0.3)`. The tile that is proving a problem adds a 2 px ring in its lane colour.
- Panels over the glow are translucent white with a light blur so the colour shows through softly. Text always sits on a surface opaque enough to keep its contrast.
- Menus use `0 8px 24px rgba(23, 32, 51, 0.12)`; dialogs use `0 20px 48px rgba(23, 32, 51, 0.18)`.
- Focus uses the focus ring, never a glow.

### Icons

Icons help people recognise an action or a label without reading. Use them generously, always with their word.

- Lucide only, `currentColor`, 1.7 px stroke on the 24-unit grid.
- **Where:** every button and link-style action, every navigation item, every step in the stage strip, every evidence mark, every risk word, every number card label, every group heading, and every caption in a browser tile.
- **Never alone.** An icon does not replace a word, except in the round add and start buttons and the row disclosure chevron, which have accessible names.

Meanings are fixed. Use the same icon for the same thing everywhere:

| Meaning | Lucide icon |
|---|---|
| Code, found in code, open the code | `code` |
| Browser, proven in the browser | `monitor-check` |
| Critical | `octagon-alert` |
| High, Medium, and "N problems" | `triangle-alert` |
| Low | `info` |
| No problems, a finished step | `check` |
| The step in progress | `loader-circle`, turning |
| Result | `flag` |
| Elapsed time | `clock` |
| Stop | `square` |
| Screenshot | `image` |
| Replay the test | `play` |
| Export report | `download` |
| Project folder | `folder` |
| Document | `file-text` |
| Address in a browser tile | `globe` |
| Requirements not met | `list-x` |

Size and alignment:

1. **Size.** An icon is 1.2 times the size of its text (12 px text, about 14 px icon; 14 px text, about 17 px icon).
2. **Optical centre.** An icon is centred on the optical midline of its text, which is halfway between the centre of the x-height and the centre of the cap height. It is not centred on the line box. For each font this is one measured offset, stored as a token and applied to every icon (for Onest, about 0.03 em down from the line-box centre).
3. **Flat bases sit on the baseline.** The warning triangle has a wide, flat base that the eye compares with the bottom of the letters. Raise it 0.1 em so its base rests on the text baseline.
4. **Off-centre shapes get a fixed correction.** The play triangle moves right 0.06 em.
5. **The icon follows the text.** In an icon-and-word pair, the word decides where the pair sits (on the baseline of its line); the icon then aligns to the word. An icon never decides where text sits.
6. One shared component applies these rules. Screens do not position icons themselves.

## 9. Motion

Motion has two jobs: to explain a change, and to show real work.

```css
--duration-fast: 100ms;
--duration-standard: 150ms;
--duration-slow: 220ms;
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
```

**Everywhere:**

- Hover and focus: 100–150 ms. Disclosure and small overlays: 150–220 ms.
- Animate only `opacity` and `transform` where possible. Never `transition: all`.
- No page-load entrance animation and no decorative stagger.

**On New Check,** the headline types in and the underscore blinks slowly. The subtitle slides in from the left, followed by staggered recommendation rows in reserved space. Blue moves from the upper left, pink from the middle right, and orange from the lower left-center on independent paths. The composer expands upward while keeping the heading and subtitle in place. When a check starts, the footer collapses and the composer moves from its measured landing position to the measured follow-up position. The Check details panel enters from the right. Reduced motion keeps the introduction and route change immediate and the colors still.

**On Live, motion is evidence.** These are allowed because each one shows something that really happened:

- the cursor gliding to the element the browser is about to use, a click ripple, a target outline and a masked typing caret;
- a pulse on the one file being read now;
- a new problem entering the list once (fade and a short slide, 220 ms);
- a problem's status changing from "Proving in browser N…" to the Browser mark.

Each motion is driven by a real event from the check. If the event stream stops, the motion stops; nothing loops to look busy.

**Result has no motion** beyond opening and closing a row.

`prefers-reduced-motion: reduce` turns glides into instant jumps and removes ripples, pulses and entrance motion. No information is lost.

## 10. Components

Screens use shared primitives, not screen-specific copies.

- **Buttons:** one primary per screen region. Secondary for safe alternatives, quiet for low-emphasis actions, destructive never as the default. Loading buttons keep their width and use a verb ("Starting…").
- **Check input:** the Start input. Holds attached items, optional focus text, the add button and the start button. Accepts drop, picker and paste, with a keyboard path for every action.
- **Chip:** a pill. A removable attached item or a mode choice on Start. Dark ink when it is the project or the selected mode; light otherwise. Always has text.
- **Evidence mark:** the Code and Browser marks in §5, an icon and a word with no background. One shared component, also used for the risk word and Live statuses; no screen draws its own.
- **Stage strip:** the four stages on Live. One shared component, also usable in a compact form in the sidebar.
- **Browser tile:** a light browser window on the stage: address bar, live picture with cursor, and caption.
- **Icon:** the one component that sizes and aligns every icon by the rules in §8.
- **Problem row:** title, location, risk word, evidence marks and a disclosure button. Opens in place.
- **Number card:** a label and one number. At most three in a row.
- **Status and feedback:** inline message near a field, banner for a page-level issue with a recovery action, toast for background completion, dialog only for a decision.
- **Dialogs:** labelled title, focus trap, Escape, focus restoration and a visible Close. Destructive confirmation names what is affected.
- **Forms:** every control has a visible label. Errors appear beside the field and keep what was entered.
- **Empty states:** say why the area is empty and offer the next action.

## 11. Layout and breakpoints

- **1440 × 900:** Live in two columns, up to two browser tiles per row.
- **1200 × 900:** the same, with narrower gutters.
- **Below 1100 px:** Live stacks, code column first; one browser tile per row.
- **720 px and below:** single column, 16 px gutters, 44 px controls, dialogs become near-full-width sheets.

Start and Result are single-column at every width. Narrow layouts keep every action.

## 12. Accessibility and content

The release target is WCAG 2.1 AA.

- Every workflow works by keyboard. Focus is visible and follows reading order.
- Use semantic headings, landmarks, labels, buttons, lists and tables. Real buttons for actions, real links for navigation.
- Live announces new problems and stage changes through a polite live region, without moving focus. The cursor animation is decorative to assistive technology; the caption carries the meaning.
- The check input's add button gives a keyboard path for everything that can be dropped or pasted. The round add and start buttons have accessible names.
- Support 200% zoom without losing content or actions.
- Write short sentences. Put the action first. Explain a technical term where it appears.
- Do not blame ("The check could not start", not "You entered an invalid folder").
- An error says what happened, what is still safe, and what to do next.

## 13. Data integrity and trust

- Every number and status comes from saved application data.
- A problem is shown only after it passes validation. The Browser mark is shown only for a saved run whose independent check failed.
- Problems checked in the browser that showed no problem are kept and reachable, never deleted.
- Anything that was not checked is stated on Result. Silence never implies it passed.
- AI-written text is labelled as AI.
- Secrets, full API keys, typed text, prompts and credentials never appear in the UI, in live pictures' captions, in logs or in evidence previews.
- Destructive actions name their scope and consequences.

## 14. Build status and migration

This document describes the target. Built on 12–13 November 2026 (frontend only, no service or data changes):

| Part | State |
|---|---|
| Aurora tokens: palette, glow, lanes, stage, spacing, shape | Built in `centinel/src/tokens.css`. Token names are unchanged, so older screens now use the Aurora colours |
| Onest | Bundled; replaces IBM Plex Sans in the app. Exported PDF reports still use IBM Plex Sans |
| Shared icon component with optical alignment | Built: `components/Icon.tsx`. Used on the three new screens and the sidebar; older screens still use plain Lucide icons |
| Home | Built: `screens/check/StartScreen.tsx`. Choose or add a saved project via the add menu, add documents by drop or the add menu, or paste a GitHub link. The mode dropdown sits at the upper left of the composer |
| Live screen | Built: `screens/check/CheckScreen.tsx`. Code column reads the Review's saved progress and validated live titles; browser column reuses the Auto test live stream |
| Result screen | Built: same file. Two groups, three numbers, one risk word with its icon, open-in-place evidence |
| Sidebar: New, Search, recent checks, recent projects | Built. Recent checks are stored on this device only (`check/store.ts`); they hold IDs and outcomes, never findings or source |
| Code and Browser marks | Built. Browser problems are failed Auto test runs; code problems are open Review findings |
| Handing code-review problems to browser tests | Not built. No problem carries both marks yet |
| Dropping a folder onto a check input | Reads the folder's documents as library files. Choose a local repository through the native folder picker to register its workspace path |
| Migrating older screens to Aurora layouts | Not done. They keep their layouts under Details, in the new colours |
| Project conversation, step 1: add, run, change and save browser tests by message (§4.4) | Built: `screens/project/ProjectConversationScreen.tsx`. Opening a project shows it. Its sidebar options open project details and editing |
| Permission modes (§4.5) | Built for step 1. Ask first confirms before running; Auto and Bypass run at once. Saving a test shows Undo. Mode, saved tests and notes are stored on this device (`check/projectPrefs.ts`) |
| Latest check in the project side panel, with Download report | Built. Collapsed shows the latest check and its problems; expanding covers the conversation with the whole project (§4.4). The report includes the latest full browser check (each test, its checks and what the page showed) |
| Saved tests in every check | Built: tests saved in the conversation run alongside newly planned tests in each full check |
| Conversation steps 2 and 3: settings by message (address, permissions), questions about results, deleting by message | Not built. A question gets a plain reply only when the AI cannot write a browser test for it |
| Code review page under Details (redesigned 14 November by the team: issues in five categories, coverage table, live issues, per-issue feedback) | Kept under Details on the legacy guide. The Live screen reads the same run events (`review_assessment_batch_started` file and `assessmentPhase`), and Result titles use the same short title (`shortReviewIssueTitle`), so the two pages name the current file and each problem alike |

Migration rules:

1. Build the three screens on top of the existing services. Do not change stored data to fit the screens.
2. Remaining older screens follow the legacy guide until they migrate or are retired.
3. Do not show a mark, group or number from §4 or §5 until the data behind it exists. Until browser proof is built, problems are shown as **Found in code** only.
4. A migration is not complete while the same concept has two competing presentations on the main screens.
5. Any intentional deviation from this document needs the user's approval and a line in §16.

## 15. Norman and Shneiderman rules

| Rule | ORIN requirement |
|---|---|
| Visibility and informative feedback | Live shows the current stage, the current file, the current browser action and elapsed time, all from real events. |
| Match and natural mapping | A problem and the browser proving it share a number and a colour. Evidence sits inside the problem it supports. |
| Signifiers and affordances | The check input says what to drop and has an add button for the same actions. Rows that open have a visible disclosure control. |
| Constraints and error prevention | Until a project is attached, the start button explains what is missing instead of starting. Missing setup is shown as one step in place. |
| Conceptual model | A check has two kinds of evidence, code and browser, and every problem shows which it has. |
| Consistency | One word per concept (§3) and one shared component per pattern (§10). |
| Closure | Every check ends on Result with a one-sentence verdict. |
| Reversal and recovery | Stop is always available on Live. Inputs survive a failure. Paused work resumes only when the person asks. |
| User control | Nothing is dismissed or deleted automatically. A finished review is not held for approval (§6). |
| Reduce memory load | Result fits the answer on one page. Recent checks are always in the sidebar. |
| Universal usability | Keyboard, zoom, reduced motion and plain language are supported on all three screens. |
| Shortcuts for frequent users | Shortcuts are added only after the visible path works, and never replace it. |

## 16. Review checklist and decision log

Before accepting a screen:

- [ ] A first-time user can say what the screen is for in one look.
- [ ] There is one primary action.
- [ ] The words match §3.
- [ ] Numbers count things that need attention, and there are at most three at the top.
- [ ] Every problem shows its evidence marks, and no mark appears without saved data behind it.
- [ ] Every moving element on Live is driven by a real event.
- [ ] Empty, loading, paused, stopped, failed and partial states are handled.
- [ ] Shared components and tokens are used; no one-off colours, sizes or timings.
- [ ] Keyboard, focus, live announcements and reduced motion work.
- [ ] It works at 1440 × 900, 1200 × 900 and a narrow width, and at 200% zoom.
- [ ] `pnpm --filter centinel build` and the relevant frontend tests pass.
- [ ] Styles do not leak into other screens.

Decision log (user-approved unless noted):

- 2026-11-21 (user request): Keep the Check card for single-mode runs and show counts only for the modes included (§4.4).

- 2026-11-21 (user request): Add a temporary development-only harness trace to evidence-backed conversation turns (§4.4).

- 2026-11-20 (user request): Keep code review independent of browser setup. Show approval for dependency setup in Ask first and Auto. Render frozen PDFs for the configured vision provider and present page coverage separately from code and browser findings.
- 2026-11-19 (user request): Show the check start time and mode on compact cards. Place the unchecked disclosure before Export and View in the shared action group.
- 2026-11-18 (user decisions): Keep composers on Project and Check, place compact check cards in the Project conversation, and expand them through View. Support @ checks and problems for explanations, suggested fixes and scoped checks/browser tests. Follow the harness contract's acceptance criteria before accepting the feature.
- 2026-11-18 (user request): Match the GitHub repository chooser across New Check, Project and Check. Keep the shared composer aligned to the response during transitions.
- 2026-11-18 (user request): Keep independent drafts for Project and each Check. Align user messages right at up to 60% width and give agent responses the full width.
- 2026-11-18 (user request): Keep the project name, Sources, history, and Run a full check above the scrolling conversation. Keep check cards to the name and counts, with a coverage disclosure, check report export, and View.
- 2026-11-18 (user request): Start the Project controls inside the conversation card and pin them on scroll. Animate the results panel in both directions with its contents. Remove the Settings breadcrumb and align the account details left and the provider action right.
- 2026-11-18 (user request): Use ORIN as the display name and retain the original logo, app icons, and palette.
- 2026-11-18 (user request): Use the aperture compass for the app logo and a focus-framed aperture for the New Check headline. Keep the existing theme palette.

- 2026-11-17 (user request): Share the Add actions and document drop area across New Check, Check and Project. When a saved project is selected, add documents immediately to its library and keep them attached to the draft. Other documents are uploaded when the check prepares its project. Open the Sources add menu to the right when space permits, with a below-trigger fallback on narrow screens.

- 2026-11-17 (user request): The configured agent assigns a short name from the project's check context. The history row shows the name alone. The Check page keeps references in its saved record and omits the reference strip. Show check progress in the sidebar and on Live. The legacy floating progress popup is reserved for standalone Reviews.

- 2026-11-17 (user request): Add a drop area for individual files and folder contents to Add Project, with file and folder pickers inside it. A picked repository folder registers a workspace. Dropped files and folder contents are added to the project library. The Sources add button opens Add documents and Add repository on hover or activation.

- 2026-11-17 (user request): Left-align setup notice text and place its settings button at the right, vertically centered. Use an opaque surface for the project Sources button and popover, white in Light appearance.

- 2026-11-17 (user request): Place searchable project check history beside Sources on Project and Check Details, add a direct project return on Check Details, and use softly blurred translucent popovers for search and sources.

- 2026-11-17 (user request): Project and Check Details share the source dropdown, response card and composer layout, and expandable results sidebar. Project opens in conversation when there is no check history and opens the sidebar when check history exists. Global search uses the @ menu ranking with up to eight checks and eight projects, links to Help and Settings sections, and leaves the surrounding page undimmed.

- 2026-11-17 (user request): Highlight the first @ action while keeping the prompt editable. Put Add first, rank up to five checks by problem count and up to five projects by last completed check, and tint counts by the highest known risk. Show setup notices above the composer, and align the detail composer to its response card.

- 2026-11-17 (user request): Put account controls directly in Settings, present checks and projects as compact rows, and let follow-ups attach same-project checks and library files through @.
- 2026-11-17 (user request): Use Local, GitHub and Link tabs for project sources, appearance radio cards in Settings, and reflected circular glow paths. Enter sends from compact check composers. Ctrl/Cmd+Enter sends from expanded composers.
- 2026-11-17 (user request): Keep recent-check references within their project. Library attachments on follow-up checks scope the code review to the selected files, alongside the review's requirements and standards. Browser-only follow-ups require removing library attachments or changing the mode.
- 2026-11-17 (user request): Show the permission choices on hover and expose the project library from the Check Details header and composer. The follow-up composer overlays the scrolling response and expands without resizing it.
- 2026-11-17 (user request): Share one glow across the Check Details header, content and sidebar. Keep the profile popup flat with a border.
- 2026-11-17 (user request): Put Help and Settings beside the compact profile, separate the scrolled recent lists from the fixed actions, and match the New Check and follow-up composer positions during navigation. Use the project-name source dropdown in check details.
- 2026-11-17 (user request): Make a recommendation replace the draft, remove recommendations from the + menu, and provide a device-local app-managed folder when no folder is registered.
- 2026-11-17 (user request): Animate the three glow colors independently, expand the composer on demand, cap recommendations by scenario, dock the composer when a check starts, and put check mode before Send in check details and project conversation.
- 2026-11-17 (user request): Fix Sample Shop in the fourth recommendation row, append prompts from translucent rows, add recent-list disclosures, and keep the title caret and background moving.
- 2026-11-17 (user request): Add Light, Dark and System appearance settings. Rank New Check recommendations by saved activity, remove pointer motion, and give the title more time to type before the recommendations appear below the composer.
- 2026-11-17 (user request): Type in the New Check title, then reveal the subtitle and actionable suggestions. Use background ripples and keep the composer focus glow. Make the workspace search input fill its dialog header.
- 2026-11-17 (user request): Make the New Check glow and points of light follow the pointer and gather at the composer border on focus.
- 2026-11-17 (user request): Let @ select a saved project from below the matching recent checks.
- 2026-11-17 (user request): Use New Check and Check, move project and mode into the composer footer, add recent-check references and @ filtering, and put Checks first in the keyboard-accessible search dialog.

- 2026-11-17 (user request): Pin New above the scrolling lists. Open project and check search from the header icon and move Settings and Help to Account.
- 2026-11-17 (user request): Use a borderless project row with an ellipsis on hover. Open the project details dialog from the ellipsis and keep editing available there.
- 2026-11-17 (user request): Replace the Projects page with Recent projects below Recent checks. Keep project editing on each row and project creation in the composer.
- 2026-11-16 (user request): Center the Home composer, put the mode at the upper left, use a fixed add-project action in the project dropdown, and switch Send to an up arrow while typing.
- 2026-11-16 (user request): Give the Home composer a larger Send button, a borderless Check mode selector with short options, and a text area with no outline on focus.
- 2026-11-16 (user request): Home is the check composer. Projects holds the directory and the add and edit actions. The standalone activity directories leave the sidebar, and check mode moves beside the add button as a dropdown.
- 2026-11-12: Replace the earlier guide with the three-screen design: Start, Live, Result.
- 2026-11-12: One Start runs both the code review and browser tests by default.
- 2026-11-12: Code-review problems are double-checked in the browser. A problem tested in the browser that does not show is not listed as a problem; its record is kept.
- 2026-11-12: Problems that a browser cannot show stay listed, grouped as **Found in code**. The UI describes evidence a problem has, never what it lacks.
- 2026-11-12: Requirements are reported as the number not met, not as "N of M met".
- 2026-11-12: Motion that shows real work is allowed on Live; decorative effects remain banned.
- 2026-11-12: Start follows Gamma's home layout as the reference: centred headline, one large rounded check input with add and start buttons, mode chips below, and a single-level sidebar with recent checks. Not copied: the two-level sidebar, the templates row and Gamma's brand elements.
- 2026-11-12: Visual style is **Aurora**, chosen from five full-size explorations after the user rejected the Stone and Forest green look and an interim black and white option: off-white canvas, dark ink actions, one blue, pink and orange glow, Onest as the interface face.
- 2026-11-12: No dark area. Live browser tiles are light browser windows on a translucent stage.
- 2026-11-12: Evidence marks, risk words and Live statuses are an icon plus a word, with no filled background. Blue is reserved for the browser.
- 2026-11-12: Use icons generously, always with their word, with fixed meanings.
- 2026-11-12: Icons are 1.2 times their text, centred on the text's optical midline; flat-based icons sit on the baseline; an icon follows its text.
- 2026-11-12: Spacing uses only the scale 4 to 64, chosen by how closely two things are related; inner spacing never exceeds outer spacing.
- 2026-11-12: Text of different sizes on one line shares a baseline.
- 2026-11-12: Each problem on Result shows one risk word with its icon.
- 2026-11-14 (user choice over a full timeline): results stay out of the conversation. The side panel (no title) opens with Latest check: verdict, three numbers (Browser, Code, Not met), the top three problems, Download report and Open the full result, then each requirement as met, not met or not checked. It reads the latest code review and latest full Auto test from the service (`check/latestResult.ts`), so every device and member sees the same. Details live in the downloadable report.
- 2026-11-14 (user request, Codex as reference): in the project conversation ORIN speaks in plain text, not bubbles. Each reply shows only the result by default; a collapsed "Worked for …" line opens the opening message and high-level activity lines ("Read the project, started the app, looked at 1 page and wrote 1 test", "Tested … in the browser"), and each line opens its detailed rows. While running the work is open, with a timer and a small live window. The result is written from the saved verdict; no AI explanation. Actions sit below the reply, outside it, as icon-only buttons with tooltips and accessible names: Replay (play), Run again (rotate), Save for every check (bookmark), Change it (pencil). This is an approved exception to the rule that icons never replace labels.
- 2026-11-14 (after the team redesigned the code review page): the Live screen names the file of the batch the Review reports starting, and the phase it saved (Reading the documents, Reading the code, Checking settings and other files); the counter reads "parts reviewed" because document batches now count. Result problem titles use the review page's short title. The review page's five issue categories are not shown on Result yet.
- 2026-11-14 (user request): the project side panel collapses to the latest check only and expands, with a width animation, to show everything about the project (§4.4). This supersedes the earlier layout where the panel always listed the top three problems, requirements and sources. Motion tokens from §9 are now declared in `tokens.css`.
- 2026-11-14 (user correction): "expand" means the panel covers the whole conversation area, not a wider column. Collapsed it keeps about its earlier width and shows the latest check with its problems; the toggle uses the user-chosen two-corner glyph (`components/cornerIcons.ts`). Supersedes the 460 px two-column expansion of the same day.
- 2026-11-17 (user decision): the new screens' text sizes and weights follow the type scale (§9).
- 2026-11-17 (user decision): the expanded panel drops the verdict, the three numbers and the coverage card; the right column's risk counts and requirements already say it. The collapsed panel keeps its verdict and numbers. Then (same day): the review state (Completed, Completed with gaps, …) sits beside the project name in the panel title, and the Critical/High/Medium/Low counts take the top of the expanded panel; the right column keeps review details, requirements, sources and the rest.
- 2026-11-16 (user decisions, later the same day): cited code lines in the panel are one yellow for every risk. Review coverage becomes behavior rows with problem counts and a filter. (Later, 17 November, the coverage card was removed again.) The sidebar history and retiring the Result page were built the same day but dropped on 17 November in favour of the teammate's check page and sidebar. Risk labels in the panel's right column keep their colours.
- 2026-11-16 (user decisions): no detail pages in the project panel (the teammate's sidebar, which also drops Details, was kept on 17 November). A finished review is shown as Completed with no approval step (no decision is recorded for anyone); problems are resolved by the AI's source comparison, not by hand. The expanded panel gains Retry the code review / Run a full check, source management and requirement editing; requirements come only from documents. Run it again on a browser problem puts the test in the conversation's message box for the person to send. The older screens' code stays until nothing links to it; project rename, delete and collaborators are not yet moved.
- 2026-11-16 (user request, teammate's Review page as reference): the expanded project panel carries the Review page's information (summary, coverage, issues by category, state, risk, review details) with the browser's proof, and each problem starts as a title row that opens to its code detail. Approval and feedback stay on the Review page. Demo kept at `docs/design/explorations/expanded-panel-demo.html`.
- 2026-11-13: Projects become a conversation with ORIN (§4.4). Browser tests are added, run and changed by message, with cards instead of forms. ORIN starts the app itself; no address field.
- 2026-11-13: Three permission modes per project: Ask first, Auto (default) and Bypass. Bypass stays on until the person changes it. Deletion always asks.
- 2026-11-13: The AI may fill test accounts from project files, accounts it registers locally, or accounts typed in the conversation; only on local addresses.
- 2026-11-13: The three screens and the sidebar are built on the existing Review and Auto test services. Checks are a device-local index; results are always read from the saved records.
- 2026-11-18 (user request): A full check adds fixed Smoke, Exploratory, Usability and Unit tests. Browser test lists label each fixed test with a quiet outlined tag beside its name (text, not colour). Failed smoke, exploratory and usability tests are Browser problems. The project's own unit test results sit in their own Unit tests block (one summary line plus up to ten failing tests). They are never listed as Code or Browser problems and do not count towards the risk counts.
- 2026-11-19 (user request): A browser problem shows its steps under "Steps in the browser", in the Result and in the expanded project panel. Each step is a numbered plain sentence, with typed text given only as a length. The page is shown only when it changes, and each step has an optional screenshot that loads when opened. The step where the test stopped has a ✕ and the words "Stopped here" with its reason. A test whose steps all ran but whose check failed ends with "Checked the page: not as expected" and "Failed here". Stuck browser tests under Not checked open to the same steps. On the Live screen, finished tests in the test list open to their steps. Marks use the soft danger tint and words, never colour alone. Redesigned the same day at the user's request:
- 2026-11-19 (user request): There is no separate Not checked section; each gap is shown with the part it belongs to.
  - Code gaps (skipped files, parts the review could not verify) appear as short lines under Found in code.
  - Browser tests that could not finish form their own group. Each row is marked "Could not finish", with its reason and steps.
  - Unit tests that could not run say why in the Unit tests block. A project with no unit tests is not a gap.
  - The general method notes fold into a collapsed "How this was tested".
  - Opening a project shows check summaries only. A card's View and the panel's "Open the full result" expand the side panel on that check. The panel's Checks list does the same, so details stay in the panel instead of another page.
  - A check's own page remains reachable from the app sidebar's Checks list.
  - A summary line opens the timeline, for example "5 steps · stopped at step 5".
  - Steps are numbered circles on a thin rail, one line each, with the page as a small muted chip. A quiet image button sits at the right.
  - The stopped step and a failed check sit in a soft danger card with a "Stopped here" or "Failed here" tag.
  - Screenshots, including the problem's Screenshot button, open in place in a viewer. It covers the window, steps through the run with ‹ › or the arrow keys, and ends on the page the check saw. It never navigates to another page.
- 2026-11-24 (user decision): Keep recent conversation context and explicit **Reply to**. Check card **View** focuses the project side panel, which offers a separate action to open the dedicated Check screen. Conversation answers and evidence stay in the chat.
