import { describe, expect, it } from 'vitest';
import { awaitsReviewDecision, projectActivityLifecycle, reviewLifecycleState } from './reviewViewModel';
import { reviewCoverageGaps, unverifiedPartLocation, unverifiedPartReason } from './reviewCoverage';
import type { StaticSession } from './types';

describe('projectActivityLifecycle', () => {
  it('distinguishes a provider pause from evidence blocking without allowing approval', () => {
    const session = { status: 'blocked', reviewType: 'code_review', progressJson: JSON.stringify({ stage: 'provider_paused' }) } as StaticSession;
    expect(reviewLifecycleState(session)).toBe('Paused');
    expect(projectActivityLifecycle(session)).toBe('Paused');
    expect(reviewLifecycleState({ ...session, progressJson: '{}' })).toBe('Blocked');
  });
  it.each(['failed', 'failure'] as const)('keeps %s execution out of the approval workflow', status => {
    expect(projectActivityLifecycle({ status, reviewType: 'code_review' })).toBe('Failed');
    expect(reviewLifecycleState({ status } as StaticSession)).toBe('Failed');
  });
  it('keeps a successful review in approval even when list payload omits currentDecision', () => {
    expect(projectActivityLifecycle({ status: 'success', reviewType: 'code_review' })).toBe('Need Approval');
    expect(projectActivityLifecycle({ status: 'success' }, 'review')).toBe('Need Approval');
  });

  it('only completes a review after approval', () => {
    expect(projectActivityLifecycle({
      status: 'success',
      reviewType: 'code_review',
      currentDecision: {
        id: 'decision-1',
        sessionId: 'session-1',
        projectId: 'project-1',
        decision: 'approved',
        comment: '',
        reviewer: '',
        createdAt: '2026-09-10T10:00:00.000Z',
      },
    })).toBe('Completed');
  });

  it('treats dynamic success as completed', () => {
    expect(projectActivityLifecycle({ status: 'success' }, 'dynamic')).toBe('Completed');
  });
});

describe('Completed with gaps', () => {
  const progressJson = JSON.stringify({ stage: 'complete', coverage: 'partial', unverifiedPartCount: 3,
    unverifiedParts: [{ reason: 'semantic_support', files: ['src/checkout.ts'], features: ['POST /checkout'] }, { reason: 'uncertain_citation', files: [], features: ['refund'], count: 2 }, { reason: 'invented', files: ['x.ts'] }] });
  it('labels a partly verified review and keeps it in the approval workflow', () => {
    const session = { status: 'pending_approval', reviewType: 'code_review', progressJson } as StaticSession;
    expect(reviewLifecycleState(session)).toBe('Completed with gaps');
    expect(awaitsReviewDecision(reviewLifecycleState(session))).toBe(true);
    expect(projectActivityLifecycle(session)).toBe('Need Approval');
    expect(reviewLifecycleState({ ...session, progressJson: '{"stage":"complete"}' })).toBe('Need Approval');
    expect(reviewLifecycleState({ ...session, status: 'failed' })).toBe('Failed');
  });
  it('lists unverified parts in plain language and ignores unknown entries', () => {
    const gaps = reviewCoverageGaps({ progressJson });
    expect(gaps?.total).toBe(3);
    expect(gaps?.parts).toHaveLength(2);
    expect(unverifiedPartLocation(gaps!.parts[0])).toBe('src/checkout.ts');
    expect(unverifiedPartReason(gaps!.parts[0])).toBe('The conclusions could not be backed up with evidence from the code.');
    expect(unverifiedPartLocation(gaps!.parts[1])).toBe('refund');
    expect(unverifiedPartReason(gaps!.parts[1])).toBe('Some issues point to code that could not be matched exactly (2 issues).');
    expect(reviewCoverageGaps({ progressJson: '{}' })).toBeNull();
  });
});
