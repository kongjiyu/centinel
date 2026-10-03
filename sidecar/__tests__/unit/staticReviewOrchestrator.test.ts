import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { InMemoryStaticReviewRepository } from '../../src/review/repository.js';
import { createStaticReviewOrchestrator, ReviewLifecycleConflictError } from '../../src/review/orchestrator.js';
import { InMemoryReviewLeaseRepository, ReviewLeaseCoordinator } from '../../src/review/lease.js';
import { ModelProviderError } from '../../src/review/retry.js';
import { resolveModelProviderChain } from '../../src/review/modelProviderResolver.js';
import { InMemoryGroundingRepository } from '../../src/review/grounding.js';
import { encryptSecret } from '../../src/tokenVault.js';
import type { StaticAnalysisModelProvider } from '../../src/review/types.js';

const artifact: Artifact = {
  id: 'artifact-1', projectId: 'project-1', type: 'source_code', source: 'repository',
  fileName: 'src/auth.ts', filePath: 'src/auth.ts', originalPath: null,
  contentHash: 'hash-1', createdAt: '2026-09-21T00:00:00.000Z',
};

function successfulModel(): StaticAnalysisModelProvider {
  return {
    analyze: async () => ({
      result: {
        findings: [{
          title: 'Missing authorization check', description: 'The handler does not verify ownership.',
          severity: 'high', category: 'security_concern', filePath: 'src/auth.ts', lineNumber: 12,
          evidence: 'request.user is read without a membership check', recommendation: 'Validate membership before reading the resource.', confidence: 'high',
        }],
      },
      settings: { provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo-v2.5' },
    }),
  };
}

function baseDependencies(repository: InMemoryStaticReviewRepository) {
  return {
    repository,
    artifacts: async () => [artifact],
    readArtifactContent: async () => 'The account handler checks the request before returning data.',
    deterministic: async () => ({
      findings: [{
        ruleId: 'sec-eval', filePath: 'src/auth.ts', lineNumber: 42, severity: 'high',
        category: 'security', message: 'eval() usage detected', evidence: 'eval(input)',
      }],
      persisted: false,
    }),
    modelProvider: successfulModel(),
  };
}

describe('StaticReviewOrchestrator', () => {
  it('fails closed when no authenticated frozen-artifact reader is supplied', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const orchestrator = createStaticReviewOrchestrator({
      repository,
      deterministic: async () => [],
      modelProvider: successfulModel(),
    });
    const started = await orchestrator.start({
      projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'missing-reader',
    });
    const finished = await started.completion;
    expect(finished.status).toBe('failed');
    expect(finished.failureReason).toContain('authenticated frozen-artifact reader');
  });

  it('runs frozen evidence, deterministic analysis, model analysis, and enters pending approval', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const orchestrator = createStaticReviewOrchestrator(baseDependencies(repository));
    const started = await orchestrator.start({
      projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'start-1',
    });
    const finished = await started.completion;
    expect(finished.status).toBe('pending_approval');
    expect(finished.lineage.parentReviewId).toBeNull();
    expect(finished.sourceManifestId).toBeTruthy();
    expect(finished.deterministicFindingCount).toBe(1);
    expect(finished.modelFindingCount).toBe(1);
    expect(repository.manifests.get(finished.id)?.artifacts).toHaveLength(1);
    expect(repository.findings).toHaveLength(2);
    expect(repository.audits.some(event => event.event === 'model_attempt')).toBe(true);
  });

  it('fails the Review when its immutable source manifest cannot be persisted', async () => {
    const repository = new InMemoryStaticReviewRepository();
    vi.spyOn(repository, 'saveSourceManifest').mockRejectedValue(new Error('manifest storage unavailable'));
    const orchestrator = createStaticReviewOrchestrator(baseDependencies(repository));
    const started = await orchestrator.start({
      projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'manifest-failure',
    });
    const finished = await started.completion;
    expect(finished.status).toBe('failed');
    expect(finished.failureReason).toContain('manifest storage unavailable');
    expect(repository.manifests.size).toBe(0);
  });

  it('never presents a Review as ready for approval when traceability persistence fails', async () => {
    const repository = new InMemoryStaticReviewRepository();
    vi.spyOn(repository, 'saveTraceabilitySnapshot').mockRejectedValue(new Error('traceability storage unavailable'));
    const orchestrator = createStaticReviewOrchestrator(baseDependencies(repository));
    const started = await orchestrator.start({
      projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'traceability-failure',
    });
    const finished = await started.completion;
    expect(finished.status).toBe('failed');
    expect(finished.failureReason).toContain('traceability storage unavailable');
    expect(repository.findings).toHaveLength(0);
  });

  it('fails rather than silently dropping findings when durable finding persistence rejects', async () => {
    const repository = new InMemoryStaticReviewRepository();
    vi.spyOn(repository, 'saveFinding').mockRejectedValue(new Error('finding storage unavailable'));
    const orchestrator = createStaticReviewOrchestrator(baseDependencies(repository));
    const started = await orchestrator.start({
      projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'finding-failure',
    });
    const finished = await started.completion;
    expect(finished.status).toBe('failed');
    expect(finished.failureReason).toContain('finding storage unavailable');
    expect(repository.findings).toHaveLength(0);
  });

  it('uses ranked durable excerpts as context without dropping the full frozen source', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const prompts: string[] = [];
    const context = vi.fn(async () => ({
      files: [], totalSymbols: 0, estimatedTokens: 6,
      reason: 'Retrieved one similarity-ranked chunk.',
      selectedChunks: [{ artifactVersionId: 'version-1', filePath: 'src/auth.ts', ordinal: 2, content: 'ranked membership evidence' }],
    }));
    const modelProvider: StaticAnalysisModelProvider = {
      analyze: async request => {
        prompts.push(request.prompt);
        return { result: { findings: [] }, settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'review-model' } };
      },
    };
    const orchestrator = createStaticReviewOrchestrator({ ...baseDependencies(repository), context, modelProvider });
    const started = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'ranked-context' });
    const finished = await started.completion;

    expect(finished.status).toBe('pending_approval');
    expect(context).toHaveBeenCalledWith('project-1', 'code_review', 100_000, expect.any(AbortSignal), [artifact], finished.id, expect.stringContaining('code_review'));
    expect(prompts[0]).toContain('ranked membership evidence');
    expect(prompts[0]).toContain('The account handler checks the request before returning data.');
    expect(prompts[0]).toContain('version version-1, chunk 2');
  });

  it('makes duplicate Start requests idempotent and executes once', async () => {
    const repository = new InMemoryStaticReviewRepository();
    let deterministicCalls = 0;
    const orchestrator = createStaticReviewOrchestrator({
      ...baseDependencies(repository),
      deterministic: async () => {
        deterministicCalls++;
        return { findings: [], persisted: false };
      },
    });
    const first = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'same' });
    const second = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'same' });
    expect(second.reused).toBe(true);
    expect(second.review.id).toBe(first.review.id);
    await Promise.all([first.completion, second.completion]);
    expect(deterministicCalls).toBe(1);
  });

  it('retains deterministic findings when the Model Provider is exhausted', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const modelProvider: StaticAnalysisModelProvider = {
      analyze: async () => { throw new ModelProviderError('temporarily unavailable', { code: 'server_busy', retryable: true }); },
    };
    const orchestrator = createStaticReviewOrchestrator({
      ...baseDependencies(repository), modelProvider,
      retry: { baseDelayMs: 0, jitterRatio: 0, sleep: async () => undefined },
    });
    const started = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'partial' });
    const finished = await started.completion;
    expect(finished.status).toBe('pending_approval');
    expect(finished.modelStatus).toBe('partial');
    expect(finished.deterministicFindingCount).toBe(1);
    expect(repository.attempts).toHaveLength(3);
    expect(repository.findings).toHaveLength(1);
  });

  it('resolves a provider chain per review and records attempts from primary and fallback', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const primary: StaticAnalysisModelProvider = {
      analyze: async () => { throw new ModelProviderError('temporarily unavailable', { code: 'server_busy', retryable: true }); },
    };
    const fallback = successfulModel();
    const resolveChain = vi.fn(async () => ({
      primaryProvider: primary,
      fallbackProvider: fallback,
      primaryMetadata: { provider: 'mimo', apiFormat: 'openai-compatible', model: 'primary' },
      fallbackMetadata: { provider: 'custom', apiFormat: 'openai-compatible', model: 'fallback' },
      configurationId: 'model-config-1',
    }));
    const orchestrator = createStaticReviewOrchestrator({
      ...baseDependencies(repository),
      modelProviderResolver: resolveChain,
      retry: { baseDelayMs: 0, jitterRatio: 0, sleep: async () => undefined },
    });
    const started = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'provider-chain' });
    const finished = await started.completion;
    expect(finished.status).toBe('pending_approval');
    expect(resolveChain).toHaveBeenCalledWith(expect.objectContaining({ id: finished.id }), expect.any(AbortSignal));
    expect(repository.attempts.map(item => [item.provider, item.attempt, item.outcome])).toEqual([
      ['mimo', 1, 'retryable_error'], ['mimo', 2, 'retryable_error'], ['custom', 3, 'success'],
    ]);
    expect(repository.audits.some(event => event.event === 'model_configuration_resolved')).toBe(true);
  });

  it('runs the encrypted Model Provider configuration through the real adapter and one shared attempt budget', async () => {
    const previousKey = process.env.CENTINEL_TOKEN_ENCRYPTION_KEY;
    process.env.CENTINEL_TOKEN_ENCRYPTION_KEY = 'review-provider-chain-test-key';
    try {
      const repository = new InMemoryStaticReviewRepository();
      const config = {
        id: 'configured-chain', provider: 'custom', apiFormat: 'openai-compatible', model: 'primary-model',
        baseUrl: 'https://primary.example.test/v1/chat/completions', secretCiphertext: encryptSecret('primary-secret'),
        fallbackProvider: 'custom', fallbackApiFormat: 'openai-compatible', fallbackModel: 'fallback-model',
        fallbackBaseUrl: 'https://fallback.example.test/v1/chat/completions', fallbackSecretCiphertext: encryptSecret('fallback-secret'),
      };
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async url => String(url).includes('primary.example.test')
        ? new Response('temporarily unavailable', { status: 503 })
        : new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ findings: [] }) } }],
          usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 },
        }), { status: 200 }));
      const orchestrator = createStaticReviewOrchestrator({
        ...baseDependencies(repository),
        modelProviderResolver: (_review, signal) => resolveModelProviderChain(
          { getModelConfiguration: async () => config },
          { ownerId: 'owner-1', projectId: 'project-1' }, { fetchImpl, signal },
        ),
        retry: { baseDelayMs: 0, jitterRatio: 0, sleep: async () => undefined },
      });
      const started = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'real-configured-chain' });
      const finished = await started.completion;
      expect(finished.status).toBe('pending_approval');
      expect(finished.modelStatus).toBe('succeeded');
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
        config.baseUrl, config.baseUrl, config.fallbackBaseUrl,
      ]);
      expect(fetchImpl.mock.calls.map(([, init]) => (init?.headers as Record<string, string>).Authorization)).toEqual([
        'Bearer primary-secret', 'Bearer primary-secret', 'Bearer fallback-secret',
      ]);
      expect(repository.attempts.map(item => [item.model, item.attempt, item.outcome])).toEqual([
        ['primary-model', 1, 'retryable_error'], ['primary-model', 2, 'retryable_error'], ['fallback-model', 3, 'success'],
      ]);
      expect(JSON.stringify(repository.audits)).not.toContain('primary-secret');
      expect(JSON.stringify(repository.audits)).not.toContain('fallback-secret');
    } finally {
      if (previousKey === undefined) delete process.env.CENTINEL_TOKEN_ENCRYPTION_KEY;
      else process.env.CENTINEL_TOKEN_ENCRYPTION_KEY = previousKey;
    }
  });

  it('holds a durable lease and checkpoints each stage until terminal completion', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const leases = new InMemoryReviewLeaseRepository();
    const leaseCoordinator = new ReviewLeaseCoordinator(leases, {
      workerId: 'worker-1', leaseDurationMs: 5_000, heartbeatIntervalMs: 1_000,
    });
    const orchestrator = createStaticReviewOrchestrator({
      ...baseDependencies(repository),
      leaseCoordinator,
    });
    const started = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'leased' });
    const finished = await started.completion;
    expect(finished.status).toBe('pending_approval');
    expect(leases.checkpoints.get(finished.id)).toMatchObject({
      stage: 'complete',
      completedStages: ['freezing_sources', 'indexing_context', 'deterministic_analysis', 'model_analysis', 'persisting_evidence'],
      detail: { resumeStrategy: 'replay_frozen_inputs' },
    });
    expect(leases.leases.has(finished.id)).toBe(false);
  });

  it('resumes a reconciled queued Review using its frozen source manifest when present', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const orchestrator = createStaticReviewOrchestrator(baseDependencies(repository));
    const queued = await repository.createReview({
      projectId: 'project-1', name: 'Recovered Review', reviewType: 'code_review', status: 'queued', idempotencyKey: 'recovered',
      scope: {}, config: {}, lineage: { parentReviewId: null, lineageRootId: 'root-recovered', reusedSourceManifest: false },
    });
    const manifest = await repository.saveSourceManifest!(queued.id, queued.projectId, [artifact], 'capture');
    await repository.transitionReview(queued.id, ['queued'], { sourceManifestId: manifest.id });
    const resumed = await orchestrator.resumeQueuedReview(queued.id);
    const finished = await resumed.completion;
    expect(finished.status).toBe('pending_approval');
    expect(repository.audits.some(event => event.event === 'source_manifest_reused')).toBe(true);
  });

  it('preserves a connected source stale classification when its frozen content cannot be read', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const orchestrator = createStaticReviewOrchestrator({
      ...baseDependencies(repository),
      readArtifactContent: async () => { throw new Error('cached bytes unavailable'); },
      evidenceSourceState: async () => ({ state: 'stale', detail: 'Provider disconnected.' }),
    });
    const started = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'stale-source' });
    const finished = await started.completion;
    expect(finished.status).toBe('pending_approval');
    expect(repository.evidenceAssessments.get(finished.id)?.readiness).toBe('ready_with_warnings');
    expect(repository.evidenceAssessments.get(finished.id)?.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'source_stale', severity: 'warning' }),
    ]));
  });

  it('cancels an active review and prevents a later success transition', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const controller = { resolve: undefined as (() => void) | undefined };
    const modelProvider: StaticAnalysisModelProvider = {
      analyze: async ({ signal }) => await new Promise((_resolve, reject) => {
        controller.resolve = () => reject(new DOMException('aborted', 'AbortError'));
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    };
    const orchestrator = createStaticReviewOrchestrator({
      ...baseDependencies(repository), modelProvider,
    });
    const started = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'cancel' });
    await vi.waitFor(async () => {
      const current = await repository.getReview(started.review.id);
      expect(current?.status).toBe('running');
    });
    const cancelled = await orchestrator.cancel({ reviewId: started.review.id, idempotencyKey: 'cancel-action' });
    expect(cancelled.status).toBe('cancelled');
    const finished = await started.completion;
    expect(finished.status).toBe('cancelled');
    expect((await orchestrator.cancel({ reviewId: started.review.id, idempotencyKey: 'cancel-action-again' })).status).toBe('cancelled');
    expect(repository.audits.filter(event => event.event === 'review_cancelled')).toHaveLength(1);
  });

  it('cancels a held provider-configuration lookup before any model attempt', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const resolver = vi.fn((_review, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const orchestrator = createStaticReviewOrchestrator({
      ...baseDependencies(repository), modelProviderResolver: resolver,
    });
    const started = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'cancel-provider-lookup' });
    await vi.waitFor(() => expect(resolver).toHaveBeenCalled());
    expect(resolver.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    const cancelled = await orchestrator.cancel({ reviewId: started.review.id, idempotencyKey: 'cancel-provider-lookup-action' });
    const finished = await started.completion;
    expect(cancelled.status).toBe('cancelled');
    expect(finished.status).toBe('cancelled');
    expect(repository.attempts).toHaveLength(0);
  });

  it('cancels a held Supabase-style grounding lookup during source freezing', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const groundingRepository = new InMemoryGroundingRepository();
    const lookup = vi.spyOn(groundingRepository, 'listConfirmedRequirements').mockImplementation((_projectId, _ids, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }));
    const modelProvider = { analyze: vi.fn(successfulModel().analyze) };
    const orchestrator = createStaticReviewOrchestrator({
      ...baseDependencies(repository), groundingRepository, modelProvider,
    });
    const started = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'cancel-grounding-lookup' });
    await vi.waitFor(() => expect(lookup).toHaveBeenCalled());
    expect(lookup.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);
    await orchestrator.cancel({ reviewId: started.review.id, idempotencyKey: 'cancel-grounding-action' });
    expect((await started.completion).status).toBe('cancelled');
    expect(modelProvider.analyze).not.toHaveBeenCalled();
  });

  it('rejects Cancel and Retry after a Review reaches pending approval without false cancellation audit', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const orchestrator = createStaticReviewOrchestrator(baseDependencies(repository));
    const started = await orchestrator.start({
      projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'terminal-guard',
    });
    const finished = await started.completion;
    expect(finished.status).toBe('pending_approval');
    await expect(orchestrator.cancel({ reviewId: finished.id })).rejects.toBeInstanceOf(ReviewLifecycleConflictError);
    await expect(orchestrator.retry({ reviewId: finished.id })).rejects.toBeInstanceOf(ReviewLifecycleConflictError);
    expect((await repository.getReview(finished.id))?.status).toBe('pending_approval');
    expect(repository.audits.some(event => event.event === 'review_cancelled')).toBe(false);
  });

  it('does not turn an aborted artifact read into an evidence sufficiency failure', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const orchestrator = createStaticReviewOrchestrator({
      ...baseDependencies(repository),
      readArtifactContent: async (_item, signal) => {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        return await new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        });
      },
    });
    const started = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'cancel-read' });
    await vi.waitFor(() => expect(repository.reviews.get(started.review.id)?.status).toBe('running'));
    const cancelled = await orchestrator.cancel({ reviewId: started.review.id, idempotencyKey: 'cancel-read-action' });
    const finished = await started.completion;
    expect(cancelled.status).toBe('cancelled');
    expect(finished.status).toBe('cancelled');
  });

  it('retries as an immutable child with shared lineage and idempotency', async () => {
    const repository = new InMemoryStaticReviewRepository();
    let shouldFail = true;
    const orchestrator = createStaticReviewOrchestrator({
      ...baseDependencies(repository),
      deterministic: async () => {
        if (shouldFail) throw new Error('index failed');
        return { findings: [], persisted: false };
      },
    });
    const first = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'original' });
    const failed = await first.completion;
    expect(failed.status).toBe('failed');
    shouldFail = false;
    const retried = await orchestrator.retry({ reviewId: failed.id, idempotencyKey: 'retry-1' });
    const retriedAgain = await orchestrator.retry({ reviewId: failed.id, idempotencyKey: 'retry-1' });
    const child = await retried.completion;
    expect(retriedAgain.review.id).toBe(child.id);
    expect(child.id).not.toBe(failed.id);
    expect(child.lineage.parentReviewId).toBe(failed.id);
    expect(child.lineage.lineageRootId).toBe(failed.lineage.lineageRootId);
    expect(failed.status).toBe('failed');
  });
});
