import { isPdfSource, verifiedSourceText, verifiedTextForReader, PDF_TEXT_POLICY } from './sourceText.js';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artifact } from '../artifacts.js';
import { CentinelApplicationRepository } from '../applicationRepository.js';
import { readClientArtifactContent, readClientArtifactBytes } from '../applicationApi.js';
import { resolveSavedEmbeddingConfiguration } from '../modelSettings.js';
import { SupabaseCentinelStore } from '../store/supabase.js';
import { throwIfAborted } from './abort.js';
import type { RetrievedContext } from './contextTypes.js';
import { openCodebaseIndex, INDEX_RELATIVE_DIRECTORY, portableIndexFiles } from './openCodebaseIndex.js';
import { openRepositoryEmbeddingBridge } from './repositoryEmbeddingBridge.js';
import { downloadRepositorySnapshot, encodeRepositorySnapshot, repositoryIndexIdentity, restoreRepositorySnapshot,
  DEFAULT_REPOSITORY_INDEX_CACHE_ROOT, type RepositoryIndexIdentity } from './repositoryIndexSnapshot.js';
import { publishRepositoryIndex, readPreparedRepositorySnapshot } from './repositoryIndexSync.js';
import { assertSourceIndexProviderAllowed } from './sourceIndexJobs.js';

export { DEFAULT_REPOSITORY_INDEX_CACHE_ROOT } from './repositoryIndexSnapshot.js';
const CACHE_ROOT = DEFAULT_REPOSITORY_INDEX_CACHE_ROOT;
const locks = new Map<string, Promise<unknown>>();
const hash = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const validHash = (value: string) => /^[a-f\d]{64}$/i.test(value.replace(/^sha256:/i, ''));
const sourceHash = (value: string) => value.replace(/^sha256:/i, '').toLowerCase();
type FrozenReader = (artifact: Artifact, signal?: AbortSignal) => Promise<string>;
type ClientSource = SupabaseClient | (() => SupabaseClient);
const currentClient = (source: ClientSource): SupabaseClient => typeof source === 'function' ? source() : source;
type Source = { relativePath: string; artifact: Artifact; content: string };
type SourceMetadata = { relativePath: string; artifact: Artifact };
type Receipt = { identity: RepositoryIndexIdentity; files: Array<{ name: string; sha256: string }> };

async function locked<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  locks.set(key, next);
  try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
}

