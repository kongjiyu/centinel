import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Artifact } from '../artifacts.js';
import type { AuthenticatedRequest } from '../auth/gateway.js';
import type { StaticAnalysisModelProvider } from '../review/types.js';
import type { ReadinessAssessment, ReadinessArtifact, ReadinessInput, ReadinessStatus } from './types.js';
import { classifyReadinessFailure, ReadinessPersistenceError, ReadinessSourceChangesError } from './failure.js';
import { assessProjectReadiness } from './engine.js';
import { sourceReadIssue } from './sourceIssues.js';
import { providerPause } from '../review/providerPause.js';

export type ReadinessJob = ReadinessStatus & { sourceFingerprint: string };
export type ReadinessIndex = { description: string; fingerprint: string; artifacts: Artifact[]; unavailable: ReadinessArtifact[]; preloaded?: ReadinessArtifact[]; importing: boolean };
export interface ReadinessStore { latest(projectId: string): Promise<ReadinessJob | null>; save(job: ReadinessJob): Promise<void> }
export type ReadinessDependencies = {
  store(auth: AuthenticatedRequest): ReadinessStore;
  inspect(auth: AuthenticatedRequest, projectId: string): Promise<ReadinessIndex>;
  read(auth: AuthenticatedRequest, artifact: Artifact, signal: AbortSignal): Promise<string>;
  provider(auth: AuthenticatedRequest, currentAuth?: () => AuthenticatedRequest): Pick<StaticAnalysisModelProvider, 'analyze'>;
  assess?: typeof assessProjectReadiness;
  now?: () => Date;
  debounceMs?: number;
  jobTimeoutMs?: number;
};

const SOURCE_READ_CONCURRENCY = 4;
const DEFAULT_READINESS_JOB_TIMEOUT_MS = 900_000;
const MAX_READINESS_JOB_TIMEOUT_MS = 1_200_000;

function readinessJobTimeoutMs(configured: number | undefined): number {
  if (configured === undefined || !Number.isFinite(configured)) return DEFAULT_READINESS_JOB_TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_READINESS_JOB_TIMEOUT_MS, Math.floor(configured)));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

