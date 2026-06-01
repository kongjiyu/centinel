# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Centinel** is an AI-based software quality assurance platform for FYP. It has two modules:
- **Centinel Static** — static testing (artifact review, requirement-to-code validation, inconsistency detection)
- **Centinel Dynamic** — dynamic testing (autonomous UI interaction, vision-based exploration, end-to-end workflow validation)

Target users: QA engineers, testers, developers, and resource-constrained SMEs.

## Tech Stack

- **Desktop shell:** Tauri v2 (Rust + WebView)
- **Frontend:** React + TypeScript + Vite (`centinel/` workspace member)
- **Automation runtime:** Node.js sidecar (`sidecar/` workspace member) with Playwright
- **Text model:** MiMo via Anthropic-compatible endpoint
- **Vision model:** Gemini via `@google/genai`
- **Local data:** SQLite via `sql.js` (WebAssembly — no native compilation required)

## Workspaces

This is a monorepo with two workspace members:
- `centinel/` — Tauri desktop app (React frontend + Rust backend)
- `sidecar/` — Node.js automation runtime (Playwright, MiMo, Gemini, SQLite)

## Commands

```bash
# Install all deps
pnpm install

# Tauri dev (starts Vite + Rust dev server)
cd centinel && pnpm tauri dev

# Tauri production build
cd centinel && pnpm tauri build

# Sidecar smoke check (CLI — all checks, prints JSON to stdout)
pnpm --filter @centinel/sidecar smoke

# Sidecar HTTP server (for Tauri frontend integration)
pnpm --filter @centinel/sidecar start
# POST http://localhost:37701/smoke — runs all checks, returns JSON
# GET  http://localhost:37701/health — returns {status:"ok"}

# Playwright screenshot test
pnpm --filter @centinel/sidecar playwright:smoke
```

## Environment Variables

API keys are loaded via `dotenv` from `.env` at the **project root** (not inside `sidecar/`).

```bash
# Required for MiMo and Gemini checks
MIMO_API_KEY=
MIMO_BASE_URL=https://api.xiaomimimo.com/anthropic/v1/messages
MIMO_MODEL=mimo-v2.5-pro

GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```

Copy `.env.example` to `.env` and fill in real keys.

## Architecture

```
centinel/          ← Tauri v2 desktop app
  src/             ← React + TypeScript frontend
  src-tauri/       ← Rust backend (tauri commands)

sidecar/           ← Node.js automation runtime
  src/
    index.ts       ← HTTP server (port 37701)
    cliSmoke.ts    ← CLI smoke runner (stdout JSON)
    playwrightSmoke.ts
    mimoSmoke.ts
    geminiSmoke.ts
    sqliteSmoke.ts

evidence/phase-0/  ← Generated artifacts (gitignored)
data/              ← SQLite .db files (gitignored)
docs/             ← PRD, project plan, CLAUDE.md
```

The Tauri frontend calls `POST http://localhost:37701/smoke` on the sidecar HTTP server to run checks and display results.

## Key Decisions

- `sql.js` (WASM) over `better-sqlite3` (native) — avoids native compilation issues on Node 23 / macOS ARM
- Node sidecar as separate process — runs independently via terminal (`smoke`) or HTTP server (`start`)
- Workspace structure lets both packages share the project root `.env`

## PRD Reference

`docs/Centinel_PRD_Revised.md` is the authoritative product specification.
