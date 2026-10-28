import crypto from 'node:crypto';
import type { TokenUsage, TokenUsageObservation, UsageAccounting } from '../aiClient.js';
import type { ModelAttemptRecord, ReviewAuditEvent } from './types.js';
import { sanitizeReviewRequestUsageContext } from './usageContext.js';

/** Fields safe to persist or expose to usage/reporting consumers. This
 * intentionally has no prompt, response, API key, Authorization header, or
 * provider SDK payload. */
export type ModelUsageRecord = {
  id?: string;
  reviewId: string;
  projectId: string;
  stage: string;
  attempt: number;
  provider: string;
  apiFormat: string;
  model: string;
  outcome: ModelAttemptRecord['outcome'];
  durationMs: number;
  statusCode?: number;
  retryAfterMs?: number;
  errorCode?: string;
  responseReceived?: boolean;
  usageObservation?: TokenUsageObservation;
  usageAccounting?: UsageAccounting;
  usageContext?: ModelAttemptRecord['usageContext'];
  usage?: TokenUsage;
  createdAt: string;
};

export type ModelUsageAuditSink = {
  recordAttempt(record: ModelUsageRecord): Promise<void>;
  recordAudit?(event: ReviewAuditEvent): Promise<void>;
};

export type ModelUsageTotals = {
  calls: number;
  successfulCalls: number;
  failedCalls: number;
  cancelledCalls: number;
  inProgressCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  accountedTokens: number;
  assumedZeroNoResponseCalls: number;
  assumedZeroNoResponseTokens: number;
  unknownInputCalls: number;
  unknownOutputCalls: number;
  unknownCacheReadCalls: number;
  unknownCacheCreationCalls: number;
  unknownTotalCalls: number;
  providerReportedTotalTokens: number;
  providerReportedCalls: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

function nonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  const number = Number(value);
  return value == null || !Number.isFinite(number) || number < 0 ? undefined : Math.floor(number);
}

function usageCopy(usage: TokenUsage | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = optionalNonNegativeInteger(usage.inputTokens);
  const outputTokens = optionalNonNegativeInteger(usage.outputTokens);
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(optionalNonNegativeInteger(usage.providerReportedTotalTokens) === undefined ? {} : { providerReportedTotalTokens: optionalNonNegativeInteger(usage.providerReportedTotalTokens) }),
    ...(usage.totalTokensSource === 'provider_reported' || usage.totalTokensSource === 'adapter_derived'
      ? { totalTokensSource: usage.totalTokensSource } : {}),
    ...(optionalNonNegativeInteger(usage.totalTokens) === undefined ? {} : { totalTokens: optionalNonNegativeInteger(usage.totalTokens) }),
    ...(usage.cacheReadTokens == null ? {} : { cacheReadTokens: nonNegativeInteger(usage.cacheReadTokens) }),
    ...(usage.cacheCreationTokens == null ? {} : { cacheCreationTokens: nonNegativeInteger(usage.cacheCreationTokens) }),
    ...(usage.usageObservation ? { usageObservation: safeUsageObservation(usage.usageObservation) } : {}),
  };
}

const SAFE_USAGE_SOURCES = new Set<TokenUsageObservation['source']>([
  'provider_response', 'provider_error_response', 'codex_thread_total', 'codex_turn_last',
]);
const SAFE_USAGE_COUNTERS = new Set(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'totalTokens']);

function safeUsageObservation(value: unknown): TokenUsageObservation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const observation = value as Record<string, unknown>;
  if (!SAFE_USAGE_SOURCES.has(observation.source as TokenUsageObservation['source'])
    || observation.completeness !== 'complete' && observation.completeness !== 'partial') return undefined;
  const missingCounters = Array.isArray(observation.missingCounters)
    ? [...new Set(observation.missingCounters.filter((counter): counter is NonNullable<TokenUsageObservation['missingCounters']>[number] =>
      typeof counter === 'string' && SAFE_USAGE_COUNTERS.has(counter)))] : [];
  return { source: observation.source as TokenUsageObservation['source'], completeness: observation.completeness,
    ...(missingCounters.length ? { missingCounters } : {}) };
}

function safeUsageAccounting(value: unknown, record: Pick<ModelAttemptRecord | ModelUsageRecord, 'outcome' | 'responseReceived' | 'usage' | 'usageObservation'>): UsageAccounting | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const accounting = value as Record<string, unknown>;
  const usageObservation = record.usageObservation ?? (record.usage as TokenUsage | undefined)?.usageObservation;
  const hasObservedUsage = Boolean(record.usage || usageObservation);
  const terminalError = record.outcome === 'retryable_error' || record.outcome === 'permanent_error'
    || record.outcome === 'malformed_response' || record.outcome === 'cancelled';
  return terminalError && record.responseReceived === false && !hasObservedUsage
    && accounting.basis === 'assumed_zero_no_response' && accounting.accountedTokens === 0
    ? { basis: 'assumed_zero_no_response', accountedTokens: 0 } : undefined;
}

