import crypto from 'node:crypto';
import type { AuthenticatedRequest } from '../auth/gateway.js';
import type { ConnectedSource, ConnectedSourceSyncInput, ConnectedSourceSyncRun } from './types.js';

export type BackgroundSourceJob = { projectId: string; sourceId: string; runId: string };
type BackgroundSyncImporter = {
  resumeSync(input: Omit<ConnectedSourceSyncInput, 'idempotencyKey'> & { runId: string }): Promise<{ run: ConnectedSourceSyncRun }>;
  failStalledRun(input: Omit<ConnectedSourceSyncInput, 'idempotencyKey'> & { runId: string; expectedCursorKey: string }): Promise<ConnectedSourceSyncRun | null>;
};

export type ConnectedSourceWorkerCoordinatorOptions = {
  createImporter(auth: AuthenticatedRequest): BackgroundSyncImporter;
  maxPagesPerBatch?: number;
  leaseSeconds?: number;
  onUnexpectedError?: (cause: unknown, job: BackgroundSourceJob) => void;
  onRunFailed?: (auth: AuthenticatedRequest, job: BackgroundSourceJob) => void;
  onRunFinished?: (auth: AuthenticatedRequest, job: BackgroundSourceJob, run: ConnectedSourceSyncRun) => void;
};

/**
 * Sidecar-local worker loop for durable RLS-scoped source runs. User bearer
 * tokens are held in memory only and replaced by each authenticated request;
 * the run table contains cursors/progress plus an opaque, expiring claim.
 */
export class ConnectedSourceWorkerCoordinator {
  private readonly sessions = new Map<string, AuthenticatedRequest>();
  private readonly active = new Map<string, Promise<void>>();
  private readonly createImporter: ConnectedSourceWorkerCoordinatorOptions['createImporter'];
  private readonly maxPagesPerBatch: number;
  private readonly onUnexpectedError: NonNullable<ConnectedSourceWorkerCoordinatorOptions['onUnexpectedError']>;
  private readonly onRunFailed: ConnectedSourceWorkerCoordinatorOptions['onRunFailed'];
  private readonly onRunFinished: ConnectedSourceWorkerCoordinatorOptions['onRunFinished'];

  constructor(options: ConnectedSourceWorkerCoordinatorOptions) {
    this.createImporter = options.createImporter;
    this.maxPagesPerBatch = Math.max(1, Math.min(10, options.maxPagesPerBatch ?? 1));
    this.onUnexpectedError = options.onUnexpectedError ?? (() => undefined);
    this.onRunFailed = options.onRunFailed;
    this.onRunFinished = options.onRunFinished;
  }

  /** Adopt only a bearer already validated by AuthGateway on this request. */
  adoptSession(auth: AuthenticatedRequest): void {
    this.sessions.set(auth.userId, auth);
  }

  /** Schedule after the project response has been written by the caller. */
  enqueue(auth: AuthenticatedRequest, job: BackgroundSourceJob): void {
    this.adoptSession(auth);
    const key = this.jobKey(job);
    if (this.active.has(key)) return;
    const task = new Promise<void>(resolve => {
      setImmediate(() => {
        void this.drain(auth.userId, job).catch(cause => {
          try { this.onUnexpectedError(cause, job); } catch { /* Keep the worker cleanup path alive. */ }
          try { this.onRunFailed?.(this.sessions.get(auth.userId) ?? auth, job); } catch { /* Notification is best effort. */ }
        }).finally(() => {
          this.active.delete(key);
          resolve();
        });
      });
    });
    this.active.set(key, task);
  }

  /** Restart recovery is invoked only from an authenticated, member-checked Source read. */
  recoverProject(auth: AuthenticatedRequest, projectId: string, sources: ConnectedSource[]): void {
    this.adoptSession(auth);
    const now = Date.now();
    for (const source of sources) {
      const run = source.latestSyncRun;
      if (!run || run.projectId !== projectId || run.sourceId !== source.id) continue;
      if (run.errorCode || run.retryable) continue;
      const leaseUntil = run.leaseExpiresAt ? Date.parse(run.leaseExpiresAt) : Number.NEGATIVE_INFINITY;
      const activeLease = Number.isFinite(leaseUntil) && leaseUntil > now;
      const recoverable = run.status === 'queued' || run.status === 'partial' || run.status === 'running' && !activeLease;
      if (recoverable) this.enqueue(auth, { projectId, sourceId: source.id, runId: run.id });
    }
  }

  async waitForIdle(): Promise<void> {
    await Promise.all(Array.from(this.active.values()));
  }

  private async drain(ownerId: string, job: BackgroundSourceJob): Promise<void> {
    const leaseToken = crypto.randomUUID();
    let previousCursor = '';
    let repeatedCursorBatches = 0;
    while (true) {
      const auth = this.sessions.get(ownerId);
      if (!auth || auth.userId !== ownerId) return;
      const importer = this.createImporter(auth);
      const result = await importer.resumeSync({
        ownerId,
        projectId: job.projectId,
        sourceId: job.sourceId,
        runId: job.runId,
        maxPages: this.maxPagesPerBatch,
        workerLeaseToken: leaseToken,
      });
      const run = result.run;
      if (run.status !== 'partial' || run.errorCode || run.retryable) { this.onRunFinished?.(auth, job, run); return; }

      const nextCursor = JSON.stringify(run.cursorEnd ?? run.cursorStart ?? null);
      if (nextCursor === previousCursor) repeatedCursorBatches++;
      else repeatedCursorBatches = 0;
      if (repeatedCursorBatches >= 2) {
        const failedRun = await importer.failStalledRun({
          ownerId,
          projectId: job.projectId,
          sourceId: job.sourceId,
          runId: job.runId,
          expectedCursorKey: nextCursor,
          workerLeaseToken: leaseToken,
        });
        if (failedRun) this.onRunFinished?.(auth, job, failedRun);
        return;
      }
      previousCursor = nextCursor;
    }
  }

  private jobKey(job: BackgroundSourceJob): string {
    return `${job.projectId}:${job.sourceId}:${job.runId}`;
  }
}
