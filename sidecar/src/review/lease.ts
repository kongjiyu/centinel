import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StaticReviewRepository, StaticReviewStatus, ReviewProgressState, ReviewAuditEvent } from './types.js';

export type ReviewLease = {
  reviewId: string;
  projectId: string;
  workerId: string;
  leaseToken: string;
  attempt: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
};

export type ReviewCheckpoint = {
  reviewId: string;
  projectId: string;
  workerId: string;
  leaseToken: string;
  stage: string;
  completedStages: string[];
  cursor?: Record<string, unknown> | null;
  detail?: Record<string, unknown>;
  updatedAt: string;
};

export type ReviewLeaseRepository = {
  acquireLease(input: { reviewId: string; projectId: string; workerId: string; leaseToken: string; now: string; expiresAt: string }): Promise<ReviewLease | null>;
  renewLease(input: { reviewId: string; workerId: string; leaseToken: string; now: string; expiresAt: string }): Promise<ReviewLease | null>;
  releaseLease(input: { reviewId: string; workerId: string; leaseToken: string; now: string }): Promise<boolean>;
  listExpiredLeases(now: string): Promise<ReviewLease[]>;
  saveCheckpoint(checkpoint: ReviewCheckpoint): Promise<void>;
  getCheckpoint(reviewId: string): Promise<ReviewCheckpoint | null>;
};

export type ReviewLeaseOptions = {
  workerId: string;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  now?: () => Date;
};

export class ReviewLeaseLostError extends Error {
  constructor(reviewId: string) {
    super(`The durable Review lease for ${reviewId} is no longer owned by this worker.`);
    this.name = 'ReviewLeaseLostError';
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function parseLease(value: unknown): ReviewLease | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const reviewId = String(row.reviewId ?? row.review_id ?? '');
  const projectId = String(row.projectId ?? row.project_id ?? '');
  const workerId = String(row.workerId ?? row.worker_id ?? '');
  const leaseToken = String(row.leaseToken ?? row.lease_token ?? '');
  if (!reviewId || !projectId || !workerId || !leaseToken) return null;
  return {
    reviewId,
    projectId,
    workerId,
    leaseToken,
    attempt: Number(row.attempt ?? 1),
    acquiredAt: String(row.acquiredAt ?? row.acquired_at ?? ''),
    heartbeatAt: String(row.heartbeatAt ?? row.heartbeat_at ?? ''),
    expiresAt: String(row.expiresAt ?? row.expires_at ?? ''),
  };
}

function parseCheckpoint(value: unknown): ReviewCheckpoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const reviewId = String(row.reviewId ?? row.review_id ?? '');
  if (!reviewId) return null;
  return {
    reviewId,
    projectId: String(row.projectId ?? row.project_id ?? ''),
    workerId: String(row.workerId ?? row.worker_id ?? ''),
    leaseToken: String(row.leaseToken ?? row.lease_token ?? ''),
    stage: String(row.stage ?? ''),
    completedStages: Array.isArray(row.completedStages ?? row.completed_stages)
      ? (row.completedStages ?? row.completed_stages) as string[]
      : [],
    cursor: (row.cursor ?? null) as Record<string, unknown> | null,
    detail: row.detail && typeof row.detail === 'object' ? row.detail as Record<string, unknown> : undefined,
    updatedAt: String(row.updatedAt ?? row.updated_at ?? ''),
  };
}

/** In-memory implementation for contract/crash-recovery tests. Methods are
 * synchronous in state mutation, so two competing workers cannot both claim
 * the same unexpired lease in one event-loop turn. */
export class InMemoryReviewLeaseRepository implements ReviewLeaseRepository {
  readonly leases = new Map<string, ReviewLease>();
  readonly checkpoints = new Map<string, ReviewCheckpoint>();

  async acquireLease(input: { reviewId: string; projectId: string; workerId: string; leaseToken: string; now: string; expiresAt: string }): Promise<ReviewLease | null> {
    const existing = this.leases.get(input.reviewId);
    if (existing && existing.expiresAt > input.now && !(existing.workerId === input.workerId && existing.leaseToken === input.leaseToken)) return null;
    const lease: ReviewLease = {
      reviewId: input.reviewId,
      projectId: input.projectId,
      workerId: input.workerId,
      leaseToken: input.leaseToken,
      attempt: (existing?.attempt ?? 0) + 1,
      acquiredAt: existing?.acquiredAt ?? input.now,
      heartbeatAt: input.now,
      expiresAt: input.expiresAt,
    };
    this.leases.set(input.reviewId, clone(lease));
    return clone(lease);
  }

