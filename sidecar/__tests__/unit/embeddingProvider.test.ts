import { describe, expect, it, vi } from 'vitest';
import { createEmbedding, EMBEDDING_DIMENSIONS, EmbeddingProviderError } from '../../src/review/embeddingProvider.js';

const config = { apiKey: 'private-key', baseUrl: 'https://provider.example.test/v1', model: 'embedding-model' };

describe('configured source-indexing provider', () => {
  it('requests float embeddings at the schema dimension without exposing the key in the result', async () => {
    const send = vi.fn(async () => new Response(JSON.stringify({
      data: [{ embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0) }],
      model: 'embedding-model', usage: { prompt_tokens: 7 },
    }), { status: 200 }));
    const result = await createEmbedding(config, 'A frozen source chunk.', undefined, send);
    expect(send).toHaveBeenCalledWith(new URL('https://provider.example.test/v1/embeddings'), expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer private-key' }),
      body: JSON.stringify({ model: 'embedding-model', input: 'A frozen source chunk.', dimensions: 1536, encoding_format: 'float' }),
    }));
    expect(result).toMatchObject({ model: 'embedding-model', inputTokens: 7 });
    expect(result.embedding).toHaveLength(1536);
    expect(JSON.stringify(result)).not.toContain('private-key');
  });

  it('rejects malformed vectors and provider errors without returning response bodies', async () => {
    await expect(createEmbedding(config, 'chunk', undefined, async () => new Response(JSON.stringify({ data: [{ embedding: [1, 2] }] }), { status: 200 })))
      .rejects.toMatchObject({ code: 'invalid_dimensions' });
    await expect(createEmbedding(config, 'chunk', undefined, async () => new Response('PRIVATE_PROVIDER_ERROR', { status: 401 })))
      .rejects.toMatchObject({ code: 'http_401', message: 'The source-indexing provider returned HTTP 401.' });
    await expect(createEmbedding({ ...config, baseUrl: 'file:///private' }, 'chunk')).rejects.toBeInstanceOf(EmbeddingProviderError);
  });

  it('forwards cancellation to the provider request', async () => {
    const controller = new AbortController();
    const send = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(createEmbedding(config, 'chunk', controller.signal, send)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('bounds a stalled provider request and hides raw network errors', async () => {
    vi.useFakeTimers();
    try {
      const stalled = createEmbedding(config, 'chunk', undefined, async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })));
      const assertion = expect(stalled).rejects.toMatchObject({ code: 'timeout' });
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
    await expect(createEmbedding(config, 'chunk', undefined, async () => { throw new Error('PRIVATE_NETWORK_DETAIL'); }))
      .rejects.toMatchObject({ code: 'network_error', message: 'The source-indexing provider could not be reached.' });
  });
});
