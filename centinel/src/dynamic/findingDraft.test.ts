import { describe, expect, it } from 'vitest';
import { reviewToDynamicDraft } from './findingDraft';

describe('reviewToDynamicDraft', () => {
  it('scopes the goal to the selected criteria rather than every reviewed requirement', () => {
    const draft = reviewToDynamicDraft({ id: 'review-1', name: 'Acceptance S1 sample shop' });
    expect(draft.reviewId).toBe('review-1');
    expect(draft.name).toBe('Acceptance S1 sample shop: runtime check');
    expect(draft.goal).toContain('criteria selected for this test');
    expect(draft.goal).toContain('not in scope');
    expect(draft.goal).not.toMatch(/requirements reviewed/i);
  });

  it('keeps the draft bounded for long Review names', () => {
    const draft = reviewToDynamicDraft({ id: 'r', name: 'x'.repeat(3000) });
    expect(draft.name.length).toBeLessThanOrEqual(120);
    expect(draft.goal.length).toBeLessThanOrEqual(1800);
  });
});