async function readFrozenSourceBatch(
  index: ReadinessIndex,
  read: ReadinessDependencies['read'],
  authFor: () => AuthenticatedRequest,
  signal: AbortSignal,
): Promise<ReadinessArtifact[]> {
  const results = new Array<ReadinessArtifact>(index.artifacts.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      throwIfAborted(signal);
      const sourceIndex = next++;
      if (sourceIndex >= index.artifacts.length) return;
      const artifact = index.artifacts[sourceIndex];
      let unavailableReason: ReadinessArtifact['unavailableReason'];
      try {
        const content = await read(authFor(), artifact, signal);
        throwIfAborted(signal);
        if (content.includes('\0') || /^%PDF-|^PK\u0003\u0004/.test(content)) {
          unavailableReason = 'unsupported_format';
          throw new Error('Unsupported text extraction');
        }
        const expected = artifact.contentHash.replace(/^sha256:/, '');
        if (/^[a-f0-9]{64}$/i.test(expected)
          && crypto.createHash('sha256').update(content).digest('hex') !== expected.toLowerCase()) {
          unavailableReason = 'content_changed';
          throw new Error('Source hash mismatch');
        }
        results[sourceIndex] = { artifact, content };
      } catch (error) {
        if (signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
        results[sourceIndex] = {
          artifact,
          content: null,
          unavailableReason: unavailableReason ?? sourceReadIssue(error),
          error: 'The selected version could not be read as verified text. Refresh the source or provide a supported text document.',
        };
      }
    }
  };

  const workerCount = Math.min(SOURCE_READ_CONCURRENCY, index.artifacts.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  throwIfAborted(signal);
  return results;
}

export function emptyReadiness(projectId: string): ReadinessStatus {
  return { projectId, requestId: null, status: 'idle', trigger: null, requestedAt: null, startedAt: null, completedAt: null, error: null, errorCode: null, snapshot: null, stale: false };
}

/** Jobs are durable; bearer sessions and running promises stay in memory only. */
export class ProjectReadinessCoordinator {
  private sessions = new Map<string, AuthenticatedRequest>();
  private active = new Map<string, Promise<void>>();
  private locks = new Map<string, Promise<unknown>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private readonly deps: ReadinessDependencies) {}
  adoptSession(auth: AuthenticatedRequest) { this.sessions.set(auth.userId, auth); }
  private context(auth: AuthenticatedRequest) { return this.sessions.get(auth.userId) ?? auth; }
  private now() { return (this.deps.now?.() ?? new Date()).toISOString(); }
  private async serial<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.locks.set(projectId, next);
    try { return await next; } finally { if (this.locks.get(projectId) === next) this.locks.delete(projectId); }
  }

  private async latest(store: ReadinessStore, projectId: string): Promise<ReadinessJob | null> {
    try { return await store.latest(projectId); } catch { throw new ReadinessPersistenceError(); }
  }

  private async save(store: ReadinessStore, job: ReadinessJob): Promise<void> {
    try { await store.save(job); } catch { throw new ReadinessPersistenceError(); }
  }

  private async inspectSources(auth: AuthenticatedRequest, projectId: string): Promise<ReadinessIndex> {
    try { return await this.deps.inspect(auth, projectId); } catch { throw new ReadinessSourceChangesError(); }
  }

  /** Coalesce file batches; import/sync completion or GET recovery supplies durability. */
  notify(auth: AuthenticatedRequest, projectId: string, trigger: string) {
    this.adoptSession(auth);
    clearTimeout(this.timers.get(projectId));
    this.timers.set(projectId, setTimeout(() => {
      this.timers.delete(projectId);
      void this.request(this.context(auth), projectId, trigger).catch(() => undefined);
    }, this.deps.debounceMs ?? 750));
  }

  async status(auth: AuthenticatedRequest, projectId: string): Promise<ReadinessStatus> {
    return this.request(auth, projectId, 'source_check', false);
  }

  async request(auth: AuthenticatedRequest, projectId: string, trigger: string, force = false): Promise<ReadinessStatus> {
    this.adoptSession(auth);
    return this.serial(projectId, async () => {
      const context = this.context(auth);
      const index = await this.deps.inspect(context, projectId);
      const store = this.deps.store(context);
      let latest = await this.latest(store, projectId);
      if (latest && latest.projectId !== projectId) throw new Error('Readiness project mismatch');
      // Older workers saved capacity stops as failed. Recover the explicit
      // pause without another assessment or replacing their saved snapshot.
      const legacyPause = latest?.status === 'failed' ? providerPause({ code: latest.errorCode }) : null;
      if (latest && legacyPause) {
        latest = { ...latest, status: 'paused', errorCode: legacyPause.code, error: legacyPause.message };
        await this.save(store, latest);
      }
      // Reading status, syncing sources and restarting must not spend another
      // provider request after a capacity stop. Only manual Start/Retry releases it.
      if (latest?.status === 'paused' && !force) return { ...latest, stale: latest.snapshot?.sourceFingerprint !== index.fingerprint };
      // A remote-head check can temporarily queue readiness while a source run
      // is active. Reuse the verified assessment if that check changed nothing.
      if (!force && !index.importing && latest && latest.trigger !== 'manual' && ['queued', 'running'].includes(latest.status)
        && latest.snapshot?.sourceFingerprint === index.fingerprint) {
        latest = { ...latest, status: 'completed', sourceFingerprint: index.fingerprint,
          startedAt: null, completedAt: latest.snapshot.assessedAt, error: null, errorCode: null, stale: false };
        await this.save(store, latest);
        return latest;
      }
      if (latest?.sourceFingerprint === index.fingerprint) {
        if (['queued', 'running'].includes(latest.status)) {
          this.schedule(context, projectId);
          return { ...latest, stale: latest.snapshot?.sourceFingerprint !== index.fingerprint };
        }
        if (!force) return { ...latest, stale: latest.snapshot?.sourceFingerprint !== index.fingerprint };
      }
      const previousRequestedMs = Date.parse(latest?.requestedAt ?? '');
      const requestedAt = new Date(Math.max(Date.parse(this.now()), Number.isFinite(previousRequestedMs) ? previousRequestedMs + 1 : 0)).toISOString();
      latest = { ...emptyReadiness(projectId), requestId: crypto.randomUUID(), status: 'queued', trigger,
        requestedAt, snapshot: latest?.snapshot ?? null, stale: true, sourceFingerprint: index.fingerprint };
      await this.save(store, latest);
      this.schedule(context, projectId);
      return latest;
    });
  }

  private schedule(auth: AuthenticatedRequest, projectId: string) {
    if (this.active.has(projectId)) return;
    const task = new Promise<void>(resolve => setImmediate(() => {
      void this.drain(auth, projectId).catch(() => undefined).finally(() => { this.active.delete(projectId); resolve(); });
    }));
    this.active.set(projectId, task);
  }

  async waitForIdle() { while (this.active.size) await Promise.all([...this.active.values()]); }
  close() { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); }

  private async drain(original: AuthenticatedRequest, projectId: string) {
    for (;;) {
      let auth = this.context(original);
      let store = this.deps.store(auth);
      let job: ReadinessJob | null;
      try { job = await this.latest(store, projectId); } catch { return; }
      if (!job || !['queued', 'running'].includes(job.status)) return;
      const startedAt = job.startedAt ?? this.now();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const index = await this.inspectSources(auth, projectId);
        if (index.importing) return; // Source completion notification/GET resumes the saved job.
        if (index.fingerprint !== job.sourceFingerprint) { await this.request(auth, projectId, 'sources_changed'); continue; }
        await this.save(store, { ...job, status: 'running', startedAt, error: null, errorCode: null });
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), readinessJobTimeoutMs(this.deps.jobTimeoutMs));
        const artifacts: ReadinessArtifact[] = [
          ...index.unavailable,
          ...(index.preloaded ?? []),
          ...await readFrozenSourceBatch(index, this.deps.read, () => this.context(original), controller.signal),
        ];
        const input: ReadinessInput = { projectId, description: index.description, sourceFingerprint: index.fingerprint, artifacts };
        const provider = this.deps.provider(this.context(original), () => this.context(original));
        const snapshot: ReadinessAssessment = await (this.deps.assess ?? assessProjectReadiness)(input, provider, controller.signal);
        throwIfAborted(controller.signal);
        auth = this.context(original); store = this.deps.store(auth);
        let current = await this.inspectSources(auth, projectId);
        // Retain the validated result while an unchanged head check settles.
        // A real evidence change still fails the fingerprint comparison below.
        while (current.importing && current.fingerprint === job.sourceFingerprint) {
          await delay(1000, undefined, { signal: controller.signal });
          current = await this.inspectSources(this.context(original), projectId);
          throwIfAborted(controller.signal);
        }
        auth = this.context(original); store = this.deps.store(auth);
        const latest = await this.latest(store, projectId);
        throwIfAborted(controller.signal);
        if (latest?.requestId !== job.requestId) continue;
        if (current.importing || current.fingerprint !== job.sourceFingerprint) { await this.request(auth, projectId, 'sources_changed'); continue; }
        if (snapshot.projectId !== projectId || snapshot.sourceFingerprint !== job.sourceFingerprint) throw new ReadinessSourceChangesError();
        await this.save(store, { ...job, status: 'completed', startedAt, completedAt: this.now(), snapshot, error: null, errorCode: null, stale: false });
      } catch (error) {
        auth = this.context(original); store = this.deps.store(auth);
        try {
          const latest = await this.latest(store, projectId);
          const failure = classifyReadinessFailure(error);
          const capacityStop = providerPause({ code: failure.code });
          if (latest && (latest.requestId === job.requestId || capacityStop && ['queued', 'running'].includes(latest.status))) {
            await this.save(store, { ...latest, status: capacityStop ? 'paused' : 'failed', startedAt: latest.requestId === job.requestId ? startedAt : latest.startedAt, completedAt: this.now(), stale: true,
              error: failure.message, errorCode: failure.code });
          }
        } catch { /* A failed persistence attempt cannot safely be recorded. */ }
      } finally { if (timeout !== undefined) clearTimeout(timeout); }
      let next: ReadinessJob | null;
      try { next = await this.latest(this.deps.store(this.context(original)), projectId); } catch { return; }
      if (!next || !['queued', 'running'].includes(next.status)) return;
    }
  }
}
