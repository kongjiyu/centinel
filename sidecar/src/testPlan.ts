/**
 * Test plan (Group 2c).
 *
 * The bridge from the static review to the dynamic runner. For each
 * module under the system, the plan stores a list of test items, each
 * with a `rationale` linking back to the finding (if any) that drove
 * it. Items are append-only; re-running the generator on the same
 * session produces a fresh batch that can be diffed against the
 * previous one (P1-5 re-review integration).
 *
 * Module grouping is derived from repo_index.module — see
 * deriveModuleFromPath in repoIndex.ts for the convention.
 *
 * Lifecycle:
 *   proposed → accepted | rejected → in_progress → passed | failed
 *
 * 'proposed' is the entry state for everything the AI generates.
 * The reviewer triages items by accepting / rejecting them. Once
 * accepted, an item can be handed to the dynamic runner ('in_progress')
 * which eventually reports back 'passed' or 'failed'.
 */

import crypto from 'crypto';
import { getDb, saveDb } from './db.js';

export type TestItemKind = 'unit' | 'integration' | 'e2e' | 'smoke';
export type TestItemStatus = 'proposed' | 'accepted' | 'rejected' | 'in_progress' | 'passed' | 'failed';
export type TestItemSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type TestItem = {
  id: string;
  sessionId: string;
  projectId: string;
  module: string;
  component: string | null;
  filePath: string;
  lineNumber: number | null;
  title: string;
  description: string;
  /** Free-form. Common values: a finding id, 'smoke', 'coverage_gap'. */
  rationale: string | null;
  kind: TestItemKind;
  severity: TestItemSeverity;
  status: TestItemStatus;
  createdAt: string;
  updatedAt: string;
};

const VALID_KINDS: ReadonlySet<TestItemKind> = new Set(['unit', 'integration', 'e2e', 'smoke']);
const VALID_STATUSES: ReadonlySet<TestItemStatus> = new Set([
  'proposed', 'accepted', 'rejected', 'in_progress', 'passed', 'failed',
]);
const VALID_SEVERITIES: ReadonlySet<TestItemSeverity> = new Set([
  'critical', 'high', 'medium', 'low', 'info',
]);

export function isValidKind(v: unknown): v is TestItemKind {
  return typeof v === 'string' && VALID_KINDS.has(v as TestItemKind);
}
export function isValidStatus(v: unknown): v is TestItemStatus {
  return typeof v === 'string' && VALID_STATUSES.has(v as TestItemStatus);
}
export function isValidSeverity(v: unknown): v is TestItemSeverity {
  return typeof v === 'string' && VALID_SEVERITIES.has(v as TestItemSeverity);
}

function mapRow(row: unknown[]): TestItem {
  return {
    id: row[0] as string,
    sessionId: row[1] as string,
    projectId: row[2] as string,
    module: row[3] as string,
    component: (row[4] as string) ?? null,
    filePath: (row[5] as string) ?? '',
    lineNumber: row[6] as number | null,
    title: row[7] as string,
    description: row[8] as string,
    rationale: (row[9] as string) ?? null,
    kind: row[10] as TestItemKind,
    severity: (row[11] as TestItemSeverity) ?? 'medium',
    status: row[12] as TestItemStatus,
    createdAt: row[13] as string,
    updatedAt: row[14] as string,
  };
}

export type CreateTestItemInput = {
  sessionId: string;
  projectId: string;
  module: string;
  component?: string | null;
  filePath?: string;
  lineNumber?: number | null;
  title: string;
  description: string;
  rationale?: string | null;
  kind: TestItemKind;
  severity?: TestItemSeverity;
};

/**
 * Insert a single test item. Validates the kind + severity; trims text
 * inputs. Returns the persisted record (with id, createdAt, updatedAt).
 */
export async function createTestItem(input: CreateTestItemInput): Promise<TestItem> {
  if (!isValidKind(input.kind)) {
    throw new Error(`Invalid test item kind: ${String(input.kind)}`);
  }
  const severity: TestItemSeverity = isValidSeverity(input.severity) ? input.severity : 'medium';
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO test_items
     (id, session_id, project_id, module, component, file_path, line_number,
      title, description, rationale, kind, severity, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.sessionId, input.projectId, input.module,
      input.component ?? null,
      input.filePath ?? '',
      input.lineNumber ?? null,
      input.title.trim(),
      input.description.trim(),
      input.rationale ?? null,
      input.kind,
      severity,
      'proposed',
      now, now,
    ]
  );
  saveDb();
  return {
    id, sessionId: input.sessionId, projectId: input.projectId, module: input.module,
    component: input.component ?? null,
    filePath: input.filePath ?? '',
    lineNumber: input.lineNumber ?? null,
    title: input.title.trim(),
    description: input.description.trim(),
    rationale: input.rationale ?? null,
    kind: input.kind,
    severity,
    status: 'proposed',
    createdAt: now, updatedAt: now,
  };
}

/**
 * List test items for a session, optionally filtered. Pass module or
 * status to narrow. The dashboard reads this when it expands a module
 * card or filters by status.
 */
