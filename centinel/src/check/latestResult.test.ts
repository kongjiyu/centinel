import { describe, expect, it } from 'vitest';
import type { AutoTestSession } from '../autotest/types';
import type { StaticSession } from '../types';
import { latestResultFrom, pickLatestFullAutoTest, pickLatestReview } from './latestResult';

const review = (id: string, createdAt: string, status = 'completed') => ({ id, createdAt, status, progressJson: '{}', failureReason: '' } as unknown as StaticSession);
const auto = (id: string, createdAt: string, patch: Partial<AutoTestSession> = {}) => ({ id, createdAt, updatedAt: createdAt, stage: 'completed', tests: [], dropped: [], lanes: [], summary: null, error: null, ...patch } as unknown as AutoTestSession);

describe('latest project result', () => {
  it('prefers the newest finished review, falling back to a running one', () => {
    expect(pickLatestReview([review('a', '2026-11-10'), review('b', '2026-11-12'), review('c', '2026-11-13', 'running')])?.id).toBe('b');
    expect(pickLatestReview([review('c', '2026-11-13', 'running')])?.id).toBe('c');
    expect(pickLatestReview([])).toBeNull();
  });

  it('takes browser proof only from full checks, never from conversation requests or reruns', () => {
    const sessions = [auto('full', '2026-11-12'), auto('ask', '2026-11-14', { request: { text: 'x', base: null, history: [] } }), auto('rerun', '2026-11-14', { planning: false })];
    expect(pickLatestFullAutoTest(sessions)?.id).toBe('full');
  });

  it('prefers the newest finished browser tests, falling back to running ones', () => {
    expect(pickLatestFullAutoTest([auto('done', '2026-11-12'), auto('now', '2026-11-14', { stage: 'testing' })])?.id).toBe('done');
    expect(pickLatestFullAutoTest([auto('now', '2026-11-14', { stage: 'testing' })])?.id).toBe('now');
  });

  it('builds the same result as the Result page from saved records, and nothing without them', () => {
    expect(latestResultFrom({ review: null, findings: [], autoTest: null, requirements: [] })).toBeNull();
    const result = latestResultFrom({ review: review('r', '2026-11-12'), findings: [], autoTest: null, requirements: [] });
    expect(result).toMatchObject({ codeState: 'done', browserState: 'not_requested', verdict: 'No problems found.' });
  });
});
