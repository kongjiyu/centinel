import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artifact } from '../../src/artifacts.js';
import { openRepositoryEmbeddingBridge } from '../../src/review/repositoryEmbeddingBridge.js';
import { EmbeddingProviderError } from '../../src/review/embeddingProvider.js';
import path from 'node:path';

const configuration = { apiKey: 'PRIVATE_VOYAGE_KEY', baseUrl: 'https://api.voyageai.com/v1', model: 'voyage-4-lite', embeddingProvider: 'voyage' as const, dimensions: 1024 };
const artifact = { id: 'artifact', projectId: 'project', versionId: 'version', filePath: 'lib/a.js', contentHash: 'a'.repeat(64) } as Artifact;
const result = { embeddings: [Array(1024).fill(0.5)], model: 'voyage-4-lite', inputTokens: 5, providerReportedTotalTokens: 5 };

describe('repository embedding bridge', () => {
  it('checks the durable lease after admission and before recording or sending a paid batch', async () => {
    const embed = vi.fn(async () => result); const saveUsage = vi.fn(async () => undefined);
    const stopped = new Error('lease lost'); const beforeProvider = vi.fn(async () => { throw stopped; });
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project', configuration,
      inputType: 'document', sources: [], embed, saveUsage, beforeProvider, indexTrigger: 'source_changed', admit: async () => ({ reconcile: () => undefined }) });
    try {
      const response = await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` },
        body: JSON.stringify({ model: configuration.model, input: ['source'] }) });
      expect(response.status).toBe(400); expect(bridge.failure()).toBe(stopped);
      expect(embed).not.toHaveBeenCalled(); expect(saveUsage).not.toHaveBeenCalled();
    } finally { await bridge.close(); }
  });
  it('persists usage from a decorated cancellation without replacing it with assumed zero', async () => {
    const error = Object.assign(new DOMException('Cancelled', 'AbortError'), { responseReceived: true,
      safeUsage: { inputTokens: 17, providerReportedTotalTokens: 17 },
      usageObservation: { source: 'provider_error_response', completeness: 'partial' } });
    const saveUsage = vi.fn(async (_input: unknown) => undefined);
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project', configuration,
      inputType: 'query', sources: [], embed: async () => { throw error; }, saveUsage, admit: async () => ({ reconcile: () => undefined }) });
    try {
      await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` },
        body: JSON.stringify({ model: configuration.model, input: ['payment'] }) });
      const completed = saveUsage.mock.calls[1][0] as any;
      expect(completed).toMatchObject({ outcome: 'cancelled', inputTokens: 17, metadata: { providerReportedTotalTokens: 17, responseReceived: true } });
      expect(completed.metadata).not.toHaveProperty('usageAccounting');
    } finally { await bridge.close(); }
  });
  it.each([false, true])('records no-response assumptions separately from real error receipts (received %s)', async responseReceived => {
    const failure = new EmbeddingProviderError('Synthetic provider failure.', responseReceived ? 'http_500' : 'network_error', undefined, { responseReceived });
    const saveUsage = vi.fn(async (_input: unknown) => undefined);
    const embed = vi.fn(async () => { throw failure; });
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project', configuration,
      inputType: 'query', sources: [], embed, saveUsage, admit: async () => ({ reconcile: () => undefined }) });
    try {
      const response = await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` },
        body: JSON.stringify({ model: configuration.model, input: ['payment'] }) });
      expect(response.status).toBe(400);
      expect(embed).toHaveBeenCalledOnce();
      const [reserved, completed] = saveUsage.mock.calls.map(([row]) => row as any);
      expect(reserved).toMatchObject({ outcome: 'in_progress', inputTokens: null });
      expect(reserved.metadata).not.toHaveProperty('usageAccounting');
      expect(completed).toMatchObject({ id: reserved.id, inputTokens: null, outputTokens: null, metadata: { responseReceived } });
      if (responseReceived) expect(completed.metadata).not.toHaveProperty('usageAccounting');
      else expect(completed.metadata.usageAccounting).toEqual({ basis: 'assumed_zero_no_response', accountedTokens: 0 });
    } finally { await bridge.close(); }
  });
  it('does not call the provider if durable usage reservation fails', async () => {
    const embed = vi.fn(async () => result);
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project', configuration,
      inputType: 'query', sources: [], embed, saveUsage: async () => { throw Error('private database diagnostic'); },
      admit: async () => ({ reconcile: () => undefined }) });
    try {
      const response = await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` },
        body: JSON.stringify({ model: configuration.model, input: ['payment'] }) });
      expect(response.status).toBe(400); expect(embed).not.toHaveBeenCalled();
      expect(String(bridge.failure())).toContain('no provider request');
      expect(String(bridge.failure())).not.toContain('private database');
    } finally { await bridge.close(); }
  });

  it('retains a durable unknown usage row if final accounting fails after a provider call', async () => {
    const saveUsage = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('write unavailable'));
    const embed = vi.fn(async () => result);
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project', configuration,
      inputType: 'query', sources: [], embed, saveUsage, admit: async () => ({ reconcile: () => undefined }) });
    try {
      const response = await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` },
        body: JSON.stringify({ model: configuration.model, input: ['payment'] }) });
      expect(response.status).toBe(400); expect(embed).toHaveBeenCalledOnce();
      expect(saveUsage.mock.calls[0]![0]).toMatchObject({ outcome: 'in_progress', inputTokens: null });
      expect(saveUsage.mock.calls[1]![0]).toMatchObject({ id: saveUsage.mock.calls[0]![0].id, outcome: 'success', inputTokens: 5 });
    } finally { await bridge.close(); }
  });

  it('attributes pinned native absolute-path headers only within the frozen staging root', async () => {
    const stagingRoot = path.resolve('frozen-fixture');
    const saveUsage = vi.fn(async () => undefined);
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project', configuration,
      inputType: 'document', stagingRoot,
      sources: [{ relativePath: 'lib/a.js', artifact }], embed: vi.fn(async () => result), saveUsage,
      admit: async () => ({ reconcile: () => undefined }) });
    try {
      const upstreamHeader = path.join(stagingRoot, 'lib/a.js').split('/').slice(-3).join('/');
      const response = await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` },
        body: JSON.stringify({ model: configuration.model, input: [`JavaScript function "a"\nin ${upstreamHeader}\n\nfunction a() {}`] }) });
      expect(response.status).toBe(200);
      expect(saveUsage).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ usageContext: {
        phase: 'source_indexing', sourcesComplete: true, sources: [expect.objectContaining({ artifactId: artifact.id })],
      } }) }));
      await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` },
        body: JSON.stringify({ model: configuration.model, input: [`JavaScript function "a"\nin ${path.resolve('../external/lib/a.js')}\n\nfunction a() {}`] }) });
      expect(saveUsage.mock.calls[2]![0]).toMatchObject({ metadata: { usageContext: { sourcesComplete: false, sources: [] } } });
    } finally { await bridge.close(); }
  });

  it('splits a large upstream batch without losing order or inventing aggregate usage', async () => {
    const inputs = ['a'.repeat(100_000), 'b'.repeat(100_000), 'c'.repeat(100_000)];
    const embed = vi.fn(async (_configuration, group: string[]) => ({
      embeddings: group.map(input => Array(1024).fill(input.charCodeAt(0))), model: configuration.model,
      inputTokens: 20, providerReportedTotalTokens: group[0]![0] === 'b' ? null : 20,
    }));
    const saveUsage = vi.fn(async () => undefined); const reconcile = vi.fn(); const admit = vi.fn(async () => ({ reconcile }));
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project', configuration,
      inputType: 'document', sources: [], embed, saveUsage, admit });
    try {
      const response = await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` },
        body: JSON.stringify({ model: configuration.model, input: inputs }) });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: Array<{ index: number; embedding: number[] }>; usage: object };
      expect(body.data.map(item => [item.index, item.embedding[0]])).toEqual([[0, 97], [1, 98], [2, 99]]);
      expect(body.usage).toEqual({});
      expect(embed).toHaveBeenCalledTimes(3); expect(admit).toHaveBeenCalledTimes(3);
      expect(saveUsage).toHaveBeenCalledTimes(6); expect(reconcile).toHaveBeenCalledTimes(3);
    } finally { await bridge.close(); }
  });

  it('retains successful microbatch usage and stops later groups when capacity fails', async () => {
    const failure = new EmbeddingProviderError('Provider credits exhausted.', 'credits_exhausted');
    const embed = vi.fn().mockResolvedValueOnce(result).mockRejectedValueOnce(failure);
    const saveUsage = vi.fn(async () => undefined);
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project', configuration,
      inputType: 'document', sources: [], embed, saveUsage, admit: async () => ({ reconcile: () => undefined }) });
    try {
      const response = await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` },
        body: JSON.stringify({ model: configuration.model, input: ['a', 'b', 'c'].map(value => value.repeat(100_000)) }) });
      expect(response.status).toBe(400); expect(embed).toHaveBeenCalledTimes(2);
      expect(bridge.failure()).toBe(failure); expect(saveUsage).toHaveBeenCalledTimes(4);
      expect(saveUsage.mock.calls[1]![0]).toMatchObject({ outcome: 'success', inputTokens: 5 });
      expect(saveUsage.mock.calls[3]![0]).toMatchObject({ outcome: 'permanent_error', inputTokens: null });
    } finally { await bridge.close(); }
  });

  it('keeps provider credentials private, records document source attribution and rejects unauthenticated calls', async () => {
    const embed = vi.fn(async () => result); const saveUsage = vi.fn(async () => undefined);
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project', reviewId: 'review',
      configuration, inputType: 'document', sources: [{ relativePath: 'lib/a.js', artifact }], embed, saveUsage, admit: async () => ({ reconcile: () => undefined }) });
    try {
      const body = JSON.stringify({ model: configuration.model, input: ['javascript function "a"\nin lib/a.js\n\nfunction a() {}'] });
      expect((await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', body })).status).toBe(403);
      expect(embed).not.toHaveBeenCalled();
      const response = await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` }, body });
      expect(response.status).toBe(200);
      expect(embed).toHaveBeenCalledWith(configuration, expect.any(Array), 'document', undefined);
      expect(saveUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 5, metadata: expect.objectContaining({ usageContext: {
        phase: 'source_indexing', sourcesComplete: true, sources: [expect.objectContaining({ artifactId: 'artifact', artifactVersionId: 'version' })],
      } }) }));
      expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_VOYAGE_KEY');
      expect(JSON.stringify(saveUsage.mock.calls)).not.toContain('PRIVATE_VOYAGE_KEY');
    } finally { await bridge.close(); }
  });

  it('retries temporary limits with increasing waits and separate durable usage attempts', async () => {
    let calls = 0;
    const embed = vi.fn(async () => { if (++calls < 4) throw new EmbeddingProviderError('Temporary limit', 'rate_limited'); return result; });
    const rows: any[] = []; const waits: number[] = [];
    const beforeProvider = vi.fn(async () => undefined);
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'retry-owner', projectId: 'project', configuration,
      inputType: 'query', sources: [], embed, saveUsage: async row => { rows.push(row); }, beforeProvider,
      admit: async () => ({ reconcile: () => undefined }), retrySleep: async ms => { waits.push(ms); } });
    try {
      const response = await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ model: configuration.model, input: ['query'] }) });
      expect(response.status).toBe(200); expect(bridge.failure()).toBeUndefined();
      expect(waits).toHaveLength(3); expect(waits[0]).toBeGreaterThanOrEqual(60000); expect(waits[1]).toBeGreaterThanOrEqual(120000); expect(waits[2]).toBeGreaterThanOrEqual(240000);
      expect(beforeProvider).toHaveBeenCalledTimes(4);
      expect(rows.filter(row => row.outcome === 'in_progress').map(row => row.attempt)).toEqual([1, 2, 3, 4]);
      expect(new Set(rows.map(row => row.id)).size).toBe(4);
      expect(rows.filter(row => row.outcome === 'transient_error')).toHaveLength(3);
    } finally { await bridge.close(); }
  });

  it('stops after four temporary-limit attempts without an unbounded retry', async () => {
    const failure = new EmbeddingProviderError('Temporary limit', 'rate_limited');
    const embed = vi.fn(async () => { throw failure; });
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project', configuration,
      inputType: 'query', sources: [], embed, saveUsage: async () => undefined,
      admit: async () => ({ reconcile: () => undefined }), retrySleep: async () => undefined });
    try {
      const response = await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ model: configuration.model, input: ['query'] }) });
      expect(response.status).toBe(400); expect(embed).toHaveBeenCalledTimes(4); expect(bridge.failure()).toBe(failure);
    } finally { await bridge.close(); }
  });

  it('cancels a backoff without another provider request', async () => {
    const controller = new AbortController();
    const embed = vi.fn(async () => { throw new EmbeddingProviderError('Temporary limit', 'rate_limited'); });
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project', configuration,
      inputType: 'query', sources: [], embed, saveUsage: async () => undefined, signal: controller.signal,
      admit: async () => ({ reconcile: () => undefined }), retrySleep: async () => { controller.abort(); } });
    try {
      const response = await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ model: configuration.model, input: ['query'] }) });
      expect(response.status).toBe(400); expect(embed).toHaveBeenCalledTimes(1);
    } finally { await bridge.close(); }
  });

  it('shares the backoff ceiling across partitioned groups and never shortens Retry-After', async () => {
    const first = new EmbeddingProviderError('Temporary', 'rate_limited', undefined, { retryAfterMs: 400000 });
    const second = new EmbeddingProviderError('Temporary', 'rate_limited', undefined, { retryAfterMs: 300000 });
    const embed = vi.fn().mockRejectedValueOnce(first).mockResolvedValueOnce(result).mockRejectedValueOnce(second);
    const waits: number[] = [];
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project', configuration,
      inputType: 'document', sources: [], embed, saveUsage: async () => undefined,
      admit: async () => ({ reconcile: () => undefined }), retrySleep: async ms => { waits.push(ms); } });
    try {
      const response = await fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ model: configuration.model, input: ['a'.repeat(100000), 'b'.repeat(100000)] }) });
      expect(response.status).toBe(400); expect(embed).toHaveBeenCalledTimes(3);
      expect(waits).toEqual([400000]); expect(bridge.failure()).toBe(second);
    } finally { await bridge.close(); }
  });

  it('uses query semantics and stops all later attempts after a capacity failure without retry', async () => {
    const failure = new EmbeddingProviderError('Provider credits are exhausted.', 'credits_exhausted');
    const embed = vi.fn(async () => { throw failure; }); const saveUsage = vi.fn(async () => undefined);
    const bridge = await openRepositoryEmbeddingBridge({ client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project', configuration,
      inputType: 'query', sources: [], embed, saveUsage, admit: async () => ({ reconcile: () => undefined }) });
    try {
      const call = () => fetch(`${bridge.baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` },
        body: JSON.stringify({ model: configuration.model, input: ['payment idempotency'] }) });
      expect((await call()).status).toBe(400); expect((await call()).status).toBe(400);
      expect(bridge.failure()).toBe(failure); expect(embed).toHaveBeenCalledTimes(1);
      expect(embed).toHaveBeenCalledWith(configuration, ['payment idempotency'], 'query', undefined);
      expect(saveUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: null, errorCode: 'credits_exhausted', metadata: expect.objectContaining({
        usageContext: { phase: 'context_retrieval', sources: [], sourcesComplete: true },
      }) }));
    } finally { await bridge.close(); }
  });
});
