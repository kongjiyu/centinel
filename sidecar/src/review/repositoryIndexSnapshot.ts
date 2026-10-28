import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { SupabaseClient } from '@supabase/supabase-js';
import { throwIfAborted } from './abort.js';

export const REPOSITORY_INDEX_ENGINE = 'open-codebase-index@0.38.1';
export const REPOSITORY_INDEX_POLICY = 'frozen-local-index-v1';
/** Shared default for Review and authenticated index-sync routes. Tests and
 * isolated evaluations may pass a temporary cacheRoot explicitly. */
export const DEFAULT_REPOSITORY_INDEX_CACHE_ROOT = fileURLToPath(new URL('../../../data/repository-index/', import.meta.url));
export const MAX_REPOSITORY_INDEX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
const MAX_FILES = 64;
const compress = promisify(gzip);
const decompress = promisify(gunzip);

export type RepositoryIndexIdentity = {
  projectId: string;
  fingerprint: string;
  engine: typeof REPOSITORY_INDEX_ENGINE;
  policy: typeof REPOSITORY_INDEX_POLICY;
  embedding: { provider: string; model: string; dimensions: number; endpointHash: string };
  sources: Array<{ artifactId: string; versionId: string; filePath: string; contentHash: string }>;
};

/** Public compatibility identity excludes credentials and machine-local paths.
 * Membership, rather than the producer's embedding API key, controls sharing. */
