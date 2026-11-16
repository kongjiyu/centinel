# Centinel Design System

> Status: authoritative for all user-facing Centinel interfaces
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

Centinel should feel like the apps people already use to hand work to an AI: you give it something, you watch it work, you get the answer.

A person does three things:

1. **Give** Centinel the project folder (or a GitHub link) and any documents.
2. **Watch** Centinel check it, live.
3. **Read** one page that says what is wrong, where, and how Centinel knows.

Everything else is detail, and detail is opt-in.

The test for every screen: a person who has never seen Centinel understands it in one look, without reading instructions.

## 2. Principles

1. **One thing per screen.** Each screen has one job and one primary action.
2. **Answer first.** Lead with the result in one sentence. Proof comes next. Technical detail is behind a click.
3. **Show the work, for real.** Progress is shown by what Centinel is actually doing: the file it is reading, the button it is clicking. Never by decoration.
4. **Say what was proven.** Every problem shows what evidence it has. Describe evidence that exists; do not label a problem by what it lacks.
5. **Count problems, not successes.** Numbers say how many things need attention. The reader never has to subtract.
6. **Plain words.** Write for someone who is not a tester. No internal names.
7. **Real data only.** Never invent a metric, a status, an activity line or a success.
8. **People decide.** AI output is evidence. Approvals, dismissals and destructive actions stay human actions.

## 3. Words

Use these words in UI copy, navigation, documentation and accessibility labels.

| Concept | Word to use | Meaning |
|---|---|---|
| One start-to-result run | **Check** | Everything Centinel did after one press of Start |
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
- Sentence case everywhere. No all-caps labels.
- Do not use "QA node", "analysis channel", "agent thought", "autonomous validation" or similar internal terms.

Status words, in sentence case: Not started, Queued, In progress, Paused, Completed, Needs attention, Failed, Stopped. Backend statuses map to these in one shared mapper.

## 4. The three screens

### 4.1 Start

**Job:** take the project and begin.

