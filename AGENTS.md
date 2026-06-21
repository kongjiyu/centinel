# Agent Instructions

## Required Design Context

Before changing any frontend UI, CSS, branding, icon, animation, responsive behavior, or user-facing layout, read and follow [`DESIGN.md`](./DESIGN.md).

`DESIGN.md` is the authoritative design system for this repository. Existing screens may still be awaiting migration; do not copy outdated light or monochrome styles into new work. Migrate complete screens toward the command-center system without changing product behavior unless explicitly requested.

Any intentional deviation from `DESIGN.md` requires explicit user approval.

## Verification

For frontend design changes:

1. Build with `pnpm --filter centinel build`.
2. Verify at 1440x900, 1200x900, and a narrow viewport.
3. Confirm no unintended styles leak into unrelated screens.
4. Use real application data; do not invent operational metrics.
