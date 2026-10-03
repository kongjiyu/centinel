import { afterEach, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { clearTestDb, setTestDb } from '../../src/db.js';

function tableNames(db: import('sql.js').Database): string[] {
  const result = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  return result[0]?.values.map(row => String(row[0])) ?? [];
}

describe('local Dynamic schema initialization', () => {
  afterEach(() => clearTestDb());

  it('creates Dynamic tables without recreating superseded Static Review tables', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    try {
      setTestDb(db);
      const names = tableNames(db);
      expect(names).toEqual(expect.arrayContaining([
        'projects', 'sessions', 'findings', 'evidence', 'dynamic_session_details', 'ai_provider_settings', 'token_usage',
      ]));
      for (const obsolete of [
        'artifacts', 'static_sessions', 'review_decisions', 'review_decision_attachments',
        'review_source_manifests', 'review_source_manifest_items', 'review_traceability_snapshots',
        'integrations', 'requirements', 'requirement_mappings',
      ]) expect(names).not.toContain(obsolete);
    } finally {
      db.close();
    }
  });

  it('preserves legacy Static Review rows in a pre-existing database', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    try {
      db.run('CREATE TABLE static_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL)');
      db.run("INSERT INTO static_sessions (id, status) VALUES ('legacy-review', 'partial')");
      setTestDb(db);
      expect(db.exec("SELECT id, status FROM static_sessions WHERE id = 'legacy-review'")[0]?.values)
        .toEqual([['legacy-review', 'partial']]);
    } finally {
      db.close();
    }
  });
});
