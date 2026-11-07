import { describe, expect, it } from 'vitest';
import {
  buildReviewListEntries,
  filterReviewListEntries,
  reviewFindingCount,
  reviewListFilterCounts,
  reviewListFilterFor,
} from './reviewList';
import type { StaticSession } from './types';

function review(overrides: Partial<StaticSession> & { id: string }): StaticSession {
  return {
    projectId: 'project-1',
    name: `Review ${overrides.id}`,
    reviewType: 'code_review',
    status: 'pending_approval',
    configJson: '{}',
    progressJson: '{}',
    remarks: '',
    finalSummary: '',
    failureReason: '',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    baseRef: '',
    headRef: '',
    changedFilesJson: '[]',
    parentSessionId: '',
    reviewDiffJson: '',
    ...overrides,
  } as StaticSession;
}

describe('Reviews list view model', () => {
  it('maps summary rows through the shared lifecycle, including Completed with gaps', () => {
    const entries = buildReviewListEntries([
      review({ id: 'queued', status: 'queued' }),
      review({ id: 'running', status: 'running' }),
      review({ id: 'pending', status: 'pending_approval' }),
      review({ id: 'gaps', status: 'pending_approval', progressJson: JSON.stringify({ stage: 'complete', coverage: 'partial' }) }),
      review({ id: 'approved', status: 'approved' }),
      review({ id: 'changes', status: 'changes_requested' }),
      review({ id: 'paused', status: 'blocked', progressJson: JSON.stringify({ stage: 'provider_paused' }) }),
      review({ id: 'blocked', status: 'blocked', progressJson: JSON.stringify({ stage: 'model_analysis' }) }),
      review({ id: 'failed', status: 'failed' }),
      review({ id: 'cancelled', status: 'cancelled' }),
    ]);
    const states = Object.fromEntries(entries.map(entry => [entry.review.id, entry.state]));
    expect(states).toEqual({
      queued: 'Queued',
      running: 'In progress',
      pending: 'Need Approval',
      gaps: 'Completed with gaps',
      approved: 'Completed',
      changes: 'Need Approval',
      paused: 'Paused',
      blocked: 'Blocked',
      failed: 'Failed',
      cancelled: 'Cancelled',
    });
    expect(reviewListFilterFor('Queued')).toBe('active');
    expect(reviewListFilterFor('In progress')).toBe('active');
    expect(reviewListFilterFor('Completed with gaps')).toBe('gaps');
  });

  it('filters by status and counts every status group', () => {
    const entries = buildReviewListEntries([
      review({ id: 'a', status: 'running' }),
      review({ id: 'b', status: 'pending_approval', progressJson: JSON.stringify({ coverage: 'partial', stage: 'complete' }) }),
      review({ id: 'c', status: 'pending_approval' }),
      review({ id: 'd', status: 'failed' }),
      review({ id: 'e', status: 'failed' }),
    ]);
    expect(filterReviewListEntries(entries, 'all')).toHaveLength(5);
    expect(filterReviewListEntries(entries, 'failed').map(entry => entry.review.id).sort()).toEqual(['d', 'e']);
    expect(filterReviewListEntries(entries, 'gaps').map(entry => entry.review.id)).toEqual(['b']);
    expect(filterReviewListEntries(entries, 'need_approval').map(entry => entry.review.id)).toEqual(['c']);
    expect(filterReviewListEntries(entries, 'completed')).toEqual([]);
    const counts = reviewListFilterCounts(entries);
    expect(counts).toMatchObject({ all: 5, active: 1, gaps: 1, need_approval: 1, failed: 2, completed: 0, cancelled: 0 });
  });

  it('sorts newest first and resolves retry lineage both ways', () => {
    const entries = buildReviewListEntries([
      review({ id: 'original', name: 'First attempt', status: 'failed', createdAt: '2026-11-01T08:00:00.000Z' }),
      review({ id: 'retry-1', name: 'Second attempt', status: 'failed', parentSessionId: 'original', createdAt: '2026-11-01T09:00:00.000Z' }),
      review({ id: 'retry-2', name: 'Third attempt', status: 'pending_approval', parentSessionId: 'retry-1', createdAt: '2026-11-01T10:00:00.000Z' }),
      review({ id: 'orphan', name: 'Orphan retry', parentSessionId: 'missing-parent', createdAt: '2026-11-01T07:00:00.000Z' }),
    ]);
    expect(entries.map(entry => entry.review.id)).toEqual(['retry-2', 'retry-1', 'original', 'orphan']);
    const byId = Object.fromEntries(entries.map(entry => [entry.review.id, entry]));
    expect(byId.original.supersededBy).toEqual({ id: 'retry-1', name: 'Second attempt' });
    expect(byId['retry-1'].parent).toEqual({ id: 'original', name: 'First attempt' });
    expect(byId['retry-1'].supersededBy).toEqual({ id: 'retry-2', name: 'Third attempt' });
    expect(byId['retry-2'].supersededBy).toBeNull();
    expect(byId.orphan.parent).toEqual({ id: 'missing-parent', name: 'Earlier Review' });
  });

  it('shows recorded finding totals only when they are meaningful', () => {
    expect(reviewFindingCount(review({ id: 'old-service' }))).toBeNull();
    expect(reviewFindingCount(review({ id: 'done', deterministicFindingCount: 2, modelFindingCount: 3 }))).toBe(5);
    expect(reviewFindingCount(review({ id: 'clean', deterministicFindingCount: 0, modelFindingCount: 0 }))).toBe(0);
    expect(reviewFindingCount(review({ id: 'running', status: 'running', deterministicFindingCount: 0, modelFindingCount: 0 }))).toBeNull();
    expect(reviewFindingCount(review({ id: 'failed-empty', status: 'failed', deterministicFindingCount: 0, modelFindingCount: 0 }))).toBeNull();
    expect(reviewFindingCount(review({ id: 'failed-partial', status: 'failed', deterministicFindingCount: 1, modelFindingCount: 0 }))).toBe(1);
  });
});
