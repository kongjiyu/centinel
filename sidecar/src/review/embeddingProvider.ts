import { ModelProviderError } from './retry.js';
import { providerPause, responseProviderPause } from './providerPause.js';
import type { EmbeddingProviderId } from '../embeddingSettingsTypes.js';
import { isVoyageEmbeddingModel, VOYAGE_EMBEDDING_BASE_URL } from '../embeddingSettings.js';
import { readProviderErrorUsage, type TokenUsageObservation } from '../aiClient.js';

export const EMBEDDING_DIMENSIONS = 1536;

export type EmbeddingProviderConfiguration = {
  apiKey: string;
  baseUrl: string;
  model: string;
  embeddingProvider?: EmbeddingProviderId;
  dimensions?: number;
};

export type EmbeddingResult = {
  embedding: number[];
  model: string;
  inputTokens: number | null;
  /** Exact value only when the response contains usage.total_tokens. */
  providerReportedTotalTokens?: number | null;
};

export type EmbeddingBatchResult = Omit<EmbeddingResult, 'embedding'> & { embeddings: number[][] };

export class EmbeddingProviderError extends ModelProviderError {
  readonly safeUsage?: { inputTokens: number | null; providerReportedTotalTokens: number | null };

  constructor(message: string, code: string, safeUsage?: { inputTokens: number | null; providerReportedTotalTokens: number | null },
    receipt: { responseReceived?: boolean; usageObservation?: TokenUsageObservation } = {}) {
    super(message, { code, ...(providerPause({ code }) ? { retryable: false } : {}),
      responseReceived: receipt.responseReceived ?? (safeUsage ? true : undefined), usageObservation: receipt.usageObservation });
    this.name = 'EmbeddingProviderError';
    this.safeUsage = safeUsage;
  }
}

/** Keep only safe receipt/usage fields, including on decorated AbortErrors. */
export function embeddingFailureUsage(cause: unknown): {
  safeUsage?: EmbeddingProviderError['safeUsage']; responseReceived?: boolean; usageObservation?: TokenUsageObservation;
} {
  if (!cause || typeof cause !== 'object') return {};
  const error = cause as Record<string, unknown>;
  const raw = error.safeUsage && typeof error.safeUsage === 'object' ? error.safeUsage as Record<string, unknown> : undefined;
  const observation = error.usageObservation && typeof error.usageObservation === 'object' ? error.usageObservation as Record<string, unknown> : undefined;
  const usageObservation = observation && ['provider_response', 'provider_error_response', 'codex_thread_total', 'codex_turn_last'].includes(String(observation.source))
    && ['complete', 'partial'].includes(String(observation.completeness))
    ? { source: observation.source as TokenUsageObservation['source'], completeness: observation.completeness as TokenUsageObservation['completeness'],
      ...(Array.isArray(observation.missingCounters) ? { missingCounters: [...new Set(observation.missingCounters.filter((value): value is NonNullable<TokenUsageObservation['missingCounters']>[number] =>
        typeof value === 'string' && ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'totalTokens'].includes(value)))] } : {}) } : undefined;
  return { ...(raw ? { safeUsage: { inputTokens: safeTokenCount(raw.inputTokens), providerReportedTotalTokens: safeTokenCount(raw.providerReportedTotalTokens) } } : {}),
    ...(typeof error.responseReceived === 'boolean' ? { responseReceived: error.responseReceived } : {}), usageObservation };
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

/** Validates the selected provider's embedding response. Voyage's 1024-dimensional
 * settings probe is separate from the existing 1536-dimensional Review index. */
export async function createEmbedding(
  config: EmbeddingProviderConfiguration,
  input: string,
  signal?: AbortSignal,
  send: typeof fetch = fetch,
): Promise<EmbeddingResult> {
  const result = await requestEmbeddings(config, input, 'document', signal, send);
  return { embedding: result.embeddings[0]!, model: result.model, inputTokens: result.inputTokens,
    providerReportedTotalTokens: result.providerReportedTotalTokens };
}

/** One provider request for an upstream batch; no implicit retry or fallback.
 * The orchestrator uses separate document-build and query-only sessions. */
export async function createEmbeddingBatch(
  config: EmbeddingProviderConfiguration,
  input: string[],
  inputType: 'document' | 'query',
  signal?: AbortSignal,
  send: typeof fetch = fetch,
): Promise<EmbeddingBatchResult> {
  return requestEmbeddings(config, input, inputType, signal, send);
}

