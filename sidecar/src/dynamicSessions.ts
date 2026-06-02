import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb, saveDb } from './db.js';

export type DynamicSessionStatus = 'queued' | 'running' | 'success' | 'failure' | 'blocked' | 'cancelled';

export type DynamicSession = {
  id: string;
  projectId: string;
  type: 'dynamic';
  name: string;
  status: DynamicSessionStatus;
  targetUrl: string;
  goal: string;
  missionType: 'user_journey' | 'smoke';
  browserMode: 'headed';
  maxSteps: number;
  finalSummary: string;
  failureReason: string;
  createdAt: string;
  updatedAt: string;
};

export type DynamicEvidence = {
  id: string;
  type: 'screenshot' | 'action_trace' | 'ai_response' | 'console_log' | 'session_summary';
  filePath: string;
  summary: string;
  createdAt: string;
};

function mapSessionRow(row: unknown[]): DynamicSession {
  return {
    id: row[0] as string,
    projectId: row[1] as string,
    type: 'dynamic',
    name: row[2] as string,
    status: row[3] as DynamicSessionStatus,
    targetUrl: row[4] as string,
    goal: row[5] as string,
    missionType: row[6] as 'user_journey' | 'smoke',
    browserMode: 'headed',
    maxSteps: row[7] as number,
    finalSummary: row[8] as string,
    failureReason: row[9] as string,
    createdAt: row[10] as string,
    updatedAt: row[11] as string,
  };
}

export async function createDynamicSession(
  projectId: string,
  targetUrl: string,
  goal: string,
  missionType: 'user_journey' | 'smoke',
  maxSteps: number
): Promise<DynamicSession> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const name = `${missionType === 'smoke' ? 'Smoke' : 'Journey'}: ${goal.slice(0, 50)}`;

  // Get project workspace path
  const stmt = db.prepare('SELECT workspace_path FROM projects WHERE id = ?');
  stmt.bind([projectId]);
  let workspacePath = '';
  if (stmt.step()) {
    workspacePath = (stmt.get() as unknown[])[0] as string;
  }
  stmt.free();

  if (!workspacePath) throw new Error('Project not found');

  // Create session workspace
  const sessionDir = path.join(workspacePath, 'sessions', id);
  fs.mkdirSync(path.join(sessionDir, 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'ai'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'logs'), { recursive: true });

  // Insert session
  db.run(
    'INSERT INTO sessions (id, project_id, type, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, 'dynamic', name, 'queued', now, now]
  );

  // Insert details
  db.run(
    'INSERT INTO dynamic_session_details (session_id, target_url, goal, mission_type, browser_mode, max_steps) VALUES (?, ?, ?, ?, ?, ?)',
    [id, targetUrl, goal, missionType, 'headed', maxSteps]
  );

  saveDb();

  return {
    id, projectId, type: 'dynamic', name, status: 'queued',
    targetUrl, goal, missionType, browserMode: 'headed', maxSteps,
    finalSummary: '', failureReason: '', createdAt: now, updatedAt: now,
  };
}

export async function listDynamicSessions(projectId: string): Promise<DynamicSession[]> {
  const db = await getDb();
  const stmt = db.prepare(`
    SELECT s.id, s.project_id, s.name, s.status,
           d.target_url, d.goal, d.mission_type, d.max_steps,
           d.final_summary, d.failure_reason, s.created_at, s.updated_at
    FROM sessions s
    JOIN dynamic_session_details d ON s.id = d.session_id
    WHERE s.project_id = ? AND s.type = 'dynamic'
    ORDER BY s.created_at DESC
  `);
  stmt.bind([projectId]);
  const rows: DynamicSession[] = [];
  while (stmt.step()) {
    rows.push(mapSessionRow(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

export async function getDynamicSession(projectId: string, sessionId: string): Promise<DynamicSession | null> {
  const db = await getDb();
  const stmt = db.prepare(`
    SELECT s.id, s.project_id, s.name, s.status,
           d.target_url, d.goal, d.mission_type, d.max_steps,
           d.final_summary, d.failure_reason, s.created_at, s.updated_at
    FROM sessions s
    JOIN dynamic_session_details d ON s.id = d.session_id
    WHERE s.id = ? AND s.project_id = ? AND s.type = 'dynamic'
  `);
  stmt.bind([sessionId, projectId]);
  let session: DynamicSession | null = null;
  if (stmt.step()) {
    session = mapSessionRow(stmt.get() as unknown[]);
  }
  stmt.free();
  return session;
}

export async function updateDynamicSessionStatus(
  sessionId: string,
  status: DynamicSessionStatus,
  finalSummary?: string,
  failureReason?: string
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  db.run('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?', [status, now, sessionId]);
  if (finalSummary !== undefined) {
    db.run('UPDATE dynamic_session_details SET final_summary = ? WHERE session_id = ?', [finalSummary, sessionId]);
  }
  if (failureReason !== undefined) {
    db.run('UPDATE dynamic_session_details SET failure_reason = ? WHERE session_id = ?', [failureReason, sessionId]);
  }
  saveDb();
}

export async function getActiveSession(projectId: string): Promise<DynamicSession | null> {
  const db = await getDb();
  const stmt = db.prepare(`
    SELECT s.id FROM sessions s
    WHERE s.project_id = ? AND s.type = 'dynamic' AND s.status IN ('queued', 'running')
    LIMIT 1
  `);
  stmt.bind([projectId]);
  let id: string | null = null;
  if (stmt.step()) {
    id = (stmt.get() as unknown[])[0] as string;
  }
  stmt.free();
  if (!id) return null;
  return getDynamicSession(projectId, id);
}

export async function listDynamicEvidence(projectId: string, sessionId: string): Promise<DynamicEvidence[]> {
  const db = await getDb();
  const stmt = db.prepare(`
    SELECT id, type, file_path, summary, created_at
    FROM evidence
    WHERE project_id = ? AND session_id = ?
    ORDER BY created_at ASC
  `);
  stmt.bind([projectId, sessionId]);
  const rows: DynamicEvidence[] = [];
  while (stmt.step()) {
    const row = stmt.get() as unknown[];
    rows.push({
      id: row[0] as string,
      type: row[1] as DynamicEvidence['type'],
      filePath: row[2] as string,
      summary: row[3] as string,
      createdAt: row[4] as string,
    });
  }
  stmt.free();
  return rows;
}

export async function addEvidence(
  projectId: string,
  sessionId: string,
  type: DynamicEvidence['type'],
  filePath: string,
  summary: string
): Promise<void> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO evidence (id, project_id, session_id, type, file_path, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, sessionId, type, filePath, summary, now]
  );
  saveDb();
}
