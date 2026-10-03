import type { StaticAnalysisModelProvider, StaticModelRequest, StaticModelResult, ModelAttemptOutcome, ModelAttemptRecord } from './types.js';

export const MAX_MODEL_ATTEMPTS = 3;

export type RetryClassification = {
  kind: 'retryable' | 'permanent' | 'cancelled' | 'malformed';
  code: string;
  statusCode?: number;
  retryAfterMs?: number;
};

/** An error raised by a provider may carry HTTP/retry metadata without
 * coupling the orchestrator to a particular SDK. */
export class ModelProviderError extends Error {
  readonly code: string;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
  readonly retryable?: boolean;
  readonly malformed?: boolean;

  constructor(message: string, options: {
    code?: string;
    statusCode?: number;
    retryAfterMs?: number;
    retryable?: boolean;
    malformed?: boolean;
    cause?: unknown;
  } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ModelProviderError';
    this.code = options.code ?? 'provider_error';
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable;
    this.malformed = options.malformed;
  }
}

export class ReviewCancelledError extends Error {
  constructor(message = 'Review was cancelled') {
    super(message);
    this.name = 'ReviewCancelledError';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof ReviewCancelledError
    || (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError');
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function safeErrorMessage(error: unknown): string {
  // Provider response bodies occasionally echo request metadata. Keep enough
  // context for a useful audit trail, but never persist an unbounded body or a
  // credential-like value alongside usage records.
  return errorMessage(error)
    .replace(/(api[-_ ]?key|authorization|bearer|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 512);
}

function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown; statusCode?: unknown })?.status
    ?? (error as { statusCode?: unknown })?.statusCode;
  const number = Number(status);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function parseRetryAfter(error: unknown): number | undefined {
  const raw = (error as { retryAfterMs?: unknown; retryAfter?: unknown })?.retryAfterMs
    ?? (error as { retryAfter?: unknown })?.retryAfter;
  const number = Number(raw);
  if (Number.isFinite(number) && number >= 0) return number;
  return undefined;
}

/**
 * Classify a provider failure once, centrally. This prevents each stage from
 * inventing a different retry policy and ensures permanent auth/configuration
 * failures never burn attempts.
 */
export function classifyModelError(error: unknown, signal?: AbortSignal): RetryClassification {
  if (signal?.aborted || isAbortError(error)) {
    return { kind: 'cancelled', code: 'cancelled' };
  }

  if (error instanceof ModelProviderError) {
    if (error.malformed || error.code === 'malformed_response') {
      return {
        kind: 'malformed',
        code: error.code,
        statusCode: error.statusCode,
        retryAfterMs: error.retryAfterMs,
      };
    }
    if (error.retryable === false) {
      return { kind: 'permanent', code: error.code, statusCode: error.statusCode };
    }
    if (error.retryable === true) {
      return {
        kind: 'retryable',
        code: error.code,
        statusCode: error.statusCode,
        retryAfterMs: error.retryAfterMs,
      };
    }
  }

  const statusCode = errorStatus(error);
  const retryAfterMs = parseRetryAfter(error);
  if (statusCode !== undefined) {
    // Provider throttling and transient server/network statuses are safe to
    // retry. Authentication, permission, malformed request, and unsupported
    // model responses are not.
    const retryableStatuses = new Set([408, 409, 425, 429, 500, 502, 503, 504, 507, 529]);
    if (retryableStatuses.has(statusCode)) {
      return { kind: 'retryable', code: `http_${statusCode}`, statusCode, retryAfterMs };
    }
    return { kind: 'permanent', code: `http_${statusCode}`, statusCode };
  }

  const message = errorMessage(error).toLowerCase();
  if (/invalid\s*(api\s*)?key|authentication|unauthori[sz]ed|forbidden|permission|credential|unsupported\s+model|invalid\s+(?:model|configuration|request)|bad\s+request/.test(message)) {
    return { kind: 'permanent', code: 'permanent_provider_error' };
  }
  if (/malformed|invalid\s+json|json\s+parse|structured\s+response|unexpected\s+response/.test(message)) {
    return { kind: 'malformed', code: 'malformed_response' };
  }
  // Fetch reports network failures as TypeError and Node errors often include
  // one of these socket codes in the message. Treat them as transient unless
  // the request was explicitly aborted above.
  if (error instanceof TypeError || /network|timed?\s*out|timeout|econn|enotfound|socket|temporar|connection reset|rate limit|overloaded/.test(message)) {
    return { kind: 'retryable', code: 'transient_network_error', retryAfterMs };
  }
  return { kind: 'permanent', code: 'provider_error' };
}

export type RetryPolicyOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
  signal?: AbortSignal;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
};

export function calculateBackoffMs(
  attempt: number,
  options: Pick<RetryPolicyOptions, 'baseDelayMs' | 'maxDelayMs' | 'jitterRatio' | 'random'> = {},
  retryAfterMs?: number,
): number {
  const base = Math.max(0, options.baseDelayMs ?? 250);
  const cap = Math.max(base, options.maxDelayMs ?? 8_000);
  const jitterRatio = Math.max(0, Math.min(1, options.jitterRatio ?? 0.2));
  const random = options.random ?? Math.random;
  const exponential = Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));
  const providerDelay = Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs as number) : 0;
  const delay = Math.max(exponential, providerDelay);
  const jitter = delay * jitterRatio * Math.max(0, Math.min(1, random()));
  return Math.min(cap, Math.round(delay + jitter));
}

