import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseModelUsageSummary } from '../../src/modelUsageSummary.js';

describe('Supabase Model Provider usage summary', () => {
  it('filters Dynamic session metadata without using Review foreign keys', async () => {
    const filters: unknown[][] = [];
    const query: any = { select: () => query, eq: (...args: unknown[]) => { filters.push(args); return query; }, order: () => query,
      range: () => query, then: (resolve: (value: unknown) => void) => resolve({ data: [{ id: 'usage-1', project_id: 'project-1', review_session_id: null, stage: 'step_0', attempt: 1, provider: 'codex', model: 'account-model', input_tokens: 10, output_tokens: 2, metadata: { callKind: 'dynamic', scope: 'vision', apiFormat: 'codex-app-server', dynamicSessionId: 'dynamic-1' } }], error: null }),
    };
    const result = await getSupabaseModelUsageSummary({ from: () => query } as unknown as SupabaseClient, 'verified-user', { sessionId: 'dynamic-1', callKind: 'dynamic' });
    expect(filters).toContainEqual(['owner_id', 'verified-user']);
    expect(filters).toContainEqual(['metadata->>dynamicSessionId', 'dynamic-1']);
    expect(result.recent[0]).toMatchObject({ provider: 'codex', scope: 'vision', sessionId: 'dynamic-1', inputTokens: 10 });
  });

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
