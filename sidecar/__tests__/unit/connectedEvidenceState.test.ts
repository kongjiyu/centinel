import { describe, expect, it } from 'vitest';
import { classifyConnectedSourceEvidence } from '../../src/integrations/evidenceState.js';

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
});
