import { describe, expect, it, vi, afterEach } from 'vitest';
import { encryptSecret } from '../../src/tokenVault.js';
import { ModelConfigurationError, resolveModelProviderChain, SupabaseModelConfigurationRepository, type ModelConfigurationRepository } from '../../src/review/modelProviderResolver.js';
import { ModelProviderError, runModelOperation } from '../../src/review/retry.js';
import { createModelUsageAuditRecorder, summarizeModelUsage, type ModelUsageAuditSink } from '../../src/review/usageAudit.js';
import { RefreshableSupabaseRuntime, SupabaseScopedClientCache } from '../../src/runtime/supabaseRuntime.js';
import { createRefreshableStaticReviewRuntime } from '../../src/runtime/staticReviewRuntime.js';
import { InMemoryReviewLeaseRepository, ReviewLeaseCoordinator, recoverExpiredReviews } from '../../src/review/lease.js';
import { InMemoryStaticReviewRepository } from '../../src/review/repository.js';
import { ingestArtifacts, throwIfAborted } from '../../src/review/abort.js';
import type { Artifact, } from '../../src/artifacts.js';
import type { StaticAnalysisModelProvider } from '../../src/review/types.js';

const originalKey = process.env.CENTINEL_TOKEN_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.CENTINEL_TOKEN_ENCRYPTION_KEY;
  else process.env.CENTINEL_TOKEN_ENCRYPTION_KEY = originalKey;
});

function configurationRepository(row: Record<string, unknown>): ModelConfigurationRepository {
  return { getModelConfiguration: vi.fn(async () => row) };
}

const request = {
  reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis',
  systemPrompt: 'json', prompt: 'inspect',
};

function provider(implementation: StaticAnalysisModelProvider['analyze']): StaticAnalysisModelProvider {
  return { analyze: implementation };
}

function scopedClient(rows: Record<string, Record<string, unknown> | null>, calls: string[]) {
  return {
    from: (table: string) => {
      calls.push(table);
      const filters: Array<[string, unknown]> = [];
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => {
          const value = rows[table] ?? null;
          return { data: value && filters.every(([key, expected]) => value[key] === expected) ? value : null, error: null };
        },
      };
      return query;
    },
  } as any;
}

