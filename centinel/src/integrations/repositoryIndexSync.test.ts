import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRepositoryIndexSync, REPOSITORY_INDEX_SYNC_INTERVAL_MS } from './repositoryIndexSync';

afterEach(() => { vi.useRealTimers(); });
describe('workspace repository index background sync', () => {
  it('starts after rendering, uses two workers and reads the already-loaded project list', async () => {
    vi.useFakeTimers();
    const pending: Array<() => void> = [];
    const syncRepositoryIndex = vi.fn((_id: string, _signal?: AbortSignal) => new Promise<void>(resolve => pending.push(resolve)));
    let ids = ['one', 'two', 'three'];
    const stop = startRepositoryIndexSync({ syncRepositoryIndex }, () => ids);
    expect(syncRepositoryIndex).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(syncRepositoryIndex.mock.calls.map(call => call[0])).toEqual(['one', 'two']);
    pending.shift()!(); await Promise.resolve();
    expect(syncRepositoryIndex.mock.calls.map(call => call[0])).toEqual(['one', 'two', 'three']);
    for (const resolve of pending.splice(0)) resolve(); await Promise.resolve(); await Promise.resolve();
    ids = ['updated'];
    await vi.advanceTimersByTimeAsync(REPOSITORY_INDEX_SYNC_INTERVAL_MS + 30_000);
    expect(syncRepositoryIndex.mock.calls.at(-1)?.[0]).toBe('updated');
    stop();
  });
  it('continues after one project fails and avoids repeated focus passes', async () => {
    vi.useFakeTimers();
    const syncRepositoryIndex = vi.fn(async () => { throw new Error('unavailable'); });
    const stop = startRepositoryIndexSync({ syncRepositoryIndex }, () => ['a', 'b', 'c']);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(syncRepositoryIndex).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event('focus')); await Promise.resolve();
    expect(syncRepositoryIndex).toHaveBeenCalledTimes(3);
    stop();
  });
  it('aborts in-flight downloads and stops launching projects after signout', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const releases: Array<() => void> = [];
    const syncRepositoryIndex = vi.fn((_id: string, signal?: AbortSignal) => {
      signals.push(signal!); return new Promise<void>(resolve => releases.push(resolve));
    });
    const stop = startRepositoryIndexSync({ syncRepositoryIndex }, () => ['a', 'b', 'c']);
    await vi.advanceTimersByTimeAsync(5_000); stop();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    releases.forEach(resolve => resolve());
    await vi.advanceTimersByTimeAsync(REPOSITORY_INDEX_SYNC_INTERVAL_MS);
    expect(syncRepositoryIndex).toHaveBeenCalledTimes(2);
  });
});
