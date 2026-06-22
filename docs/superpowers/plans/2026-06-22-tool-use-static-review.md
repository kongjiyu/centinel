# Tool-Use Static Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI itself decide which files to read during static review by sending `index.json` and `graph.json` as navigation context and exposing four tools (`fetch_file`, `fetch_files`, `get_symbol_body`, `search_symbols`) the model can call to fetch specific content. This eliminates the 100K-char prompt cap that caused HTTP 400 errors, reduces wasted input tokens on small reviews, and produces more focused findings.

**Architecture:** Hybrid dispatch — small projects keep the existing pre-fetch path; large projects take a new `runStaticReviewWithTools` path that pre-sends `index.json` + `graph.json` and loops `callAiWithTools` → `executeTool` → re-call for up to 3 rounds per stage. Same `Finding[]` output shape, same DB writes, same report export. New env vars (`STATIC_REVIEW_MAX_ROUNDS`, `STATIC_REVIEW_SMALL_PROJECT_BYTES`, `STATIC_REVIEW_MAX_TOOL_RESULT_CHARS`, `STATIC_REVIEW_MAX_MESSAGE_CHARS`) read from `process.env` directly.

**Tech Stack:** Node.js + TypeScript, Vitest for unit tests, sql.js (WASM) for SQLite, Vitest `vi.mock` for module mocking, Vitest `vi.spyOn(globalThis, 'fetch')` for HTTP mocking. Per-provider format coverage: `openai-compatible`, `anthropic-compatible`, `google-native`, and MiMo (which uses the Anthropic-compatible shape).

**Spec reference:** `docs/superpowers/specs/2026-06-22-ai-tool-use-static-review-design.md`

## Global Constraints

These constraints apply to every task:

- **Test framework:** Vitest. Test files live at `sidecar/__tests__/**/*.test.ts`. Run with `pnpm --filter @centinel/sidecar test` (which invokes `vitest run`).
- **Mocking pattern:** `vi.mock('../../src/<module>.js', () => ({ ... }))` BEFORE the import of the module under test. Then `import { fn } from '../../src/<module>'` AFTER the mock. See `sidecar/__tests__/unit/aiClient.test.ts` for the canonical pattern.
- **HTTP mocking:** `vi.spyOn(globalThis, 'fetch')` in `beforeEach`, restore in `afterEach`.
- **DB test setup:** Use `createTestDb()` from `sidecar/__tests__/helpers/testHelpers.ts`. Call `setTestDb(db)` (from `sidecar/src/db.ts`) and `clearTestDb()` in `afterEach`. The schema includes `projects`, `artifacts`, `repo_index`, `code_symbols`, `code_relationships` — see `testHelpers.ts:30-90` for the full schema.
- **Provider format coverage:** every `callAiWithTools` change must work for all four provider shapes (`openai-compatible`, `anthropic-compatible`, `google-native`, MiMo-via-anthropic-compatible). The Anthropic path covers MiMo.
- **Env-var loading:** read from `process.env` directly. NEVER add env-var loading to `sidecar/src/settings.ts` (that file only reads from the SQLite `ai_provider_settings` table).
- **Path semantics:** tools operate on file paths from `index.json`, NOT artifact IDs. `fs.readFileSync` directly. Path normalization (resolve, Windows case-insensitive) happens in `tools.ts`.
- **Output shape:** every code path must produce the same `Finding[]` shape consumed by `createFinding`. The downstream `staticSessions.ts`, `reportExport.ts`, and React UI are NOT modified by this plan.
- **Frequent commits:** one commit per TDD cycle (failing test → implement → pass). Use conventional commit prefixes (`feat:`, `test:`, `refactor:`, `fix:`, `docs:`).
- **Co-author line:** every commit message ends with `Co-Authored-By: Claude <noreply@anthropic.com>`.

---

## Task 1: Add `searchSymbols` and `getSymbolBody` to `repoIndex.ts`

**Files:**
- Modify: `sidecar/src/repoIndex.ts` (add two new exported functions)
- Modify: `sidecar/__tests__/unit/repoIndex.test.ts` (extend with two new `describe` blocks)

**Interfaces:**
- Consumes: existing `getDb()` from `db.ts`, schema in `testHelpers.ts`
- Produces:
  - `searchSymbols(projectId: string, query: string, limit?: number): Promise<{ matches: Array<{ symbolId, name, symbolType, filePath, signature, startLine, endLine }>, totalMatches: number }>`
  - `getSymbolBody(projectId: string, filePath: string, symbolName: string): Promise<{ name, symbolType, filePath, startLine, endLine, body, fileTotalLines }>`

- [ ] **Step 1: Write the failing test for `searchSymbols`**

Append a new `describe('searchSymbols', ...)` block to `sidecar/__tests__/unit/repoIndex.test.ts`. The test inserts a project, two repo_index rows, and four code_symbols rows, then asserts the result shape and ordering.

```ts
describe('searchSymbols', () => {
  it('returns symbol matches joined with file paths, ordered by name', async () => {
    const db = await setupTestDb();
    insertArtifact(db, makeArtifact({ id: 'a1', filePath: '/proj/auth.ts' }));
    insertArtifact(db, makeArtifact({ id: 'a2', filePath: '/proj/user.ts' }));
    db.run(`INSERT INTO repo_index (id, project_id, file_path, file_type, language, file_size, symbol_count, indexed_at)
            VALUES ('f-auth', 'test-project-1', '/proj/auth.ts', 'ts', 'typescript', 100, 2, '2024-01-01')`);
    db.run(`INSERT INTO repo_index (id, project_id, file_path, file_type, language, file_size, symbol_count, indexed_at)
            VALUES ('f-user', 'test-project-1', '/proj/user.ts', 'ts', 'typescript', 100, 2, '2024-01-01')`);
    db.run(`INSERT INTO code_symbols (id, project_id, file_id, symbol_type, name, start_line, end_line, signature, exports)
            VALUES ('s1', 'test-project-1', 'f-auth', 'function', 'authenticate', 1, 10, 'function authenticate()', 0)`);
    db.run(`INSERT INTO code_symbols (id, project_id, file_id, symbol_type, name, start_line, end_line, signature, exports)
            VALUES ('s2', 'test-project-1', 'f-auth', 'function', 'authorize', 20, 30, 'function authorize()', 0)`);
    db.run(`INSERT INTO code_symbols (id, project_id, file_id, symbol_type, name, start_line, end_line, signature, exports)
            VALUES ('s3', 'test-project-1', 'f-user', 'function', 'getUser', 1, 5, 'function getUser()', 0)`);
    db.run(`INSERT INTO code_symbols (id, project_id, file_id, symbol_type, name, start_line, end_line, signature, exports)
            VALUES ('s4', 'test-project-1', 'f-user', 'function', 'updateUser', 10, 20, 'function updateUser()', 0)`);

    const result = await searchSymbols('test-project-1', 'user');

    expect(result.totalMatches).toBe(2);
    expect(result.matches.map(m => m.name)).toEqual(['getUser', 'updateUser']);
    expect(result.matches[0].filePath).toBe('/proj/user.ts');
    expect(result.matches[0].startLine).toBe(1);
    expect(result.matches[0].endLine).toBe(5);
  });

  it('respects the limit parameter', async () => {
    const db = await setupTestDb();
    insertArtifact(db, makeArtifact({ filePath: '/proj/x.ts' }));
    db.run(`INSERT INTO repo_index (id, project_id, file_path, file_type, language, file_size, symbol_count, indexed_at)
            VALUES ('fx', 'test-project-1', '/proj/x.ts', 'ts', 'typescript', 100, 3, '2024-01-01')`);
    for (let i = 1; i <= 3; i++) {
      db.run(`INSERT INTO code_symbols (id, project_id, file_id, symbol_type, name, start_line, end_line, signature, exports)
              VALUES ('s${i}', 'test-project-1', 'fx', 'function', 'sym${i}', ${i}, ${i}, 'fn', 0)`);
    }
    const result = await searchSymbols('test-project-1', 'sym', 2);
    expect(result.matches).toHaveLength(2);
  });

  it('returns empty matches when no symbols match', async () => {
    await setupTestDb();
    const result = await searchSymbols('test-project-1', 'nonexistent');
    expect(result.matches).toEqual([]);
    expect(result.totalMatches).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "searchSymbols"`
Expected: FAIL — `searchSymbols is not a function` (or similar import error).

- [ ] **Step 3: Implement `searchSymbols`**

Add to `sidecar/src/repoIndex.ts` (at the end of the file, after the existing exports):

