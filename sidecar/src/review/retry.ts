import type { StaticAnalysisModelProvider, StaticModelRequest, StaticModelResult, ModelAttemptOutcome, ModelAttemptRecord } from './types.js';
import type { TokenUsageObservation } from '../aiClient.js';
import {
  providerPause,
  REVIEW_PROVIDER_UNAVAILABLE_MESSAGE,
  reviewProviderPause,
} from './providerPause.js';
import { sanitizeReviewRequestUsageContext } from './usageContext.js';

export const MAX_MODEL_ATTEMPTS = 5;
export const MAX_EXTERNAL_ATTEMPTS = 3;
export const MODEL_RETRY_DELAYS_MS = [1_000, 3_000, 7_000, 15_000] as const;
export const EXTERNAL_RETRY_DELAYS_MS = [1_000, 3_000] as const;

export type ExternalRetryScheduledEvent = {
  service: string;
  operation: string;
  /** The upcoming, one-based request attempt. */
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  nextAttemptAt: string;
  errorCode: string;
};

export type ExternalRetryOptions = {
  service: string;
  operation: string;
  signal?: AbortSignal;
  /** Callers may lower the limit, but cannot raise the product maximum. */
  maxAttempts?: number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  now?: () => Date;
  onRetry?: (event: ExternalRetryScheduledEvent) => void | Promise<void>;
};

export type RetryClassification = {
  kind: 'retryable' | 'permanent' | 'cancelled' | 'malformed' | 'paused';
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
  readonly usage?: StaticModelResult['usage'];
  readonly responseReceived?: boolean;
  readonly usageObservation?: TokenUsageObservation;
  /** Internal tag consumed only by Review's reviewProviderPause helper. */
  readonly reviewPause?: boolean;

  constructor(message: string, options: {
    code?: string;
    statusCode?: number;
    retryAfterMs?: number;
    retryable?: boolean;
    malformed?: boolean;
    usage?: StaticModelResult['usage'];
    responseReceived?: boolean;
    usageObservation?: TokenUsageObservation;
    reviewPause?: boolean;
    cause?: unknown;
  } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ModelProviderError';
    this.code = options.code ?? 'provider_error';
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable;
    this.malformed = options.malformed;
    this.usage = options.usage;
    this.responseReceived = options.responseReceived;
    this.usageObservation = options.usageObservation;
    this.reviewPause = options.reviewPause;
  }
}

