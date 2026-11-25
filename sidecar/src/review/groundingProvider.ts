import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseCentinelStore } from '../store/index.js';
import { resolveModelProviderChain, SupabaseModelConfigurationRepository, type ResolvedModelProviderChain } from './modelProviderResolver.js';
import { runModelOperation } from './retry.js';
import type { RequirementCandidateModel } from './grounding.js';
import { toModelUsageRecord } from './usageAudit.js';
import type { ModelAttemptRecord } from './types.js';

/** Requirement extraction is a static-analysis operation, even though it runs
 * before a Review session exists. Use the shared five-request AI budget and
 * persist each reserved attempt without inventing a Review foreign key. */
export function createGroundingModelProvider(client: SupabaseClient | (() => SupabaseClient), ownerId: string): RequirementCandidateModel {
  const currentClient = typeof client === 'function' ? client : () => client;
  return runGroundingWithProvider(
    projectId => resolveModelProviderChain(new SupabaseModelConfigurationRepository(currentClient()), { ownerId, projectId, purpose: 'static_review' }),
    attempt => saveGroundingAttempt(new SupabaseCentinelStore(currentClient()), attempt, ownerId, attempt.projectId),
  );
}

export function runGroundingWithProvider(resolve: (projectId: string, signal?: AbortSignal) => Promise<Pick<ResolvedModelProviderChain,
  'primaryProvider' | 'primaryMetadata' | 'fallbackProvider' | 'fallbackMetadata'>>,
  persist: (attempt: ModelAttemptRecord) => Promise<void>): RequirementCandidateModel {
  return {
    analyze: async request => {
      const chain = await resolve(request.projectId, request.signal);
      const operation = await runModelOperation(request, chain.primaryProvider, {
        reviewId: request.reviewId,
        projectId: request.projectId,
        stage: request.stage,
        ...chain.primaryMetadata,
        fallback: chain.fallbackProvider ?? undefined,
        fallbackContext: chain.fallbackMetadata ?? undefined,
        signal: request.signal,
        onAttemptStarted: persist,
        onAttempt: persist,
      });
      return operation.result;
    },
  };
}

function saveGroundingAttempt(store: SupabaseCentinelStore, attempt: ModelAttemptRecord, ownerId: string, projectId: string) {
  return store.saveModelUsage({
    id: toModelUsageRecord(attempt).id,
    projectId,
    reviewSessionId: null,
    ownerId,
    stage: attempt.stage,
    attempt: attempt.attempt,
    provider: String(attempt.provider),
    model: attempt.model,
    outcome: attempt.outcome,
    inputTokens: attempt.usage?.inputTokens ?? null,
    outputTokens: attempt.usage?.outputTokens ?? null,
    cacheReadTokens: attempt.usage?.cacheReadTokens ?? null,
    cacheCreationTokens: attempt.usage?.cacheCreationTokens ?? null,
    durationMs: attempt.durationMs,
    errorCode: attempt.errorCode ?? null,
    cost: null,
    metadata: {
      apiFormat: attempt.apiFormat,
      callKind: 'review',
      scope: 'text',
      operation: attempt.stage === 'project_readiness_assessment' ? 'project-readiness' : 'requirement-extraction',
      statusCode: attempt.statusCode ?? null,
    },
  }).then(() => undefined);
}