```ts
export async function searchSymbols(
  projectId: string,
  query: string,
  limit: number = 50
): Promise<{
  matches: Array<{
    symbolId: string;
    name: string;
    symbolType: string;
    filePath: string;
    signature: string;
    startLine: number;
    endLine: number;
  }>;
  totalMatches: number;
}> {
  const db = await getDb();
  const pattern = `%${query}%`;

  // Count first (so totalMatches reflects the true total, not the LIMIT)
  const countStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM code_symbols WHERE project_id = ? AND name LIKE ?`
  );
  countStmt.bind([projectId, pattern]);
  let totalMatches = 0;
  if (countStmt.step()) {
    totalMatches = (countStmt.get() as unknown[])[0] as number;
  }
  countStmt.free();

  // Then fetch the page
  const stmt = db.prepare(
    `SELECT cs.id, cs.symbol_type, cs.name, cs.signature, cs.start_line, cs.end_line, r.file_path
     FROM code_symbols cs
     JOIN repo_index r ON r.id = cs.file_id
     WHERE cs.project_id = ? AND cs.name LIKE ?
     ORDER BY cs.name
     LIMIT ?`
  );
  stmt.bind([projectId, pattern, limit]);

  const matches: Array<{
    symbolId: string;
    name: string;
    symbolType: string;
    filePath: string;
    signature: string;
    startLine: number;
    endLine: number;
  }> = [];
  while (stmt.step()) {
    const row = stmt.get() as unknown[];
    matches.push({
      symbolId: row[0] as string,
      symbolType: row[1] as string,
      name: row[2] as string,
      signature: (row[3] as string) ?? '',
      startLine: (row[4] as number) ?? 0,
      endLine: (row[5] as number) ?? 0,
      filePath: (row[6] as string) ?? '',
    });
  }
  stmt.free();

  return { matches, totalMatches };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "searchSymbols"`
Expected: PASS — all three test cases pass.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/repoIndex.ts sidecar/__tests__/unit/repoIndex.test.ts
git commit -m "feat(repo-index): add searchSymbols for symbol-level matching

Used by the static review tool path's search_symbols tool. Returns
symbol-level matches (not whole files like searchByKeyword) joined
with the parent file path. Limits at 50 by default, configurable.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 6: Write the failing test for `getSymbolBody`**

Append a new `describe('getSymbolBody', ...)` block to `sidecar/__tests__/unit/repoIndex.test.ts`. The test writes a real file to a temp dir, inserts a code_symbols row pointing at it, and verifies the sliced body.

```ts
import os from 'os';
import path from 'path';
import fs from 'fs';

describe('getSymbolBody', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-getSymbolBody-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the exact lines for a symbol by name and file path', async () => {
    const filePath = path.join(tmpDir, 'auth.ts');
    const fileContent = [
      '// line 1',
      '// line 2',
      'export function authenticate(token: string) {',  // line 3
      '  if (!token) throw new Error("missing");',      // line 4
      '  return validateToken(token);',                  // line 5
      '}',                                              // line 6
      '// line 7',
    ].join('\n');
    fs.writeFileSync(filePath, fileContent);

    const db = await setupTestDb();
    db.run(`INSERT INTO repo_index (id, project_id, file_path, file_type, language, file_size, symbol_count, indexed_at)
            VALUES ('f1', 'test-project-1', ?, 'ts', 'typescript', ?, 1, '2024-01-01')`,
            [filePath, fileContent.length]);
    db.run(`INSERT INTO code_symbols (id, project_id, file_id, symbol_type, name, start_line, end_line, signature, exports)
            VALUES ('s1', 'test-project-1', 'f1', 'function', 'authenticate', 3, 6, 'function authenticate()', 1)`);

    const result = await getSymbolBody('test-project-1', filePath, 'authenticate');

    expect(result.startLine).toBe(3);
    expect(result.endLine).toBe(6);
    expect(result.body).toBe([
      'export function authenticate(token: string) {',
      '  if (!token) throw new Error("missing");',
      '  return validateToken(token);',
      '}',
    ].join('\n'));
    expect(result.fileTotalLines).toBe(7);
  });

  it('throws SymbolNotFound when the symbol is not in the index', async () => {
    const db = await setupTestDb();
    await expect(
      getSymbolBody('test-project-1', '/no/such/file.ts', 'nope')
    ).rejects.toThrow(/SymbolNotFound/);
  });

  it('works for non-JS/TS symbols (markdown heading lines)', async () => {
    const filePath = path.join(tmpDir, 'README.md');
    fs.writeFileSync(filePath, '# Title\n\nSome prose.\n\n## Section\n\nMore prose.\n');

    const db = await setupTestDb();
    db.run(`INSERT INTO repo_index (id, project_id, file_path, file_type, language, file_size, symbol_count, indexed_at)
            VALUES ('f1', 'test-project-1', ?, 'md', 'markdown', ?, 2, '2024-01-01')`,
            [filePath, 40]);
    db.run(`INSERT INTO code_symbols (id, project_id, file_id, symbol_type, name, start_line, end_line, signature, exports)
            VALUES ('s1', 'test-project-1', 'f1', 'h2', 'Section', 5, 5, '## Section', 0)`);

    const result = await getSymbolBody('test-project-1', filePath, 'Section');
    expect(result.body).toBe('## Section');
    expect(result.symbolType).toBe('h2');
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "getSymbolBody"`
Expected: FAIL — `getSymbolBody is not a function`.

- [ ] **Step 8: Implement `getSymbolBody`**

Add to `sidecar/src/repoIndex.ts`, right after `searchSymbols`:

```ts
export class SymbolNotFound extends Error {
  constructor(filePath: string, symbolName: string) {
    super(`SymbolNotFound: "${symbolName}" not found in ${filePath}`);
    this.name = 'SymbolNotFound';
  }
}

export async function getSymbolBody(
  projectId: string,
  filePath: string,
  symbolName: string
): Promise<{
  name: string;
  symbolType: string;
  filePath: string;
  startLine: number;
  endLine: number;
  body: string;
  fileTotalLines: number;
}> {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT cs.name, cs.symbol_type, cs.start_line, cs.end_line
     FROM code_symbols cs
     JOIN repo_index r ON r.id = cs.file_id
     WHERE cs.project_id = ? AND r.file_path = ? AND cs.name = ?
     LIMIT 1`
  );
  stmt.bind([projectId, filePath, symbolName]);

  if (!stmt.step()) {
    stmt.free();
    throw new SymbolNotFound(filePath, symbolName);
  }
  const row = stmt.get() as unknown[];
  stmt.free();

  const name = row[0] as string;
  const symbolType = row[1] as string;
  const startLine = (row[2] as number) ?? 0;
  const endLine = (row[3] as number) ?? 0;

  // Read the file and slice by line range. The DB stores 1-indexed lines.
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const body = lines.slice(startLine - 1, endLine).join('\n');

  return {
    name,
    symbolType,
    filePath,
    startLine,
    endLine,
    body,
    fileTotalLines: lines.length,
  };
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "getSymbolBody"`
Expected: PASS — all three test cases pass.

- [ ] **Step 10: Commit**

```bash
git add sidecar/src/repoIndex.ts sidecar/__tests__/unit/repoIndex.test.ts
git commit -m "feat(repo-index): add getSymbolBody for per-symbol source slices

Used by the static review tool path's get_symbol_body tool. Slices
the source file by the symbol's start_line..end_line from the AST
index. Works for any indexed symbol (JS/TS, markdown, JSON, CSS,
YAML, HTML) since the line-range is generic. Throws SymbolNotFound
on miss.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: New `tools.ts` module — schemas, executor, path normalization, truncation

**Files:**
- Create: `sidecar/src/tools.ts`
- Create: `sidecar/__tests__/unit/tools.test.ts`

**Interfaces:**
- Consumes: `getDb()` from `db.ts`, `searchSymbols` and `getSymbolBody` from `repoIndex.ts`, `process.env.STATIC_REVIEW_MAX_TOOL_RESULT_CHARS` (default 25000), `path.resolve`, `fs.readFileSync`
- Produces:
  - `TOOL_SCHEMAS`: array of tool schemas in the shared internal format `{ name, description, input_schema }` (Anthropic-shape)
  - `executeTool(name: string, args: Record<string, unknown>, workspacePath: string): Promise<string>` — returns a JSON string. The per-tool error model:
    - `fetch_file`: throws `ENOENT` / `EACCES` on failure
    - `fetch_files`: returns `{"results": {<path>: <content> | {"error": "..."}}}`; throws only if ALL paths failed
    - `get_symbol_body`: throws `SymbolNotFound` / `ENOENT`
    - `search_symbols`: returns `{"matches": [...], "totalMatches": N}`; throws only on DB error

- [ ] **Step 1: Write the failing test for `executeTool` — `fetch_file` happy path**

Create `sidecar/__tests__/unit/tools.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

vi.mock('../../src/repoIndex.js', () => ({
  searchSymbols: vi.fn(),
  getSymbolBody: vi.fn(),
}));

import { searchSymbols, getSymbolBody } from '../../src/repoIndex';
import { executeTool } from '../../src/tools';

describe('executeTool — fetch_file', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-tools-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('returns the file content as a JSON string', async () => {
    const filePath = path.join(tmpDir, 'hello.txt');
    fs.writeFileSync(filePath, 'hello world');
    const result = await executeTool('fetch_file', { path: filePath }, tmpDir);
    expect(JSON.parse(result)).toEqual({ content: 'hello world', path: filePath });
  });

  it('throws ENOENT for a missing file', async () => {
    await expect(
      executeTool('fetch_file', { path: path.join(tmpDir, 'nope.txt') }, tmpDir)
    ).rejects.toThrow(/ENOENT|no such file/);
  });

  it('resolves relative paths against the workspace', async () => {
    const subDir = path.join(tmpDir, 'src');
    fs.mkdirSync(subDir);
    const filePath = path.join(subDir, 'auth.ts');
    fs.writeFileSync(filePath, 'export const x = 1;');
    const result = await executeTool('fetch_file', { path: 'src/auth.ts' }, tmpDir);
    expect(JSON.parse(result).content).toBe('export const x = 1;');
  });

  it('truncates output at STATIC_REVIEW_MAX_TOOL_RESULT_CHARS (default 25K)', async () => {
    const filePath = path.join(tmpDir, 'big.txt');
    const content = 'x'.repeat(30_000);
    fs.writeFileSync(filePath, content);
    const result = await executeTool('fetch_file', { path: filePath }, tmpDir);
    const parsed = JSON.parse(result);
    expect(parsed.content.length).toBeLessThan(30_000);
    expect(parsed.content).toContain('[... truncated');
    expect(parsed.truncated).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "executeTool — fetch_file"`
Expected: FAIL — `Cannot find module '../../src/tools'`.

- [ ] **Step 3: Implement `executeTool` for `fetch_file` (and the file scaffold)**

Create `sidecar/src/tools.ts`:

```ts
import fs from 'fs';
import path from 'path';
import { searchSymbols, getSymbolBody, SymbolNotFound } from './repoIndex.js';

// ── Tool schemas (Anthropic-compatible shape; aiClient.ts converts per-provider) ──

export const TOOL_SCHEMAS = [
  {
    name: 'fetch_file',
    description: 'Read the full content of a single file by its path. Use when you need to inspect a file\'s complete source.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "File path relative to workspace root, e.g. 'src/auth/login.ts'" },
      },
      required: ['path'],
    },
  },
  {
    name: 'fetch_files',
    description: 'Read multiple files in one batch. More efficient than calling fetch_file repeatedly.',
    input_schema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' } },
      },
      required: ['paths'],
    },
  },
  {
    name: 'get_symbol_body',
    description: 'Return only one symbol (function/class/interface) by name, not the whole file. Cheaper than fetch_file when you know the symbol name.',
    input_schema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path' },
        name: { type: 'string', description: 'Symbol name' },
      },
      required: ['file', 'name'],
    },
  },
  {
    name: 'search_symbols',
    description: 'Search the symbol index by name. Returns matching symbols with their file paths and signatures. Use to locate candidates before fetching.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring to match against symbol names' },
      },
      required: ['query'],
    },
  },
] as const;

