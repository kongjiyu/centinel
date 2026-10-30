import { boundedSourceRead } from './review/abort.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CentinelApplicationRepository } from './applicationRepository.js';
import { detectArtifactType, type Artifact, type ArtifactSource, type ArtifactType } from './artifacts.js';
import type { StoreArtifact, StoreArtifactVersion } from './store/types.js';

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'build', '__pycache__', '.next', '.nuxt', 'vendor', 'target', 'bin', 'obj', '.idea', '.vscode']);
const MAX_IMPORT_FILES = 2_000;
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_LOCAL_INVENTORY_ENTRIES = 20_000;
const MAX_LOCAL_INVENTORY_SOURCE_BYTES = 128 * 1024 * 1024;

export type LocalRepositoryInventory = {
  root: string;
  rootHash: string;
  inventoryFingerprint?: string;
  contentFingerprint?: string;
  sourceFiles?: Array<{ filePath: string; contentHash: string }>;
  complete: boolean;
};

export type LocalImportCoverage = {
  rootHash: string;
  imported: number;
  skipped: number;
  artifactIds: string[];
  inventoryFingerprint?: string;
  contentFingerprint?: string;
};

type LocalRepositoryFile = { path: string; fullPath: string; size: number; mtimeMs: number; ctimeMs: number; symlink: boolean };

const sha256 = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const LOCAL_OTHER_EXTENSIONS = new Set(['.json', '.jsonc', '.yaml', '.yml', '.xml', '.toml', '.ini', '.mod', '.csproj', '.gradle', '.kts', '.swift', '.kt', '.scala', '.dart', '.vue', '.svelte', '.sql', '.sh', '.bash', '.lua']);
const LOCAL_OTHER_NAMES = new Set(['.editorconfig', 'Gemfile', 'Dockerfile', 'Makefile']);

function isImportableLocalFile(fileName: string): boolean {
  return detectArtifactType(fileName) !== 'other' || LOCAL_OTHER_EXTENSIONS.has(path.extname(fileName).toLowerCase())
    || LOCAL_OTHER_NAMES.has(fileName);
}

function localRootHash(root: string): string {
  return sha256(root.toLowerCase());
}

export function localRepositoryContentFingerprint(sources: Array<{ filePath: string; contentHash: string }>): string {
  const normalized = sources.map(source => ({ path: source.filePath.replaceAll('\\', '/'),
    contentHash: source.contentHash.replace(/^sha256:/i, '').toLowerCase() })).sort((left, right) => left.path.localeCompare(right.path));
  return sha256(JSON.stringify(normalized));
}

/** A bounded metadata-first inventory for local-repository polling. Content
 * hashes are read only after metadata changes or when establishing a legacy
 * baseline; sources too large to scan safely leave the inventory incomplete. */
export async function inspectLocalRepository(repoPath: string, includeContent = false): Promise<LocalRepositoryInventory | null> {
  if (typeof repoPath !== 'string' || !repoPath.trim()) return null;
  const root = path.resolve(repoPath);
  const rootStat = await fs.stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) return null;
  const files: LocalRepositoryFile[] = [];
  const directories = [root];
  let visited = 0;
  try {
    while (directories.length) {
      const current = directories.pop()!;
      for (const entry of await fs.readdir(current, { withFileTypes: true })) {
        if (++visited > MAX_LOCAL_INVENTORY_ENTRIES) return { root, rootHash: localRootHash(root), complete: false };
        const fullPath = path.join(current, entry.name);
        const relativePath = path.relative(root, fullPath).replaceAll('\\', '/');
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          if (!SKIP_DIRS.has(entry.name)) directories.push(fullPath);
          continue;
        }
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        const stat = await fs.lstat(fullPath);
        files.push({ path: relativePath, fullPath, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
          symlink: entry.isSymbolicLink() });
      }
    }
  } catch { return { root, rootHash: localRootHash(root), complete: false }; }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const inventoryFingerprint = sha256(JSON.stringify(files.map(file => [file.path, file.symlink ? 'symlink' : 'file', file.size, file.mtimeMs, file.ctimeMs])));
  if (!includeContent) return { root, rootHash: localRootHash(root), inventoryFingerprint, complete: true };

  const sources: Array<{ filePath: string; contentHash: string }> = [];
  let sourceBytes = 0;
  for (const file of files) {
    if (file.symlink || !isImportableLocalFile(path.basename(file.path))) continue;
    if (sources.length >= MAX_IMPORT_FILES || file.size > MAX_IMPORT_FILE_BYTES
      || (sourceBytes += file.size) > MAX_LOCAL_INVENTORY_SOURCE_BYTES) {
      return { root, rootHash: localRootHash(root), inventoryFingerprint, complete: false };
    }
    try {
      const content = await fs.readFile(file.fullPath);
      const after = await fs.lstat(file.fullPath);
      if (after.isSymbolicLink() || after.size !== file.size || after.mtimeMs !== file.mtimeMs || after.ctimeMs !== file.ctimeMs) {
        return { root, rootHash: localRootHash(root), inventoryFingerprint, complete: false };
      }
      sources.push({ filePath: file.path, contentHash: sha256(content) });
    } catch { return { root, rootHash: localRootHash(root), inventoryFingerprint, complete: false }; }
  }
  return { root, rootHash: localRootHash(root), inventoryFingerprint,
    contentFingerprint: localRepositoryContentFingerprint(sources), sourceFiles: sources, complete: true };
}

