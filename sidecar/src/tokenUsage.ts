import crypto from 'crypto';
import { getDb, saveDb } from './db.js';
import type { AiProvider, AiApiFormat } from './settings.js';
import type { TokenUsage } from './aiClient.js';

export type CallKind = 'review' | 'test' | 'dynamic';
export type TokenScope = 'text' | 'vision';

export type TokenUsageRow = {
  id: string;
  projectId: string | null;
  sessionId: string | null;
  scope: TokenScope;
  callKind: CallKind;
  stage: string | null;
  roundNumber: number | null;
  provider: AiProvider;
  apiFormat: AiApiFormat;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  createdAt: string;
};

export type TokenUsageInput = TokenUsage & {
  scope: TokenScope;
  callKind?: CallKind;
  projectId?: string | null;
  sessionId?: string | null;
  stage?: string | null;
  roundNumber?: number | null;
  provider: AiProvider;
  apiFormat: AiApiFormat;
  model: string;
};

export type TokenUsageGroup = {
  provider: AiProvider;
  apiFormat: AiApiFormat;
  model: string;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreation: number;
  totalCalls: number;
};

export type TokenUsageSummary = {
  totals: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    calls: number;
  };
  byGroup: TokenUsageGroup[];
  recent: TokenUsageRow[];
};

/**
 * Persist a single AI call's usage. The (sessionId, roundNumber) pair is
 * stable so re-running a stage doesn't double-count — the recorder uses
 * DELETE-then-INSERT semantics at the session level when a stage rewinds
 * (e.g. on round-cap retry).
 */
export async function recordTokenUsage(input: TokenUsageInput): Promise<TokenUsageRow> {
  const db = await getDb();
  const row: TokenUsageRow = {
    id: crypto.randomUUID(),
    projectId: input.projectId ?? null,
    sessionId: input.sessionId ?? null,
    scope: input.scope,
    callKind: input.callKind ?? 'review',
    stage: input.stage ?? null,
    roundNumber: input.roundNumber ?? null,
    provider: input.provider,
    apiFormat: input.apiFormat,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheReadTokens: input.cacheReadTokens ?? 0,
    cacheCreationTokens: input.cacheCreationTokens ?? 0,
    totalTokens: input.totalTokens ?? (input.inputTokens + input.outputTokens + (input.cacheReadTokens ?? 0) + (input.cacheCreationTokens ?? 0)),
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO token_usage (
      id, project_id, session_id, scope, call_kind, stage, round_number,
      provider, api_format, model,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      total_tokens, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.projectId, row.sessionId, row.scope, row.callKind, row.stage, row.roundNumber,
      row.provider, row.apiFormat, row.model,
      row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheCreationTokens,
      row.totalTokens, row.createdAt,
    ]
  );
  saveDb();
  return row;
}

export type TokenUsageListFilter = {
  scope?: TokenScope;
  callKind?: CallKind;
  sessionId?: string;
  projectId?: string;
  limit?: number;
};

function mapUsageRow(raw: unknown[]): TokenUsageRow {
  return {
    id: raw[0] as string,
    projectId: raw[1] as string | null,
    sessionId: raw[2] as string | null,
    scope: raw[3] as TokenScope,
    callKind: raw[4] as CallKind,
    stage: raw[5] as string | null,
    roundNumber: raw[6] as number | null,
    provider: raw[7] as AiProvider,
    apiFormat: raw[8] as AiApiFormat,
    model: raw[9] as string,
    inputTokens: Number(raw[10] ?? 0),
    outputTokens: Number(raw[11] ?? 0),
    cacheReadTokens: Number(raw[12] ?? 0),
    cacheCreationTokens: Number(raw[13] ?? 0),
    totalTokens: Number(raw[14] ?? 0),
    createdAt: raw[15] as string,
  };
}

