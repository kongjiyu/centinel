import { describe, expect, it } from 'vitest';
import { InMemoryStaticReviewRepository } from '../../src/review/repository.js';
import { withEvidenceSufficiencyGap, type EvidenceSufficiencyAssessment } from '../../src/review/evidenceSufficiency.js';

function newReview(id: string, status: 'running' | 'pending_approval' = 'running') {
  return {
    id,
    projectId: 'project-1',
    name: 'Review',
    reviewType: 'code_review',
    status,
    idempotencyKey: `key-${id}`,
    scope: {},
    config: {},
    lineage: { parentReviewId: null, lineageRootId: id, reusedSourceManifest: false },
  } as const;
}

describe('InMemoryStaticReviewRepository', () => {
  it('copies unavailable v2 traceability context and frozen grounding on a saved-source retry', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const parent = await repository.createReview(newReview('parent'));
    const grounding = {
      confirmedRequirements: [{ id: 'req-1', projectId: 'project-1', title: 'Frozen requirement', description: 'Captured once', category: 'security', priority: 'high', sourceCandidateId: null, sourceLocator: null, sourceVersion: null, confidence: null, createdAt: '2026-10-20T00:00:00.000Z' }],
      enabledStandardRules: [],
    };
    const parentSnapshot = await repository.captureTraceabilitySnapshot(parent.id, parent.projectId, {
      scope: { requirementIds: ['req-1'] }, sourceManifestId: 'manifest-1', artifacts: [], grounding,
    });
    const child = await repository.createReview({ ...newReview('child'), lineage: { parentReviewId: parent.id, lineageRootId: parent.id, reusedSourceManifest: true } });

    const childSnapshot = await repository.captureTraceabilitySnapshot(child.id, child.projectId, {
      scope: { requirementIds: ['req-1'] }, sourceManifestId: 'manifest-1', artifacts: [], reuseFromReviewId: parent.id,
    });

    expect(childSnapshot.status).toBe('unavailable');
    expect(childSnapshot.records).toEqual(parentSnapshot.records);
    expect(childSnapshot.metadata?.grounding).toEqual(grounding);
    expect(childSnapshot.metadata?.unavailableReason).toBe('in_memory_traceability_adapter_unavailable');
  });

  it('appends evidence gaps only during a running Review and preserves the frozen source assessment', async () => {
    const repository = new InMemoryStaticReviewRepository();
    const review = await repository.createReview(newReview('running-review'));
    const assessment: EvidenceSufficiencyAssessment = {
      id: 'initial', reviewId: review.id, projectId: review.projectId, reviewType: review.reviewType,
      readiness: 'ready', gaps: [], contradictions: [], artifactCount: 2, availableArtifactCount: 2,
      staleArtifactCount: 0, confirmedRequirementCount: 1, enabledStandardRuleCount: 0,
      assessedAt: '2026-10-20T00:00:00.000Z',
    };
    await repository.saveEvidenceSufficiency(assessment);
    const update = withEvidenceSufficiencyGap(assessment, {
      code: 'model_assessment_invalid', severity: 'blocking', title: 'Assessment incomplete',
      detail: 'The assessment did not validate.', remediation: 'Retry after inspecting the evidence.', affectedStages: ['model_analysis'],
    });

    const appended = await repository.appendEvidenceSufficiency(update);
    expect(appended).toMatchObject({ readiness: 'blocked', artifactCount: 2, confirmedRequirementCount: 1, assessedAt: assessment.assessedAt });
    expect((await repository.getEvidenceSufficiency(review.id))?.gaps.map(item => item.code)).toEqual(['model_assessment_invalid']);

    await repository.transitionReview(review.id, ['running'], { status: 'pending_approval' });
    await expect(repository.appendEvidenceSufficiency(update)).rejects.toThrow('immutable after Review execution ends');
  });
});
