import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../src/auth/gateway.js';
import { ConnectedSourceWorkerCoordinator } from '../../src/integrations/sourceWorker.js';
import type { ConnectedSourceSyncRun } from '../../src/integrations/types.js';

const auth = (accessToken: string) => ({ userId: 'owner-1', accessToken } as AuthenticatedRequest);

function syncRun(overrides: Partial<ConnectedSourceSyncRun> = {}): ConnectedSourceSyncRun {
  return {
    id: 'run-1', projectId: 'project-1', sourceId: 'source-1', status: 'partial', idempotencyKey: 'initial',
    remoteRevision: 'commit-1', cursorStart: { offset: 0 }, cursorEnd: { offset: 1 }, attemptCount: 1,
    importedCount: 1, updatedCount: 0, unchangedCount: 0, removedCount: 0, inaccessibleCount: 0,
    errorCode: null, errorMessage: null, retryable: false, startedAt: '2026-10-13T00:00:00.000Z',
    completedAt: null, createdAt: '2026-10-13T00:00:00.000Z', ...overrides,
  };
}

describe('connected-source background worker', () => {
  it('continues every partial page until the durable run is complete', async () => {
    const calls: Array<{ authToken: string; runId: string; maxPages: number }> = [];
    let page = 1;
    const onRunFinished = vi.fn();
    const worker = new ConnectedSourceWorkerCoordinator({
      onRunFinished,
      createImporter: currentAuth => ({
        resumeSync: vi.fn(async input => {
          calls.push({ authToken: currentAuth.accessToken, runId: input.runId, maxPages: input.maxPages ?? 0 });
          page++;
          return { run: syncRun({ status: page > 3 ? 'success' : 'partial', cursorEnd: { offset: page } }) };
        }),
        failStalledRun: vi.fn(async () => null),
      }),
    });

    worker.enqueue(auth('first-session'), { projectId: 'project-1', sourceId: 'source-1', runId: 'run-1' });
    await worker.waitForIdle();

    expect(calls).toHaveLength(3);
    expect(calls.map(call => call.runId)).toEqual(['run-1', 'run-1', 'run-1']);
    expect(calls.every(call => call.maxPages === 1)).toBe(true);
    expect(onRunFinished).toHaveBeenCalledOnce();
    expect(onRunFinished.mock.calls[0]?.[2]).toMatchObject({ status: 'success' });
  });

  it('terminalizes a repeated cursor and notifies readiness after a bounded number of batches', async () => {
    const resumeLeaseTokens: string[] = [];
    const resumeSync = vi.fn(async (input: { workerLeaseToken?: string }) => {
      resumeLeaseTokens.push(input.workerLeaseToken ?? '');
      return { run: syncRun({ status: 'partial', cursorEnd: { offset: 1 } }) };
    });
    const failStalledRun = vi.fn(async () => syncRun({
      status: 'failure', errorCode: 'source_cursor_stalled',
      errorMessage: 'Synchronization stopped because the source repeated its pagination cursor.',
    }));
    const onRunFinished = vi.fn();
    const worker = new ConnectedSourceWorkerCoordinator({
      createImporter: () => ({ resumeSync, failStalledRun }),
      onRunFinished,
    });

    worker.enqueue(auth('owner-session'), { projectId: 'project-1', sourceId: 'source-1', runId: 'run-1' });
    await worker.waitForIdle();

    expect(resumeSync).toHaveBeenCalledTimes(3);
    expect(failStalledRun).toHaveBeenCalledOnce();
    expect(failStalledRun.mock.calls[0]?.[0]).toMatchObject({
      ownerId: 'owner-1', projectId: 'project-1', sourceId: 'source-1', runId: 'run-1',
      expectedCursorKey: JSON.stringify({ offset: 1 }),
    });
    const leaseToken = failStalledRun.mock.calls[0]?.[0].workerLeaseToken;
    expect(typeof leaseToken).toBe('string');
    expect(resumeLeaseTokens).toEqual([leaseToken, leaseToken, leaseToken]);
    expect(onRunFinished).toHaveBeenCalledOnce();
    expect(onRunFinished.mock.calls[0]?.[2]).toMatchObject({ status: 'failure', errorCode: 'source_cursor_stalled' });
  });

  it('notifies readiness after an unexpected worker failure using the latest authenticated session', async () => {
    const onRunFailed = vi.fn();
    const worker = new ConnectedSourceWorkerCoordinator({
      createImporter: () => ({
        resumeSync: vi.fn(async () => { throw new Error('provider request failed'); }),
        failStalledRun: vi.fn(async () => null),
      }),
      onRunFailed,
    });
    worker.enqueue(auth('old-session'), { projectId: 'project-1', sourceId: 'source-1', runId: 'run-1' });
    worker.adoptSession(auth('rotated-session'));
    await worker.waitForIdle();

    expect(onRunFailed).toHaveBeenCalledOnce();
    expect(onRunFailed.mock.calls[0]?.[0].accessToken).toBe('rotated-session');
    expect(onRunFailed.mock.calls[0]?.[1]).toEqual({ projectId: 'project-1', sourceId: 'source-1', runId: 'run-1' });
  });

  it('deduplicates concurrent enqueues and uses the latest authenticated bearer for recovery', async () => {
    const calls: string[] = [];
    const worker = new ConnectedSourceWorkerCoordinator({
      createImporter: currentAuth => ({
        resumeSync: vi.fn(async () => {
          calls.push(currentAuth.accessToken);
          return { run: syncRun({ status: 'success' }) };
        }),
        failStalledRun: vi.fn(async () => null),
      }),
    });
    const firstAuth = auth('old-session');
    worker.enqueue(firstAuth, { projectId: 'project-1', sourceId: 'source-1', runId: 'run-1' });
    const rotatedAuth = auth('rotated-session');
    worker.adoptSession(rotatedAuth);
    worker.enqueue(rotatedAuth, { projectId: 'project-1', sourceId: 'source-1', runId: 'run-1' });
    await worker.waitForIdle();

    expect(calls).toEqual(['rotated-session']);
  });
});