function reviewProviderUnavailableError(metadata: {
  statusCode?: number;
  retryAfterMs?: number;
  usage?: StaticModelResult['usage'];
  responseReceived?: boolean;
  usageObservation?: TokenUsageObservation;
} = {}): ModelProviderError {
  return new ModelProviderError(REVIEW_PROVIDER_UNAVAILABLE_MESSAGE, {
    code: 'provider_unavailable', retryable: false, reviewPause: true,
    ...metadata,
  });
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
  const values = error as { retryAfterMs?: unknown; retryAfter?: unknown; headers?: Headers | Record<string, unknown> };
  const retryAfterMs = Number(values?.retryAfterMs);
  if (values?.retryAfterMs != null && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return retryAfterMs;
  const headers = values?.headers;
  const retryAfterHeader = headers && typeof headers === 'object' && 'get' in headers && typeof headers.get === 'function'
    ? headers.get('retry-after')
    : Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
  const raw = values?.retryAfter ?? retryAfterHeader;
  if (typeof raw === 'string' && !/^\s*\d+(?:\.\d+)?\s*$/.test(raw)) {
    const date = Date.parse(raw);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
  }
  const number = Number(raw);
  // `retryAfter` and the HTTP Retry-After header are seconds; the explicit
  // `retryAfterMs` field above is already milliseconds.
  if (raw != null && Number.isFinite(number) && number >= 0) return number * 1_000;
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

  const pause = providerPause(error);
  if (pause) return { kind: 'paused', code: pause.code, statusCode: errorStatus(error), retryAfterMs: parseRetryAfter(error) };

  const providerError = error as { code?: unknown; retryable?: unknown; malformed?: unknown; statusCode?: unknown; retryAfterMs?: unknown };
  if (providerError && providerError.retryable === false) {
    return { kind: 'permanent', code: typeof providerError.code === 'string' ? providerError.code : 'provider_error', statusCode: errorStatus(error) };
  }

  const statusCode = errorStatus(error);
  const retryAfterMs = parseRetryAfter(error);
  if (statusCode !== undefined) {
    // Capacity blocks above require manual recovery. Other transient statuses
    // retain bounded retry behavior; auth/configuration failures do not.
    const retryableStatuses = new Set([408, 409, 425, 500, 502, 503, 504, 507, 529]);
    if (retryableStatuses.has(statusCode)) {
      return { kind: 'retryable', code: `http_${statusCode}`, statusCode, retryAfterMs };
    }
    return { kind: 'permanent', code: `http_${statusCode}`, statusCode };
  }

  if (providerError && (providerError.malformed === true || providerError.code === 'malformed_response')) {
    return {
      kind: 'malformed',
      code: typeof providerError.code === 'string' ? providerError.code : 'malformed_response',
      statusCode: errorStatus(error),
      retryAfterMs: parseRetryAfter(error),
    };
  }
  if (providerError && providerError.retryable === true) {
    return {
      kind: 'retryable',
      code: typeof providerError.code === 'string' ? providerError.code : 'provider_error',
      statusCode: errorStatus(error),
      retryAfterMs: parseRetryAfter(error),
    };
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
  onRetry?: (event: ExternalRetryScheduledEvent) => void | Promise<void>;
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

function externalErrorClassification(error: unknown, signal?: AbortSignal): RetryClassification {
  if (signal?.aborted || isAbortError(error)) return { kind: 'cancelled', code: 'cancelled' };

  const value = error as { code?: unknown; retryable?: unknown };
  const code = typeof value?.code === 'string' ? value.code : undefined;
  const message = errorMessage(error).toLowerCase();
  const statusCode = errorStatus(error);
  const retryAfterMs = parseRetryAfter(error);

  // SQLSTATE integrity/authentication failures are permanent even if a
  // surrounding transport reports a generic retryable flag or HTTP 5xx.
  if (code && /^(?:23|28)\d{3}$/.test(code)) {
    return { kind: 'permanent', code: code.toLowerCase(), statusCode };
  }
  if (/invalid\s*(?:api\s*)?key|authentication|unauthori[sz]ed|forbidden|permission|credential|unsupported\s+model|invalid\s+(?:model|configuration|request)|bad\s+request|not-null constraint|foreign key constraint|check constraint/.test(message)) {
    return { kind: 'permanent', code: code ?? (statusCode ? `http_${statusCode}` : 'permanent_external_error'), statusCode };
  }

  if (statusCode !== undefined) {
    const retryableStatus = statusCode === 408 || statusCode === 425 || statusCode === 429
      || (statusCode >= 500 && statusCode <= 599 && ![501, 505].includes(statusCode));
    if (retryableStatus && value?.retryable !== false) {
      return { kind: 'retryable', code: `http_${statusCode}`, statusCode, retryAfterMs };
    }
    return { kind: 'permanent', code: `http_${statusCode}`, statusCode };
  }

  // Postgres connection-exception SQLSTATE class 08 is transient; constraint,
  // authorization, and invalid-input classes are not.
  if (code && /^08\d{3}$/.test(code)) return { kind: 'retryable', code: code.toLowerCase(), retryAfterMs };
  if (value?.retryable === false) return { kind: 'permanent', code: code ?? 'external_error' };
  if (value?.retryable === true) return { kind: 'retryable', code: code ?? 'external_error', retryAfterMs };
  if (error instanceof TypeError || /network|timed? out|timeout|econn|enotfound|socket|temporar|connection reset|rate limit|overloaded/.test(message)) {
    return { kind: 'retryable', code: code ?? 'transient_network_error', retryAfterMs };
  }
  return { kind: 'permanent', code: code ?? 'external_error' };
}

function safeRetryLabel(value: string, fallback: string): string {
  const safe = value.trim().replace(/[^a-z0-9_. -]/gi, '').replace(/\s+/g, ' ').slice(0, 80);
  return safe || fallback;
}

/** Retry one external request unit only. The caller must keep compound or
 * non-idempotent operations outside this helper unless the request has a
 * stable idempotency key. Retry status is emitted before each backoff wait. */
export async function runExternalOperation<T>(
  operation: (attempt: number, signal?: AbortSignal) => Promise<T>,
  options: ExternalRetryOptions,
): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(MAX_EXTERNAL_ATTEMPTS, Math.floor(options.maxAttempts ?? MAX_EXTERNAL_ATTEMPTS)));
  const now = options.now ?? (() => new Date());
  const service = safeRetryLabel(options.service, 'external service');
  const operationLabel = safeRetryLabel(options.operation, 'external request');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) throw new ReviewCancelledError();
    try {
      return await operation(attempt, options.signal);
    } catch (error) {
      const classification = externalErrorClassification(error, options.signal);
      if (classification.kind === 'cancelled') throw new ReviewCancelledError(errorMessage(error));
      if (classification.kind !== 'retryable' || attempt >= maxAttempts) throw error;

      const nominalDelayMs = EXTERNAL_RETRY_DELAYS_MS[Math.min(attempt - 1, EXTERNAL_RETRY_DELAYS_MS.length - 1)];
      const hintedDelayMs = classification.retryAfterMs ?? 0;
      const delayMs = Math.min(EXTERNAL_RETRY_DELAYS_MS.at(-1)!, Math.max(nominalDelayMs, hintedDelayMs));
      const nextAttemptAt = new Date(now().getTime() + delayMs).toISOString();
      await options.onRetry?.({
        service,
        operation: operationLabel,
        attempt: attempt + 1,
        maxAttempts,
        delayMs,
        nextAttemptAt,
        errorCode: classification.code,
      });
      await (options.sleep ?? sleepWithCancellation)(delayMs, options.signal);
    }
  }
  throw new Error('External retry loop terminated unexpectedly');
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
  /** A format/evidence repair must not silently switch providers. */
  fallbackOnMalformed?: boolean;
  /** Durable reservation written before a provider request. A crash after
   * reservation consumes this slot on recovery instead of risking a duplicate paid call. */
  onAttemptStarted?: (attempt: ModelAttemptRecord) => void | Promise<void>;
  fallbackContext?: Partial<Pick<ModelAttemptContext, 'provider' | 'apiFormat' | 'model'>>;
  /** Bind safe accounting metadata to each actual request, including repairs. */
  usageContextForAttempt?: (request: StaticModelRequest, attempt: number) => StaticModelRequest['usageContext'];
  /** The hard product budget is shared by primary and fallback. Every network
   * request, including a constrained JSON repair, consumes one slot. */
  maxTotalAttempts?: number;
  /** Persisted high-water mark from a prior worker before recovery. */
  attemptOffset?: number;
  /** Reserve slots for the fallback when one is configured. The default keeps
   * one slot available so a five-total-attempt operation can use four primary
   * attempts followed by one fallback attempt. */
  fallbackReserveAttempts?: number;
};

