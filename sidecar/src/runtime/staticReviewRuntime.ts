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

/**
 * Every Review/grounding repository method the production proxy forwards.
 * Typed as an exhaustive record so adding a method to StaticReviewRepository
 * or GroundingRepository without forwarding it is a compile error: an
 * unlisted method reads as `undefined` through the proxy, and the
 * orchestrator silently skips optional work such as requirement-link
 * suggestions or same-Review recovery reuse.
 */
const REVIEW_REPOSITORY_METHOD_FLAGS: Record<keyof StaticReviewRepository | keyof GroundingRepository, true> = {
  createReview: true, getReview: true, listReviews: true, transitionReview: true, findOperation: true, saveOperation: true,
  findReviewByIdempotencyKey: true, createRetryReview: true, saveSourceManifest: true,
  loadSourceManifestArtifacts: true, captureTraceabilitySnapshot: true, getTraceabilitySnapshot: true, saveTraceabilitySnapshot: true,
  getLatestDecision: true, getTraceabilityReadiness: true, saveReviewIteration: true, saveEvidenceSufficiency: true,
  appendEvidenceSufficiency: true, getEvidenceSufficiency: true, listContradictionDispositions: true, saveFindingCorrelations: true,
  getFindingCorrelationSnapshot: true, listReviewFindings: true, getBatchCacheBasis: true, getRecoveryJournal: true,
  saveRequirementLinkSuggestions: true, saveFinding: true, updateProgress: true, recordModelAttempt: true, getModelAttemptCount: true,
  recordAudit: true, recordAudits: true,
  saveRequirementCandidates: true, listRequirementCandidates: true, confirmRequirementCandidate: true,
  rejectRequirementCandidate: true, saveStandardRules: true, listStandardRules: true,
  setStandardRuleEnabled: true, listConfirmedRequirements: true,
};
const REVIEW_REPOSITORY_METHODS = new Set(Object.keys(REVIEW_REPOSITORY_METHOD_FLAGS));

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
  implementation?: object,
): T {
  // Optional methods are feature-detected with `typeof === 'function'`, so
  // only advertise a method the adapter class really implements.
  const implemented = (name: string) => !implementation || typeof (implementation as Record<string, unknown>)[name] === 'function';
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'then' || typeof property !== 'string' || !methodNames.has(property) || !implemented(property)) return undefined;
      return (...args: unknown[]) => runtime.withClient(async client => {
        const adapter = create(client) as Record<string, unknown>;
        const method = adapter[property];
        if (typeof method !== 'function') throw new Error(`The authenticated Supabase adapter does not implement ${property}.`);
        return method.apply(adapter, args);
      });
    },
  }) as T;
}

/**
 * The Review repository exactly as production Reviews see it: every call is
 * forwarded through REVIEW_REPOSITORY_METHODS to an adapter built from the
 * runtime's current client. `implementation` is the adapter class prototype
 * used for feature detection. Exported so tests can exercise the same
 * forwarding rule with an in-memory adapter.
 */
export function createRefreshableReviewRepository<T extends object = StaticReviewRepository & GroundingRepository>(
  runtime: RefreshableSupabaseRuntime,
  create: (client: SupabaseClient) => object,
  implementation: object,
): T {
  return refreshableAdapter<T>(runtime, create, REVIEW_REPOSITORY_METHODS, implementation);
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
  const repository = createRefreshableReviewRepository(
    runtime,
    client => new SupabaseStaticReviewRepository(client, runtime.state().userId),
    SupabaseStaticReviewRepository.prototype,
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
