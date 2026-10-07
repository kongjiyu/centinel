# Centinel

AI-based software quality assurance platform for FYP. Two modules:

- **Centinel Static** — artifact review, requirement-to-code validation, inconsistency detection
- **Centinel Dynamic** — autonomous UI interaction, vision-based exploration, end-to-end workflow validation

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri |
| Frontend | React + TypeScript + Vite |
| Static data and private artifacts | Supabase Postgres + Storage, scoped by the signed-in user's bearer token and RLS |
| Model Provider | Configured in Settings; Static Review uses its primary/fallback chain |
| Legacy/Dynamic local data | `sql.js` SQLite (not a Static Review fallback) |
| Browser engine | Playwright |
| Sidecar | Node.js + tsx |

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS

## Quick Setup

```bash
# 1. Clone the repo
git clone https://github.com/Cstan0824/centinel.git
cd centinel

# 2. Install all dependencies (root + workspaces)
pnpm install

# 3. Copy the environment template and configure required services
cp .env.example .env
```

Edit `.env` with your Supabase and connector configuration. Follow
[`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md) for project keys, Auth
redirects, migrations, and Storage setup. GitHub sign-in and Google sign-in
are configured in Supabase Auth; repository access, Google Drive, and Slack
use separate OAuth clients and the callback URLs listed in `.env.example`.
Model-provider credentials, endpoints, and model names are configured inside
the app under **Settings > Model Provider** and do not belong in `.env`.
Never place a Supabase service-role key in a `VITE_*` variable or the desktop
runtime; it is only for approved admin/migration tooling.

## Running the App

```bash
# Start everything (sidecar server + Tauri desktop app)
pnpm dev

# Run local runtime smoke checks. Model Providers are tested from Settings.
pnpm smoke

# Production build
pnpm build
```

## Codex Model Provider

Settings → Model Provider → **Codex with ChatGPT** connects a local Codex CLI
using browser sign-in. Select a model separately for Review and Dynamic testing;
Dynamic requires screenshot support. API providers remain available and source
indexing still uses its own embedding API. See [Codex setup and boundaries](docs/CODEX_PROVIDER.md).

## Checks

```bash
pnpm --filter @centinel/sidecar playwright:smoke   # Playwright
pnpm --filter @centinel/sidecar sqlite:smoke       # Dynamic/legacy local store
pnpm --filter @centinel/sidecar test               # Sidecar tests
pnpm --filter centinel test                        # Frontend tests
pnpm --filter centinel build                       # Frontend TypeScript + Vite build
```

## Project Structure

```
centinel/
├── package.json           # Root workspace (pnpm dev, pnpm smoke, pnpm build)
├── pnpm-workspace.yaml    # Workspace config
├── centinel/              # Tauri + React desktop app
│   ├── src/               # React frontend (TypeScript)
│   └── src-tauri/         # Tauri backend (Rust)
├── sidecar/               # Node.js sidecar service
│   └── src/               # Review, reports, integrations, Playwright, Supabase adapters
├── docs/                  # PRD, setup, current feature specs and acceptance audits
└── .env.example           # Runtime configuration template (no Model Provider keys)
```

## Development Roadmap

See the [current development plan](docs/DEVELOPMENT_PLAN.md) for sequencing,
ownership, acceptance gates and PRD requirement coverage. Product scope remains
[in the revised PRD](docs/Centinel_PRD_Revised.md).

## Module Ownership

| Module | Owner |
|---|---|
| Centinel Static | Static Testing Owner (artifact review, traceability, static reports) |
| Centinel Dynamic | Dynamic Testing Owner (Playwright, runtime testing, bug reports) |
| Shared platform | Both (project shell, data model, unified reporting) |

## License

FYP project — not licensed for public distribution.
