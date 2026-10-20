import { describe, expect, it } from 'vitest';
import { projectActivityLifecycle, reviewLifecycleState } from './reviewViewModel';
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
