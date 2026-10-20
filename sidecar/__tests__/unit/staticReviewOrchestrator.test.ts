import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { InMemoryStaticReviewRepository } from '../../src/review/repository.js';
import { createStaticReviewOrchestrator, ReviewLifecycleConflictError, STATIC_REVIEW_MODEL_POLICY_VERSION } from '../../src/review/orchestrator.js';
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

describe('Provider capacity lifecycle', () => {
  it('also stops at source indexing before deterministic checks or model analysis', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const deterministic = vi.fn();
    const analyze = vi.fn();
    const index = vi.fn(async () => { throw new ModelProviderError('Paused provider', { code: 'credits_exhausted', retryable: false }); });
    const orchestrator = createStaticReviewOrchestrator({ ...baseDependencies(repository), deterministic, modelProvider: { analyze }, index });
    const started = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'index-capacity-stop' });
    expect(await started.completion).toMatchObject({ status: 'blocked', progress: { stage: 'provider_paused', pauseCode: 'credits_exhausted' } });
    expect(index).toHaveBeenCalledOnce();
    expect(deterministic).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });
  it.each(['rate_limited', 'quota_exhausted', 'credits_exhausted', 'billing_required'])('stops %s before completion/approval even when deterministic-only completion is permitted', async code => {
    const repository = new InMemoryStaticReviewRepository();
    const analyze = vi.fn<StaticAnalysisModelProvider['analyze']>(async () => { throw new ModelProviderError('private provider payload', { code, retryable: true }); });
    const sleep = vi.fn();
    const correlate = vi.spyOn(repository, 'saveFindingCorrelations');
    const orchestrator = createStaticReviewOrchestrator({ ...baseDependencies(repository), modelProvider: { analyze }, allowDeterministicOnly: true, retry: { sleep } });
    const start = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'capacity-' + code });
    const result = await start.completion;
    expect(result.status).toBe('blocked');
    expect(result.progress).toMatchObject({ stage: 'provider_paused', pauseCode: code });
    expect(result.progress?.completedStages).toContain('deterministic_analysis');
    expect(result.progress?.completedStages).not.toContain('model_analysis');
    expect(result.modelStatus).toBe('partial');
    expect(result.failureReason).toContain('Paused:');
    expect(JSON.stringify(result)).not.toContain('private provider');
    expect(repository.findings).toHaveLength(1);
    expect(result.deterministicFindingCount).toBe(1);
    expect(analyze).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
    expect(correlate).not.toHaveBeenCalled();
    await expect(orchestrator.resumeQueuedReview(result.id)).rejects.toThrow('cannot resume');

    analyze.mockImplementation(successfulModel().analyze);
    const resumed = await orchestrator.retry({ reviewId: result.id, artifacts: [artifact], idempotencyKey: 'manual-' + code });
    expect((await resumed.completion).status).toBe('pending_approval');
    expect((await repository.getReview(result.id))?.status).toBe('blocked');
  });
});

async function createComparisonParent(repository: InMemoryStaticReviewRepository, overrides: {
  id?: string;
  projectId?: string;
  status?: 'running' | 'pending_approval' | 'completed' | 'approved' | 'changes_requested';
  modelStatus?: 'succeeded' | 'partial' | 'failed';
  progressStage?: string;
} = {}) {
  const parentId = overrides.id ?? 'comparison-parent';
  const projectId = overrides.projectId ?? 'project-1';
  const status = overrides.status ?? 'approved';
  const config = { instructions: 'Inspect authorization behavior', checks: ['security'], modelPolicyVersion: STATIC_REVIEW_MODEL_POLICY_VERSION };
  const parent = await repository.createReview({
    id: parentId,
    projectId,
    name: 'Previous review',
    reviewType: 'code_review',
    status,
    idempotencyKey: `parent-${parentId}`,
    scope: { artifactIds: [artifact.id] },
    config,
    lineage: { parentReviewId: null, lineageRootId: 'original-root', reusedSourceManifest: false },
  });
  const manifest = await repository.saveSourceManifest(parent.id, projectId, [{ ...artifact, contentHash: 'old-source-version' }], 'capture');
  return repository.transitionReview(parent.id, [status], {
    modelStatus: overrides.modelStatus ?? 'succeeded',
    progress: { stage: overrides.progressStage ?? 'complete', completedStages: ['persisting_evidence'], updatedAt: '2026-10-19T00:00:00.000Z' },
    sourceManifestId: manifest.id,
  }) ?? parent;
}

