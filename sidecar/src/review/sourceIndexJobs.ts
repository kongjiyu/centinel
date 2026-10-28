import crypto from 'node:crypto';
import type { Artifact } from '../artifacts.js';
import type { AuthenticatedRequest } from '../auth/gateway.js';
import { RefreshableSupabaseRuntime } from '../runtime/supabaseRuntime.js';
import { providerPause } from './providerPause.js';
import type { RepositoryIndexIdentity } from './repositoryIndexSnapshot.js';

export type SourceIndexJob = {
  id: string; projectId: string; ownerId: string; fingerprint: string; revision: number;
  state: 'queued' | 'running' | 'ready' | 'paused' | 'failed' | 'superseded';
  trigger: 'source_changed' | 'review' | 'manual'; updatedAt: string;
  leaseToken: string | null; leaseUntil: number | null; errorCode: string | null;
};
export interface SourceIndexJobStore {
  get(id: string): Promise<SourceIndexJob | null>;
  latest(projectId: string, ownerId: string): Promise<SourceIndexJob | null>;
  insert(job: SourceIndexJob): Promise<boolean>;
  compareAndSet(previous: SourceIndexJob, next: SourceIndexJob): Promise<boolean>;
  hold(projectId: string, ownerId: string): Promise<SourceIndexHold | null>;
  compareHold(projectId: string, ownerId: string, previous: SourceIndexHold | null, next: SourceIndexHold): Promise<boolean>;
}
export type SourceIndexHold = { revision: number; code: string | null };
type Dependencies = {
  store(auth: AuthenticatedRequest): SourceIndexJobStore;
  artifacts(auth: AuthenticatedRequest, projectId: string, signal?: AbortSignal): Promise<Artifact[]>;
  describe(auth: AuthenticatedRequest, projectId: string, artifacts: Artifact[], signal?: AbortSignal): Promise<RepositoryIndexIdentity>;
  build(auth: () => AuthenticatedRequest, projectId: string, artifacts: Artifact[], signal: AbortSignal,
    guard: () => Promise<void>, reviewId?: string, reader?: (artifact: Artifact, signal?: AbortSignal) => Promise<string>): Promise<void>;
  now?: () => number; leaseMs?: number; heartbeatMs?: number; pollMs?: number;
  onError?: (code: string) => void;
};
export function sourceIndexJobId(projectId: string, fingerprint: string): string {
  const hex = crypto.createHash('sha256').update(`source-index-job-v1:${projectId}:${fingerprint}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export class SourceIndexStopped extends Error {
  constructor(readonly code: string) { super(`Source indexing stopped: ${code}.`); }
}
export function assertSourceIndexProviderAllowed(projectId: string): void {
  const allowed = process.env.CENTINEL_AI_ASSESSMENT_PROJECT_ALLOWLIST?.split(',').map(id => id.trim()).filter(Boolean);
  if (process.env.CENTINEL_AI_ASSESSMENT_PAUSED === '1' || allowed && !allowed.includes(projectId))
    throw new SourceIndexStopped('assessment_paused');
}

/** Durable, member-scoped build claims shared by source events and Reviews.
 * GET recovery resumes recorded work only; it never creates a paid build. */
export class SourceIndexCoordinator {
  private sessions = new Map<string, { auth: AuthenticatedRequest; runtime: RefreshableSupabaseRuntime }>();
  private active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private closed = false;
  private now: () => number;
  constructor(private deps: Dependencies) { this.now = deps.now ?? Date.now; }
  adoptSession(auth: AuthenticatedRequest): void {
    const current = this.sessions.get(auth.userId);
    if (!current) this.sessions.set(auth.userId, { auth, runtime: new RefreshableSupabaseRuntime({ ...auth }) });
    else if (current.runtime.adoptVerifiedSession(auth)) current.auth = auth;
  }
  private auth(ownerId: string): AuthenticatedRequest {
    const session = this.sessions.get(ownerId);
    if (!session || this.closed) throw new SourceIndexStopped('session_unavailable');
    return session.auth;
  }
  private store(ownerId: string) { return this.deps.store(this.auth(ownerId)); }
  private change(job: SourceIndexJob, patch: Partial<SourceIndexJob>): SourceIndexJob {
    return { ...job, ...patch, revision: job.revision + 1, updatedAt: new Date(this.now()).toISOString() };
  }
  private allowed(projectId: string) {
    assertSourceIndexProviderAllowed(projectId);
  }
  /** Persist the event before returning; provider work starts separately. */
  async notify(auth: AuthenticatedRequest, projectId: string): Promise<SourceIndexJob> {
    this.adoptSession(auth);
    const artifacts = await this.deps.artifacts(this.auth(auth.userId), projectId);
    const identity = await this.deps.describe(this.auth(auth.userId), projectId, artifacts);
    const job = await this.queue(auth.userId, projectId, identity, 'source_changed');
    if (job.ownerId === auth.userId) this.schedule(job, artifacts);
    return job;
  }
  async recover(auth: AuthenticatedRequest, projectId: string): Promise<SourceIndexJob | null> {
    this.adoptSession(auth);
    const job = await this.store(auth.userId).latest(projectId, auth.userId);
    const hold = await this.store(auth.userId).hold(projectId, auth.userId);
    if (hold?.code && job) return { ...job, state: 'paused', errorCode: hold.code };
    if (job?.state === 'paused') return job;
    const artifacts = await this.deps.artifacts(this.auth(auth.userId), projectId);
    const identity = await this.deps.describe(this.auth(auth.userId), projectId, artifacts);
    const current = await this.store(auth.userId).get(sourceIndexJobId(projectId, identity.fingerprint));
    if (hold?.code && current) return { ...current, state: 'paused', errorCode: hold.code };
    if (current?.ownerId === auth.userId && ['queued', 'running'].includes(current.state)) this.schedule(current, artifacts);
    return current;
  }
  async resume(auth: AuthenticatedRequest, projectId: string): Promise<SourceIndexJob> {
    this.adoptSession(auth);
    const artifacts = await this.deps.artifacts(this.auth(auth.userId), projectId);
    const identity = await this.deps.describe(this.auth(auth.userId), projectId, artifacts);
    const hold = await this.store(auth.userId).hold(projectId, auth.userId);
    if (hold?.code && !await this.store(auth.userId).compareHold(projectId, auth.userId, hold, { revision: hold.revision + 1, code: null }))
      throw new SourceIndexStopped('hold_changed');
    const job = await this.queue(auth.userId, projectId, identity, 'manual', true);
    if (job.ownerId === auth.userId) this.schedule(job, artifacts);
    return job;
  }
  async ensure(auth: AuthenticatedRequest, projectId: string, artifacts: Artifact[], signal?: AbortSignal, reviewId?: string,
    reader?: (artifact: Artifact, signal?: AbortSignal) => Promise<string>): Promise<void> {
    this.adoptSession(auth);
    const identity = await this.deps.describe(this.auth(auth.userId), projectId, artifacts, signal);
    const deadline = Date.now() + 600_000;
    for (;;) {
      signal?.throwIfAborted();
      if (Date.now() >= deadline) throw new SourceIndexStopped('index_wait_timeout');
      const job = await this.queue(auth.userId, projectId, identity, 'review');
      // Review never silently resumes a capacity-paused source build.
      if (job.state === 'paused') throw new SourceIndexStopped(job.errorCode ?? 'index_paused');
      if (job.state === 'running' && (job.leaseUntil ?? 0) > this.now() && !this.active.has(job.id)) {
        await delay(this.deps.pollMs ?? 2_000, signal);
        const updated = await this.store(auth.userId).get(job.id);
        if (updated && ['failed', 'superseded'].includes(updated.state)) throw new SourceIndexStopped(updated.errorCode ?? 'index_failed');
        continue;
      }
      if (job.ownerId !== auth.userId) throw new SourceIndexStopped('index_owned_by_another_member');
      try { await this.execute(job, artifacts, signal, reviewId, reader); return; }
      catch (cause) {
        if (!(cause instanceof SourceIndexStopped) || cause.code !== 'index_build_in_progress') throw cause;
        await delay(this.deps.pollMs ?? 2_000, signal);
      }
    }
  }
  private async queue(ownerId: string, projectId: string, identity: RepositoryIndexIdentity, trigger: SourceIndexJob['trigger'], force = false): Promise<SourceIndexJob> {
    const store = this.store(ownerId); const id = sourceIndexJobId(projectId, identity.fingerprint);
    const existing = await store.get(id);
    const previous = await store.latest(projectId, ownerId);
    const hold = await store.hold(projectId, ownerId);
    const held = !force && (hold ? hold.code !== null : previous?.state === 'paused');
    const holdCode = hold?.code ?? previous?.errorCode ?? 'index_paused';
    if (held && existing?.ownerId !== ownerId && existing) throw new SourceIndexStopped(holdCode);
    if (existing?.state === 'paused' && existing.ownerId !== ownerId
      && !(await store.hold(projectId, existing.ownerId))?.code) throw new SourceIndexStopped('owner_hold_unavailable');
    if (held && existing && existing.state !== 'paused') {
      const paused = this.change(existing, { state: 'paused', errorCode: holdCode, leaseToken: null, leaseUntil: null });
      return await store.compareAndSet(existing, paused) ? paused : (await store.get(id))!;
    }
    if (existing && !(force && (['paused', 'failed', 'superseded'].includes(existing.state) || previous?.state === 'paused'))) {
      if (existing.ownerId !== ownerId && (existing.state === 'ready' || existing.state === 'queued'
        || existing.state === 'running' && (existing.leaseUntil ?? 0) <= this.now())) {
        const adopted = this.change(existing, { ownerId });
        return await store.compareAndSet(existing, adopted) ? adopted : (await store.get(id))!;
      }
      return existing;
    }
    // Source changes do not restart an owner's capacity-paused project.
    const job: SourceIndexJob = { id, projectId, ownerId, fingerprint: identity.fingerprint, revision: 0,
      state: held ? 'paused' : 'queued', trigger, updatedAt: new Date(this.now()).toISOString(),
      leaseToken: null, leaseUntil: null, errorCode: held ? holdCode : null };
    if (existing) {
      const next = this.change(existing, { ...job, ownerId });
      return await store.compareAndSet(existing, next) ? next : (await store.get(id))!;
    }
    return await store.insert(job) ? job : (await store.get(id))!;
  }
  private schedule(job: SourceIndexJob, artifacts?: Artifact[]) {
    if (this.closed || this.active.has(job.id) || !['queued', 'running'].includes(job.state)) return;
    setImmediate(() => { if (!this.closed) void this.execute(job, artifacts).catch(() => this.deps.onError?.('source_index_job_stopped')); });
  }
  private async execute(job: SourceIndexJob, supplied?: Artifact[], signal?: AbortSignal, reviewId?: string,
    reader?: (artifact: Artifact, signal?: AbortSignal) => Promise<string>): Promise<void> {
    signal?.throwIfAborted();
    const active = this.active.get(job.id);
    if (active) {
      // A Review abandoning its wait must not cancel a source-event build.
      await waitFor(active.promise, signal); return;
    }
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    const promise = this.run(job, supplied, combined, reviewId, reader);
    this.active.set(job.id, { controller, promise });
    try { await promise; } finally { if (this.active.get(job.id)?.promise === promise) this.active.delete(job.id); }
  }
  private async run(initial: SourceIndexJob, supplied: Artifact[] | undefined, requestSignal: AbortSignal, reviewId?: string,
    reader?: (artifact: Artifact, signal?: AbortSignal) => Promise<string>): Promise<void> {
    const leaseAbort = new AbortController();
    const signal = AbortSignal.any([requestSignal, leaseAbort.signal]);
    const ownerId = initial.ownerId; const store = () => this.store(ownerId);
    let job = (await store().get(initial.id))!;
    if (!job) throw new SourceIndexStopped('job_missing');
    // Another member's live claim cannot use this member's credentials.
    if (job.ownerId !== ownerId) throw new SourceIndexStopped('index_owned_by_another_member');
    if (job.state === 'paused') throw new SourceIndexStopped(job.errorCode ?? 'index_paused');
    if (job.state === 'running' && (job.leaseUntil ?? 0) > this.now()) throw new SourceIndexStopped('index_build_in_progress');
    const token = crypto.randomUUID(); const leaseMs = this.deps.leaseMs ?? 120_000;
    const claimed = this.change(job, { state: 'running', leaseToken: token, leaseUntil: this.now() + leaseMs, errorCode: null });
    if (!await store().compareAndSet(job, claimed)) throw new SourceIndexStopped('index_build_in_progress');
    job = claimed;
    let chain = Promise.resolve(); let heartbeatFailure: unknown;
    const renew = async () => {
      signal.throwIfAborted(); this.allowed(job.projectId);
      const hold = await store().hold(job.projectId, ownerId);
      if (hold?.code) throw new SourceIndexStopped(hold.code);
      const persisted = await store().get(job.id);
      if (!persisted || persisted.leaseToken !== token || persisted.state !== 'running' || (persisted.leaseUntil ?? 0) <= this.now())
        throw new SourceIndexStopped('lease_lost');
      const next = this.change(persisted, { leaseUntil: this.now() + leaseMs });
      if (!await store().compareAndSet(persisted, next)) throw new SourceIndexStopped('lease_lost');
      job = next;
    };
    const guard = async () => {
      if (heartbeatFailure) throw heartbeatFailure;
      chain = chain.then(renew); await chain;
      if (!reviewId) {
        const auth = this.auth(ownerId);
        const latest = await this.deps.artifacts(auth, job.projectId, signal);
        const identity = await this.deps.describe(this.auth(ownerId), job.projectId, latest, signal);
        if (identity.fingerprint !== job.fingerprint) throw new SourceIndexStopped('source_superseded');
      }
    };
    const heartbeat = setInterval(() => { chain = chain.then(renew).catch(cause => { heartbeatFailure = cause; leaseAbort.abort(); }); }, this.deps.heartbeatMs ?? 30_000);
    heartbeat.unref?.();
    try {
      await guard();
      const artifacts = supplied ?? await this.deps.artifacts(this.auth(ownerId), job.projectId, signal);
      const identity = await this.deps.describe(this.auth(ownerId), job.projectId, artifacts, signal);
      if (identity.fingerprint !== job.fingerprint) throw new SourceIndexStopped('source_superseded');
      await this.deps.build(() => this.auth(ownerId), job.projectId, artifacts, signal, guard, reviewId, reader);
      await guard();
      clearInterval(heartbeat); await chain;
      const ready = this.change(job, { state: 'ready', leaseToken: null, leaseUntil: null });
      if (!await store().compareAndSet(job, ready)) throw new SourceIndexStopped('lease_lost');
      job = ready;
    } catch (cause) {
      clearInterval(heartbeat); await chain.catch(() => undefined);
      const failure = providerPause(cause) ? cause : heartbeatFailure ?? cause;
      const pause = providerPause(failure);
      const code = pause?.code ?? (failure instanceof SourceIndexStopped ? failure.code : signal.aborted ? 'cancelled' : 'index_failed');
      const stopped = this.change(job, { state: pause || code === 'assessment_paused' ? 'paused' : code === 'source_superseded' ? 'superseded' : 'failed',
        errorCode: code, leaseToken: null, leaseUntil: null });
      // Save terminal state first so interrupted hold persistence cannot turn
      // restart recovery into an automatic retry of this paid operation.
      await store().compareAndSet(job, stopped);
      if (stopped.state === 'paused') {
        let recorded = false;
        for (let attempt = 0; attempt < 4 && !recorded; attempt++) {
          const previous = await store().hold(job.projectId, ownerId);
          recorded = await store().compareHold(job.projectId, ownerId, previous, { revision: (previous?.revision ?? -1) + 1, code });
        }
        if (!recorded) throw new SourceIndexStopped('hold_persistence_failed');
      }
      throw failure;
    } finally { clearInterval(heartbeat); await chain.catch(() => undefined); }
  }
  async waitForIdle() { await Promise.allSettled([...this.active.values()].map(item => item.promise)); }
  close() { this.closed = true; for (const item of this.active.values()) item.controller.abort(); }
}
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
function waitFor(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
