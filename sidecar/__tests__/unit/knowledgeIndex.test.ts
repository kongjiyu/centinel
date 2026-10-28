import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artifact } from '../../src/artifacts.js';
import { EMBEDDING_DIMENSIONS } from '../../src/review/embeddingProvider.js';
import { chunkFrozenSource, SOURCE_CHUNK_POLICY, type SourceChunk } from '../../src/review/sourceChunks.js';

const seams = vi.hoisted(() => ({
  requireProjectMember: vi.fn(),
  readContent: vi.fn(),
  resolveProvider: vi.fn(),
  createEmbedding: vi.fn(),
  saveModelUsage: vi.fn(),
  saveEmbeddingChunk: vi.fn(),
}));

vi.mock('../../src/applicationRepository.js', () => ({
  CentinelApplicationRepository: class {
    requireProjectMember = seams.requireProjectMember;
  },
}));
vi.mock('../../src/applicationApi.js', () => ({ readClientArtifactContent: seams.readContent }));
vi.mock('../../src/modelSettings.js', () => ({ resolveSavedEmbeddingProvider: seams.resolveProvider }));
vi.mock('../../src/review/embeddingProvider.js', () => ({
  createEmbedding: seams.createEmbedding,
  EMBEDDING_DIMENSIONS: 1536,
  EmbeddingProviderError: class extends Error {
    constructor(message: string, readonly code: string) { super(message); }
  },
}));
vi.mock('../../src/store/supabase.js', () => ({
  SupabaseCentinelStore: class {
    saveModelUsage = seams.saveModelUsage;
    saveEmbeddingChunk = seams.saveEmbeddingChunk;
  },
}));

import { indexFrozenArtifacts, retrieveFrozenContext } from '../../src/review/knowledgeIndex.js';
import { EmbeddingProviderError } from '../../src/review/embeddingProvider.js';

const DEFAULT_CONTENT = 'export const answer = 42;';
const EMBEDDING_CONFIG = { apiKey: 'secret', baseUrl: 'https://model.test/v1', model: 'embed-1536' };
const USER_ID = 'user-1';
const PROJECT_ID = 'project-1';

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function embeddingConfigKey(configuration = EMBEDDING_CONFIG): string {
  const endpoint = new URL(configuration.baseUrl);
  endpoint.username = '';
  endpoint.password = '';
  endpoint.search = '';
  endpoint.hash = '';
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '');
  return sha256(JSON.stringify({
    provider: 'custom', apiFormat: 'openai-compatible', endpoint: endpoint.toString(), model: configuration.model,
    dimensions: EMBEDDING_DIMENSIONS, policy: SOURCE_CHUNK_POLICY,
  }));
}

function makeArtifact(content = DEFAULT_CONTENT, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-1', projectId: PROJECT_ID, versionId: 'version-1',
    filePath: 'src/app.ts', fileName: 'app.ts', type: 'source_code', source: 'repository',
    originalPath: null, contentHash: sha256(content), createdAt: '2026-09-23T00:00:00Z',
    ...overrides,
  } as Artifact;
}