The layout follows the familiar AI-app start page (the user chose Gamma's home as the reference): a centred headline over one large input, with quick choices below it.

Top to bottom, in one centred column:

1. **The headline** "What should Centinel check?" and one supporting line. The glow (§7) sits behind and below this column.
2. **The check input**, at most 600 px wide, with the hero radius and the one raised shadow (§8):
   - **Attached items** on the first line, as removable pill chips. The project chip (a folder or a GitHub repository) is dark ink with white text and a folder icon; document chips are light with a file icon.
   - **A text area** for an optional focus ("check that sign-in and checkout follow the requirements"). It maps to the existing Review goal.
   - **An add button** (a round "+", bottom left) that opens: Choose a folder, Paste a GitHub link, Add documents.
   - **A start button** (a round filled arrow, bottom right) with the accessible name **Start check**. It is the screen's one primary action.
3. **Mode chips** under the input, one selected at a time (the selected chip is dark ink with white text, the others are white with a border; each has its icon): **Code and browser** (default), **Code only**, **Browser only**.
4. **Try the Sample Shop**, a single quiet link with a cart icon for someone with no project at hand. It attaches the bundled example project.

Recent checks are in the sidebar (§6), not on this screen.

Rules:

- The project is required; text is optional. The input must never look like a plain chat box:
  - with nothing attached, the placeholder says "Drop your project folder here, or paste a GitHub link";
  - once a project is attached, the placeholder changes to the optional-focus example;
  - the start button stays visible, and until a project is attached it explains what is missing instead of starting.
- The whole input accepts a dropped folder or files, and a pasted GitHub link becomes a project chip. Every one of these also works through the add button and the keyboard.
- No project form. Centinel creates the project from the folder, or reuses the existing project for that folder.
- No environment, permission, model or scope settings on this screen. Sensible defaults apply; settings live under Details and Settings.
- If something required is missing (for example no AI provider is connected), show the one missing step in place, with one action. Do not send the person to another screen and back.
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

Rules:

- Problems appear while the check runs. A long code review must never leave the screen unchanged for minutes; the current file line and elapsed time always move.
- If only one kind of check runs, its column takes the full width.
- If the app cannot be started, the browser column says so in one sentence with the reason. The code review continues.
- A pause (for example the AI provider's limit) replaces the stage highlight with **Paused**, one sentence of explanation, and **Resume**. Nothing resumes by itself.
- Leaving the screen does not stop the check. A compact progress item stays in the sidebar and returns here.
- When the check ends, the screen moves to Result by itself. If the person is elsewhere, show one toast.
- Typing is shown as dots with a length only; the text typed is never displayed.

### 4.3 Result

**Job:** say what is wrong, where, and how Centinel knows.

Layout, top to bottom:

1. **Context line:** a folder icon and the project name, a clock icon and how long the check took. **Export report** sits at the right of this block.
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

Never write that the project is "safe", "secure" or "ready". Centinel reports what it checked.

Numbers:

- Numbers count things that need attention. Write **Requirements not met: 2** with "of 6" in supporting text. Do not write "4 of 6 met".
- When every requirement is met, write "All 6 requirements met" instead of a zero.
- Show **Not checked** for requirements only when the count is above zero. A requirement that was not checked is never counted as met.
- When no requirements were provided, say "No requirements provided" instead of a number.

### 4.4 Project conversation

**Job:** let a person test and change a project by talking to Centinel, instead of filling in forms.

Opening a project shows a conversation with Centinel, not tabs of settings. The user approved this direction on 13 November 2026.

Layout:

1. **Header:** the project name and **Run a full check** (starts a check as on Start).
2. **The conversation**, newest at the bottom. It opens with one sentence about the latest check.
3. **The message input** at the bottom, styled like the check input on Start, with the permission mode beside it (§4.5).
4. **A side panel** (no title; accessible name "What Centinel knows"). Collapsed (the default) it is a 280 px column with the latest check only: the problem count, how many were proven in the browser, the Browser, Code and Not met numbers, every problem with its risk icon, and Open the full result. A two-corner button at its top right (corners out; corners in to return) expands it over the whole conversation area, titled with the project name, in three columns: the latest check; requirements and the latest full check's browser tests; sources, saved browser tests with their last result, how the app is tested, past checks, Download report and Details. Expanding grows the panel from its column in 220 ms with the standard easing while the conversation fades out; the added columns fade in once after 180 ms; reduced motion switches instantly. While expanded the conversation cannot be reached; the button or Esc returns to it. Whether it is open is kept per project on this device. Below 960 px the panel sits above the conversation at full width and expands to replace it. It is read-only. To change something, say it.

What a message can do (step 1: browser tests):

- **Add a test.** "Test that coupon SAVE10 lowers the cart total." Centinel starts the app if needed, explores it, writes the test and shows a **test card**: its name, plain-language steps, and "Passes only if the page shows …". The card offers **Run now**, **Save for every check** and **Change it**.
- **Run a test.** The live browser tile from Live (§4.2) plays inside the conversation, then the result appears in place: expected, what the page showed, the AI explanation (labelled), **Screenshot** and **Replay**.
- **Change a test.** "Also check that an expired coupon shows an error." Centinel answers with a **change card** that lists added lines in green and removed lines in red, and says where any test value came from.
- **Give test data.** "Use admin@test.com / test123." The values are kept as this project's test data.

Rules:

- Centinel starts the app itself, with the same fixed recipe table as Auto test. There is no address field. If the app cannot be started, the conversation says why in one sentence (no folder on this computer, several apps in one folder, a database or Docker is needed). Testing a deployed address needs the person to name it, and opening a non-local address needs their confirmation.
- The model can only use Centinel's existing actions: write, run or change a test, add a source, record test data. It never writes commands to execute.
- Pass and fail still come only from independent checks on the page.
- Test accounts may be filled by the AI: those in the project's seed, fixture or demo files, those it registers on the local app, and those the person types in the conversation. They are used only on local addresses, only in this project. The first time a person types an account, Centinel adds one line: "The AI will see this account. Use test accounts only."
- Every action that ran without asking leaves a **Done** card with **Undo**.
- The conversation is saved with the project. Older project tabs stay reachable under Details.
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

Centinel double-checks. A problem the code review finds is handed to a browser test, which tries to show the same problem on the running app.

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
- One sidebar, one level. In order: **New check** (opens Start), **Search**, the list of **recent checks**, and **Settings** at the bottom. It collapses.
- Do not add a second navigation column or an icon rail beside it. Centinel has few destinations; everything else is under Details.
- Each recent check shows the project name and, 4 px below it, its result in a few words with an icon (a warning triangle and "5 problems" in red; a check and "No problems"). Records are separated by more space than a name and its result.
- A running check appears at the top of the recent list with a live state and returns to Live.
- Opening a past check opens its Result.

### Details

Details is the door to the full record and to the older screens: Requirements and traceability, Activity, Sources, Usage, Reports, project settings, collaborators, approvals, and manual Review or Dynamic testing setup.

- The three main screens never require Details to understand the result.
- Details opens in the context of the current check or project and offers a clear way back.
- Approvals and per-problem decisions keep their existing behaviour. Result does not claim that a check is approved.

## 7. Visual direction

The style is **Aurora**: a bright, calm page with one soft glow of colour. The user chose it on 12 November 2026 from five full-size explorations. The reference build is [`docs/design/explorations/styles.html`](docs/design/explorations/styles.html) (style 1); when this document and that page disagree, this document wins.

- **Light and warm.** An off-white canvas, white surfaces and dark ink text. Generous space around the one thing that matters on each screen.
- **One glow.** A large, blurred wash of blue, pink and orange sits behind the content at the top of the page. It is atmosphere, not decoration on components: nothing else in the app has a gradient.
- **Soft shapes.** A large rounded check input, pill buttons and chips, and rounded cards, so Centinel feels like an everyday AI app, not an admin console.
- **Ink for actions.** The primary action and the selected state are dark ink with white text.
- **Two colours carry meaning.** Blue means the browser. The risk level runs red, orange, yellow-brown, grey.
- **Light everywhere.** The live browser tiles look like real browser windows on a light, translucent stage. There is no dark area in the app.
- **Icons with words.** Every action, label, step and number has an icon beside its word (§8, Icons).
- **The technical face** for file names, paths and addresses.

Do not use:

- radar, scan lines, telemetry grids, crosshairs or "system online" graphics;
- neon glows, gradient text, or gradients on buttons, cards, chips or icons;
- a second glow, or the glow in colours other than its three;
- dark panels or a dark theme;
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
| Start screen | Built: `screens/check/StartScreen.tsx`. Folder by the add menu or a pasted path; documents by drop or the add menu; GitHub link by paste or the add menu |
| Live screen | Built: `screens/check/CheckScreen.tsx`. Code column reads the Review's saved progress and validated live titles; browser column reuses the Auto test live stream |
| Result screen | Built: same file. Two groups, three numbers, one risk word with its icon, open-in-place evidence |
| Sidebar: New check, Search, recent checks, Details | Built. Recent checks are stored on this device only (`check/store.ts`); they hold IDs and outcomes, never findings or source |
| Code and Browser marks | Built. Browser problems are failed Auto test runs; code problems are open Review findings |
| Handing code-review problems to browser tests | Not built. No problem carries both marks yet |
| Dropping a folder onto the check input | Not possible in the desktop window: native file drop is off, so a dropped folder has no path. The input says to use the add menu instead |
| Migrating older screens to Aurora layouts | Not done. They keep their layouts under Details, in the new colours |
| Project conversation, step 1: add, run, change and save browser tests by message (§4.4) | Built: `screens/project/ProjectConversationScreen.tsx`. Opening a project shows it; the older tabs are under its Details link |
| Permission modes (§4.5) | Built for step 1. Ask first confirms before running; Auto and Bypass run at once. Saving a test shows Undo. Mode, saved tests and notes are stored on this device (`check/projectPrefs.ts`) |
| Latest check in the project side panel, with Download report | Built. Collapsed shows the latest check and its problems; expanding covers the conversation with the whole project (§4.4). The report includes the latest full browser check (each test, its checks and what the page showed) |
| Saved tests in every check | Built: tests saved in the conversation run alongside newly planned tests in each full check |
| Conversation steps 2 and 3: settings by message (address, permissions), questions about results, deleting by message | Not built. A question gets a plain reply only when the AI cannot write a browser test for it |
| Code review page under Details (redesigned 14 November by the team: issues in five categories, coverage table, live issues, per-issue feedback) | Kept under Details on the legacy guide. The Live screen reads the same run events (`review_assessment_batch_started` file and `assessmentPhase`), and Result titles use the same short title (`shortReviewIssueTitle`), so the two pages name the current file and each problem alike |

Migration rules:

1. Build the three screens on top of the existing services. Do not change stored data to fit the screens.
2. Older screens stay reachable under Details and follow the legacy guide until they migrate or are retired.
3. Do not show a mark, group or number from §4 or §5 until the data behind it exists. Until browser proof is built, problems are shown as **Found in code** only.
4. A migration is not complete while the same concept has two competing presentations on the main screens.
5. Any intentional deviation from this document needs the user's approval and a line in §16.

## 15. Norman and Shneiderman rules

| Rule | Centinel requirement |
|---|---|
| Visibility and informative feedback | Live shows the current stage, the current file, the current browser action and elapsed time, all from real events. |
| Match and natural mapping | A problem and the browser proving it share a number and a colour. Evidence sits inside the problem it supports. |
| Signifiers and affordances | The check input says what to drop and has an add button for the same actions. Rows that open have a visible disclosure control. |
| Constraints and error prevention | Until a project is attached, the start button explains what is missing instead of starting. Missing setup is shown as one step in place. |
| Conceptual model | A check has two kinds of evidence, code and browser, and every problem shows which it has. |
| Consistency | One word per concept (§3) and one shared component per pattern (§10). |
| Closure | Every check ends on Result with a one-sentence verdict. |
| Reversal and recovery | Stop is always available on Live. Inputs survive a failure. Paused work resumes only when the person asks. |
| User control | Nothing is approved, dismissed or deleted automatically. |
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
- 2026-11-14 (user request, Codex as reference): in the project conversation Centinel speaks in plain text, not bubbles. Each reply shows only the result by default; a collapsed "Worked for …" line opens the opening message and high-level activity lines ("Read the project, started the app, looked at 1 page and wrote 1 test", "Tested … in the browser"), and each line opens its detailed rows. While running the work is open, with a timer and a small live window. The result is written from the saved verdict; no AI explanation. Actions sit below the reply, outside it, as icon-only buttons with tooltips and accessible names: Replay (play), Run again (rotate), Save for every check (bookmark), Change it (pencil). This is an approved exception to the rule that icons never replace labels.
- 2026-11-14 (after the team redesigned the code review page): the Live screen names the file of the batch the Review reports starting, and the phase it saved (Reading the documents, Reading the code, Checking settings and other files); the counter reads "parts reviewed" because document batches now count. Result problem titles use the review page's short title. The review page's five issue categories are not shown on Result yet.
- 2026-11-14 (user request): the project side panel collapses to the latest check only and expands, with a width animation, to show everything about the project (§4.4). This supersedes the earlier layout where the panel always listed the top three problems, requirements and sources. Motion tokens from §9 are now declared in `tokens.css`.
- 2026-11-14 (user correction): "expand" means the panel covers the whole conversation area, not a wider column. Collapsed it keeps about its earlier width and shows the latest check with its problems; the toggle uses the user-chosen two-corner glyph (`components/cornerIcons.ts`). Supersedes the 460 px two-column expansion of the same day.
- 2026-11-13: Projects become a conversation with Centinel (§4.4). Browser tests are added, run and changed by message, with cards instead of forms. Centinel starts the app itself; no address field.
- 2026-11-13: Three permission modes per project: Ask first, Auto (default) and Bypass. Bypass stays on until the person changes it. Deletion always asks.
- 2026-11-13: The AI may fill test accounts from project files, accounts it registers locally, or accounts typed in the conversation; only on local addresses.
- 2026-11-13: The three screens and the sidebar are built on the existing Review and Auto test services. Checks are a device-local index; results are always read from the saved records.
