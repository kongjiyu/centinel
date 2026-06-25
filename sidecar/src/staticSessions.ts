import crypto from 'crypto';
import { getDb, saveDb } from './db.js';

export type StaticSessionStatus = 'queued' | 'running' | 'success' | 'failure' | 'cancelled';

export type ReviewType =
  | 'requirement_review'
  | 'code_review'
  | 'requirement_to_code_traceability'
  | 'cross_artifact_consistency';

export type StaticSession = {
  id: string;
  projectId: string;
  name: string;
  reviewType: ReviewType;
  status: StaticSessionStatus;
  configJson: string;
  progressJson: string;
  remarks: string;
  finalSummary: string;
  failureReason: string;
  createdAt: string;
  updatedAt: string;
  /** P0-4: base git ref (e.g. 'main', 'main..HEAD'). Empty = no scope. */
  baseRef: string;
  /** P0-4: head git ref. Empty = no scope. */
  headRef: string;
  /** P0-4: JSON array of file paths changed between base and head. */
  changedFilesJson: string;
  /** P1-5: parent session id if this is a re-review; empty otherwise. */
  parentSessionId: string;
  /** P1-5: cached diff against the parent; empty until computed. */
  reviewDiffJson: string;
};

export type Finding = {
  id: string;
  projectId: string;
  sessionId: string | null;
  source: 'static' | 'dynamic';
  severity: string;
  title: string;
  description: string;
  /**
   * Lifecycle:
   *   - new:     just surfaced, not yet triaged
   *   - accepted: reviewer agrees, plans to fix
   *   - dismissed: reviewer disagrees, not a real defect
   *   - fixed:   the underlying issue is fixed (caller's signal)
   *   - carryover: P1-5 — copied from a parent session on a re-review;
   *                the parent found this and the child hasn't yet
   *                re-evaluated. Treated like 'new' for triage purposes
   *                and reclassified on the next re-review.
   */
  status: 'new' | 'accepted' | 'dismissed' | 'fixed' | 'carryover';
  createdAt: string;
  artifactId: string | null;
  category: string;
  evidenceText: string;
  recommendation: string;
  confidence: string;
  fromRemarks: boolean;
  filePath: string;
  lineNumber: number | null;
};

export type ReviewStageId =
  | 'understanding_context'
  | 'code_review'
  | 'requirement_validation'
  | 'summarizing';

export type ReviewStageProgress = {
  id: ReviewStageId;
  label: string;
  status: 'pending' | 'active' | 'done';
  thoughts: string[];
  summary?: string;
};

export type ReviewProgress = {
  currentStage: ReviewStageId;
  stages: ReviewStageProgress[];
  startedAt: string;
  updatedAt: string;
};

export type ReviewArtifact = {
  id: string;
  sessionId: string;
  projectId: string;
  title: string;
  content: string;
  artifactType: string;
  createdAt: string;
};

function mapSession(row: unknown[]): StaticSession {
  return {
    id: row[0] as string,
    projectId: row[1] as string,
    name: row[2] as string,
    reviewType: row[3] as ReviewType,
    status: row[4] as StaticSessionStatus,
    configJson: row[5] as string,
    progressJson: row[6] as string,
    remarks: row[7] as string,
    finalSummary: row[8] as string,
    failureReason: row[9] as string,
    createdAt: row[10] as string,
    updatedAt: row[11] as string,
    // P0-4
    baseRef: (row[12] as string) ?? '',
    headRef: (row[13] as string) ?? '',
    changedFilesJson: (row[14] as string) ?? '[]',
    // P1-5
    parentSessionId: (row[15] as string) ?? '',
    reviewDiffJson: (row[16] as string) ?? '',
  };
}

function mapFinding(row: unknown[]): Finding {
  return {
    id: row[0] as string,
    projectId: row[1] as string,
    sessionId: row[2] as string | null,
    source: row[3] as 'static' | 'dynamic',
    severity: row[4] as string,
    title: row[5] as string,
    description: row[6] as string,
    status: row[7] as 'new' | 'accepted' | 'dismissed' | 'fixed',
    createdAt: row[8] as string,
    artifactId: row[9] as string | null,
    category: row[10] as string,
    evidenceText: row[11] as string,
    recommendation: row[12] as string,
    confidence: row[13] as string,
    fromRemarks: !!row[14],
    filePath: (row[15] as string) ?? '',
    lineNumber: (row[16] as number | null) ?? null,
  };
}

