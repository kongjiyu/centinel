import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CentinelApplicationRepository } from './applicationRepository.js';
import { detectArtifactType, type Artifact, type ArtifactSource, type ArtifactType } from './artifacts.js';
import type { StoreArtifact } from './store/types.js';

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'build', '__pycache__', '.next', '.nuxt', 'vendor', 'target', 'bin', 'obj', '.idea', '.vscode']);
const MAX_IMPORT_FILES = 2_000;
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

function validArtifactType(value: unknown): value is ArtifactType {
  return value === 'requirement' || value === 'design' || value === 'source_code' || value === 'coding_standard' || value === 'other';
}

function displaySource(artifact: StoreArtifact): ArtifactSource {
  const value = artifact.metadata.source;
  return value === 'repository' || value === 'directory' || value === 'drive' ? value : 'documents';
}

export async function toClientArtifact(repository: CentinelApplicationRepository, artifact: StoreArtifact, signal?: AbortSignal): Promise<Artifact> {
  const versions = await repository.listArtifactVersions(artifact.projectId, artifact.id, signal);
  const latest = versions.at(-1);
  const type = validArtifactType(artifact.kind)
    ? artifact.kind
    : validArtifactType(artifact.metadata.type) ? artifact.metadata.type : detectArtifactType(artifact.name);
  return {
    id: artifact.id,
    projectId: artifact.projectId,
    versionId: latest?.id,
    type,
    source: displaySource(artifact),
    fileName: artifact.name,
    filePath: artifact.path,
    originalPath: typeof artifact.metadata.originalPath === 'string' ? artifact.metadata.originalPath : null,
    contentHash: latest?.contentHash ?? '',
    createdAt: artifact.createdAt,
  };
}

export async function listClientArtifacts(repository: CentinelApplicationRepository, projectId: string, signal?: AbortSignal): Promise<Artifact[]> {
  const artifacts = await repository.listArtifacts(projectId, signal);
  return Promise.all(artifacts.map(artifact => toClientArtifact(repository, artifact, signal)));
}

export async function getClientArtifact(client: SupabaseClient, userId: string, artifactId: string, signal?: AbortSignal): Promise<Artifact | null> {
  let query = client.from('artifacts').select('*').eq('id', artifactId);
  if (signal) query = query.abortSignal(signal);
  const result = await query.maybeSingle();
  if (result.error) throw new Error(`Artifact lookup failed: ${result.error.message}`);
  if (!result.data) return null;
  const row = result.data as Record<string, unknown>;
  const artifact: StoreArtifact = {
    id: String(row.id), projectId: String(row.project_id), sourceId: row.source_id ? String(row.source_id) : null,
    path: String(row.path ?? ''), name: String(row.name ?? ''), kind: String(row.kind ?? 'file'),
    mimeType: row.mime_type ? String(row.mime_type) : null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {},
    createdAt: String(row.created_at ?? ''), updatedAt: String(row.updated_at ?? ''),
  };
  return toClientArtifact(new CentinelApplicationRepository(client, userId), artifact, signal);
}

export async function readClientArtifactContent(client: SupabaseClient, userId: string, artifactId: string, frozenVersionId?: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  const artifact = await getClientArtifact(client, userId, artifactId, signal);
  if (!artifact) throw new Error('Artifact not found.');
  const repository = new CentinelApplicationRepository(client, userId);
  const versionId = frozenVersionId ?? artifact.versionId;
  if (!versionId) throw new Error('Artifact has no durable version.');
  const version = await repository.getArtifactVersion(artifact.projectId, versionId, signal);
  if (!version || version.artifactId !== artifactId) throw new Error('Frozen artifact version is unavailable.');
  return (await repository.downloadArtifactVersion(artifact.projectId, version.id, signal)).toString('utf8');
}

export async function uploadClientArtifact(
  repository: CentinelApplicationRepository,
  input: { projectId: string; fileName: string; content: Buffer; type?: ArtifactType; path?: string; source?: ArtifactSource; originalPath?: string | null },
): Promise<Artifact> {
  const type = input.type ?? detectArtifactType(input.fileName);
  const artifact = await repository.saveArtifact({
    projectId: input.projectId,
    sourceId: null,
    path: input.path ?? `uploads/${crypto.randomUUID()}-${input.fileName}`,
    name: input.fileName,
    kind: type,
    mimeType: 'application/octet-stream',
    metadata: { source: input.source ?? 'documents', originalPath: input.originalPath ?? null, type },
  });
  await repository.uploadArtifactVersion({ projectId: input.projectId, artifactId: artifact.id, content: input.content });
  return toClientArtifact(repository, artifact);
}

/** Local files are a source of bytes only; every imported version is persisted
 * in private Supabase Storage before it can enter a Review. */
export async function importLocalRepositoryArtifacts(
  repository: CentinelApplicationRepository,
  projectId: string,
  repoPath: string,
): Promise<{ imported: Artifact[]; skipped: string[] }> {
  const root = path.resolve(repoPath);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('Path is not a valid directory');
  const imported: Artifact[] = [];
  const skipped: string[] = [];
  const directories = [root];
  while (directories.length > 0) {
    const current = directories.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(root, fullPath).replaceAll('\\', '/');
      if (entry.isSymbolicLink()) { skipped.push(relativePath); continue; }
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) directories.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (detectArtifactType(entry.name) === 'other') continue;
      if (imported.length >= MAX_IMPORT_FILES) { skipped.push(relativePath); continue; }
      const fileStat = await fs.stat(fullPath);
      if (fileStat.size > MAX_IMPORT_FILE_BYTES) { skipped.push(relativePath); continue; }
      try {
        const content = await fs.readFile(fullPath);
        imported.push(await uploadClientArtifact(repository, {
          projectId, fileName: entry.name, content, path: relativePath,
          source: 'repository', originalPath: fullPath,
        }));
      } catch {
        skipped.push(relativePath);
      }
    }
  }
  return { imported, skipped };
}
