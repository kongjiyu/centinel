import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb, saveDb } from './db.js';

export type ArtifactType = 'requirement' | 'design' | 'source_code' | 'coding_standard' | 'other';
export type ArtifactSource = 'documents' | 'repository' | 'drive';

export type Artifact = {
  id: string;
  projectId: string;
  type: ArtifactType;
  source: ArtifactSource;
  fileName: string;
  filePath: string;
  originalPath: string | null;
  contentHash: string;
  createdAt: string;
};

const SUPPORTED_EXTENSIONS: Record<string, ArtifactType> = {
  '.txt': 'requirement',
  '.md': 'requirement',
  '.js': 'source_code',
  '.ts': 'source_code',
  '.py': 'source_code',
  '.java': 'source_code',
  '.cs': 'source_code',
  '.jsx': 'source_code',
  '.tsx': 'source_code',
  '.json': 'other',
  '.yaml': 'other',
  '.yml': 'other',
  '.html': 'source_code',
  '.css': 'source_code',
  '.go': 'source_code',
  '.rb': 'source_code',
  '.php': 'source_code',
  '.rs': 'source_code',
  '.cpp': 'source_code',
  '.c': 'source_code',
  '.h': 'source_code',
};

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', '__pycache__',
  '.next', '.nuxt', 'vendor', 'target', 'bin', 'obj', '.idea', '.vscode',
]);

function mapRow(row: unknown[]): Artifact {
  return {
    id: row[0] as string,
    projectId: row[1] as string,
    type: row[2] as ArtifactType,
    source: (row[8] as ArtifactSource) || 'documents',
    fileName: row[3] as string,
    filePath: row[4] as string,
    originalPath: row[5] as string | null,
    contentHash: row[6] as string,
    createdAt: row[7] as string,
  };
}

export function computeContentHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function detectArtifactType(fileName: string): ArtifactType {
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_EXTENSIONS[ext] ?? 'other';
}

export async function listArtifacts(projectId: string): Promise<Artifact[]> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, project_id, type, file_name, file_path, original_path, content_hash, created_at, source FROM artifacts WHERE project_id = ? ORDER BY created_at DESC'
  );
  stmt.bind([projectId]);
  const rows: Artifact[] = [];
  while (stmt.step()) {
    rows.push(mapRow(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

export async function getArtifact(id: string): Promise<Artifact | null> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT id, project_id, type, file_name, file_path, original_path, content_hash, created_at, source FROM artifacts WHERE id = ?'
  );
  stmt.bind([id]);
  let artifact: Artifact | null = null;
  if (stmt.step()) {
    artifact = mapRow(stmt.get() as unknown[]);
  }
  stmt.free();
  return artifact;
}

export async function createArtifact(
  projectId: string,
  type: ArtifactType,
  fileName: string,
  content: Buffer,
  originalPath?: string,
  source: ArtifactSource = 'documents'
): Promise<Artifact> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');

  // Get workspace path
  const projStmt = db.prepare('SELECT workspace_path FROM projects WHERE id = ?');
  projStmt.bind([projectId]);
  let workspacePath = '';
  if (projStmt.step()) {
    workspacePath = (projStmt.get() as unknown[])[0] as string;
  }
  projStmt.free();
  if (!workspacePath) throw new Error('Project not found');

  const artifactsDir = path.join(workspacePath, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const destPath = path.join(artifactsDir, `${id}_${fileName}`);
  fs.writeFileSync(destPath, content);

  db.run(
    'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, type, fileName, destPath, originalPath ?? null, contentHash, source, now]
  );
  saveDb();

  return { id, projectId, type, source, fileName, filePath: destPath, originalPath: originalPath ?? null, contentHash, createdAt: now };
}

export async function deleteArtifact(id: string): Promise<boolean> {
  const db = await getDb();
  const artifact = await getArtifact(id);
  if (!artifact) return false;

  // Delete file from disk
  try {
    if (fs.existsSync(artifact.filePath)) {
      fs.unlinkSync(artifact.filePath);
    }
  } catch {
    // ignore file deletion errors
  }

  db.run('DELETE FROM artifacts WHERE id = ?', [id]);
  saveDb();
  return true;
}

export async function deleteArtifactsByProject(projectId: string): Promise<void> {
  const artifacts = await listArtifacts(projectId);
  for (const a of artifacts) {
    try {
      if (fs.existsSync(a.filePath)) fs.unlinkSync(a.filePath);
    } catch { /* ignore */ }
  }
  const db = await getDb();
  db.run('DELETE FROM artifacts WHERE project_id = ?', [projectId]);
  saveDb();
}

export async function importArtifactsFromRepo(
  projectId: string,
  repoPath: string
): Promise<{ imported: Artifact[]; skipped: string[] }> {
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    throw new Error('Path is not a valid directory');
  }

  const imported: Artifact[] = [];
  const skipped: string[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext in SUPPORTED_EXTENSIONS) {
          const relPath = path.relative(repoPath, fullPath);
          try {
            const content = fs.readFileSync(fullPath);
            const hash = crypto.createHash('sha256').update(content).digest('hex');

            // Skip if content hash already exists for this project
            const db = getDbSync();
            if (db) {
              const stmt = db.prepare('SELECT id FROM artifacts WHERE project_id = ? AND content_hash = ?');
              stmt.bind([projectId, hash]);
              const exists = stmt.step();
              stmt.free();
              if (exists) {
                skipped.push(relPath);
                continue;
              }
            }

            const type = detectArtifactType(entry.name);
            const artifact = createArtifactSync(projectId, type, entry.name, content, fullPath);
            imported.push(artifact);
          } catch {
            skipped.push(relPath);
          }
        }
      }
    }
  }

  walk(repoPath);
  saveDb();
  return { imported, skipped };
}

// Synchronous helpers for import loop (getDb is async but we need it in sync walk)
let _syncDb: ReturnType<typeof getDb> extends Promise<infer T> ? T : never;

function getDbSync() {
  return _syncDb ?? null;
}

// Initialize sync db reference
export async function initSyncDb() {
  _syncDb = await getDb();
}

function createArtifactSync(
  projectId: string,
  type: ArtifactType,
  fileName: string,
  content: Buffer,
  originalPath: string,
  source: ArtifactSource = 'repository'
): Artifact {
  const db = _syncDb;
  if (!db) throw new Error('Database not initialized');

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');

  const projStmt = db.prepare('SELECT workspace_path FROM projects WHERE id = ?');
  projStmt.bind([projectId]);
  let workspacePath = '';
  if (projStmt.step()) {
    workspacePath = (projStmt.get() as unknown[])[0] as string;
  }
  projStmt.free();
  if (!workspacePath) throw new Error('Project not found');

  const artifactsDir = path.join(workspacePath, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const destPath = path.join(artifactsDir, `${id}_${fileName}`);
  fs.writeFileSync(destPath, content);

  db.run(
    'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, type, fileName, destPath, originalPath, contentHash, source, now]
  );

  return { id, projectId, type, source, fileName, filePath: destPath, originalPath, contentHash, createdAt: now };
}

export async function readArtifactContent(artifactId: string): Promise<string> {
  const artifact = await getArtifact(artifactId);
  if (!artifact) throw new Error('Artifact not found');
  return fs.readFileSync(artifact.filePath, 'utf-8');
}
