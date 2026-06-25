/**
 * testPlan (Group 2c) — backend tests.
 *
 * Covers the CRUD primitives + the module rollup aggregation. The
 * generator (testPlanGenerator.ts) is exercised through the static
 * review integration test which mocks the AI client; here we just
 * lock the data-layer contract.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { setTestDb, clearTestDb, getDb } from '../../src/db.js';
import {
  createTestItem,
  listTestItems,
  getTestItem,
  updateTestItemStatus,
  listModuleRollups,
  clearTestItemsForSession,
  isValidKind,
  isValidStatus,
  isValidSeverity,
} from '../../src/testPlan.js';

async function makeDb() {
  return initSqlJs().then(SQL => new SQL.Database());
}

function seed(db: Awaited<ReturnType<typeof makeDb>>, projectId: string, sessionId: string) {
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      workspace_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS static_sessions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
      review_type TEXT NOT NULL, status TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}', progress_json TEXT NOT NULL DEFAULT '{}',
      remarks TEXT NOT NULL DEFAULT '', final_summary TEXT NOT NULL DEFAULT '',
      failure_reason TEXT NOT NULL DEFAULT '',
      base_ref TEXT NOT NULL DEFAULT '', head_ref TEXT NOT NULL DEFAULT '',
      changed_files_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )
  `);
  // test_items schema mirrors db.ts.
  db.run(`
    CREATE TABLE IF NOT EXISTS test_items (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, project_id TEXT NOT NULL,
      module TEXT NOT NULL, component TEXT, file_path TEXT NOT NULL DEFAULT '',
      line_number INTEGER, title TEXT NOT NULL, description TEXT NOT NULL,
      rationale TEXT, kind TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )
  `);
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)',
    [projectId, 'p', '', '/tmp', now, now]
  );
  db.run(
    'INSERT INTO static_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [sessionId, projectId, 's', 'code_review', 'success', '{}', '{}', '', '', '', '', '', '[]', now, now]
  );
}

describe('testPlan', () => {
  beforeEach(() => clearTestDb());

  it('validators accept the canonical sets and reject everything else', () => {
    expect(isValidKind('unit')).toBe(true);
    expect(isValidKind('integration')).toBe(true);
    expect(isValidKind('e2e')).toBe(true);
    expect(isValidKind('smoke')).toBe(true);
    expect(isValidKind('mutation')).toBe(false);
    expect(isValidStatus('proposed')).toBe(true);
    expect(isValidStatus('accepted')).toBe(true);
    expect(isValidStatus('in_progress')).toBe(true);
    expect(isValidStatus('passed')).toBe(true);
    expect(isValidStatus('failed')).toBe(true);
    expect(isValidStatus('rejected')).toBe(true);
    expect(isValidStatus('merged')).toBe(false);
    expect(isValidSeverity('critical')).toBe(true);
    expect(isValidSeverity('info')).toBe(true);
    expect(isValidSeverity('urgent')).toBe(false);
  });

  it('rejects invalid kind at insert time (no DB write)', async () => {
    const db = await makeDb();
    seed(db, 'p1', 's1');
    setTestDb(db);
    await expect(
      createTestItem({
        sessionId: 's1', projectId: 'p1', module: 'auth',
        title: 't', description: 'd', kind: 'mutation' as any,
      })
    ).rejects.toThrow(/Invalid test item kind/);
    const items = await listTestItems('p1');
    expect(items).toHaveLength(0);
  });

  it('createTestItem defaults missing severity to medium and status to proposed', async () => {
    const db = await makeDb();
    seed(db, 'p1', 's1');
    setTestDb(db);
    const item = await createTestItem({
      sessionId: 's1', projectId: 'p1', module: 'auth',
      title: 'verify login', description: 'check empty creds', kind: 'unit',
    });
    expect(item.severity).toBe('medium');
    expect(item.status).toBe('proposed');
    expect(item.id).toBeDefined();
    expect(item.createdAt).toBeDefined();
  });

  it('listTestItems filters by module and status', async () => {
    const db = await makeDb();
    seed(db, 'p1', 's1');
    setTestDb(db);
    await createTestItem({ sessionId: 's1', projectId: 'p1', module: 'auth', title: 'a1', description: 'd', kind: 'unit' });
    await createTestItem({ sessionId: 's1', projectId: 'p1', module: 'db',  title: 'd1', description: 'd', kind: 'unit' });
    await createTestItem({ sessionId: 's1', projectId: 'p1', module: 'auth', title: 'a2', description: 'd', kind: 'smoke' });
    const a = await listTestItems('p1', { module: 'auth' });
    expect(a).toHaveLength(2);
    // listTestItems filters by status, not by kind — verify the
    // contract by status. Three items, all 'proposed' (the default).
    const proposed = await listTestItems('p1', { status: 'proposed' });
    expect(proposed).toHaveLength(3);
    const accepted = await listTestItems('p1', { status: 'accepted' });
    expect(accepted).toHaveLength(0);
    const all = await listTestItems('p1');
    expect(all).toHaveLength(3);
    // Session filter narrows correctly
    const s1 = await listTestItems('p1', { sessionId: 's1' });
    expect(s1).toHaveLength(3);
  });

  it('updateTestItemStatus transitions through the lifecycle', async () => {
    const db = await makeDb();
    seed(db, 'p1', 's1');
    setTestDb(db);
    const created = await createTestItem({
      sessionId: 's1', projectId: 'p1', module: 'auth',
      title: 't', description: 'd', kind: 'unit',
    });
    const accepted = await updateTestItemStatus(created.id, 'accepted');
    expect(accepted?.status).toBe('accepted');
    expect(accepted?.updatedAt).not.toBe(created.updatedAt);

    const inProgress = await updateTestItemStatus(created.id, 'in_progress');
    expect(inProgress?.status).toBe('in_progress');

    const failed = await updateTestItemStatus(created.id, 'failed');
    expect(failed?.status).toBe('failed');

    // Invalid status throws
    await expect(updateTestItemStatus(created.id, 'merged' as any)).rejects.toThrow(/Invalid test item status/);
  });

  it('clearTestItemsForSession keeps accepted/in_progress items when keepAccepted=true', async () => {
    const db = await makeDb();
    seed(db, 'p1', 's1');
    setTestDb(db);
    const a = await createTestItem({ sessionId: 's1', projectId: 'p1', module: 'auth', title: 'accepted', description: 'd', kind: 'unit' });
    const p = await createTestItem({ sessionId: 's1', projectId: 'p1', module: 'auth', title: 'proposed', description: 'd', kind: 'unit' });
    const r = await createTestItem({ sessionId: 's1', projectId: 'p1', module: 'auth', title: 'rejected', description: 'd', kind: 'unit' });
    await updateTestItemStatus(a.id, 'accepted');
    await updateTestItemStatus(r.id, 'rejected');

    await clearTestItemsForSession('s1', { keepAccepted: true });
    const remaining = await listTestItems('p1', { sessionId: 's1' });
    const titles = remaining.map(i => i.title).sort();
    expect(titles).toEqual(['accepted']);
    expect(remaining.find(i => i.id === a.id)).toBeDefined();
    expect(remaining.find(i => i.id === p.id)).toBeUndefined();
  });

  it('listModuleRollups aggregates per-module status counts', async () => {
    const db = await makeDb();
    seed(db, 'p1', 's1');
    setTestDb(db);
    const a1 = await createTestItem({ sessionId: 's1', projectId: 'p1', module: 'auth', title: 'a1', description: 'd', kind: 'unit' });
    const a2 = await createTestItem({ sessionId: 's1', projectId: 'p1', module: 'auth', title: 'a2', description: 'd', kind: 'unit' });
    const a3 = await createTestItem({ sessionId: 's1', projectId: 'p1', module: 'auth', title: 'a3', description: 'd', kind: 'smoke' });
    const d1 = await createTestItem({ sessionId: 's1', projectId: 'p1', module: 'db',   title: 'd1', description: 'd', kind: 'unit' });
    await updateTestItemStatus(a1.id, 'accepted');
    await updateTestItemStatus(a2.id, 'passed');
    await updateTestItemStatus(d1.id, 'rejected');

    const rollups = await listModuleRollups('p1');
    expect(rollups).toHaveLength(2);
    const auth = rollups.find(r => r.module === 'auth');
    const dbR = rollups.find(r => r.module === 'db');
    expect(auth?.total).toBe(3);
    expect(auth?.proposed).toBe(1);
    expect(auth?.accepted).toBe(1);
    expect(auth?.passed).toBe(1);
    expect(dbR?.total).toBe(1);
    expect(dbR?.rejected).toBe(1);
  });
});