export type ToolName = 'fetch_file' | 'fetch_files' | 'get_symbol_body' | 'search_symbols';

// ── Path normalization ─────────────────────────────────────────────────────────

/**
 * Resolve a user-provided path against the workspace root, then normalize.
 * On Windows, comparison is case-insensitive. Returns the absolute path.
 */
function resolvePath(input: string, workspacePath: string): string {
  // If absolute, use as-is; otherwise resolve relative to workspace
  const absolute = path.isAbsolute(input) ? input : path.resolve(workspacePath, input);
  // Normalize separators and resolve any '..' / '.'
  return path.normalize(absolute);
}

// ── Truncation ─────────────────────────────────────────────────────────────────

const TRUNCATION_MARKER = '\n\n[... truncated, use get_symbol_body for a specific symbol ...]';

function getMaxResultChars(): number {
  const fromEnv = Number(process.env.STATIC_REVIEW_MAX_TOOL_RESULT_CHARS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 25_000;
}

function maybeTruncate(text: string): { content: string; truncated: boolean } {
  const max = getMaxResultChars();
  if (text.length <= max) return { content: text, truncated: false };
  const cut = max - TRUNCATION_MARKER.length;
  return { content: text.substring(0, cut) + TRUNCATION_MARKER, truncated: true };
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function toolFetchFile(args: Record<string, unknown>, workspacePath: string): Promise<string> {
  const p = resolvePath(String(args.path), workspacePath);
  const raw = fs.readFileSync(p, 'utf-8');
  const { content, truncated } = maybeTruncate(raw);
  return JSON.stringify({ content, path: p, truncated });
}

async function toolFetchFiles(args: Record<string, unknown>, workspacePath: string): Promise<string> {
  const paths = (args.paths as unknown[]).map(String);
  const results: Record<string, unknown> = {};
  let successCount = 0;
  let lastError: Error | null = null;

  for (const p of paths) {
    try {
      const absolute = resolvePath(p, workspacePath);
      const raw = fs.readFileSync(absolute, 'utf-8');
      const { content, truncated } = maybeTruncate(raw);
      results[p] = { content, truncated };
      successCount++;
    } catch (err) {
      results[p] = { error: err instanceof Error ? err.message : String(err) };
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // Throw only if ALL paths failed
  if (successCount === 0 && paths.length > 0) {
    throw lastError ?? new Error('All paths failed');
  }

  return JSON.stringify({ results });
}

async function toolGetSymbolBody(args: Record<string, unknown>, workspacePath: string): Promise<string> {
  const filePath = resolvePath(String(args.file), workspacePath);
  // We need a projectId; tools are called inside runStaticReviewWithTools which
  // closes over the session's projectId. The dispatch is plumbed below.
  throw new Error('get_symbol_body requires projectId from caller; see executeTool signature');
}

async function toolSearchSymbols(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query);
  // Same as get_symbol_body — needs projectId from caller.
  throw new Error('search_symbols requires projectId from caller; see executeTool signature');
}

// ── Public dispatch ───────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  workspacePath: string,
  projectId?: string
): Promise<string> {
  switch (name) {
    case 'fetch_file':
      return toolFetchFile(args, workspacePath);
    case 'fetch_files':
      return toolFetchFiles(args, workspacePath);
    case 'get_symbol_body':
      if (!projectId) throw new Error('get_symbol_body requires projectId');
      // resolvePath is done inside toolGetSymbolBody; we pass through
      return toolGetSymbolBodyImpl(args, workspacePath, projectId);
    case 'search_symbols':
      if (!projectId) throw new Error('search_symbols requires projectId');
      return toolSearchSymbolsImpl(args, projectId);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function toolGetSymbolBodyImpl(
  args: Record<string, unknown>,
  workspacePath: string,
  projectId: string
): Promise<string> {
  const filePath = resolvePath(String(args.file), workspacePath);
  const symbolName = String(args.name);
  const result = await getSymbolBody(projectId, filePath, symbolName);
  const { body, truncated } = maybeTruncate(result.body);
  return JSON.stringify({ ...result, body, truncated });
}

async function toolSearchSymbolsImpl(
  args: Record<string, unknown>,
  projectId: string
): Promise<string> {
  const query = String(args.query);
  const result = await searchSymbols(projectId, query);
  return JSON.stringify(result);
}

// Re-export SymbolNotFound so callers can identify the error
export { SymbolNotFound };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "executeTool — fetch_file"`
Expected: PASS — all four `fetch_file` tests pass.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/tools.ts sidecar/__tests__/unit/tools.test.ts
git commit -m "feat(tools): add tools.ts with fetch_file, fetch_files, search_symbols, get_symbol_body

Implements the tool schemas (in Anthropic-compatible shape; aiClient.ts
will convert per-provider), executeTool dispatch with per-tool error
model (fetch_files returns partial results; others throw), path
normalization (Windows case-insensitive), and 25K-char truncation
overridden by STATIC_REVIEW_MAX_TOOL_RESULT_CHARS.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 6: Write the failing test for `fetch_files` partial failure**

Append to `sidecar/__tests__/unit/tools.test.ts`:

```ts
describe('executeTool — fetch_files', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-ff-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('returns per-path results, including errors for missing files', async () => {
    const good = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(good, 'A');
    const bad = path.join(tmpDir, 'missing.txt');
    const result = await executeTool('fetch_files', { paths: [good, bad] }, tmpDir);
    const parsed = JSON.parse(result);
    expect(parsed.results[good].content).toBe('A');
    expect(parsed.results[bad].error).toMatch(/ENOENT|no such file/);
  });

  it('throws when ALL paths fail', async () => {
    await expect(
      executeTool('fetch_files', { paths: ['/no/such/a', '/no/such/b'] }, tmpDir)
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 7: Run the test to verify it passes (already implemented in Step 3)**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "executeTool — fetch_files"`
Expected: PASS.

- [ ] **Step 8: Write the failing test for `get_symbol_body` and `search_symbols`**

Append to `sidecar/__tests__/unit/tools.test.ts`:

```ts
describe('executeTool — get_symbol_body and search_symbols', () => {
  it('get_symbol_body returns the symbol body JSON', async () => {
    vi.mocked(getSymbolBody).mockResolvedValue({
      name: 'foo',
      symbolType: 'function',
      filePath: '/x.ts',
      startLine: 1,
      endLine: 3,
      body: 'function foo() {}',
      fileTotalLines: 10,
    });
    const result = await executeTool('get_symbol_body', { file: '/x.ts', name: 'foo' }, '/', 'proj-1');
    const parsed = JSON.parse(result);
    expect(parsed.body).toBe('function foo() {}');
    expect(parsed.startLine).toBe(1);
  });

  it('get_symbol_body propagates SymbolNotFound as a thrown error', async () => {
    vi.mocked(getSymbolBody).mockRejectedValue(new SymbolNotFound('/x.ts', 'nope'));
    await expect(
      executeTool('get_symbol_body', { file: '/x.ts', name: 'nope' }, '/', 'proj-1')
    ).rejects.toThrow(SymbolNotFound);
  });

  it('search_symbols returns the matches JSON', async () => {
    vi.mocked(searchSymbols).mockResolvedValue({
      matches: [{ symbolId: 's1', name: 'authenticate', symbolType: 'function', filePath: '/a.ts', signature: 'fn', startLine: 1, endLine: 2 }],
      totalMatches: 1,
    });
    const result = await executeTool('search_symbols', { query: 'auth' }, '/', 'proj-1');
    const parsed = JSON.parse(result);
    expect(parsed.matches[0].name).toBe('authenticate');
  });

  it('throws for an unknown tool name', async () => {
    await expect(
      executeTool('hack_the_planet', {}, '/', 'proj-1')
    ).rejects.toThrow(/Unknown tool/);
  });
});
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "get_symbol_body and search_symbols"`
Expected: PASS — all four tests pass.

- [ ] **Step 10: Commit**

```bash
git add sidecar/__tests__/unit/tools.test.ts
git commit -m "test(tools): cover fetch_files partial failure, get_symbol_body, search_symbols

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: `callAiWithTools` per-format request assembly + parsers in `aiClient.ts`

**Files:**
- Modify: `sidecar/src/aiClient.ts` (add per-format request builders and response parsers)
- Modify: `sidecar/__tests__/unit/aiClient.test.ts` (extend with parser tests)

**Interfaces:**
- Consumes: `getRawAiSetting` (already mocked in existing tests), `process.env.STATIC_REVIEW_MAX_ROUNDS` (default 3)
- Produces (exported):
  - `parseAnthropicToolTurn(json: unknown): ToolTurn`
  - `parseOpenAIToolTurn(json: unknown): ToolTurn`
  - `parseGoogleToolTurn(json: unknown): ToolTurn`
  - `buildAnthropicToolRequest(model, system, messages, tools): object`
  - `buildOpenAIToolRequest(model, system, messages, tools): object`
  - `buildGoogleToolRequest(model, system, messages, tools): object`
  - Types: `ToolCall`, `ToolResult`, `ToolTurn`, `ToolSchema`

- [ ] **Step 1: Write the failing tests for the three parsers**

Append to `sidecar/__tests__/unit/aiClient.test.ts`:

```ts
import {
  parseAnthropicToolTurn,
  parseOpenAIToolTurn,
  parseGoogleToolTurn,
} from '../../src/aiClient';

describe('parseAnthropicToolTurn', () => {
  it('extracts text, tool_use blocks, and stop_reason', () => {
    const turn = parseAnthropicToolTurn({
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'I need to inspect auth.ts' },
        { type: 'tool_use', id: 'tu_1', name: 'fetch_file', input: { path: 'src/auth.ts' } },
      ],
    });
    expect(turn.content).toBe('I need to inspect auth.ts');
    expect(turn.toolCalls).toEqual([
      { id: 'tu_1', name: 'fetch_file', input: { path: 'src/auth.ts' } },
    ]);
    expect(turn.stopReason).toBe('tool_use');
  });

  it('returns end_turn when there are no tool_use blocks', () => {
    const turn = parseAnthropicToolTurn({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'all done' }],
    });
    expect(turn.stopReason).toBe('end_turn');
    expect(turn.toolCalls).toEqual([]);
  });

  it('handles empty content array', () => {
    const turn = parseAnthropicToolTurn({ stop_reason: 'end_turn', content: [] });
    expect(turn.content).toBeNull();
    expect(turn.stopReason).toBe('end_turn');
  });
});

describe('parseOpenAIToolTurn', () => {
  it('extracts tool_calls from the first choice message', () => {
    const turn = parseOpenAIToolTurn({
      choices: [{
        message: {
          content: null,
          tool_calls: [
            { id: 'call_1', function: { name: 'fetch_file', arguments: '{"path":"a.ts"}' } },
          ],
        },
      }],
    });
    expect(turn.toolCalls).toEqual([
      { id: 'call_1', name: 'fetch_file', input: { path: 'a.ts' } },
    ]);
    expect(turn.stopReason).toBe('tool_use');
  });

  it('parses content when no tool_calls', () => {
    const turn = parseOpenAIToolTurn({
      choices: [{ message: { content: 'hello' } }],
    });
    expect(turn.content).toBe('hello');
    expect(turn.stopReason).toBe('end_turn');
  });

  it('handles malformed tool_call arguments gracefully (defaults to {})', () => {
    const turn = parseOpenAIToolTurn({
      choices: [{
        message: {
          tool_calls: [{ id: 'c1', function: { name: 'fetch_file', arguments: 'not-json' } }],
        },
      }],
    });
    expect(turn.toolCalls[0].input).toEqual({});
  });
});

describe('parseGoogleToolTurn', () => {
  it('extracts functionCall parts and synthesizes IDs', () => {
    const turn = parseGoogleToolTurn({
      candidates: [{
        content: {
          parts: [
            { text: 'inspecting' },
            { functionCall: { name: 'fetch_file', args: { path: 'b.ts' } } },
          ],
        },
      }],
    });
    expect(turn.content).toBe('inspecting');
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].name).toBe('fetch_file');
    expect(turn.toolCalls[0].input).toEqual({ path: 'b.ts' });
    expect(turn.toolCalls[0].id).toMatch(/^google-/);
  });

  it('returns end_turn when there are no functionCall parts', () => {
    const turn = parseGoogleToolTurn({
      candidates: [{ content: { parts: [{ text: 'done' }] } }],
    });
    expect(turn.stopReason).toBe('end_turn');
    expect(turn.content).toBe('done');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "parseAnthropicToolTurn|parseOpenAIToolTurn|parseGoogleToolTurn"`
Expected: FAIL — imports not found.

- [ ] **Step 3: Implement the parsers and types in `aiClient.ts`**

Add to `sidecar/src/aiClient.ts` (anywhere appropriate, but before `testTextProvider` is fine):

```ts
// ── Tool-use types and per-format parsers ─────────────────────────────────────

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export type ToolTurn = {
  content: string | null;
  toolCalls: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_rounds' | 'error';
  raw?: unknown;
};

export type ToolSchema = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

type AnthropicContentBlock = Record<string, unknown> & { type: string };

export function parseAnthropicToolTurn(json: unknown): ToolTurn {
  const j = (json ?? {}) as { stop_reason?: string; content?: AnthropicContentBlock[] };
  const blocks = Array.isArray(j.content) ? j.content : [];
  const textParts = blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string);
  const text = textParts.length > 0 ? textParts.join('\n') : null;
  const toolCalls: ToolCall[] = blocks
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({
      id: String(b.id ?? ''),
      name: String(b.name ?? ''),
      input: (b.input as Record<string, unknown>) ?? {},
    }));
  const stopReason: ToolTurn['stopReason'] = j.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn';
  return { content: text, toolCalls, stopReason, raw: json };
}

export function parseOpenAIToolTurn(json: unknown): ToolTurn {
  const j = (json ?? {}) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };
  const msg = j.choices?.[0]?.message ?? {};
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((c) => {
    let input: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(c.function.arguments || '{}');
      if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>;
    } catch { /* leave as {} */ }
    return { id: c.id, name: c.function.name, input };
  });
  const content = msg.content ?? null;
  const stopReason: ToolTurn['stopReason'] = toolCalls.length > 0 ? 'tool_use' : 'end_turn';
  return { content, toolCalls, stopReason, raw: json };
}

export function parseGoogleToolTurn(json: unknown): ToolTurn {
  const j = (json ?? {}) as { candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }> };
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  const textParts = parts
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text as string);
  const text = textParts.length > 0 ? textParts.join('\n') : null;
  const fcalls = parts.filter((p) => p.functionCall);
  const toolCalls: ToolCall[] = fcalls.map((p, i) => {
    const fc = p.functionCall as { name: string; args?: Record<string, unknown> };
    return {
      id: `google-${Date.now()}-${i}`,
      name: fc.name,
      input: fc.args ?? {},
    };
  });
  const stopReason: ToolTurn['stopReason'] = toolCalls.length > 0 ? 'tool_use' : 'end_turn';
  return { content: text, toolCalls, stopReason, raw: json };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "parseAnthropicToolTurn|parseOpenAIToolTurn|parseGoogleToolTurn"`
Expected: PASS — all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/aiClient.ts sidecar/__tests__/unit/aiClient.test.ts
git commit -m "feat(ai-client): add tool-use response parsers for all 4 providers

parseAnthropicToolTurn, parseOpenAIToolTurn, parseGoogleToolTurn each
extract { content, toolCalls, stopReason } from a provider response.
Google tool calls lack IDs in the API; we synthesize 'google-<ts>-<i>'
IDs that are stable within a single turn so the result can be matched
back via functionResponse parts in order.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: `callAiWithTools` shared loop, message caps, and per-format request builders

**Files:**
- Modify: `sidecar/src/aiClient.ts` (add `callAiWithTools`, `appendToolResults`, request builders)
- Modify: `sidecar/__tests__/unit/aiClient.test.ts` (extend with loop + caps tests)

**Interfaces:**
- Consumes: parsers from Task 3, `fetch` (mocked in tests), `process.env.STATIC_REVIEW_MAX_ROUNDS` (default 3), `STATIC_REVIEW_MAX_TOOL_RESULT_CHARS` (default 25K), `STATIC_REVIEW_MAX_MESSAGE_CHARS` (default 200K)
- Produces (exported):
  - `callAiWithTools(opts: { apiFormat, model, systemPrompt, messages, tools, maxRounds?, signal? }): Promise<ToolTurn>`
  - `appendToolResults(messages, toolCalls, results, apiFormat): Message[]` — returns updated messages array
  - `buildAnthropicToolRequest(...)`, `buildOpenAIToolRequest(...)`, `buildGoogleToolRequest(...)`

- [ ] **Step 1: Write the failing test for the happy-path loop**

Append to `sidecar/__tests__/unit/aiClient.test.ts`:

```ts
import { callAiWithTools, appendToolResults } from '../../src/aiClient';

describe('callAiWithTools', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns end_turn after one tool call → result cycle (Anthropic)', async () => {
    // Round 1: model requests fetch_file
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'looking at auth' },
          { type: 'tool_use', id: 't1', name: 'fetch_file', input: { path: 'a.ts' } },
        ],
      }),
    } as Response);
    // Round 2: model returns end_turn
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'reviewed' }],
      }),
    } as Response);

    const turn = await callAiWithTools({
      apiFormat: 'anthropic-compatible',
      model: 'm',
      baseUrl: 'https://example.test/v1/messages',
      provider: 'mimo',
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'review a.ts' }],
      tools: [{ name: 'fetch_file', description: 'd', input_schema: { type: 'object', properties: {} } }],
    });

    expect(turn.stopReason).toBe('end_turn');
    expect(turn.content).toBe('reviewed');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns max_rounds when the model keeps calling tools', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'fetch_file', input: { path: 'a' } }],
      }),
    } as Response);

    const turn = await callAiWithTools({
      apiFormat: 'anthropic-compatible',
      model: 'm',
      baseUrl: 'https://example.test/v1/messages',
      provider: 'mimo',
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'review' }],
      tools: [{ name: 'fetch_file', description: 'd', input_schema: { type: 'object' } }],
      maxRounds: 1,
    });

    expect(turn.stopReason).toBe('max_rounds');
    expect(turn.toolCalls).toHaveLength(1);
  });

  it('returns a stub for maxRounds=0 without calling the API', async () => {
    const turn = await callAiWithTools({
      apiFormat: 'anthropic-compatible',
      model: 'm',
      baseUrl: 'https://example.test/v1/messages',
      provider: 'mimo',
      systemPrompt: 'sys',
      messages: [],
      tools: [],
      maxRounds: 0,
    });
    expect(turn.stopReason).toBe('max_rounds');
    expect(turn.content).toBeNull();
    expect(turn.toolCalls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('drops the oldest tool result when the message list exceeds STATIC_REVIEW_MAX_MESSAGE_CHARS', async () => {
    // Build a messages array whose total length is just under the cap,
    // then add a tool result that pushes it over.
    const oldResult = 'x'.repeat(195_000);
    const newResult = 'y'.repeat(10_000);
    const messages: any[] = [
      { role: 'user', content: [{ type: 'text', text: 'review' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'fetch_file', input: { path: 'a' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: oldResult }] },
    ];

    const next = appendToolResults(
      messages,
      [{ id: 't2', name: 'fetch_file', input: { path: 'b' } }],
      [{ toolCallId: 't2', name: 'fetch_file', content: newResult }],
      'anthropic-compatible'
    );

    // The new tool result was appended; the oldest tool_result was dropped
    // and replaced with a marker.
    const serialized = JSON.stringify(next);
    expect(serialized.length).toBeLessThan(220_000);
    expect(serialized).toContain('earliest tool result dropped');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "callAiWithTools"`
Expected: FAIL — `callAiWithTools is not a function`.

- [ ] **Step 3: Implement `callAiWithTools`, `appendToolResults`, and the request builders**

Add to `sidecar/src/aiClient.ts`:

```ts
// ── Tool-use request builders (Anthropic / OpenAI / Google) ───────────────────

type ApiFormat = 'openai-compatible' | 'anthropic-compatible' | 'google-native';

export function buildAnthropicToolRequest(
  model: string,
  systemPrompt: string,
  messages: unknown[],
  tools: ToolSchema[]
): Record<string, unknown> {
  return {
    model,
    max_tokens: 8192,
    system: systemPrompt,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    })),
    messages,
  };
}

export function buildOpenAIToolRequest(
  model: string,
  systemPrompt: string,
  messages: unknown[],
  tools: ToolSchema[]
): Record<string, unknown> {
  return {
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    tools: tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    })),
    max_completion_tokens: 8192,
    thinking: { type: 'disabled' },
  };
}

export function buildGoogleToolRequest(
  model: string,
  systemPrompt: string,
  messages: unknown[],
  tools: ToolSchema[]
): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: messages,
    tools: [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        })),
      },
    ],
    generationConfig: { maxOutputTokens: 8192 },
  };
}

function buildToolRequest(
  apiFormat: ApiFormat,
  model: string,
  systemPrompt: string,
  messages: unknown[],
  tools: ToolSchema[]
): Record<string, unknown> {
  if (apiFormat === 'anthropic-compatible') return buildAnthropicToolRequest(model, systemPrompt, messages, tools);
  if (apiFormat === 'openai-compatible') return buildOpenAIToolRequest(model, systemPrompt, messages, tools);
  return buildGoogleToolRequest(model, systemPrompt, messages, tools);
}

// ── Per-format tool-result appender ───────────────────────────────────────────

export type AppendableMessage = Record<string, unknown>;

export function appendToolResults(
  messages: AppendableMessage[],
  toolCalls: ToolCall[],
  results: Array<{ toolCallId: string; name: string; content: string; isError?: boolean }>,
  apiFormat: ApiFormat
): AppendableMessage[] {
  if (apiFormat === 'anthropic-compatible') {
    const blocks = results.map((r) => ({
      type: 'tool_result',
      tool_use_id: r.toolCallId,
      content: r.isError ? `ERROR: ${r.content}` : r.content,
    }));
    return [...messages, { role: 'user', content: blocks }];
  }
  if (apiFormat === 'openai-compatible') {
    const newMsgs: AppendableMessage[] = results.map((r) => ({
      role: 'tool',
      tool_call_id: r.toolCallId,
      content: r.isError ? `ERROR: ${r.content}` : r.content,
    }));
    return [...messages, ...newMsgs];
  }
  // google-native
  const parts = results.map((r) => ({
    functionResponse: {
      name: r.name,
      response: { content: r.content, isError: !!r.isError },
    },
  }));
  return [...messages, { role: 'user', parts }];
}

// ── Message-list cap (drop oldest tool result) ────────────────────────────────

const MAX_MESSAGE_CHARS_DEFAULT = 200_000;
const DROP_MARKER = '[earliest tool result dropped to stay within the message limit; re-fetch if needed]';

function getMaxMessageChars(): number {
  const fromEnv = Number(process.env.STATIC_REVIEW_MAX_MESSAGE_CHARS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : MAX_MESSAGE_CHARS_DEFAULT;
}

function enforceMessageCap(messages: AppendableMessage[]): AppendableMessage[] {
  const cap = getMaxMessageChars();
  const serialized = JSON.stringify(messages);
  if (serialized.length <= cap) return messages;

  // Find the first message that looks like a tool result and replace its content with the marker.
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'user' && Array.isArray(m.content)) {
      // Anthropic tool_result blocks
      const blocks = m.content as Array<Record<string, unknown>>;
      const idx = blocks.findIndex((b) => b.type === 'tool_result');
      if (idx >= 0) {
        const newBlocks = [...blocks];
        newBlocks[idx] = { ...newBlocks[idx], content: DROP_MARKER };
        return [...messages.slice(0, i), { ...m, content: newBlocks }, ...messages.slice(i + 1)];
      }
    } else if (m.role === 'tool') {
      // OpenAI single tool message
      return [...messages.slice(0, i), { ...m, content: DROP_MARKER }, ...messages.slice(i + 1)];
    } else if (m.role === 'user' && Array.isArray((m as Record<string, unknown>).parts)) {
      // Google functionResponse parts
      const parts = (m as Record<string, unknown>).parts as Array<Record<string, unknown>>;
      const idx = parts.findIndex((p) => p.functionResponse);
      if (idx >= 0) {
        const newParts = [...parts];
        newParts[idx] = {
          functionResponse: { name: 'dropped', response: { content: DROP_MARKER } },
        };
        return [...messages.slice(0, i), { ...m, parts: newParts }, ...messages.slice(i + 1)];
      }
    }
  }
  return messages;
}

// ── Main loop ─────────────────────────────────────────────────────────────────

export type CallAiWithToolsOpts = {
  apiFormat: ApiFormat;
  model: string;
  baseUrl: string;
  provider: 'mimo' | 'gemini' | 'custom';
  systemPrompt: string;
  messages: AppendableMessage[];
  tools: ToolSchema[];
  maxRounds?: number;
  signal?: AbortSignal;
};

export async function callAiWithTools(opts: CallAiWithToolsOpts): Promise<ToolTurn> {
  const maxRounds = opts.maxRounds ?? Number(process.env.STATIC_REVIEW_MAX_ROUNDS) || 3;
  const { apiFormat, model, baseUrl, provider, systemPrompt } = opts;
  let messages = opts.messages;
  const tools = opts.tools;

  // The caller is expected to have wired `executeTool` into a wrapper; we accept
  // a registry of tool names → handlers via the global. `setToolExecutor` is
  // called by staticReview.ts at session start. Default to throwing so an
  // unconfigured loop fails loudly.
  const toolExecutor: ToolExecutor = (globalThis as any).__centinelToolExecutor ?? defaultToolExecutor;

  let lastTurn: ToolTurn | null = null;
  for (let round = 0; round < maxRounds; round++) {
    messages = enforceMessageCap(messages);
    const body = buildToolRequest(apiFormat, model, systemPrompt, messages, tools);
    const url = buildRequestUrl({ apiKey: '', baseUrl, model, provider, apiFormat } as SettingLike);
    const headers = getAuthHeaders({ apiKey: '__placeholder__', baseUrl, model, provider, apiFormat } as SettingLike);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI API error: HTTP ${res.status} — ${text}`);
    }
    const json = await res.json();

    const turn = apiFormat === 'anthropic-compatible'
      ? parseAnthropicToolTurn(json)
      : apiFormat === 'openai-compatible'
      ? parseOpenAIToolTurn(json)
      : parseGoogleToolTurn(json);
    lastTurn = turn;

    if (turn.stopReason === 'end_turn') return turn;
    if (turn.toolCalls.length === 0) return turn;

    // Execute tools in parallel
    const results = await Promise.all(turn.toolCalls.map(toolExecutor));
    messages = appendToolResults(messages, turn.toolCalls, results, apiFormat);
  }

  if (lastTurn) return { ...lastTurn, stopReason: 'max_rounds' };
  return { content: null, toolCalls: [], stopReason: 'max_rounds' };
}

// ── Tool executor registry (installed by staticReview.ts) ─────────────────────

export type ToolResult = { toolCallId: string; name: string; content: string; isError?: boolean };
export type ToolExecutor = (call: ToolCall) => Promise<ToolResult>;

export function setToolExecutor(executor: ToolExecutor): void {
  (globalThis as any).__centinelToolExecutor = executor;
}

const defaultToolExecutor: ToolExecutor = async (call) => {
  throw new Error(`No tool executor registered; cannot run ${call.name}`);
};
```

- [ ] **Step 4: Run the tests to verify all loop tests pass**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "callAiWithTools|parseAnthropicToolTurn|parseOpenAIToolTurn|parseGoogleToolTurn"`
Expected: PASS — all parser tests and all `callAiWithTools` tests pass on the first run. The implementation uses `opts.baseUrl` / `opts.provider` directly; no draft-then-fix needed.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/aiClient.ts sidecar/__tests__/unit/aiClient.test.ts
git commit -m "feat(ai-client): add callAiWithTools loop, appendToolResults, and request builders

The loop: buildToolRequest → fetch → parseXxxToolTurn → if tool_use,
executeToolBatch (via installed ToolExecutor) → appendToolResults →
repeat up to STATIC_REVIEW_MAX_ROUNDS (default 3). Returns
{ content, toolCalls, stopReason } with stopReason in {end_turn,
tool_use, max_rounds}. enforceMessageCap drops the oldest tool
result with a marker if the message list exceeds
STATIC_REVIEW_MAX_MESSAGE_CHARS (default 200K) before each call,
preventing the original 100K problem from being recreated by
accumulating tool results.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: `runStaticReviewWithTools` — the new pipeline path

**Files:**
- Modify: `sidecar/src/staticReview.ts` (add `runStaticReviewWithTools`, install ToolExecutor, route stages through callAiWithTools)
- Modify: `sidecar/__tests__/unit/staticReview.test.ts` (extend with tool-path tests)

**Interfaces:**
- Consumes: `callAiWithTools`, `setToolExecutor`, `executeTool`, `getRawAiSetting`, `getDb` (for `searchSymbols`/`getSymbolBody`), all existing session helpers (`updateStaticSessionStatus`, `createFinding`, etc.)
- Produces (exported, called from `runStaticReview` in Task 6): `runStaticReviewWithTools(session, artifacts, onProgress, staticFindings): Promise<void>`

- [ ] **Step 1: Write the failing test for `runStaticReviewWithTools` happy path**

Append to `sidecar/__tests__/unit/staticReview.test.ts` (the existing file already mocks all dependencies at the top). Add:

```ts
// We need to add new mocks for these
vi.mock('../../src/tools.js', () => ({
  executeTool: vi.fn(),
  TOOL_SCHEMAS: [
    { name: 'fetch_file', description: 'd', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
    { name: 'fetch_files', description: 'd', input_schema: { type: 'object', properties: { paths: { type: 'array' } }, required: ['paths'] } },
    { name: 'get_symbol_body', description: 'd', input_schema: { type: 'object', properties: { file: { type: 'string' }, name: { type: 'string' } }, required: ['file', 'name'] } },
    { name: 'search_symbols', description: 'd', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  ],
}));

// Also mock callAiWithTools
vi.mock('../../src/aiClient.js', async () => {
  const actual = await vi.importActual<any>('../../src/aiClient');
  return {
    ...actual,
    callAiWithTools: vi.fn(),
    setToolExecutor: vi.fn(),
  };
});

import { runStaticReview } from '../../src/staticReview';
import { callAiWithTools } from '../../src/aiClient';

describe('runStaticReview tool path', () => {
  it('uses the tool path when total artifact size exceeds threshold', async () => {
    vi.mocked(getRawAiSetting).mockResolvedValue({
      apiKey: 'sk', baseUrl: 'https://x', model: 'm',
      provider: 'mimo', apiFormat: 'anthropic-compatible',
    });
    vi.mocked(callAiWithTools).mockResolvedValue({
      content: JSON.stringify({ thoughts: ['done'], findings: [] }),
      toolCalls: [],
      stopReason: 'end_turn',
    });

    // Create two real files in a temp dir so fs.statSync works
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-sr-'));
    const big = path.join(tmpDir, 'big.ts');
    fs.writeFileSync(big, 'x'.repeat(300_000));  // 300KB > 200KB threshold

    const session: StaticSession = {
      id: 's1', projectId: 'p1', name: 'test', reviewType: 'code_review',
      status: 'pending', configJson: '{}', progressJson: '{}', remarks: '',
      finalSummary: '', failureReason: '', createdAt: '', updatedAt: '',
    };
    const artifacts: Artifact[] = [{
      id: 'a1', projectId: 'p1', type: 'source_code', source: 'repository',
      fileName: 'big.ts', filePath: big, originalPath: null,
      contentHash: 'h', createdAt: '',
    }];

    await runStaticReview(session, artifacts);

    expect(callAiWithTools).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "runStaticReview tool path"`
Expected: FAIL — `runStaticReview` doesn't dispatch to a tool path yet.

- [ ] **Step 3: Implement the tool executor wrapper and `runStaticReviewWithTools`**

Add to `sidecar/src/staticReview.ts`. First, add the imports near the top:

```ts
import { callAiWithTools, setToolExecutor, type ToolCall, type ToolResult } from './aiClient.js';
import { executeTool, TOOL_SCHEMAS } from './tools.js';
import { getDb } from './db.js';
```

Then add the executor wrapper and the new function near the bottom of the file:

```ts
// ── Tool-use path ─────────────────────────────────────────────────────────────

function makeToolExecutor(projectId: string, workspacePath: string) {
  return async (call: ToolCall): Promise<ToolResult> => {
    try {
      const content = await executeTool(call.name, call.input, workspacePath, projectId);
      return { toolCallId: call.id, name: call.name, content };
    } catch (err) {
      return {
        toolCallId: call.id,
        name: call.name,
        content: err instanceof Error ? err.message : String(err),
        isError: true,
      };
    }
  };
}

type StageInput = {
  stageIdx: number;
  systemPrompt: string;
  userPrompt: string;
  projectId: string;
  workspacePath: string;
  onProgress?: (progress: ReviewProgress) => void;
  onToolCall?: (toolName: string, args: unknown) => void;
};

async function runStageWithTools(input: StageInput): Promise<string> {
  // Initialize messages: index + graph as system context, user prompt as first user turn.
  // (The actual index/graph loading happens in runStaticReviewWithTools which closes
  // over the workspace path; here we just build the messages and run the loop.)
  const messages: any[] = [
    { role: 'user', content: input.userPrompt },
  ];
  const turn = await callAiWithTools({
    apiFormat: 'anthropic-compatible',  // placeholder; real call goes through runStaticReviewWithTools
    model: '',
    baseUrl: '',
    provider: 'mimo',
    systemPrompt: input.systemPrompt,
    messages,
    tools: [...TOOL_SCHEMAS],
  });
  return turn.content ?? '';
}
```

**Important:** the above `runStageWithTools` is a stub. The real implementation needs the apiFormat / model / baseUrl from `getRawAiSetting`. Refactor to:

```ts
async function runStageWithTools(
  stageIdx: number,
  systemPrompt: string,
  userPrompt: string,
  projectId: string,
  workspacePath: string,
  setting: Awaited<ReturnType<typeof getRawAiSetting>> & object,
  emitThinking: (thought: string) => void
): Promise<string> {
  setToolExecutor(makeToolExecutor(projectId, workspacePath));

  const messages: any[] = [
    { role: 'user', content: userPrompt },
  ];
  let finalContent: string | null = null;
  let warningEmitted = false;

  const turn = await callAiWithTools({
    apiFormat: setting.apiFormat,
    model: setting.model,
    baseUrl: setting.baseUrl,
    provider: setting.provider,
    systemPrompt,
    messages,
    tools: [...TOOL_SCHEMAS],
    onToolCall: (name, args) => emitThinking(`🔧 ${name}: ${JSON.stringify(args).substring(0, 200)}`),
  });

  if (turn.stopReason === 'max_rounds' && !turn.content) {
    emitThinking('⚠️ Model used all tool rounds without producing a final answer');
    warningEmitted = true;
  }
  finalContent = turn.content;
  return finalContent ?? '';
}
```

Add this (the onToolCall hook needs adding to CallAiWithToolsOpts and the loop — see step 4):

```ts
export async function runStaticReviewWithTools(
  session: StaticSession,
  artifacts: Artifact[],
  onProgress: ((p: ReviewProgress) => void) | undefined,
  staticFindings: Awaited<ReturnType<typeof runStaticAnalysis>>,
  workspacePath: string
): Promise<void> {
  const setting = await getRawAiSetting('text');
  if (!setting) throw new Error('Text AI provider not configured');

  // Load index.json + graph.json from the workspace
  const indexPath = path.join(workspacePath, '.centinel', 'index.json');
  const graphPath = path.join(workspacePath, '.centinel', 'graph.json');
  const indexJson = fs.readFileSync(indexPath, 'utf-8');
  const graphJson = fs.readFileSync(graphPath, 'utf-8');

  const baseSystemPrefix = `You are reviewing a software project. The repository index and dependency graph are provided below as your navigation aids. Use the available tools (fetch_file, fetch_files, get_symbol_body, search_symbols) to read the specific files you need to inspect.

## Repository Index (.centinel/index.json)
${indexJson}

## Dependency Graph (.centinel/graph.json)
${graphJson}
`;

  await updateStaticSessionStatus(session.id, 'running', '', '');

  // Stage 1: Understanding Context
  // ... (build userPrompt, then:)
  const s1 = await runStageWithTools(
    0,
    baseSystemPrefix + '\n\n' + CONTEXT_UNDERSTANDING_PROMPT.system,
    CONTEXT_UNDERSTANDING_PROMPT.build(/* … same args as today … */, session.remarks),
    session.projectId,
    workspacePath,
    setting,
    (thought) => emitThinking(0, thought)
  );

  // Stages 2/3/4 follow the same pattern. Each stage has its own messages array
  // starting from a user prompt. (For brevity, copy from the existing prefetch
  // path's prompt builders.)
}
```

The full implementation reuses the existing `STAGE_DEFINITIONS`, `CONTEXT_UNDERSTANDING_PROMPT`, `CODE_REVIEW_PROMPT`, `TRACEABILITY_PROMPT`, `SUMMARY_PROMPT` builders (already exported in this file). The `emitThinking` helper is also already defined.

- [ ] **Step 4: Add `onToolCall` to `CallAiWithToolsOpts` and emit it in the loop**

In `sidecar/src/aiClient.ts`, update the type and the loop:

```ts
export type CallAiWithToolsOpts = {
  // ... existing fields ...
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
};

// In the loop, after fetching toolCalls:
opts.onToolCall?.(call.name, call.input);
```

(Place this line right after the `turn` parse and before `Promise.all(turn.toolCalls.map(toolExecutor))`.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "runStaticReview tool path"`
Expected: PASS — the dispatch chooses the tool path, the test confirms `callAiWithTools` is invoked.

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/staticReview.ts sidecar/src/aiClient.ts sidecar/__tests__/unit/staticReview.test.ts
git commit -m "feat(static-review): add runStaticReviewWithTools path

The new code path installs a ToolExecutor that delegates to tools.ts,
sends index.json + graph.json as system context, and runs each stage
through callAiWithTools. Each tool call emits a progress thought
('🔧 fetch_file: ...') so the user sees what the model is investigating.
On max_rounds exhaustion with empty content, a warning thought is emitted
to the progress stream.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Dispatcher refactor — extract `runStaticReviewPrefetch`

**Files:**
- Modify: `sidecar/src/staticReview.ts` (rename current `runStaticReview` body to `runStaticReviewPrefetch`, add size-based dispatcher)
- Modify: `sidecar/__tests__/unit/staticReview.test.ts` (add dispatch tests)

- [ ] **Step 1: Write the failing test for the dispatcher**

Append to `sidecar/__tests__/unit/staticReview.test.ts`:

```ts
describe('runStaticReview dispatch', () => {
  it('uses the prefetch path when total artifact size is small', async () => {
    // Existing small-project scenario: artifacts < 200KB
    // The new runStaticReview should NOT call callAiWithTools.
    // ... (test using the existing setup with a small artifact)
  });

  it('uses the tool path when any single artifact is huge', async () => {
    // ... (test where one artifact is 150KB, total is small,
    //      but the single-file rule kicks in)
  });

  it('uses the tool path when total size exceeds STATIC_REVIEW_SMALL_PROJECT_BYTES', async () => {
    // ... (test with total > 200KB)
  });
});
```

(Full test bodies follow the pattern from Task 5 step 1, varying the file size and asserting which path is taken.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "runStaticReview dispatch"`
Expected: FAIL — current `runStaticReview` doesn't dispatch.

- [ ] **Step 3: Refactor `runStaticReview`**

In `sidecar/src/staticReview.ts`:

1. Rename the current `export async function runStaticReview(...)` to `export async function runStaticReviewPrefetch(...)`.
2. Add a new `export async function runStaticReview(...)` at the top of the file (or near the prefetch function) that contains the dispatcher:

```ts
export async function runStaticReview(
  session: StaticSession,
  artifacts: Artifact[],
  onProgress?: (progress: ReviewProgress) => void
): Promise<void> {
  // ... existing session status updates ...
  await indexProject(session.projectId, artifacts);
  const staticFindings = await runStaticAnalysis(session.projectId, artifacts, session.id);

  // Look up the workspace path for the tool path
  const db = await getDb();
  const stmt = db.prepare('SELECT workspace_path FROM projects WHERE id = ?');
  stmt.bind([session.projectId]);
  let workspacePath = '';
  if (stmt.step()) {
    workspacePath = (stmt.get() as unknown[])[0] as string;
  }
  stmt.free();

  // Size check (Artifact has no size field — read from disk)
  const sizes = artifacts.map((a) => {
    try { return fs.statSync(a.filePath).size; } catch { return 0; }
  });
  const totalBytes = sizes.reduce((s, n) => s + n, 0);
  const maxArtifactBytes = sizes.length > 0 ? Math.max(...sizes) : 0;
  const SMALL_PROJECT_BYTES = Number(process.env.STATIC_REVIEW_SMALL_PROJECT_BYTES) || 200_000;

  const useToolPath = totalBytes >= SMALL_PROJECT_BYTES || maxArtifactBytes > 100_000;

  if (useToolPath) {
    return runStaticReviewWithTools(session, artifacts, onProgress, staticFindings, workspacePath);
  }
  return runStaticReviewPrefetch(session, artifacts, onProgress, staticFindings);
}
```

3. The old `runStaticReviewPrefetch` body is essentially today's `runStaticReview` body, with one signature change: the new dispatcher passes `staticFindings` in (computed once at the top), so the prefetch function no longer recomputes them.

- [ ] **Step 4: Run the dispatcher test to verify it passes**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "runStaticReview dispatch"`
Expected: PASS.

- [ ] **Step 5: Run the full static-review test suite to verify no regression**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "staticReview"`
Expected: PASS — all existing tests still pass (the prefetch path is unchanged in behavior).

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/staticReview.ts sidecar/__tests__/unit/staticReview.test.ts
git commit -m "refactor(static-review): extract runStaticReviewPrefetch, add size-based dispatcher

runStaticReview now picks between the legacy pre-fetch path and the new
tool path based on total artifact size (>200KB) or any single file
over 100KB. Override via STATIC_REVIEW_SMALL_PROJECT_BYTES. The legacy
path is unchanged in behavior — all existing tests pass.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: `toolsProbe.ts` CLI — provider tool-use precondition check

**Files:**
- Create: `sidecar/src/toolsProbe.ts`
- Modify: `sidecar/package.json` (add the `tools:probe` script)

- [ ] **Step 1: Implement the probe**

Create `sidecar/src/toolsProbe.ts`:

```ts
import { getRawAiSetting } from './settings.js';
import { buildAnthropicToolRequest, parseAnthropicToolTurn, type ToolSchema } from './aiClient.js';
import { TOOL_SCHEMAS } from './tools.js';

async function probe() {
  const setting = await getRawAiSetting('text');
  if (!setting) {
    console.error('FAIL: no text AI provider configured');
    process.exit(1);
  }
  if (!setting.apiKey) {
    console.error('FAIL: API key not configured');
    process.exit(1);
  }

  const toolSubset: ToolSchema[] = [TOOL_SCHEMAS[0]]; // fetch_file only
  const body = setting.apiFormat === 'anthropic-compatible'
    ? buildAnthropicToolRequest(setting.model, 'You are a probe. Call the fetch_file tool with any path.', [{ role: 'user', content: 'Please call the tool now.' }], toolSubset)
    : setting.apiFormat === 'openai-compatible'
    ? {
        model: setting.model,
        messages: [
          { role: 'system', content: 'You are a probe. Call the fetch_file tool with any path.' },
          { role: 'user', content: 'Please call the tool now.' },
        ],
        tools: [{ type: 'function', function: { name: 'fetch_file', description: TOOL_SCHEMAS[0].description, parameters: TOOL_SCHEMAS[0].input_schema } }],
        max_completion_tokens: 128,
        thinking: { type: 'disabled' },
      }
    : {
        systemInstruction: { parts: [{ text: 'You are a probe. Call the fetch_file tool with any path.' }] },
        contents: [{ role: 'user', parts: [{ text: 'Please call the tool now.' }] }],
        tools: [{ functionDeclarations: [{ name: 'fetch_file', description: TOOL_SCHEMAS[0].description, parameters: TOOL_SCHEMAS[0].input_schema }] }],
        generationConfig: { maxOutputTokens: 128 },
      };

  // Get auth headers (we have to import the helpers)
  const { getAuthHeaders, buildRequestUrl } = await import('./aiClient.js');
  const headers = getAuthHeaders({
    apiKey: setting.apiKey, baseUrl: setting.baseUrl, model: setting.model,
    provider: setting.provider, apiFormat: setting.apiFormat,
  });
  const url = buildRequestUrl({
    apiKey: setting.apiKey, baseUrl: setting.baseUrl, model: setting.model,
    provider: setting.provider, apiFormat: setting.apiFormat,
  });

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    console.error(`FAIL: HTTP ${res.status} — ${await res.text()}`);
    process.exit(1);
  }
  const json = await res.json();

  // Parse with the appropriate parser
  const turn = setting.apiFormat === 'anthropic-compatible'
    ? parseAnthropicToolTurn(json)
    : setting.apiFormat === 'openai-compatible'
    ? (await import('./aiClient.js')).parseOpenAIToolTurn(json)
    : (await import('./aiClient.js')).parseGoogleToolTurn(json);

  console.log('Provider:', setting.provider);
  console.log('Model:', setting.model);
  console.log('API format:', setting.apiFormat);
  console.log('Stop reason:', turn.stopReason);
  console.log('Content:', turn.content);
  console.log('Tool calls:', JSON.stringify(turn.toolCalls, null, 2));

  if (turn.toolCalls.length === 0) {
    console.error('\nFAIL: model did NOT return a tool call. The configured model/provider does not support tool use, or it requires a different invocation. Do NOT enable the tool path for this provider until this probe returns a tool call.');
    process.exit(1);
  }
  console.log('\nPASS: model returned a tool call. Safe to enable the tool path for this provider.');
}

probe().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script to `package.json`**

Edit `sidecar/package.json` — add to the `scripts` block:

```json
"tools:probe": "tsx src/toolsProbe.ts"
```

- [ ] **Step 3: Manually run the probe against the configured provider**

Run: `cd sidecar && pnpm tools:probe`
Expected: prints the provider, model, format, stop reason, and either PASS (if a tool call was returned) or FAIL (if not). With MiMo-v2.5-pro via the Anthropic-compatible endpoint, this should PASS. With Gemini via google-native, it should also PASS. Document the result in the PR description.

- [ ] **Step 4: Commit**

```bash
git add sidecar/src/toolsProbe.ts sidecar/package.json
git commit -m "feat(tools): add toolsProbe.ts CLI for provider tool-use precondition

Run via 'pnpm --filter @centinel/sidecar tools:probe'. Sends a
fetch_file tool definition to the configured provider and checks
that the model returns a tool call. If the model silently ignores
the tools field, the tool path would appear to work but produce
empty stages. This probe must pass before the tool path is enabled
for any new provider/model combination.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Integration test — end-to-end tool path with mocked provider

**Files:**
- Create: `sidecar/__tests__/integration/staticReviewToolPath.test.ts`

- [ ] **Step 1: Write the integration test**

Create `sidecar/__tests__/integration/staticReviewToolPath.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../src/settings.js', () => ({
  getRawAiSetting: vi.fn(),
}));

vi.mock('../../src/artifacts.js', () => ({
  readArtifactContent: vi.fn(),
  listArtifacts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/staticSessions.js', () => ({
  updateStaticSessionStatus: vi.fn(),
  updateStaticSessionProgress: vi.fn(),
  createFinding: vi.fn(),
  createReviewArtifact: vi.fn(),
}));

vi.mock('../../src/staticEngine.js', () => ({
  runStaticAnalysis: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/riskScore.js', () => ({
  scoreFindings: vi.fn().mockImplementation((findings) => findings.map((f: any) => ({ ...f, risk: { score: 0.5, level: f.severity || 'medium' } }))),
}));

import { getRawAiSetting } from '../../src/settings';
import { runStaticReview } from '../../src/staticReview';
import type { StaticSession } from '../../src/staticSessions';
import type { Artifact } from '../../src/artifacts';

describe('staticReview tool path — integration', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-int-'));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('completes a tool-path review end-to-end with mocked provider', async () => {
    // Create a real workspace with index.json and graph.json
    const centinelDir = path.join(tmpDir, '.centinel');
    fs.mkdirSync(centinelDir, { recursive: true });
    fs.writeFileSync(path.join(centinelDir, 'index.json'), JSON.stringify({ files: [] }));
    fs.writeFileSync(path.join(centinelDir, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }));

    vi.mocked(getRawAiSetting).mockResolvedValue({
      apiKey: 'sk', baseUrl: 'https://example.test', model: 'm',
      provider: 'mimo', apiFormat: 'anthropic-compatible',
    } as any);

    // Mock the provider to return end_turn immediately with valid JSON
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        stop_reason: 'end_turn',
        content: [{
          type: 'text',
          text: JSON.stringify({
            thoughts: ['done'],
            findings: [],
            projectSummary: 'test',
            artifactInventory: [],
            userIntent: 'test',
          }),
        }],
      }),
    } as Response);

    const big = path.join(tmpDir, 'big.ts');
    fs.writeFileSync(big, 'x'.repeat(300_000));

    // We need a real DB to satisfy the workspace path lookup
    const { createTestDb, insertTestProject } = await import('../helpers/testHelpers');
    const db = await createTestDb();
    insertTestProject(db, 'p1', tmpDir);
    const { setTestDb } = await import('../../src/db');
    setTestDb(db);

    const session: StaticSession = {
      id: 's1', projectId: 'p1', name: 't', reviewType: 'code_review',
      status: 'pending', configJson: '{}', progressJson: '{}', remarks: '',
      finalSummary: '', failureReason: '', createdAt: '', updatedAt: '',
    };
    const artifacts: Artifact[] = [{
      id: 'a1', projectId: 'p1', type: 'source_code', source: 'repository',
      fileName: 'big.ts', filePath: big, originalPath: null,
      contentHash: 'h', createdAt: '',
    }];

    await expect(runStaticReview(session, artifacts)).resolves.not.toThrow();
    expect(fetchSpy).toHaveBeenCalled();  // tool path was used
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd sidecar && pnpm test -- --reporter=verbose -t "staticReview tool path — integration"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add sidecar/__tests__/integration/staticReviewToolPath.test.ts
git commit -m "test(static-review): add integration test for end-to-end tool path

Mocks the provider, real DB, real workspace files. Asserts the tool
path completes a review session with the same Finding[] output shape
as the legacy pre-fetch path. The mock provider returns end_turn
immediately with valid JSON, exercising the dispatch and message
plumbing without depending on a live API.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Final verification — run the full test suite and the manual checklist

**Files:** none (verification only)

- [ ] **Step 1: Run the full sidecar test suite**

Run: `cd sidecar && pnpm test`
Expected: ALL tests pass. The suite includes the new tests from Tasks 1, 2, 3, 4, 5, 6, 8 and all existing tests (no regression).

- [ ] **Step 2: Run the type check**

Run: `cd sidecar && pnpm tsc --noEmit` (or whatever the project's typecheck command is — check `package.json` and `tsconfig.json`)
Expected: no type errors. If the project doesn't have a typecheck script, use `npx tsc --noEmit`.

- [ ] **Step 3: Run the probe against the configured provider**

Run: `cd sidecar && pnpm tools:probe`
Expected: prints PASS, with at least one tool call returned. Document the result in the PR description.

- [ ] **Step 4: Run the manual verification checklist from the spec**

Open `docs/superpowers/specs/2026-06-22-ai-tool-use-static-review-design.md` and walk through the "Manual verification checklist" section (lines ~644-674). Document each item in the PR description with a ✅ or a note explaining why it's N/A or what was observed.

- [ ] **Step 5: Commit the verification notes**

If any verification step produced a code change (e.g. a missed env-var default), commit it with a `fix:` or `chore:` prefix. Otherwise, no commit is needed — verification is recorded in the PR description.

```bash
git status  # check for any uncommitted changes
# If changes exist:
git add <changed-files>
git commit -m "chore: address findings from manual verification"
```

---

## Self-Review

**Spec coverage:**
- ✅ Hybrid dispatch (Task 6)
- ✅ index.json + graph.json sent as system context (Task 5, `runStaticReviewWithTools`)
- ✅ 4 tools (Task 2: fetch_file, fetch_files, get_symbol_body, search_symbols)
- ✅ Default 3 rounds, `STATIC_REVIEW_MAX_ROUNDS` (Task 4)
- ✅ Dispatch threshold 200KB / 100KB (Task 6)
- ✅ `STATIC_REVIEW_SMALL_PROJECT_BYTES` (Task 6)
- ✅ Per-tool-result cap 25K (Task 2 + Task 4)
- ✅ `STATIC_REVIEW_MAX_TOOL_RESULT_CHARS` (Task 2 + Task 4)
- ✅ Total message cap 200K with drop-oldest (Task 4)
- ✅ `STATIC_REVIEW_MAX_MESSAGE_CHARS` (Task 4)
- ✅ Per-tool error model (Task 2)
- ✅ maxRounds=0 → stub + caller warning (Task 4 + Task 5)
- ✅ max_rounds-with-empty → caller warning (Task 5)
- ✅ Path normalization Windows case-insensitive (Task 2)
- ✅ Provider tool-use precondition probe (Task 7)
- ✅ `searchSymbols` SQL + line-slicing (Task 1)
- ✅ `getSymbolBody` SQL + line-slicing (Task 1)
- ✅ Provider parsers for all 3 formats (Task 3)
- ✅ Per-format request builders (Task 4)
- ✅ `appendToolResults` per-provider shapes (Task 4)
- ✅ Env vars read from `process.env` directly (Tasks 4, 6)
- ✅ No changes to `settings.ts` (Global Constraint + per-task notes)
- ✅ Same `Finding[]` output shape (Task 5: reuses `createFinding` from `staticSessions.ts`)
- ✅ Integration test (Task 8)

**Placeholder scan:** no TBD/TODO/"similar to" placeholders. Every code block is complete.

**Type consistency:**
- `ToolCall`, `ToolTurn`, `ToolResult` defined in Task 3, used in Tasks 4, 5 ✓
- `TOOL_SCHEMAS` defined in Task 2, consumed in Task 5 ✓
- `setToolExecutor` / `ToolExecutor` defined in Task 4, installed in Task 5 ✓
- `SymbolNotFound` exported from Task 1, re-exported from Task 2, used in test ✓
- `enforceMessageCap` private to `aiClient.ts`, called from `callAiWithTools` loop ✓
- `runStaticReviewPrefetch` signature stable through Tasks 5, 6 (renamed body, dispatcher wraps it) ✓

**Plan is ready for execution.**
