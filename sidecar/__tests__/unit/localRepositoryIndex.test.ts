import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artifact } from '../../src/artifacts.js';

const mocks = vi.hoisted(() => ({ member: vi.fn(), resolve: vi.fn(), index: vi.fn(), open: vi.fn() }));
vi.mock('../../src/applicationRepository.js', () => ({ CentinelApplicationRepository: class { requireProjectMember = mocks.member; } }));
vi.mock('../../src/modelSettings.js', () => ({ resolveSavedEmbeddingConfiguration: mocks.resolve }));
vi.mock('../../src/review/openCodebaseIndex.js', () => ({
  INDEX_RELATIVE_DIRECTORY: '.codebase-index/index',
  openCodebaseIndex: mocks.open,
  portableIndexFiles: async (directory: string) => (await fs.readdir(directory)).sort(),
}));
import { describeRepositoryIndex, indexFrozenArtifacts, retrieveFrozenContext } from '../../src/review/localRepositoryIndex.js';
import { syncPublishedRepositoryIndex } from '../../src/review/repositoryIndexSync.js';
import { selectEvidencePackets } from '../../src/review/evidencePacketSelection.js';
import { registerVerifiedSourceTexts, verifiedSourceText } from '../../src/review/sourceText.js';

const owner = '11111111-1111-4111-8111-111111111111';
const secondOwner = '22222222-2222-4222-8222-222222222222';
const project = '33333333-3333-4333-8333-333333333333';
const content = 'export function pay() {\n  return true;\n}\n';
const artifact: Artifact = { id: 'frozen-artifact', projectId: project, versionId: 'version', contentHash: crypto.createHash('sha256').update(content).digest('hex'),
  filePath: 'src/pay.ts', fileName: 'pay.ts', originalPath: null, source: 'repository', type: 'source_code', createdAt: '2026-10-26' };
const roots: string[] = [];
async function temp() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'centinel-local-index-')); roots.push(directory); return directory; }
function client() {
  const objects = new Map<string, Buffer>();
  const events = new Map<string, Record<string, unknown>>();
  const upload = vi.fn(async (name: string, bytes: Buffer) => { objects.set(name, Buffer.from(bytes)); return { error: null }; });
  const download = vi.fn(async (name: string) => objects.has(name) ? { data: new Blob([objects.get(name)!]), error: null }
    : { data: null, error: { statusCode: '404' } });
  const client = {
    storage: { from: () => ({ upload, download }) },
    rpc: async () => ({ data: 1, error: null }),
    from: () => ({
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
        if (events.has(String(row.id))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        events.set(String(row.id), row);
        return { data: row, error: null };
      },
    }),
  } as unknown as SupabaseClient;
  return { client, objects, upload, download };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.member.mockResolvedValue(undefined); mocks.resolve.mockResolvedValue(null);
  mocks.open.mockImplementation(async ({ projectRoot }: { projectRoot: string }) => ({
    index: async () => {
      mocks.index();
      const directory = path.join(projectRoot, '.codebase-index/index');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'codebase.db'), 'closed fixture database');
      return { ready: true, detail: 'fixture' };
    },
    status: async () => ({ ready: true, detail: 'fixture' }),
    graph: async () => ({ hits: [], detail: 'fixture' }),
    context: async () => ({ hits: [{ filePath: 'src/pay.ts', lineStart: 1, lineEnd: 3, content: 'UNTRUSTED_SHARED_TEXT' },
      { filePath: '../outside.ts', lineStart: 1, lineEnd: 2 }], detail: 'fixture' }),
    close: async () => undefined,
  }));
});
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

