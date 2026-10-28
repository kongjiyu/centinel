import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CentinelApplicationRepository } from '../applicationRepository.js';
import { throwIfAborted } from './abort.js';
import { DEFAULT_REPOSITORY_INDEX_CACHE_ROOT, downloadRepositorySnapshot, MAX_REPOSITORY_INDEX_ARCHIVE_BYTES, repositoryIndexArchiveSha256,
  repositorySnapshotPath, uploadRepositorySnapshot, validateRepositorySnapshotArchive,
  type RepositoryIndexIdentity } from './repositoryIndexSnapshot.js';

const PUBLICATION_EVENT = 'repository_index_published';
const PUBLICATION_ENTITY = 'repository_index';
const PUBLICATION_SCHEMA = 1;
const hashText = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export type RepositoryIndexPublication = {
  schemaVersion: 1;
  fingerprint: string;
  identity: RepositoryIndexIdentity;
  archivePath: string;
  archiveSha256: string;
  archiveBytes: number;
};

export type RepositoryIndexSyncResult = {
  state: 'none' | 'available' | 'prefetched' | 'unchanged' | 'incompatible';
  fingerprint?: string;
  archiveSha256?: string;
};

type PublicationRow = { id?: unknown; project_id?: unknown; event_type?: unknown; payload?: unknown };
type PreparedPointer = { schemaVersion: 1; fingerprint: string; archiveSha256: string; archiveBytes: number; archiveFile: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Stable journal identity makes retries idempotent across project members. */
export function repositoryIndexPublicationId(identity: RepositoryIndexIdentity): string {
  const bytes = Buffer.from(hashText(`centinel:repository-index-publication:v1:${identity.projectId}:${identity.fingerprint}`).slice(0, 32), 'hex');
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function eventPayload(identity: RepositoryIndexIdentity, archiveSha256: string, archiveBytes: number): RepositoryIndexPublication {
  return { schemaVersion: PUBLICATION_SCHEMA, fingerprint: identity.fingerprint, identity,
    archivePath: repositorySnapshotPath(identity), archiveSha256, archiveBytes };
}

function validPublication(row: PublicationRow | null | undefined, identity: RepositoryIndexIdentity): RepositoryIndexPublication | null {
  if (!row || row.id !== repositoryIndexPublicationId(identity) || row.project_id !== identity.projectId
    || row.event_type !== PUBLICATION_EVENT || !row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) return null;
  const payload = row.payload as Partial<RepositoryIndexPublication>;
  if (payload.schemaVersion !== PUBLICATION_SCHEMA || payload.fingerprint !== identity.fingerprint
    || canonical(payload.identity) !== canonical(identity) || payload.archivePath !== repositorySnapshotPath(identity)
    || typeof payload.archiveSha256 !== 'string' || !/^[a-f\d]{64}$/i.test(payload.archiveSha256)
    || !Number.isSafeInteger(payload.archiveBytes) || payload.archiveBytes! < 1
    || payload.archiveBytes! > MAX_REPOSITORY_INDEX_ARCHIVE_BYTES) return null;
  return payload as RepositoryIndexPublication;
}

async function requireMember(client: SupabaseClient, ownerId: string, projectId: string, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (!/^[a-f\d-]{36}$/i.test(ownerId)) throw new Error('An authenticated owner UUID is required for repository-index sync.');
  await new CentinelApplicationRepository(client, ownerId).requireProjectMember(projectId, signal);
  throwIfAborted(signal);
}

async function readPublication(client: SupabaseClient, ownerId: string, projectId: string, identity: RepositoryIndexIdentity,
  signal?: AbortSignal, memberAlreadyChecked = false): Promise<RepositoryIndexPublication | null> {
  if (identity.projectId !== projectId) throw new Error('Repository-index project scope mismatch.');
  if (!memberAlreadyChecked) await requireMember(client, ownerId, projectId, signal);
  let query = client.from('audit_events').select('id,project_id,event_type,payload')
    .eq('id', repositoryIndexPublicationId(identity)).eq('project_id', projectId).eq('event_type', PUBLICATION_EVENT);
  if (signal) query = query.abortSignal(signal);
  const result = await query.maybeSingle();
  if (result.error) throw new Error('Repository-index publication metadata is unavailable.');
  if (!result.data) return null;
  const publication = validPublication(result.data as PublicationRow, identity);
  return publication;
}

/** Publish the immutable archive first, then an idempotent member-visible journal entry.
 * With upload:false, the caller must have just downloaded the archive from its exact path. */
export async function publishRepositoryIndex(client: SupabaseClient, ownerId: string, identity: RepositoryIndexIdentity, bytes: Buffer,
  options: { upload?: boolean; signal?: AbortSignal } = {}): Promise<RepositoryIndexPublication> {
  const { signal } = options;
  await requireMember(client, ownerId, identity.projectId, signal);
  await validateRepositorySnapshotArchive(bytes, identity, signal);
  // One publication is authoritative for a frozen identity. Warm local builds
  // can serialize SQLite differently while remaining compatible; retain the
  // immutable published archive instead of racing to replace or repoint it.
  const existing = await readPublication(client, ownerId, identity.projectId, identity, signal, true);
  if (existing) return existing;
  const uploaded = options.upload === false
    ? { archiveSha256: repositoryIndexArchiveSha256(bytes), archiveBytes: bytes.length }
    : await uploadRepositorySnapshot(client, identity, bytes, signal);
  const payload = eventPayload(identity, uploaded.archiveSha256, uploaded.archiveBytes);
  const row = { id: repositoryIndexPublicationId(identity), project_id: identity.projectId, actor_id: ownerId,
    event_type: PUBLICATION_EVENT, entity_type: PUBLICATION_ENTITY, entity_id: identity.projectId,
    idempotency_key: `repository-index:${identity.fingerprint}`, payload, created_at: new Date().toISOString() };
  const result = await client.from('audit_events').insert(row);
  throwIfAborted(signal);
  if (result.error) {
    // Concurrent producers of the same frozen identity intentionally converge
    // on one immutable archive and one deterministic publication row.
    const existing = await readPublication(client, ownerId, identity.projectId, identity, signal, true);
    if (!existing || canonical(existing) !== canonical(payload)) throw new Error('Repository-index publication could not be recorded.');
    return existing;
  }
  return payload;
}

function preparedDirectory(cacheRoot: string, ownerId: string, projectId: string): string {
  const scoped = hashText(`repository-index-sync:${ownerId}:${projectId}`);
  return path.join(path.resolve(cacheRoot), scoped, 'prepared');
}

async function ensurePreparedDirectory(directory: string): Promise<void> {
  const root = path.dirname(path.dirname(directory));
  await fs.mkdir(root, { recursive: true });
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Repository-index cache directory is unsafe.');
  const scope = path.dirname(directory);
  await fs.mkdir(scope, { recursive: true });
  const scopeStat = await fs.lstat(scope);
  if (!scopeStat.isDirectory() || scopeStat.isSymbolicLink()) throw new Error('Repository-index cache directory is unsafe.');
  await fs.mkdir(directory, { recursive: true });
  const directoryStat = await fs.lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('Repository-index cache directory is unsafe.');
}

function pointerPath(directory: string, fingerprint: string): string { return path.join(directory, `active-${fingerprint}.json`); }

async function readPreparedPointer(ownerId: string, identity: RepositoryIndexIdentity, cacheRoot: string, signal?: AbortSignal): Promise<{ bytes: Buffer; pointer: PreparedPointer } | null> {
  throwIfAborted(signal);
  const directory = preparedDirectory(cacheRoot, ownerId, identity.projectId);
  let pointer: PreparedPointer;
  try {
    const activePointer = pointerPath(directory, identity.fingerprint);
    const pointerStat = await fs.lstat(activePointer);
    if (!pointerStat.isFile() || pointerStat.isSymbolicLink() || pointerStat.size > 2_000) return null;
    const raw: unknown = JSON.parse(await fs.readFile(activePointer, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    pointer = raw as PreparedPointer;
  } catch { return null; }
  if (pointer.schemaVersion !== 1 || pointer.fingerprint !== identity.fingerprint
    || !/^[a-f\d]{64}$/i.test(pointer.archiveSha256) || !Number.isSafeInteger(pointer.archiveBytes)
    || pointer.archiveBytes < 1 || pointer.archiveBytes > MAX_REPOSITORY_INDEX_ARCHIVE_BYTES
    || typeof pointer.archiveFile !== 'string' || !/^archive-[a-f\d]{64}-[a-f\d-]{36}\.json\.gz$/i.test(pointer.archiveFile)) return null;
  const filename = path.join(directory, pointer.archiveFile);
  try {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== pointer.archiveBytes || stat.size > MAX_REPOSITORY_INDEX_ARCHIVE_BYTES) return null;
    const bytes = await fs.readFile(filename);
    throwIfAborted(signal);
    if (repositoryIndexArchiveSha256(bytes) !== pointer.archiveSha256) return null;
    await validateRepositorySnapshotArchive(bytes, identity, signal);
    return { bytes, pointer };
  } catch { throwIfAborted(signal); return null; }
}

/** Return the verified prefetched archive for this owner and exact identity.
 * Explicit Review still restores it into a fresh stage and runs native status(). */
export async function readPreparedRepositorySnapshot(ownerId: string, identity: RepositoryIndexIdentity, cacheRoot: string,
  signal?: AbortSignal): Promise<Buffer | null> {
  return (await readPreparedPointer(ownerId, identity, cacheRoot, signal))?.bytes ?? null;
}

async function savePreparedArchive(ownerId: string, publication: RepositoryIndexPublication, bytes: Buffer, cacheRoot: string, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const directory = preparedDirectory(cacheRoot, ownerId, publication.identity.projectId);
  await ensurePreparedDirectory(directory);
  const archiveFile = `archive-${publication.archiveSha256}-${crypto.randomUUID()}.json.gz`;
  const archivePath = path.join(directory, archiveFile);
  await fs.writeFile(archivePath, bytes, { flag: 'wx', mode: 0o600 });
  const pointer: PreparedPointer = { schemaVersion: 1, fingerprint: publication.fingerprint, archiveSha256: publication.archiveSha256,
    archiveBytes: bytes.length, archiveFile };
  const temporaryPointer = path.join(directory, `active-${crypto.randomUUID()}.tmp`);
  try {
    throwIfAborted(signal);
    await fs.writeFile(temporaryPointer, JSON.stringify(pointer), { flag: 'wx', mode: 0o600 });
    throwIfAborted(signal);
    // Keep pointers keyed by the full frozen identity. An older startup sync
    // completing after a newer one can then never replace the newer pointer.
    await fs.rename(temporaryPointer, pointerPath(directory, publication.fingerprint));
  } catch (error) {
    await fs.rm(temporaryPointer, { force: true }).catch(() => undefined);
    // The archive is immutable and harmless if pointer activation failed.
    throw error;
  }
}

async function inspectWithPublication(client: SupabaseClient, ownerId: string, projectId: string, identity: RepositoryIndexIdentity,
  cacheRoot: string, signal?: AbortSignal): Promise<{ result: RepositoryIndexSyncResult; publication: RepositoryIndexPublication | null }> {
  const publication = await readPublication(client, ownerId, projectId, identity, signal);
  if (!publication) {
    // A malformed row at our deterministic ID is not equivalent to no publication.
    let query = client.from('audit_events').select('id,project_id,event_type,payload')
      .eq('id', repositoryIndexPublicationId(identity)).eq('project_id', projectId);
    if (signal) query = query.abortSignal(signal);
    const result = await query.maybeSingle();
    if (result.error) throw new Error('Repository-index publication metadata is unavailable.');
    return { result: result.data ? { state: 'incompatible', fingerprint: identity.fingerprint } : { state: 'none' }, publication: null };
  }
  const local = await readPreparedPointer(ownerId, identity, cacheRoot, signal);
  if (local && local.pointer.archiveSha256 === publication.archiveSha256 && local.pointer.archiveBytes === publication.archiveBytes) {
    return { result: { state: 'unchanged', fingerprint: identity.fingerprint, archiveSha256: publication.archiveSha256 }, publication };
  }
  return { result: { state: 'available', fingerprint: identity.fingerprint, archiveSha256: publication.archiveSha256 }, publication };
}

/** GET handler seam: compare only exact current artifact/config identity and local archive hash. */
export async function inspectPublishedRepositoryIndex(client: SupabaseClient, ownerId: string, projectId: string,
  identity: RepositoryIndexIdentity, cacheRoot = DEFAULT_REPOSITORY_INDEX_CACHE_ROOT, signal?: AbortSignal): Promise<RepositoryIndexSyncResult> {
  const { result } = await inspectWithPublication(client, ownerId, projectId, identity, cacheRoot, signal);
  return result;
}

/** POST handler seam: download only a published compatible archive, validate all hashes,
 * then atomically switch the per-owner prepared pointer. It never materializes or opens it. */
export async function syncPublishedRepositoryIndex(client: SupabaseClient, ownerId: string, projectId: string,
  identity: RepositoryIndexIdentity, cacheRoot = DEFAULT_REPOSITORY_INDEX_CACHE_ROOT, signal?: AbortSignal): Promise<RepositoryIndexSyncResult> {
  const inspected = await inspectWithPublication(client, ownerId, projectId, identity, cacheRoot, signal);
  if (inspected.result.state !== 'available' || !inspected.publication) return inspected.result;
  const publication = inspected.publication;
  const bytes = await downloadRepositorySnapshot(client, identity, signal);
  if (!bytes || bytes.length !== publication.archiveBytes || repositoryIndexArchiveSha256(bytes) !== publication.archiveSha256) {
    return { state: 'incompatible', fingerprint: identity.fingerprint };
  }
  try { await validateRepositorySnapshotArchive(bytes, identity, signal); }
  catch { throwIfAborted(signal); return { state: 'incompatible', fingerprint: identity.fingerprint }; }
  await savePreparedArchive(ownerId, publication, bytes, cacheRoot, signal);
  const saved = await readPreparedPointer(ownerId, identity, cacheRoot, signal);
  if (!saved || saved.pointer.archiveSha256 !== publication.archiveSha256) return { state: 'incompatible', fingerprint: identity.fingerprint };
  return { state: 'prefetched', fingerprint: identity.fingerprint, archiveSha256: publication.archiveSha256 };
}