export async function listTokenUsage(filter: TokenUsageListFilter = {}): Promise<TokenUsageRow[]> {
  const db = await getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.scope) { clauses.push('scope = ?'); params.push(filter.scope); }
  if (filter.callKind) { clauses.push('call_kind = ?'); params.push(filter.callKind); }
  if (filter.sessionId) { clauses.push('session_id = ?'); params.push(filter.sessionId); }
  if (filter.projectId) { clauses.push('project_id = ?'); params.push(filter.projectId); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
  const stmt = db.prepare(
    `SELECT id, project_id, session_id, scope, call_kind, stage, round_number,
            provider, api_format, model,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
            total_tokens, created_at
       FROM token_usage
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limit}`
  );
  stmt.bind(params);
  const rows: TokenUsageRow[] = [];
  while (stmt.step()) rows.push(mapUsageRow(stmt.get() as unknown[]));
  stmt.free();
  return rows;
}

/**
 * Aggregate usage grouped by (provider, api_format, model). The Settings
 * page renders one row per group so a project running on MiMo for text
 * and Gemini for vision shows up as two separate groups with their own
 * totals — important because cost per token varies by provider.
 */
export async function getTokenUsageSummary(filter: TokenUsageListFilter = {}): Promise<TokenUsageSummary> {
  const db = await getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.scope) { clauses.push('scope = ?'); params.push(filter.scope); }
  if (filter.callKind) { clauses.push('call_kind = ?'); params.push(filter.callKind); }
  if (filter.sessionId) { clauses.push('session_id = ?'); params.push(filter.sessionId); }
  if (filter.projectId) { clauses.push('project_id = ?'); params.push(filter.projectId); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  // One query for totals, one for grouping, one for recent rows. The DB is
  // small (per-call rows, not per-token) so three queries is fine and
  // keeps the response shape predictable.
  const totalsStmt = db.prepare(
    `SELECT
       COALESCE(SUM(input_tokens), 0)        AS sum_input,
       COALESCE(SUM(output_tokens), 0)       AS sum_output,
       COALESCE(SUM(cache_read_tokens), 0)   AS sum_cache_read,
       COALESCE(SUM(cache_creation_tokens), 0) AS sum_cache_create,
       COUNT(*)                              AS total_calls
     FROM token_usage ${where}`
  );
  totalsStmt.bind(params);
  let totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, calls: 0 };
  if (totalsStmt.step()) {
    const r = totalsStmt.get() as unknown[];
    totals = {
      input: Number(r[0] ?? 0),
      output: Number(r[1] ?? 0),
      cacheRead: Number(r[2] ?? 0),
      cacheCreation: Number(r[3] ?? 0),
      calls: Number(r[4] ?? 0),
    };
  }
  totalsStmt.free();

  const groupStmt = db.prepare(
    `SELECT
       provider, api_format, model,
       COALESCE(SUM(input_tokens), 0)          AS sum_input,
       COALESCE(SUM(output_tokens), 0)         AS sum_output,
       COALESCE(SUM(cache_read_tokens), 0)     AS sum_cache_read,
       COALESCE(SUM(cache_creation_tokens), 0) AS sum_cache_create,
       COUNT(*)                                AS total_calls
     FROM token_usage ${where}
     GROUP BY provider, api_format, model
     ORDER BY (COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0)) DESC`
  );
  groupStmt.bind(params);
  const byGroup: TokenUsageGroup[] = [];
  while (groupStmt.step()) {
    const r = groupStmt.get() as unknown[];
    byGroup.push({
      provider: r[0] as AiProvider,
      apiFormat: r[1] as AiApiFormat,
      model: r[2] as string,
      totalInput: Number(r[3] ?? 0),
      totalOutput: Number(r[4] ?? 0),
      totalCacheRead: Number(r[5] ?? 0),
      totalCacheCreation: Number(r[6] ?? 0),
      totalCalls: Number(r[7] ?? 0),
    });
  }
  groupStmt.free();

  const recent = await listTokenUsage({ ...filter, limit: 50 });
  return { totals, byGroup, recent };
}

/**
 * Delete all usage rows for a session — used when a review is rerun from
 * scratch so stale per-round rows don't inflate the per-session total.
 */
export async function clearTokenUsageForSession(sessionId: string): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM token_usage WHERE session_id = ?', [sessionId]);
  saveDb();
}
