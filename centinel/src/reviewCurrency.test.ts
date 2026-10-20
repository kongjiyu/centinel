import { describe, expect, it } from 'vitest';
import { assessReviewSourceCurrency, latestSuccessfulReview } from './reviewCurrency';
import type { Artifact, ReviewSourceManifest, StaticSession } from './types';

const review = (id = 'review-1', status: StaticSession['status'] = 'success', updatedAt = '2026-10-01T00:00:00Z'): StaticSession => ({
  id, projectId: 'project-1', name: id, reviewType: 'code_review', status,
  configJson: '{}', progressJson: '{}', remarks: '', finalSummary: '', failureReason: '',
  createdAt: '2026-09-01T00:00:00Z', updatedAt, baseRef: '', headRef: '', changedFilesJson: '[]', parentSessionId: '', reviewDiffJson: '',
});

const artifact = (id: string, contentHash: string, source: Artifact['source'] = 'documents', type: Artifact['type'] = 'requirement'): Artifact => ({
  id, projectId: 'project-1', type, source, fileName: `${id}.md`, filePath: `${id}.md`, originalPath: null, contentHash, createdAt: '2026-09-01T00:00:00Z',
});

const manifest = (sessionId = 'review-1', status: ReviewSourceManifest['status'] = 'available', sourceIds = ['artifact-1'], hashes = ['before']): ReviewSourceManifest => ({
  sessionId, projectId: 'project-1', status, capturedAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  sources: sourceIds.length ? [{
    id: 'source-1', sessionId, sourceId: 'source-1', sourceKind: 'document', label: 'requirements.md',
    artifactIds: sourceIds, filesReviewed: sourceIds.length, contentHashes: hashes, capturedAt: '2026-10-01T00:00:00Z',
  }] : [],
  artifactCount: sourceIds.length,
});