function toIndexRow(
  chunk: SourceChunk,
  artifact = makeArtifact(),
  options: {
    ownerId?: string;
    config?: typeof EMBEDDING_CONFIG | null;
    actualModel?: string | null;
    status?: string;
    metadata?: Record<string, unknown>;
    embeddingModelColumn?: string | null;
    ordinal?: number;
    content?: string;
    startOffset?: number;
  } = {},
): Record<string, unknown> {
  const content = options.content ?? chunk.content;
  const startOffset = options.startOffset ?? chunk.startOffset;
  const endOffset = startOffset + content.length;
  const logicalOrdinal = chunk.ordinal;
  const indexOrdinal = options.ordinal ?? 2_000_000 + logicalOrdinal;
  const actualChunkContentHash = sha256(content);
  const config = options.config === undefined ? EMBEDDING_CONFIG : options.config;
  const actualModel = options.actualModel === undefined ? (config ? config.model : null) : options.actualModel;
  const metadata = {
    artifactId: artifact.id,
    filePath: artifact.filePath,
    sourceHash: artifact.contentHash,
    actualChunkContentHash,
    startOffset,
    endOffset,
    lineStart: chunk.lineStart,
    lineEnd: chunk.lineEnd,
    kind: chunk.kind,
    symbol: chunk.symbol ?? null,
    isFragment: chunk.isFragment,
    fragmentIndex: chunk.fragmentIndex ?? null,
    fragmentCount: chunk.fragmentCount ?? null,
    chunkPolicy: SOURCE_CHUNK_POLICY,
    logicalOrdinal,
    indexOrdinal,
    indexOwnerId: options.ownerId ?? USER_ID,
    embeddingConfigKey: config ? embeddingConfigKey(config) : null,
    embeddingRequestedModel: config?.model ?? null,
    embeddingModel: options.status === 'available' || options.status === undefined ? actualModel : null,
    embeddingPolicy: SOURCE_CHUNK_POLICY,
    embeddingDimensions: config ? EMBEDDING_DIMENSIONS : null,
    ...(actualModel ? { embeddingOwnerId: options.ownerId ?? USER_ID } : {}),
    embeddingStatus: options.status ?? (config ? 'available' : 'not_configured'),
    ...options.metadata,
  };
  return {
    id: `chunk-${logicalOrdinal}`,
    project_id: artifact.projectId,
    artifact_version_id: artifact.versionId,
    ordinal: indexOrdinal,
    content,
    content_hash: sha256(JSON.stringify([SOURCE_CHUNK_POLICY, startOffset, actualChunkContentHash])),
    embedding_model: options.embeddingModelColumn === undefined ? actualModel : options.embeddingModelColumn,
    metadata,
  };
}

function sourceRows(artifact: Artifact, source: string, options?: Parameters<typeof toIndexRow>[2]): Array<Record<string, unknown>> {
  const chunks = chunkFrozenSource({ id: artifact.id, filePath: artifact.filePath, type: artifact.type }, source);
  return chunks.map(chunk => toIndexRow(chunk, artifact, options));
}

function makeClient(options: {
  indexRows?: Array<Record<string, unknown>>;
  realVectorRows?: Array<Record<string, unknown>>;
  retrievalRows?: Array<Record<string, unknown>>;
  semanticRows?: Array<Record<string, unknown>> | null;
  semanticError?: { message: string } | null;
} = {}) {
  const indexRows = options.indexRows ?? [];
  const realVectorRows = options.realVectorRows ?? [];
  const retrievalRows = options.retrievalRows ?? [];
  const from = vi.fn((_table: string) => {
    let columns = '';
    let start = 0;
    let end = 499;
    let vectorFilter = false;
    const query = {
      select: (value: string) => { columns = value; return query; },
      eq: () => query,
      in: () => query,
      order: () => query,
      not: () => { vectorFilter = true; return query; },
      range: (fromIndex: number, toIndex: number) => { start = fromIndex; end = toIndex; return query; },
      abortSignal: () => query,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        let rows: Array<Record<string, unknown>>;
        if (columns === 'ordinal,content_hash,embedding_model,metadata') rows = indexRows;
        else if (columns === 'ordinal,content_hash') rows = vectorFilter ? realVectorRows : indexRows;
        else rows = retrievalRows;
        if (columns === 'id') rows = rows.map(row => ({ id: row.id }));
        return Promise.resolve(resolve({ data: rows.slice(start, end + 1), error: null })).catch(reject);
      },
    };
    return query;
  });
  const rpc = vi.fn(() => {
    const query = {
      abortSignal: () => query,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        const result = options.semanticError
          ? { data: null, error: options.semanticError }
          : options.semanticRows === null || options.semanticRows === undefined
            ? { data: null, error: { message: 'function unavailable' } }
            : { data: options.semanticRows, error: null };
        return Promise.resolve(resolve(result)).catch(reject);
      },
    };
    return query;
  });
  return { from, rpc } as unknown as SupabaseClient & { from: typeof from; rpc: typeof rpc };
}

