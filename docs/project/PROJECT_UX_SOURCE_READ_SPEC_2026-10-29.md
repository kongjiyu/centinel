# Project UX and source-read correction — 29 October 2026

User-approved amendment supersedes the earlier persistent Source tree.

1. Project Findings columns: ID, Findings, Risk, Priority, in that order. Remove Domain and Severity columns; priority uses a colored textual indicator consistent with risk semantics. Preserve stored domains/severity, filtering, risk policy and detail actions.
2. Project Source: no left tree/sidebar. Single bounded source list opens directory listings or complete file reader. Preserve source/directory/file breadcrumbs at top and return state. Rows have source name and small kind indicator beneath on the left (10/12 width), relative updated time on right (2/12). No Name/Kind/Added header columns or right gutter. Keep meaningful per-source sync/status/history accessible.
3. Collaborators: automatically reconcile GitHub when loading; remove both explicit GitHub sync buttons on page and add modal. Preserve manual collaborator actions, membership authorization and loading/error feedback; no sync loop or overlapping requests.
4. Skeleton loading: Project Overview, Assessment, Findings, Source, Collaborators and Settings expose accessible busy placeholders during initial reads; stale data updates remain usable with honest loading indicators, no freeze or misleading empty state.
5. Source reads: trace exact frozen hash failure; binary bytes must be verified before text extraction. Original evidence remains immutable. Do not relax hash gates, reinterpret arbitrary binary as UTF-8, or claim PDF diagram/unsupported language assessment. Add appropriate extraction provenance and supported-input behavior, tested against original bytes.

Acceptance: targeted functional tests, sidecar TypeScript where changed, frontend build, 1440x900/1200x900/narrow visual checks; independent review for multi-feature changes. Record live verification separately from fixtures and known unsupported inputs.

## Implemented behavior and verification

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Project Findings | ID, Findings, Risk, Priority only; colored text badges | Implemented; tests and three-width fixture passed | Review-scoped columns preserved |
| Project Sources | No left tree; single bounded list/directory/reader; top breadcrumbs; name/kind plus relative update time | Implemented; 36 Source tests and three-width fixture passed | Missing update timestamp is explicitly unavailable, never inferred from added date |
| Collaborators | Sync GitHub on first eligible project load without either sync button; no overlap | Implemented; Project screen tests passed | Real GitHub sync unverified in this pass; no automatic repeated failure loop |
| Loading | Accessible initial skeletons for source/findings/overview/activity/assessment/collaborators and workspace fetch | Implemented; deferred-read tests and responsive fixtures passed | Project Settings uses already-loaded project data; no artificial delay |
| Frozen PDF source | Verify original bytes before extracting derived page-labelled text | Implemented; original CargoChain PDF probe and backend regressions passed | Text only: diagrams/images/layout remain unverified; encrypted/empty/oversize/malformed PDFs fail closed |

Checks: 107 frontend tests across six files; 64 backend tests across five files; sidecar TypeScript; frontend production build. Existing Vite large-chunk advisory remains. `git diff --check` passed with line-ending advisories. Screenshots are ignored under `evidence/project-ux-2026-10-29/` at 1440x900, 1200x900 and 390x900; no page-level horizontal overflow. Tests use synthetic auth/API data, not saved project outcomes. No new paid Review was submitted for this UI/fix phase.

Original source-read cause: production converted original PDF bytes to UTF-8 before the orchestrator hashed that string, so it could not equal the original binary hash. The byte reader now downloads the exact selected version with original-hash verification; PDF.js 6.4.299 extracts text in a cancellable isolated worker (30 seconds, 512 MiB JS heap, 100 MiB input, 1,000 pages, 2,000,000 text characters). Text extraction never overwrites original bytes/hash. Page-labelled derived text is used consistently for assessment/index staging/citation preview; PDF staging paths include extraction policy to invalidate incompatible index identities. The original download remains available. A PDF visual-content warning is persisted in evidence sufficiency.

Real local probe: CargoChain's original 11,435,236-byte report, SHA-256 `f95f0a68ff98ef9008b4900a33599ecc74a2291caf6458a4e2da3b7b11213f30`, yielded 59 pages and 43,302 extracted characters after byte verification. Probe output is `evidence/cargochain-pdf-extraction-probe.txt`. This is extraction acceptance, not a completed semantic Review.

Independent source-read review identified a UTF-8 BOM stripping regression; fixed with round-trip regression. Final independent review was interrupted before a complete verdict, so do not claim independent full acceptance. Root integration checks passed. Solidity support and whole-system live Review completion remain outside this correction's verified results.

PDF.js implementation follows its official Node example and API: https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs and https://mozilla.github.io/pdf.js/api/index.html.
