import { describe, expect, it } from 'vitest';
import { findingSourceIdentityHash, type FindingCorrelation } from '../../src/review/correlation.js';
import { reconcileProjectFindings, presentReconciledProjectFindings, type ProjectFindingForReconciliation, type ReconciliationManifest } from '../../src/review/findingReconciliation.js';
import type { StoreFinding } from '../../src/store/types.js';
import type { StaticReviewRecord } from '../../src/review/types.js';

const sourcePath = 'src/account.ts';
const projectId = 'project-1';
const parentManifest: ReconciliationManifest = {
  id: 'manifest-parent', reviewId: 'review-parent', status: 'available',
  artifacts: [{ id: 'artifact-1', filePath: sourcePath, originalPath: sourcePath, contentHash: 'sha256:old-hash' }],
};
const childManifest: ReconciliationManifest = {
  id: 'manifest-child', reviewId: 'review-child', status: 'available',
  artifacts: [{ id: 'artifact-1', filePath: sourcePath, originalPath: sourcePath, contentHash: 'sha256:new-hash' }],
};

function review(overrides: Partial<StaticReviewRecord> & { id: string }): Pick<StaticReviewRecord,
  'id' | 'projectId' | 'name' | 'reviewType' | 'status' | 'modelStatus' | 'scope' | 'config' | 'lineage' | 'iteration' | 'sourceManifestId' | 'createdAt'
> {
  return {
    id: overrides.id,
    projectId,
    name: overrides.name ?? overrides.id,
    reviewType: overrides.reviewType ?? 'code_review',
    status: overrides.status ?? (overrides.id === 'review-parent' ? 'changes_requested' : 'completed'),
    modelStatus: overrides.modelStatus ?? 'succeeded',
    scope: overrides.scope ?? { artifactIds: ['artifact-1'], sourceIds: ['source-1'] },
    config: overrides.config ?? { instructions: 'Inspect authorization behavior', checks: ['security'] },
    lineage: overrides.lineage ?? { parentReviewId: overrides.id === 'review-child' ? 'review-parent' : null, lineageRootId: 'review-parent', reusedSourceManifest: false },
    iteration: overrides.iteration ?? null,
    sourceManifestId: 'sourceManifestId' in overrides ? overrides.sourceManifestId ?? null : (overrides.id === 'review-parent' ? parentManifest.id : childManifest.id),
    createdAt: overrides.createdAt ?? (overrides.id === 'review-parent' ? '2026-10-01T00:00:00Z' : '2026-10-02T00:00:00Z'),
  };
}