export function repositoryIndexIdentity(input: Omit<RepositoryIndexIdentity, 'fingerprint' | 'engine' | 'policy'>): RepositoryIndexIdentity {
  if (!/^[a-f\d-]{36}$/i.test(input.projectId)) throw new Error('A project UUID is required for the repository index.');
  if (!input.embedding.model || input.embedding.model.length > 256 || input.embedding.provider.length > 128
    || !Number.isSafeInteger(input.embedding.dimensions) || input.embedding.dimensions < 0
    || (input.embedding.dimensions === 0 && input.embedding.provider !== 'none')
    || !/^[a-f\d]{64}$/i.test(input.embedding.endpointHash)) throw new Error('Invalid repository embedding identity.');
  const sources = [...input.sources].sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  if (sources.length > 1024 || new Set(sources.map(item => item.artifactId)).size !== sources.length
    || sources.some(item => !item.artifactId || item.artifactId.length > 128 || !item.versionId || item.versionId.length > 128
      || !safeSourcePath(item.filePath) || !/^[a-f\d]{64}$/i.test(item.contentHash))) throw new Error('Invalid frozen repository source identity.');
  const identity: Omit<RepositoryIndexIdentity, 'fingerprint'> = { projectId: input.projectId, engine: REPOSITORY_INDEX_ENGINE, policy: REPOSITORY_INDEX_POLICY,
    embedding: input.embedding, sources };
  return { ...identity, fingerprint: crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex') };
}

type SnapshotFile = { name: string; sha256: string; bytes: number; content: string };
type Snapshot = { schemaVersion: 1; identity: RepositoryIndexIdentity; files: SnapshotFile[] };
const digest = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
export function repositoryIndexArchiveSha256(bytes: Buffer): string { return digest(bytes); }
function safeSourcePath(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !value.includes('\\')
    && !path.posix.isAbsolute(value) && !/[\u0000-\u001f\u007f:]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function normalizedIdentity(value: unknown): RepositoryIndexIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<RepositoryIndexIdentity>;
  if (typeof item.projectId !== 'string' || !item.embedding || !Array.isArray(item.sources)
    || item.engine !== REPOSITORY_INDEX_ENGINE || item.policy !== REPOSITORY_INDEX_POLICY
    || typeof item.fingerprint !== 'string' || !/^[a-f\d]{64}$/i.test(item.fingerprint)) return null;
  try {
    const identity = repositoryIndexIdentity({ projectId: item.projectId, embedding: item.embedding, sources: item.sources });
    return canonical(identity) === canonical(value) ? identity : null;
  } catch { return null; }
}
const safeName = (name: string) => name.length <= 512 && name.split('/').length <= 4
  && name.split('/').every(part => /^[a-zA-Z\d][a-zA-Z\d._-]{0,127}$/.test(part) && part !== '.' && part !== '..'
    && !/config|credential|secret|token|lock|recovery|failed-batches|\.tmp|\.log|\.shm|-shm$|mcp-runtime/i.test(part)
    && (!/(?:\.wal|-wal)$/i.test(part) || /\.(?:db|sqlite)-wal$/i.test(part)));

export function repositorySnapshotPath(identity: RepositoryIndexIdentity): string {
  return `${identity.projectId}/_repository-index/${identity.engine.replace('@', '-')}/${identity.fingerprint}.json.gz`;
}

type ValidatedSnapshot = { identity: RepositoryIndexIdentity; files: Array<{ name: string; bytes: Buffer }> };
async function decodeAndValidateSnapshot(bytes: Buffer, expected?: RepositoryIndexIdentity, allowedNames?: readonly string[], signal?: AbortSignal): Promise<ValidatedSnapshot> {
  if (bytes.length > MAX_REPOSITORY_INDEX_ARCHIVE_BYTES) throw new Error('Repository snapshot exceeds the download limit.');
  const decoded = await decompress(bytes, { maxOutputLength: MAX_EXPANDED_BYTES });
  const snapshot: unknown = JSON.parse(decoded.toString('utf8'));
  const value = snapshot as Partial<Snapshot> | null;
  const identity = normalizedIdentity(value?.identity);
  if (!value || value.schemaVersion !== 1 || !identity || expected && canonical(identity) !== canonical(expected)
    || !Array.isArray(value.files) || !value.files.length || value.files.length > MAX_FILES) throw new Error('Repository snapshot is incompatible.');
  const names = new Set<string>();
  const files: Array<{ name: string; bytes: Buffer }> = [];
  let total = 0;
  for (const file of value.files) {
    throwIfAborted(signal);
    if (!file || typeof file.name !== 'string' || !safeName(file.name) || (allowedNames && !allowedNames.includes(file.name))
      || names.has(file.name) || typeof file.content !== 'string' || !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(file.content)) throw new Error('Invalid repository snapshot entry.');
    const content = Buffer.from(file.content, 'base64');
    if (file.bytes !== content.length || file.sha256 !== digest(content)) throw new Error('Repository snapshot checksum failed.');
    total += content.length;
    if (total > MAX_EXPANDED_BYTES / 1.5) throw new Error('Repository index exceeds the shared snapshot limit.');
    names.add(file.name);
    files.push({ name: file.name, bytes: content });
  }
  return { identity, files };
}

/** Validate the full closed archive without writing native index files. */
export async function validateRepositorySnapshotArchive(bytes: Buffer, expected: RepositoryIndexIdentity, signal?: AbortSignal): Promise<void> {
  await decodeAndValidateSnapshot(bytes, expected, undefined, signal);
}

/** Called only after the engine closes. No config, lock, transient SHM or source workspace
 * files are accepted; callers supply the engine's explicit portable file list. */
export async function encodeRepositorySnapshot(indexDirectory: string, identity: RepositoryIndexIdentity, names: string[], signal?: AbortSignal): Promise<Buffer> {
  if (!names.length || names.length > MAX_FILES || new Set(names).size !== names.length) throw new Error('Invalid repository snapshot inventory.');
  const files: SnapshotFile[] = [];
  let total = 0;
  for (const name of [...names].sort()) {
    throwIfAborted(signal);
    if (!safeName(name)) throw new Error('Repository snapshot contains a forbidden file.');
    const filename = path.join(indexDirectory, name);
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_EXPANDED_BYTES) throw new Error('Invalid repository snapshot file.');
    const content = await fs.readFile(filename);
    total += content.length;
    if (total > MAX_EXPANDED_BYTES / 1.5) throw new Error('Repository index exceeds the shared snapshot limit.');
    files.push({ name, sha256: digest(content), bytes: content.length, content: content.toString('base64') });
  }
  const encoded = await compress(Buffer.from(JSON.stringify({ schemaVersion: 1, identity, files } satisfies Snapshot)));
  if (encoded.length > MAX_REPOSITORY_INDEX_ARCHIVE_BYTES) throw new Error('Repository snapshot exceeds the upload limit.');
  return encoded;
}

