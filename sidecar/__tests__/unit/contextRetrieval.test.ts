import { describe, it, expect } from 'vitest';
import { retrieveContext, searchByKeyword, getRelatedFiles } from '../../src/contextRetrieval.js';
import { indexProject, getIndexedFiles } from '../../src/repoIndex.js';
import { setTestDb, clearTestDb, getDb } from '../../src/db.js';
import type { Artifact } from '../../src/artifacts.js';
import fs from 'fs';
import crypto from 'crypto';

async function insertArtifact(db: any, artifact: Artifact) {
  db.run(
    'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [artifact.id, artifact.projectId, artifact.type, artifact.fileName, artifact.filePath, artifact.originalPath, artifact.contentHash, artifact.source, artifact.createdAt]
  );
}

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
  db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);
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

describe('contextRetrieval', () => {
  describe('retrieveContext', () => {
    it('returns context for code_review', async () => {
      await setupTestDb();
      const db = await getDb();

      const files = [
        { name: 'auth.ts', content: 'export function login() { return true; }' },
        { name: 'utils.ts', content: 'export function add(a: number, b: number) { return a + b; }' },
        { name: 'README.md', content: '# My Project\nThis is a readme.' },
      ];

      const artifacts = files.map((f, i) => {
        const testFile = `/tmp/test-ctx-${f.name}`;
        fs.writeFileSync(testFile, f.content);
        return makeArtifact({
          id: `ctx-art-${i}`,
          fileName: f.name,
          filePath: testFile,
          type: f.name.endsWith('.md') ? 'requirement' : 'source_code',
        });
      });

      for (const art of artifacts) {
        await insertArtifact(db, art);
      }
      await indexProject('test-project-1', artifacts);
      const context = await retrieveContext('test-project-1', 'code_review');

      expect(context.files.length).toBeGreaterThan(0);
      expect(context.estimatedTokens).toBeGreaterThan(0);
      expect(context.reason).toBeDefined();

      // Cleanup
      for (const f of files) {
        const p = `/tmp/test-ctx-${f.name}`;
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      clearTestDb();
    });

    it('returns context for requirement_review', async () => {
      await setupTestDb();
      const db = await getDb();

      const files = [
        { name: 'spec.md', content: '# Requirements\n1. User login\n2. User logout' },
        { name: 'app.ts', content: 'export const app = {};' },
      ];

      const artifacts = files.map((f, i) => {
        const testFile = `/tmp/test-ctx-req-${f.name}`;
        fs.writeFileSync(testFile, f.content);
        return makeArtifact({
          id: `ctx-req-${i}`,
          fileName: f.name,
          filePath: testFile,
          type: f.name.endsWith('.md') ? 'requirement' : 'source_code',
        });
      });

      for (const art of artifacts) {
        await insertArtifact(db, art);
      }
      await indexProject('test-project-1', artifacts);
      const context = await retrieveContext('test-project-1', 'requirement_review');

      // Should prioritize .md files for requirement review
      expect(context.files.length).toBeGreaterThan(0);

      for (const f of files) {
        const p = `/tmp/test-ctx-req-${f.name}`;
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      clearTestDb();
    });

    it('returns empty context for empty project', async () => {
      await setupTestDb();
      const context = await retrieveContext('test-project-1', 'code_review');
      expect(context.files).toHaveLength(0);
      expect(context.estimatedTokens).toBe(0);
      clearTestDb();
    });
  });

  describe('searchByKeyword', () => {
    it('finds files by name', async () => {
      await setupTestDb();
      const db = await getDb();

      const testFile = '/tmp/test-ctx-search.ts';
      fs.writeFileSync(testFile, 'export function authenticate() {}');

      const artifact = makeArtifact({
        id: 'search-art-1',
        fileName: 'authService.ts',
        filePath: testFile,
      });
      await insertArtifact(db, artifact);

      await indexProject('test-project-1', [artifact]);
      const results = await searchByKeyword('test-project-1', 'auth');
      expect(results.length).toBeGreaterThanOrEqual(1);

      fs.unlinkSync(testFile);
      clearTestDb();
    });

    it('finds files by symbol name', async () => {
      await setupTestDb();
      const db = await getDb();

      const testFile = '/tmp/test-ctx-search-sym.ts';
      fs.writeFileSync(testFile, 'export function calculateTotal() { return 0; }');

      const artifact = makeArtifact({
        id: 'search-art-2',
        fileName: 'math.ts',
        filePath: testFile,
      });
      await insertArtifact(db, artifact);

      await indexProject('test-project-1', [artifact]);
      const results = await searchByKeyword('test-project-1', 'calculateTotal');
      expect(results.length).toBeGreaterThanOrEqual(1);

      fs.unlinkSync(testFile);
      clearTestDb();
    });
  });

  describe('getRelatedFiles', () => {
    it('traverses dependency graph', async () => {
      await setupTestDb();
      const db = await getDb();

      const fileA = '/tmp/test-ctx-rel-a.ts';
      const fileB = '/tmp/test-ctx-rel-b.ts';
      // Use absolute path in import to match what's stored in the database
      fs.writeFileSync(fileA, `import { helper } from '${fileB}'; export const a = helper();`);
      fs.writeFileSync(fileB, 'export function helper() { return 42; }');

      const artA = makeArtifact({ id: 'rel-a', fileName: 'test-ctx-rel-a.ts', filePath: fileA });
      const artB = makeArtifact({ id: 'rel-b', fileName: 'test-ctx-rel-b.ts', filePath: fileB });
      await insertArtifact(db, artA);
      await insertArtifact(db, artB);

      await indexProject('test-project-1', [artA, artB]);

      const files = await getIndexedFiles('test-project-1');
      const fileARecord = files.find(f => f.filePath === fileA);
      expect(fileARecord).toBeDefined();

      const related = await getRelatedFiles(fileARecord!.id, 1);
      expect(related.length).toBeGreaterThanOrEqual(1);

      fs.unlinkSync(fileA);
      fs.unlinkSync(fileB);
      clearTestDb();
    });
  });
});