/** Abort-aware delay. A cancelled retry wakes immediately rather than waiting
 * for the full exponential backoff duration. */
export function sleepWithCancellation(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new ReviewCancelledError());
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new ReviewCancelledError());
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export type ModelAttemptContext = {
  reviewId: string;
  projectId: string;
  stage: string;
  /** Provider/model metadata used for audit rows even when the request fails. */
  provider: string;
  apiFormat: string;
  model: string;
  onAttempt?: (attempt: ModelAttemptRecord) => void | Promise<void>;
  now?: () => Date;
};

export type ModelOperationResult = {
  result: StaticModelResult;
  attempts: ModelAttemptRecord[];
  providerUsed: 'primary' | 'fallback';
};

export type ModelOperationOptions = RetryPolicyOptions & ModelAttemptContext & {
  fallback?: StaticAnalysisModelProvider;
  fallbackContext?: Partial<Pick<ModelAttemptContext, 'provider' | 'apiFormat' | 'model'>>;
  /** The hard product budget is shared by primary and fallback. Every network
   * request, including a constrained JSON repair, consumes one slot. */
  maxTotalAttempts?: number;
  /** Persisted high-water mark from a prior worker before recovery. */
  attemptOffset?: number;
  /** Reserve slots for the fallback when one is configured. The default keeps
   * one slot available so a three-total-attempt operation can use two primary
   * attempts followed by one fallback attempt. */
  fallbackReserveAttempts?: number;
};

/**
 * Execute one structured model operation with bounded, classified retries.
 * Fallback is deterministic: primary gets its eligible attempts first, then
 * fallback is considered only when the primary exhausted retryable/malformed
 * failures. Permanent auth/configuration errors fail immediately and do not
 * silently switch credentials or conceal a bad configuration.
 */
