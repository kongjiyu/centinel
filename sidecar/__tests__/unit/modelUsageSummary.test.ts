import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseModelUsageSummary } from '../../src/modelUsageSummary.js';

describe('Supabase Model Provider usage summary', () => {
  it('aggregates all pages and filters review versus provider-test calls', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      id: String(index), project_id: index === 500 ? null : 'project-1',
      review_session_id: index === 500 ? null : 'review-1',
      stage: index === 500 ? 'provider-test' : 'static-analysis', attempt: 1,
      provider: 'custom', model: 'text-model', input_tokens: 2, output_tokens: 3,
      cache_read_tokens: 0, cache_creation_tokens: 0,
      metadata: { apiFormat: 'openai-compatible', callKind: index === 500 ? 'test' : 'review', scope: 'text' },
      created_at: '2026-09-23T00:00:00Z',
    }));
    const client = {
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          order: () => query,
          range: (start: number, end: number) => Promise.resolve({ data: rows.slice(start, end + 1), error: null }),
        };
        return query;
      },
    } as unknown as SupabaseClient;

    const all = await getSupabaseModelUsageSummary(client, 'user-1');
    expect(all.totals).toEqual({ input: 1002, output: 1503, cacheRead: 0, cacheCreation: 0, calls: 501 });
    expect(all.recent).toHaveLength(50);
    const tests = await getSupabaseModelUsageSummary(client, 'user-1', { callKind: 'test' });
    expect(tests.totals.calls).toBe(1);
    expect(tests.recent[0].sessionId).toBeNull();
  });
});