/** Fully validates the archive before writing. Restore only into a newly
 * allocated empty cache directory; never overwrite an existing local index. */
export async function restoreRepositorySnapshot(bytes: Buffer, indexDirectory: string, expected: RepositoryIndexIdentity, allowedNames?: readonly string[], signal?: AbortSignal): Promise<void> {
  const { files: validated } = await decodeAndValidateSnapshot(bytes, expected, allowedNames, signal);
  throwIfAborted(signal);
  await fs.mkdir(indexDirectory, { recursive: true });
  const directoryStat = await fs.lstat(indexDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('Repository snapshot restore requires a real local directory.');
  if ((await fs.readdir(indexDirectory)).length) throw new Error('Repository snapshot restore requires an empty directory.');
  for (const file of validated) {
    throwIfAborted(signal);
    const filename = path.join(indexDirectory, file.name);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, file.bytes, { flag: 'wx', mode: 0o600 });
  }
}

/** The caller must establish current project membership before using this
 * bearer-scoped Storage adapter. Never use a service-role client. */
export async function downloadRepositorySnapshot(client: SupabaseClient, identity: RepositoryIndexIdentity, signal?: AbortSignal): Promise<Buffer | null> {
  throwIfAborted(signal);
  const result = await client.storage.from('project-artifacts').download(repositorySnapshotPath(identity), {}, { signal });
  if (result.error) {
    const error = result.error as unknown as Record<string, unknown>;
    if (String(error.statusCode ?? error.status) === '404' || error.message === 'Object not found') return null;
    throw new Error('The shared repository index could not be read.');
  }
  if (!result.data || result.data.size > MAX_REPOSITORY_INDEX_ARCHIVE_BYTES) throw new Error('Invalid shared repository index size.');
  const bytes = Buffer.from(await result.data.arrayBuffer());
  throwIfAborted(signal);
  return bytes;
}

export async function uploadRepositorySnapshot(client: SupabaseClient, identity: RepositoryIndexIdentity, bytes: Buffer, signal?: AbortSignal): Promise<{ uploaded: boolean; archiveSha256: string; archiveBytes: number }> {
  throwIfAborted(signal);
  if (bytes.length > MAX_REPOSITORY_INDEX_ARCHIVE_BYTES) throw new Error('Repository snapshot exceeds the upload limit.');
  await validateRepositorySnapshotArchive(bytes, identity, signal);
  const result = await client.storage.from('project-artifacts').upload(repositorySnapshotPath(identity), bytes,
    { contentType: 'application/gzip', cacheControl: '31536000', upsert: false,
      metadata: { schemaVersion: 1, fingerprint: identity.fingerprint, engine: identity.engine, policy: identity.policy,
        archiveSha256: digest(bytes), artifactIds: identity.sources.map(source => source.artifactId) } });
  throwIfAborted(signal);
  // Another member may publish this same immutable compatibility key first.
  if (result.error) {
    const error = result.error as unknown as Record<string, unknown>;
    if (!['409', 'Duplicate'].includes(String(error.statusCode)) && !/already exists|duplicate/i.test(String(error.message ?? ''))) {
      throw new Error('The repository index could not be backed up to Supabase.');
    }
    const existing = await downloadRepositorySnapshot(client, identity, signal);
    if (!existing) throw new Error('The existing shared repository index could not be verified.');
    await validateRepositorySnapshotArchive(existing, identity, signal);
    return { uploaded: false, archiveSha256: digest(existing), archiveBytes: existing.length };
  }
  return { uploaded: true, archiveSha256: digest(bytes), archiveBytes: bytes.length };
}
