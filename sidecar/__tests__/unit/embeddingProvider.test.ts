import { describe, expect, it, vi } from 'vitest';
import { createEmbedding, createEmbeddingBatch, EMBEDDING_DIMENSIONS, EmbeddingProviderError } from '../../src/review/embeddingProvider.js';
import { VOYAGE_EMBEDDING_BASE_URL } from '../../src/embeddingSettings.js';

const config = { apiKey: 'private-key', baseUrl: 'https://provider.example.test/v1', model: 'embedding-model' };

describe('configured source-indexing provider', () => {
  it('retains a numeric Retry-After without changing single-call behavior', async () => {
    const send = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429, headers: { 'retry-after': '125' } }));
    await expect(createEmbedding(config, 'chunk', undefined, send)).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 125000 });
    expect(send).toHaveBeenCalledOnce();
  });

  it('retains parsed error-response usage when the request deadline expires during capacity parsing', async () => {
    vi.useFakeTimers();
    try {
      const response = { ok: false, status: 429,
        clone: () => new Response(JSON.stringify({ usage: { prompt_tokens: 17, total_tokens: 17 } })),
        get body() { vi.advanceTimersByTime(30_000); return new ReadableStream({ start(stream) { stream.close(); } }); },
      } as unknown as Response;
      await expect(createEmbedding(config, 'chunk', undefined, async () => response)).rejects.toMatchObject({
        code: 'timeout', responseReceived: true, safeUsage: { inputTokens: 17, providerReportedTotalTokens: 17 },
        usageObservation: { source: 'provider_error_response' },
      });
    } finally { vi.useRealTimers(); }
  });
  it('retains parsed error-response usage when cancellation occurs during capacity parsing', async () => {
    const controller = new AbortController();
    const response = { ok: false, status: 429,
      clone: () => new Response(JSON.stringify({ usage: { prompt_tokens: 17, total_tokens: 17 } })),
      get body() { controller.abort(); return new ReadableStream({ start(stream) { stream.close(); } }); },
    } as unknown as Response;
    await expect(createEmbedding(config, 'chunk', controller.signal, async () => response)).rejects.toMatchObject({
      name: 'AbortError', responseReceived: true, safeUsage: { inputTokens: 17, providerReportedTotalTokens: 17 },
      usageObservation: { source: 'provider_error_response' },
    });
  });
  it('captures safe returned usage from HTTP errors without retaining their body', async () => {
    const send = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'PRIVATE_PROVIDER_BODY' },
      usage: { prompt_tokens: 7, total_tokens: 7 } }), { status: 429 }));
    try { await createEmbedding(config, 'chunk', undefined, send); throw new Error('Expected error'); }
    catch (error) {
      expect(error).toMatchObject({ code: 'quota_exhausted', responseReceived: true,
        safeUsage: { inputTokens: 7, providerReportedTotalTokens: 7 }, usageObservation: { source: 'provider_error_response' } });
      expect(JSON.stringify(error)).not.toContain('PRIVATE_PROVIDER_BODY');
    }
  });
  it('distinguishes no response from a returned error with unknown usage', async () => {
    await expect(createEmbedding(config, 'chunk', undefined, async () => { throw new Error('PRIVATE_NETWORK_DETAIL'); }))
      .rejects.toMatchObject({ code: 'network_error', responseReceived: false });
    await expect(createEmbedding(config, 'chunk', undefined, async () => new Response('{}', { status: 500 })))
      .rejects.toMatchObject({ code: 'http_500', responseReceived: true });
  });
  it('embeds a bounded query batch with exact Voyage task semantics and one actual usage total', async () => {
    const send = vi.fn(async () => new Response(JSON.stringify({ data: [0, 1].map(index => ({ index, embedding: Array(1024).fill(0.5) })), usage: { total_tokens: 8 } })));
    const configuration = { apiKey: 'key', baseUrl: VOYAGE_EMBEDDING_BASE_URL, model: 'voyage-4-lite', embeddingProvider: 'voyage' as const, dimensions: 1024 };
    const result = await createEmbeddingBatch(configuration, ['one query', 'another query'], 'query', undefined, send);
    expect(result.embeddings).toHaveLength(2); expect(result.providerReportedTotalTokens).toBe(8);
    expect(send).toHaveBeenCalledOnce();
    expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body))).toMatchObject({ input: ['one query', 'another query'], input_type: 'query', output_dimension: 1024, truncation: false });
    await expect(createEmbeddingBatch(configuration, [''], 'query', undefined, send)).rejects.toMatchObject({ code: 'empty_input' });
    expect(send).toHaveBeenCalledOnce();
  });
  it('stops structured credit errors without exposing their body', async () => {
    await expect(createEmbedding(config, 'chunk', undefined, async () => new Response(JSON.stringify({ error: { code: 'credit_balance_exhausted', message: 'PRIVATE_PROVIDER_BODY' } }), { status: 403 })))
      .rejects.toMatchObject({ code: 'credits_exhausted', retryable: false });
  });
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
    expect(result.providerReportedTotalTokens).toBeNull();
    expect(result.embedding).toHaveLength(1536);
    expect(JSON.stringify(result)).not.toContain('private-key');
  });

  it('preserves an exact raw provider total when the embedding response includes one', async () => {
    const send = vi.fn(async () => new Response(JSON.stringify({
      data: [{ embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0) }],
      usage: { prompt_tokens: 7, total_tokens: 7 },
    }), { status: 200 }));

    const result = await createEmbedding(config, 'chunk', undefined, send);

    expect(result).toMatchObject({ inputTokens: 7, providerReportedTotalTokens: 7 });
  });

  it('rejects malformed vectors and provider errors without returning response bodies', async () => {
    await expect(createEmbedding(config, 'chunk', undefined, async () => new Response(JSON.stringify({ data: [{ embedding: [1, 2] }] }), { status: 200 })))
      .rejects.toMatchObject({ code: 'invalid_dimensions' });
    await expect(createEmbedding(config, 'chunk', undefined, async () => new Response('PRIVATE_PROVIDER_ERROR', { status: 401 })))
      .rejects.toMatchObject({ code: 'http_401', message: 'The source-indexing provider returned HTTP 401.' });
    await expect(createEmbedding({ ...config, baseUrl: 'file:///private' }, 'chunk')).rejects.toBeInstanceOf(EmbeddingProviderError);
  });

  it.each(['', '7', null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('keeps malformed or missing input usage unknown: %s', async promptTokens => {
    const result = await createEmbedding(config, 'chunk', undefined, async () => new Response(JSON.stringify({
      data: [{ embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0) }],
      usage: { prompt_tokens: promptTokens },
    }), { status: 200 }));
    expect(result.inputTokens).toBeNull();
  });

  it('preserves an explicitly reported zero input count', async () => {
    const result = await createEmbedding(config, 'chunk', undefined, async () => new Response(JSON.stringify({
      data: [{ embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0) }],
      usage: { input_tokens: 0 },
    }), { status: 200 }));
    expect(result.inputTokens).toBe(0);
  });

  it('uses the native Voyage request contract and validates 1024-dimensional document vectors', async () => {
    const voyageConfig = {
      apiKey: 'private-voyage-key', baseUrl: VOYAGE_EMBEDDING_BASE_URL,
      model: 'voyage-4-lite', embeddingProvider: 'voyage' as const, dimensions: 1024,
    };
    let requestInit: RequestInit | undefined;
    const send = vi.fn(async (_url: URL, init?: RequestInit) => {
      requestInit = init;
      return new Response(JSON.stringify({
      data: [{ embedding: Array.from({ length: 1024 }, (_, index) => index === 0 ? 0.5 : 0) }],
      model: 'voyage-4-lite', usage: { total_tokens: 11 },
      }), { status: 200 });
    });

    const result = await createEmbedding(voyageConfig, 'A source document.', undefined, send);

    expect(send).toHaveBeenCalledWith(new URL('https://api.voyageai.com/v1/embeddings'), expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer private-voyage-key' }),
      body: JSON.stringify({ model: 'voyage-4-lite', input: 'A source document.', output_dimension: 1024, output_dtype: 'float', truncation: false, input_type: 'document' }),
    }));
    const sentBody = JSON.parse(String(requestInit?.body));
    expect(sentBody).not.toHaveProperty('dimensions');
    expect(sentBody).not.toHaveProperty('encoding_format');
    expect(result).toMatchObject({ model: 'voyage-4-lite', inputTokens: 11, providerReportedTotalTokens: 11 });
    expect(result.embedding).toHaveLength(1024);
    expect(JSON.stringify(result)).not.toContain('private-voyage-key');
  });

  it('rejects Voyage models, dimensions, and endpoints outside the fixed contract before network access', async () => {
    const send = vi.fn(async () => new Response('should not be requested', { status: 200 }));
    const voyageConfig = {
      apiKey: 'private-voyage-key', baseUrl: VOYAGE_EMBEDDING_BASE_URL,
      model: 'voyage-4-lite', embeddingProvider: 'voyage' as const, dimensions: 1024,
    };
    await expect(createEmbedding({ ...voyageConfig, model: 'unlisted-model' }, 'chunk', undefined, send))
      .rejects.toMatchObject({ code: 'invalid_model' });
    await expect(createEmbedding({ ...voyageConfig, dimensions: 1536 }, 'chunk', undefined, send))
      .rejects.toMatchObject({ code: 'invalid_dimensions' });
    await expect(createEmbedding({ ...voyageConfig, baseUrl: 'https://proxy.example.test/v1' }, 'chunk', undefined, send))
      .rejects.toMatchObject({ code: 'invalid_endpoint' });
    expect(send).not.toHaveBeenCalled();
  });

  it('preserves validated Voyage usage on invalid vector responses', async () => {
    const voyageConfig = {
      apiKey: 'private-voyage-key', baseUrl: VOYAGE_EMBEDDING_BASE_URL,
      model: 'voyage-4', embeddingProvider: 'voyage' as const, dimensions: 1024,
    };
    try {
      await createEmbedding(voyageConfig, 'chunk', undefined, async () => new Response(JSON.stringify({
        data: [{ embedding: [0.1, Number.NaN] }], usage: { total_tokens: 13 },
      }), { status: 200 }));
      throw new Error('Expected the malformed vector to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingProviderError);
      expect(error).toMatchObject({ code: 'invalid_dimensions', safeUsage: { inputTokens: 13, providerReportedTotalTokens: 13 } });
      expect(JSON.stringify(error)).not.toContain('private-voyage-key');
    }
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