function stagePath(artifact: Artifact): string {
  const original = (artifact.filePath + (isPdfSource(artifact) ? `.${PDF_TEXT_POLICY}.txt` : '')).replace(/\\/g, '/').replace(/^\.\//, '');
  const safe = original && !path.posix.isAbsolute(original) && !/[:\u0000-\u001f\u007f]/.test(original)
    && original.split('/').every(part => part && part !== '.' && part !== '..' && !/^(?:\.git|\.codebase-index)$/i.test(part)
      && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(part));
  if (safe) return original;
  if (!/^[a-z\d-]{1,128}$/i.test(artifact.id)) throw new Error('Invalid frozen artifact identity.');
  const name = artifact.fileName.replace(/[^a-zA-Z\d._-]/g, '_').slice(0, 120) || 'source.txt';
  return `artifacts/${artifact.id}/${name}${isPdfSource(artifact) ? `.${PDF_TEXT_POLICY}.txt` : ''}`;
}

async function describe(clientSource: ClientSource, ownerId: string, projectId: string, artifacts: Artifact[], signal?: AbortSignal, cacheRoot = CACHE_ROOT) {
  const client = currentClient(clientSource);
  await new CentinelApplicationRepository(client, ownerId).requireProjectMember(projectId, signal);
  throwIfAborted(signal);
  const storageContract = await client.rpc('repository_index_storage_ready');
  if (storageContract.error || storageContract.data !== 1) throw new Error('Apply the repository-index retention migration before building or sharing source indexes. No embedding request was made.');
  if (!/^[a-f\d-]{36}$/i.test(ownerId)) throw new Error('An authenticated owner UUID is required for the local index.');
  const configuration = await resolveSavedEmbeddingConfiguration(client, ownerId, signal);
  const sources: SourceMetadata[] = [];
  const usedPaths = new Set<string>();
  for (const artifact of artifacts) {
    throwIfAborted(signal);
    if (artifact.projectId !== projectId || !artifact.versionId || !validHash(artifact.contentHash)) throw new Error('Repository indexing requires exact frozen project versions.');
    const relativePath = stagePath(artifact);
    if (usedPaths.has(relativePath.toLowerCase())) throw new Error('Selected sources have ambiguous repository paths.');
    usedPaths.add(relativePath.toLowerCase());
    sources.push({ relativePath, artifact });
  }
  const identity = repositoryIndexIdentity({ projectId,
    embedding: { provider: configuration?.embeddingProvider ?? 'none', model: configuration?.model ?? 'structural-only',
      dimensions: configuration?.dimensions ?? 0, endpointHash: hash(configuration?.baseUrl ?? 'none') },
    sources: sources.map(source => ({ artifactId: source.artifact.id, versionId: source.artifact.versionId!,
      filePath: source.relativePath, contentHash: sourceHash(source.artifact.contentHash) })),
  });
  // Native SQLite/parser libraries on Windows still encounter MAX_PATH with
  // nested owner/project/fingerprint UUID directories. One full digest retains
  // all isolation/compatibility inputs without that avoidable path expansion.
  const cacheIdentity = hash(`${ownerId}:${projectId}:${identity.fingerprint}`);
  return { client, configuration, sources, identity, directory: path.join(cacheRoot, cacheIdentity) };
}

/** Build the exact compatibility identity from latest artifact/version metadata
 * and saved settings. This performs no source-body reads and no provider calls. */
export async function describeRepositoryIndex(clientSource: ClientSource, ownerId: string, projectId: string, artifacts: Artifact[],
  signal?: AbortSignal, cacheRoot = CACHE_ROOT): Promise<RepositoryIndexIdentity> {
  return (await describe(clientSource, ownerId, projectId, artifacts, signal, cacheRoot)).identity;
}

async function prepare(clientSource: ClientSource, ownerId: string, projectId: string, artifacts: Artifact[], signal?: AbortSignal,
  reader?: FrozenReader, cacheRoot = CACHE_ROOT) {
  const description = await describe(clientSource, ownerId, projectId, artifacts, signal, cacheRoot);
  const sources: Source[] = [];
  for (const source of description.sources) {
    throwIfAborted(signal);
    const content = isPdfSource(source.artifact)
      ? (verifiedTextForReader(reader, source.artifact, signal)
        ?? await verifiedSourceText(source.artifact, await readClientArtifactBytes(description.client, ownerId, source.artifact, signal), signal)).text
      : reader ? await reader(source.artifact, signal)
      : await readClientArtifactContent(description.client, ownerId, source.artifact.id, source.artifact.versionId, signal, projectId, source.artifact.contentHash);
    if (!isPdfSource(source.artifact) && hash(content) !== sourceHash(source.artifact.contentHash)) throw new Error('Frozen source hash verification failed before local indexing.');
    sources.push({ ...source, content });
  }
  return { ...description, sources };
}

async function cachedStage(directory: string, identity: RepositoryIndexIdentity, sources: Source[], signal?: AbortSignal): Promise<string | null> {
  try {
    throwIfAborted(signal);
    const pointer: unknown = JSON.parse(await fs.readFile(path.join(directory, 'location.json'), 'utf8'));
    if (typeof pointer !== 'string' || !/^stage-[a-f\d-]{36}$/.test(pointer)) return null;
    const root = path.join(directory, pointer);
    const receipt: Receipt = JSON.parse(await fs.readFile(`${root}.receipt.json`, 'utf8'));
    if (JSON.stringify(receipt.identity) !== JSON.stringify(identity) || !Array.isArray(receipt.files) || !receipt.files.length) return null;
    // The fingerprint binds the frozen source manifest, but the owner-local
    // stage is mutable. Verify its materialized sources on every cache hit so
    // a stale workspace cannot feed line locations from an older native index.
    if (!await verifyMaterialized(root, sources, signal)) return null;
    const names = await portableIndexFiles(path.join(root, INDEX_RELATIVE_DIRECTORY));
    if (names.length !== receipt.files.length || names.some(name => !receipt.files.some(file => file.name === name))) return null;
    for (const file of receipt.files) {
      throwIfAborted(signal);
      if (hash(await fs.readFile(path.join(root, INDEX_RELATIVE_DIRECTORY, file.name))) !== file.sha256) return null;
    }
    return root;
  } catch { throwIfAborted(signal); return null; }
}

async function receipt(root: string, identity: RepositoryIndexIdentity): Promise<string[]> {
  const indexDirectory = path.join(root, INDEX_RELATIVE_DIRECTORY);
  const names = await portableIndexFiles(indexDirectory);
  const files = await Promise.all(names.map(async name => ({ name, sha256: hash(await fs.readFile(path.join(indexDirectory, name))) })));
  await fs.writeFile(`${root}.receipt.json`, JSON.stringify({ identity, files } satisfies Receipt), { mode: 0o600 });
  return names;
}

async function materialize(root: string, sources: Source[], signal?: AbortSignal) {
  for (const source of sources) {
    throwIfAborted(signal);
    const filename = path.join(root, source.relativePath);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, source.content, { flag: 'wx', mode: 0o600 });
  }
}

