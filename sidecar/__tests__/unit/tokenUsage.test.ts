import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, setTestDb, clearTestDb } from '../../src/db.js';
import {
  recordTokenUsage,
  listTokenUsage,
  getTokenUsageSummary,
  clearTokenUsageForSession,
} from '../../src/tokenUsage.js';

async function setupTestDb() {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  // Minimal schema — only token_usage is exercised here, but sessions/projects
  // columns are referenced by FK so we declare the parent tables too.
  db.run(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id TEXT PRIMARY KEY,
      project_id TEXT, session_id TEXT,
      scope TEXT NOT NULL, call_kind TEXT NOT NULL DEFAULT 'review',
      stage TEXT, round_number INTEGER,
      provider TEXT NOT NULL, api_format TEXT NOT NULL, model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);
  setTestDb(db);
  return db;
}

describe('tokenUsage', () => {
  beforeEach(() => {
    clearTestDb();
  });

  it('records and reads back a single usage row', async () => {
    await setupTestDb();
    const row = await recordTokenUsage({
      scope: 'text',
      callKind: 'review',
      projectId: 'p1',
      sessionId: 's1',
      stage: 'code_review',
      roundNumber: 0,
      provider: 'mimo',
      apiFormat: 'openai-compatible',
      model: 'mimo-v2.5',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 150,
    });
    expect(row.id).toBeTruthy();
    expect(row.totalTokens).toBe(150);

    const rows = await listTokenUsage({ sessionId: 's1' });
    expect(rows.length).toBe(1);
    expect(rows[0].model).toBe('mimo-v2.5');
  });

  it('aggregates totals across multiple providers', async () => {
    await setupTestDb();
    // Two text-review calls on MiMo, one vision-dynamic call on Gemini.
    await recordTokenUsage({
      scope: 'text', callKind: 'review', projectId: 'p1', sessionId: 's1',
      stage: 'code_review', roundNumber: 0,
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo-v2.5',
      inputTokens: 100, outputTokens: 50, totalTokens: 150,
    });
    await recordTokenUsage({
      scope: 'text', callKind: 'review', projectId: 'p1', sessionId: 's1',
      stage: 'summarizing', roundNumber: 0,
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo-v2.5',
      inputTokens: 200, outputTokens: 100, totalTokens: 300,
    });
    await recordTokenUsage({
      scope: 'vision', callKind: 'dynamic', projectId: 'p1', sessionId: 'd1',
      stage: 'step_0', roundNumber: null,
      provider: 'gemini', apiFormat: 'google-native', model: 'gemini-2.5-flash',
      inputTokens: 1000, outputTokens: 200, totalTokens: 1200,
    });

    const summary = await getTokenUsageSummary();
    expect(summary.totals.input).toBe(1300);
    expect(summary.totals.output).toBe(350);
    expect(summary.totals.calls).toBe(3);
    expect(summary.byGroup.length).toBe(2);
    // Most-used group first (input + output sum)
    expect(summary.byGroup[0].model).toBe('gemini-2.5-flash');
    expect(summary.byGroup[0].totalCalls).toBe(1);
    expect(summary.byGroup[1].model).toBe('mimo-v2.5');
    expect(summary.byGroup[1].totalCalls).toBe(2);
  });

  it('respects scope filter', async () => {
    await setupTestDb();
    await recordTokenUsage({
      scope: 'text', callKind: 'review', projectId: 'p1', sessionId: 's1',
      stage: 'code_review', roundNumber: 0,
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'm',
      inputTokens: 10, outputTokens: 5, totalTokens: 15,
    });
    await recordTokenUsage({
      scope: 'vision', callKind: 'test', projectId: null, sessionId: null,
      stage: null, roundNumber: null,
      provider: 'gemini', apiFormat: 'google-native', model: 'g',
      inputTokens: 20, outputTokens: 5, totalTokens: 25,
    });

    const textOnly = await getTokenUsageSummary({ scope: 'text' });
    expect(textOnly.totals.calls).toBe(1);
    expect(textOnly.totals.input).toBe(10);

    const visionOnly = await getTokenUsageSummary({ scope: 'vision' });
    expect(visionOnly.totals.calls).toBe(1);
    expect(visionOnly.totals.input).toBe(20);
  });

  it('clears all rows for a given session', async () => {
    await setupTestDb();
    await recordTokenUsage({
      scope: 'text', callKind: 'review', projectId: 'p1', sessionId: 's1',
      stage: 'code_review', roundNumber: 0,
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'm',
      inputTokens: 10, outputTokens: 5, totalTokens: 15,
    });
    await recordTokenUsage({
      scope: 'text', callKind: 'review', projectId: 'p1', sessionId: 's2',
      stage: 'code_review', roundNumber: 0,
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'm',
      inputTokens: 20, outputTokens: 10, totalTokens: 30,
    });
    await clearTokenUsageForSession('s1');
    const remaining = await listTokenUsage();
    expect(remaining.length).toBe(1);
    expect(remaining[0].sessionId).toBe('s2');
  });
});
