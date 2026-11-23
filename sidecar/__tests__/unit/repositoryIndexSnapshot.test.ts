import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { encodeRepositorySnapshot, repositoryIndexIdentity, restoreRepositorySnapshot, uploadRepositorySnapshot } from '../../src/review/repositoryIndexSnapshot.js';
import type { SupabaseClient } from '@supabase/supabase-js';

const directories: string[] = [];
async function temp() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'centinel-snapshot-')); directories.push(directory); return directory; }
const identity = repositoryIndexIdentity({ projectId: '11111111-1111-4111-8111-111111111111',
  embedding: { provider: 'voyage', model: 'voyage-4-lite', dimensions: 1024, endpointHash: 'a'.repeat(64) },
  sources: [{ artifactId: 'artifact', versionId: 'version', filePath: 'lib/a.js', contentHash: 'b'.repeat(64) }] });
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });

describe('portable repository index snapshot', () => {
  it('restores exact closed index bytes into another empty cache directory', async () => {
    const original = await temp(); const restored = await temp();
    await fs.writeFile(path.join(original, 'index.db'), Buffer.from([0, 1, 2, 255]));
    const snapshot = await encodeRepositorySnapshot(original, identity, ['index.db']);
    await restoreRepositorySnapshot(snapshot, restored, identity, ['index.db']);
    expect(await fs.readFile(path.join(restored, 'index.db'))).toEqual(Buffer.from([0, 1, 2, 255]));
    await expect(restoreRepositorySnapshot(snapshot, restored, identity, ['index.db'])).rejects.toThrow(/empty directory/);
  });

  it('separates incompatible model/dimensions/source versions but not machine or owner credentials', () => {
    const { fingerprint: _fingerprint, engine: _engine, policy: _policy, ...input } = identity;
    expect(repositoryIndexIdentity(input).fingerprint).toBe(identity.fingerprint);
    expect(repositoryIndexIdentity({ ...input, embedding: { ...input.embedding, model: 'voyage-4' } }).fingerprint).not.toBe(identity.fingerprint);
    expect(repositoryIndexIdentity({ ...input, sources: [{ ...input.sources[0]!, versionId: 'different' }] }).fingerprint).not.toBe(identity.fingerprint);
  });

  it('rejects traversal, secret/config files, checksums and incompatible identities before writing', async () => {
    const target = await temp();
    const content = Buffer.from('index bytes');
    const file = { name: 'index.db', sha256: crypto.createHash('sha256').update(content).digest('hex'), bytes: content.length, content: content.toString('base64') };
    for (const entry of [{ ...file, name: '../index.db' }, { ...file, name: 'config.json' }, { ...file, sha256: 'bad' }]) {
      await expect(restoreRepositorySnapshot(gzipSync(JSON.stringify({ schemaVersion: 1, identity, files: [entry] })), target, identity, ['index.db'])).rejects.toThrow();
      expect(await fs.readdir(target)).toEqual([]);
    }
    await expect(restoreRepositorySnapshot(gzipSync(JSON.stringify({ schemaVersion: 1, identity: { ...identity, fingerprint: 'c'.repeat(64) }, files: [file] })), target, identity, ['index.db'])).rejects.toThrow(/incompatible/);
    const original = await temp();
    await fs.writeFile(path.join(original, 'config.json'), 'PRIVATE_KEY');
    await expect(encodeRepositorySnapshot(original, identity, ['config.json'])).rejects.toThrow(/forbidden/);
  });

  it('refuses to restore through a symlinked index directory', async () => {
    const parent = await temp(); const outside = await temp(); const target = path.join(parent, 'index');
    await fs.symlink(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
    const source = await temp();
    await fs.writeFile(path.join(source, 'index.db'), 'closed index');
    const archive = await encodeRepositorySnapshot(source, identity, ['index.db']);

    await expect(restoreRepositorySnapshot(archive, target, identity)).rejects.toThrow(/real local directory/);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('uploads a large project index with its metadata in the body, not one oversized header', async () => {
    const many = repositoryIndexIdentity({ ...identity, sources: Array.from({ length: 600 }, (_, index) => ({
      artifactId: crypto.randomUUID(), versionId: 'v', filePath: `src/file-${index}.js`, contentHash: 'c'.repeat(64) })) });
    const directory = await temp();
    await fs.writeFile(path.join(directory, 'index.db'), Buffer.from([1, 2, 3]));
    const snapshot = await encodeRepositorySnapshot(directory, many, ['index.db']);
    const calls: Array<{ body: unknown; options: Record<string, unknown> }> = [];
    const client = { storage: { from: () => ({ upload: async (_path: string, body: unknown, options: Record<string, unknown>) => {
      calls.push({ body, options });
      return { data: {}, error: null };
    } }) } } as unknown as SupabaseClient;
    await expect(uploadRepositorySnapshot(client, many, snapshot)).resolves.toMatchObject({ uploaded: true, archiveBytes: snapshot.length });
    expect(calls).toHaveLength(1);
    // supabase-js sends a Blob as multipart with a metadata field; a Buffer would become an x-metadata header.
    expect(calls[0]!.body).toBeInstanceOf(Blob);
    expect(Buffer.from(await (calls[0]!.body as Blob).arrayBuffer())).toEqual(snapshot);
    expect((calls[0]!.body as Blob).type).toBe('application/gzip');
    expect((calls[0]!.options.metadata as { artifactIds: string[] }).artifactIds).toHaveLength(600);
  });
});
