import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encodeRepositorySnapshot, repositoryIndexIdentity, type RepositoryIndexIdentity } from '../../src/review/repositoryIndexSnapshot.js';

const mocks = vi.hoisted(() => ({ member: vi.fn() }));
vi.mock('../../src/applicationRepository.js', () => ({
  CentinelApplicationRepository: class { requireProjectMember = mocks.member; },
}));
import { inspectPublishedRepositoryIndex, publishRepositoryIndex, readPreparedRepositorySnapshot, syncPublishedRepositoryIndex } from '../../src/review/repositoryIndexSync.js';

const owner = '11111111-1111-4111-8111-111111111111';
const otherOwner = '22222222-2222-4222-8222-222222222222';
const project = '33333333-3333-4333-8333-333333333333';
const roots: string[] = [];

function identity(versionId = 'version-one', contentHash = 'a'.repeat(64)): RepositoryIndexIdentity {
  return repositoryIndexIdentity({ projectId: project,
    embedding: { provider: 'none', model: 'structural-only', dimensions: 0, endpointHash: 'b'.repeat(64) },
    sources: [{ artifactId: 'artifact-one', versionId, filePath: 'src/app.ts', contentHash }],
  });
}

async function temp(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'centinel-index-sync-'));
  roots.push(directory);
  return directory;
}

