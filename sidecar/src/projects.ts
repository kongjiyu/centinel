import path from 'node:path';
import { getDbPath, saveDb, getDb } from './db.js';

/** Historical local project record retained for Dynamic Testing and legacy
 * report-renderer fixtures. Static Project CRUD is Supabase-only. */
export type Project = {
  id: string;
  name: string;
  description: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
};

/** Dynamic Testing still resolves its local session workspace through this
 * reader. Do not use it as an authorization or Static Project source. */
export async function getProject(id: string): Promise<Project | null> {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, name, description, workspace_path, created_at, updated_at FROM projects WHERE id = ?');
  stmt.bind([id]);
  let project: Project | null = null;
  if (stmt.step()) {
    const row = stmt.get() as unknown[];
    project = {
      id: row[0] as string,
      name: row[1] as string,
      description: row[2] as string,
      workspacePath: row[3] as string,
      createdAt: row[4] as string,
      updatedAt: row[5] as string,
    };
  }
  stmt.free();
  return project;
}

/** Call only after Supabase membership verification. This local row is a
 * workspace pointer for Dynamic, never a second project authority. */
export async function ensureDynamicWorkspace(project: { id: string; name: string; description: string }): Promise<Project> {
  const existing = await getProject(project.id);
  if (existing) return existing;
  const workspacePath = path.join(path.dirname(getDbPath()), 'dynamic', project.id);
  const now = new Date().toISOString();
  const db = await getDb();
  db.run('INSERT OR IGNORE INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [project.id, project.name, project.description, workspacePath, now, now]);
  saveDb();
  return (await getProject(project.id))!;
}
