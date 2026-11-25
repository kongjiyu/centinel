import { randomUUID } from 'node:crypto';
import { runStaticAnalysis } from '../staticEngine.js';
import type { LocalWorkspace } from '../store/localWorkspace.js';
import { ReviewLeaseCoordinator, recoverExpiredReviews } from './lease.js';
import { resolveModelProviderChain } from './modelProviderResolver.js';
import { createStaticReviewOrchestrator } from './orchestrator.js';
import { ReviewRecoveryRecheck } from './recoveryRecheck.js';
import type { StaticAnalysisModelProvider, StaticReviewStartResult } from './types.js';
import { isAssessmentHeld } from './assessmentHold.js';
import { retrieveFrozenContext } from './localRepositoryIndex.js';
import { localWorkspaceEncryptionAvailable } from '../tokenVault.js';

export class LocalReviewRuntime {
  readonly orchestrator;
  private readonly recovery;
  private readonly running = new Set<Promise<unknown>>();
  private closing = false;

  constructor(workspace: LocalWorkspace, owner: string,
    index: NonNullable<Parameters<typeof createStaticReviewOrchestrator>[0]['index']>, fixtureProvider?: StaticAnalysisModelProvider) {
    const repository = workspace.reviews(owner);
    const leases = workspace.reviewLeases(owner);
    const configurations = workspace.modelConfigurations(owner);
    const load = (project: string) => workspace.requirements(owner, project);
    this.orchestrator = createStaticReviewOrchestrator({
      repository,
      ...(localWorkspaceEncryptionAvailable() ? { batchCache: workspace.reviewBatchCache(owner), cacheOwnerId: owner } : {}),
      leaseCoordinator: new ReviewLeaseCoordinator(leases, { workerId: randomUUID() }),
      artifacts: async (project, signal) => {
        signal?.throwIfAborted();
        return workspace.artifacts(owner, project);
      },
      readArtifactBytes: async (artifact, signal) => {
        signal?.throwIfAborted();
        if (!artifact.versionId) throw new Error('The Review source has no frozen version.');
        const saved = workspace.sourceBytes(owner, artifact.projectId, artifact.id, artifact.versionId);
        if (!saved || saved.contentHash !== artifact.contentHash) throw new Error('The frozen Review source is unavailable.');
        return saved.content;
      },
      index,
      context: (project, _type, maxTokens, signal, artifacts, review, query, reader) =>
        retrieveFrozenContext({ workspace }, owner, project, artifacts ?? [], maxTokens, signal, review, query, reader),
      deterministic: async (project, artifacts, review, signal, harness, contentReader) => {
        if (!contentReader) throw new Error('Verified local source reader is unavailable.');
        return { findings: await runStaticAnalysis(project, artifacts, review, { signal, harness, contentReader }), persisted: false };
      },
      groundingRepository: {
        listConfirmedRequirements: async (project, ids, signal) => {
          signal?.throwIfAborted();
          return load(project).confirmed().filter(item => !ids?.length || ids.includes(item.id));
        },
        listRequirementCandidates: async (project, status, signal) => {
          signal?.throwIfAborted();
          return load(project).candidates().filter(item => !status || item.status === status);
        },
        listStandardRules: async (project, ids, signal) => {
          signal?.throwIfAborted();
          return load(project).rules().filter(item => !ids?.length || ids.includes(item.standardId) || ids.includes(item.sourceArtifactId));
        },
      },
      ...(fixtureProvider ? { modelProvider: fixtureProvider } : {
        modelProviderResolver: (review, signal) => resolveModelProviderChain(configurations,
          { ownerId: owner, projectId: review.projectId }, { signal }),
      }),
      allowDeterministicOnly: false,
    });
    this.recovery = new ReviewRecoveryRecheck(async () => {
      const recovered = await recoverExpiredReviews(leases, repository, { admit: lease => !isAssessmentHeld(lease.projectId) });
      for (const reviewId of recovered.requeued) {
        if (this.closing) break;
        this.track(await this.orchestrator.resumeQueuedReview(reviewId));
      }
    });
  }

  initialize() { return this.recovery.start(); }
  async ready() { await this.recovery.initial; this.recovery.maybeRecheck(); }

  track(result: StaticReviewStartResult) {
    const completion = result.completion;
    this.running.add(completion);
    void completion.then(() => this.running.delete(completion), () => {
      this.running.delete(completion);
      console.error('[local-review] The Review worker failed to finish.');
    });
    return result;
  }

  async close() {
    this.closing = true;
    await this.recovery.pending.catch(() => undefined);
    await Promise.allSettled(this.running);
  }
}
