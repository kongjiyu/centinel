import { describe, expect, it, vi } from 'vitest';
import type { ConnectedSource } from '../types';
import { GITHUB_RECONCILIATION_INTERVAL_MS as interval, reconcileOneDueGitHubSource, startGitHubReconciliation } from './githubReconciliation';

const now = Date.parse('2026-10-20T12:00:00Z');
const source = (patch: Partial<ConnectedSource> = {}): ConnectedSource => ({
  id: 'github-1', projectId: 'p1', integrationId: 'i1', provider: 'github', kind: 'github_repository',
  remoteId: 'acme/demo', remoteUrl: null, name: 'demo', selectedScope: { branch: 'main' },
  remoteRevision: 'old', syncCursor: null, status: 'active', syncStatus: 'ready', lastSyncedAt: null,
  lastSuccessfulSyncAt: null, lastError: null, createdAt: '', updatedAt: '', ...patch,
});

describe('automatic GitHub source checks', () => {
  it('starts automatically, prevents overlapping ticks, and cleans up on workspace exit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let finishProjects!: (value: Array<{ id: string }>) => void;
    const api = {
      projects: vi.fn(() => new Promise<Array<{ id: string }>>(resolve => { finishProjects = resolve; })),
      listConnectedSources: vi.fn(async () => [source()]), syncConnectedSource: vi.fn(async () => undefined),
    };
    const stop = startGitHubReconciliation(api);
    try {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(api.projects).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(api.projects).toHaveBeenCalledTimes(1);
      finishProjects([{ id: 'p1' }]);
      await vi.advanceTimersByTimeAsync(0);
      expect(api.syncConnectedSource).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(25_000);
      expect(api.projects).toHaveBeenCalledTimes(2);
      stop();
      finishProjects([{ id: 'p1' }]);
      await vi.advanceTimersByTimeAsync(interval);
      window.dispatchEvent(new Event('focus'));
      expect(api.projects).toHaveBeenCalledTimes(2);
      expect(api.listConnectedSources).toHaveBeenCalledTimes(1);
    } finally { stop(); vi.useRealTimers(); }
  });
  it('checks one due repository with a bounded import and an idempotent time bucket', async () => {
    const api = { listConnectedSources: vi.fn(async () => [source()]), syncConnectedSource: vi.fn(async () => undefined) };
    expect(await reconcileOneDueGitHubSource(['p1', 'p2'], 0, api, now, new Map())).toEqual({ nextIndex: 1, attempted: true });
    expect(api.syncConnectedSource).toHaveBeenCalledWith('p1', 'github-1', { maxPages: 1, idempotencyKey: `github-periodic:github-1:${Math.floor(now / interval)}` });
  });

  it('skips local and other providers, recent checks, disconnected and active imports', async () => {
    const api = { listConnectedSources: vi.fn(async () => [
      source({ provider: 'local' as ConnectedSource['provider'], kind: 'local_directory' as ConnectedSource['kind'] }),
      source({ provider: 'google_drive' }), source({ status: 'disconnected' }), source({ status: 'inaccessible' }),
      source({ syncStatus: 'syncing' }), source({ lastSyncedAt: new Date(now - 1).toISOString() }),
      source({ latestSyncRun: { status: 'partial' } as ConnectedSource['latestSyncRun'] }),
      source({ latestSyncRun: { status: 'queued' } as ConnectedSource['latestSyncRun'] }),
      source({ latestSyncRun: { status: 'failure', nextAttemptAt: new Date(now + interval).toISOString() } as ConnectedSource['latestSyncRun'] }),
    ]), syncConnectedSource: vi.fn() };
    expect((await reconcileOneDueGitHubSource(['p1'], 0, api, now, new Map())).attempted).toBe(false);
    expect(api.syncConnectedSource).not.toHaveBeenCalled();
  });

  it('throttles failures and gives the next source a turn, then permits a later retry', async () => {
    const attempts = new Map<string, number>();
    const api = { listConnectedSources: vi.fn(async () => [source(), source({ id: 'github-2' })]), syncConnectedSource: vi.fn(async (_projectId: string, _sourceId: string) => { throw new Error('offline'); }) };
    await reconcileOneDueGitHubSource(['p1'], 0, api, now, attempts);
    await reconcileOneDueGitHubSource(['p1'], 0, api, now + 30_000, attempts);
    expect(api.syncConnectedSource.mock.calls.map(call => call[1])).toEqual(['github-1', 'github-2']);
    expect((await reconcileOneDueGitHubSource(['p1'], 0, api, now + 60_000, attempts)).attempted).toBe(false);
    await reconcileOneDueGitHubSource(['p1'], 0, api, now + interval, attempts);
    expect(api.syncConnectedSource).toHaveBeenCalledTimes(3);
  });

  it('allows a later retry of an interrupted failed import without forcing a fresh snapshot', async () => {
    const api = { listConnectedSources: vi.fn(async () => [source({ syncStatus: 'error',
      latestSyncRun: { status: 'partial', errorCode: 'http_503', retryable: true } as ConnectedSource['latestSyncRun'] })]), syncConnectedSource: vi.fn() };
    expect((await reconcileOneDueGitHubSource(['p1'], 0, api, now, new Map())).attempted).toBe(true);
    expect(api.syncConnectedSource).toHaveBeenCalledWith('p1', 'github-1', expect.not.objectContaining({ force: true }));
  });

  it('bounds project scans and continues past inaccessible projects', async () => {
    const api = { listConnectedSources: vi.fn(async () => { throw new Error('denied'); }), syncConnectedSource: vi.fn() };
    expect(await reconcileOneDueGitHubSource(Array.from({ length: 12 }, (_, i) => `p${i}`), 0, api, now, new Map())).toEqual({ nextIndex: 10, attempted: false });
    expect(api.listConnectedSources).toHaveBeenCalledTimes(10);
    expect(api.syncConnectedSource).not.toHaveBeenCalled();
  });

  it('does not starve later sources when a project has more repositories than one interval can process', async () => {
    const attempts = new Map<string, number>();
    const api = { listConnectedSources: vi.fn(async () => Array.from({ length: 12 }, (_, i) => source({ id: `repo-${i}` }))),
      syncConnectedSource: vi.fn(async (_projectId: string, _sourceId: string) => undefined) };
    for (let i = 0; i < 12; i++) await reconcileOneDueGitHubSource(['p1'], 0, api, now + i * 30_000, attempts);
    expect(new Set(api.syncConnectedSource.mock.calls.map(call => call[1])).size).toBe(12);
  });

  it('does not start a sync after sign-out or account change during a source read', async () => {
    let active = true;
    const api = { listConnectedSources: vi.fn(async () => { active = false; return [source()]; }), syncConnectedSource: vi.fn() };
    expect((await reconcileOneDueGitHubSource(['p1'], 0, api, now, new Map(), () => active)).attempted).toBe(false);
    expect(api.syncConnectedSource).not.toHaveBeenCalled();
  });
});