describe('review source currency', () => {
  it.each([
    ['updated document', artifact('artifact-1', 'after', 'documents', 'requirement')],
    ['updated repository file', artifact('artifact-1', 'after', 'repository', 'source_code')],
  ])('flags a changed reviewed %s', (_label, currentArtifact) => {
    expect(assessReviewSourceCurrency(review(), manifest(), [currentArtifact])).toEqual({ status: 'changed', changedCount: 1, addedCount: 0, fullyVerified: true });
  });

  it('reports unchanged reviewed versions as current', () => {
    expect(assessReviewSourceCurrency(review(), manifest(), [artifact('artifact-1', 'before')])).toEqual({ status: 'current', changedCount: 0, addedCount: 0, fullyVerified: true });
  });

  it('ignores changed artifacts outside the frozen review scope', () => {
    expect(assessReviewSourceCurrency(review(), manifest(), [
      artifact('artifact-1', 'before'),
      artifact('out-of-scope', 'after', 'repository', 'source_code'),
    ])).toEqual({ status: 'current', changedCount: 0, addedCount: 0, fullyVerified: true });
  });

  it('marks removed reviewed artifacts as changed', () => {
    expect(assessReviewSourceCurrency(review(), manifest(), [])).toEqual({ status: 'changed', changedCount: 1, addedCount: 0, fullyVerified: true });
  });

  it('flags artifacts created after the manifest as new sources rather than changed reviewed sources', () => {
    const assessment = assessReviewSourceCurrency(review(), manifest(), [
      artifact('artifact-1', 'before'),
      { ...artifact('new-source', 'new-hash', 'repository', 'source_code'), createdAt: '2026-10-02T00:00:00Z' },
    ]);

    expect(assessment).toEqual({ status: 'added', changedCount: 0, addedCount: 1, fullyVerified: true });
  });

  it('ignores preexisting unselected artifacts outside the frozen review scope', () => {
    expect(assessReviewSourceCurrency(review(), manifest(), [
      artifact('artifact-1', 'before'),
      artifact('preexisting-unselected', 'existing-hash', 'repository', 'source_code'),
    ])).toEqual({ status: 'current', changedCount: 0, addedCount: 0, fullyVerified: true });
  });

  it('cannot classify new sources without a trustworthy manifest capture time', () => {
    const savedManifest = { ...manifest(), capturedAt: '' };
    const assessment = assessReviewSourceCurrency(review(), savedManifest, [
      artifact('artifact-1', 'before'),
      { ...artifact('new-source', 'new-hash'), createdAt: '2026-10-02T00:00:00Z' },
    ]);

    expect(assessment).toEqual({ status: 'unverified', changedCount: 0, addedCount: 0, fullyVerified: false });
  });

  it.each([
    ['unavailable', manifest('review-1', 'unavailable')],
    ['empty', manifest('review-1', 'available', [], [])],
    ['hashless', manifest('review-1', 'available', ['artifact-1'], [])],
    ['incomplete', manifest('review-1', 'incomplete')],
  ])('does not claim currency when the saved manifest is %s', (_label, savedManifest) => {
    expect(assessReviewSourceCurrency(review(), savedManifest, [artifact('artifact-1', 'before')])).toEqual({ status: 'unverified', changedCount: 0, addedCount: 0, fullyVerified: false });
  });

  it('keeps a known source change visible when an incomplete manifest has other gaps', () => {
    expect(assessReviewSourceCurrency(review(), manifest('review-1', 'incomplete'), [artifact('artifact-1', 'after')])).toEqual({ status: 'changed', changedCount: 1, addedCount: 0, fullyVerified: false });
  });

  it('rejects a manifest belonging to another project or review', () => {
    expect(assessReviewSourceCurrency(review(), { ...manifest(), projectId: 'another-project' }, [artifact('artifact-1', 'before')])).toEqual({ status: 'unverified', changedCount: 0, addedCount: 0, fullyVerified: false });
  });

  it('does not compare artifacts returned for another project', () => {
    expect(assessReviewSourceCurrency(review(), manifest(), [{ ...artifact('artifact-1', 'after'), projectId: 'another-project' }])).toEqual({ status: 'unverified', changedCount: 0, addedCount: 0, fullyVerified: false });
  });

  it('uses the latest successful review, so a newer failed attempt does not clear the prior source basis', () => {
    const earlier = review('review-success', 'success', '2026-10-01T00:00:00Z');
    const newerFailure = review('review-failed', 'failure', '2026-10-10T00:00:00Z');
    expect(latestSuccessfulReview([newerFailure, earlier])?.id).toBe('review-success');
  });

  it('accepts the canonical pending-approval state as a completed review execution', () => {
    const pending = review('pending-review', 'pending_approval', '2026-10-02T00:00:00Z');
    expect(latestSuccessfulReview([pending])?.id).toBe('pending-review');
  });

  it('orders by execution completion rather than a later human approval timestamp', () => {
    const approvedEarlier = {
      ...review('approved-earlier', 'approved', '2026-10-10T00:00:00Z'),
      completedAt: '2026-10-01T00:00:00Z',
    };
    const pendingLater = {
      ...review('pending-later', 'pending_approval', '2026-10-05T00:00:00Z'),
      completedAt: '2026-10-05T00:00:00Z',
    };
    expect(latestSuccessfulReview([approvedEarlier, pendingLater])?.id).toBe('pending-later');
  });

  it('uses execution completion from progress when the top-level value is unavailable', () => {
    const first = { ...review('first', 'completed'), progressJson: JSON.stringify({ completedAt: '2026-10-01T00:00:00Z' }) };
    const second = { ...review('second', 'approved'), progressJson: JSON.stringify({ completedAt: '2026-10-02T00:00:00Z' }) };
    expect(latestSuccessfulReview([first, second])?.id).toBe('second');
  });

  it('does not use a partial or failed model execution as the source basis', () => {
    const partial = { ...review('partial', 'completed'), modelStatus: 'partial' as const };
    expect(latestSuccessfulReview([partial, review('legacy-success', 'success')])?.id).toBe('legacy-success');
    expect(latestSuccessfulReview([partial])).toBeNull();
  });

  it('returns no currency basis before a successful review exists', () => {
    expect(latestSuccessfulReview([review('review-failed', 'failure')])).toBeNull();
  });
});
