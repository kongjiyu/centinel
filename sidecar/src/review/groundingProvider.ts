import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseCentinelStore } from '../store/index.js';
import { resolveModelProviderChain, SupabaseModelConfigurationRepository } from './modelProviderResolver.js';
import { runModelOperation } from './retry.js';
import type { RequirementCandidateModel } from './grounding.js';
import { toModelUsageRecord } from './usageAudit.js';
import type { ModelAttemptRecord } from './types.js';

/** Requirement extraction is a static-analysis operation, even though it runs
 * before a Review session exists. Use the shared five-request AI budget and
 * persist each reserved attempt without inventing a Review foreign key. */
export function createGroundingModelProvider(client: SupabaseClient, ownerId: string): RequirementCandidateModel {
  const configurations = new SupabaseModelConfigurationRepository(client);
  const store = new SupabaseCentinelStore(client);
  return {
    analyze: async request => {
      const chain = await resolveModelProviderChain(configurations, {
        ownerId,
        projectId: request.projectId,
        purpose: 'static_review',
      });
      const operation = await runModelOperation(request, chain.primaryProvider, {
        reviewId: request.reviewId,
        projectId: request.projectId,
        stage: request.stage,
        ...chain.primaryMetadata,
        fallback: chain.fallbackProvider ?? undefined,
        fallbackContext: chain.fallbackMetadata ?? undefined,
        signal: request.signal,
        onAttemptStarted: attempt => saveGroundingAttempt(store, attempt, ownerId, request.projectId),
        onAttempt: attempt => saveGroundingAttempt(store, attempt, ownerId, request.projectId),
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
