# Plan: Centinel Phase 2-7 — Parallel Implementation Strategy

## Dependency Graph

```
Phase 2 (Indexing) ──────────┬──→ Phase 3 (Retrieval) ──┬──→ Phase 5 (AI Reasoning)
                              │                          │
Phase 4 (Static Engine) ─────┼──────────────────────────┼──→ Phase 7 (Risk + Reports)
                              │                          │
Phase 6 (Requirements) ──────┴──────────────────────────┘
```

**Key insight:** Phases 2, 4, and 6 have NO dependencies on each other. They can run fully in parallel.

---

## Parallel Track Assignment

### Track A: Repository Indexing (Phase 2 + 3)
**Agent 1** — Files: `sidecar/src/repoIndex.ts`, `sidecar/src/contextRetrieval.ts`, `sidecar/src/db.ts`

| Task | Depends on | Output |
|---|---|---|
| Install `@nodesify/graphify` | Nothing | package.json updated |
| DB schema: `repo_index`, `code_symbols`, `code_relationships` | Nothing | db.ts migrations |
| `repoIndex.ts` — run graphify, store results | graphify installed, DB schema | Indexing module |
| `contextRetrieval.ts` — query index, graph traversal | repoIndex exists | Retrieval module |
| API endpoints: `/index`, `/retrieve` | Both modules | index.ts routes |

### Track B: Static Analysis Engine (Phase 4)
**Agent 2** — Files: `sidecar/src/staticEngine.ts`, `sidecar/src/rules/*.ts`, `sidecar/src/db.ts`

| Task | Depends on | Output |
|---|---|---|
| DB schema: `static_analysis_results` | Nothing | db.ts migrations |
| `staticEngine.ts` — rule runner | Nothing | Engine module |
| `rules/secrets.ts` — hardcoded secrets | staticEngine | Rule file |
| `rules/codeQuality.ts` — TODO, empty catch, long functions | staticEngine | Rule file |
| `rules/security.ts` — auth checks, SQL injection patterns | staticEngine | Rule file |
| API endpoint: `/static-analysis` | Engine + rules | index.ts route |

**Note:** Static engine works on RAW file content — does NOT need graphify or Phase 2.

### Track C: Requirement Management (Phase 6)
**Agent 3** — Files: `sidecar/src/requirements.ts`, `centinel/src/screens/RequirementsScreen.tsx`, `centinel/src/types.ts`

| Task | Depends on | Output |
|---|---|---|
| DB schema: `requirements`, `requirement_mappings` | Nothing | db.ts migrations |
| `requirements.ts` — CRUD + mapping logic | Nothing | Backend module |
| API endpoints: `/requirements` | requirements.ts | index.ts routes |
| `types.ts` — Requirement types | Nothing | Frontend types |
| `api/client.ts` — Requirement API calls | types | Frontend API |
| `RequirementsScreen.tsx` — Management UI | All above | Frontend screen |
| `App.tsx` — Add route | RequirementsScreen | Navigation |

### Track D: AI Reasoning + Risk Scoring (Phase 5 + 7)
**Agent 4** — Files: `sidecar/src/staticReview.ts`, `sidecar/src/reportExport.ts`, `sidecar/src/riskScore.ts`

| Task | Depends on | Output |
|---|---|---|
| `riskScore.ts` — Scoring algorithm | Nothing | Risk module |
| Batched processing logic in staticReview.ts | Nothing | Review engine |
| Two-pass prompt strategy (scaffold) | Nothing | Prompt templates |
| Enhanced report format | riskScore | Report module |
| **Integration:** Wire context retrieval into review | Track A complete | Final review flow |
| **Integration:** Wire static findings into AI prompt | Track B complete | Final review flow |
| **Integration:** Wire requirements into risk scoring | Track C complete | Final review flow |

---

## Parallel Execution Timeline

```
Day 1-2:  [Agent A] Install graphify, DB schema, repoIndex.ts
          [Agent B] DB schema, staticEngine.ts, rules/secrets.ts
          [Agent C] DB schema, requirements.ts, API endpoints
          [Agent D] riskScore.ts, batched processing scaffold

Day 3-4:  [Agent A] contextRetrieval.ts, retrieval API
          [Agent B] rules/codeQuality.ts, rules/security.ts, engine API
          [Agent C] RequirementsScreen.tsx, frontend API
          [Agent D] Two-pass prompt strategy, enhanced report

Day 5:    [Agent A] ✅ Complete — Indexing + Retrieval ready
          [Agent B] ✅ Complete — Static Engine ready
          [Agent C] ✅ Complete — Requirements ready
          [Agent D] ⏳ Waiting for A, B, C integration

Day 6:    [Agent D] Integration — Wire all tracks into staticReview.ts
          [All]     Testing + verification
```

---

## Shared Infrastructure (Must Be Done First)

Before agents fan out, these shared changes need to happen:

### 1. Database Schema (`sidecar/src/db.ts`)
All three tracks add tables. Do this ONCE before parallel work:

```sql
-- Track A: Repository Indexing
CREATE TABLE repo_index (...);
CREATE TABLE code_symbols (...);
CREATE TABLE code_relationships (...);

-- Track B: Static Analysis
CREATE TABLE static_analysis_results (...);

-- Track C: Requirements
CREATE TABLE requirements (...);
CREATE TABLE requirement_mappings (...);
```

### 2. Install Dependencies
```bash
cd sidecar
npm install @nodesify/graphify
```

---

## Agent Isolation Rules

| Rule | Reason |
|---|---|
| Each agent works in its own files | No merge conflicts |
| DB schema changes go through one agent (Agent B first) | Prevents conflicting migrations |
| API routes use unique URL prefixes | No route collisions |
| Frontend types are additive | No overwrites |
| Integration happens AFTER all tracks complete | Clean merge point |

---

## File Ownership

| Agent | Owns | Can Read |
|---|---|---|
| A (Indexing) | `repoIndex.ts`, `contextRetrieval.ts` | `db.ts`, `artifacts.ts` |
| B (Static) | `staticEngine.ts`, `rules/*.ts` | `db.ts`, `artifacts.ts` |
| C (Requirements) | `requirements.ts`, `RequirementsScreen.tsx` | `db.ts`, `types.ts` |
| D (AI + Risk) | `staticReview.ts`, `riskScore.ts`, `reportExport.ts` | Everything |

---

## Integration Checklist (Day 6)

- [ ] `staticReview.ts` calls `contextRetrieval.retrieve()` before AI call
- [ ] `staticReview.ts` calls `staticEngine.analyze()` and includes results in prompt
- [ ] `staticReview.ts` calls `riskScore.score()` on each finding
- [ ] `staticReview.ts` maps requirements to findings if present
- [ ] `reportExport.ts` uses enhanced finding model
- [ ] All API endpoints registered in `index.ts`
- [ ] Frontend types updated with new fields
- [ ] No TypeScript errors across all files

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| graphify API changes | Pin version in package.json |
| DB migration conflicts | Single agent handles all schema |
| API route collisions | Use prefixes: `/index/*`, `/analysis/*`, `/requirements/*` |
| Integration failures | Each track has standalone tests before merge |
| Token budget exceeded | Track A's retrieval limits context size |
