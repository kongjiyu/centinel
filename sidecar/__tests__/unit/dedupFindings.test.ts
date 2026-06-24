import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import crypto from 'crypto';
import { setTestDb, clearTestDb, getDb } from '../../src/db.js';

describe('dedupeAgainstStaticFindings', () => {
  beforeEach(() => clearTestDb());

  it('drops AI finding that duplicates a static finding at the same line', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`CREATE TABLE static_analysis_results (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT,
      file_path TEXT NOT NULL, line_number INTEGER NOT NULL, rule_id TEXT,
      severity TEXT, category TEXT, message TEXT, evidence TEXT,
      confidence TEXT NOT NULL DEFAULT 'high', created_at TEXT
    )`);
    setTestDb(db);

    const projectId = 'proj-1';
    const sessionId = 'sess-1';
    db.run(
      'INSERT INTO static_analysis_results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), projectId, sessionId, 'src/auth.ts', 42, 'cq-console-log',
       'high', 'code_quality', 'console.log in auth',
       'console.log("debug token", token)', 'high', new Date().toISOString()]
    );

    const { dedupeAgainstStaticFindings } = await import('../../src/staticReview.js');

    const result = await dedupeAgainstStaticFindings(sessionId, projectId, [{
      filePath: 'src/auth.ts',
      lineNumber: 42,
      evidence: 'console.log debug token leaked here',
      confidence: 'high',
      title: 'Hardcoded token logged to console',
    }]);

    expect(result.dropped).toHaveLength(1);
    expect(result.kept).toHaveLength(0);

    clearTestDb();
  });

  it('keeps AI finding that is NOT a duplicate (different file)', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`CREATE TABLE static_analysis_results (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT,
      file_path TEXT NOT NULL, line_number INTEGER NOT NULL, rule_id TEXT,
      severity TEXT, category TEXT, message TEXT, evidence TEXT,
      confidence TEXT NOT NULL DEFAULT 'high', created_at TEXT
    )`);
    setTestDb(db);

    const projectId = 'proj-1';
    const sessionId = 'sess-1';
    db.run(
      'INSERT INTO static_analysis_results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), projectId, sessionId, 'src/other.ts', 10, 'cq-console-log',
       'high', 'code_quality', 'console.log in other',
       'console.log("hi")', 'high', new Date().toISOString()]
    );

    const { dedupeAgainstStaticFindings } = await import('../../src/staticReview.js');

    const result = await dedupeAgainstStaticFindings(sessionId, projectId, [{
      filePath: 'src/auth.ts',
      lineNumber: 42,
      evidence: 'console.log debug token',
      confidence: 'high',
      title: 'Token logged',
    }]);

    expect(result.dropped).toHaveLength(0);
    expect(result.kept).toHaveLength(1);

    clearTestDb();
  });
});