  async renewLease(input: { reviewId: string; workerId: string; leaseToken: string; now: string; expiresAt: string }): Promise<ReviewLease | null> {
    const current = this.leases.get(input.reviewId);
    if (!current || current.workerId !== input.workerId || current.leaseToken !== input.leaseToken || current.expiresAt <= input.now) return null;
    const next = { ...current, heartbeatAt: input.now, expiresAt: input.expiresAt };
    this.leases.set(input.reviewId, clone(next));
    return clone(next);
  }

  async releaseLease(input: { reviewId: string; workerId: string; leaseToken: string; now: string }): Promise<boolean> {
    const current = this.leases.get(input.reviewId);
    if (!current || current.workerId !== input.workerId || current.leaseToken !== input.leaseToken) return false;
    this.leases.delete(input.reviewId);
    return true;
  }

  async listExpiredLeases(now: string): Promise<ReviewLease[]> {
    return [...this.leases.values()].filter(lease => lease.expiresAt <= now).map(clone);
  }

  async saveCheckpoint(checkpoint: ReviewCheckpoint): Promise<void> {
    const lease = this.leases.get(checkpoint.reviewId);
    if (!lease || lease.workerId !== checkpoint.workerId || lease.leaseToken !== checkpoint.leaseToken) throw new ReviewLeaseLostError(checkpoint.reviewId);
    this.checkpoints.set(checkpoint.reviewId, clone(checkpoint));
  }

  async getCheckpoint(reviewId: string): Promise<ReviewCheckpoint | null> {
    const value = this.checkpoints.get(reviewId);
    return value ? clone(value) : null;
  }
}

function supabaseError(label: string, error: unknown): Error {
  const message = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error);
  return new Error(`Supabase ${label} failed: ${message}`);
}

/** RLS-scoped durable lease adapter. Claim/renew are RPC-backed so the
 * compare-and-set happens in PostgreSQL rather than in two client queries. The
 * migration installs these functions; fakes can provide the same `rpc` seam. */
export class SupabaseReviewLeaseRepository implements ReviewLeaseRepository {
  constructor(private readonly client: SupabaseClient) {}

  async acquireLease(input: { reviewId: string; projectId: string; workerId: string; leaseToken: string; now: string; expiresAt: string }): Promise<ReviewLease | null> {
    const rpc = (this.client as unknown as { rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }).rpc;
    if (typeof rpc !== 'function') throw new Error('Supabase client does not expose the lease claim RPC.');
    const result = await rpc.call(this.client, 'claim_review_lease', {
      p_review_id: input.reviewId, p_project_id: input.projectId, p_worker_id: input.workerId,
      p_lease_token: input.leaseToken, p_now: input.now, p_expires_at: input.expiresAt,
    });
    if (result.error) throw supabaseError('Review lease claim', result.error);
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return parseLease(row);
  }

  async renewLease(input: { reviewId: string; workerId: string; leaseToken: string; now: string; expiresAt: string }): Promise<ReviewLease | null> {
    const rpc = (this.client as unknown as { rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }).rpc;
    if (typeof rpc !== 'function') throw new Error('Supabase client does not expose the lease renew RPC.');
    const result = await rpc.call(this.client, 'renew_review_lease', {
      p_review_id: input.reviewId, p_worker_id: input.workerId, p_lease_token: input.leaseToken,
      p_now: input.now, p_expires_at: input.expiresAt,
    });
    if (result.error) throw supabaseError('Review lease renewal', result.error);
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return parseLease(row);
  }

  async releaseLease(input: { reviewId: string; workerId: string; leaseToken: string; now: string }): Promise<boolean> {
    const rpc = (this.client as unknown as { rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }).rpc;
    if (typeof rpc !== 'function') throw new Error('Supabase client does not expose the lease release RPC.');
    const result = await rpc.call(this.client, 'release_review_lease', {
      p_review_id: input.reviewId, p_worker_id: input.workerId, p_lease_token: input.leaseToken, p_now: input.now,
    });
    if (result.error) throw supabaseError('Review lease release', result.error);
    return Boolean(Array.isArray(result.data) ? result.data[0] : result.data);
  }

  async listExpiredLeases(now: string): Promise<ReviewLease[]> {
    const result = await this.client.from('review_worker_leases').select('*').lte('expires_at', now).order('expires_at');
    if (result.error) throw supabaseError('expired Review lease lookup', result.error);
    return (result.data ?? []).map(parseLease).filter((lease: ReviewLease | null): lease is ReviewLease => !!lease);
  }

  async saveCheckpoint(checkpoint: ReviewCheckpoint): Promise<void> {
    const result = await this.client.from('review_checkpoints').upsert({
      review_id: checkpoint.reviewId,
      project_id: checkpoint.projectId,
      worker_id: checkpoint.workerId,
      lease_token: checkpoint.leaseToken,
      stage: checkpoint.stage,
      completed_stages: checkpoint.completedStages,
      cursor: checkpoint.cursor ?? null,
      detail: checkpoint.detail ?? {},
      updated_at: checkpoint.updatedAt,
    }, { onConflict: 'review_id' });
    if (result.error) throw supabaseError('Review checkpoint save', result.error);
  }

