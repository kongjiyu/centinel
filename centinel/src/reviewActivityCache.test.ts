import { afterEach, describe, expect, it } from 'vitest';
import { readReviewActivityPreview, rememberReviewActivity } from './reviewActivityCache';
import type { StaticSession } from './types';

const now = Date.now();
const timestamp = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();
const session = {
  id: 'review-a',
  projectId: 'project-a',
  status: 'running',
  progressJson: JSON.stringify({
    stage: 'model_analysis',
    completedStages: ['freezing_sources'],
    updatedAt: timestamp(1),
    message: 'private prompt',
  }),
} as StaticSession;

afterEach(() => window.localStorage.clear());

describe('saved Review activity preview', () => {
  it('shows only approved stage labels for the matching account, project and review', () => {
    rememberReviewActivity('account-a', session);
    const read = readReviewActivityPreview('account-a', 'project-a', 'review-a');
    expect(read?.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'freezing_sources', status: 'Completed' }),
      expect.objectContaining({ id: 'model_analysis', status: 'Last active' }),
    ]));
    expect(JSON.stringify(window.localStorage)).not.toContain('private prompt');
    expect(readReviewActivityPreview('account-b', 'project-a', 'review-a')).toBeNull();
    expect(readReviewActivityPreview('account-a', 'project-b', 'review-a')).toBeNull();
    expect(readReviewActivityPreview('account-a', 'project-a', 'review-b')).toBeNull();
  });

  it('preserves newer progress across competing reads and clears only the terminal review', () => {
    rememberReviewActivity('account-a', session);
    rememberReviewActivity('account-a', { ...session, id: 'review-b' });
    rememberReviewActivity('account-a', {
      ...session,
      progressJson: JSON.stringify({ stage: 'freezing_sources', updatedAt: timestamp(60) }),
    });
    expect(readReviewActivityPreview('account-a', 'project-a', 'review-a')?.updatedAt).toBe(timestamp(1));
    rememberReviewActivity('account-a', { ...session, status: 'pending_approval' });
    expect(readReviewActivityPreview('account-a', 'project-a', 'review-a')).toBeNull();
    expect(readReviewActivityPreview('account-a', 'project-a', 'review-b')).not.toBeNull();
  });
});
