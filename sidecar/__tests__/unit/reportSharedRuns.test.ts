import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseReportSnapshotSource } from '../../src/report/supabaseSnapshot.js';

function fakeClient(rows: Record<string, Array<Record<string, unknown>>>): SupabaseClient {
  return {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let range: [number, number] | null = null;
      const visible = () => (rows[table] ?? []).filter(row => filters.every(([field, value]) => row[field] === value));
      const query: Record<string, unknown> = {
        select: () => query,
        eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
        order: () => query,
        range: (from: number, to: number) => { range = [from, to]; return query; },
        maybeSingle: async () => ({ data: visible()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ data: range ? visible().slice(range[0], range[1] + 1) : visible(), error: null }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe('project report Dynamic data', () => {
  it('reports shared Runs by their verdict and hides the legacy mirror of the same Run', async () => {
    const projectId = 'project-1';
    const run = {
      id: 'run-1', projectId, missionId: 'mission-1', createdAt: '2026-10-30T10:00:00Z', updatedAt: '2026-10-30T10:05:00Z',
      state: 'completed', verdict: 'failed', reason: null, legacySessionId: 'legacy-1', evidence: [],
      revision: { revision: 2, name: 'Todo persists', goal: 'Reload keeps todos', targetUrl: 'http://localhost:37702', maxSteps: 10,
        checks: [{ id: 'persist', description: 'Todo still visible after reload' }] },
      checks: [{ checkId: 'persist', verdict: 'failed', reason: 'Todo list was empty after reload.' }],
    };
    const client = fakeClient({
      projects: [{ id: projectId }],
      dynamic_runs: [{ id: 'run-1', project_id: projectId, payload: run }],
      dynamic_sessions: [
        { id: 'legacy-1', project_id: projectId, name: 'Journey: Reload keeps todos', status: 'success' },
        { id: 'legacy-2', project_id: projectId, name: 'Older local session', status: 'failure' },
      ],
    });
    const source = new SupabaseReportSnapshotSource(client, 'owner-1');

    const sessions = await source.listDynamicSessions(projectId);
    expect(sessions.map(item => [item.id, item.name, item.status])).toEqual([
      ['run-1', 'Todo persists', 'failure'],
      ['legacy-2', 'Older local session', 'failure'],
    ]);
    expect(await source.listDynamicEvidence(projectId, 'run-1')).toEqual([]);
    expect(await source.listDynamicActions(projectId, 'run-1')).toEqual([
      { step: 1, action: 'check', target: 'Todo still visible after reload', result: 'failed: Todo list was empty after reload.' },
    ]);
  });
});