  async getCheckpoint(reviewId: string): Promise<ReviewCheckpoint | null> {
    const result = await this.client.from('review_checkpoints').select('*').eq('review_id', reviewId).maybeSingle();
    if (result.error) throw supabaseError('Review checkpoint lookup', result.error);
    return parseCheckpoint(result.data);
  }
}

export class ReviewLeaseHandle {
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private lostError: ReviewLeaseLostError | null = null;
  private readonly lostListeners = new Set<(error: ReviewLeaseLostError) => void>();
  private heartbeatInFlight: Promise<ReviewLease> | null = null;

  constructor(readonly lease: ReviewLease, private readonly repository: ReviewLeaseRepository, private readonly options: Required<Pick<ReviewLeaseOptions, 'workerId' | 'leaseDurationMs' | 'heartbeatIntervalMs' | 'now'>>) {
    this.timer = setInterval(() => {
      void this.heartbeat().catch(error => {
        if (error instanceof ReviewLeaseLostError) this.notifyLost(error);
      });
    }, this.options.heartbeatIntervalMs);
    const timerWithUnref = this.timer as ReturnType<typeof setInterval> & { unref?: () => void };
    timerWithUnref.unref?.();
  }

  async heartbeat(): Promise<ReviewLease> {
    if (this.stopped) throw new ReviewLeaseLostError(this.lease.reviewId);
    if (this.heartbeatInFlight) return this.heartbeatInFlight;
    const operation = this.renew();
    this.heartbeatInFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.heartbeatInFlight === operation) this.heartbeatInFlight = null;
    }
  }

  private async renew(): Promise<ReviewLease> {
    const now = this.options.now();
    const renewed = await this.repository.renewLease({
      reviewId: this.lease.reviewId,
      workerId: this.options.workerId,
      leaseToken: this.lease.leaseToken,
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.options.leaseDurationMs).toISOString(),
    });
    if (!renewed) {
      this.stop();
      const error = new ReviewLeaseLostError(this.lease.reviewId);
      this.notifyLost(error);
      throw error;
    }
    Object.assign(this.lease, renewed);
    return clone(renewed);
  }

  /** Subscribe to ownership loss so the review worker can abort provider and
   * ingestion work immediately. Returns an unsubscribe callback. */
  onLost(listener: (error: ReviewLeaseLostError) => void): () => void {
    if (this.lostError) {
      listener(this.lostError);
      return () => undefined;
    }
    this.lostListeners.add(listener);
    return () => this.lostListeners.delete(listener);
  }

  private notifyLost(error: ReviewLeaseLostError): void {
    if (this.lostError) return;
    this.lostError = error;
    for (const listener of this.lostListeners) listener(error);
    this.lostListeners.clear();
  }

  async checkpoint(input: Omit<ReviewCheckpoint, 'reviewId' | 'projectId' | 'workerId' | 'leaseToken' | 'updatedAt'>): Promise<void> {
    if (this.stopped) throw new ReviewLeaseLostError(this.lease.reviewId);
    const existing = await this.repository.getCheckpoint(this.lease.reviewId);
    await this.repository.saveCheckpoint({
      reviewId: this.lease.reviewId,
      projectId: this.lease.projectId,
      workerId: this.options.workerId,
      leaseToken: this.lease.leaseToken,
      ...input,
      detail: { ...(existing?.detail ?? {}), ...(input.detail ?? {}) },
      updatedAt: this.options.now().toISOString(),
    });
  }

  async release(): Promise<void> {
    if (this.stopped) return;
    this.stop();
    await this.repository.releaseLease({ reviewId: this.lease.reviewId, workerId: this.options.workerId, leaseToken: this.lease.leaseToken, now: this.options.now().toISOString() });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}

export class ReviewLeaseCoordinator {
  private readonly options: Required<Pick<ReviewLeaseOptions, 'workerId' | 'leaseDurationMs' | 'heartbeatIntervalMs' | 'now'>>;

  constructor(private readonly repository: ReviewLeaseRepository, options: ReviewLeaseOptions) {
    this.options = {
      workerId: options.workerId,
      leaseDurationMs: Math.max(1_000, options.leaseDurationMs ?? 30_000),
      heartbeatIntervalMs: Math.max(250, Math.min(options.heartbeatIntervalMs ?? 10_000, (options.leaseDurationMs ?? 30_000) / 2)),
      now: options.now ?? (() => new Date()),
    };
    if (!this.options.workerId.trim()) throw new Error('A worker id is required for Review leasing.');
  }