export async function runModelOperation(
  request: StaticModelRequest,
  primary: StaticAnalysisModelProvider,
  options: ModelOperationOptions,
): Promise<ModelOperationResult> {
  const maxAttempts = Math.max(1, Math.min(MAX_MODEL_ATTEMPTS, options.maxAttempts ?? MAX_MODEL_ATTEMPTS));
  const maxTotalAttempts = options.maxTotalAttempts == null
    ? MAX_MODEL_ATTEMPTS
    : Math.max(1, Math.min(MAX_MODEL_ATTEMPTS, options.maxTotalAttempts));
  const attemptOffset = Math.max(0, Math.floor(options.attemptOffset ?? 0));
  const remainingAttempts = Math.max(0, maxTotalAttempts - attemptOffset);
  if (!remainingAttempts) {
    throw new ModelProviderError('Model provider exhausted the persisted Review attempt budget', {
      code: 'retry_exhausted', retryable: true,
    });
  }
  const fallbackReserveAttempts = options.fallback
    ? Math.max(0, Math.min(remainingAttempts - 1, Math.floor(options.fallbackReserveAttempts ?? 1)))
    : 0;
  // Keep at least one primary slot. If a caller explicitly sets
  // fallbackReserveAttempts to zero, the primary may consume the whole
  // operation budget and fallback is intentionally disabled for that call.
  const primaryAttemptLimit = Math.max(1, Math.min(maxAttempts, remainingAttempts - fallbackReserveAttempts));
  const now = options.now ?? (() => new Date());
  const attempts: ModelAttemptRecord[] = [];
  let totalAttempts = 0;

  const runProvider = async (
    provider: StaticAnalysisModelProvider,
    providerKind: 'primary' | 'fallback',
    providerContext: Pick<ModelAttemptContext, 'provider' | 'apiFormat' | 'model'>,
  ): Promise<ModelOperationResult | null> => {
    let lastClassification: RetryClassification | null = null;
    const attemptLimit = providerKind === 'primary' ? primaryAttemptLimit : maxAttempts;
    for (let providerAttempt = 1; providerAttempt <= attemptLimit && totalAttempts < remainingAttempts; providerAttempt++) {
      if (options.signal?.aborted || request.signal?.aborted) throw new ReviewCancelledError();
      totalAttempts++;
      const started = Date.now();
      const attemptNumber = attemptOffset + totalAttempts;
      let result: StaticModelResult;
      try {
        result = await provider.analyze({
          ...request,
          signal: options.signal ?? request.signal,
          repair: request.repair || providerAttempt > 1 && lastClassification?.kind === 'malformed',
        });
        // A provider is allowed to resolve after an abort (for example, a
        // custom SDK may not wire AbortSignal). Cancellation wins over that
        // late response so a cancelled Review can never become successful.
        if (options.signal?.aborted || request.signal?.aborted) throw new ReviewCancelledError();
      } catch (error) {
        const classification = classifyModelError(error, options.signal ?? request.signal);
        lastClassification = classification;
        const outcome: ModelAttemptOutcome = classification.kind === 'cancelled' ? 'cancelled'
          : classification.kind === 'malformed' ? 'malformed_response'
          : classification.kind === 'retryable' ? 'retryable_error' : 'permanent_error';
        const errorCode = classification.code;
        const errorMessageValue = safeErrorMessage(error);
        const statusCode = classification.statusCode;
        const retryAfterMs = classification.retryAfterMs;
        const record = makeAttemptRecord({
          ...options,
          ...providerContext,
          reviewId: options.reviewId,
          projectId: options.projectId,
          stage: options.stage,
          attempt: attemptNumber,
          outcome,
          durationMs: Date.now() - started,
          errorCode,
          errorMessage: errorMessageValue,
          statusCode,
          retryAfterMs,
          now,
        });
        attempts.push(record);
        // Persistence is intentionally outside the provider try block. An
        // audit/database failure must not be mistaken for a provider failure
        // and cause another paid request.
        await options.onAttempt?.(record);
        if (classification.kind === 'cancelled') throw new ReviewCancelledError(errorMessageValue);
        if (classification.kind === 'permanent') throw error;
        if (providerAttempt >= maxAttempts || totalAttempts >= remainingAttempts) break;
        const delayMs = calculateBackoffMs(providerAttempt, options, retryAfterMs);
        await (options.sleep ?? sleepWithCancellation)(delayMs, options.signal ?? request.signal);
        continue;
      }

      const record = makeAttemptRecord({
        ...options,
        ...providerContext,
        reviewId: options.reviewId,
        projectId: options.projectId,
        stage: options.stage,
        attempt: attemptNumber,
        outcome: 'success',
        durationMs: Date.now() - started,
        usage: result.usage,
        now,
      });
      attempts.push(record);
      await options.onAttempt?.(record);
      return { result, attempts, providerUsed: providerKind };
    }
    return null;
  };

  const primaryContext = { provider: options.provider, apiFormat: options.apiFormat, model: options.model };
  const primaryResult = await runProvider(primary, 'primary', primaryContext);
  if (primaryResult) return primaryResult;
  if (!options.fallback || totalAttempts >= remainingAttempts || fallbackReserveAttempts === 0) {
    throw new ModelProviderError('Model provider exhausted eligible attempts', {
      code: 'retry_exhausted',
      retryable: true,
    });
  }

  const fallbackContext = {
    provider: options.fallbackContext?.provider ?? options.provider,
    apiFormat: options.fallbackContext?.apiFormat ?? options.apiFormat,
    model: options.fallbackContext?.model ?? options.model,
  };
  const fallbackResult = await runProvider(options.fallback, 'fallback', fallbackContext);
  if (fallbackResult) return fallbackResult;
  throw new ModelProviderError('Primary and fallback model providers exhausted eligible attempts', {
    code: 'retry_exhausted',
    retryable: true,
  });
}

function makeAttemptRecord(input: ModelAttemptContext & {
  attempt: number;
  outcome: ModelAttemptOutcome;
  durationMs: number;
  statusCode?: number;
  retryAfterMs?: number;
  errorCode?: string;
  errorMessage?: string;
  usage?: StaticModelResult['usage'];
  now: () => Date;
}): ModelAttemptRecord {
  return {
    reviewId: input.reviewId,
    projectId: input.projectId,
    stage: input.stage,
    attempt: input.attempt,
    provider: input.provider,
    apiFormat: input.apiFormat,
    model: input.model,
    outcome: input.outcome,
    durationMs: input.durationMs,
    statusCode: input.statusCode,
    retryAfterMs: input.retryAfterMs,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    usage: input.usage,
    createdAt: input.now().toISOString(),
  };
}