function backend() {
  const objects = new Map<string, Buffer>();
  const events = new Map<string, Record<string, unknown>>();
  const upload = vi.fn(async (key: string, bytes: Buffer) => {
    if (objects.has(key)) return { data: null, error: { statusCode: '409', message: 'already exists' } };
    objects.set(key, Buffer.from(bytes));
    return { data: { path: key }, error: null };
  });
  const download = vi.fn(async (key: string) => {
    const bytes = objects.get(key);
    return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { statusCode: '404' } };
  });
  const client = {
    storage: { from: () => ({ upload, download }) },
    from: (table: string) => {
      if (table !== 'audit_events') throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => {
          const filters = new Map<string, unknown>();
          const query = {
            eq(column: string, value: unknown) { filters.set(column, value); return query; },
            abortSignal() { return query; },
            async maybeSingle() {
              const row = events.get(String(filters.get('id')));
              if (!row || [...filters].some(([key, value]) => row[key] !== value)) return { data: null, error: null };
              return { data: row, error: null };
            },
          };
          return query;
        },
        async insert(row: Record<string, unknown>) {
          const key = String(row.id);
          if (events.has(key)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          events.set(key, row);
          return { data: row, error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, objects, events, upload, download };
}

async function archiveFor(identityValue: RepositoryIndexIdentity): Promise<Buffer> {
  const source = await temp();
  await fs.writeFile(path.join(source, 'codebase.db'), `native index for ${identityValue.fingerprint}`);
  return encodeRepositorySnapshot(source, identityValue, ['codebase.db']);
}

beforeEach(() => { vi.clearAllMocks(); mocks.member.mockResolvedValue(undefined); });
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

describe('shared repository index sync', () => {
  it('publishes a completed immutable archive and exposes it to another project member', async () => {
    const backendState = backend();
    const cacheRoot = await temp();
    const current = identity();
    const archive = await archiveFor(current);
    await publishRepositoryIndex(backendState.client, owner, current, archive);

    expect(await inspectPublishedRepositoryIndex(backendState.client, otherOwner, project, current, cacheRoot)).toEqual({
      state: 'available', fingerprint: current.fingerprint, archiveSha256: expect.any(String),
    });
    expect(await syncPublishedRepositoryIndex(backendState.client, otherOwner, project, current, cacheRoot)).toMatchObject({
      state: 'prefetched', fingerprint: current.fingerprint,
    });
    expect(await readPreparedRepositorySnapshot(otherOwner, current, cacheRoot)).toEqual(archive);
    expect(await inspectPublishedRepositoryIndex(backendState.client, otherOwner, project, current, cacheRoot)).toMatchObject({ state: 'unchanged' });
    expect(backendState.download).toHaveBeenCalledOnce();
  });

  it('keeps prefetched archives separate by owner and project', async () => {
    const backendState = backend();
    const firstCache = await temp();
    const secondCache = await temp();
    const current = identity();
    const archive = await archiveFor(current);
    await publishRepositoryIndex(backendState.client, owner, current, archive);
    await syncPublishedRepositoryIndex(backendState.client, owner, project, current, firstCache);

    expect(await readPreparedRepositorySnapshot(otherOwner, current, firstCache)).toBeNull();
    expect(await readPreparedRepositorySnapshot(owner, current, secondCache)).toBeNull();
    await expect(syncPublishedRepositoryIndex(backendState.client, owner, '44444444-4444-4444-8444-444444444444', current, firstCache)).rejects.toThrow(/scope mismatch/);
  });

  it('does not install a downloaded object whose published hash changed', async () => {
    const backendState = backend();
    const cacheRoot = await temp();
    const current = identity();
    const archive = await archiveFor(current);
    await publishRepositoryIndex(backendState.client, owner, current, archive);
    const archivePath = [...backendState.objects.keys()][0]!;
    backendState.objects.set(archivePath, Buffer.from('tampered object'));

    expect(await syncPublishedRepositoryIndex(backendState.client, owner, project, current, cacheRoot)).toMatchObject({
      state: 'incompatible', fingerprint: current.fingerprint,
    });
    expect(await readPreparedRepositorySnapshot(owner, current, cacheRoot)).toBeNull();
  });

  it('keeps version-specific pointers when older and newer source identities prefetch in either order', async () => {
    const backendState = backend();
    const cacheRoot = await temp();
    const older = identity('version-one', 'a'.repeat(64));
    const newer = identity('version-two', 'c'.repeat(64));
    await publishRepositoryIndex(backendState.client, owner, older, await archiveFor(older));
    await publishRepositoryIndex(backendState.client, owner, newer, await archiveFor(newer));

    await syncPublishedRepositoryIndex(backendState.client, owner, project, newer, cacheRoot);
    await syncPublishedRepositoryIndex(backendState.client, owner, project, older, cacheRoot);
    expect(await readPreparedRepositorySnapshot(owner, newer, cacheRoot)).not.toBeNull();
    expect(await readPreparedRepositorySnapshot(owner, older, cacheRoot)).not.toBeNull();
    expect(await inspectPublishedRepositoryIndex(backendState.client, owner, project, newer, cacheRoot)).toMatchObject({ state: 'unchanged' });
    expect(await inspectPublishedRepositoryIndex(backendState.client, owner, project, older, cacheRoot)).toMatchObject({ state: 'unchanged' });
  });

  it('does not rewrite the deterministic archive or publication for a conflicting candidate', async () => {
    const backendState = backend();
    const current = identity();
    const originalPublication = await publishRepositoryIndex(backendState.client, owner, current, await archiveFor(current));
    const original = backendState.events.values().next().value;
    const originalArchive = Buffer.from(backendState.objects.values().next().value!);
    const differentArchive = await archiveFor(current);
    // The same identity can have independently compressed equivalent content;
    // produce a valid but distinct archive by changing only the native bytes.
    const folder = await temp();
    await fs.writeFile(path.join(folder, 'codebase.db'), crypto.randomBytes(24));
    const conflicting = await encodeRepositorySnapshot(folder, current, ['codebase.db']);
    expect(conflicting).not.toEqual(differentArchive);
    expect(await publishRepositoryIndex(backendState.client, owner, current, conflicting)).toEqual(originalPublication);
    expect(backendState.events.values().next().value).toEqual(original);
    expect(backendState.objects.values().next().value).toEqual(originalArchive);
    expect(backendState.upload).toHaveBeenCalledOnce();
  });
});