async function verifyMaterialized(root: string, sources: Source[], signal?: AbortSignal): Promise<boolean> {
  try {
    if ((await fs.lstat(root)).isSymbolicLink()) return false;
    const expected = new Map(sources.map(source => [source.relativePath, source]));
    let derivedEntries = 0; let derivedBytes = 0;
    const verifyDerivedTree = async (directory: string): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        throwIfAborted(signal);
        const filename = path.join(directory, entry.name); const stat = await fs.lstat(filename);
        if (++derivedEntries > 128 || stat.isSymbolicLink()) throw new Error('Unsafe pending index inventory.');
        if (stat.isDirectory()) await verifyDerivedTree(filename);
        else if (!stat.isFile() || (derivedBytes += stat.size) > 128 * 1024 * 1024) throw new Error('Unsafe pending index inventory.');
      }
    };
    const visit = async (directory: string, prefix: string): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        throwIfAborted(signal);
        const filename = path.join(directory, entry.name);
        const stat = await fs.lstat(filename);
        if (stat.isSymbolicLink()) throw new Error('A pending index contains a symbolic link.');
        if (!prefix && entry.name === '.codebase-index' && stat.isDirectory()) { await verifyDerivedTree(filename); continue; }
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (stat.isDirectory()) await visit(filename, relative);
        else {
          const source = expected.get(relative);
          if (!source || !stat.isFile() || hash(await fs.readFile(filename)) !== hash(source.content))
            throw new Error('A pending index source differs from the frozen manifest.');
          expected.delete(relative);
        }
      }
    };
    await visit(root, '');
    return expected.size === 0;
  } catch { throwIfAborted(signal); return false; }
}

/** Partial indexes stay owner-local and are never uploaded. A later explicit
 * Review can ask the public index_codebase tool to recover its saved failures.
 * Exact frozen bytes and the full owner/config identity must still match. */
async function pendingStage(prepared: Awaited<ReturnType<typeof prepare>>, signal?: AbortSignal): Promise<string | null> {
  let candidates: string[] = [];
  try {
    const pending = JSON.parse(await fs.readFile(path.join(prepared.directory, 'pending.json'), 'utf8'));
    if (JSON.stringify(pending.identity) === JSON.stringify(prepared.identity) && /^stage-[a-f\d-]{36}$/.test(pending.stage))
      candidates.push(pending.stage);
  } catch { /* Older interrupted builds did not write a pending pointer. */ }
  // Recover those older local stages only after verifying the complete source
  // tree. The containing digest binds owner/project/version/model identity.
  const entries = await fs.readdir(prepared.directory, { withFileTypes: true }).catch(() => []);
  candidates.push(...entries.filter(entry => entry.isDirectory() && /^stage-[a-f\d-]{36}$/.test(entry.name)).map(entry => entry.name));
  for (const candidate of new Set(candidates)) {
    const root = path.join(prepared.directory, candidate);
    if (await verifyMaterialized(root, prepared.sources, signal)) return root;
  }
  return null;
}

async function session(prepared: Awaited<ReturnType<typeof prepare>>, root: string, clientSource: ClientSource, ownerId: string, projectId: string,
  inputType: 'document' | 'query', signal?: AbortSignal, reviewId?: string, beforeProvider?: () => Promise<void>) {
  const bridge = prepared.configuration ? await openRepositoryEmbeddingBridge({ client: currentClient(clientSource), ownerId, projectId, reviewId,
    configuration: prepared.configuration, inputType, sources: prepared.sources, stagingRoot: root, signal,
    beforeProvider: async () => { assertSourceIndexProviderAllowed(projectId); await beforeProvider?.(); },
    indexTrigger: reviewId ? 'review' : 'source_changed',
    indexFingerprint: prepared.identity.fingerprint,
    saveUsage: input => new SupabaseCentinelStore(currentClient(clientSource)).saveModelUsage(input) }) : null;
  try {
    const engine = await openCodebaseIndex({ projectRoot: root, mode: prepared.configuration ? 'hybrid' : 'structural', signal,
      embedding: { model: prepared.configuration?.model ?? 'structural-only', dimensions: prepared.configuration?.dimensions ?? 1,
        baseUrl: bridge?.baseUrl ?? 'http://127.0.0.1:9/v1', token: bridge?.token ?? 'no-provider' } });
    return { engine, bridge, close: async () => { try { await engine.close(); } finally { await bridge?.close(); } } };
  } catch (cause) { await bridge?.close(); throw cause; }
}

