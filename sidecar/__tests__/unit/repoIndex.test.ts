import { describe, it, expect } from 'vitest';
import { indexProject, getIndexedFiles, getFileSymbols, getDependencies, getDependents, searchSymbols, getSymbolBody } from '../../src/repoIndex.js';
import { setTestDb, clearTestDb, getDb } from '../../src/db.js';
import type { Artifact } from '../../src/artifacts.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

async function setupTestDb() {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
    workspace_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL,
    file_name TEXT NOT NULL, file_path TEXT NOT NULL, original_path TEXT,
    content_hash TEXT NOT NULL, source TEXT DEFAULT 'documents', created_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS repo_index (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, file_path TEXT NOT NULL,
    parent_path TEXT, file_type TEXT, language TEXT, file_size INTEGER,
    symbol_count INTEGER DEFAULT 0, indexed_at TEXT NOT NULL,
    module TEXT NOT NULL DEFAULT ''
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS code_symbols (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, file_id TEXT NOT NULL,
    symbol_type TEXT NOT NULL, name TEXT NOT NULL, start_line INTEGER,
    end_line INTEGER, signature TEXT, exports INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS code_relationships (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_file_id TEXT NOT NULL,
    target_file_path TEXT, target_symbol TEXT, relationship_type TEXT NOT NULL
  )`);
  setTestDb(db);
  return db;
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'test-artifact-1',
    projectId: 'test-project-1',
    type: 'source_code',
    source: 'repository',
    fileName: 'test.ts',
    filePath: '/tmp/test.ts',
    originalPath: null,
    contentHash: 'abc123',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function insertArtifact(db: any, artifact: Artifact) {
  db.run(
    'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [artifact.id, artifact.projectId, artifact.type, artifact.fileName, artifact.filePath, artifact.originalPath, artifact.contentHash, artifact.source, artifact.createdAt]
  );
}

describe('repoIndex', () => {
  describe('indexProject', () => {
    it('indexes TypeScript files and extracts symbols', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const testFile = '/tmp/test-repo-index.ts';
      fs.writeFileSync(testFile, `
        export function greet(name: string): string {
          return \`Hello \${name}\`;
        }

        export class User {
          constructor(public name: string) {}
          getName(): string { return this.name; }
        }

        import { useState } from 'react';
      `);

      const artifact = makeArtifact({
        id: 'idx-art-1',
        fileName: 'test-repo-index.ts',
        filePath: testFile,
      });
      await insertArtifact(db, artifact);

      await indexProject('test-project-1', [artifact]);

      const files = await getIndexedFiles('test-project-1');
      expect(files.length).toBe(1);
      expect(files[0].filePath).toBe(testFile);
      expect(files[0].language).toBe('typescript');

      const symbols = await getFileSymbols(files[0].id);
      expect(symbols.length).toBeGreaterThan(0);

      const symbolNames = symbols.map(s => s.name);
      expect(symbolNames).toContain('greet');
      expect(symbolNames).toContain('User');

      fs.unlinkSync(testFile);
      clearTestDb();
    });

    it('extracts import relationships', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const testFile = '/tmp/test-repo-imports.ts';
      fs.writeFileSync(testFile, `
        import { readFile } from 'fs';
        import path from 'path';
        export const x = 1;
      `);

      const artifact = makeArtifact({
        id: 'idx-art-2',
        fileName: 'test-repo-imports.ts',
        filePath: testFile,
      });
      await insertArtifact(db, artifact);

      await indexProject('test-project-1', [artifact]);

      const files = await getIndexedFiles('test-project-1');
      const deps = await getDependencies(files[0].id);
      expect(deps.length).toBeGreaterThanOrEqual(2);

      const depPaths = deps.map(d => d.targetFilePath);
      expect(depPaths).toContain('fs');
      expect(depPaths).toContain('path');

      fs.unlinkSync(testFile);
      clearTestDb();
    });

    it('handles unparseable files gracefully', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const testFile = '/tmp/test-repo-broken.ts';
      fs.writeFileSync(testFile, `this is not valid {{{ typescript code`);

      const artifact = makeArtifact({
        id: 'idx-art-3',
        fileName: 'test-repo-broken.ts',
        filePath: testFile,
      });
      await insertArtifact(db, artifact);

      // Should not throw
      await indexProject('test-project-1', [artifact]);

      const files = await getIndexedFiles('test-project-1');
      expect(files.length).toBe(1);
      expect(files[0].symbolCount).toBe(0);

      fs.unlinkSync(testFile);
      clearTestDb();
    });

    it('clears previous index before re-indexing', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const testFile = '/tmp/test-repo-reindex.ts';
      fs.writeFileSync(testFile, `export const x = 1;`);

      const artifact = makeArtifact({
        id: 'idx-art-4',
        fileName: 'test-repo-reindex.ts',
        filePath: testFile,
      });
      await insertArtifact(db, artifact);

      // Index twice
      await indexProject('test-project-1', [artifact]);
      await indexProject('test-project-1', [artifact]);

      const files = await getIndexedFiles('test-project-1');
      expect(files.length).toBe(1); // Should not duplicate

      fs.unlinkSync(testFile);
      clearTestDb();
    });
  });

  describe('getDependents', () => {
    it('returns reverse dependencies', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const fileA = '/tmp/test-dep-a.ts';
      const fileB = '/tmp/test-dep-b.ts';
      // Use absolute path in import to match what's stored in the database
      fs.writeFileSync(fileA, `import { helper } from '${fileB}'; export const a = 1;`);
      fs.writeFileSync(fileB, `export function helper() { return 42; }`);

      const artA = makeArtifact({ id: 'dep-a', fileName: 'test-dep-a.ts', filePath: fileA });
      const artB = makeArtifact({ id: 'dep-b', fileName: 'test-dep-b.ts', filePath: fileB });
      await insertArtifact(db, artA);
      await insertArtifact(db, artB);

      await indexProject('test-project-1', [artA, artB]);

      const files = await getIndexedFiles('test-project-1');
      const fileBRecord = files.find(f => f.filePath === fileB);
      expect(fileBRecord).toBeDefined();

      const dependents = await getDependents(fileBRecord!.id);
      expect(dependents.length).toBeGreaterThanOrEqual(1);

      fs.unlinkSync(fileA);
      fs.unlinkSync(fileB);
      clearTestDb();
    });
  });

  describe('non-JS/TS extractors', () => {
    it('extracts JSON top-level keys as symbols', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const testFile = '/tmp/test-json-symbols.json';
      fs.writeFileSync(testFile, JSON.stringify({
        name: 'test-app',
        version: '1.0.0',
        dependencies: { react: '^18.0.0' },
      }, null, 2));

      const artifact = makeArtifact({ id: 'json-1', fileName: 'test-json-symbols.json', filePath: testFile });
      await insertArtifact(db, artifact);

      await indexProject('test-project-1', [artifact]);

      const files = await getIndexedFiles('test-project-1');
      expect(files.length).toBe(1);
      expect(files[0].symbolCount).toBeGreaterThan(0);

      const symbols = await getFileSymbols(files[0].id);
      const names = symbols.map(s => s.name);
      expect(names).toContain('name');
      expect(names).toContain('version');
      expect(names).toContain('dependencies');

      fs.unlinkSync(testFile);
      clearTestDb();
    });

    it('extracts Markdown headings as symbols', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const testFile = '/tmp/test-md-symbols.md';
      fs.writeFileSync(testFile, `# Project Overview
Some text here.

## Installation
Run npm install.

### Prerequisites
Node.js required.

## Usage
Do stuff.
`);

      const artifact = makeArtifact({ id: 'md-1', fileName: 'test-md-symbols.json', filePath: testFile });
      await insertArtifact(db, artifact);

      await indexProject('test-project-1', [artifact]);

      const files = await getIndexedFiles('test-project-1');
      const symbols = await getFileSymbols(files[0].id);
      const names = symbols.map(s => s.name);
      expect(names).toContain('Project Overview');
      expect(names).toContain('Installation');
      expect(names).toContain('Prerequisites');
      expect(names).toContain('Usage');
      expect(symbols.length).toBe(4);

      fs.unlinkSync(testFile);
      clearTestDb();
    });

    it('extracts CSS selectors as symbols', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const testFile = '/tmp/test-css-symbols.css';
      fs.writeFileSync(testFile, `
.container { display: flex; }
#header { background: white; }
.btn { padding: 8px; }
`);

      const artifact = makeArtifact({ id: 'css-1', fileName: 'test-css-symbols.css', filePath: testFile });
      await insertArtifact(db, artifact);

      await indexProject('test-project-1', [artifact]);

      const files = await getIndexedFiles('test-project-1');
      const symbols = await getFileSymbols(files[0].id);
      const names = symbols.map(s => s.name);
      expect(names).toContain('container');
      expect(names).toContain('header');
      expect(names).toContain('btn');

      fs.unlinkSync(testFile);
      clearTestDb();
    });

    it('extracts HTML element IDs and script/link relationships', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const testFile = '/tmp/test-html-symbols.html';
      fs.writeFileSync(testFile, `<!DOCTYPE html>
<html>
<head>
  <link href="styles.css" rel="stylesheet">
  <script src="app.js"></script>
</head>
<body>
  <div id="app">Hello</div>
  <div id="footer">Footer</div>
</body>
</html>
`);

      const artifact = makeArtifact({ id: 'html-1', fileName: 'test-html-symbols.html', filePath: testFile });
      await insertArtifact(db, artifact);

      await indexProject('test-project-1', [artifact]);

      const files = await getIndexedFiles('test-project-1');
      const symbols = await getFileSymbols(files[0].id);
      const names = symbols.map(s => s.name);
      expect(names).toContain('app');
      expect(names).toContain('footer');

      fs.unlinkSync(testFile);
      clearTestDb();
    });

    it('extracts YAML top-level keys as symbols', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const testFile = '/tmp/test-yaml-symbols.yml';
      fs.writeFileSync(testFile, `name: ci-tests
on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
`);

      const artifact = makeArtifact({ id: 'yml-1', fileName: 'test-yaml-symbols.yml', filePath: testFile });
      await insertArtifact(db, artifact);

      await indexProject('test-project-1', [artifact]);

      const files = await getIndexedFiles('test-project-1');
      expect(files.length).toBe(1);
      const symbols = await getFileSymbols(files[0].id);
      const names = symbols.map(s => s.name);
      expect(names).toContain('name');
      expect(names).toContain('on');
      expect(names).toContain('jobs');

      fs.unlinkSync(testFile);
      clearTestDb();
    });
  });
});

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
    clearTestDb();
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
    clearTestDb();
  });

  it('returns empty matches when no symbols match', async () => {
    await setupTestDb();
    const result = await searchSymbols('test-project-1', 'nonexistent');
    expect(result.matches).toEqual([]);
    expect(result.totalMatches).toBe(0);
    clearTestDb();
  });
});

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
    clearTestDb();
  });

  it('throws SymbolNotFound when the symbol is not in the index', async () => {
    const db = await setupTestDb();
    await expect(
      getSymbolBody('test-project-1', '/no/such/file.ts', 'nope')
    ).rejects.toThrow(/SymbolNotFound/);
    clearTestDb();
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
    clearTestDb();
  });
});