export type CreateStaticSessionInput = {
  projectId: string;
  name: string;
  reviewType: ReviewType;
  configJson?: Record<string, unknown>;
  remarks?: string;
  /** P0-4: base git ref for diff scope (e.g. 'main'). Empty = no scope. */
  baseRef?: string;
  /** P0-4: head git ref for diff scope. Empty = no scope. */
  headRef?: string;
  /** P0-4: precomputed list of changed files; if absent, recomputed
   *  from base/head via gitScope.getChangedFiles. Pass explicitly when
   *  the caller has already done the git work (e.g. a future re-review). */
  changedFiles?: string[];
  /** P1-5: parent session id if this is a re-review. Carryover of
   *  unresolved findings happens in a separate call after the session
   *  is committed — the parent reference is just the lineage marker. */
  parentSessionId?: string;
};

export async function createStaticSession(input: CreateStaticSessionInput): Promise<StaticSession> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const baseRef = input.baseRef ?? '';
  const headRef = input.headRef ?? '';
  const changedFilesJson = JSON.stringify(input.changedFiles ?? []);
  const parentSessionId = input.parentSessionId ?? '';

  db.run(
    'INSERT INTO static_sessions (id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at, base_ref, head_ref, changed_files_json, parent_session_id, review_diff_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.projectId, input.name, input.reviewType, 'queued', JSON.stringify(input.configJson ?? {}), '{}', input.remarks ?? '', '', '', now, now, baseRef, headRef, changedFilesJson, parentSessionId, '']
  );
  saveDb();

  return {
    id, projectId: input.projectId, name: input.name, reviewType: input.reviewType, status: 'queued',
    configJson: JSON.stringify(input.configJson ?? {}), progressJson: '{}', remarks: input.remarks ?? '', finalSummary: '', failureReason: '',
    createdAt: now, updatedAt: now,
    baseRef, headRef, changedFilesJson,
    parentSessionId, reviewDiffJson: '',
  };
}

export async function listStaticSessions(projectId: string): Promise<StaticSession[]> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at, base_ref, head_ref, changed_files_json, parent_session_id, review_diff_json FROM static_sessions WHERE project_id = ? ORDER BY created_at DESC'
  );
  stmt.bind([projectId]);
  const rows: StaticSession[] = [];
  while (stmt.step()) {
    rows.push(mapSession(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

export async function getStaticSession(projectId: string, sessionId: string): Promise<StaticSession | null> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at, base_ref, head_ref, changed_files_json, parent_session_id, review_diff_json FROM static_sessions WHERE project_id = ? AND id = ?'
  );
  stmt.bind([projectId, sessionId]);
  let session: StaticSession | null = null;
  if (stmt.step()) {
    session = mapSession(stmt.get() as unknown[]);
  }
  stmt.free();
  return session;
}

export async function getActiveStaticSession(projectId: string): Promise<StaticSession | null> {
  const db = await getDb();
  const stmt = db.prepare(
    "SELECT id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at, base_ref, head_ref, changed_files_json, parent_session_id, review_diff_json FROM static_sessions WHERE project_id = ? AND (status = 'queued' OR status = 'running')"
  );
  stmt.bind([projectId]);
  let session: StaticSession | null = null;
  if (stmt.step()) {
    session = mapSession(stmt.get() as unknown[]);
  }
  stmt.free();
  return session;
}

export async function updateStaticSessionStatus(
  sessionId: string,
  status: StaticSessionStatus,
  finalSummary: string,
  failureReason: string
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  db.run(
    'UPDATE static_sessions SET status = ?, final_summary = ?, failure_reason = ?, updated_at = ? WHERE id = ?',
    [status, finalSummary, failureReason, now, sessionId]
  );
  saveDb();
}

export async function updateStaticSessionProgress(
  sessionId: string,
  progress: ReviewProgress
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  db.run(
    'UPDATE static_sessions SET progress_json = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify({ ...progress, updatedAt: now }), now, sessionId]
  );
  saveDb();
}

export async function createFinding(
  projectId: string,
  sessionId: string,
  data: {
    severity: string;
    title: string;
    description: string;
    category: string;
    evidenceText: string;
    recommendation: string;
    confidence: string;
    artifactId?: string;
    fromRemarks?: boolean;
    filePath?: string;
    lineNumber?: number;
  }
): Promise<Finding> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.run(
    'INSERT INTO findings (id, project_id, session_id, source, severity, title, description, status, created_at, artifact_id, category, evidence_text, recommendation, confidence, from_remarks, file_path, line_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, sessionId, 'static', data.severity, data.title, data.description, 'new', now, data.artifactId ?? null, data.category, data.evidenceText, data.recommendation, data.confidence, data.fromRemarks ? 1 : 0, data.filePath ?? '', data.lineNumber ?? null]
  );
  saveDb();

  return {
    id, projectId, sessionId, source: 'static', severity: data.severity,
    title: data.title, description: data.description, status: 'new', createdAt: now,
    artifactId: data.artifactId ?? null, category: data.category,
    evidenceText: data.evidenceText, recommendation: data.recommendation,
    confidence: data.confidence, fromRemarks: !!data.fromRemarks,
    filePath: data.filePath ?? '', lineNumber: data.lineNumber ?? null,
  };
}

