/**
 * Review decisions (P0-3) — backend tests.
 *
 * Locks the schema, the append-only semantics, the latest-wins ordering,
 * and the validation. The HTTP layer is exercised through api.test.ts
 * (which already covers other session endpoints with the same harness).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import {
  setTestDb,
  clearTestDb,
  getDb,
} from '../../src/db.js';
import {
  submitReviewDecision,
  getCurrentDecision,
  listReviewDecisions,
  isValidDecision,
} from '../../src/reviewDecisions.js';

function makeDb() {
  // initSqlJs returns a promise (WASM bootstrap), so each test awaits it
  // independently rather than sharing a top-level instance.
  return initSqlJs().then(SQL => new SQL.Database());
}

function seedSession(db: Awaited<ReturnType<typeof makeDb>>, projectId: string, sessionId: string) {
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
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )
  `);
  // review_decisions — mirrors the real schema in db.ts. If the real
  // schema adds a column, this seed needs to match.
  db.run(`
    CREATE TABLE IF NOT EXISTS review_decisions (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, project_id TEXT NOT NULL,
      decision TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '',
      reviewer TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    )
  `);
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)',
    [projectId, 'p', '', '/tmp', now, now]
  );
  db.run(
    'INSERT INTO static_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [sessionId, projectId, 's', 'code_review', 'success', '{}', '{}', '', '', '', now, now]
  );
}

describe('reviewDecisions', () => {
  beforeEach(() => clearTestDb());

  it('isValidDecision accepts the three known values and rejects everything else', () => {
    expect(isValidDecision('approved')).toBe(true);
    expect(isValidDecision('changes_requested')).toBe(true);
    expect(isValidDecision('commented')).toBe(true);
    expect(isValidDecision('merged')).toBe(false);
    expect(isValidDecision('')).toBe(false);
    expect(isValidDecision(null)).toBe(false);
    expect(isValidDecision(undefined)).toBe(false);
    expect(isValidDecision(42)).toBe(false);
  });

  it('rejects an invalid decision at submit time (no DB write)', async () => {
    const db = await makeDb();
    seedSession(db, 'p1', 's1');
    setTestDb(db);
    await expect(
      submitReviewDecision('s1', 'p1', { decision: 'merged' as any })
    ).rejects.toThrow(/Invalid decision/);
    // No row should have been written.
    const stmt = (await getDb()).prepare('SELECT COUNT(*) FROM review_decisions');
    stmt.step();
    expect((stmt.get() as unknown[])[0]).toBe(0);
    stmt.free();
  });

  it('returns null current decision for a session with no history', async () => {
    const db = await makeDb();
    seedSession(db, 'p1', 's1');
    setTestDb(db);
    expect(await getCurrentDecision('s1')).toBeNull();
    expect(await listReviewDecisions('s1')).toEqual([]);
  });

  it('appends decisions and returns the latest as current', async () => {
    const db = await makeDb();
    seedSession(db, 'p1', 's1');
    setTestDb(db);

    // Tiny gaps between submits so the `created_at` ordering is deterministic.
    // Without this, the three inserts land in the same millisecond and the
    // `id DESC` tiebreaker takes over — which is still correct (the latest
    // id wins) but the test was over-specified about the exact order.
    const a = await submitReviewDecision('s1', 'p1', { decision: 'commented', comment: 'first pass' });
    await new Promise(r => setTimeout(r, 5));
    const b = await submitReviewDecision('s1', 'p1', { decision: 'changes_requested', comment: 'fix the auth flow' });
    await new Promise(r => setTimeout(r, 5));
    const c = await submitReviewDecision('s1', 'p1', { decision: 'approved', comment: 'LGTM' });

    const current = await getCurrentDecision('s1');
    expect(current).not.toBeNull();
    expect(current!.decision).toBe('approved');
    expect(current!.id).toBe(c.id);

    const history = await listReviewDecisions('s1');
    expect(history.map(h => h.id)).toEqual([c.id, b.id, a.id]);
    expect(history.map(h => h.decision)).toEqual(['approved', 'changes_requested', 'commented']);
    expect(history[1].comment).toBe('fix the auth flow');
  });

  it('isolates decisions across projects (no cross-session leakage)', async () => {
    const db = await makeDb();
    seedSession(db, 'p1', 's1');
    seedSession(db, 'p2', 's2');
    setTestDb(db);

    await submitReviewDecision('s1', 'p1', { decision: 'approved' });
    await submitReviewDecision('s2', 'p2', { decision: 'changes_requested' });

    expect((await getCurrentDecision('s1'))!.decision).toBe('approved');
    expect((await getCurrentDecision('s2'))!.decision).toBe('changes_requested');
    // s1's history must not include s2's decision.
    const s1History = await listReviewDecisions('s1');
    expect(s1History).toHaveLength(1);
    expect(s1History[0].projectId).toBe('p1');
  });

  it('trims comment + reviewer whitespace; empty string is allowed', async () => {
    const db = await makeDb();
    seedSession(db, 'p1', 's1');
    setTestDb(db);
    const r = await submitReviewDecision('s1', 'p1', {
      decision: 'commented',
      comment: '   look at line 42   ',
      reviewer: '  alice  ',
    });
    expect(r.comment).toBe('look at line 42');
    expect(r.reviewer).toBe('alice');
  });

  it('listReviewDecisions honors the limit', async () => {
    const db = await makeDb();
    seedSession(db, 'p1', 's1');
    setTestDb(db);
    for (let i = 0; i < 5; i++) {
      await submitReviewDecision('s1', 'p1', { decision: 'commented', comment: `c${i}` });
    }
    const all = await listReviewDecisions('s1', 10);
    expect(all).toHaveLength(5);
    const capped = await listReviewDecisions('s1', 2);
    expect(capped).toHaveLength(2);
  });
});
