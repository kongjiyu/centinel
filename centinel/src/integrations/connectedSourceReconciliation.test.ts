import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedSource } from '../types';
import {
  CONNECTED_SOURCE_RECONCILIATION_INTERVAL_MS as interval,
  reconcileOneDueConnectedSource,
  startConnectedSourceReconciliation,
} from './connectedSourceReconciliation';

const now = Date.parse('2026-10-29T04:00:00.000Z');

function source(patch: Partial<ConnectedSource> = {}): ConnectedSource {
  return {
    id: 'github-1', projectId: 'project-1', integrationId: 'integration-1', provider: 'github', kind: 'github_repository',
    remoteId: 'owner/repo', remoteUrl: null, name: 'repo', selectedScope: { branch: 'main' }, remoteRevision: 'abc',
    syncCursor: null, status: 'active', syncStatus: 'ready', lastSyncedAt: null, lastSuccessfulSyncAt: null,
    lastError: null, createdAt: '', updatedAt: '', ...patch,
  };
}

function apiWith(sources: ConnectedSource[]) {
  return {
    listConnectedSources: vi.fn(async (_projectId: string) => sources),
    syncConnectedSource: vi.fn(async (_projectId: string, _sourceId: string, _options: { maxPages: number; idempotencyKey: string }) => undefined),
    getConnectedSourceSyncHistory: vi.fn(async (_projectId: string, _sourceId: string) => [] as Array<{ id: string; status: string }>),
    resumeConnectedSourceSync: vi.fn(async (_projectId: string, _sourceId: string, _runId: string, _options: { maxPages: number }) => undefined),
  };
}

describe('authenticated connected-source reconciliation', () => {
  afterEach(() => vi.useRealTimers());

  it('checks every supported connected provider incrementally with bounded page budgets', async () => {
    for (const [provider, kind, maxPages] of [
      ['github', 'github_repository', 1],
      ['google_drive', 'google_drive', 5],
      ['slack', 'slack_channel', 5],
    ] as const) {
      const api = apiWith([source({ id: `${provider}-1`, provider, kind })]);
      await expect(reconcileOneDueConnectedSource(['project-1'], 0, api, now, new Map())).resolves.toEqual({ nextProjectIndex: 0, attempted: true });
      expect(api.syncConnectedSource).toHaveBeenCalledWith('project-1', `${provider}-1`, {
        maxPages,
        idempotencyKey: `source-periodic:${provider}:${provider}-1:${Math.floor(now / interval)}`,
      });
      expect(api.syncConnectedSource.mock.calls[0][2]).not.toHaveProperty('force');
    }
  });

  it('rotates to the least recently checked source and respects provider retry timing and active runs', async () => {
    const attempts = new Map<string, number>([['project-1:oldest', now - interval], ['project-1:newer', now - 1_000]]);
    const api = apiWith([
      source({ id: 'newest', latestSyncRun: { status: 'running' } as ConnectedSource['latestSyncRun'] }),
      source({ id: 'backoff', latestSyncRun: { status: 'failure', nextAttemptAt: new Date(now + 1).toISOString() } as ConnectedSource['latestSyncRun'] }),
      source({ id: 'newer', lastSyncedAt: new Date(now - 1_000).toISOString() }),
      source({ id: 'oldest', lastSyncedAt: new Date(now - interval).toISOString() }),
      source({ id: 'local', provider: 'local' as ConnectedSource['provider'], kind: 'local_directory' as ConnectedSource['kind'] }),
      source({ id: 'disconnected', status: 'disconnected' }),
    ]);
    await reconcileOneDueConnectedSource(['project-1'], 0, api, now, attempts);
    expect(api.syncConnectedSource).toHaveBeenCalledTimes(1);
    expect(api.syncConnectedSource.mock.calls[0][1]).toBe('oldest');
  });

  it('resumes a cursor-backed Slack partial run without starting a forced/full sync', async () => {
    const api = apiWith([source({
      id: 'slack-1', provider: 'slack', kind: 'slack_channel',
      syncCursor: { pageToken: 'next-page' },
      latestSyncRun: { id: 'partial-1', status: 'partial' } as ConnectedSource['latestSyncRun'],
    })]);
    api.getConnectedSourceSyncHistory.mockResolvedValue([{ id: 'partial-1', status: 'partial' }]);
    await reconcileOneDueConnectedSource(['project-1'], 0, api, now, new Map());
    expect(api.resumeConnectedSourceSync).toHaveBeenCalledWith('project-1', 'slack-1', 'partial-1', { maxPages: 5 });
    expect(api.syncConnectedSource).not.toHaveBeenCalled();
  });

  it('does not starve later projects after an inaccessible project', async () => {
    const api = {
      ...apiWith([source({ projectId: 'project-2', provider: 'google_drive', kind: 'google_drive' })]),
      listConnectedSources: vi.fn(async (projectId: string) => {
        if (projectId === 'project-1') throw new Error('inaccessible');
        return [source({ projectId: 'project-2', provider: 'google_drive', kind: 'google_drive' })];
      }),
    };
    await expect(reconcileOneDueConnectedSource(['project-1', 'project-2'], 0, api, now, new Map())).resolves.toEqual({ nextProjectIndex: 0, attempted: true });
    expect(api.syncConnectedSource).toHaveBeenCalledWith('project-2', 'github-1', expect.objectContaining({ maxPages: 5 }));
  });

  it('does not start a sync after the signed-in workspace becomes inactive during the source read', async () => {
    let active = true;
    const api = {
      ...apiWith([source()]),
      listConnectedSources: vi.fn(async () => { active = false; return [source()]; }),
    };
    await expect(reconcileOneDueConnectedSource(['project-1'], 0, api, now, new Map(), () => active))
      .resolves.toEqual({ nextProjectIndex: 0, attempted: false });
    expect(api.syncConnectedSource).not.toHaveBeenCalled();
  });

  it('starts after mount, prevents overlapping passes, ticks once per minute, and cleans up', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let finishProjects!: (projects: Array<{ id: string }>) => void;
    const api = {
      projects: vi.fn(() => new Promise<Array<{ id: string }>>(resolve => { finishProjects = resolve; })),
      ...apiWith([source()]),
    };
    const stop = startConnectedSourceReconciliation(api);
    try {
      await vi.advanceTimersByTimeAsync(4_999);
      expect(api.projects).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(api.projects).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(interval);
      expect(api.projects).toHaveBeenCalledTimes(1);
      finishProjects([{ id: 'project-1' }]);
      await vi.advanceTimersByTimeAsync(0);
      expect(api.syncConnectedSource).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(interval - 5_001);
      expect(api.projects).toHaveBeenCalledTimes(1);
      stop();
      await vi.advanceTimersByTimeAsync(1);
      window.dispatchEvent(new Event('focus'));
      expect(api.projects).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });
});