/** Builds for a persisted source event or explicit Review. Ordinary reads only
 * recover already queued work; the shared index is source-derived data. */
export async function indexFrozenArtifacts(client: ClientSource, ownerId: string, projectId: string, artifacts: Artifact[], signal?: AbortSignal,
  reviewId?: string, frozenReader?: FrozenReader, cacheRoot = CACHE_ROOT, guard?: () => Promise<void>): Promise<void> {
  await guard?.();
  const prepared = await prepare(client, ownerId, projectId, artifacts, signal, frozenReader, cacheRoot);
  if (!prepared.sources.length) return;
  await locked(prepared.directory, async () => {
    throwIfAborted(signal);
    const existing = await cachedStage(prepared.directory, prepared.identity, prepared.sources, signal);
    if (existing) {
      const indexDirectory = path.join(existing, INDEX_RELATIVE_DIRECTORY);
      const names = await portableIndexFiles(indexDirectory);
      const archive = await encodeRepositorySnapshot(indexDirectory, prepared.identity, names, signal);
      await guard?.();
      await publishRepositoryIndex(currentClient(client), ownerId, prepared.identity, archive, { signal });
      return;
    }
    // Startup sync only places validated bytes in this owner-specific prepared
    // area. Exact source identity and native status are still checked here.
    const shared = await readPreparedRepositorySnapshot(ownerId, prepared.identity, cacheRoot, signal)
      ?? await downloadRepositorySnapshot(currentClient(client), prepared.identity, signal);
    const pending = shared ? null : await pendingStage(prepared, signal);
    const root = pending ?? path.join(prepared.directory, `stage-${crypto.randomUUID()}`);
    if (!pending) {
      await fs.mkdir(root, { recursive: true });
      await materialize(root, prepared.sources, signal);
    }
    await fs.writeFile(path.join(prepared.directory, 'pending.json'), JSON.stringify({ identity: prepared.identity, stage: path.basename(root) }), { mode: 0o600 });
    let restored = false;
    if (shared) {
      // The pinned engine supplies the complete portable inventory; restore
      // validates every entry before native code can open the database.
      await restoreRepositorySnapshot(shared, path.join(root, INDEX_RELATIVE_DIRECTORY), prepared.identity, undefined, signal);
      restored = true;
    }
    const opened = await session(prepared, root, client, ownerId, projectId, 'document', signal, reviewId, guard);
    try {
      const result = restored ? await opened.engine.status() : await opened.engine.index();
      if (opened.bridge?.failure()) throw opened.bridge.failure();
      if (!result.ready) throw new Error('The local repository index did not finish successfully.');
    } catch (cause) { if (opened.bridge?.failure()) throw opened.bridge.failure(); throw cause; }
    finally { await opened.close(); }
    const names = await receipt(root, prepared.identity);
    const archive = restored ? shared : await encodeRepositorySnapshot(path.join(root, INDEX_RELATIVE_DIRECTORY), prepared.identity, names, signal);
    await guard?.();
    if (archive) await publishRepositoryIndex(currentClient(client), ownerId, prepared.identity, archive, { upload: !restored, signal });
    throwIfAborted(signal);
    await fs.writeFile(path.join(prepared.directory, 'location.json'), JSON.stringify(path.basename(root)), { mode: 0o600 });
  });
}

/** Local relevance search only. Every returned range is reconstructed from the
 * frozen reader, never trusted as code supplied by a shared index or model. */
