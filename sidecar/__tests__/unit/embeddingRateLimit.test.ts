import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { embeddingAdmissionEstimate, partitionEmbeddingInputs, waitForEmbeddingBudget } from '../../src/review/embeddingRateLimit.js';

describe('embedding admission pacing without retries', () => {
  it('paces initial requests at the configured RPM and preserves unknown reservations', async () => {
    let now = 0;
    const sleep = vi.fn(async (milliseconds: number) => { now += milliseconds; });
    const key = crypto.randomUUID(); const limits = { requestsPerMinute: 3, tokensPerMinute: 10_000 };
    for (let index = 0; index < 3; index++) await waitForEmbeddingBudget(key, 1000, undefined, { limits, now: () => now, sleep });
    expect(sleep).not.toHaveBeenCalled();
    await waitForEmbeddingBudget(key, 1000, undefined, { limits, now: () => now, sleep });
    expect(sleep).toHaveBeenCalledWith(60_100, undefined);
  });

  it('reconciles known provider totals but never treats unknown usage as zero', async () => {
    let now = 0; const sleep = vi.fn(async (milliseconds: number) => { now += milliseconds; });
    const settings = { limits: { requestsPerMinute: 100, tokensPerMinute: 10_000 }, now: () => now, sleep };
    const key = crypto.randomUUID();
    const first = await waitForEmbeddingBudget(key, 9000, undefined, settings);
    first.reconcile(1000);
    const second = await waitForEmbeddingBudget(key, 8000, undefined, settings);
    expect(sleep).not.toHaveBeenCalled();
    second.reconcile(null);
    await waitForEmbeddingBudget(key, 2000, undefined, settings);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('partitions a batch without truncating strings or losing order and rejects an oversized individual chunk', () => {
    const inputs = ['a'.repeat(5000), 'b'.repeat(5000), 'c'.repeat(1000)];
    const groups = partitionEmbeddingInputs(inputs, 4000);
    expect(groups.flat()).toEqual(inputs);
    expect(groups.every(group => embeddingAdmissionEstimate(group) <= 4000)).toBe(true);
    expect(() => partitionEmbeddingInputs(['a'.repeat(9000)], 4000)).toThrow(/No input was truncated/);
  });

  it('stops waiting immediately on cancellation before a provider can be called', async () => {
    const controller = new AbortController(); controller.abort(new Error('cancelled'));
    await expect(waitForEmbeddingBudget(crypto.randomUUID(), 1, controller.signal)).rejects.toThrow(/cancelled/);
  });
});