export async function listStaticFindings(projectId: string, sessionId: string): Promise<Finding[]> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, project_id, session_id, source, severity, title, description, status, created_at, artifact_id, category, evidence_text, recommendation, confidence, from_remarks, file_path, line_number FROM findings WHERE project_id = ? AND session_id = ? ORDER BY created_at DESC'
  );
  stmt.bind([projectId, sessionId]);
  const rows: Finding[] = [];
  while (stmt.step()) {
    rows.push(mapFinding(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

export async function listAllFindings(projectId: string): Promise<Finding[]> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, project_id, session_id, source, severity, title, description, status, created_at, artifact_id, category, evidence_text, recommendation, confidence, from_remarks, file_path, line_number FROM findings WHERE project_id = ? ORDER BY created_at DESC'
  );
  stmt.bind([projectId]);
  const rows: Finding[] = [];
  while (stmt.step()) {
    rows.push(mapFinding(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

export async function updateFindingStatus(
  findingId: string,
  status: 'new' | 'accepted' | 'dismissed' | 'fixed'
): Promise<void> {
  const db = await getDb();
  db.run('UPDATE findings SET status = ? WHERE id = ?', [status, findingId]);
  saveDb();
}

export async function deleteStaticSessionsByProject(projectId: string): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM findings WHERE project_id = ? AND source = ?', [projectId, 'static']);
  db.run('DELETE FROM review_artifacts WHERE project_id = ?', [projectId]);
  db.run('DELETE FROM static_sessions WHERE project_id = ?', [projectId]);
  saveDb();
}

export async function createReviewArtifact(
  sessionId: string,
  projectId: string,
  data: { title: string; content: string; artifactType: string }
): Promise<ReviewArtifact> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO review_artifacts (id, session_id, project_id, title, content, artifact_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, sessionId, projectId, data.title, data.content, data.artifactType, now]
  );
  saveDb();
  return { id, sessionId, projectId, title: data.title, content: data.content, artifactType: data.artifactType, createdAt: now };
}

export async function listReviewArtifacts(projectId: string, sessionId: string): Promise<ReviewArtifact[]> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, session_id, project_id, title, content, artifact_type, created_at FROM review_artifacts WHERE project_id = ? AND session_id = ? ORDER BY created_at DESC'
  );
  stmt.bind([projectId, sessionId]);
  const rows: ReviewArtifact[] = [];
  while (stmt.step()) {
    const r = stmt.get() as unknown[];
    rows.push({
      id: r[0] as string,
      sessionId: r[1] as string,
      projectId: r[2] as string,
      title: r[3] as string,
      content: r[4] as string,
      artifactType: r[5] as string,
      createdAt: r[6] as string,
    });
  }
  stmt.free();
  return rows;
}

