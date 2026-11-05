import { describe, expect, it } from 'vitest';
import { buildReviewEstimate, describeReviewEstimate, latestFinishedReview } from './reviewEstimate';
import type { ReviewModelUsage, StaticSession } from './types';

const session = (overrides: Partial<StaticSession>): StaticSession => ({
  id: 'r', projectId: 'p', name: 'Pre-release review', reviewType: 'code_review', status: 'pending_approval',
  configJson: '{}', progressJson: '{}', remarks: '', finalSummary: '', failureReason: '',
  createdAt: '2026-11-01T18:29:00.000Z', updatedAt: '2026-11-01T18:33:00.000Z',
  baseRef: '', headRef: '', changedFilesJson: '[]', parentSessionId: '', ...overrides,
} as StaticSession);

const usage = (totals: Partial<ReviewModelUsage['totals']>): ReviewModelUsage => ({
  totals: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, calls: 0, ...totals }, byGroup: [],
} as unknown as ReviewModelUsage);

describe('review estimate', () => {
  it('uses the latest finished Review and its recorded duration and tokens', () => {
    const finished = session({ id: 'new', progressJson: JSON.stringify({ stage: 'complete', updatedAt: '2026-11-01T18:32:37.000Z' }) });
    const failed = session({ id: 'failed', status: 'failed', completedAt: '2026-11-01T19:00:00.000Z' });
    const running = session({ id: 'running', status: 'running' });
    expect(latestFinishedReview([failed, running, finished])?.id).toBe('new');
    const estimate = buildReviewEstimate(finished, usage({ input: 650_000, output: 48_000, accountedTokens: 698_000 }));
    expect(estimate).toMatchObject({ kind: 'previous', durationMs: 217_000, tokens: 698_000, tokensIncomplete: false });
    expect(describeReviewEstimate(estimate)).toBe('Estimate: about 3m 37s and about 698k AI tokens, based on the last Review of this project ("Pre-release review"). Changed or added files can take longer.');
  });

  it('marks token counts as a minimum when some calls have unknown usage', () => {
    const estimate = buildReviewEstimate(session({ completedAt: '2026-11-01T18:31:00.000Z' }), usage({ input: 1_200_000, output: 300_000, unknownTotalCalls: 2 }));
    expect(describeReviewEstimate(estimate)).toContain('at least 1.5M AI tokens');
  });

  it('uses the row update time for summary-list Reviews that only record their stage', () => {
    const summary = session({ progressJson: JSON.stringify({ stage: 'complete' }), createdAt: '2026-11-05T14:45:22.000Z', updatedAt: '2026-11-05T14:56:51.000Z' });
    expect(latestFinishedReview([summary])?.id).toBe('r');
    expect(buildReviewEstimate(summary, null)).toMatchObject({ durationMs: 689_000 });
  });

  it('says plainly when there is no earlier Review', () => {
    expect(describeReviewEstimate(buildReviewEstimate(null, null))).toMatch(/first Review of this project/);
  });
});
