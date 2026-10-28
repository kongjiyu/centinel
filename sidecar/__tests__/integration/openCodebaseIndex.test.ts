import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { INDEX_RELATIVE_DIRECTORY, OPEN_CODEBASE_INDEX_GRAPH_FORMAT, openCodebaseIndex, portableIndexFiles } from '../../src/review/openCodebaseIndex.js';
import { openRepositoryEmbeddingBridge } from '../../src/review/repositoryEmbeddingBridge.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artifact } from '../../src/artifacts.js';

const tempRoots: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    if (server.listening) {
      server.close();
      await once(server, 'close');
    }
  }
  for (const root of tempRoots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function makeTempDirectory(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

describe('open-codebase-index public MCP adapter', () => {
  it('recovers saved failures only during an explicit second index call', async () => {
    const projectRoot = await makeTempDirectory('centinel-native-resume-');
    await fs.mkdir(path.join(projectRoot, 'src'));
    for (let index = 0; index < 100; index++) await fs.writeFile(path.join(projectRoot, 'src', `calculation${index}.ts`),
      `export function calculate${index}(value: number) { return value + ${index}; }`);
    const initialSucceeded = new Set<string>(); const recoveredInputs: string[] = [];
    let calls = 0;
    const run = async (recover: boolean) => {
      const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project',
        configuration: { apiKey: 'FAKE_KEY', baseUrl: 'https://api.voyageai.com/v1', model: 'voyage-4-lite', dimensions: 1024, embeddingProvider: 'voyage' },
        inputType: 'document', sources: [], stagingRoot: projectRoot, saveUsage: async () => undefined,
        admit: async () => ({ reconcile: () => undefined }),
        embed: async (_config, inputs) => {
          if (!recover && ++calls === 2) throw Error('injected local fake provider failure');
          for (const input of inputs) { const digest = crypto.createHash('sha256').update(input).digest('hex');
            if (recover) recoveredInputs.push(digest); else initialSucceeded.add(digest); }
          return { embeddings: inputs.map(() => Array(1024).fill(0.5)), model: 'voyage-4-lite', inputTokens: 5, providerReportedTotalTokens: 5 };
        } });
      const session = await openCodebaseIndex({ projectRoot, mode: 'hybrid', embedding: {
        baseUrl: bridge.baseUrl, token: bridge.token, model: 'voyage-4-lite', dimensions: 1024 } });
      try { return await session.index(); } finally { await session.close(); await bridge.close(); }
    };
    expect((await run(false)).ready).toBe(false);
    expect(calls).toBe(2);
    expect(initialSucceeded.size).toBeGreaterThan(0);
    const recovered = await run(true);
    expect(recovered.ready, recovered.detail).toBe(true);
    expect(recoveredInputs.length).toBeGreaterThan(0);
    // Upstream can resend successful chunks while reconciling failed files.
    // Recovery proves correctness, not zero additional embedding tokens.
    expect(recoveredInputs.every(input => /^[a-f\d]{64}$/.test(input))).toBe(true);
  });

  it('attributes real upstream embedding headers to frozen files through the bridge', async () => {
    const projectRoot = await makeTempDirectory('centinel-native-attribution-');
    await fs.mkdir(path.join(projectRoot, 'src'));
    const content = 'export function paymentIdentifier(value: string) { return value.trim(); }';
    await fs.writeFile(path.join(projectRoot, 'src', 'payment.ts'), content);
    const artifact = { id: 'artifact', versionId: 'version', projectId: 'project', filePath: 'src/payment.ts',
      contentHash: crypto.createHash('sha256').update(content).digest('hex') } as Artifact;
    const records: Array<{ metadata?: Record<string, unknown> | null }> = [];
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project',
      configuration: { apiKey: 'FAKE_KEY', baseUrl: 'https://api.voyageai.com/v1', model: 'voyage-4-lite', dimensions: 1024, embeddingProvider: 'voyage' },
      inputType: 'document', stagingRoot: projectRoot, sources: [{ relativePath: 'src/payment.ts', artifact }],
      admit: async () => ({ reconcile: () => undefined }), saveUsage: async input => { records.push(input); },
      embed: async (_config, inputs) => ({ embeddings: inputs.map(() => Array(1024).fill(0.5)), model: 'voyage-4-lite', inputTokens: 5, providerReportedTotalTokens: 5 }) });
    const session = await openCodebaseIndex({ projectRoot, mode: 'hybrid', embedding: {
      baseUrl: bridge.baseUrl, token: bridge.token, model: 'voyage-4-lite', dimensions: 1024 } });
    try {
      const result = await session.index();
      expect(result.ready, result.detail).toBe(true);
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) expect(record.metadata?.usageContext).toMatchObject({ sourcesComplete: true,
        sources: [expect.objectContaining({ artifactId: 'artifact', artifactVersionId: 'version' })] });
    } finally { await session.close(); await bridge.close(); }
  });

  it('indexes and retrieves a frozen fixture through a loopback-only fake embedding provider', async () => {
    const projectRoot = await makeTempDirectory('centinel-ocbi-project-');
    await fs.mkdir(path.join(projectRoot, 'src'));
    await fs.writeFile(path.join(projectRoot, 'src', 'multiply.ts'), [
      'export function multiplyNumbers(left: number, right: number): number {',
      '  return left * right;',
      '}',
      '',
      'export function calculateProduct(): number {',
      '  return multiplyNumbers(6, 7);',
      '}',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(projectRoot, 'README.md'), '# Fixture\nThe project contains a multiplication helper.\n');

    const providerToken = crypto.randomBytes(24).toString('hex');
    const providerCalls: Array<{ model: unknown; inputCount: number; task: string }> = [];
    const server = http.createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      if (request.headers.authorization !== `Bearer ${providerToken}`) {
        response.writeHead(401).end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const task = /^\/v1\/(document|query)\/embeddings$/.exec(request.url ?? '')?.[1];
      if (request.method !== 'POST' || !task) {
        response.writeHead(404).end(JSON.stringify({ error: 'unexpected route' }));
        return;
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: unknown; input?: unknown };
      const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
      providerCalls.push({ model: payload.model, inputCount: inputs.length, task });
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        model: payload.model,
        data: inputs.map((_, index) => {
          const embedding = new Array<number>(1024).fill(0);
          embedding[index % embedding.length] = 1;
          return { index, embedding };
        }),
        usage: { total_tokens: inputs.length * 5 },
      }));
    });
    server.listen(0, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The fake embedding server did not bind an IP port.');

    const session = await openCodebaseIndex({
      projectRoot,
      embedding: {
        model: 'voyage-4-lite-test',
        dimensions: 1024,
        baseUrl: `http://127.0.0.1:${address.port}/v1/document`,
        token: providerToken,
      },
      mode: 'hybrid',
    });
    try {
      const indexed = await session.index();
      expect(indexed.ready, indexed.detail).toBe(true);
      expect(indexed.detail).not.toContain(projectRoot);

      const current = await session.status();
      expect(current.ready).toBe(true);
      expect(current.detail).toContain('voyage-4-lite-test');

    } finally {
      await session.close();
    }

    expect(providerCalls.length).toBeGreaterThan(0);
    expect(providerCalls.every(call => call.model === 'voyage-4-lite-test')).toBe(true);
    const indexDirectory = path.join(projectRoot, INDEX_RELATIVE_DIRECTORY);
    const files = await portableIndexFiles(indexDirectory);
    expect(files).toEqual(expect.arrayContaining([
      'codebase.db', 'codebase.db-wal', 'file-hashes.json', 'inverted-index.json', 'vectors', 'vectors.meta.json',
    ]));
    expect(files).toContain('codebase.db');
    expect(files).toContain('codebase.db-wal');
    expect(files).not.toContain('codebase.db-shm');
    expect(files.some(file => file.startsWith('mcp-runtime/'))).toBe(false);
    expect(files.some(file => /(?:lock|config|\.shm$|secret|token)/i.test(file))).toBe(false);

    const queryRoot = await makeTempDirectory('centinel-ocbi-restored-');
    await fs.mkdir(path.join(queryRoot, 'src'), { recursive: true });
    await fs.copyFile(path.join(projectRoot, 'src', 'multiply.ts'), path.join(queryRoot, 'src', 'multiply.ts'));
    await fs.copyFile(path.join(projectRoot, 'README.md'), path.join(queryRoot, 'README.md'));
    const restoredIndexDirectory = path.join(queryRoot, INDEX_RELATIVE_DIRECTORY);
    await fs.mkdir(restoredIndexDirectory, { recursive: true });
    for (const file of files) {
      const restoredFile = path.join(restoredIndexDirectory, ...file.split('/'));
      await fs.mkdir(path.dirname(restoredFile), { recursive: true });
      await fs.copyFile(path.join(indexDirectory, ...file.split('/')), restoredFile);
    }

    const querySession = await openCodebaseIndex({
      projectRoot: queryRoot,
      embedding: {
        model: 'voyage-4-lite-test',
        dimensions: 1024,
        baseUrl: `http://127.0.0.1:${address.port}/v1/query`,
        token: providerToken,
      },
      mode: 'hybrid',
    });
    try {
      const current = await querySession.status();
      expect(current.ready, current.detail).toBe(true);
      const result = await querySession.context('Where is the multiplication helper implemented?', 600);
      expect(result.hits.some(hit => hit.filePath === 'src/multiply.ts'), JSON.stringify(result)).toBe(true);
      expect(result.hits.every(hit => !path.isAbsolute(hit.filePath))).toBe(true);
      expect(result.detail).toContain('frozen manifest');
      const embeddingCallCount = providerCalls.length;
      const graph = await querySession.graph('multiplyNumbers', 'callers', 'src/multiply.ts');
      expect(graph.hits.some(hit => hit.filePath === 'src/multiply.ts' && hit.symbol === 'calculateProduct'), JSON.stringify(graph)).toBe(true);
      expect(graph.detail).toContain('open-codebase-index@0.38.1');
      expect(graph.detail).toContain(OPEN_CODEBASE_INDEX_GRAPH_FORMAT);
      expect(graph.detail).toContain('partial structural context');
      expect(providerCalls).toHaveLength(embeddingCallCount);
    } finally {
      await querySession.close();
    }
    expect(providerCalls.some(call => call.task === 'document')).toBe(true);
    expect(providerCalls.some(call => call.task === 'query')).toBe(true);
  }, 120_000);

  it('rejects a non-loopback provider endpoint before starting a child process', async () => {
    const projectRoot = await makeTempDirectory('centinel-ocbi-project-');
    await expect(openCodebaseIndex({
      projectRoot,
      embedding: { model: 'voyage-4-lite', dimensions: 1024, baseUrl: 'https://api.voyageai.com/v1', token: 'capability' },
      mode: 'hybrid',
    })).rejects.toThrow(/loopback/i);
  });
});