  async acquire(reviewId: string, projectId: string): Promise<ReviewLeaseHandle | null> {
    const now = this.options.now();
    const lease = await this.repository.acquireLease({
      reviewId,
      projectId,
      workerId: this.options.workerId,
      leaseToken: crypto.randomUUID(),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.options.leaseDurationMs).toISOString(),
    });
    return lease ? new ReviewLeaseHandle(lease, this.repository, this.options) : null;
  }
}

export type ReviewRecoveryOptions = {
  now?: () => Date;
  maxAttempts?: number;
  recoverableStatuses?: StaticReviewStatus[];
  requeueMessage?: string;
  unrecoverableMessage?: string;
  onAudit?: (event: ReviewAuditEvent) => void | Promise<void>;
};

export type ReviewRecoveryResult = {
  requeued: string[];
  failed: string[];
  skipped: string[];
};

/** Reconcile expired workers at sidecar startup. A review with a checkpoint or
 * an available retry budget is returned to queued; exhausted work is marked
 * failed with an explicit audit event instead of remaining running forever. */
export async function recoverExpiredReviews(
  leases: ReviewLeaseRepository,
  reviews: StaticReviewRepository,
  options: ReviewRecoveryOptions = {},
): Promise<ReviewRecoveryResult> {
  const now = options.now ?? (() => new Date());
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const recoverable = new Set<StaticReviewStatus>(options.recoverableStatuses ?? ['queued', 'running']);
  const result: ReviewRecoveryResult = { requeued: [], failed: [], skipped: [] };
  const expired = await leases.listExpiredLeases(now().toISOString());
  for (const lease of expired) {
    const review = await reviews.getReview(lease.reviewId);
    if (!review || !recoverable.has(review.status)) {
      result.skipped.push(lease.reviewId);
      continue;
    }
    const checkpoint = await leases.getCheckpoint(lease.reviewId);
    const auditBase = { reviewId: review.id, projectId: review.projectId, event: 'review_lease_recovered', createdAt: now().toISOString() } as ReviewAuditEvent;
    const previousRecoveryCount = Math.max(0, Math.floor(Number(checkpoint?.detail?.recoveryCount ?? 0)));
    const recoveryAttempt = Math.max(lease.attempt, previousRecoveryCount + 1);
    if (recoveryAttempt < maxAttempts) {
      const recoveredCheckpoint: ReviewCheckpoint = {
        reviewId: lease.reviewId,
        projectId: lease.projectId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        stage: checkpoint?.stage || review.progress?.stage || 'recovery',
        completedStages: checkpoint?.completedStages ?? review.progress?.completedStages ?? [],
        cursor: checkpoint?.cursor ?? null,
        detail: { ...(checkpoint?.detail ?? {}), recoveryCount: recoveryAttempt },
        updatedAt: now().toISOString(),
      };
      await leases.saveCheckpoint(recoveredCheckpoint);
      const patch: { status: 'queued'; progress?: ReviewProgressState; failureReason: string; updatedAt: string } = {
        status: 'queued',
        failureReason: options.requeueMessage ?? 'Recovered after the Review worker lease expired; queued for resume.',
        updatedAt: now().toISOString(),
      };
      if (checkpoint) {
        patch.progress = {
          stage: checkpoint.stage,
          completedStages: checkpoint.completedStages,
          message: patch.failureReason,
          updatedAt: patch.updatedAt,
        };
      }
      const updated = await reviews.transitionReview(review.id, ['queued', 'running'], patch);
      if (updated) {
        await leases.releaseLease({ reviewId: lease.reviewId, workerId: lease.workerId, leaseToken: lease.leaseToken, now: now().toISOString() });
        result.requeued.push(review.id);
        const event = { ...auditBase, detail: { action: 'requeued', leaseAttempt: lease.attempt, recoveryAttempt, checkpointStage: recoveredCheckpoint.stage } };
        await reviews.recordAudit?.(event);
        await options.onAudit?.(event);
      } else result.skipped.push(review.id);
      continue;
    }
    const updated = await reviews.transitionReview(review.id, ['queued', 'running'], {
      status: 'failed',
      failureReason: options.unrecoverableMessage ?? 'Review worker lease expired after the retry budget was exhausted.',
      updatedAt: now().toISOString(),
    });
    if (updated) {
      await leases.releaseLease({ reviewId: lease.reviewId, workerId: lease.workerId, leaseToken: lease.leaseToken, now: now().toISOString() });
      result.failed.push(review.id);
      const event = { ...auditBase, detail: { action: 'marked_failed', leaseAttempt: lease.attempt, recoveryAttempt, checkpointStage: checkpoint?.stage ?? null } };
      await reviews.recordAudit?.(event);
      await options.onAudit?.(event);
    } else result.skipped.push(review.id);
  }
  return result;
}