export type AiRequestAttempt<T> = {
  attempt: number;
  outcome: ModelAttemptOutcome;
  durationMs: number;
  errorCode?: string;
  statusCode?: number;
  retryAfterMs?: number;
  /** Available only to the in-memory callback on success; never audit this value. */
  result?: T;
};

export type AiRequestOptions = RetryPolicyOptions & {
  now?: () => Date;
  service: string;
  operation: string;
  /** Maximum total provider requests, including the first call. Hard-capped at five. */
  maxAttempts?: number;
  /** Paid request reservations already persisted for this same operation. */
  attemptOffset?: number;
  onAttemptStarted?: (attempt: number) => void | Promise<void>;
  onAttempt?: (attempt: AiRequestAttempt<TypedNever>) => void | Promise<void>;
};

// Keep the generic callback options expressible without coupling the retry
// policy to a particular provider response shape.
type TypedNever = unknown;

/** Retry a single AI request unit (for example one embedding input). Compound
 * operations and their persistence stay outside this helper. Reservation and
 * completion callbacks are outside the provider try/catch so ledger failures
 * can never trigger a duplicate paid request. */
export async function runAiRequest<T>(
  operation: (attempt: number, signal?: AbortSignal) => Promise<T>,
  options: Omit<AiRequestOptions, 'onAttempt'> & { onAttempt?: (attempt: AiRequestAttempt<T>) => void | Promise<void> },
): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(MAX_MODEL_ATTEMPTS, Math.floor(options.maxAttempts ?? MAX_MODEL_ATTEMPTS)));
  const attemptOffset = Math.max(0, Math.floor(options.attemptOffset ?? 0));
  const remainingAttempts = Math.max(0, maxAttempts - attemptOffset);
  if (!remainingAttempts) {
    throw new ModelProviderError('AI provider exhausted the persisted Review attempt budget', {
      code: 'retry_exhausted', retryable: true,
    });
  }
  const now = options.now ?? (() => new Date());
  const service = safeRetryLabel(options.service, 'AI provider');
  const operationLabel = safeRetryLabel(options.operation, 'AI request');
  for (let localAttempt = 1; localAttempt <= remainingAttempts; localAttempt++) {
    if (options.signal?.aborted) throw new ReviewCancelledError();
    const attempt = attemptOffset + localAttempt;
    // Persist before entering the paid provider operation. A crash can consume
    // an unused slot, but cannot cause the same slot to be billed twice.
    await options.onAttemptStarted?.(attempt);
    const started = Date.now();
    let result: T;
    try {
      result = await operation(attempt, options.signal);
      if (options.signal?.aborted) throw new ReviewCancelledError();
    } catch (error) {
      const classification = classifyModelError(error, options.signal);
      const outcome: ModelAttemptOutcome = classification.kind === 'cancelled' ? 'cancelled'
        : classification.kind === 'malformed' ? 'malformed_response'
        : classification.kind === 'retryable' ? 'retryable_error' : 'permanent_error';
      await options.onAttempt?.({
        attempt,
        outcome,
        durationMs: Date.now() - started,
        errorCode: classification.code,
        statusCode: classification.statusCode,
        retryAfterMs: classification.retryAfterMs,
      });
      if (classification.kind === 'cancelled') throw new ReviewCancelledError(errorMessage(error));
      if (classification.kind === 'paused') throw new ModelProviderError(providerPause(error)!.message, {
        code: classification.code, statusCode: classification.statusCode, retryAfterMs: classification.retryAfterMs, retryable: false,
      });
      if (classification.kind !== 'retryable' && classification.kind !== 'malformed') throw error;
      if (localAttempt >= remainingAttempts) throw error;
      const delayMs = Math.min(MODEL_RETRY_DELAYS_MS.at(-1)!, Math.max(
        MODEL_RETRY_DELAYS_MS[Math.min(attempt - 1, MODEL_RETRY_DELAYS_MS.length - 1)],
        classification.retryAfterMs ?? 0,
      ));
      await options.onRetry?.({
        service,
        operation: operationLabel,
        attempt: attempt + 1,
        maxAttempts,
        delayMs,
        nextAttemptAt: new Date(now().getTime() + delayMs).toISOString(),
        errorCode: classification.code,
      });
      await (options.sleep ?? sleepWithCancellation)(delayMs, options.signal);
      continue;
    }

    await options.onAttempt?.({ attempt, outcome: 'success', durationMs: Date.now() - started, result });
    return result;
  }
  throw new ModelProviderError('AI provider exhausted eligible attempts', { code: 'retry_exhausted', retryable: true });
}

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
    // Crash recovery cannot infer whether reserved requests consumed provider
    // allowance. Preserve their budget and require an explicit linked retry.
    throw reviewProviderUnavailableError();
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
  let lastFailureMalformed = false;
  let lastFailureRetryable = false;
  let lastFailureMetadata: Parameters<typeof reviewProviderUnavailableError>[0] = {};

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
      const attemptNumber = attemptOffset + totalAttempts;
      const attemptRepair = request.repair || providerAttempt > 1 && lastClassification?.kind === 'malformed';
      const proposedUsageContext = options.usageContextForAttempt?.({
        ...request,
        signal: options.signal ?? request.signal,
        repair: attemptRepair,
      }, attemptNumber) ?? request.usageContext;
      const usageContext = sanitizeReviewRequestUsageContext(proposedUsageContext);
      const attemptRequest: StaticModelRequest = {
        ...request,
        signal: options.signal ?? request.signal,
        repair: attemptRepair,
        ...(usageContext ? { usageContext } : {}),
      };
      const reservation = makeAttemptRecord({
        ...options,
        ...providerContext,
        reviewId: options.reviewId,
        projectId: options.projectId,
        stage: options.stage,
        attempt: attemptNumber,
        outcome: 'in_progress',
        durationMs: 0,
        usageContext,
        now,
      });
      // Reservation persistence is outside the paid provider try block: if it
      // fails, no request is sent and no retry is attempted.
      await options.onAttemptStarted?.(reservation);
      const started = Date.now();
      let result: StaticModelResult;
      let observedUsage: StaticModelResult['usage'];
      let observedResponseReceived: boolean | undefined;
      try {
        result = await provider.analyze(attemptRequest);
        // Keep usage even if cancellation wins after the provider returned.
        // The call happened and its billable response was observed.
        observedUsage = result.usage;
        observedResponseReceived = true;
        // A provider is allowed to resolve after an abort (for example, a
        // custom SDK may not wire AbortSignal). Cancellation wins over that
        // late response so a cancelled Review can never become successful.
        if (options.signal?.aborted || request.signal?.aborted) throw new ReviewCancelledError();
      } catch (error) {
        const classification = classifyModelError(error, options.signal ?? request.signal);
        lastFailureMalformed = classification.kind === 'malformed';
        lastFailureRetryable = classification.kind === 'retryable';
        lastClassification = classification;
        const outcome: ModelAttemptOutcome = classification.kind === 'cancelled' ? 'cancelled'
          : classification.kind === 'malformed' ? 'malformed_response'
          : classification.kind === 'retryable' ? 'retryable_error' : 'permanent_error';
        const errorCode = classification.code;
        const codexFailure = error && typeof error === 'object' && (error as { code?: unknown }).code === 'codex_turn_failed';
        const errorMessageValue = providerPause(error)?.message
          ?? (codexFailure ? 'Codex turn failed; the cause is unconfirmed.' : safeErrorMessage(error));
        const statusCode = classification.statusCode;
        const retryAfterMs = classification.retryAfterMs;
        const providerError = error && typeof error === 'object'
          ? error as ModelProviderError & { usage?: StaticModelResult['usage']; responseReceived?: boolean; usageObservation?: TokenUsageObservation }
          : undefined;
        const usage = observedUsage ?? providerError?.usage;
        const responseReceived = observedResponseReceived ?? providerError?.responseReceived ?? (usage ? true : undefined);
        lastFailureMetadata = {
          statusCode, retryAfterMs, usage, responseReceived,
          usageObservation: providerError?.usageObservation ?? usage?.usageObservation,
        };
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
          usage,
          responseReceived,
          usageObservation: providerError?.usageObservation ?? usage?.usageObservation,
          ...(responseReceived === false && !usage
            ? { usageAccounting: { basis: 'assumed_zero_no_response' as const, accountedTokens: 0 as const } } : {}),
          usageContext,
          now,
        });
        attempts.push(record);
        // Persistence is intentionally outside the provider try block. An
        // audit/database failure must not be mistaken for a provider failure
        // and cause another paid request.
        await options.onAttempt?.(record);
        if (classification.kind === 'cancelled') throw new ReviewCancelledError(errorMessageValue);
        if (classification.kind === 'paused') {
          const pause = reviewProviderPause(error)!;
          throw new ModelProviderError(pause.message, {
            code: pause.code, statusCode, retryAfterMs, retryable: false,
          });
        }
        // A generic Codex turn failure has no trustworthy subtype. It can
        // follow an observed response while usage is still unknown, so do not
        // replay it. Pause this Review neutrally and retain the attempt row.
        if (classification.kind === 'permanent' && codexFailure) {
          throw reviewProviderUnavailableError(lastFailureMetadata);
        }
        if (classification.kind === 'permanent') throw error;
        const fallbackCanFollow = providerKind === 'primary' && !!options.fallback && fallbackReserveAttempts > 0
          && !(lastFailureMalformed && options.fallbackOnMalformed === false);
        const hasNextAttempt = totalAttempts < remainingAttempts && (providerAttempt < attemptLimit || fallbackCanFollow);
        if (!hasNextAttempt) break;
        const nominalDelayMs = MODEL_RETRY_DELAYS_MS[Math.min(totalAttempts - 1, MODEL_RETRY_DELAYS_MS.length - 1)];
        const delayMs = Math.min(MODEL_RETRY_DELAYS_MS.at(-1)!, Math.max(nominalDelayMs, retryAfterMs ?? 0));
        const nextAttempt: ExternalRetryScheduledEvent = {
          service: safeRetryLabel(providerContext.provider, 'model provider'),
          operation: safeRetryLabel(options.stage, 'model request'),
          attempt: attemptOffset + totalAttempts + 1,
          maxAttempts: maxTotalAttempts,
          delayMs,
          nextAttemptAt: new Date(now().getTime() + delayMs).toISOString(),
          errorCode,
        };
        await options.onRetry?.(nextAttempt);
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
        responseReceived: true,
        usageObservation: result.usage?.usageObservation,
        usageContext,
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
  if (!options.fallback || totalAttempts >= remainingAttempts || fallbackReserveAttempts === 0
    || lastFailureMalformed && options.fallbackOnMalformed === false) {
    if (lastFailureRetryable) throw reviewProviderUnavailableError(lastFailureMetadata);
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
  if (lastFailureRetryable) throw reviewProviderUnavailableError(lastFailureMetadata);
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
  responseReceived?: boolean;
  usageObservation?: ModelAttemptRecord['usageObservation'];
  usageAccounting?: ModelAttemptRecord['usageAccounting'];
  usage?: StaticModelResult['usage'];
  usageContext?: StaticModelRequest['usageContext'];
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
    responseReceived: input.responseReceived,
    usageObservation: input.usageObservation,
    usageAccounting: input.usageAccounting,
    usage: input.usage,
    usageContext: input.usageContext,
    createdAt: input.now().toISOString(),
  };
}