/** Strip optional error text to a bounded, non-secret audit value. Provider
 * errors can echo request fragments, so only keep a short normalized message
 * when the caller explicitly maps it to an errorCode. */
function safeErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.trim().slice(0, 128).replace(/[\r\n\t]+/g, ' ');
}

function stableAttemptId(attempt: ModelAttemptRecord): string {
  const digest = crypto.createHash('sha256')
    .update(`${attempt.reviewId}\u0000${attempt.stage}\u0000${attempt.attempt}`)
    .digest('hex');
  // PostgreSQL's uuid column accepts this deterministic UUID-shaped value.
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

export function toModelUsageRecord(attempt: ModelAttemptRecord): ModelUsageRecord {
  return {
    id: attempt.id ?? stableAttemptId(attempt),
    reviewId: attempt.reviewId,
    projectId: attempt.projectId,
    stage: attempt.stage,
    attempt: Math.max(1, Math.floor(attempt.attempt)),
    provider: attempt.provider,
    apiFormat: attempt.apiFormat,
    model: attempt.model,
    outcome: attempt.outcome,
    durationMs: Math.max(0, Math.floor(attempt.durationMs)),
    ...(attempt.statusCode == null ? {} : { statusCode: attempt.statusCode }),
    ...(attempt.retryAfterMs == null ? {} : { retryAfterMs: Math.max(0, Math.floor(attempt.retryAfterMs)) }),
    ...(safeErrorCode(attempt.errorCode) ? { errorCode: safeErrorCode(attempt.errorCode) } : {}),
    ...(typeof attempt.responseReceived === 'boolean' ? { responseReceived: attempt.responseReceived } : {}),
    ...(safeUsageObservation(attempt.usageObservation ?? attempt.usage?.usageObservation)
      ? { usageObservation: safeUsageObservation(attempt.usageObservation ?? attempt.usage?.usageObservation) } : {}),
    ...(safeUsageAccounting(attempt.usageAccounting, attempt)
      ? { usageAccounting: safeUsageAccounting(attempt.usageAccounting, attempt) } : {}),
    ...(sanitizeReviewRequestUsageContext(attempt.usageContext) ? { usageContext: sanitizeReviewRequestUsageContext(attempt.usageContext) } : {}),
    usage: usageCopy(attempt.usage),
    createdAt: attempt.createdAt,
  };
}

/**
 * Make attempt persistence idempotent for retries of a lost acknowledgement.
 * The key is review + stage + attempt; a provider call is counted exactly once
 * even if a route/runtime retries its audit write. The sink remains injectable
 * so the same contract can target Supabase or an in-memory repository.
 */
export function createModelUsageAuditRecorder(
  sink: ModelUsageAuditSink,
  options: { now?: () => Date; onAudit?: (event: ReviewAuditEvent) => void | Promise<void> } = {},
): (attempt: ModelAttemptRecord) => Promise<void> {
  const seen = new Set<string>();
  const now = options.now ?? (() => new Date());
  return async (attempt) => {
    const record = toModelUsageRecord(attempt);
    const key = `${record.reviewId}:${record.stage}:${record.attempt}`;
    if (seen.has(key)) return;
    await sink.recordAttempt(record);
    const event: ReviewAuditEvent = {
      reviewId: record.reviewId,
      projectId: record.projectId,
      event: 'model_attempt_recorded',
      stage: record.stage,
      detail: {
        attempt: record.attempt,
        provider: record.provider,
        model: record.model,
        outcome: record.outcome,
        durationMs: record.durationMs,
        statusCode: record.statusCode ?? null,
        errorCode: record.errorCode ?? null,
        responseReceived: record.responseReceived ?? null,
        usageObservation: record.usageObservation ?? null,
        usageAccounting: record.usageAccounting ?? null,
        inputTokens: record.usage?.inputTokens ?? null,
        outputTokens: record.usage?.outputTokens ?? null,
        logicalPhase: record.usageContext?.phase ?? null,
        sourceReferenceCount: record.usageContext?.sources?.length ?? null,
        estimatedInputTokens: record.usageContext?.estimation?.inputTokens ?? null,
      },
      createdAt: now().toISOString(),
    };
    await sink.recordAudit?.(event);
    await options.onAudit?.(event);
    seen.add(key);
  };
}

export function summarizeModelUsage(records: Iterable<ModelAttemptRecord | ModelUsageRecord>): ModelUsageTotals {
  const totals: ModelUsageTotals = {
    calls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    cancelledCalls: 0,
    inProgressCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    accountedTokens: 0,
    assumedZeroNoResponseCalls: 0,
    assumedZeroNoResponseTokens: 0,
    unknownInputCalls: 0,
    unknownOutputCalls: 0,
    unknownCacheReadCalls: 0,
    unknownCacheCreationCalls: 0,
    unknownTotalCalls: 0,
    providerReportedTotalTokens: 0,
    providerReportedCalls: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  for (const record of records) {
    totals.calls++;
    if (record.outcome === 'success') totals.successfulCalls++;
    else if (record.outcome === 'cancelled') totals.cancelledCalls++;
    else if (record.outcome === 'in_progress') totals.inProgressCalls++;
    else totals.failedCalls++;
    const inputTokens = optionalNonNegativeInteger(record.usage?.inputTokens);
    const outputTokens = optionalNonNegativeInteger(record.usage?.outputTokens);
    const cacheReadTokens = optionalNonNegativeInteger(record.usage?.cacheReadTokens);
    const cacheCreationTokens = optionalNonNegativeInteger(record.usage?.cacheCreationTokens);
    const totalTokens = optionalNonNegativeInteger(record.usage?.providerReportedTotalTokens) ?? optionalNonNegativeInteger(record.usage?.totalTokens);
    if (inputTokens === undefined) totals.unknownInputCalls++; else totals.inputTokens += inputTokens;
    if (outputTokens === undefined) totals.unknownOutputCalls++; else totals.outputTokens += outputTokens;
    if (cacheReadTokens === undefined) totals.unknownCacheReadCalls++; else totals.cacheReadTokens += cacheReadTokens;
    if (cacheCreationTokens === undefined) totals.unknownCacheCreationCalls++; else totals.cacheCreationTokens += cacheCreationTokens;
    if (totalTokens === undefined) totals.unknownTotalCalls++; else totals.totalTokens += totalTokens;
    const providerReportedTotal = optionalNonNegativeInteger(record.usage?.providerReportedTotalTokens);
    if (providerReportedTotal === undefined) { /* no provider total was recorded */ }
    else { totals.providerReportedTotalTokens += providerReportedTotal; totals.providerReportedCalls++; }
    if (safeUsageAccounting(record.usageAccounting, record)) {
      totals.assumedZeroNoResponseCalls++;
      totals.assumedZeroNoResponseTokens += 0;
      totals.accountedTokens += 0;
    } else if (totalTokens !== undefined) totals.accountedTokens += totalTokens;
  }
  return totals;
}

/** A small Supabase sink used by request-scoped repositories. It writes only
 * the safe usage/audit columns and intentionally never serializes a provider
 * response or a secret. */
export class SupabaseModelUsageAuditSink implements ModelUsageAuditSink {
  constructor(private readonly client: {
    from(table: string): any;
  }) {}

  async recordAttempt(record: ModelUsageRecord): Promise<void> {
    const usage = record.usage;
    const result = await this.client.from('model_usage_records').upsert({
      ...(record.id ? { id: record.id } : {}),
      project_id: record.projectId,
      review_session_id: record.reviewId,
      stage: record.stage,
      attempt: record.attempt,
      provider: record.provider,
      model: record.model,
      outcome: record.outcome,
      input_tokens: usage?.inputTokens ?? null,
      output_tokens: usage?.outputTokens ?? null,
      cache_read_tokens: usage?.cacheReadTokens ?? null,
      cache_creation_tokens: usage?.cacheCreationTokens ?? null,
      duration_ms: record.durationMs,
      error_code: record.errorCode ?? null,
      metadata: {
        apiFormat: record.apiFormat,
        statusCode: record.statusCode ?? null,
        retryAfterMs: record.retryAfterMs ?? null,
        providerReportedTotalTokens: usage?.providerReportedTotalTokens ?? null,
        normalizedTotalTokens: usage?.totalTokens ?? null,
        normalizedTotalTokensSource: usage?.totalTokensSource ?? null,
        responseReceived: record.responseReceived ?? null,
        usageObservation: record.usageObservation ?? null,
        usageAccounting: record.usageAccounting ?? null,
        usageContext: record.usageContext ?? null,
      },
      created_at: record.createdAt,
    }, { onConflict: 'id' });
    if (result?.error) throw new Error(`Supabase model usage save failed: ${result.error.message ?? 'unknown error'}`);
  }

  async recordAudit(event: ReviewAuditEvent): Promise<void> {
    const result = await this.client.from('audit_events').insert({
      ...(event.id ? { id: event.id } : {}),
      project_id: event.projectId,
      event_type: event.event,
      entity_type: 'review',
      entity_id: event.reviewId,
      payload: { stage: event.stage ?? null, detail: event.detail ?? {} },
      created_at: event.createdAt,
    });
    if (result?.error) throw new Error(`Supabase model audit save failed: ${result.error.message ?? 'unknown error'}`);
  }
}
