# Centinel

**A quality check for apps you built with AI.** Centinel reads your code, compares it with what your app is supposed to do, then opens your website in a real browser to check that it works. You get a plain-language report that says what is wrong, why it matters and how to fix it.

<p align="center">
  <img src="docs/screenshots/report-summary-1.png" alt="Page 1 of a Centinel quality report: a red 'Fix before release' verdict, key numbers, an open-issues-by-risk chart and what Centinel checked" width="720">
</p>

Centinel has two parts:

| | What it does | Good for |
| --- | --- | --- |
| **Review** | Reads your source code and requirements without running the app. Finds security, business-rule and technical problems and points to the exact file and line. | Catching bugs an AI assistant introduced before anyone uses the app. |
| **Dynamic Testing** | Opens your website in a real Chromium browser, follows a goal you write in plain English and checks the result independently. Saves screenshots and every step. | Proving the app actually works, not just that the code looks right. |

Both feed one **quality report** (PDF, Markdown or JSON). The first part is written for anyone; the second part keeps the full technical detail for developers.

---

## Contents

- [Download and install](#download-and-install)
- [Try it in 10 minutes with the Sample Shop](#try-it-in-10-minutes-with-the-sample-shop)
- [The quality report](#the-quality-report)
- [Requirements and limits](#requirements-and-limits)
- [Run from source](#run-from-source)
- [Project structure](#project-structure)

---

## Download and install

> Centinel 0.1.0 is an early release for **macOS on Apple Silicon** (M1 or newer).

1. Download `Centinel_0.1.0_aarch64.dmg` from the [Releases page](https://github.com/kongjiyu/centinel/releases).
2. Open the DMG and drag **Centinel** into **Applications**.
3. The app is not signed by Apple yet, so the first time you open it, **right-click Centinel → Open → Open**. After that it opens normally.

On first launch Centinel starts its local service in the background and downloads the Chromium browser it uses for Dynamic Testing (a few hundred MB, once). Your local files stay in `~/Library/Application Support/com.centinel.app`.

### What you also need

- **A Centinel account.** Sign up inside the app with email, Google or GitHub.
- **An AI model.** The easiest option is **Codex with ChatGPT**: install the [Codex CLI](https://github.com/openai/codex) (`brew install --cask codex` or `npm install -g @openai/codex`), then in Centinel go to **Settings → Model Provider → Connect Codex** and sign in with your ChatGPT account. No API key needed. You can also use any OpenAI-compatible API key instead.
- **An internet connection** for sign-in, saving projects and the AI model.

---

## Try it in 10 minutes with the Sample Shop

This repository includes [`examples/sample-shop`](examples/sample-shop), a tiny web shop with sign-in, products and checkout, plus a [requirements document](examples/sample-shop/docs/requirements.md). It has **three bugs planted on purpose**, so you can see what Centinel finds.

<p align="center"><img src="docs/screenshots/sample-shop.jpg" alt="The Sample Shop: a product list with Add to cart buttons, a sign-in form and a cart" width="640"></p>

### 1. Start the Sample Shop

You need [Node.js](https://nodejs.org/) 18 or newer. There is nothing to install:

```bash
git clone https://github.com/kongjiyu/centinel.git
cd centinel/examples/sample-shop
node server.js
```

Open <http://localhost:4100> to check it is running. Leave this terminal open.

### 2. Sign in to Centinel

Open Centinel and create an account, or sign in with Google or GitHub.

<p align="center"><img src="docs/screenshots/sign-in.jpg" alt="Centinel sign-in screen with Google, GitHub and email options" width="640"></p>

Then open **Settings → Model Provider**, click **Connect Codex**, sign in with ChatGPT and choose a model under **Review model** and **Dynamic testing model** (for example `GPT-5.6-Sol`).

### 3. Create a project

1. Go to **Projects → New project**.
2. Name it `Sample Shop`.
3. Under **Local repository**, click **Choose repository** and select the `examples/sample-shop` folder.
4. Click **Create project**. Centinel imports the files, including the requirements document.

### 4. Run a code Review

1. Click **Review** in the sidebar.
2. Name it `Pre-release review`, pick the **Sample Shop** project, and under **What should this Review verify?** write:
   > Check that sign-in, checkout and order viewing follow docs/requirements.md, especially privacy and server-side validation.
3. Click **Start review**. A small project like this takes a few minutes.

When it finishes, open the **Findings** tab. Centinel should flag the three planted problems:

| Requirement | What Centinel should find |
| --- | --- |
| REQ-1 Sign-in | The error message reveals which emails have accounts. |
| REQ-3 Checkout | The server accepts negative quantities, so totals can go negative. |
| REQ-4 Order privacy | Any signed-in user can open someone else's order and address. |

Each finding shows the file and line, why it matters, and a suggested fix. Approve the Review or request changes once you have looked at the evidence.

### 5. Run a Dynamic Test in a real browser

1. Click **Dynamic Testing** and pick the **Sample Shop** project.
2. Fill in **New test**:
   - **Test name:** `Sign-in page shows the login form`
   - **Website address:** `http://localhost:4100`
   - **Test goal:** `Open the shop and confirm that the sign-in form and the product list are shown. Do not sign in.`
   - **Acceptance check:** Visible text → `Sign in` (required)
3. Click **Save test**, then **Run saved test**.

Centinel opens Chromium, follows the goal, then checks the result independently of the AI:

<p align="center"><img src="docs/screenshots/dynamic-test-passed.jpg" alt="A Dynamic Testing run marked Passed: the independent check 'Expected visible text: Sign in' passed" width="640"></p>

Open **Evidence · screenshots and action trace** to see every step the browser took.

> Tip: to test signed-in flows, add the demo account (`demo@example.com` / `demo-password-123`) under **Manage environments and local values**. Centinel keeps these values on your Mac and never sends them to the AI as text.

### 6. Export the report

Open the project, click **Action → Export report**, then **Download PDF**.

---

## The quality report

Every report has two parts.

**Part 1 · Summary** is for anyone, including non-technical teammates. It starts with a verdict (*Fix before release*, *Needs attention*, *Looking good* or *Not checked yet*), shows the key numbers and a chart of open issues by risk, lists up to three next steps, and explains the top issues in plain language.

<p align="center">
  <img src="docs/screenshots/report-summary-1.png" alt="Report summary page with verdict, numbers and risk chart" width="380">
  <img src="docs/screenshots/report-summary-2.png" alt="Report page with next steps and the top issues explained" width="380">
</p>

**Part 2 · Technical details** keeps the complete record for developers and auditors: IDs, versions, timestamps, every finding with evidence, the files that were reviewed, requirement coverage, browser-test steps and AI usage.

*The pages above are an illustrative example built from the Sample Shop's planted problems. Download the full [example report (PDF)](docs/screenshots/example-report.pdf).*

Risk levels mean:

| Level | Meaning |
| --- | --- |
| Critical | Could cause a security breach, data loss or a broken core feature. Fix before release. |
| High | Likely to break an important feature or expose data. Fix before release. |
| Medium | Causes problems in some situations. Plan a fix soon. |
| Low | Minor issue or clean-up. Fix when convenient. |

---

## Requirements and limits

- **Platform:** the 0.1.0 installer is macOS on Apple Silicon only. Other platforms can run from source.
- **AI model:** Review and Dynamic Testing need a configured model. Centinel stops instead of guessing when the provider is out of quota.
- **Honest results:** if Centinel cannot verify part of the code, it says so rather than reporting a clean result. Very large repositories can take a long time and may end as *Failed* when some sections cannot be verified; the checks that did finish are still shown. Start with a focused project.
- **What Review does not prove:** it reads code; it does not run every path. Pair it with Dynamic Testing for behaviour that matters.
- **Integrations:** GitHub repository import, Google Drive and Slack need OAuth apps configured by whoever builds Centinel; they are optional.

---

## Run from source

For contributors. You need [Node.js](https://nodejs.org/) 20+, [pnpm](https://pnpm.io/) 10, [Rust](https://www.rust-lang.org/tools/install) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
git clone https://github.com/kongjiyu/centinel.git
cd centinel
pnpm install
cp .env.example .env   # add your Supabase URL and publishable key
pnpm dev               # local service + desktop app with hot reload
```

Set up Supabase (Auth redirects, migrations and Storage) with [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md). Never put a Supabase service-role key in `.env` for the desktop app.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Starts the local service on port 37701 and the desktop app. |
| `pnpm --filter centinel test` | Frontend tests. |
| `pnpm --filter @centinel/sidecar test` | Local service tests. |
| `pnpm --filter centinel build` | Type-checks and builds the frontend. |
| `pnpm build` | Bundles the local service and Node.js runtime, then builds the desktop app. |

`pnpm build` runs [`scripts/bundle-sidecar.mjs`](scripts/bundle-sidecar.mjs), which compiles the local service, installs its production dependencies and copies the Node.js runtime into the app. Only the public Supabase URL and publishable key are bundled; each installation creates its own encryption key on first launch.

---

## Project structure

```
centinel/
├── centinel/            Desktop app: React + TypeScript (src/) and Tauri shell (src-tauri/)
├── sidecar/             Local service: Review, Dynamic Testing (Playwright), reports, integrations
├── examples/
│   └── sample-shop/     Practice app with planted bugs for trying Centinel
├── scripts/             Development launcher and packaging scripts
└── docs/                Product requirements, setup guides and module specifications
```

Product scope is in the [revised PRD](docs/Centinel_PRD_Revised.md); design rules are in [DESIGN.md](DESIGN.md).

## License

Final-year project. Not licensed for redistribution.
