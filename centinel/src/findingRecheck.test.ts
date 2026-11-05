import { describe, expect, it } from 'vitest';
import { findingRecheckPlan, findingReviewId } from './findingRecheck';
import type { Finding, StaticSession } from './types';

const finding = (extra: Partial<Finding> = {}) => ({ id: 'f', projectId: 'p', sessionId: 'r1', source: 'static', verifier: 'model', ...extra }) as Finding;
const review = (id: string, status: StaticSession['status'], projectId = 'p') => ({ id, projectId, name: id, status }) as StaticSession;

describe('finding re-check plan', () => {
  it('retries stopped Reviews with updated sources and compares completed ones', () => {
    expect(findingRecheckPlan(finding(), [review('r1', 'failed')])?.kind).toBe('retry');
    expect(findingRecheckPlan(finding(), [review('r1', 'blocked')])?.kind).toBe('retry');
    expect(findingRecheckPlan(finding(), [review('r1', 'pending_approval')])?.kind).toBe('compare');
    expect(findingRecheckPlan(finding(), [review('r1', 'approved')])?.kind).toBe('compare');
    expect(findingRecheckPlan(finding(), [review('r1', 'running')])?.kind).toBe('open');
  });
  it('uses the latest occurrence Review and never offers re-check outside Review findings', () => {
    expect(findingReviewId(finding({ latestOccurrence: { findingId: 'n', reviewId: 'r2', classification: 'recurring' } }))).toBe('r2');
    expect(findingRecheckPlan(finding({ source: 'dynamic' }), [review('r1', 'failed')])).toBeNull();
    expect(findingRecheckPlan(finding({ verifier: 'readiness' }), [review('r1', 'failed')])).toBeNull();
    expect(findingRecheckPlan(finding(), [review('r1', 'failed', 'other')])).toBeNull();
    expect(findingRecheckPlan(finding(), [])).toBeNull();
  });
});