export async function getLatestLocalImportCoverage(repository: CentinelApplicationRepository, projectId: string, rootHash: string): Promise<LocalImportCoverage | null> {
  const result = await repository.client.from('audit_events').select('payload').eq('project_id', projectId)
    .eq('entity_type', 'project').eq('entity_id', projectId).eq('event_type', 'local_import_coverage')
    .eq('payload->>rootHash', rootHash).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new Error('Local repository import history is unavailable.');
  const payload = result.data?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = payload as Partial<LocalImportCoverage>;
  if (value.rootHash !== rootHash || !Number.isSafeInteger(value.imported) || !Number.isSafeInteger(value.skipped)
    || !Array.isArray(value.artifactIds) || value.artifactIds.some(id => typeof id !== 'string')) throw new Error('Local repository import history is invalid.');
  return { rootHash, imported: value.imported!, skipped: value.skipped!, artifactIds: value.artifactIds as string[],
    ...(typeof value.inventoryFingerprint === 'string' && /^[a-f\d]{64}$/i.test(value.inventoryFingerprint) ? { inventoryFingerprint: value.inventoryFingerprint } : {}),
    ...(typeof value.contentFingerprint === 'string' && /^[a-f\d]{64}$/i.test(value.contentFingerprint) ? { contentFingerprint: value.contentFingerprint } : {}) };
}

export async function recordLocalImportCoverageBaseline(repository: CentinelApplicationRepository, projectId: string,
  coverage: LocalImportCoverage, inventory: LocalRepositoryInventory): Promise<void> {
  if (!inventory.complete || !inventory.inventoryFingerprint || !inventory.contentFingerprint || inventory.rootHash !== coverage.rootHash) {
    throw new Error('Local repository inventory is incomplete.');
  }
  const result = await repository.client.from('audit_events').insert({ id: crypto.randomUUID(), project_id: projectId,
    actor_id: repository.userId, event_type: 'local_import_coverage', entity_type: 'project', entity_id: projectId,
    payload: { ...coverage, inventoryFingerprint: inventory.inventoryFingerprint, contentFingerprint: inventory.contentFingerprint } });
  if (result.error) throw new Error('Local import coverage could not be recorded. Retry the import before assessing readiness.');
}

function validArtifactType(value: unknown): value is ArtifactType {
  return value === 'requirement' || value === 'design' || value === 'source_code' || value === 'coding_standard' || value === 'other';
}

function displaySource(artifact: StoreArtifact): ArtifactSource {
  if (artifact.metadata.provider === 'github') return 'repository';
  if (artifact.metadata.provider === 'google_drive') return 'drive';
  const value = artifact.metadata.source;
  return value === 'repository' || value === 'directory' || value === 'drive' ? value : 'documents';
}

export async function toClientArtifact(repository: CentinelApplicationRepository, artifact: StoreArtifact, signal?: AbortSignal): Promise<Artifact> {
  const versions = await repository.listArtifactVersions(artifact.projectId, artifact.id, signal);
  const latest = versions.at(-1);
  return clientArtifact(artifact, latest);
}

function clientArtifact(artifact: StoreArtifact, latest?: StoreArtifactVersion): Artifact {
  const type = validArtifactType(artifact.kind)
    ? artifact.kind
    : validArtifactType(artifact.metadata.type) ? artifact.metadata.type : detectArtifactType(artifact.name);
  return {
    id: artifact.id,
    projectId: artifact.projectId,
    sourceId: artifact.sourceId,
    versionId: latest?.id,
    type,
    source: displaySource(artifact),
    fileName: artifact.name,
    filePath: artifact.path,
    originalPath: typeof artifact.metadata.originalPath === 'string' ? artifact.metadata.originalPath
      : artifact.sourceId && typeof artifact.metadata.sourcePath === 'string' ? artifact.metadata.sourcePath : null,
    contentHash: latest?.contentHash ?? '',
    createdAt: artifact.createdAt,
  };
}

