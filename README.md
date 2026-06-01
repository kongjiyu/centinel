# Centinel

AI-based software quality assurance platform for FYP. Two modules:

- **Centinel Static** — artifact review, requirement-to-code validation, inconsistency detection
- **Centinel Dynamic** — autonomous UI interaction, vision-based exploration, end-to-end workflow validation

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri |
| Frontend | React + TypeScript + Vite |
| Local DB | SQLite |
| Static AI | MiMo API (text-based artifact review) |
| Dynamic AI | Gemini (multimodal screenshot reasoning) |
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

# 2. Install desktop app dependencies
cd centinel
pnpm install
cd ..

# 3. Install sidecar dependencies
cd sidecar
pnpm install
cd ..

# 4. Copy environment template and fill in your API keys
cp .env.example .env
```

Edit `.env` with your API keys:

```
MIMO_API_KEY=your-mimo-api-key
MIMO_BASE_URL=https://api.xiaomimimo.com/anthropic/v1/messages
MIMO_MODEL=mimo-v2.5-pro

GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash
```

## Running the App

```bash
# Start the Tauri desktop app (dev mode)
cd centinel
pnpm tauri dev
```

## Sidecar Smoke Tests

The sidecar has standalone smoke tests to validate each integration:

```bash
cd sidecar

# CLI smoke test
pnpm smoke

# MiMo API smoke test
pnpm mimo:smoke

# Gemini API smoke test
pnpm gemini:smoke

# Playwright smoke test
pnpm playwright:smoke

# SQLite smoke test
pnpm sqlite:smoke
```

## Project Structure

```
centinel/
├── centinel/          # Tauri + React desktop app
│   ├── src/           # React frontend (TypeScript)
│   └── src-tauri/     # Tauri backend (Rust)
├── sidecar/           # Node.js sidecar service
│   └── src/           # AI integration, Playwright, SQLite
├── docs/              # Documentation (PRD, project plan)
├── .env.example       # API key template
└── CLAUDE.md          # AI assistant instructions
```

## Module Ownership

| Module | Owner |
|---|---|
| Centinel Static | Static Testing Owner (artifact review, traceability, static reports) |
| Centinel Dynamic | Dynamic Testing Owner (Playwright + Gemini, runtime testing, bug reports) |
| Shared platform | Both (project shell, data model, unified reporting) |

## License

FYP project — not licensed for public distribution.
