export const EMBEDDING_DIMENSIONS = 1536;

export type EmbeddingProviderConfiguration = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type EmbeddingResult = {
  embedding: number[];
  model: string;
  inputTokens: number | null;
};

export class EmbeddingProviderError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'EmbeddingProviderError';
  }
}

function endpoint(baseUrl: string): URL {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new EmbeddingProviderError('The source-indexing URL is invalid.', 'invalid_endpoint'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new EmbeddingProviderError('The source-indexing URL must use HTTP or HTTPS.', 'invalid_endpoint');
  if (url.search || url.hash) throw new EmbeddingProviderError('The source-indexing URL must not contain query parameters or a fragment.', 'invalid_endpoint');
  const pathname = url.pathname.replace(/\/$/, '');
  url.pathname = pathname.endsWith('/embeddings') ? pathname : `${pathname}/embeddings`;
  return url;
}

/** A deliberately narrow OpenAI-compatible embedding contract. Only actual
 * 1536-dimensional finite vectors can be saved to the pgvector columns. */
export async function createEmbedding(
  config: EmbeddingProviderConfiguration,
  input: string,
  signal?: AbortSignal,
  send: typeof fetch = fetch,
): Promise<EmbeddingResult> {
  if (!input.trim()) throw new EmbeddingProviderError('A non-empty source chunk is required.', 'empty_input');
  const url = endpoint(config.baseUrl);
  const requestController = new AbortController();
  const onAbort = () => requestController.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => requestController.abort(), 30_000);
  let payload: unknown;
  try {
    const response = await send(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, input, dimensions: EMBEDDING_DIMENSIONS, encoding_format: 'float' }),
      signal: requestController.signal,
    });
    if (!response.ok) {
      throw new EmbeddingProviderError(`The source-indexing provider returned HTTP ${response.status}.`, `http_${response.status}`);
    }
    try { payload = await response.json(); }
    catch { throw new EmbeddingProviderError('The source-indexing provider returned invalid JSON.', 'invalid_response'); }
  } catch (cause) {
    if (signal?.aborted) throw new DOMException('The source-indexing request was cancelled.', 'AbortError');
    if (requestController.signal.aborted) throw new EmbeddingProviderError('The source-indexing provider timed out.', 'timeout');
    if (cause instanceof EmbeddingProviderError) throw cause;
    throw new EmbeddingProviderError('The source-indexing provider could not be reached.', 'network_error');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const data = Array.isArray(body.data) ? body.data : [];
  const first = data[0] && typeof data[0] === 'object' ? data[0] as Record<string, unknown> : {};
  const embedding = first.embedding;
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS || !embedding.every(value => typeof value === 'number' && Number.isFinite(value))) {
    throw new EmbeddingProviderError(`The source-indexing provider must return ${EMBEDDING_DIMENSIONS} finite numeric dimensions.`, 'invalid_dimensions');
  }
  if (!embedding.some(value => value !== 0)) throw new EmbeddingProviderError('The source-indexing provider returned a zero vector.', 'zero_vector');
  const usage = body.usage && typeof body.usage === 'object' ? body.usage as Record<string, unknown> : {};
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens);
  return {
    embedding: embedding as number[],
    model: typeof body.model === 'string' && body.model ? body.model : config.model,
    inputTokens: Number.isFinite(inputTokens) && inputTokens >= 0 ? inputTokens : null,
  };
}