describe('frozen local repository index integration', () => {
  it('stages an issued frozen PDF extraction without downloading the original again', async () => {
    const bytes = await new Promise<Buffer>(resolve => {
      const pdf = new PDFDocument(); const chunks: Buffer[] = [];
      pdf.on('data', chunk => chunks.push(chunk)); pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.text('Verified PDF handoff'); pdf.end();
    });
    const pdf: Artifact = { ...artifact, id: 'pdf', fileName: 'report.pdf', filePath: 'report.pdf',
      contentHash: crypto.createHash('sha256').update(bytes).digest('hex'), type: 'requirement' };
    const result = await verifiedSourceText(pdf, bytes);
    const reader = vi.fn(async () => result.text);
    registerVerifiedSourceTexts(reader, [{ artifact: pdf, result }]);
    const storage = client(); const cache = await temp();
    // The mocked repository deliberately has no byte-download method. A
    // duplicate original read would fail rather than make this test pass.
    await indexFrozenArtifacts(storage.client, owner, project, [pdf], undefined, 'pdf-review', reader, cache);
    expect(mocks.index).toHaveBeenCalledOnce();
    const root = mocks.open.mock.calls[0]![0].projectRoot;
    const staged = (await fs.readdir(root, { recursive: true })).find(name => name.endsWith('.pdfjs-6.4.299-text-v1.txt'));
    expect(staged).toBeDefined();
    expect(await fs.readFile(path.join(root, staged!), 'utf8')).toBe(result.text);
  });
  it('does not publish a completed build when its source-event guard is superseded', async () => {
    const storage = client(); const cache = await temp(); let calls = 0;
    const guard = async () => { if (++calls >= 2) throw new Error('source superseded'); };
    await expect(indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, undefined, async () => content, cache, guard))
      .rejects.toThrow('source superseded');
    expect(mocks.index).toHaveBeenCalledOnce(); expect(storage.upload).not.toHaveBeenCalled();
  });
  it('rejects a partial native index containing a nested symlink before reopening it', async () => {
    const storage = client(); const cache = await temp(); const external = await temp();
    const open = mocks.open.getMockImplementation()!; let first = true;
    mocks.open.mockImplementation(async (options: { projectRoot: string }) => {
      const engine = await open(options);
      return { ...engine, index: async () => { const result = await engine.index();
        if (first) { first = false; return { ready: false, detail: 'interrupted fixture' }; } return result;
      } };
    });
    await expect(indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, 'failed', async () => content, cache)).rejects.toThrow();
    const original = mocks.open.mock.calls[0]![0].projectRoot;
    await fs.writeFile(path.join(external, 'marker.txt'), 'untouched');
    await fs.symlink(external, path.join(original, '.codebase-index/index/escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, 'manual-retry', async () => content, cache);
    expect(mocks.open.mock.calls[1]![0].projectRoot).not.toBe(original);
    expect(await fs.readFile(path.join(external, 'marker.txt'), 'utf8')).toBe('untouched');
  });

  it('resumes only an exact owner-local partial stage on a later explicit Review', async () => {
    const storage = client(); const cache = await temp();
    const open = mocks.open.getMockImplementation()!;
    let first = true;
    mocks.open.mockImplementation(async (options: { projectRoot: string }) => {
      const engine = await open(options);
      return { ...engine, index: async () => {
        const result = await engine.index();
        if (first) { first = false; return { ready: false, detail: 'interrupted fixture' }; }
        return result;
      } };
    });
    await expect(indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, 'failed', async () => content, cache)).rejects.toThrow(/did not finish/);
    expect(storage.upload).not.toHaveBeenCalled();
    const original = mocks.open.mock.calls[0]![0].projectRoot;
    await indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, 'manual-retry', async () => content, cache);
    expect(mocks.open.mock.calls[1]![0].projectRoot).toBe(original);
    expect(storage.upload).toHaveBeenCalledOnce();
  });

  it('does not resume a partial stage whose frozen source bytes were modified', async () => {
    const storage = client(); const cache = await temp();
    const open = mocks.open.getMockImplementation()!;
    let first = true;
    mocks.open.mockImplementation(async (options: { projectRoot: string }) => {
      const engine = await open(options);
      return { ...engine, index: async () => { const result = await engine.index();
        if (first) { first = false; return { ready: false, detail: 'interrupted fixture' }; } return result;
      } };
    });
    await expect(indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, 'failed', async () => content, cache)).rejects.toThrow();
    const original = mocks.open.mock.calls[0]![0].projectRoot;
    await fs.writeFile(path.join(original, 'src/pay.ts'), 'changed');
    await indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, 'manual-retry', async () => content, cache);
    expect(mocks.open.mock.calls[1]![0].projectRoot).not.toBe(original);
  });

  it('uses the refreshed bearer client for snapshot upload after a long local build', async () => {
    const initial = client(); const refreshed = client(); const cache = await temp();
    let active = initial.client;
    const open = mocks.open.getMockImplementation()!;
    mocks.open.mockImplementation(async (options: { projectRoot: string }) => {
      const engine = await open(options);
      return { ...engine, index: async () => { const result = await engine.index(); active = refreshed.client; return result; } };
    });
    await indexFrozenArtifacts(() => active, owner, project, [artifact], undefined, 'review', async () => content, cache);
    expect(initial.download).toHaveBeenCalledOnce(); expect(initial.upload).not.toHaveBeenCalled();
    expect(refreshed.upload).toHaveBeenCalledOnce();
  });

  it('builds and backs up once, reuses warm data, and reconstructs results from exact frozen sources', async () => {
    const storage = client(); const cache = await temp(); const reader = vi.fn(async () => content);
    await indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, 'review', reader, cache);
    await indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, 'review-two', reader, cache);
    expect(mocks.index).toHaveBeenCalledOnce(); expect(storage.upload).toHaveBeenCalledOnce();
    const staged = mocks.open.mock.calls[0]![0].projectRoot as string;
    const components = path.relative(cache, staged).split(path.sep);
    expect(components).toHaveLength(2);
    expect(components[0]).toMatch(/^[a-f\d]{64}$/);
    expect(components[1]).toMatch(/^stage-[a-f\d-]{36}$/);
    const context = await retrieveFrozenContext(storage.client, owner, project, [artifact], 1000, undefined, 'review', 'payment', reader, cache);
    expect(context.selectedChunks).toEqual([expect.objectContaining({ artifactId: artifact.id, artifactVersionId: 'version', content: content.trimEnd(), lineStart: 1, lineEnd: 3 })]);
    expect(context.retrievalPartialReason).toBeTruthy();
    expect(JSON.stringify(context)).not.toContain('UNTRUSTED_SHARED_TEXT');
    expect(mocks.member).toHaveBeenCalledTimes(5);
  });

  it('rejects a warm local index when its staged source no longer matches the frozen hash', async () => {
    const storage = client(); const cache = await temp(); const reader = vi.fn(async () => content);
    await indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, 'first-review', reader, cache);
    const original = mocks.open.mock.calls[0]![0].projectRoot as string;
    await fs.writeFile(path.join(original, 'src/pay.ts'), 'export function pay() { return false; }\n');

    const stale = await retrieveFrozenContext(storage.client, owner, project, [artifact], 1000, undefined, 'review', 'payment', reader, cache);
    expect(stale.selectedChunks).toBeUndefined();
    expect(stale.retrievalPartialReason).toContain('compatible local index is missing');
    expect(mocks.open).toHaveBeenCalledOnce();

    // Rebuild flow may recover the immutable exact-identity shared snapshot,
    // but it must materialize the frozen source into a new local stage first.
    await indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, 'repair-review', reader, cache);
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(mocks.open.mock.calls[1]![0].projectRoot).not.toBe(original);
    expect(await fs.readFile(path.join(mocks.open.mock.calls[1]![0].projectRoot, 'src/pay.ts'), 'utf8')).toBe(content);
    expect(mocks.index).toHaveBeenCalledOnce();
  });

  it('pulls a compatible shared snapshot into a fresh member cache without another index build', async () => {
    const storage = client(); const first = await temp(); const second = await temp();
    await indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, 'first-review', async () => content, first);
    await indexFrozenArtifacts(storage.client, secondOwner, project, [artifact], undefined, 'second-review', async () => content, second);
    expect(mocks.index).toHaveBeenCalledOnce();
    expect(storage.upload).toHaveBeenCalledOnce(); expect(storage.download).toHaveBeenCalledTimes(2);
    expect(mocks.member).toHaveBeenCalledTimes(4);
    expect(mocks.open.mock.calls[0]![0].projectRoot).not.toBe(mocks.open.mock.calls[1]![0].projectRoot);
    const context = await retrieveFrozenContext(storage.client, secondOwner, project, [artifact], 1000, undefined, 'second-review', 'payment', async () => content, second);
    expect(context.selectedChunks?.[0]?.content).toBe(content.trimEnd());
  });

  it('consumes an explicitly prefetched archive only after native status validates the restored index', async () => {
    const storage = client(); const first = await temp(); const second = await temp();
    await indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, 'first-review', async () => content, first);
    const identity = await describeRepositoryIndex(storage.client, secondOwner, project, [artifact], undefined, second);
    expect(await syncPublishedRepositoryIndex(storage.client, secondOwner, project, identity, second)).toMatchObject({ state: 'prefetched' });

    await indexFrozenArtifacts(storage.client, secondOwner, project, [artifact], undefined, 'second-review', async () => content, second);
    expect(mocks.index).toHaveBeenCalledOnce();
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(storage.upload).toHaveBeenCalledOnce();
    // One lookup during the cold build and one authenticated startup prefetch.
    // Consuming the verified local archive does not download or embed again.
    expect(storage.download).toHaveBeenCalledTimes(2);
  });

  it.each(['\n', '\r\n'])('delivers native retrieval to the exact packet selector with Unicode and %j endings', async ending => {
    const storage = client(); const cache = await temp();
    const frozen = ['// Unicode prefix: 😀', 'export function pay() {', '  return "🧾";', '}', '', ''].join(ending);
    const version = { ...artifact, contentHash: crypto.createHash('sha256').update(frozen).digest('hex') };
    const originalOpen = mocks.open.getMockImplementation()!;
    mocks.open.mockImplementation(async (options: { projectRoot: string }) => ({ ...await originalOpen(options),
      context: async () => ({ hits: [{ filePath: version.filePath, lineStart: 2, lineEnd: 6, content: 'UNTRUSTED' }], detail: 'fixture' }),
    }));
    await indexFrozenArtifacts(storage.client, owner, project, [version], undefined, 'r', async () => frozen, cache);
    const context = await retrieveFrozenContext(storage.client, owner, project, [version], 1000, undefined, 'r', 'payment', async () => frozen, cache);
    const chunk = context.selectedChunks![0]!;
    expect(chunk.startOffset).toBe(frozen.indexOf('export function'));
    expect(frozen.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.content);
    expect(chunk.contentHash).toBe(crypto.createHash('sha256').update(chunk.content).digest('hex'));
    expect(chunk.contentHash).not.toBe(version.contentHash);
    const evidence = [{ artifact: version, content: frozen }];
    const selection = selectEvidencePackets(evidence, [], context);
    expect(selection.retrievedUnitCount).toBe(1);
    expect(selection.byArtifactId.get(version.id)?.diagnostics.addedRetrievedUnitCount).toBe(1);
    for (const changed of [{ artifactVersionId: 'stale' }, { contentHash: version.contentHash }, { startOffset: chunk.startOffset! + 1 }]) {
      const rejected = selectEvidencePackets(evidence, [], { ...context, selectedChunks: [{ ...chunk, ...changed }] });
      expect(rejected.retrievedUnitCount).toBe(0);
    }
  });

  it('denies access before saved model/source/cache use and rejects changed frozen bytes before indexing', async () => {
    const storage = client(); const cache = await temp(); const reader = vi.fn(async () => content);
    mocks.member.mockRejectedValueOnce(new Error('Membership denied.'));
    await expect(indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, 'review', reader, cache)).rejects.toThrow(/Membership denied/);
    expect(mocks.resolve).not.toHaveBeenCalled(); expect(reader).not.toHaveBeenCalled(); expect(storage.download).not.toHaveBeenCalled();
    await expect(indexFrozenArtifacts(storage.client, owner, project, [artifact], undefined, 'review', async () => 'changed bytes', cache)).rejects.toThrow(/hash verification/);
    expect(mocks.open).not.toHaveBeenCalled(); expect(storage.upload).not.toHaveBeenCalled();
  });
});