function oneChunkRow(artifact: Artifact | undefined = undefined, content = DEFAULT_CONTENT, options?: Parameters<typeof toIndexRow>[2]) {
  const selectedArtifact = artifact ?? makeArtifact(content);
  const chunk = chunkFrozenSource({ id: selectedArtifact.id, filePath: selectedArtifact.filePath, type: selectedArtifact.type }, content)[0]!;
  return toIndexRow(chunk, selectedArtifact, options);
}

function semanticRow(row: Record<string, unknown>, distance = 0.1, metadata = row.metadata) {
  return {
    artifact_version_id: row.artifact_version_id,
    ordinal: row.ordinal,
    content: row.content,
    metadata,
    distance,
  };
}

describe('frozen source indexing', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.clearAllMocks();
    seams.requireProjectMember.mockResolvedValue(undefined);
    seams.readContent.mockResolvedValue(DEFAULT_CONTENT);
    seams.resolveProvider.mockResolvedValue(null);
    seams.saveModelUsage.mockResolvedValue({});
    seams.saveEmbeddingChunk.mockResolvedValue({});
  });

  it.each(['rate_limited', 'quota_exhausted', 'credits_exhausted'])('propagates %s before further source indexing or retrieval fallback', async code => {
    seams.resolveProvider.mockResolvedValue(EMBEDDING_CONFIG);
    seams.createEmbedding.mockRejectedValue(new EmbeddingProviderError('Paused provider', code));
    await expect(indexFrozenArtifacts(makeClient() as SupabaseClient, USER_ID, PROJECT_ID, [makeArtifact(), { ...makeArtifact(), id: 'artifact-2' }]))
      .rejects.toMatchObject({ code });
    expect(seams.createEmbedding).toHaveBeenCalledOnce();
    expect(seams.readContent).toHaveBeenCalledOnce();
    expect(seams.saveEmbeddingChunk).not.toHaveBeenCalled();
    expect(seams.saveModelUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure', errorCode: code }));

    await expect(retrieveFrozenContext(makeClient(), USER_ID, PROJECT_ID, [makeArtifact()], 1000, undefined, 'review-1', 'query'))
      .rejects.toMatchObject({ code });
    expect(seams.createEmbedding).toHaveBeenCalledTimes(2);
  });

  it('stores real provider vectors and attributable usage for a frozen version', async () => {
    seams.resolveProvider.mockResolvedValue(EMBEDDING_CONFIG);
    const vector = [1, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)];
    seams.createEmbedding.mockResolvedValue({ embedding: vector, model: 'embed-1536', inputTokens: 12 });
    const artifact = makeArtifact();

    await indexFrozenArtifacts(makeClient() as SupabaseClient, USER_ID, PROJECT_ID, [artifact], undefined, 'review-1');

    expect(seams.readContent).toHaveBeenCalledWith(expect.anything(), USER_ID, artifact.id, artifact.versionId, undefined, artifact.projectId, artifact.contentHash);
    expect(seams.saveEmbeddingChunk).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID, parentType: 'artifact_version', parentId: 'version-1', ordinal: 2_000_000,
      embedding: vector, embeddingModel: 'embed-1536', metadata: expect.objectContaining({
        embeddingStatus: 'available', embeddingRequestedModel: EMBEDDING_CONFIG.model,
      }),
    }), undefined);
    expect(seams.saveModelUsage).toHaveBeenCalledWith(expect.objectContaining({
      reviewSessionId: 'review-1', outcome: 'success', inputTokens: 12,
      metadata: expect.objectContaining({ scope: 'embedding', artifactVersionId: 'version-1' }),
    }));
  });

  it('keeps an honest lexical chunk when the provider is absent', async () => {
    await indexFrozenArtifacts(makeClient() as SupabaseClient, USER_ID, PROJECT_ID, [makeArtifact()]);

    expect(seams.createEmbedding).not.toHaveBeenCalled();
    expect(seams.saveEmbeddingChunk).toHaveBeenCalledWith(expect.objectContaining({
      embedding: null, embeddingModel: null, metadata: expect.objectContaining({ embeddingStatus: 'not_configured' }),
    }), undefined);
  });

  it('persists lexical evidence and one failed usage record when embedding fails', async () => {
    seams.resolveProvider.mockResolvedValue(EMBEDDING_CONFIG);
    seams.createEmbedding.mockRejectedValue(new Error('provider offline'));

    await indexFrozenArtifacts(makeClient() as SupabaseClient, USER_ID, PROJECT_ID, [makeArtifact()]);

    expect(seams.saveModelUsage).toHaveBeenCalledTimes(1);
    expect(seams.saveModelUsage).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failure', errorCode: 'indexing_provider_unavailable',
    }));
    expect(seams.saveEmbeddingChunk).toHaveBeenCalledWith(expect.objectContaining({
      embedding: null, metadata: expect.objectContaining({
        embeddingStatus: 'unavailable', embeddingErrorCode: 'indexing_provider_unavailable',
      }),
    }), undefined);
  });

  it('stops indexing during embedding-configuration lookup before reading or saving source evidence', async () => {
    const controller = new AbortController();
    seams.resolveProvider.mockImplementation((_client, _userId, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const pending = indexFrozenArtifacts(makeClient() as SupabaseClient, USER_ID, PROJECT_ID, [makeArtifact()], controller.signal);
    await vi.waitFor(() => expect(seams.resolveProvider).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'ReviewCancelledError' });
    expect(seams.requireProjectMember).toHaveBeenCalledWith(PROJECT_ID, controller.signal);
    expect(seams.readContent).not.toHaveBeenCalled();
    expect(seams.saveEmbeddingChunk).not.toHaveBeenCalled();
  });

  it('does not report indexing complete if cancellation arrives during the final chunk write', async () => {
    const controller = new AbortController();
    seams.saveEmbeddingChunk.mockImplementation(async () => {
      controller.abort();
      return {};
    });

    await expect(indexFrozenArtifacts(makeClient() as SupabaseClient, USER_ID, PROJECT_ID, [makeArtifact()], controller.signal))
      .rejects.toMatchObject({ name: 'ReviewCancelledError' });
    expect(seams.saveEmbeddingChunk).toHaveBeenCalledTimes(1);
  });

  it('reuses an exact persisted real vector without contacting the embedding provider', async () => {
    seams.resolveProvider.mockResolvedValue(EMBEDDING_CONFIG);
    const artifact = makeArtifact();
    const row = oneChunkRow(artifact, DEFAULT_CONTENT);

    await indexFrozenArtifacts(makeClient({ indexRows: [row], realVectorRows: [row] }) as SupabaseClient, USER_ID, PROJECT_ID, [artifact]);

    expect(seams.createEmbedding).not.toHaveBeenCalled();
    expect(seams.saveEmbeddingChunk).not.toHaveBeenCalled();
  });

  it('accepts a provider-reported model alias only when the vector column matches its metadata', async () => {
    seams.resolveProvider.mockResolvedValue(EMBEDDING_CONFIG);
    const artifact = makeArtifact();
    const row = oneChunkRow(artifact, DEFAULT_CONTENT, { actualModel: 'provider-model-alias' });

    await indexFrozenArtifacts(makeClient({ indexRows: [row], realVectorRows: [row] }) as SupabaseClient, USER_ID, PROJECT_ID, [artifact]);

    expect(seams.createEmbedding).not.toHaveBeenCalled();
    expect(seams.saveEmbeddingChunk).not.toHaveBeenCalled();
  });

  it.each([
    ['different owner', { metadata: { indexOwnerId: 'other-user', embeddingOwnerId: 'other-user' } }],
    ['different configuration', { metadata: { embeddingConfigKey: 'another-config' } }],
    ['different requested model', { metadata: { embeddingRequestedModel: 'another-model' } }],
    ['different dimensions', { metadata: { embeddingDimensions: 3 } }],
    ['different stored model', { embeddingModelColumn: 'another-model' }],
    ['missing real vector', {}],
  ] as const)('does not reuse a cache entry with %s', async (_description, rowOptions) => {
    seams.resolveProvider.mockResolvedValue(EMBEDDING_CONFIG);
    seams.createEmbedding.mockResolvedValue({ embedding: [1, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)], model: 'embed-1536', inputTokens: 1 });
    const artifact = makeArtifact();
    const row = oneChunkRow(artifact, DEFAULT_CONTENT, rowOptions as Parameters<typeof toIndexRow>[2]);
    const realVectorRows = _description === 'missing real vector' ? [] : [row];

    await indexFrozenArtifacts(makeClient({ indexRows: [row], realVectorRows }) as SupabaseClient, USER_ID, PROJECT_ID, [artifact]);

    expect(seams.createEmbedding).toHaveBeenCalledOnce();
    expect(seams.saveEmbeddingChunk).toHaveBeenCalledOnce();
  });

  it('fails closed on a conflicting reserved ordinal before provider access or mutation', async () => {
    seams.resolveProvider.mockResolvedValue(EMBEDDING_CONFIG);
    const artifact = makeArtifact();
    const old = oneChunkRow(artifact, 'different body occupying this slot', { ordinal: 2_000_000 });

    await indexFrozenArtifacts(makeClient({ indexRows: [old], realVectorRows: [old] }) as SupabaseClient, USER_ID, PROJECT_ID, [artifact]);

    expect(seams.createEmbedding).not.toHaveBeenCalled();
    expect(seams.saveEmbeddingChunk).not.toHaveBeenCalled();
  });

  it('writes current-policy chunks beside legacy ordinals without overwriting them', async () => {
    const artifact = makeArtifact();
    const legacy = {
      ordinal: 0,
      content_hash: sha256(DEFAULT_CONTENT),
      embedding_model: null,
      metadata: { legacy: true },
    };

    await indexFrozenArtifacts(makeClient({ indexRows: [legacy] }) as SupabaseClient, USER_ID, PROJECT_ID, [artifact]);

    expect(seams.saveEmbeddingChunk).toHaveBeenCalledWith(expect.objectContaining({
      ordinal: 2_000_000,
      contentHash: expect.not.stringMatching(legacy.content_hash),
      metadata: expect.objectContaining({ chunkPolicy: SOURCE_CHUNK_POLICY, logicalOrdinal: 0 }),
    }), undefined);
  });

  it('verifies the full frozen source hash before provider access or writes', async () => {
    seams.resolveProvider.mockResolvedValue(EMBEDDING_CONFIG);
    seams.readContent.mockResolvedValue('altered source body');

    await expect(indexFrozenArtifacts(makeClient() as SupabaseClient, USER_ID, PROJECT_ID, [makeArtifact()]))
      .rejects.toThrow('does not match the selected source version hash');

    expect(seams.createEmbedding).not.toHaveBeenCalled();
    expect(seams.saveEmbeddingChunk).not.toHaveBeenCalled();
  });

  it('keeps whitespace-only source chunks lexical and continues embedding later function chunks', async () => {
    const content = '    function first() { return 1; }        function second() { return 2; }';
    const firstStart = content.indexOf('function first');
    const secondStart = content.indexOf('function second');
    const firstEnd = secondStart - 8;
    const makeChunk = (ordinal: number, startOffset: number, endOffset: number, kind: SourceChunk['kind'], symbol?: string): SourceChunk => ({
      id: `chunk-${ordinal}`, artifactId: 'artifact-1', filePath: 'src/app.ts', type: 'source_code', ordinal,
      startOffset, endOffset, lineStart: 1, lineEnd: 1, kind, ...(symbol ? { symbol } : {}),
      isFragment: false, content: content.slice(startOffset, endOffset),
    });
    const chunks = [
      makeChunk(0, 0, firstStart, 'code'),
      makeChunk(1, firstStart, firstEnd, 'function', 'first'),
      makeChunk(2, firstEnd, secondStart, 'code'),
      makeChunk(3, secondStart, content.length, 'function', 'second'),
    ];
    const chunker = vi.spyOn(await import('../../src/review/sourceChunks.js'), 'chunkFrozenSource').mockReturnValue(chunks);
    const artifact = makeArtifact(content);
    seams.readContent.mockResolvedValue(content);
    seams.resolveProvider.mockResolvedValue(EMBEDDING_CONFIG);
    seams.createEmbedding.mockResolvedValue({ embedding: [1, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)], model: 'embed-1536', inputTokens: 1 });

    await indexFrozenArtifacts(makeClient() as SupabaseClient, USER_ID, PROJECT_ID, [artifact]);

    expect(seams.createEmbedding).toHaveBeenCalledTimes(2);
    expect(seams.createEmbedding).toHaveBeenNthCalledWith(1, EMBEDDING_CONFIG, chunks[1]!.content, undefined);
    expect(seams.createEmbedding).toHaveBeenNthCalledWith(2, EMBEDDING_CONFIG, chunks[3]!.content, undefined);
    expect(seams.saveEmbeddingChunk).toHaveBeenCalledTimes(4);
    expect(seams.saveEmbeddingChunk).toHaveBeenNthCalledWith(1, expect.objectContaining({
      content: '    ', embedding: null, metadata: expect.objectContaining({ embeddingStatus: 'empty' }),
    }), undefined);
    chunker.mockRestore();
  });

  describe('frozen context retrieval', () => {
    it('uses only provenance-matched similarity results from the selected frozen versions', async () => {
      seams.resolveProvider.mockResolvedValue(EMBEDDING_CONFIG);
      seams.createEmbedding.mockResolvedValue({ embedding: [1, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)], model: 'embed-1536', inputTokens: 5 });
      const artifact = makeArtifact('semantic-only frozen source');
      const row = oneChunkRow(artifact, 'semantic-only frozen source');
      const foreign = semanticRow({ ...row, artifact_version_id: 'foreign-version', ordinal: row.ordinal }, 0.01);
      const client = makeClient({ retrievalRows: [row], semanticRows: [foreign, semanticRow(row, 0.1)] });

      const result = await retrieveFrozenContext(client, USER_ID, PROJECT_ID, [artifact], 1000, undefined, 'review-1', 'requirement conflict');

      expect(client.rpc).toHaveBeenCalledWith('match_frozen_artifact_chunks', expect.objectContaining({
        p_project_id: PROJECT_ID, p_version_ids: ['version-1'], p_embedding_model: 'embed-1536', p_limit: 32,
      }));
      expect(result.selectedChunks).toEqual([expect.objectContaining({
        artifactVersionId: 'version-1', filePath: 'src/app.ts', ordinal: 0, content: 'semantic-only frozen source',
        retrievalMode: 'semantic',
      })]);
      expect(result.selectedChunks?.[0]?.retrievalScore).toBeCloseTo(1 / 62);
      expect(result.reason).toContain('semantic-ranked');
      expect(client.from).toHaveBeenCalled();
      expect(seams.saveModelUsage).toHaveBeenCalledWith(expect.objectContaining({
        reviewSessionId: 'review-1', stage: 'context_retrieval', outcome: 'success', inputTokens: 5,
      }));
    });

    it('falls back to a genuine lexical match when the similarity RPC is unavailable', async () => {
      seams.resolveProvider.mockResolvedValue(EMBEDDING_CONFIG);
      seams.createEmbedding.mockResolvedValue({ embedding: [1, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)], model: 'embed-1536', inputTokens: 5 });
      const artifact = makeArtifact('fallback evidence for policy conflict');
      const row = oneChunkRow(artifact, 'fallback evidence for policy conflict');

      const result = await retrieveFrozenContext(makeClient({ retrievalRows: [row] }), USER_ID, PROJECT_ID, [artifact], 1000, undefined, 'review-1', 'fallback evidence');

      expect(result.selectedChunks?.[0]).toEqual(expect.objectContaining({ content: 'fallback evidence for policy conflict', retrievalMode: 'lexical' }));
      expect(result.reason).toContain('similarity lookup is unavailable');
      expect(result.reason).toContain('lexical-ranked');
    });

    it('does not call an embedding provider when no indexing configuration exists', async () => {
      const artifact = makeArtifact('lexical evidence');
      const row = oneChunkRow(artifact, 'lexical evidence', { config: null, status: 'not_configured' });

      const result = await retrieveFrozenContext(makeClient({ retrievalRows: [row] }), USER_ID, PROJECT_ID, [artifact], 1000, undefined, 'review-1', 'lexical evidence');

      expect(seams.createEmbedding).not.toHaveBeenCalled();
      expect(result.selectedChunks?.[0]).toEqual(expect.objectContaining({ content: 'lexical evidence', retrievalMode: 'lexical' }));
    });

    it.each([
      ['another index owner', { metadata: { indexOwnerId: 'other-user' } }],
      ['another embedding configuration', { metadata: { embeddingConfigKey: 'another-config' } }],
      ['another policy', { metadata: { chunkPolicy: 'old-policy' } }],
      ['another artifact reference', { metadata: { artifactId: 'different-artifact' } }],
      ['another frozen source hash', { metadata: { sourceHash: 'different-source-hash' } }],
      ['another model dimension', { metadata: { embeddingDimensions: 3 } }],
      ['malformed embedding status', { metadata: { embeddingStatus: 'mystery' } }],
      ['an inconsistent body offset', { metadata: { startOffset: 1 } }],
    ] as const)('rejects retrieval candidates with %s provenance', async (_description, rowOptions) => {
      seams.resolveProvider.mockResolvedValue(EMBEDDING_CONFIG);
      seams.createEmbedding.mockResolvedValue({ embedding: [1, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)], model: 'embed-1536', inputTokens: 1 });
      const artifact = makeArtifact('relevant frozen source');
      const row = oneChunkRow(artifact, 'relevant frozen source', rowOptions as Parameters<typeof toIndexRow>[2]);

      const result = await retrieveFrozenContext(makeClient({ retrievalRows: [row], semanticRows: [] }), USER_ID, PROJECT_ID, [artifact], 1000, undefined, 'review-1', 'relevant frozen source');

      expect(result.selectedChunks).toBeUndefined();
      expect(result.reason).toContain('No current-policy chunks');
    });

    it('rejects semantic rows that disagree with scanned owner and configuration provenance', async () => {
      seams.resolveProvider.mockResolvedValue(EMBEDDING_CONFIG);
      seams.createEmbedding.mockResolvedValue({ embedding: [1, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)], model: 'embed-1536', inputTokens: 1 });
      const artifact = makeArtifact('relevant owner configuration evidence');
      const row = oneChunkRow(artifact, 'relevant owner configuration evidence');
      const badMetadata = { ...(row.metadata as Record<string, unknown>), embeddingOwnerId: 'other-user' };

      const result = await retrieveFrozenContext(makeClient({ retrievalRows: [row], semanticRows: [semanticRow(row, 0.01, badMetadata)] }), USER_ID, PROJECT_ID, [artifact], 1000, undefined, 'review-1', 'relevant owner configuration');

      expect(result.selectedChunks?.[0]).toEqual(expect.objectContaining({ content: 'relevant owner configuration evidence', retrievalMode: 'lexical' }));
    });

    it('uses BM25 lexical ranking so a relevant late-file chunk wins over an early irrelevant chunk', async () => {
      seams.resolveProvider.mockResolvedValue(null);
      const earlyContent = 'function healthCheck() {}';
      const lateContent = 'function parseUserConfig(input) { return input.user_config; }';
      const filler = ' '.repeat(5_000 - earlyContent.length);
      const source = `${earlyContent}${filler}${lateContent}`;
      const artifact = makeArtifact(source);
      const early = toIndexRow({
        id: 'early', artifactId: artifact.id, filePath: artifact.filePath, type: artifact.type, ordinal: 0,
        startOffset: 0, endOffset: earlyContent.length, lineStart: 1, lineEnd: 1, kind: 'function', symbol: 'unrelated',
        isFragment: false, content: earlyContent,
      }, artifact, { config: null, status: 'not_configured' });
      const lateStart = source.indexOf(lateContent);
      const lateChunk: SourceChunk = {
        id: 'late', artifactId: artifact.id, filePath: artifact.filePath, type: artifact.type, ordinal: 1,
        startOffset: lateStart, endOffset: lateStart + lateContent.length, lineStart: 1, lineEnd: 1, kind: 'function', symbol: 'parseUserConfig',
        isFragment: false, content: lateContent,
      };
      const late = toIndexRow(lateChunk, artifact, { config: null, status: 'not_configured' });

      const result = await retrieveFrozenContext(makeClient({ retrievalRows: [early, late] }), USER_ID, PROJECT_ID, [artifact], 1000, undefined, 'review-1', 'parseUserConfig user_config');

      expect(result.selectedChunks?.[0]).toEqual(expect.objectContaining({ content: lateChunk.content, ordinal: 1, retrievalMode: 'lexical' }));
    });

    it('does not label source-order chunks lexical-ranked when no query term matches', async () => {
      seams.resolveProvider.mockResolvedValue(null);
      const artifact = makeArtifact('export const healthy = true;');
      const row = oneChunkRow(artifact, 'export const healthy = true;', { config: null, status: 'not_configured' });

      const result = await retrieveFrozenContext(makeClient({ retrievalRows: [row] }), USER_ID, PROJECT_ID, [artifact], 1000, undefined, 'review-1', 'unique nonexistent query');

      expect(result.selectedChunks).toEqual([]);
      expect(result.reason).toContain('No lexical or compatible semantic matches');
    });

    it('bounds the durable scan and discloses when a late match falls beyond it', async () => {
      seams.resolveProvider.mockResolvedValue(null);
      const contents = Array.from({ length: 5_001 }, (_, index) => index === 5_000
        ? 'function lateMatch() { return UNIQUE_LATE_MATCH_TOKEN; }'
        : `const unrelatedValue${index} = ${index};`);
      const source = contents.join('\n');
      const artifact = makeArtifact(source);
      let startOffset = 0;
      const rows = contents.map((content, ordinal) => {
        const chunk: SourceChunk = {
          id: `chunk-${ordinal}`, artifactId: artifact.id, filePath: artifact.filePath, type: 'source_code', ordinal,
          startOffset, endOffset: startOffset + content.length, lineStart: ordinal + 1, lineEnd: ordinal + 1,
          kind: 'code', isFragment: false, content,
        };
        startOffset += content.length + 1;
        return toIndexRow(chunk, artifact, { config: null, status: 'not_configured' });
      });

      const result = await retrieveFrozenContext(makeClient({ retrievalRows: rows }), USER_ID, PROJECT_ID, [artifact], 1000, undefined, 'review-1', 'UNIQUE_LATE_MATCH_TOKEN');

      expect(result.selectedChunks).toEqual([]);
      expect(result.retrievalPartialReason).toContain('durable scan limit');
      expect(result.reason).toContain('some frozen chunks were not inspected');
    });

    it('reports a semantic candidate limit after the RPC returns its bounded page', async () => {
      seams.resolveProvider.mockResolvedValue(EMBEDDING_CONFIG);
      seams.createEmbedding.mockResolvedValue({ embedding: [1, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)], model: 'embed-1536', inputTokens: 1 });
      const artifact = makeArtifact('lexical evidence');
      const row = oneChunkRow(artifact, 'lexical evidence');
      const semanticRows = Array.from({ length: 32 }, (_, index) => semanticRow({
        ...row, artifact_version_id: `foreign-version-${index}`, ordinal: index,
      }));

      const result = await retrieveFrozenContext(makeClient({ retrievalRows: [row], semanticRows }), USER_ID, PROJECT_ID, [artifact], 1000, undefined, 'review-1', 'lexical evidence');

      expect(result.retrievalPartialReason).toContain('32-row limit');
      expect(result.reason).toContain('additional compatible matches may have been omitted');
      expect(result.selectedChunks?.[0]).toEqual(expect.objectContaining({ content: 'lexical evidence', retrievalMode: 'lexical' }));
    });

    it('stops context retrieval during embedding-configuration lookup before querying chunks', async () => {
      const controller = new AbortController();
      seams.resolveProvider.mockImplementation((_client, _userId, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }));
      const client = makeClient({ retrievalRows: [oneChunkRow()] });
      const pending = retrieveFrozenContext(client, USER_ID, PROJECT_ID, [makeArtifact()], 1000, controller.signal, 'review-1', 'query');
      await vi.waitFor(() => expect(seams.resolveProvider).toHaveBeenCalled());
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'ReviewCancelledError' });
      expect(seams.requireProjectMember).toHaveBeenCalledWith(PROJECT_ID, controller.signal);
      expect(client.from).not.toHaveBeenCalled();
      expect(client.rpc).not.toHaveBeenCalled();
    });
  });
});
