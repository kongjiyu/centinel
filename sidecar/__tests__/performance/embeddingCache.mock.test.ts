import crypto from 'node:crypto';
import { createEmbeddingBatch } from '../../src/review/embeddingProvider.js';
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
vi.mock('../../src/review/repositoryEmbeddingBridge.js', () => ({ openRepositoryEmbeddingBridge: async () => ({ baseUrl: 'http://mock.invalid', token: 'mock-only', failure: () => null, close: async () => undefined }) }));
import { indexFrozenArtifacts } from '../../src/review/localRepositoryIndex.js';
import { embeddingAdmissionEstimate, waitForEmbeddingBudget } from '../../src/review/embeddingRateLimit.js';

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


// Synthetic timings exercise real cache/identity/archive/file-validation and embedding-response code.
// Native MCP engine, provider transport, bridge, membership and Storage are mocked. No Review runs.
describe('embedding/index cache mock performance', () => {
  it('measures cold/warm/shared/changed-manifest paths on 301 synthetic files without external calls', async () => {
    const configuration = { apiKey: 'mock-only', baseUrl: 'https://api.voyageai.com/v1', model: 'voyage-4-lite', embeddingProvider: 'voyage' as const, dimensions: 1024 };
    mocks.resolve.mockResolvedValue(configuration);
    const external = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw Error('External network forbidden in mock benchmark'); });
    const rows: Array<Record<string, number | string>> = [];
    let currentContent = new Map<string, string>();
    let calls = 0, vectors = 0;
    const send: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
      calls++; vectors += inputs.length;
      await new Promise(resolve => setTimeout(resolve, 20)); // Fixed mock latency, not a provider measurement.
      return new Response(JSON.stringify({ model: configuration.model,
        data: inputs.map((_, index) => ({ index, embedding: Array(1024).fill(0.25) })), usage: { total_tokens: inputs.length * 10 } }), { status: 200 });
    };
    mocks.open.mockImplementation(async ({ projectRoot }: { projectRoot: string }) => ({
      index: async () => {
        mocks.index();
        const inputs = [...currentContent.values()];
        for (let i = 0; i < inputs.length; i += 64) {
          const batch = await createEmbeddingBatch(configuration, inputs.slice(i, i + 64), 'document', undefined, send);
          expect(batch.embeddings).toHaveLength(Math.min(64, inputs.length - i));
        }
        const directory = path.join(projectRoot, '.codebase-index/index');
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, 'codebase.db'), Buffer.alloc(1024 * 1024, 0x25));
        return { ready: true, detail: 'synthetic engine' };
      },
      status: async () => ({ ready: true, detail: 'synthetic engine' }),
      close: async () => undefined,
    }));
    try {
      for (let round = 1; round <= 3; round++) {
        const storage = client(); const cache = await temp(); const sharedCache = await temp();
        const bodies = Array.from({ length: 301 }, (_, i) => `export function operation${i}() {\n${'  // synthetic source only\n'.repeat(30)}  return ${i};\n}\n`);
        const sources: Artifact[] = bodies.map((body, i) => ({ ...artifact, id: `artifact-${i}`, versionId: `v1-${i}`, fileName: `file${i}.ts`, filePath: `src/group${i % 10}/file${i}.ts`, contentHash: crypto.createHash('sha256').update(body).digest('hex') }));
        currentContent = new Map(sources.map((a, i) => [a.id, bodies[i]!]));
        let reads = 0;
        const reader = async (a: Artifact) => { reads++; return currentContent.get(a.id)!; };
        const measure = async (scenario: string, run: () => Promise<void>) => {
          const before = { calls, vectors, reads, builds: mocks.index.mock.calls.length, uploads: storage.upload.mock.calls.length, downloads: storage.download.mock.calls.length };
          const start = performance.now(); await run();
          const row = { round, scenario, durationMs: +(performance.now() - start).toFixed(2), embeddingCalls: calls - before.calls,
            vectors: vectors - before.vectors, sourceReads: reads - before.reads, nativeBuilds: mocks.index.mock.calls.length - before.builds,
            uploads: storage.upload.mock.calls.length - before.uploads, downloads: storage.download.mock.calls.length - before.downloads };
          rows.push(row); return row;
        };
        const cold = await measure('cold', () => indexFrozenArtifacts(storage.client, owner, project, sources, undefined, undefined, reader, cache));
        const warm = await measure('warm', () => indexFrozenArtifacts(storage.client, owner, project, sources, undefined, undefined, reader, cache));
        const shared = await measure('shared-member-restore', () => indexFrozenArtifacts(storage.client, secondOwner, project, sources, undefined, undefined, reader, sharedCache));
        const changedBody = currentContent.get(sources[0]!.id)! + '// changed version\n';
        currentContent.set(sources[0]!.id, changedBody);
        const changed = sources.map((a, i) => i ? a : { ...a, versionId: 'v2-0', contentHash: crypto.createHash('sha256').update(changedBody).digest('hex') });
        const stale = await measure('changed-source', () => indexFrozenArtifacts(storage.client, owner, project, changed, undefined, undefined, reader, cache));
        expect(cold).toMatchObject({ embeddingCalls: 5, vectors: 301, nativeBuilds: 1 });
        expect(warm).toMatchObject({ embeddingCalls: 0, vectors: 0, nativeBuilds: 0 });
        expect(shared).toMatchObject({ embeddingCalls: 0, vectors: 0, nativeBuilds: 0, downloads: 1 });
        expect(stale).toMatchObject({ embeddingCalls: 5, vectors: 301, nativeBuilds: 1 });
      }
      expect(external).not.toHaveBeenCalled();
      let virtualNow = 0;
      const admissionWaits: number[] = [];
      const admissionKey = `mock-performance-${crypto.randomUUID()}`;
      const inputs = [...currentContent.values()];
      const limits = { requestsPerMinute: 3, tokensPerMinute: 200000 };
      for (let i = 0; i < inputs.length; i += 64) await waitForEmbeddingBudget(admissionKey,
        embeddingAdmissionEstimate(inputs.slice(i, i + 64)), undefined, { limits, now: () => virtualNow,
          sleep: async delay => { admissionWaits.push(delay); virtualNow += delay; } });
      expect(limits).toEqual({ requestsPerMinute: 3, tokensPerMinute: 200000 });
      expect(admissionWaits).toEqual([60100]);
      const report = { scope: 'Embedding and index-cache mock benchmark only; no Review assessment', fixture: { files: 301, vectorDimensions: 1024, batchSize: 64, mockLatencyMsPerCall: 20, rounds: 3, mockIndexBytes: 1048576 },
        admissionSimulation: { ...limits, requests: 5, virtualWaitMs: virtualNow, waitsMs: admissionWaits },
        limitations: ['Synthetic source and mocked native engine/Storage/transport; not live Voyage/Supabase/MCP performance.', 'Every frozen source is read and hashed on a warm hit.', 'Changed complete identities may re-embed all chunks; incremental billing savings are not established.'], rows };
      const output = path.resolve('../evidence/embedding-cache-mock-performance.json');
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ report: 'evidence/embedding-cache-mock-performance.json', rows }));
    } finally { external.mockRestore(); }
  }, 60_000);
});
