# Centinel Project Instructions

## Product and Sources of Truth

Centinel is a local-first desktop quality-assurance platform with two product areas:

- **Centinel Static** reviews artifacts and source code, checks requirement traceability, and reports inconsistencies.
- **Centinel Dynamic** drives web applications with Playwright, uses visual reasoning when needed, and captures reproducible evidence.

Use these references in priority order:

1. [`DESIGN.md`](./DESIGN.md) for all user-facing design decisions.
2. [`docs/Centinel_PRD_Revised.md`](./docs/Centinel_PRD_Revised.md) for product scope and requirements.
3. Current feature specifications in `docs/` for authentication, reviews, and project assessment.
4. Existing tests and implemented behavior for current technical contracts. Flag material conflicts with the PRD instead of silently changing behavior.

## Repository Map

- `centinel/` — Tauri 1 desktop app with a React 18, TypeScript, and Vite frontend.
- `centinel/src-tauri/` — Rust desktop shell and Tauri commands.
- `sidecar/` — Node.js/TypeScript service on `127.0.0.1:37701`; owns Review orchestration, integration OAuth, report generation, and Playwright automation.
- `docs/` — canonical product, setup, and current feature specifications.
- `data/`, `evidence/`, `dist/`, `node_modules/`, and `centinel/src-tauri/target/` — generated or local-only artifacts; do not hand-edit them.

Static Review uses the user's configured Model Provider settings and bearer-scoped Supabase Postgres/Storage as its durable data layer. Do not reintroduce fixed MiMo/Gemini environment-key defaults or local SQLite fallbacks for Static Review. The remaining `sql.js` store serves Dynamic Testing and the explicit legacy migration reader; do not delete existing local data during cleanup. Integration OAuth secrets and local runtime configuration are loaded from the repository-root `.env`; keep secrets out of source, logs, and `VITE_*` variables. The desktop runtime must not use a Supabase service-role key.

## Tooling and Commands

This is a pnpm workspace. Use pnpm rather than Bun, npm, or yarn so the checked-in lockfile remains authoritative.

```bash
pnpm install                              # install workspace dependencies
pnpm dev                                  # sidecar, demo server, and Tauri app
pnpm --filter centinel test               # frontend tests
pnpm --filter @centinel/sidecar test       # sidecar tests
pnpm --filter centinel build              # TypeScript + Vite frontend build
pnpm smoke                                # integration smoke checks (requires configured services)
pnpm build                                # production Tauri build
```

Prefer targeted tests while iterating, then run the smallest complete suite that covers the change. Do not claim a check passed unless it was run successfully; report environment or credential blockers explicitly.

## Frontend and Design

Before changing UI, CSS, branding, icons, animation, responsive behavior, or user-facing layout, read and follow [`DESIGN.md`](./DESIGN.md). It is authoritative even when an older screen has not yet been migrated.

- Migrate complete screens toward the command-center system without changing product behavior unless requested.
- Do not copy outdated light or monochrome styles into new work.
- Use real application data; do not invent operational metrics.
- Any intentional deviation from `DESIGN.md` requires explicit user approval.

For frontend design changes:

1. Run `pnpm --filter centinel build`.
2. Verify at 1440×900, 1200×900, and a narrow viewport.
3. Confirm styles do not leak into unrelated screens.
4. Run relevant frontend tests.

## Change Discipline

- Keep changes scoped and preserve unrelated working-tree edits.
- Add or update tests for behavior changes and bug fixes when practical.
- Keep the frontend/sidecar HTTP contract and persisted-data migrations backward-compatible unless the task explicitly changes them.
- Treat destructive operations, schema resets, generated-data deletion, commits, pushes, and other outward-facing actions as explicit user decisions.
