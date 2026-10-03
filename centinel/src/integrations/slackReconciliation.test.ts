import { describe, expect, it, vi } from 'vitest';
import type { ConnectedSource } from '../types';
import { reconcileOneDueSlackSource, SLACK_RECONCILIATION_INTERVAL_MS } from './slackReconciliation';

const now = Date.parse('2026-09-23T12:00:00.000Z');

function source(overrides: Partial<ConnectedSource> = {}): ConnectedSource {
  return {
    id: 'slack-1', projectId: 'project-1', integrationId: 'integration-1', provider: 'slack', kind: 'slack_channel',
    remoteId: 'channel-1', remoteUrl: null, name: '#review', selectedScope: {}, remoteRevision: null, syncCursor: null,
    status: 'active', syncStatus: 'ready', lastSyncedAt: null, lastSuccessfulSyncAt: null, lastError: null,
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', ...overrides,
  };
}

describe('bounded Slack reconciliation while the desktop workspace is open', () => {
  it('syncs one due Slack source with a small page budget and stable time-bucket key', async () => {
    const listConnectedSources = vi.fn(async () => [source(), source({ id: 'slack-2' })]);
    const syncConnectedSource = vi.fn(async () => undefined);
    const getConnectedSourceSyncHistory = vi.fn(async () => []);
    const resumeConnectedSourceSync = vi.fn(async () => undefined);
    const result = await reconcileOneDueSlackSource(['project-1', 'project-2'], 0, { listConnectedSources, syncConnectedSource, getConnectedSourceSyncHistory, resumeConnectedSourceSync }, now);
    expect(result).toEqual({ nextIndex: 1, attempted: true });
    expect(listConnectedSources).toHaveBeenCalledTimes(1);
    expect(syncConnectedSource).toHaveBeenCalledWith('project-1', 'slack-1', {
      maxPages: 5, idempotencyKey: `slack-periodic:slack-1:${Math.floor(now / SLACK_RECONCILIATION_INTERVAL_MS)}`,
    });
  });

  it('skips recent, disconnected, and currently syncing sources', async () => {
    const listConnectedSources = vi.fn(async () => [
      source({ lastSyncedAt: new Date(now - 60_000).toISOString() }),
      source({ id: 'disconnected', status: 'disconnected' }),
      source({ id: 'syncing', syncStatus: 'syncing' }),
      source({ id: 'drive', provider: 'google_drive', kind: 'google_drive' }),
    ]);
    const syncConnectedSource = vi.fn(async () => undefined);
    const getConnectedSourceSyncHistory = vi.fn(async () => []);
    const resumeConnectedSourceSync = vi.fn(async () => undefined);
    expect(await reconcileOneDueSlackSource(['project-1'], 0, { listConnectedSources, syncConnectedSource, getConnectedSourceSyncHistory, resumeConnectedSourceSync }, now))
      .toEqual({ nextIndex: 0, attempted: false });
    expect(syncConnectedSource).not.toHaveBeenCalled();
  });

  it('checks at most ten projects per pass and rotates to the next project', async () => {
    const projectIds = Array.from({ length: 12 }, (_, index) => `project-${index}`);
    const listConnectedSources = vi.fn(async () => []);
    const syncConnectedSource = vi.fn(async () => undefined);
    const getConnectedSourceSyncHistory = vi.fn(async () => []);
    const resumeConnectedSourceSync = vi.fn(async () => undefined);
    const integrationApi = { listConnectedSources, syncConnectedSource, getConnectedSourceSyncHistory, resumeConnectedSourceSync };
    expect(await reconcileOneDueSlackSource(projectIds, 0, integrationApi, now))
      .toEqual({ nextIndex: 10, attempted: false });
    expect(listConnectedSources).toHaveBeenCalledTimes(10);
    expect(await reconcileOneDueSlackSource(projectIds, 10, integrationApi, now))
      .toEqual({ nextIndex: 8, attempted: false });
  });

  it('continues past an inaccessible project and stops after a failed sync attempt', async () => {
    const listConnectedSources = vi.fn(async (projectId: string) => {
      if (projectId === 'project-1') throw new Error('Project access unavailable');
      return [source({ projectId: 'project-2' })];
    });
    const syncConnectedSource = vi.fn(async () => { throw new Error('Slack temporarily unavailable'); });
    const getConnectedSourceSyncHistory = vi.fn(async () => []);
    const resumeConnectedSourceSync = vi.fn(async () => undefined);
    expect(await reconcileOneDueSlackSource(['project-1', 'project-2'], 0, { listConnectedSources, syncConnectedSource, getConnectedSourceSyncHistory, resumeConnectedSourceSync }, now))
      .toEqual({ nextIndex: 0, attempted: true });
    expect(syncConnectedSource).toHaveBeenCalledTimes(1);
  });

  it('resumes the latest partial baseline rather than restarting at the first page', async () => {
    const listConnectedSources = vi.fn(async () => [source({
      syncCursor: { mode: 'baseline', pageToken: 'next-page' },
      lastSyncedAt: new Date(now - SLACK_RECONCILIATION_INTERVAL_MS).toISOString(),
    })]);
    const getConnectedSourceSyncHistory = vi.fn(async () => [{ id: 'partial-run', status: 'partial' }]);
    const resumeConnectedSourceSync = vi.fn(async () => undefined);
    const syncConnectedSource = vi.fn(async () => undefined);
    expect(await reconcileOneDueSlackSource(['project-1'], 0, {
      listConnectedSources, getConnectedSourceSyncHistory, resumeConnectedSourceSync, syncConnectedSource,
    }, now)).toEqual({ nextIndex: 0, attempted: true });
    expect(resumeConnectedSourceSync).toHaveBeenCalledWith('project-1', 'slack-1', 'partial-run', { maxPages: 5 });
    expect(syncConnectedSource).not.toHaveBeenCalled();
  });

  it('does not start a provider sync after the signed-in workspace closes', async () => {
    let active = true;
    const listConnectedSources = vi.fn(async () => {
      active = false;
      return [source()];
    });
    const syncConnectedSource = vi.fn(async () => undefined);
    const getConnectedSourceSyncHistory = vi.fn(async () => []);
    const resumeConnectedSourceSync = vi.fn(async () => undefined);
    expect(await reconcileOneDueSlackSource(['project-1'], 0, {
      listConnectedSources, syncConnectedSource, getConnectedSourceSyncHistory, resumeConnectedSourceSync,
    }, now, () => active)).toEqual({ nextIndex: 0, attempted: false });
    expect(syncConnectedSource).not.toHaveBeenCalled();
  });
});
