import crypto from 'crypto';
import { getDb, saveDb } from './db.js';

export type Requirement = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  createdAt: string;
};

export type RequirementMapping = {
  id: string;
  requirementId: string;
  fileId: string | null;
  symbolId: string | null;
  coverageStatus: string;
  confidence: number;
};

function mapRequirement(row: unknown[]): Requirement {
  return {
    id: row[0] as string,
    projectId: row[1] as string,
    title: row[2] as string,
    description: row[3] as string,
    category: row[4] as string,
    priority: row[5] as string,
    createdAt: row[6] as string,
  };
}

function mapMapping(row: unknown[]): RequirementMapping {
  return {
    id: row[0] as string,
    requirementId: row[1] as string,
    fileId: row[2] as string | null,
    symbolId: row[3] as string | null,
    coverageStatus: row[4] as string,
    confidence: row[5] as number,
  };
}

export async function createRequirement(
  projectId: string,
  title: string,
  description: string,
  category: string,
  priority: string,
): Promise<Requirement> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.run(
    'INSERT INTO requirements (id, project_id, title, description, category, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, title.trim(), description.trim(), category.trim(), priority.trim(), now],
  );
  saveDb();

  return { id, projectId, title: title.trim(), description: description.trim(), category: category.trim(), priority: priority.trim(), createdAt: now };
}

export async function listRequirements(projectId: string): Promise<Requirement[]> {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, project_id, title, description, category, priority, created_at FROM requirements WHERE project_id = ? ORDER BY created_at DESC');
  stmt.bind([projectId]);
  const rows: Requirement[] = [];
  while (stmt.step()) {
    rows.push(mapRequirement(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

export async function getRequirement(id: string): Promise<Requirement | null> {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, project_id, title, description, category, priority, created_at FROM requirements WHERE id = ?');
  stmt.bind([id]);
  let req: Requirement | null = null;
  if (stmt.step()) {
    req = mapRequirement(stmt.get() as unknown[]);
  }
  stmt.free();
  return req;
}

export async function updateRequirement(
  id: string,
  updates: Partial<Pick<Requirement, 'title' | 'description' | 'category' | 'priority'>>,
): Promise<Requirement> {
  const db = await getDb();
  const existing = await getRequirement(id);
  if (!existing) throw new Error('Requirement not found');

  const title = updates.title !== undefined ? updates.title.trim() : existing.title;
  const description = updates.description !== undefined ? updates.description.trim() : existing.description;
  const category = updates.category !== undefined ? updates.category.trim() : existing.category;
  const priority = updates.priority !== undefined ? updates.priority.trim() : existing.priority;

  db.run(
    'UPDATE requirements SET title = ?, description = ?, category = ?, priority = ? WHERE id = ?',
    [title, description, category, priority, id],
  );
  saveDb();

  return { ...existing, title, description, category, priority };
}

export async function deleteRequirement(id: string): Promise<boolean> {
  const db = await getDb();
  const existing = await getRequirement(id);
  if (!existing) return false;

  db.run('DELETE FROM requirement_mappings WHERE requirement_id = ?', [id]);
  db.run('DELETE FROM requirements WHERE id = ?', [id]);
  saveDb();
  return true;
}

export async function mapRequirementToCode(
  requirementId: string,
  fileId: string | null,
  symbolId: string | null,
  coverageStatus: string,
  confidence: number,
): Promise<RequirementMapping> {
  const db = await getDb();
  const id = crypto.randomUUID();

  db.run(
    'INSERT INTO requirement_mappings (id, requirement_id, file_id, symbol_id, coverage_status, confidence) VALUES (?, ?, ?, ?, ?, ?)',
    [id, requirementId, fileId, symbolId, coverageStatus, confidence],
  );
  saveDb();

  return { id, requirementId, fileId, symbolId, coverageStatus, confidence };
}

export async function getRequirementMappings(requirementId: string): Promise<RequirementMapping[]> {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, requirement_id, file_id, symbol_id, coverage_status, confidence FROM requirement_mappings WHERE requirement_id = ?');
  stmt.bind([requirementId]);
  const rows: RequirementMapping[] = [];
  while (stmt.step()) {
    rows.push(mapMapping(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

export async function getMappingsForFile(fileId: string): Promise<RequirementMapping[]> {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, requirement_id, file_id, symbol_id, coverage_status, confidence FROM requirement_mappings WHERE file_id = ?');
  stmt.bind([fileId]);
  const rows: RequirementMapping[] = [];
  while (stmt.step()) {
    rows.push(mapMapping(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}
