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
  };
}

export async function createStaticSession(
  projectId: string,
  name: string,
  reviewType: ReviewType,
  configJson: Record<string, unknown> = {},
  remarks: string = ''
): Promise<StaticSession> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.run(
    'INSERT INTO static_sessions (id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, name, reviewType, 'queued', JSON.stringify(configJson), '{}', remarks, '', '', now, now]
  );
  saveDb();

  return {
    id, projectId, name, reviewType, status: 'queued',
    configJson: JSON.stringify(configJson), progressJson: '{}', remarks, finalSummary: '', failureReason: '',
    createdAt: now, updatedAt: now,
  };
}

export async function listStaticSessions(projectId: string): Promise<StaticSession[]> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at FROM static_sessions WHERE project_id = ? ORDER BY created_at DESC'
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
    'SELECT id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at FROM static_sessions WHERE project_id = ? AND id = ?'
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
    "SELECT id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at FROM static_sessions WHERE project_id = ? AND (status = 'queued' OR status = 'running')"
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
  }
): Promise<Finding> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.run(
    'INSERT INTO findings (id, project_id, session_id, source, severity, title, description, status, created_at, artifact_id, category, evidence_text, recommendation, confidence, from_remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, sessionId, 'static', data.severity, data.title, data.description, 'new', now, data.artifactId ?? null, data.category, data.evidenceText, data.recommendation, data.confidence, data.fromRemarks ? 1 : 0]
  );
  saveDb();

  return {
    id, projectId, sessionId, source: 'static', severity: data.severity,
    title: data.title, description: data.description, status: 'new', createdAt: now,
    artifactId: data.artifactId ?? null, category: data.category,
    evidenceText: data.evidenceText, recommendation: data.recommendation,
    confidence: data.confidence, fromRemarks: !!data.fromRemarks,
  };
}

export async function listStaticFindings(projectId: string, sessionId: string): Promise<Finding[]> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, project_id, session_id, source, severity, title, description, status, created_at, artifact_id, category, evidence_text, recommendation, confidence, from_remarks FROM findings WHERE project_id = ? AND session_id = ? ORDER BY created_at DESC'
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
    'SELECT id, project_id, session_id, source, severity, title, description, status, created_at, artifact_id, category, evidence_text, recommendation, confidence, from_remarks FROM findings WHERE project_id = ? ORDER BY created_at DESC'
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
    "SELECT id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at FROM static_sessions WHERE status IN ('queued', 'running') ORDER BY created_at DESC"
  );
  const rows: StaticSession[] = [];
  while (stmt.step()) {
    rows.push(mapSession(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}