export async function listClientArtifacts(repository: CentinelApplicationRepository, projectId: string, signal?: AbortSignal): Promise<Artifact[]> {
  const [artifacts, versions] = await Promise.all([
    repository.listArtifacts(projectId, signal), repository.listProjectArtifactVersions(projectId, signal),
  ]);
  const latestVersions = new Map<string, StoreArtifactVersion>();
  for (const version of versions) {
    const previous = latestVersions.get(version.artifactId);
    if (!previous || version.versionNumber > previous.versionNumber
      || version.versionNumber === previous.versionNumber && version.id.localeCompare(previous.id) > 0) {
      latestVersions.set(version.artifactId, version);
    }
  }
  return artifacts.map(artifact => clientArtifact(artifact, latestVersions.get(artifact.id)));
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

export async function readClientArtifactContent(client: SupabaseClient, userId: string, artifactId: string, frozenVersionId?: string, signal?: AbortSignal, frozenProjectId?: string, frozenContentHash?: string): Promise<string> {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  const repository = new CentinelApplicationRepository(client, userId);
  if (frozenVersionId && frozenProjectId) {
    // Review execution already selected the immutable version. Membership and
    // artifact ownership are checked against that version, even if today's
    // artifact row has been removed. Never select a replacement current version.
    return (await repository.downloadFrozenArtifactVersion({ projectId: frozenProjectId, versionId: frozenVersionId,
      artifactId, expectedContentHash: frozenContentHash }, signal)).toString('utf8');
  }
  const artifact = await getClientArtifact(client, userId, artifactId, signal);
  if (!artifact) throw new Error('Artifact not found.');
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
  options: { observedInventory?: LocalRepositoryInventory; priorCoverage?: LocalImportCoverage; pruneArtifactIds?: string[] } = {},
): Promise<{ imported: Artifact[]; skipped: string[]; complete: boolean }> {
  if (typeof repoPath !== 'string' || !repoPath.trim()) throw new Error('Path is not a valid directory');
  const root = path.resolve(repoPath);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('Path is not a valid directory');
  const observedInventory = options.observedInventory ?? await inspectLocalRepository(root);
  if (observedInventory && (observedInventory.root !== root || observedInventory.rootHash !== localRootHash(root))) {
    throw new Error('Local repository inventory does not match the selected root.');
  }
  const imported: Artifact[] = [];
  const skipped: string[] = [];
  let eligibleCount = 0;
  let completeContentInventory = true;
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
      if (!isImportableLocalFile(entry.name)) { skipped.push(relativePath); continue; }
      if (++eligibleCount > MAX_IMPORT_FILES) { skipped.push(relativePath); completeContentInventory = false; continue; }
      const fileStat = await fs.stat(fullPath);
      if (fileStat.size > MAX_IMPORT_FILE_BYTES) { skipped.push(relativePath); completeContentInventory = false; continue; }
      try {
        const content = await fs.readFile(fullPath);
        imported.push(await uploadClientArtifact(repository, {
          projectId, fileName: entry.name, content, path: relativePath,
          source: 'repository', originalPath: fullPath,
        }));
      } catch {
        skipped.push(relativePath);
        completeContentInventory = false;
      }
    }
  }
  const importedIds = new Set(imported.map(artifact => artifact.id));
  if (observedInventory?.complete && completeContentInventory) {
    for (const artifactId of new Set(options.pruneArtifactIds ?? [])) {
      if (!importedIds.has(artifactId)) await repository.deleteArtifact(projectId, artifactId);
    }
  }
  const complete = Boolean(observedInventory?.complete && observedInventory.inventoryFingerprint && completeContentInventory);
  const contentFingerprint = complete
    ? localRepositoryContentFingerprint(imported.map(artifact => ({ filePath: artifact.filePath, contentHash: artifact.contentHash }))) : undefined;
  const coverageArtifactIds = complete ? imported.map(artifact => artifact.id)
    : [...new Set([...(options.priorCoverage?.artifactIds ?? []), ...imported.map(artifact => artifact.id)])];
  // Record only coverage metadata, never paths or source bodies. A bounded or
  // partial local import must not silently become a complete readiness result.
  try {
    const coverage = await repository.client.from('audit_events').insert({ id: crypto.randomUUID(), project_id: projectId,
      actor_id: repository.userId, event_type: 'local_import_coverage', entity_type: 'project', entity_id: projectId,
      payload: { rootHash: localRootHash(root), imported: imported.length,
        skipped: skipped.length, artifactIds: coverageArtifactIds,
        ...(complete && observedInventory?.inventoryFingerprint ? { inventoryFingerprint: observedInventory.inventoryFingerprint } : {}),
        ...(complete && contentFingerprint ? { contentFingerprint } : {}),
        ...(!complete && options.priorCoverage?.inventoryFingerprint ? { inventoryFingerprint: options.priorCoverage.inventoryFingerprint } : {}),
        ...(!complete && options.priorCoverage?.contentFingerprint ? { contentFingerprint: options.priorCoverage.contentFingerprint } : {}) } });
    if (coverage.error) throw new Error('Coverage write failed');
  } catch {
    throw new Error('Local import coverage could not be recorded. Retry the import before assessing readiness.');
  }
  return { imported, skipped, complete };
}

/** Authenticated exact-version byte reader for binary-safe Review ingestion. */
export async function readClientArtifactBytes(client: SupabaseClient, userId: string, artifact: Artifact, signal?: AbortSignal): Promise<Buffer> {
  if (!artifact.versionId || !artifact.contentHash) throw new Error('An exact frozen source version is required.');
  // Original attachments can be up to 100 MiB. Bound the complete download,
  // allowing more time than the small connected-source metadata queries.
  return boundedSourceRead(readSignal => new CentinelApplicationRepository(client, userId).downloadFrozenArtifactVersion({ projectId: artifact.projectId, artifactId: artifact.id, versionId: artifact.versionId!, expectedContentHash: artifact.contentHash }, readSignal), signal, 120_000);
}