describe('StaticReviewOrchestrator', () => {
  it('persists source-backed paths before inference and four validated domain outcomes after it', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const provider: StaticAnalysisModelProvider = { analyze: async request => {
      expect(repository.audits.some(event => event.event === 'review_analysis_map_saved' && event.detail?.phase === 'prepared')).toBe(true);
      expect(request.systemPrompt).toContain('environment references');
      const rawMap = request.prompt.split('Provisional feature/path map (bounded syntax evidence; coverage limits apply):\n')[1].split('\n\nFrozen artifact content:')[0];
      const map = JSON.parse(rawMap);
      return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'fixture' }, result: { findings: [], featureAssessments: map.features.map((feature: any) => ({
        featureId: feature.id, assessments: ['security', 'business', 'technical', 'personnel'].map(domain => ({ domain, status: 'assessed', outcome: 'no_issue_identified', summary: 'No issue identified in the supplied local branch.', evidence: feature.entryPoints })),
      })) } };
    } };
    const orchestrator = createStaticReviewOrchestrator({ ...baseDependencies(repository), readArtifactContent: async () => 'export function account() { return true; }', deterministic: async () => [], modelProvider: provider });
    const run = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'four-domains' });
    expect((await run.completion).status).toBe('pending_approval');
    const final = repository.audits.find(event => event.event === 'review_analysis_map_saved' && event.detail?.phase === 'assessed');
    expect(final?.detail?.analysisMap).toMatchObject({ status: 'assessed', coverage: { exhaustive: false } });
    expect(final?.detail?.analysisMap).toMatchObject({ coverage: { unresolvedEdgeCount: 1 } });
  });
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
    const steps = repository.audits.filter(event => event.event === 'harness_step_completed').map(event => event.detail?.step);
    expect(steps).toEqual(expect.arrayContaining(['select_sources', 'freeze_manifest', 'read_source', 'assess_evidence', 'run_rules', 'build_request', 'run_model', 'validate_grounding', 'validate_locations', 'deduplicate_findings', 'save_traceability', 'save_findings', 'correlate_findings']));
    expect(repository.audits.filter(event => event.event.startsWith('harness_step_')).every(event => event.detail?.executionId)).toBe(true);
  });

  it.each([false, true])('reconciles independent project reviews at completion (old model issue gone=%s)', async gone => {
    const repository = new InMemoryStaticReviewRepository();
    const orchestrator = createStaticReviewOrchestrator(baseDependencies(repository));
    const first = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'independent-first' });
    await first.completion;
    const secondRunner = createStaticReviewOrchestrator({ ...baseDependencies(repository), ...(gone ? {
      modelProvider: { analyze: async () => ({ result: { findings: [] }, settings: { provider: 'mimo' as const, apiFormat: 'openai-compatible' as const, model: 'fixture' } }) },
    } : {}) });
    const second = await secondRunner.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [{ ...artifact, contentHash: 'changed-source' }], idempotencyKey: 'independent-second' });
    const finished = await second.completion;
    expect(finished.lineage.parentReviewId).toBeNull();
    const snapshot = repository.findingCorrelations.get(finished.id);
    expect(snapshot?.counts.recurring).toBe(gone ? 1 : 2);
    expect(snapshot?.counts.resolved).toBe(gone ? 1 : 0);
    expect(finished.summary).toContain('Existing findings:');
  });

  it('does not claim review completion when the existing project findings cannot be checked', async () => {
    const repository = new InMemoryStaticReviewRepository();
    vi.spyOn(repository, 'listReviews').mockRejectedValue(new Error('Project history is unavailable'));
    const runner = createStaticReviewOrchestrator(baseDependencies(repository));
    const result = await runner.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact], idempotencyKey: 'unavailable-history' });
    expect((await result.completion).status).toBe('failed');
    expect(repository.findingCorrelations.size).toBe(0);
    expect(repository.decisions).toHaveLength(0);
  });

  it.each([true, false])('starts a fresh-source comparison and only resolves under a matching model policy (current=%s)', async currentPolicy => {
    const repository = new InMemoryStaticReviewRepository();
    const parent = await createComparisonParent(repository);
    if (!currentPolicy) delete repository.reviews.get(parent.id)!.config.modelPolicyVersion;
    await repository.saveFinding({
      id: 'old-finding', reviewId: parent.id, projectId: parent.projectId, source: 'model',
      title: 'Obsolete authorization finding', description: 'The old source lacked the check.', severity: 'high',
      category: 'security_concern', filePath: artifact.filePath, lineNumber: 12, artifactId: artifact.id,
      evidence: 'Old source omission', recommendation: 'Add authorization.', confidence: 'high',
      sourceIdentity: artifact.filePath, sourceVersion: 'old-source-version', createdAt: '2026-10-18T00:00:00.000Z',
    });
    const emptyModel: StaticAnalysisModelProvider = {
      analyze: async () => ({
        result: { findings: [] },
        settings: { provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo-v2.5' },
      }),
    };
    const orchestrator = createStaticReviewOrchestrator({ ...baseDependencies(repository), modelProvider: emptyModel });
    const config = { instructions: 'Inspect authorization behavior', checks: ['security'] };
    const started = await orchestrator.start({
      projectId: 'project-1', reviewType: 'code_review', scope: { artifactIds: [artifact.id] }, config,
      comparisonParentReviewId: parent.id, idempotencyKey: 'comparison-child', artifacts: [artifact], sourceManifestMode: 'reuse',
    });

    expect(started.review.lineage).toEqual({ parentReviewId: parent.id, lineageRootId: 'original-root', reusedSourceManifest: false });
    expect(started.review.sourceManifestId).toBeNull();
    const completed = await started.completion;
    expect(repository.manifests.get(completed.id)).toMatchObject({ mode: 'capture', artifacts: [{ contentHash: artifact.contentHash }] });
    expect(completed.sourceManifestId).toBeTruthy();
    const correlationSnapshot = repository.findingCorrelations.get(completed.id);
    if (!currentPolicy) {
      expect(correlationSnapshot?.counts.resolved).toBe(0);
      expect(correlationSnapshot?.correlations.find(item => item.parentFindingId === 'old-finding')?.resolutionEligibility).toBeUndefined();
      return;
    }
    expect(correlationSnapshot).toMatchObject({ parentReviewId: parent.id, childReviewId: completed.id, counts: { resolved: 1 } });
    expect(correlationSnapshot?.correlations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parentFindingId: 'old-finding', childFindingId: null, classification: 'resolved',
        resolutionEligibility: expect.objectContaining({ parentSourceVersion: 'old-source-version', reviewedSourceVersion: artifact.contentHash }),
      }),
    ]));
  });

  it.each([
    ['active parent', { status: 'running' as const, progressStage: 'model_analysis' }],
    ['partial model result', { modelStatus: 'partial' as const }],
    ['incomplete execution', { progressStage: 'model_analysis' }],
  ])('rejects a comparison parent with %s', async (_label, overrides) => {
    const repository = new InMemoryStaticReviewRepository();
    const parent = await createComparisonParent(repository, overrides);
    const orchestrator = createStaticReviewOrchestrator(baseDependencies(repository));
    await expect(orchestrator.start({
      projectId: 'project-1', reviewType: 'code_review', scope: { artifactIds: [artifact.id] },
      comparisonParentReviewId: parent.id, idempotencyKey: `invalid-parent-${parent.id}`,
    })).rejects.toBeInstanceOf(ReviewLifecycleConflictError);
  });

  it('rejects a comparison parent from another project', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const parent = await createComparisonParent(repository, { id: 'foreign-parent', projectId: 'project-2' });
    const orchestrator = createStaticReviewOrchestrator(baseDependencies(repository));
    await expect(orchestrator.start({
      projectId: 'project-1', reviewType: 'code_review', scope: { artifactIds: [artifact.id] },
      comparisonParentReviewId: parent.id, idempotencyKey: 'foreign-comparison-parent',
    })).rejects.toBeInstanceOf(ReviewLifecycleConflictError);
  });

  it('does not let an in-flight idempotency key switch comparison parents', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const parentA = await createComparisonParent(repository, { id: 'parent-a' });
    const parentB = await createComparisonParent(repository, { id: 'parent-b' });
    const orchestrator = createStaticReviewOrchestrator(baseDependencies(repository));
    let releaseValidation!: () => void;
    const validationGate = new Promise<void>(resolve => { releaseValidation = resolve; });
    const firstStart = orchestrator.start({
      projectId: 'project-1', reviewType: 'code_review', scope: { artifactIds: [artifact.id] }, artifacts: [artifact],
      comparisonParentReviewId: parentA.id, idempotencyKey: 'same-comparison-start',
      validateScopeBeforeCreate: () => validationGate,
    });
    const conflictingStart = orchestrator.start({
      projectId: 'project-1', reviewType: 'code_review', scope: { artifactIds: [artifact.id] }, artifacts: [artifact],
      comparisonParentReviewId: parentB.id, idempotencyKey: 'same-comparison-start',
    });
    releaseValidation();
    const first = await firstStart;
    expect(first.review.lineage.parentReviewId).toBe(parentA.id);
    await expect(conflictingStart).rejects.toBeInstanceOf(ReviewLifecycleConflictError);
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
    const started = await orchestrator.start({ projectId: 'project-1', reviewType: 'code_review', artifacts: [artifact],
      config: { instructions: 'Verify that origin callbacks preserve error handling.' }, idempotencyKey: 'ranked-context' });
    const finished = await started.completion;

    expect(finished.status).toBe('pending_approval');
    expect(context).toHaveBeenCalledWith('project-1', 'code_review', 100_000, expect.any(AbortSignal), [artifact], finished.id, expect.stringContaining('code_review'));
    expect(prompts[0]).toContain('ranked membership evidence');
    expect(prompts[0]).toContain('Reviewer objective and acceptance checks:\nVerify that origin callbacks preserve error handling.');
    expect(prompts[0]).toContain('--- Artifact: src/auth.ts');
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
    expect(repository.attempts).toHaveLength(5);
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
      ['mimo', 1, 'retryable_error'], ['mimo', 2, 'retryable_error'], ['mimo', 3, 'retryable_error'],
      ['mimo', 4, 'retryable_error'], ['custom', 5, 'success'],
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
      expect(fetchImpl).toHaveBeenCalledTimes(5);
      expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
        config.baseUrl, config.baseUrl, config.baseUrl, config.baseUrl, config.fallbackBaseUrl,
      ]);
      expect(fetchImpl.mock.calls.map(([, init]) => (init?.headers as Record<string, string>).Authorization)).toEqual([
        'Bearer primary-secret', 'Bearer primary-secret', 'Bearer primary-secret', 'Bearer primary-secret', 'Bearer fallback-secret',
      ]);
      expect(repository.attempts.map(item => [item.model, item.attempt, item.outcome])).toEqual([
        ['primary-model', 1, 'retryable_error'], ['primary-model', 2, 'retryable_error'],
        ['primary-model', 3, 'retryable_error'], ['primary-model', 4, 'retryable_error'], ['fallback-model', 5, 'success'],
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
