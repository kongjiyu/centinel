import { describe, it, expect } from 'vitest';
import { runStaticAnalysis, getStaticFindings, clearStaticFindings } from '../../src/staticEngine.js';
import { getDb, saveDb, setTestDb, clearTestDb } from '../../src/db.js';
import type { Artifact } from '../../src/artifacts.js';
import crypto from 'crypto';

// Helper: create an in-memory test DB
async function setupTestDb() {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  // Create required tables
  db.run(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
    workspace_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL,
    file_name TEXT NOT NULL, file_path TEXT NOT NULL, original_path TEXT,
    content_hash TEXT NOT NULL, source TEXT DEFAULT 'documents', created_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS static_analysis_results (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT,
    file_path TEXT NOT NULL, line_number INTEGER, rule_id TEXT NOT NULL,
    severity TEXT NOT NULL, category TEXT NOT NULL, message TEXT NOT NULL,
    evidence TEXT, created_at TEXT NOT NULL
  )`);
  // Mirrored into the unified findings table by runStaticAnalysis so the UI
  // can surface rule-based findings alongside AI findings. Must match db.ts.
  db.run(`CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT,
    source TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL,
    description TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
    artifact_id TEXT, category TEXT NOT NULL DEFAULT '',
    evidence_text TEXT NOT NULL DEFAULT '', recommendation TEXT NOT NULL DEFAULT '',
    confidence TEXT NOT NULL DEFAULT '', from_remarks INTEGER NOT NULL DEFAULT 0,
    file_path TEXT NOT NULL DEFAULT '', line_number INTEGER
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

describe('staticEngine', () => {
  describe('secrets detection', () => {
    it('detects hardcoded API keys', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const fs = await import('fs');
      const testFile = '/tmp/test-static-engine-secrets.ts';
      fs.writeFileSync(testFile, `
        const apiKey = "sk-1234567890abcdef";
        const password = "hunter2";
        const AWS_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
      `);

      const fileArtifact = makeArtifact({
        id: crypto.randomUUID(),
        fileName: 'test-static-engine-secrets.ts',
        filePath: testFile,
      });
      await insertArtifact(db, fileArtifact);

      const findings = await runStaticAnalysis('test-project-1', [fileArtifact]);
      expect(findings.length).toBeGreaterThan(0);

      // Should find API key and AWS key
      const ruleIds = findings.map(f => f.ruleId);
      expect(ruleIds).toContain('secrets-api-key');
      expect(ruleIds).toContain('secrets-aws-key');

      // Cleanup
      fs.unlinkSync(testFile);
      clearTestDb();
    });

    it('detects TODO/FIXME comments', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const fs = await import('fs');
      const testFile = '/tmp/test-static-engine-todo.ts';
      fs.writeFileSync(testFile, `
        // TODO: fix this later
        // FIXME: broken
        function hello() { return 'world'; }
      `);

      const artifact = makeArtifact({
        id: crypto.randomUUID(),
        fileName: 'test-static-engine-todo.ts',
        filePath: testFile,
      });
      await insertArtifact(db, artifact);

      const findings = await runStaticAnalysis('test-project-1', [artifact]);
      const ruleIds = findings.map(f => f.ruleId);
      expect(ruleIds).toContain('cq-todo-comments');

      fs.unlinkSync(testFile);
      clearTestDb();
    });

    it('detects empty catch blocks', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const fs = await import('fs');
      const testFile = '/tmp/test-static-engine-catch.ts';
      fs.writeFileSync(testFile, `
        try {
          doSomething();
        } catch (e) {
          // empty
        }
      `);

      const artifact = makeArtifact({
        id: crypto.randomUUID(),
        fileName: 'test-static-engine-catch.ts',
        filePath: testFile,
      });
      await insertArtifact(db, artifact);

      const findings = await runStaticAnalysis('test-project-1', [artifact]);
      const ruleIds = findings.map(f => f.ruleId);
      expect(ruleIds).toContain('cq-empty-catch');

      fs.unlinkSync(testFile);
      clearTestDb();
    });

    it('detects eval() usage', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const fs = await import('fs');
      const testFile = '/tmp/test-static-engine-eval.ts';
      fs.writeFileSync(testFile, `
        const code = "1 + 1";
        const result = eval(code);
      `);

      const artifact = makeArtifact({
        id: crypto.randomUUID(),
        fileName: 'test-static-engine-eval.ts',
        filePath: testFile,
      });
      await insertArtifact(db, artifact);

      const findings = await runStaticAnalysis('test-project-1', [artifact]);
      const ruleIds = findings.map(f => f.ruleId);
      expect(ruleIds).toContain('sec-eval');

      fs.unlinkSync(testFile);
      clearTestDb();
    });

    it('skips non-applicable file types', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const fs = await import('fs');
      const testFile = '/tmp/test-static-engine-skip.json';
      fs.writeFileSync(testFile, `{ "key": "value" }`);

      const artifact = makeArtifact({
        id: crypto.randomUUID(),
        fileName: 'test-static-engine-skip.json',
        filePath: testFile,
      });
      await insertArtifact(db, artifact);

      const findings = await runStaticAnalysis('test-project-1', [artifact]);
      // JSON files have limited rules, should have fewer/no findings
      expect(findings.length).toBe(0);

      fs.unlinkSync(testFile);
      clearTestDb();
    });
  });

  describe('getStaticFindings', () => {
    it('returns findings from DB', async () => {
      await setupTestDb();
      const db = await getDb();
      db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);

      const findings = await getStaticFindings('test-project-1');
      expect(Array.isArray(findings)).toBe(true);

      clearTestDb();
    });
  });
});