export async function listActiveStaticSessions(): Promise<StaticSession[]> {
  const db = await getDb();
  const stmt = db.prepare(
    "SELECT id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at, base_ref, head_ref, changed_files_json, parent_session_id, review_diff_json FROM static_sessions WHERE status IN ('queued', 'running') ORDER BY created_at DESC"
  );
  const rows: StaticSession[] = [];
  while (stmt.step()) {
    rows.push(mapSession(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

// ── P1-5: Re-review on push ──────────────────────────────────────────────

/**
 * Copy all 'new' and 'accepted' findings from the parent session into
 * the new session with status='carryover'. Resolved findings (dismissed
 * / fixed) stay where they are — the audit trail wants them attributed
 * to the session that closed them.
 *
 * Returns the count of carried findings. The carryover is best-effort:
 * if the new session is somehow missing (race condition) the function
 * is a no-op and returns 0.
 *
 * The "carryover" status exists so the dashboard can:
 *   - show a separate count of "still open from the last review"
 *   - re-classify these on the next re-review (new if the AI re-surfaced
 *     them, dismissed if it didn't, fixed if the code changed enough
 *     that the dedupe step suppressed them)
 */
export async function carryoverFindings(
  parentSessionId: string,
  newSessionId: string,
  projectId: string
): Promise<number> {
  const db = await getDb();
  // Read parent's open findings.
  const readStmt = db.prepare(
    `SELECT id, project_id, session_id, source, severity, title, description, status, created_at, artifact_id, category, evidence_text, recommendation, confidence, from_remarks, file_path, line_number FROM findings WHERE session_id = ? AND project_id = ? AND status IN ('new', 'accepted') ORDER BY created_at ASC`
  );
  readStmt.bind([parentSessionId, projectId]);
  type ParentRow = {
    id: string; projectId: string; sessionId: string | null; source: 'static' | 'dynamic';
    severity: string; title: string; description: string; status: string;
    createdAt: string; artifactId: string | null; category: string;
    evidenceText: string; recommendation: string; confidence: string;
    fromRemarks: boolean; filePath: string; lineNumber: number | null;
  };
  const parents: ParentRow[] = [];
  while (readStmt.step()) {
    const r = readStmt.get() as unknown[];
    parents.push({
      id: r[0] as string, projectId: r[1] as string, sessionId: r[2] as string,
      source: r[3] as 'static' | 'dynamic', severity: r[4] as string,
      title: r[5] as string, description: r[6] as string, status: r[7] as string,
      createdAt: r[8] as string, artifactId: r[9] as string | null,
      category: r[10] as string, evidenceText: r[11] as string,
      recommendation: r[12] as string, confidence: r[13] as string,
      fromRemarks: !!r[14], filePath: r[15] as string, lineNumber: r[16] as number | null,
    });
  }
  readStmt.free();

  // Insert as carryover. New id; created_at advances so the dashboard
  // sort puts carryover at the top of "what's still open".
  const now = new Date().toISOString();
  for (const p of parents) {
    db.run(
      `INSERT INTO findings (id, project_id, session_id, source, severity, title, description, status, created_at, artifact_id, category, evidence_text, recommendation, confidence, from_remarks, file_path, line_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(), projectId, newSessionId, p.source, p.severity,
        p.title, p.description, 'carryover', now, p.artifactId, p.category,
        p.evidenceText, p.recommendation, p.confidence, p.fromRemarks ? 1 : 0,
        p.filePath, p.lineNumber,
      ]
    );
  }
  saveDb();
  return parents.length;
}

export type SessionDiff = {
  parent: { id: string; createdAt: string; status: StaticSessionStatus };
  child: { id: string; createdAt: string; status: StaticSessionStatus };
  /** Findings that were 'new' or 'accepted' in the parent and remain
   *  'new' / 'accepted' / 'carryover' in the child (not yet addressed). */
  stillOpen: Array<{ id: string; title: string; severity: string; filePath: string; lineNumber: number | null }>;
  /** Findings from the parent that are now 'fixed' in the child (resolved). */
  fixed: Array<{ id: string; title: string; severity: string; filePath: string; lineNumber: number | null }>;
  /** Findings from the parent that are now 'dismissed' in the child. */
  dismissed: Array<{ id: string; title: string; severity: string; filePath: string; lineNumber: number | null }>;
  /** Findings that appeared only in the child (newly introduced). */
  newFindings: Array<{ id: string; title: string; severity: string; filePath: string; lineNumber: number | null }>;
  /** Counts for at-a-glance. */
  counts: { stillOpen: number; fixed: number; dismissed: number; newFindings: number };
};

/**
 * Compute the diff between a session and its parent. The mapping is
 * approximate — we don't have a stable cross-session ID for the same
 * underlying finding, so we match on (filePath, lineNumber) and the
 * first 40 chars of the title. This is good enough for "did the team
 * address this defect" reporting; an exact ID-based join is a future
 * improvement (would need a stable finding identity that survives
 * file edits, renames, etc.).
 */
export async function getSessionDiff(
  projectId: string,
  childId: string,
  parentId: string
): Promise<SessionDiff | null> {
  const parent = await getStaticSession(projectId, parentId);
  const child = await getStaticSession(projectId, childId);
  if (!parent || !child) return null;

  type F = { id: string; title: string; severity: string; filePath: string; lineNumber: number | null; status: string };
  const readAll = async (sessionId: string): Promise<F[]> => {
    const db = await getDb();
    const stmt = db.prepare(
      `SELECT id, title, severity, file_path, line_number, status FROM findings WHERE project_id = ? AND session_id = ? ORDER BY created_at ASC`
    );
    stmt.bind([projectId, sessionId]);
    const out: F[] = [];
    while (stmt.step()) {
      const r = stmt.get() as unknown[];
      out.push({
        id: r[0] as string, title: r[1] as string, severity: r[2] as string,
        filePath: r[3] as string, lineNumber: r[4] as number | null, status: r[5] as string,
      });
    }
    stmt.free();
    return out;
  };

  const [parentFs, childFs] = await Promise.all([readAll(parentId), readAll(childId)]);

  // Matching key: filePath:lineNumber + the first 40 chars of the
  // title. Trim and lowercase the title fragment so reworded titles
  // still match.
  const matchKey = (f: F): string => {
    const titlePrefix = (f.title || '').slice(0, 40).toLowerCase().replace(/\s+/g, ' ').trim();
    return `${f.filePath}:${f.lineNumber ?? '?'}::${titlePrefix}`;
  };

  const childByKey = new Map<string, F[]>();
  for (const f of childFs) {
    const k = matchKey(f);
    if (!childByKey.has(k)) childByKey.set(k, []);
    childByKey.get(k)!.push(f);
  }

  const stillOpen: SessionDiff['stillOpen'] = [];
  const fixed: SessionDiff['fixed'] = [];
  const dismissed: SessionDiff['dismissed'] = [];

  for (const p of parentFs) {
    const matches = childByKey.get(matchKey(p)) ?? [];
    // Take the first match; childFs may have multiple rows for the
    // same finding (e.g. a carryover and a fresh re-detection). The
    // fresher one wins for status reporting.
    const match = matches[0];
    if (!match) {
      // Parent had it, child didn't surface it. That's a 'fixed'
      // outcome from the user's perspective — the code change must
      // have addressed the underlying issue.
      fixed.push({ id: p.id, title: p.title, severity: p.severity, filePath: p.filePath, lineNumber: p.lineNumber });
      continue;
    }
    if (match.status === 'fixed') {
      fixed.push({ id: match.id, title: match.title, severity: match.severity, filePath: match.filePath, lineNumber: match.lineNumber });
    } else if (match.status === 'dismissed') {
      dismissed.push({ id: match.id, title: match.title, severity: match.severity, filePath: match.filePath, lineNumber: match.lineNumber });
    } else {
      // Still new / accepted / carryover
      stillOpen.push({ id: match.id, title: match.title, severity: match.severity, filePath: match.filePath, lineNumber: match.lineNumber });
    }
  }

  // New findings: in the child but not matched to any parent finding.
  const newFindings: SessionDiff['newFindings'] = [];
  for (const c of childFs) {
    const k = matchKey(c);
    const matchedParent = parentFs.some(p => matchKey(p) === k);
    if (!matchedParent) {
      newFindings.push({ id: c.id, title: c.title, severity: c.severity, filePath: c.filePath, lineNumber: c.lineNumber });
    }
  }

  return {
    parent: { id: parent.id, createdAt: parent.createdAt, status: parent.status },
    child: { id: child.id, createdAt: child.createdAt, status: child.status },
    stillOpen, fixed, dismissed, newFindings,
    counts: {
      stillOpen: stillOpen.length,
      fixed: fixed.length,
      dismissed: dismissed.length,
      newFindings: newFindings.length,
    },
  };
}
