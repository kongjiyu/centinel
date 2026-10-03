import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artifact } from '../../src/artifacts.js';

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

const artifact = {
  id: 'artifact-1', projectId: 'project-1', versionId: 'version-1',
  filePath: 'src/app.ts', fileName: 'app.ts', type: 'source_code', source: 'repository',
  originalPath: null, contentHash: 'source-hash', createdAt: '2026-09-23T00:00:00Z',
} as Artifact;

describe('frozen source indexing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seams.requireProjectMember.mockResolvedValue(undefined);
    seams.readContent.mockResolvedValue('export const answer = 42;');
    seams.saveModelUsage.mockResolvedValue({});
    seams.saveEmbeddingChunk.mockResolvedValue({});
  });

  it('stores real provider vectors and attributable usage for a frozen version', async () => {
    seams.resolveProvider.mockResolvedValue({ apiKey: 'secret', baseUrl: 'https://model.test/v1', model: 'embed-1536' });
    const vector = [1, ...Array(1535).fill(0)];
    seams.createEmbedding.mockResolvedValue({ embedding: vector, model: 'embed-1536', inputTokens: 12 });

    await indexFrozenArtifacts({} as SupabaseClient, 'user-1', 'project-1', [artifact], undefined, 'review-1');

    expect(seams.readContent).toHaveBeenCalledWith(expect.anything(), 'user-1', 'artifact-1', 'version-1', undefined);
    expect(seams.saveEmbeddingChunk).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', parentType: 'artifact_version', parentId: 'version-1',
      embedding: vector, embeddingModel: 'embed-1536', metadata: expect.objectContaining({ embeddingStatus: 'available' }),
    }), undefined);
    expect(seams.saveModelUsage).toHaveBeenCalledWith(expect.objectContaining({
      reviewSessionId: 'review-1', outcome: 'success', inputTokens: 12,
      metadata: expect.objectContaining({ scope: 'embedding', artifactVersionId: 'version-1' }),
    }));
  });

  it('keeps an honest lexical chunk when the provider is absent', async () => {
    seams.resolveProvider.mockResolvedValue(null);

    await indexFrozenArtifacts({} as SupabaseClient, 'user-1', 'project-1', [artifact]);

    expect(seams.createEmbedding).not.toHaveBeenCalled();
    expect(seams.saveEmbeddingChunk).toHaveBeenCalledWith(expect.objectContaining({
      embedding: null, embeddingModel: null, metadata: expect.objectContaining({ embeddingStatus: 'not_configured' }),
    }), undefined);
  });

  it('persists lexical evidence and one failed usage record when embedding fails', async () => {
    seams.resolveProvider.mockResolvedValue({ apiKey: 'secret', baseUrl: 'https://model.test/v1', model: 'embed-1536' });
    seams.createEmbedding.mockRejectedValue(new Error('provider offline'));

    await indexFrozenArtifacts({} as SupabaseClient, 'user-1', 'project-1', [artifact]);

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
    const pending = indexFrozenArtifacts({} as SupabaseClient, 'user-1', 'project-1', [artifact], controller.signal);
    await vi.waitFor(() => expect(seams.resolveProvider).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'ReviewCancelledError' });
    expect(seams.requireProjectMember).toHaveBeenCalledWith('project-1', controller.signal);
    expect(seams.readContent).not.toHaveBeenCalled();
    expect(seams.saveEmbeddingChunk).not.toHaveBeenCalled();
  });

  it('does not report indexing complete if cancellation arrives during the final chunk write', async () => {
    const controller = new AbortController();
    seams.resolveProvider.mockResolvedValue(null);
    seams.saveEmbeddingChunk.mockImplementation(async () => {
      controller.abort();
      return {};
    });

    await expect(indexFrozenArtifacts({} as SupabaseClient, 'user-1', 'project-1', [artifact], controller.signal))
      .rejects.toMatchObject({ name: 'ReviewCancelledError' });
    expect(seams.saveEmbeddingChunk).toHaveBeenCalledTimes(1);
  });

  function retrievalClient(lexicalRows: Array<Record<string, unknown>>, semanticRows: Array<Record<string, unknown>> | null = null) {
    const query = {
      select: () => query, eq: () => query, in: () => query, order: () => query,
      limit: () => query, abortSignal: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: lexicalRows, error: null })),
    };
    const semanticQuery = {
      abortSignal: () => semanticQuery,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(semanticRows === null
        ? { data: null, error: { message: 'function unavailable' } }
        : { data: semanticRows, error: null })),
    };
    return {
      from: vi.fn(() => query),
      rpc: vi.fn(() => semanticQuery),
    } as unknown as SupabaseClient & { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> };
  }

  it('uses only similarity-ranked rows from the Review frozen versions', async () => {
    seams.resolveProvider.mockResolvedValue({ apiKey: 'secret', baseUrl: 'https://model.test/v1', model: 'embed-1536' });
    seams.createEmbedding.mockResolvedValue({ embedding: [1, ...Array(1535).fill(0)], model: 'embed-1536', inputTokens: 5 });
    const client = retrievalClient([], [
      { artifact_version_id: 'foreign-version', ordinal: 0, content: 'foreign' },
      { artifact_version_id: 'version-1', ordinal: 2, content: 'relevant frozen source' },
    ]);

    const result = await retrieveFrozenContext(client, 'user-1', 'project-1', [artifact], 1000, undefined, 'review-1', 'requirement conflict');

    expect(client.rpc).toHaveBeenCalledWith('match_frozen_artifact_chunks', expect.objectContaining({
      p_project_id: 'project-1', p_version_ids: ['version-1'], p_embedding_model: 'embed-1536',
    }));
    expect(result.selectedChunks).toEqual([{
      artifactVersionId: 'version-1', filePath: 'src/app.ts', ordinal: 2, content: 'relevant frozen source',
    }]);
    expect(result.reason).toContain('similarity-ranked');
    expect(client.from).not.toHaveBeenCalled();
    expect(seams.saveModelUsage).toHaveBeenCalledWith(expect.objectContaining({
      reviewSessionId: 'review-1', stage: 'context_retrieval', outcome: 'success', inputTokens: 5,
    }));
  });

  it('falls back to ordered durable chunks when the similarity RPC is unavailable', async () => {
    seams.resolveProvider.mockResolvedValue({ apiKey: 'secret', baseUrl: 'https://model.test/v1', model: 'embed-1536' });
    seams.createEmbedding.mockResolvedValue({ embedding: [1, ...Array(1535).fill(0)], model: 'embed-1536', inputTokens: 5 });
    const client = retrievalClient([{ artifact_version_id: 'version-1', ordinal: 0, content: 'fallback evidence' }]);

    const result = await retrieveFrozenContext(client, 'user-1', 'project-1', [artifact], 1000, undefined, 'review-1', 'requirement conflict');

    expect(result.selectedChunks?.[0].content).toBe('fallback evidence');
    expect(result.reason).toContain('ordered');
    expect(result.reason).toContain('similarity lookup is unavailable');
  });

  it('does not call an embedding provider when no indexing configuration exists', async () => {
    seams.resolveProvider.mockResolvedValue(null);
    const client = retrievalClient([{ artifact_version_id: 'version-1', ordinal: 0, content: 'lexical evidence' }]);

    const result = await retrieveFrozenContext(client, 'user-1', 'project-1', [artifact], 1000, undefined, 'review-1', 'code review');

    expect(seams.createEmbedding).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
    expect(result.selectedChunks?.[0].content).toBe('lexical evidence');
  });

  it('stops context retrieval during embedding-configuration lookup before querying chunks', async () => {
    const controller = new AbortController();
    seams.resolveProvider.mockImplementation((_client, _userId, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const client = retrievalClient([{ artifact_version_id: 'version-1', ordinal: 0, content: 'evidence' }]);
    const pending = retrieveFrozenContext(client, 'user-1', 'project-1', [artifact], 1000, controller.signal, 'review-1', 'query');
    await vi.waitFor(() => expect(seams.resolveProvider).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'ReviewCancelledError' });
    expect(seams.requireProjectMember).toHaveBeenCalledWith('project-1', controller.signal);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
