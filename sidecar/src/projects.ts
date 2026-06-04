import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb, saveDb } from './db.js';

export type Project = {
  id: string;
  name: string;
  description: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
};

function mapRow(row: unknown[]): Project {
  return {
    id: row[0] as string,
    name: row[1] as string,
    description: row[2] as string,
    workspacePath: row[3] as string,
    createdAt: row[4] as string,
    updatedAt: row[5] as string,
  };
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, name, description, workspace_path, created_at, updated_at FROM projects ORDER BY created_at DESC');
  const rows: Project[] = [];
  while (stmt.step()) {
    rows.push(mapRow(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

export async function getProject(id: string): Promise<Project | null> {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, name, description, workspace_path, created_at, updated_at FROM projects WHERE id = ?');
  stmt.bind([id]);
  let project: Project | null = null;
  if (stmt.step()) {
    project = mapRow(stmt.get() as unknown[]);
  }
  stmt.free();
  return project;
}

export async function createProject(name: string, description: string, workspacePath: string): Promise<Project> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  fs.mkdirSync(path.join(workspacePath, 'artifacts'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, 'evidence'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, 'sessions'), { recursive: true });

  db.run(
    'INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, name.trim(), description.trim(), workspacePath, now, now]
  );
  saveDb();

  return { id, name: name.trim(), description: description.trim(), workspacePath, createdAt: now, updatedAt: now };
}

export async function deleteProject(id: string): Promise<boolean> {
  const db = await getDb();
  const project = await getProject(id);
  if (!project) return false;

  db.run('DELETE FROM evidence WHERE project_id = ?', [id]);
  db.run('DELETE FROM findings WHERE project_id = ?', [id]);
  db.run('DELETE FROM sessions WHERE project_id = ?', [id]);
  db.run('DELETE FROM static_sessions WHERE project_id = ?', [id]);
  db.run('DELETE FROM artifacts WHERE project_id = ?', [id]);
  db.run('DELETE FROM projects WHERE id = ?', [id]);
  saveDb();
  return true;
}
