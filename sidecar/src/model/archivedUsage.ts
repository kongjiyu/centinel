import type { StoreModelUsage } from '../store/types.js';
import { toModelUsageRecord } from '../review/usageAudit.js';
import type { ModelAttemptRecord } from '../review/types.js';

type Row = Record<string, unknown>;
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const counter = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const label = (value: unknown) => typeof value === 'string' && value.length <= 256 && /^[^\x00-\x1f\x7f]+$/.test(value) ? value : null;
const stableId = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

/** Select only the provenance and counters used by the accounting projection. */
export function portableUsage(input: StoreModelUsage): StoreModelUsage {
  if (!input || !stableId(input.id) || !stableId(input.ownerId) || input.projectId !== null && !stableId(input.projectId)
    || input.reviewSessionId !== null && (!input.projectId || !stableId(input.reviewSessionId))
    || !label(input.stage) || !label(input.provider) || !label(input.model) || !Number.isSafeInteger(input.attempt) || input.attempt < 1
    || typeof input.createdAt !== 'string' || !Number.isFinite(Date.parse(input.createdAt))) {
    throw new Error('A saved model usage record has invalid accounting scope or identity.');
  }
  const meta = record(input.metadata);
  const outcome = input.outcome === 'transient_error' ? 'retryable_error' : input.outcome;
  const supported = ['in_progress', 'success', 'retryable_error', 'permanent_error', 'malformed_response', 'cancelled'];
  const normalizedOutcome = supported.includes(outcome) ? outcome : 'unknown';
  const safe = toModelUsageRecord({
    id: input.id, reviewId: input.reviewSessionId ?? '', projectId: input.projectId ?? '',
    stage: input.stage, attempt: input.attempt, provider: input.provider, model: input.model, apiFormat: label(meta.apiFormat) ?? 'unknown',
    createdAt: input.createdAt, outcome: normalizedOutcome as ModelAttemptRecord['outcome'], durationMs: input.durationMs ?? 0,
    responseReceived: typeof meta.responseReceived === 'boolean' ? meta.responseReceived : undefined,
    usageObservation: meta.usageObservation as ModelAttemptRecord['usageObservation'],
    usageAccounting: meta.usageAccounting as ModelAttemptRecord['usageAccounting'],
    usageContext: meta.usageContext as ModelAttemptRecord['usageContext'],
    usage: {
      inputTokens: counter(input.inputTokens) ?? undefined, outputTokens: counter(input.outputTokens) ?? undefined,
      cacheReadTokens: counter(input.cacheReadTokens) ?? undefined, cacheCreationTokens: counter(input.cacheCreationTokens) ?? undefined,
      providerReportedTotalTokens: counter(meta.providerReportedTotalTokens) ?? undefined,
      totalTokens: counter(meta.normalizedTotalTokens) ?? undefined,
      totalTokensSource: meta.normalizedTotalTokensSource === 'provider_reported' || meta.normalizedTotalTokensSource === 'adapter_derived'
        ? meta.normalizedTotalTokensSource : undefined,
    },
  });
  return {
    id: input.id, ownerId: input.ownerId, projectId: input.projectId, reviewSessionId: input.reviewSessionId,
    stage: input.stage, provider: input.provider, model: input.model, outcome: normalizedOutcome, attempt: input.attempt,
    inputTokens: safe.usage?.inputTokens ?? null, outputTokens: safe.usage?.outputTokens ?? null,
    cacheReadTokens: safe.usage?.cacheReadTokens ?? null, cacheCreationTokens: safe.usage?.cacheCreationTokens ?? null,
    durationMs: counter(input.durationMs), errorCode: /^[a-z\d_]{1,80}$/.test(input.errorCode ?? '') ? input.errorCode : null,
    cost: counter(input.cost), createdAt: input.createdAt,
    metadata: {
      apiFormat: safe.apiFormat, scope: meta.scope === 'embedding' || meta.scope === 'vision' ? meta.scope : 'text',
      callKind: meta.callKind === 'test' || meta.callKind === 'dynamic' ? meta.callKind : 'review',
      ...(stableId(meta.dynamicSessionId) ? { dynamicSessionId: meta.dynamicSessionId } : {}),
      ...(meta.indexTrigger === 'review' || meta.indexTrigger === 'source_changed' ? { indexTrigger: meta.indexTrigger } : {}),
      ...(typeof meta.indexFingerprint === 'string' && /^[a-f\d]{64}$/.test(meta.indexFingerprint) ? { indexFingerprint: meta.indexFingerprint } : {}),
      statusCode: counter(meta.statusCode), responseReceived: safe.responseReceived, usageObservation: safe.usageObservation,
      usageAccounting: safe.usageAccounting, usageContext: safe.usageContext,
      providerReportedTotalTokens: safe.usage?.providerReportedTotalTokens,
      normalizedTotalTokens: safe.usage?.totalTokens, normalizedTotalTokensSource: safe.usage?.totalTokensSource,
    },
  };
}