export async function listTestItems(
  projectId: string,
  filters: { sessionId?: string; module?: string; status?: TestItemStatus } = {}
): Promise<TestItem[]> {
  const db = await getDb();
  const where: string[] = ['project_id = ?'];
  const params: unknown[] = [projectId];
  if (filters.sessionId) {
    where.push('session_id = ?');
    params.push(filters.sessionId);
  }
  if (filters.module) {
    where.push('module = ?');
    params.push(filters.module);
  }
  if (filters.status && isValidStatus(filters.status)) {
    where.push('status = ?');
    params.push(filters.status);
  }
  const stmt = db.prepare(
    `SELECT id, session_id, project_id, module, component, file_path, line_number,
            title, description, rationale, kind, severity, status, created_at, updated_at
     FROM test_items
     WHERE ${where.join(' AND ')}
     ORDER BY module ASC, created_at ASC`
  );
  stmt.bind(params);
  const out: TestItem[] = [];
  while (stmt.step()) {
    out.push(mapRow(stmt.get() as unknown[]));
  }
  stmt.free();
  return out;
}

export async function getTestItem(id: string): Promise<TestItem | null> {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT id, session_id, project_id, module, component, file_path, line_number,
            title, description, rationale, kind, severity, status, created_at, updated_at
     FROM test_items WHERE id = ?`
  );
  stmt.bind([id]);
  const out = stmt.step() ? mapRow(stmt.get() as unknown[]) : null;
  stmt.free();
  return out;
}

/**
 * Update a test item's status. Only transitions to valid statuses are
 * accepted; the field-level check guards against the UI passing
 * arbitrary strings. Returns the updated record.
 */
export async function updateTestItemStatus(
  id: string,
  status: TestItemStatus
): Promise<TestItem | null> {
  if (!isValidStatus(status)) {
    throw new Error(`Invalid test item status: ${String(status)}`);
  }
  const db = await getDb();
  const now = new Date().toISOString();
  db.run(
    'UPDATE test_items SET status = ?, updated_at = ? WHERE id = ?',
    [status, now, id]
  );
  saveDb();
  return getTestItem(id);
}

/**
 * Replace all test items for a session. Used by the regenerator when
 * the user clicks "Regenerate plan" — we wipe the old plan (any
 * accepted / in_progress items are preserved if the caller asks, but
 * the default is full replacement) and re-run the generator.
 *
 * Pass `keepAccepted: true` to skip rows in the accepted / in_progress
 * / passed / failed states — useful when you've already started work
 * and only want to refresh the undecided items.
 */
export async function clearTestItemsForSession(
  sessionId: string,
  options: { keepAccepted?: boolean } = {}
): Promise<number> {
  const db = await getDb();
  let stmt;
  if (options.keepAccepted) {
    stmt = db.prepare(
      `DELETE FROM test_items WHERE session_id = ?
       AND status IN ('proposed', 'rejected')`
    );
  } else {
    stmt = db.prepare(`DELETE FROM test_items WHERE session_id = ?`);
  }
  stmt.bind([sessionId]);
  stmt.step();
  stmt.free();
  saveDb();
  // sql.js doesn't return affected row count from DELETE through step();
  // re-query for the count when needed.
  const countStmt = db.prepare(
    `SELECT COUNT(*) FROM test_items WHERE session_id = ?`
  );
  countStmt.bind([sessionId]);
  countStmt.step();
  const remaining = (countStmt.get() as unknown[])[0] as number;
  countStmt.free();
  return remaining;
}

/**
 * Per-module rollup for the dashboard. Returns one row per module
 * with status counts so the TestPlanPanel can render the header
 * without scanning the whole list.
 */
export type ModuleRollup = {
  module: string;
  total: number;
  proposed: number;
  accepted: number;
  rejected: number;
  inProgress: number;
  passed: number;
  failed: number;
};

export async function listModuleRollups(projectId: string): Promise<ModuleRollup[]> {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT module,
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'proposed'    THEN 1 ELSE 0 END) AS proposed,
            SUM(CASE WHEN status = 'accepted'   THEN 1 ELSE 0 END) AS accepted,
            SUM(CASE WHEN status = 'rejected'   THEN 1 ELSE 0 END) AS rejected,
            SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN status = 'passed'     THEN 1 ELSE 0 END) AS passed,
            SUM(CASE WHEN status = 'failed'     THEN 1 ELSE 0 END) AS failed
     FROM test_items
     WHERE project_id = ?
     GROUP BY module
     ORDER BY module ASC`
  );
  stmt.bind([projectId]);
  const out: ModuleRollup[] = [];
  while (stmt.step()) {
    const r = stmt.get() as unknown[];
    out.push({
      module: r[0] as string,
      total: r[1] as number,
      proposed: r[2] as number,
      accepted: r[3] as number,
      rejected: r[4] as number,
      inProgress: r[5] as number,
      passed: r[6] as number,
      failed: r[7] as number,
    });
  }
  stmt.free();
  return out;
}