export async function retrieveFrozenContext(client: ClientSource, ownerId: string, projectId: string, artifacts: Artifact[], maxTokens: number,
  signal?: AbortSignal, reviewId?: string, queryText?: string, frozenReader?: FrozenReader, cacheRoot = CACHE_ROOT): Promise<RetrievedContext> {
  const prepared = await prepare(client, ownerId, projectId, artifacts, signal, frozenReader, cacheRoot);
  const empty: RetrievedContext = { files: [], totalSymbols: 0, estimatedTokens: 0, reason: 'Local repository search was unavailable; frozen source sweeps remain required.' };
  if (!prepared.sources.length) return empty;
  return locked(prepared.directory, async () => {
    const root = await cachedStage(prepared.directory, prepared.identity, prepared.sources, signal);
    if (!root) return { ...empty, retrievalPartialReason: 'A compatible local index is missing. Build it through an explicit Review.' };
    const opened = await session(prepared, root, client, ownerId, projectId, 'query', signal, reviewId);
    const selectedChunks: NonNullable<RetrievedContext['selectedChunks']> = [];
    let partial = false;
    try {
      const status = await opened.engine.status();
      if (!status.ready) return { ...empty, retrievalPartialReason: 'The local index is not ready or compatible.' };
      const result = await opened.engine.context((queryText?.trim() || 'repository behavior and security boundaries').slice(0, 8_000), Math.min(4_000, Math.max(600, maxTokens || 600)));
      if (opened.bridge?.failure()) throw opened.bridge.failure();
      const hits = [...result.hits];
      // The ready tool's direct graph is supplemental context, never the
      // canonical four-domain coverage map or proof of runtime reachability.
      for (const hit of result.hits.filter(item => item.symbol).slice(0, 3)) {
        for (const direction of ['callers', 'callees'] as const) {
          const graph = await opened.engine.graph(hit.symbol!, direction, hit.filePath);
          hits.push(...graph.hits.slice(0, 10));
        }
      }
      let size = 0;
      const seen = new Set<string>();
      for (const hit of hits.slice(0, 72)) {
        const key = `${hit.filePath}:${hit.lineStart}:${hit.lineEnd}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const source = prepared.sources.find(item => item.relativePath === hit.filePath.replace(/\\/g, '/'));
        if (!source || !Number.isSafeInteger(hit.lineStart) || !Number.isSafeInteger(hit.lineEnd) || hit.lineStart < 1 || hit.lineEnd < hit.lineStart) { partial = true; continue; }
        const lines = source.content.split('\n');
        if (hit.lineEnd > lines.length) { partial = true; continue; }
        // Native ranges are navigation hints. Reconstruct every identity from
        // frozen bytes; packet selection requires a slice hash and UTF-16
        // offsets, not the whole artifact hash. A terminal empty line has no
        // character to cite, so end at the final represented source line.
        let lineEnd = hit.lineEnd;
        while (lineEnd >= hit.lineStart && lines[lineEnd - 1] === '') lineEnd--;
        if (lineEnd < hit.lineStart) { partial = true; continue; }
        const content = lines.slice(hit.lineStart - 1, lineEnd).join('\n');
        const startOffset = lines.slice(0, hit.lineStart - 1).reduce((offset, line) => offset + line.length + 1, 0);
        const endOffset = startOffset + content.length;
        if (size + content.length > 16_000) { partial = true; continue; }
        size += content.length;
        selectedChunks.push({ artifactId: source.artifact.id, artifactVersionId: source.artifact.versionId!, filePath: source.artifact.filePath,
          contentHash: hash(content), ordinal: selectedChunks.length, content, lineStart: hit.lineStart, lineEnd,
          startOffset, endOffset,
          symbol: hit.symbol, retrievalScore: hit.score, retrievalMode: prepared.configuration ? 'hybrid' : 'lexical' });
      }
    } catch (cause) { if (opened.bridge?.failure()) throw opened.bridge.failure(); throw cause; }
    finally { await opened.close(); }
    await receipt(root, prepared.identity);
    const selectedIds = new Set(selectedChunks.map(chunk => chunk.artifactId));
    return { files: prepared.sources.filter(source => selectedIds.has(source.artifact.id)).map(source => ({ id: source.artifact.id, projectId,
      filePath: source.artifact.filePath, parentPath: path.posix.dirname(source.artifact.filePath), fileType: source.artifact.type,
      language: path.extname(source.artifact.fileName).slice(1), fileSize: source.content.length, symbolCount: 0, indexedAt: '', module: '' })),
      selectedChunks, totalSymbols: 0, estimatedTokens: Math.ceil(selectedChunks.reduce((sum, chunk) => sum + chunk.content.length, 0) / 4),
      reason: 'open-codebase-index selected exact frozen-source ranges locally. Static graph and retrieval remain bounded relevance aids.',
      ...(partial ? { retrievalPartialReason: 'Some retrieved ranges exceeded the exact-source or context bounds.' } : {}) };
  });
}
