import { describe, expect, it, vi } from 'vitest';
import { classifyConnectedSourceEvidence, SupabaseConnectedEvidenceStateResolver } from '../../src/integrations/evidenceState.js';
import type { Artifact } from '../../src/artifacts.js';

describe('connected source evidence state', () => {
  const now = Date.parse('2026-09-22T12:00:00.000Z');

  it('marks removed and inaccessible provider items as blocking states', () => {
    expect(classifyConnectedSourceEvidence({ itemStatus: 'removed', sourceStatus: 'active', syncStatus: 'ready', now })).toMatchObject({ state: 'deleted' });
    expect(classifyConnectedSourceEvidence({ itemStatus: 'inaccessible', itemError: 'scope revoked', sourceStatus: 'active', syncStatus: 'ready', now })).toEqual({ state: 'inaccessible', detail: 'scope revoked' });
  });

  it('marks disconnected, failed, and old synchronization state as stale', () => {
    expect(classifyConnectedSourceEvidence({ itemStatus: 'available', sourceStatus: 'disconnected', syncStatus: 'ready', now })).toMatchObject({ state: 'stale' });
    expect(classifyConnectedSourceEvidence({ itemStatus: 'available', sourceStatus: 'active', syncStatus: 'error', sourceError: 'provider unavailable', now })).toEqual({ state: 'stale', detail: 'provider unavailable' });
    expect(classifyConnectedSourceEvidence({ itemStatus: 'available', sourceStatus: 'active', syncStatus: 'ready', lastSuccessfulSyncAt: '2026-09-20T12:00:00.000Z', now })).toMatchObject({ state: 'stale' });
  });

  it('accepts a recently synchronized available item', () => {
    expect(classifyConnectedSourceEvidence({ itemStatus: 'available', sourceStatus: 'active', syncStatus: 'ready', lastSuccessfulSyncAt: '2026-09-22T11:00:00.000Z', now })).toEqual({ state: 'available' });
  });

  it.each([false, true])('queries the migrated source_items table for connected=%s', async connected => {
    const query = (data: unknown) => {
      const chain: any = {
        select: vi.fn(() => chain), eq: vi.fn(() => chain), order: vi.fn(() => chain),
        limit: vi.fn(() => chain), maybeSingle: vi.fn(async () => ({ data, error: null })),
      };
      return chain;
    };
    const item = query(connected ? { source_id: 'source-1', status: 'available' } : null);
    const source = query({ status: 'active', sync_status: 'ready', last_successful_sync_at: '2026-09-22T11:00:00.000Z' });
    const client: any = { from: vi.fn((table: string) => {
      if (table === 'source_items') return item;
      if (table === 'project_sources') return source;
      throw new Error(`Unexpected table: ${table}`);
    }) };
    const result = await new SupabaseConnectedEvidenceStateResolver(client, { now: () => now }).resolve({ id: 'artifact-1', projectId: 'project-1' } as Artifact);
    expect(result).toEqual(connected ? { state: 'available' } : undefined);
    expect(item.eq).toHaveBeenCalledWith('project_id', 'project-1');
    expect(item.eq).toHaveBeenCalledWith('artifact_id', 'artifact-1');
    expect(client.from).toHaveBeenCalledTimes(connected ? 2 : 1);
  });
});
