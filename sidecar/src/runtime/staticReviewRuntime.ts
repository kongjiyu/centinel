import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseConnectedEvidenceStateResolver } from '../integrations/evidenceState.js';
import type { Artifact } from '../artifacts.js';
import type { StaticReviewOrchestratorDependencies } from '../review/orchestrator.js';
import { SupabaseStaticReviewRepository } from '../review/supabaseRepository.js';
import type { GroundingRepository } from '../review/grounding.js';
import { resolveModelProviderChain, SupabaseModelConfigurationRepository } from '../review/modelProviderResolver.js';
import {
  ReviewLeaseCoordinator,
  SupabaseReviewLeaseRepository,
  recoverExpiredReviews,
  type ReviewLeaseOptions,
  type ReviewLeaseRepository,
  type ReviewRecoveryOptions,
} from '../review/lease.js';
import type { StaticReviewRepository } from '../review/types.js';
import { RefreshableSupabaseRuntime } from './supabaseRuntime.js';

const REVIEW_REPOSITORY_METHODS = new Set([
  'createReview', 'getReview', 'transitionReview', 'findOperation', 'saveOperation',
  'findReviewByIdempotencyKey', 'createRetryReview', 'saveSourceManifest',
  'loadSourceManifestArtifacts', 'saveTraceabilitySnapshot', 'getLatestDecision',
  'getTraceabilityReadiness', 'saveReviewIteration', 'saveEvidenceSufficiency',
  'getEvidenceSufficiency', 'listContradictionDispositions', 'saveFindingCorrelations', 'getFindingCorrelationSnapshot',
  'listReviewFindings', 'saveFinding', 'updateProgress', 'recordModelAttempt', 'getModelAttemptCount', 'recordAudit',
  'saveRequirementCandidates', 'listRequirementCandidates', 'confirmRequirementCandidate',
  'rejectRequirementCandidate', 'saveStandardRules', 'listStandardRules',
  'setStandardRuleEnabled', 'listConfirmedRequirements',
]);

const LEASE_REPOSITORY_METHODS = new Set([
  'acquireLease', 'renewLease', 'releaseLease', 'listExpiredLeases', 'saveCheckpoint', 'getCheckpoint',
]);

/**
 * Build an adapter whose individual database operations always use the
 * runtime's current bearer-bound Supabase client. This keeps a long-running
 * Review from retaining the client that happened to exist at Start time.
 */
function refreshableAdapter<T extends object>(
  runtime: RefreshableSupabaseRuntime,
  create: (client: SupabaseClient) => object,
  methodNames: Set<string>,
): T {
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'then' || typeof property !== 'string' || !methodNames.has(property)) return undefined;
      return (...args: unknown[]) => runtime.withClient(async client => {
        const adapter = create(client) as Record<string, unknown>;
        const method = adapter[property];
        if (typeof method !== 'function') throw new Error(`The authenticated Supabase adapter does not implement ${property}.`);
        return method.apply(adapter, args);
      });
    },
  }) as T;
}

export type RefreshableStaticReviewRuntimeOptions = {
  workerId?: string;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  maxRecoveryAttempts?: number;
  staleEvidenceAfterMs?: number;
  now?: () => Date;
  fetchImpl?: typeof fetch;
};

export type RefreshableStaticReviewRuntime = {
  repository: StaticReviewRepository & GroundingRepository;
  leaseCoordinator: ReviewLeaseCoordinator;
  /** Dependencies ready to spread into createStaticReviewOrchestrator(). */
  dependencies: Pick<StaticReviewOrchestratorDependencies,
    'repository' | 'groundingRepository' | 'leaseCoordinator' | 'modelProviderResolver' | 'evidenceSourceState'>;
  /** Run on an authenticated Review request after token refresh and before
   * starting work. Reconciliation remains scoped to this runtime's RLS user. */
  recoverExpiredReviews(options?: ReviewRecoveryOptions): ReturnType<typeof recoverExpiredReviews>;
};

/**
 * Compose request-scoped Supabase adapters for static Review execution. The
 * runtime must be updated with each verified access-token refresh via
 * replaceAccessToken(); all repository calls then follow the newest client.
 */
export function createRefreshableStaticReviewRuntime(
  runtime: RefreshableSupabaseRuntime,
  options: RefreshableStaticReviewRuntimeOptions = {},
): RefreshableStaticReviewRuntime {
  const repository = refreshableAdapter<StaticReviewRepository & GroundingRepository>(
    runtime,
    client => new SupabaseStaticReviewRepository(client, runtime.state().userId),
    REVIEW_REPOSITORY_METHODS,
  );
  const leaseRepository = refreshableAdapter<ReviewLeaseRepository>(
    runtime,
    client => new SupabaseReviewLeaseRepository(client),
    LEASE_REPOSITORY_METHODS,
  );
  const leaseOptions: ReviewLeaseOptions = {
    workerId: options.workerId?.trim() || `review-worker-${crypto.randomUUID()}`,
    leaseDurationMs: options.leaseDurationMs,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    now: options.now,
  };
  const leaseCoordinator = new ReviewLeaseCoordinator(leaseRepository, leaseOptions);
  const dependencies: RefreshableStaticReviewRuntime['dependencies'] = {
    repository,
    groundingRepository: repository,
    leaseCoordinator,
    modelProviderResolver: async (review, signal) => runtime.withClient(async client => resolveModelProviderChain(
      new SupabaseModelConfigurationRepository(client),
      { ownerId: runtime.state().userId, projectId: review.projectId, purpose: 'static_review' },
      { fetchImpl: options.fetchImpl, signal },
    )),
    evidenceSourceState: async (artifact: Artifact, signal?: AbortSignal) => runtime.withClient(async client =>
      new SupabaseConnectedEvidenceStateResolver(client, {
        ...(options.now ? { now: () => options.now!().getTime() } : {}),
        staleAfterMs: options.staleEvidenceAfterMs,
      }).resolve(artifact, signal)),
  };

  return {
    repository,
    leaseCoordinator,
    dependencies,
    recoverExpiredReviews: recoveryOptions => recoverExpiredReviews(leaseRepository, repository, {
      maxAttempts: options.maxRecoveryAttempts,
      now: options.now,
      ...recoveryOptions,
    }),
  };
}
