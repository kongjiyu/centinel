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
};

export type Finding = {
  id: string;
  projectId: string;
  sessionId: string | null;
  source: 'static' | 'dynamic';
  severity: string;
  title: string;
  description: string;
  status: 'new' | 'accepted' | 'dismissed' | 'fixed';
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
    // P0-4: diff scope columns (back-filled by the migration in db.ts
    // with empty defaults, so older SELECTs from before this commit
    // need this many placeholders). The new SELECTs in this file now
    // pull 14 columns; both counts are tracked together — if one
    // drifts, the other will fail to compile and that's a good thing.
    baseRef: (row[12] as string) ?? '',
    headRef: (row[13] as string) ?? '',
    changedFilesJson: (row[14] as string) ?? '[]',
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
};

export async function createStaticSession(input: CreateStaticSessionInput): Promise<StaticSession> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const baseRef = input.baseRef ?? '';
  const headRef = input.headRef ?? '';
  const changedFilesJson = JSON.stringify(input.changedFiles ?? []);

  db.run(
    'INSERT INTO static_sessions (id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at, base_ref, head_ref, changed_files_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.projectId, input.name, input.reviewType, 'queued', JSON.stringify(input.configJson ?? {}), '{}', input.remarks ?? '', '', '', now, now, baseRef, headRef, changedFilesJson]
  );
  saveDb();

  return {
    id, projectId: input.projectId, name: input.name, reviewType: input.reviewType, status: 'queued',
    configJson: JSON.stringify(input.configJson ?? {}), progressJson: '{}', remarks: input.remarks ?? '', finalSummary: '', failureReason: '',
    createdAt: now, updatedAt: now,
    baseRef, headRef, changedFilesJson,
  };
}

export async function listStaticSessions(projectId: string): Promise<StaticSession[]> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at, base_ref, head_ref, changed_files_json FROM static_sessions WHERE project_id = ? ORDER BY created_at DESC'
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
    'SELECT id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at, base_ref, head_ref, changed_files_json FROM static_sessions WHERE project_id = ? AND id = ?'
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
    "SELECT id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at, base_ref, head_ref, changed_files_json FROM static_sessions WHERE project_id = ? AND (status = 'queued' OR status = 'running')"
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
    "SELECT id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at, base_ref, head_ref, changed_files_json FROM static_sessions WHERE status IN ('queued', 'running') ORDER BY created_at DESC"
  );
  const rows: StaticSession[] = [];
  while (stmt.step()) {
    rows.push(mapSession(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}