describe('Phase 3 model/runtime contracts', () => {
  it('resolves encrypted project settings and a deliberate fallback without exposing plaintext in metadata', async () => {
    process.env.CENTINEL_TOKEN_ENCRYPTION_KEY = 'phase3-test-key';
    const row = {
      id: 'configuration-1', owner_id: 'user-1', project_id: 'project-1', purpose: 'static_review', enabled: true,
      provider: 'mimo', api_format: 'openai-compatible', model: 'primary-model', base_url: 'https://primary.example.test',
      secret_ciphertext: encryptSecret('primary-secret'), fallback_provider: 'custom', fallback_model: 'fallback-model',
      metadata: { fallbackApiFormat: 'openai-compatible', fallbackBaseUrl: 'https://fallback.example.test', fallbackSecretCiphertext: encryptSecret('fallback-secret') },
    };
    const chain = await resolveModelProviderChain(configurationRepository(row), { ownerId: 'user-1', projectId: 'project-1' }, { fetchImpl: vi.fn() });
    expect(chain.primary.apiKey).toBe('primary-secret');
    expect(chain.fallback?.apiKey).toBe('fallback-secret');
    expect(chain.primaryMetadata).toEqual({ provider: 'mimo', apiFormat: 'openai-compatible', model: 'primary-model' });
    expect(JSON.stringify(chain.primaryMetadata)).not.toContain('secret');
    expect(JSON.stringify(chain.fallbackMetadata)).not.toContain('secret');
  });

  it('does not send the primary credential to a fallback endpoint lacking its own key', async () => {
    process.env.CENTINEL_TOKEN_ENCRYPTION_KEY = 'phase3-test-key';
    const row = {
      owner_id: 'user-1', project_id: 'project-1', purpose: 'static_review', enabled: true,
      provider: 'custom', api_format: 'openai-compatible', model: 'primary-model', base_url: 'https://primary.example.test',
      secret_ciphertext: encryptSecret('primary-secret'), fallback_provider: 'custom', fallback_model: 'fallback-model',
      fallback_base_url: 'https://fallback.example.test',
    };
    await expect(resolveModelProviderChain(configurationRepository(row), { ownerId: 'user-1', projectId: 'project-1' }))
      .rejects.toMatchObject({ name: ModelConfigurationError.name, code: 'secret_unavailable' });
  });

  it('scopes model configuration lookup to the canonical owner and prefers a project override', async () => {
    const calls: Array<{ table: string; method: string; value: unknown }> = [];
    let queryCount = 0;
    const query = (data: unknown) => {
      const chain: any = {
        select: () => chain,
        eq: (field: string, value: unknown) => { calls.push({ table: 'model_configurations', method: `eq:${field}`, value }); return chain; },
        is: (field: string, value: unknown) => { calls.push({ table: 'model_configurations', method: `is:${field}`, value }); return chain; },
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => { queryCount++; return { data: queryCount === 1 ? data : null, error: null }; },
      };
      return chain;
    };
    const repository = new SupabaseModelConfigurationRepository({ from: () => query({ id: 'project-config', project_id: 'project-1', owner_id: 'user-1', provider: 'mimo', model: 'm', base_url: 'https://example.test', secret_ciphertext: 'cipher' }) } as any);
    const result = await repository.getModelConfiguration({ ownerId: 'user-1', projectId: 'project-1' });
    expect(result?.id).toBe('project-config');
    expect(calls).toEqual(expect.arrayContaining([
      { table: 'model_configurations', method: 'eq:owner_id', value: 'user-1' },
      { table: 'model_configurations', method: 'eq:project_id', value: 'project-1' },
    ]));
  });

  it('passes cancellation to a held project-specific Model Provider query', async () => {
    const controller = new AbortController();
    let querySignal: AbortSignal | undefined;
    const query: any = {
      select: () => query, eq: () => query, order: () => query, limit: () => query,
      abortSignal: vi.fn((signal: AbortSignal) => { querySignal = signal; return query; }),
      maybeSingle: () => new Promise((_resolve, reject) => {
        querySignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    };
    const repository = new SupabaseModelConfigurationRepository({ from: () => query } as any);
    const pending = repository.getModelConfiguration({ ownerId: 'user-1', projectId: 'project-1' }, controller.signal);
    expect(query.abortSignal).toHaveBeenCalledWith(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps primary and fallback under one three-total-attempt budget', async () => {
    const calls: string[] = [];
    const primary = provider(async () => {
      calls.push('primary');
      throw new ModelProviderError('busy', { code: 'server_busy', retryable: true });
    });
    const fallback = provider(async () => {
      calls.push('fallback');
      return { result: { findings: [] }, settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'fallback' } };
    });
    const attempts: string[] = [];
    const result = await runModelOperation(request, primary, {
      reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis', provider: 'mimo', apiFormat: 'openai-compatible', model: 'primary',
      fallback, fallbackContext: { provider: 'custom', apiFormat: 'openai-compatible', model: 'fallback' },
      baseDelayMs: 0, jitterRatio: 0, sleep: async () => undefined,
      onAttempt: item => attempts.push(`${item.provider}:${item.attempt}:${item.outcome}`),
    });
    expect(result.providerUsed).toBe('fallback');
    expect(calls).toEqual(['primary', 'primary', 'fallback']);
    expect(result.attempts).toHaveLength(3);
    expect(attempts).toEqual(['mimo:1:retryable_error', 'mimo:2:retryable_error', 'custom:3:success']);
  });

  it('records each attempt once and summarizes failed/cancelled usage without secret fields', async () => {
    const records: unknown[] = [];
    const audits: unknown[] = [];
    const sink: ModelUsageAuditSink = {
      recordAttempt: async record => { records.push(record); },
      recordAudit: async event => { audits.push(event); },
    };
    const record = createModelUsageAuditRecorder(sink, { now: () => new Date('2026-09-22T00:00:00.000Z') });
    const attempt = {
      reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis', attempt: 1, provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo',
      outcome: 'retryable_error' as const, durationMs: 12, errorCode: 'http_429', errorMessage: 'Authorization: super-secret', createdAt: '2026-09-22T00:00:00.000Z',
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    };
    await record(attempt);
    await record(attempt);
    expect(records).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(records[0])).not.toContain('super-secret');
    expect(summarizeModelUsage([attempt])).toMatchObject({ calls: 1, failedCalls: 1, inputTokens: 3, outputTokens: 4, totalTokens: 7 });
  });

  it('replaces stale RLS clients after token refresh and keys cache by canonical user plus fingerprint', async () => {
    const created: object[] = [];
    const factory = vi.fn((token: string) => { const client = { token }; created.push(client); return client as any; });
    const runtime = new RefreshableSupabaseRuntime({ userId: 'user-1', accessToken: 'token-1', clientFactory: factory });
    const before = runtime.snapshot();
    expect(runtime.replaceAccessToken('token-1')).toBe(false);
    expect(runtime.replaceAccessToken('token-2')).toBe(true);
    expect(runtime.state().generation).toBe(1);
    expect(() => runtime.assertCurrent(before)).toThrow(/refreshed/);
    const cache = new SupabaseScopedClientCache(factory, 4);
    expect(cache.get('user-1', 'token-1')).toBe(cache.get('user-1', 'token-1'));
    expect(cache.get('user-1', 'token-2')).not.toBe(cache.get('user-1', 'token-1'));
    cache.invalidateUser('user-1');
    expect(cache.size).toBe(0);
    expect(created.length).toBeGreaterThan(0);
  });

  it('routes repository, provider, and connected evidence reads through the latest refreshed RLS client', async () => {
    process.env.CENTINEL_TOKEN_ENCRYPTION_KEY = 'phase3-test-key';
    const firstCalls: string[] = [];
    const secondCalls: string[] = [];
    const reviewRow = {
      id: 'review-1', project_id: 'project-1', name: 'Review', review_type: 'code_review', status: 'queued',
      idempotency_key: 'start-1', scope: {}, config: {}, lineage: {}, created_at: '2026-09-22T00:00:00.000Z', updated_at: '2026-09-22T00:00:00.000Z',
    };
    const modelRow = {
      id: 'model-config-1', owner_id: 'user-1', project_id: 'project-1', purpose: 'static_review', enabled: true,
      provider: 'mimo', api_format: 'openai-compatible', model: 'review-model', base_url: 'https://model.example.test',
      secret_ciphertext: encryptSecret('model-secret'),
    };
    const artifactItem = { project_id: 'project-1', artifact_id: 'artifact-1', source_id: 'source-1', status: 'available', error: null, updated_at: '2026-09-22T11:30:00.000Z' };
    const sourceRow = { project_id: 'project-1', id: 'source-1', status: 'active', sync_status: 'ready', last_successful_sync_at: '2026-09-22T11:30:00.000Z', last_error: null };
    const client1 = scopedClient({ review_sessions: reviewRow, model_configurations: modelRow, connected_source_items: artifactItem, project_sources: sourceRow }, firstCalls);
    const client2 = scopedClient({ review_sessions: reviewRow, model_configurations: modelRow, connected_source_items: artifactItem, project_sources: sourceRow }, secondCalls);
    const runtime = new RefreshableSupabaseRuntime({
      userId: 'user-1', accessToken: 'token-1', clientFactory: token => token === 'token-1' ? client1 : client2,
    });
    const reviewRuntime = createRefreshableStaticReviewRuntime(runtime, {
      now: () => new Date('2026-09-22T12:00:00.000Z'),
    });
    const review = await reviewRuntime.repository.getReview('review-1');
    expect(review?.id).toBe('review-1');
    expect(firstCalls).toContain('review_sessions');

    runtime.replaceAccessToken('token-2');
    const resolved = await reviewRuntime.dependencies.modelProviderResolver!({
      id: 'review-1', projectId: 'project-1',
    } as any);
    const state = await reviewRuntime.dependencies.evidenceSourceState!(
      { id: 'artifact-1', projectId: 'project-1' } as Artifact,
    );
    expect(resolved.primaryMetadata).toEqual({ provider: 'mimo', apiFormat: 'openai-compatible', model: 'review-model' });
    expect(state).toEqual({ state: 'available' });
    expect(secondCalls).toEqual(expect.arrayContaining(['model_configurations', 'connected_source_items', 'project_sources']));
    expect(firstCalls).toEqual(['review_sessions']);
  });
});

describe('Phase 3 lease/recovery and abort contracts', () => {
  const artifact: Artifact = {
    id: 'artifact-1', projectId: 'project-1', type: 'source_code', source: 'repository', fileName: 'a.ts', filePath: 'a.ts', originalPath: null,
    contentHash: 'hash', createdAt: '2026-09-22T00:00:00.000Z',
  };

  it('claims, renews, checkpoints, and releases a durable lease', async () => {
    const repository = new InMemoryReviewLeaseRepository();
    let current = new Date('2026-09-22T00:00:00.000Z');
    const coordinator = new ReviewLeaseCoordinator(repository, { workerId: 'worker-1', leaseDurationMs: 2_000, heartbeatIntervalMs: 500, now: () => current });
    const handle = await coordinator.acquire('review-1', 'project-1');
    expect(handle).toBeTruthy();
    expect(await coordinator.acquire('review-1', 'project-1')).toBeNull();
    await handle!.checkpoint({ stage: 'indexing_context', completedStages: ['freezing_sources'] });
    current = new Date('2026-09-22T00:00:00.500Z');
    await handle!.heartbeat();
    expect((await repository.getCheckpoint('review-1'))?.stage).toBe('indexing_context');
    await handle!.release();
    expect(repository.leases.size).toBe(0);
  });

  it('requeues recoverable expired work and marks exhausted work failed with an audit event', async () => {
    const leases = new InMemoryReviewLeaseRepository();
    const reviews = new InMemoryStaticReviewRepository();
    const now = new Date('2026-09-22T00:00:00.000Z');
    const created = await reviews.createReview({
      id: 'review-1', projectId: 'project-1', name: 'Review', reviewType: 'code_review', status: 'running', idempotencyKey: 'idempotent',
      scope: {}, config: {}, lineage: { parentReviewId: null, lineageRootId: 'root', reusedSourceManifest: false },
    });
    await leases.acquireLease({ reviewId: created.id, projectId: created.projectId, workerId: 'dead-worker', leaseToken: 'lease', now: '2026-09-21T23:00:00.000Z', expiresAt: '2026-09-21T23:30:00.000Z' });
    const result = await recoverExpiredReviews(leases, reviews, { now: () => now, maxAttempts: 3 });
    expect(result.requeued).toEqual(['review-1']);
    expect((await reviews.getReview('review-1'))?.status).toBe('queued');
    expect(reviews.audits.at(-1)?.event).toBe('review_lease_recovered');
  });

  it('does not let an old checkpoint bypass the durable recovery attempt limit', async () => {
    const leases = new InMemoryReviewLeaseRepository();
    const reviews = new InMemoryStaticReviewRepository();
    const created = await reviews.createReview({
      id: 'review-exhausted', projectId: 'project-1', name: 'Review', reviewType: 'code_review', status: 'running', idempotencyKey: 'idempotent',
      scope: {}, config: {}, lineage: { parentReviewId: null, lineageRootId: 'root', reusedSourceManifest: false },
    });
    leases.leases.set(created.id, {
      reviewId: created.id, projectId: created.projectId, workerId: 'dead-worker', leaseToken: 'lease', attempt: 3,
      acquiredAt: '2026-09-21T23:00:00.000Z', heartbeatAt: '2026-09-21T23:00:00.000Z', expiresAt: '2026-09-21T23:30:00.000Z',
    });
    leases.checkpoints.set(created.id, {
      reviewId: created.id, projectId: created.projectId, workerId: 'dead-worker', leaseToken: 'lease',
      stage: 'model_analysis', completedStages: ['freezing_sources'], updatedAt: '2026-09-21T23:00:00.000Z',
    });
    const result = await recoverExpiredReviews(leases, reviews, {
      now: () => new Date('2026-09-22T00:00:00.000Z'), maxAttempts: 3,
    });
    expect(result.failed).toEqual(['review-exhausted']);
    expect((await reviews.getReview(created.id))?.status).toBe('failed');
  });

  it('keeps the recovery budget across lease release and reacquisition', async () => {
    const leases = new InMemoryReviewLeaseRepository();
    const reviews = new InMemoryStaticReviewRepository();
    const created = await reviews.createReview({
      id: 'review-recover-twice', projectId: 'project-1', name: 'Review', reviewType: 'code_review', status: 'queued', idempotencyKey: 'idempotent',
      scope: {}, config: {}, lineage: { parentReviewId: null, lineageRootId: 'root', reusedSourceManifest: false },
    });
    await leases.acquireLease({ reviewId: created.id, projectId: created.projectId, workerId: 'worker-1', leaseToken: 'lease-1', now: '2026-09-21T23:00:00.000Z', expiresAt: '2026-09-21T23:00:01.000Z' });
    const first = await recoverExpiredReviews(leases, reviews, { now: () => new Date('2026-09-21T23:00:02.000Z'), maxAttempts: 2 });
    expect(first.requeued).toEqual([created.id]);
    expect((await leases.getCheckpoint(created.id))?.detail?.recoveryCount).toBe(1);

    await reviews.transitionReview(created.id, ['queued'], { status: 'running' });
    await leases.acquireLease({ reviewId: created.id, projectId: created.projectId, workerId: 'worker-2', leaseToken: 'lease-2', now: '2026-09-21T23:01:00.000Z', expiresAt: '2026-09-21T23:01:01.000Z' });
    const second = await recoverExpiredReviews(leases, reviews, { now: () => new Date('2026-09-21T23:01:02.000Z'), maxAttempts: 2 });
    expect(second.failed).toEqual([created.id]);
    expect((await reviews.getReview(created.id))?.status).toBe('failed');
  });

  it('notifies the worker immediately when its durable lease can no longer renew', async () => {
    const repository = new InMemoryReviewLeaseRepository();
    let current = new Date('2026-09-22T00:00:00.000Z');
    const coordinator = new ReviewLeaseCoordinator(repository, { workerId: 'worker-1', leaseDurationMs: 1_000, heartbeatIntervalMs: 500, now: () => current });
    const handle = await coordinator.acquire('review-1', 'project-1');
    let lost = false;
    handle!.onLost(() => { lost = true; });
    current = new Date('2026-09-22T00:00:02.000Z');
    await expect(handle!.heartbeat()).rejects.toThrow(/lease/);
    expect(lost).toBe(true);
  });

  it('stops ingestion before invoking the next item after cancellation', async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    const second: Artifact = { ...artifact, id: 'artifact-2', fileName: 'b.ts' };
    await expect(ingestArtifacts([artifact, second], async item => {
      seen.push(item.id);
      controller.abort();
      return item.id;
    }, async (_item, content) => content, controller.signal)).rejects.toThrow();
    expect(seen).toEqual(['artifact-1']);
    expect(() => throwIfAborted(controller.signal)).toThrow();
  });
});