function finding(overrides: Partial<ProjectFindingForReconciliation> = {}): ProjectFindingForReconciliation {
  return {
    id: 'finding-parent', projectId, sessionId: 'review-parent', source: 'static', status: 'new',
    artifactId: 'artifact-1', sourceIdentity: sourcePath, sourceVersion: 'sha256:old-hash',
    filePath: sourcePath, title: 'Authorization check is missing', severity: 'high', createdAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

const eligibility = {
  version: 1 as const,
  basis: 'not_reproduced_in_comparable_review' as const,
  parentSourceManifestId: parentManifest.id,
  sourceManifestId: childManifest.id,
  reviewedArtifactId: 'artifact-1',
  parentArtifactId: 'artifact-1',
  sourceIdentityHash: findingSourceIdentityHash({ artifactId: 'artifact-1', sourceIdentity: sourcePath, filePath: sourcePath }),
  parentSourceVersion: 'sha256:old-hash',
  reviewedSourceVersion: 'sha256:new-hash',
};

function resolvedCorrelation(overrides: Partial<FindingCorrelation> = {}): FindingCorrelation {
  return {
    id: 'correlation-1', parentReviewId: 'review-parent', childReviewId: 'review-child',
    parentFindingId: 'finding-parent', childFindingId: null, classification: 'resolved', method: 'unmatched',
    score: 0, stableFingerprint: 'fingerprint', resolutionEligibility: eligibility,
    ...overrides,
  };
}

function reconcile(overrides: Partial<Parameters<typeof reconcileProjectFindings>[0]> = {}) {
  return reconcileProjectFindings({
    findings: [finding()],
    reviews: [review({ id: 'review-parent' }), review({ id: 'review-child' })],
    manifests: [parentManifest, childManifest],
    correlations: [resolvedCorrelation()],
    snapshotChildReviewIds: ['review-child'],
    ...overrides,
  });
}

describe('project finding reconciliation', () => {
  it('presents a finding as resolved only when a complete comparable re-review recorded eligible changed-source evidence', () => {
    expect(reconcile()[0]).toMatchObject({
      id: 'finding-parent', status: 'new',
      resolutionEvidence: {
        status: 'resolved', basis: 'not_reproduced_in_comparable_review',
        reviewId: 'review-child', reviewName: 'review-child', sourceManifestId: 'manifest-child',
        previousSourceVersion: 'sha256:old-hash', reviewedSourceVersion: 'sha256:new-hash',
      },
    });
  });

  it('does not resolve legacy correlations, missing snapshots, or findings without explicit evidence', () => {
    expect(reconcile({ correlations: [resolvedCorrelation({ resolutionEligibility: undefined })] })[0].resolutionEvidence).toBeUndefined();
    expect(reconcile({ snapshotChildReviewIds: [] })[0].resolutionEvidence).toBeUndefined();
    expect(reconcile({ correlations: [resolvedCorrelation({ classification: 'carried_over' })] })[0].resolutionEvidence).toBeUndefined();
  });

  it('rejects older resolved correlations when the same review recorded an uncertain recurrence', () => {
    expect(reconcile({ ambiguities: [{ childReviewId: 'review-child', candidateParentFindingIds: ['finding-parent'] }] })[0].resolutionEvidence).toBeUndefined();
  });

  it('does not apply a correlation to a finding owned by a different Review', () => {
    expect(reconcile({ findings: [finding({ sessionId: 'unrelated-review' })] })[0].resolutionEvidence).toBeUndefined();
  });

  it('derives a missing finding source version only from its matching parent manifest artifact', () => {
    expect(reconcile({ findings: [finding({ sourceVersion: null, sourceIdentity: null })] })[0].resolutionEvidence).toMatchObject({
      previousSourceVersion: 'sha256:old-hash', reviewedSourceVersion: 'sha256:new-hash',
    });
  });

  it.each([
    ['partial model result', { reviews: [review({ id: 'review-parent' }), review({ id: 'review-child', modelStatus: 'partial' })] }],
    ['failed model result', { reviews: [review({ id: 'review-parent' }), review({ id: 'review-child', modelStatus: 'failed' })] }],
    ['cancelled child', { reviews: [review({ id: 'review-parent' }), review({ id: 'review-child', status: 'cancelled' })] }],
    ['queued child', { reviews: [review({ id: 'review-parent' }), review({ id: 'review-child', status: 'queued' })] }],
    ['failed parent baseline', { reviews: [review({ id: 'review-parent', status: 'failed' }), review({ id: 'review-child' })] }],
    ['changed source scope', { reviews: [review({ id: 'review-parent' }), review({ id: 'review-child', scope: { artifactIds: ['artifact-1', 'artifact-2'], sourceIds: ['source-1'] } })] }],
    ['changed instructions', { reviews: [review({ id: 'review-parent' }), review({ id: 'review-child', config: { instructions: 'Inspect another objective', checks: ['security'] } })] }],
    ['different iteration objective', { reviews: [review({ id: 'review-parent' }), review({ id: 'review-child', iteration: { parentReviewId: 'review-parent', decisionId: 'decision-1', feedback: 'Focus on another issue', reviewer: 'Reviewer', createdBy: 'user-1', sourceChoice: 'refresh', sourceManifestId: 'manifest-parent', preparedAt: '2026-10-02T00:00:00Z' } })] }],
    ['missing parent source manifest link', { reviews: [review({ id: 'review-parent', sourceManifestId: null }), review({ id: 'review-child' })] }],
    ['missing child source manifest link', { reviews: [review({ id: 'review-parent' }), review({ id: 'review-child', sourceManifestId: null })] }],
    ['missing source manifest row', { manifests: [childManifest] }],
    ['unavailable source manifest', { manifests: [parentManifest, { ...childManifest, status: 'unavailable' }] }],
    ['changed effective source set', { manifests: [parentManifest, { ...childManifest, artifacts: [...childManifest.artifacts, { id: 'artifact-2', filePath: 'src/other.ts', originalPath: 'src/other.ts', contentHash: 'other-hash' }] }] }],
    ['source version mismatch', { findings: [finding({ sourceVersion: 'other-hash' })] }],
    ['unchanged source version', { correlations: [resolvedCorrelation({ resolutionEligibility: { ...eligibility, reviewedSourceVersion: eligibility.parentSourceVersion } })] }],
  ])('keeps the finding unresolved with %s', (_label, overrides) => {
    expect(reconcile(overrides)[0].resolutionEvidence).toBeUndefined();
  });

  it.each(['fixed', 'dismissed', 'accepted'] as const)('preserves the saved %s decision', status => {
    const result = reconcile({ findings: [finding({ status })] });
    expect(result[0]).toMatchObject({ status });
    expect(result[0].resolutionEvidence).toBeUndefined();
  });

  it('keeps the original issue ID with the latest evidence and prior occurrence history', () => {
    const childReview = review({ id: 'review-child', status: 'completed' });
    const grandchildReview = review({ id: 'review-grandchild', status: 'completed', createdAt: '2026-10-03T00:00:00Z', lineage: { parentReviewId: 'review-child', lineageRootId: 'review-parent', reusedSourceManifest: false }, sourceManifestId: 'manifest-grandchild' });
    const thirdManifest: ReconciliationManifest = { ...childManifest, id: 'manifest-grandchild', reviewId: 'review-grandchild', artifacts: [{ ...childManifest.artifacts[0], contentHash: 'third-hash' }] };
    const childFinding = finding({ id: 'finding-child', sessionId: 'review-child', sourceVersion: 'sha256:new-hash', title: 'Issue still present' });
    const latestFinding = finding({ id: 'finding-grandchild', sessionId: 'review-grandchild', sourceVersion: 'third-hash', title: 'Issue worsened', severity: 'critical' });
    const result = reconcileProjectFindings({
      findings: [finding(), childFinding, latestFinding],
      reviews: [review({ id: 'review-parent' }), childReview, grandchildReview],
      manifests: [parentManifest, childManifest, thirdManifest],
      correlations: [
        resolvedCorrelation({ classification: 'recurring', childFindingId: 'finding-child', resolutionEligibility: undefined }),
        resolvedCorrelation({ id: 'correlation-2', parentReviewId: 'review-child', childReviewId: 'review-grandchild', parentFindingId: 'finding-child', childFindingId: 'finding-grandchild', classification: 'regressed', resolutionEligibility: undefined }),
      ],
      snapshotChildReviewIds: ['review-child', 'review-grandchild'],
    });
    expect(result.map(item => item.id)).toEqual(['finding-parent']);
    expect(result[0]).toMatchObject({ title: 'Issue worsened', latestOccurrence: { findingId: 'finding-grandchild', reviewId: 'review-grandchild', classification: 'regressed' } });
    expect(result[0].lineageHistory?.map(item => item.findingId)).toEqual(['finding-parent', 'finding-child']);
    expect(result[0].lineageHistory?.map(item => item.classification)).toEqual(['recurring', 'regressed']);
  });

  it('reopens a reproduced fixed issue but honors a later human decision on the original ID', () => {
    const parent = finding({ status: 'fixed', updatedAt: '2026-10-01T12:00:00Z' });
    const child = finding({ id: 'finding-child', sessionId: 'review-child', sourceVersion: 'new-hash', createdAt: '2026-10-02T00:00:00Z' });
    const args = { findings: [parent, child], correlations: [resolvedCorrelation({ classification: 'recurring', childFindingId: child.id })] };
    expect(reconcile(args)).toMatchObject([{ id: parent.id, status: 'new', latestOccurrence: { classification: 'regressed' } }]);
    expect(reconcile({ ...args, findings: [{ ...parent, updatedAt: '2026-10-03T00:00:00Z' }, child] })).toMatchObject([{ id: parent.id, status: 'fixed' }]);
    expect(parent.status).toBe('fixed');
  });

  it('presents current evidence under the original ID without mutating either stored review occurrence', () => {
    const parent = finding();
    const child = finding({ id: 'finding-child', sessionId: 'review-child', title: 'Latest title', sourceVersion: 'new-hash' });
    const reconciled = reconcile({ findings: [parent, child], correlations: [resolvedCorrelation({ classification: 'recurring', childFindingId: child.id })] });
    const rows = [parent, child].map(item => ({ ...item, reviewSessionId: item.sessionId,
      updatedAt: item.createdAt, description: item.id, evidenceText: `evidence:${item.id}`, location: { filePath: item.filePath, lineNumber: 12 } })) as StoreFinding[];
    const result = presentReconciledProjectFindings(rows, reconciled);
    expect(result).toMatchObject([{ id: parent.id, sessionId: 'review-child', title: 'Latest title', evidenceText: 'evidence:finding-child' }]);
    expect(rows.map(row => row.id)).toEqual(['finding-parent', 'finding-child']);
    expect(rows[0].title).toBe('Authorization check is missing');
  });

  it('does not collapse a lineage link to a finding owned by a different Review', () => {
    const unrelatedChild = finding({ id: 'finding-child', sessionId: 'another-review' });
    const result = reconcileProjectFindings({
      findings: [finding(), unrelatedChild],
      reviews: [review({ id: 'review-parent' }), review({ id: 'review-child' })],
      manifests: [parentManifest, childManifest],
      correlations: [resolvedCorrelation({ classification: 'recurring', childFindingId: unrelatedChild.id, resolutionEligibility: undefined })],
      snapshotChildReviewIds: ['review-child'],
    });
    expect(result.map(item => item.id)).toEqual(['finding-parent', 'finding-child']);
  });
});
