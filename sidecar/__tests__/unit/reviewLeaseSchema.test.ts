import { describe, expect, it, vi } from 'vitest';
import { SupabaseReviewLeaseRepository } from '../../src/review/lease.js';

const row = {
  review_session_id: 'review-1', project_id: 'project-1', worker_id: 'worker-1',
  lease_token: 'token-1', attempt: 2, acquired_at: '2026-10-16T00:00:00Z',
  heartbeat_at: '2026-10-16T00:00:01Z', expires_at: '2026-10-16T00:01:00Z',
};
const claim = {
  reviewId: row.review_session_id, projectId: row.project_id, workerId: row.worker_id,
  leaseToken: row.lease_token, now: row.heartbeat_at, expiresAt: row.expires_at,
};

describe('Review runtime database schema', () => {
  it('recognizes claimed, renewed and expired leases returned by the migration', async () => {
    const query: any = {
      select: vi.fn(() => query), lte: vi.fn(() => query),
      order: vi.fn(async () => ({ data: [row], error: null })),
    };
    const client: any = {
      rpc: vi.fn(async () => ({ data: [row], error: null })),
      from: vi.fn(() => query),
    };
    const repository = new SupabaseReviewLeaseRepository(client);
    const expected = expect.objectContaining({ reviewId: 'review-1', projectId: 'project-1', attempt: 2 });
    expect(await repository.acquireLease(claim)).toEqual(expected);
    expect(await repository.renewLease(claim)).toEqual(expected);
    expect(await repository.listExpiredLeases(row.expires_at)).toEqual([expected]);
    client.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await repository.acquireLease(claim)).toBeNull();
  });

  it('writes and retrieves checkpoints using the migrated unique review column', async () => {
    const query: any = {
      upsert: vi.fn(async () => ({ error: null })), select: vi.fn(() => query),
      eq: vi.fn(() => query), maybeSingle: vi.fn(async () => ({
        data: { ...row, stage: 'freezing_sources', completed_stages: [] }, error: null,
      })),
    };
    const repository = new SupabaseReviewLeaseRepository({ from: vi.fn(() => query) } as any);
    const checkpoint = {
      reviewId: 'review-1', projectId: 'project-1', workerId: 'worker-1', leaseToken: 'token-1',
      stage: 'freezing_sources', completedStages: [], updatedAt: row.heartbeat_at,
    };
    await repository.saveCheckpoint(checkpoint);
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ review_session_id: 'review-1' }), {
      onConflict: 'review_session_id',
    });
    expect(query.upsert.mock.calls[0][0]).not.toHaveProperty('review_id');
    expect(await repository.getCheckpoint('review-1')).toEqual(expect.objectContaining({
      reviewId: 'review-1', stage: 'freezing_sources',
    }));
    expect(query.eq).toHaveBeenCalledWith('review_session_id', 'review-1');
  });
});
