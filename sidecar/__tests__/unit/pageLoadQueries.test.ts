import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CentinelApplicationRepository } from '../../src/applicationRepository.js';
import { SupabaseStaticReviewRepository } from '../../src/review/supabaseRepository.js';

function queryClient(rows: Record<string, unknown>[] = [], member = true) {
  const calls: Array<{ table: string; columns?: string; limit?: number; filters: Record<string, unknown> }> = [];
  const from = vi.fn((table: string) => {
    const call: (typeof calls)[number] = { table, filters: {} };
    calls.push(call);
    let start = 0;
    let end = Number.MAX_SAFE_INTEGER;
    const query: any = {
      select: (columns: string) => { call.columns = columns; return query; },
      eq: (key: string, value: unknown) => { call.filters[key] = value; return query; },
      limit: (count: number) => { call.limit = count; return query; },
      order: () => query,
      abortSignal: () => query,
      range: (offset: number, last: number) => { start = offset; end = last; return query; },
      maybeSingle: async () => ({ data: member ? { id: 'project' } : null, error: null }),
      then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve({ data: rows.slice(start, Math.min(end + 1, call.limit ?? end + 1)), error: null })),
    };
    return query;
  });
  return { client: { from } as unknown as SupabaseClient, calls, from };
}

describe('page loading query budgets', () => {
  it('checks source existence with one id row and no version or content reads', async () => {
    const fixture = queryClient(Array.from({ length: 2000 }, (_, i) => ({ id: `file-${i}` })));
    const repository = new CentinelApplicationRepository(fixture.client, 'user');
    expect(await repository.hasArtifacts('project')).toBe(true);
    expect(fixture.calls).toEqual([
      { table: 'projects', columns: 'id', filters: { id: 'project' } },
      { table: 'artifacts', columns: 'id', limit: 1, filters: { project_id: 'project' } },
    ]);
  });

  it('does not read source presence for a non-member or misreport an empty project', async () => {
    const denied = queryClient([], false);
    await expect(new CentinelApplicationRepository(denied.client, 'user').hasArtifacts('foreign')).rejects.toThrow();
    expect(denied.calls).toHaveLength(1);
    const empty = queryClient();
    expect(await new CentinelApplicationRepository(empty.client, 'user').hasArtifacts('project')).toBe(false);
  });

  it('preserves Review lifecycle and pause metadata while excluding heavy fields', async () => {
    // Deliberately return extra fields to ensure the response cannot leak them
    // even if an adapter supplies more than the requested projection.
    const fixture = queryClient([{ id: 'review', project_id: 'project', name: 'Paused review', status: 'blocked',
      review_type: 'code_review', progress_stage: 'provider_paused', failure_reason: 'Manual resume required',
      config: { instructions: 'private source instructions' }, scope: { artifactIds: ['file'] },
      progress: { events: Array(2000).fill('large history') }, summary: 'large saved summary',
      created_at: '2026-10-21', updated_at: '2026-10-22', lineage_parent: 'failed-parent' }]);
    const summaries = await new SupabaseStaticReviewRepository(fixture.client).listReviewSummaries('project');
    expect(summaries[0]).toMatchObject({ id: 'review', status: 'blocked', progress: { stage: 'provider_paused' }, config: {}, scope: {}, summary: '' });
    expect(fixture.calls.every(call => call.table === 'review_sessions')).toBe(true);
    // Lineage stays in the lightweight projection so directories can let a retry supersede its failed parent.
    expect(fixture.calls[0].columns).toBe('id,project_id,name,review_type,status,failure_reason,created_at,updated_at,model_status,parent_review_id,lineage_parent:lineage->>parentReviewId,progress_stage:progress->>stage');
    expect(summaries[0].lineage.parentReviewId).toBe('failed-parent');
    expect(fixture.calls[0].filters).toEqual({ project_id: 'project' });
    expect(JSON.stringify(summaries)).not.toContain('large history');
    expect(JSON.stringify(summaries)).not.toContain('private source instructions');
  });
});
