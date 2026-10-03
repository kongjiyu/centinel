import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { InMemoryStaticReviewRepository } from '../../src/review/repository.js';
import { createStaticReviewOrchestrator } from '../../src/review/orchestrator.js';
import type { StaticAnalysisModelProvider } from '../../src/review/types.js';

const artifact: Artifact = {
  id: 'artifact-frozen', projectId: 'project-1', type: 'other', source: 'documents',
  fileName: 'policy.txt', filePath: 'policy.txt', originalPath: null,
  contentHash: 'frozen-hash', createdAt: '2026-09-21T00:00:00.000Z',
};

async function makeParent(repository: InMemoryStaticReviewRepository, decision: 'changes_requested' | 'approved' = 'changes_requested') {
  const parent = await repository.createReview({
    id: 'parent-review', projectId: 'project-1', name: 'Access Review', reviewType: 'general_review',
    status: 'changes_requested', idempotencyKey: 'parent-key', scope: { artifactIds: [artifact.id] }, config: { maxContextTokens: 1000 },
    lineage: { parentReviewId: null, lineageRootId: 'root-review', reusedSourceManifest: false },
  });
  const manifest = await repository.saveSourceManifest(parent.id, parent.projectId, [artifact], 'capture');
  await repository.transitionReview(parent.id, ['changes_requested'], { sourceManifestId: manifest.id });
  await repository.addDecision({
    id: 'decision-1', reviewId: parent.id, projectId: parent.projectId, decision,
    comment: 'Please verify tenant ownership before returning account data.', reviewer: 'Ada Reviewer', createdAt: '2026-09-21T00:01:00.000Z',
  });
  return repository.getReview(parent.id);
}

function provider(onPrompt: (prompt: string) => void): StaticAnalysisModelProvider {
  return {
    analyze: async request => {
      onPrompt(request.prompt);
      return { result: { findings: [] }, settings: { provider: 'mimo', apiFormat: 'openai-compatible', model: 'test-model' } };
    },
  };
}

describe('Request Changes Review iteration lifecycle', () => {
  it('prepares an immutable child without model work and runs only after an explicit start', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const original = await makeParent(repository);
    const modelPrompts: string[] = [];
    let calls = 0;
    const modelProvider = provider(prompt => { calls++; modelPrompts.push(prompt); });
    const orchestrator = createStaticReviewOrchestrator({
      repository,
      modelProvider,
      modelMetadata: async () => ({ provider: 'mimo', apiFormat: 'openai-compatible', model: 'test-model' }),
      deterministic: async () => [],
      readArtifactContent: async () => 'The account handler returns data after checking tenant ownership.',
      now: () => new Date('2026-09-21T00:02:00.000Z'),
      idGenerator: () => 'child-review',
    });

    const prepared = await orchestrator.prepareReviewIteration({ reviewId: 'parent-review', sourceChoice: 'reuse', actorId: 'reviewer-user' });
    expect(prepared).toMatchObject({ status: 'prepared', sourceManifestId: original?.sourceManifestId, lineage: { parentReviewId: 'parent-review', lineageRootId: 'root-review', reusedSourceManifest: true }, iteration: { feedback: 'Please verify tenant ownership before returning account data.', reviewer: 'Ada Reviewer', sourceChoice: 'reuse' } });
    expect(calls).toBe(0);
    expect(await repository.getReview('parent-review')).toEqual(original);

    const started = await orchestrator.startPreparedIteration({ reviewId: prepared.id });
    expect(started.reused).toBe(false);
    const finished = await started.completion;
    expect(finished.status).toBe('pending_approval');
    expect(calls).toBe(1);
    expect(modelPrompts[0]).toContain('Please verify tenant ownership before returning account data.');
    expect(finished.sourceManifestId).toBe(original?.sourceManifestId);
    expect(await repository.getReview('parent-review')).toEqual(original);
    expect(repository.findingCorrelations.get(prepared.id)?.parentReviewId).toBe('parent-review');
  });

  it('preserves an explicit refresh choice and idempotently returns the same prepared child', async () => {
    const repository = new InMemoryStaticReviewRepository();
    await makeParent(repository);
    const orchestrator = createStaticReviewOrchestrator({ repository, idGenerator: () => 'refresh-child' });
    const input = { reviewId: 'parent-review', sourceChoice: 'refresh' as const, actorId: 'reviewer-user' };
    const first = await orchestrator.prepareReviewIteration(input);
    const second = await orchestrator.prepareReviewIteration(input);
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ status: 'prepared', sourceManifestId: null, lineage: { reusedSourceManifest: false }, iteration: { sourceChoice: 'refresh', sourceManifestId: null } });
    expect(repository.reviews.size).toBe(2);
  });

  it('requires a current persisted Request Changes decision and explicit child start', async () => {
    const repository = new InMemoryStaticReviewRepository();
    await makeParent(repository, 'approved');
    const orchestrator = createStaticReviewOrchestrator({ repository });
    await expect(orchestrator.prepareReviewIteration({ reviewId: 'parent-review', sourceChoice: 'reuse', actorId: 'reviewer-user' }))
      .rejects.toThrow('latest Request Changes decision');

    const noDecisionRepository = new InMemoryStaticReviewRepository();
    await noDecisionRepository.createReview({
      id: 'review-no-decision', projectId: 'project-1', name: 'Review', reviewType: 'general_review', status: 'completed',
      idempotencyKey: 'no-decision', scope: {}, config: {},
      lineage: { parentReviewId: null, lineageRootId: 'root', reusedSourceManifest: false }, sourceManifestId: 'manifest',
    });
    const noDecisionOrchestrator = createStaticReviewOrchestrator({ repository: noDecisionRepository });
    await expect(noDecisionOrchestrator.prepareReviewIteration({ reviewId: 'review-no-decision', sourceChoice: 'reuse', actorId: 'reviewer-user' }))
      .rejects.toThrow('latest Request Changes decision could not be verified');
  });

  it('blocks analysis and records evidence gaps when readable bytes no longer match the frozen hash', async () => {
    const repository = new InMemoryStaticReviewRepository();
    let deterministicCalls = 0;
    const changedArtifact = { ...artifact, contentHash: 'a'.repeat(64) };
    const orchestrator = createStaticReviewOrchestrator({
      repository,
      artifacts: async () => [changedArtifact],
      readArtifactContent: async () => 'The source bytes have changed after the manifest was frozen.',
      deterministic: async () => { deterministicCalls++; return []; },
      modelProvider: provider(() => { throw new Error('model work should not start'); }),
      modelMetadata: async () => ({ provider: 'mimo', apiFormat: 'openai-compatible', model: 'test-model' }),
    });
    const started = await orchestrator.start({ projectId: 'project-1', reviewType: 'general_review', artifacts: [changedArtifact] });
    const blocked = await started.completion;
    expect(blocked.status).toBe('blocked');
    expect(deterministicCalls).toBe(0);
    expect(repository.evidenceAssessments.get(blocked.id)?.gaps.map(item => item.code)).toContain('source_inaccessible');
  });
});