async function requestEmbeddings(
  config: EmbeddingProviderConfiguration,
  input: string | string[],
  inputType: 'document' | 'query',
  signal: AbortSignal | undefined,
  send: typeof fetch,
): Promise<EmbeddingBatchResult> {
  const inputs = typeof input === 'string' ? [input] : input;
  if (!inputs.length || inputs.length > 128 || inputs.some(item => typeof item !== 'string' || !item.trim())
    || inputs.reduce((sum, item) => sum + item.length, 0) > 256_000) throw new EmbeddingProviderError('A bounded non-empty source batch is required.', 'empty_input');
  const url = endpoint(config.baseUrl);
  const embeddingProvider = config.embeddingProvider ?? 'custom';
  if (embeddingProvider !== 'custom' && embeddingProvider !== 'voyage') {
    throw new EmbeddingProviderError('The source-indexing provider is not supported.', 'invalid_provider');
  }
  const dimensions = config.dimensions ?? (embeddingProvider === 'voyage' ? 1024 : EMBEDDING_DIMENSIONS);
  if (embeddingProvider === 'voyage') {
    if (!isVoyageEmbeddingModel(config.model)) throw new EmbeddingProviderError('Select a published Voyage embedding model.', 'invalid_model');
    if (dimensions !== 1024) throw new EmbeddingProviderError('Voyage embeddings require exactly 1024 dimensions.', 'invalid_dimensions');
    if (url.toString() !== `${VOYAGE_EMBEDDING_BASE_URL}/embeddings`) {
      throw new EmbeddingProviderError('Voyage embeddings require the official API endpoint.', 'invalid_endpoint');
    }
  } else if (dimensions !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingProviderError(`Custom source indexing requires ${EMBEDDING_DIMENSIONS} dimensions.`, 'invalid_dimensions');
  }
  const requestBody = embeddingProvider === 'voyage'
    ? { model: config.model, input, output_dimension: dimensions, output_dtype: 'float', truncation: false, input_type: inputType }
    : { model: config.model, input, dimensions, encoding_format: 'float' };
  const requestController = new AbortController();
  const onAbort = () => requestController.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => requestController.abort(), 30_000);
  let payload: unknown;
  let responseReceived = false;
  let observedSafeUsage: EmbeddingProviderError['safeUsage'];
  let observedUsageObservation: TokenUsageObservation | undefined;
  try {
    const response = await send(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: requestController.signal,
    });
    responseReceived = true;
    if (!response.ok) {
      const observed = await readProviderErrorUsage(response, 'openai-compatible');
      const safeUsage = observed ? {
        inputTokens: embeddingProvider === 'voyage' ? observed.providerReportedTotalTokens ?? null : observed.inputTokens ?? null,
        providerReportedTotalTokens: observed.providerReportedTotalTokens ?? null,
      } : undefined;
      const receipt = { responseReceived: true, usageObservation: observed?.usageObservation };
      observedSafeUsage = safeUsage;
      observedUsageObservation = receipt.usageObservation;
      const pause = await responseProviderPause(response);
      if (pause) throw new EmbeddingProviderError(pause.message, pause.code, safeUsage, receipt);
      throw new EmbeddingProviderError(`The source-indexing provider returned HTTP ${response.status}.`, `http_${response.status}`, safeUsage, receipt);
    }
    try { payload = await response.json(); }
    catch { throw new EmbeddingProviderError('The source-indexing provider returned invalid JSON.', 'invalid_response', undefined, { responseReceived: true }); }
  } catch (cause) {
    if (signal?.aborted) throw Object.assign(new DOMException('The source-indexing request was cancelled.', 'AbortError'), {
      responseReceived, safeUsage: observedSafeUsage, usageObservation: observedUsageObservation,
    });
    if (requestController.signal.aborted) throw new EmbeddingProviderError('The source-indexing provider timed out.', 'timeout', observedSafeUsage,
      { responseReceived, usageObservation: observedUsageObservation });
    if (cause instanceof EmbeddingProviderError) throw cause;
    throw new EmbeddingProviderError('The source-indexing provider could not be reached.', 'network_error', undefined, { responseReceived });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const data = Array.isArray(body.data) ? body.data : [];
  const usage = body.usage && typeof body.usage === 'object' ? body.usage as Record<string, unknown> : {};
  const providerTotal = safeTokenCount(usage.total_tokens);
  const inputUsageValue = embeddingProvider === 'voyage' ? usage.total_tokens : usage.prompt_tokens ?? usage.input_tokens;
  const inputTokens = safeTokenCount(inputUsageValue);
  const safeUsage = { inputTokens, providerReportedTotalTokens: providerTotal };
  const embeddings = data.map(item => item && typeof item === 'object' ? (item as Record<string, unknown>).embedding : undefined);
  if (data.length !== inputs.length || embeddings.some(embedding => !Array.isArray(embedding) || embedding.length !== dimensions
    || !embedding.every(value => typeof value === 'number' && Number.isFinite(value)))) {
    throw new EmbeddingProviderError(`The source-indexing provider must return ${dimensions} finite numeric dimensions.`, 'invalid_dimensions', safeUsage);
  }
  if (embeddings.some(embedding => !(embedding as number[]).some(value => value !== 0))) throw new EmbeddingProviderError('The source-indexing provider returned a zero vector.', 'zero_vector', safeUsage);
  return {
    embeddings: embeddings as number[][],
    model: typeof body.model === 'string' && body.model ? body.model : config.model,
    inputTokens,
    providerReportedTotalTokens: providerTotal,
  };
}

function safeTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
