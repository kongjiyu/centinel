import { describe, expect, it } from 'vitest';
import { projectActivityLifecycle } from './reviewViewModel';

describe('projectActivityLifecycle', () => {
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
