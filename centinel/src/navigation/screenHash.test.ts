import { describe, expect, it } from 'vitest';
import { hashToScreen, screenToHash } from './screenHash';

describe('screen hash routing', () => {
  it('round-trips pages with identifiers and drafts', () => {
    const review = { name: 'review-activity' as const, projectId: 'p-1', sessionId: 'r-1', reviewName: 'Todo review' };
    expect(hashToScreen(screenToHash(review))).toEqual(review);
    const dynamic = { name: 'dynamic-testing' as const, projectId: 'p-1', draft: { name: 'Verify fix', goal: 'Check & confirm', reviewId: 'r-1' } };
    expect(hashToScreen(screenToHash(dynamic))).toEqual(dynamic);
  });
  it('drops one-shot entry actions and ignores non-route hashes', () => {
    expect(screenToHash({ name: 'projects', initialCreate: true })).toBe('#/projects');
    expect(hashToScreen('#access_token=abc&type=recovery')).toBeNull();
    expect(hashToScreen('#review')).toBeNull();
    expect(hashToScreen('#/review-activity?projectId=p-1')).toBeNull();
    expect(hashToScreen('#/unknown')).toBeNull();
  });
});
