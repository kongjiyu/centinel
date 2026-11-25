import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { createStaticReviewOrchestrator } from '../../src/review/orchestrator.js';
import { InMemoryStaticReviewRepository } from '../../src/review/repository.js';
import { ModelProviderError } from '../../src/review/retry.js';
import { ValidatedBatchCacheError, type ValidatedBatchCacheRecord } from '../../src/review/batchCheckpoint.js';
import type { StaticModelRequest } from '../../src/review/types.js';
import { candidateSupportResult, isCandidateSupportRequest } from '../fixtures/semanticSupport.js';
import { readPromptAnalysisMap } from '../fixtures/promptAnalysisMap.js';

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const source = 'export function checkout(user) { return user.id; }\n';
const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
const sourceArtifact: Artifact = {
  id: 'checkout', projectId, versionId: 'checkout-v1', contentHash: sourceHash, type: 'source_code', source: 'repository',
  fileName: 'checkout.ts', filePath: 'src/checkout.ts', originalPath: null, createdAt: '2026-10-28T00:00:00.000Z',
};

function makeCache() {
  const records = new Map<string, ValidatedBatchCacheRecord>();
  const cache = {
    load: vi.fn(async (_projectId: string, requestHash: string) => {
      const record = records.get(requestHash);
      return record ? structuredClone(record) : null;
    }),
    save: vi.fn(async (record: ValidatedBatchCacheRecord) => {
      if (!records.has(record.requestHash)) records.set(record.requestHash, structuredClone(record));
    }),
    records,
  };
  return cache;
}

function makeHarness(options: { disposition?: 'supported' | 'contradicted' | 'insufficient'; pauseAtCall?: number | null; cacheEnabled?: boolean } = {}) {
  const repository = new InMemoryStaticReviewRepository();
  const cache = makeCache();
  const requests: StaticModelRequest[] = [];
  const pauseAtCall = { value: options.pauseAtCall === undefined ? 3 : options.pauseAtCall };
  const provider = { analyze: vi.fn(async (request: StaticModelRequest) => {
    requests.push(request);
    if (pauseAtCall.value === requests.length) throw new ModelProviderError('Synthetic provider capacity pause.', {
      code: 'credits_exhausted', retryable: false,
    });
    const result = isCandidateSupportRequest(request)
      ? candidateSupportResult(request, { disposition: options.disposition })
      : (() => {
        const map = readPromptAnalysisMap(request);
        return {
          findings: [{
            title: 'Checkout trusts an unverified identity',
            description: 'The function returns the supplied user ID without checking authorization.',
            severity: 'high', category: 'authorization', filePath: sourceArtifact.filePath, lineNumber: 1,
            evidence: source.trimEnd(), recommendation: 'Validate the user authorization before returning its identity.',
            confidence: 'high', domain: 'security', issueType: 'authorization_bypass', logicFlow: [], relatedLocations: [],
            artifactId: sourceArtifact.id, requirementId: null, standardId: null, standardRuleId: null, ruleId: null,
            sourceIdentity: sourceArtifact.filePath, sourceVersion: sourceHash, sourceLocator: null,
          }],
          featureAssessments: map.features.map(feature => ({ featureId: feature.id, assessments: ['security', 'business', 'technical', 'personnel']
            .map(domain => ({ domain, status: 'assessed', outcome: 'no_issue_identified', summary: 'The supplied local operation was inspected.', evidence: feature.entryPoints })) })),
        };
      })();
    return { result, usage: { inputTokens: 120, outputTokens: 24, totalTokens: 144 },
      settings: { provider: 'fixture', apiFormat: 'openai-compatible', model: 'offline' } };
  }) };
  const fingerprint = { value: 'c'.repeat(64) };
  const runner = createStaticReviewOrchestrator({
    repository,
    deterministic: async () => [],
    retry: { sleep: async () => undefined, maxAttempts: 1 },
    readArtifactContent: async () => source,
    modelProvider: provider,
    modelProviderResolver: async () => ({
      primaryProvider: provider,
      primaryMetadata: { provider: 'fixture', apiFormat: 'openai-compatible', model: 'offline' },
      configurationId: 'fixture-config', configurationFingerprint: fingerprint.value,
    }),
    batchCache: options.cacheEnabled === false ? undefined : cache,
    cacheOwnerId: ownerId,
  });
  return { repository, cache, requests, provider, runner, fingerprint, pauseAtCall };
}

async function runInitial(harness: ReturnType<typeof makeHarness>) {
  const started = await harness.runner.start({ projectId, reviewType: 'code_review', artifacts: [sourceArtifact], idempotencyKey: 'initial' });
  const finished = await started.completion;
  return { started, finished };
}

describe('validated batch cache in the Review orchestrator', () => {
  it('rejects unavailable cache-basis wiring before creating or paying for a retry', async () => {
    const harness = makeHarness();
    const { finished: parent } = await runInitial(harness);
    Object.defineProperty(harness.repository, 'getBatchCacheBasis', { value: undefined });
    const count = harness.repository.reviews.size;
    const calls = harness.provider.analyze.mock.calls.length;
    await expect(harness.runner.retry({ reviewId: parent.id, reuseValidatedBatches: true }))
      .rejects.toThrow('available encrypted cache');
    expect(harness.repository.reviews.size).toBe(count);
    expect(harness.provider.analyze).toHaveBeenCalledTimes(calls);
  });
  it('allows fresh keyless Codex-style runtimes while rejecting explicit unavailable cache reuse before creation', async () => {
    const harness = makeHarness({ cacheEnabled: false });
    const { finished: parent } = await runInitial(harness);
    expect(parent.status).toBe('blocked');
    const paidBefore = harness.provider.analyze.mock.calls.length;
    const reviewsBefore = harness.repository.reviews.size;
    await expect(harness.runner.retry({ reviewId: parent.id, reuseValidatedBatches: true }))
      .rejects.toThrow('available encrypted cache');
    expect(harness.repository.reviews.size).toBe(reviewsBefore);
    expect(harness.provider.analyze).toHaveBeenCalledTimes(paidBefore);
    harness.pauseAtCall.value = null;
    const retry = await harness.runner.retry({ reviewId: parent.id });
    expect((await retry.completion).modelStatus).toBe('succeeded');
    expect(harness.cache.save).not.toHaveBeenCalled();
  });
  it('saves a clean generation plus semantic support and reuses both only for an explicit frozen-source retry', async () => {
    const harness = makeHarness();
    const { finished: parent } = await runInitial(harness);

    expect(parent.status).toBe('blocked');
    expect(parent.modelStatus).toBe('partial');
    expect(harness.provider.analyze).toHaveBeenCalledTimes(3); // one clean generation/support pair, then quota stop
    expect(harness.cache.save).toHaveBeenCalledTimes(1);
    const [saved] = harness.cache.records.values();
    expect(saved?.supportRecords).toHaveLength(1);
    expect(saved?.supportRecords[0]?.disposition).toBe('supported');

    harness.pauseAtCall.value = null;
    const retry = await harness.runner.retry({ reviewId: parent.id, reuseValidatedBatches: true, idempotencyKey: 'reuse-clean-batch' });
    const retried = await retry.completion;

    expect(retried.status).toBe('pending_approval');
    expect(retried.modelStatus).toBe('succeeded');
    expect(harness.provider.analyze).toHaveBeenCalledTimes(5); // only the uncached later batch runs generation and support
    expect(harness.repository.attempts.filter(attempt => attempt.reviewId === retried.id)).toHaveLength(2);
    const reuseEvent = harness.repository.audits.find(event => event.reviewId === retried.id && event.event === 'review_batch_cache_reused');
    expect(reuseEvent?.detail).toMatchObject({ providerCallsAvoided: 2, originReviewId: parent.id });
    expect(harness.repository.audits.filter(event => event.reviewId === retried.id && event.event === 'model_attempt')).toHaveLength(2);
    expect(harness.repository.audits.some(event => event.reviewId === retried.id && event.event === 'review_batch_cache_rejected')).toBe(false);
    const reusedBatchId = reuseEvent?.detail?.batchId;
    const retriedAttempts = harness.repository.attempts.filter(attempt => attempt.reviewId === retried.id);
    expect(reusedBatchId).toEqual(expect.any(String));
    expect(retriedAttempts.some(attempt => attempt.stage === `model_analysis:${reusedBatchId}`)).toBe(false);
  });

  it('does not read or consume cache during an ordinary saved-source retry', async () => {
    const harness = makeHarness();
    const { finished: parent } = await runInitial(harness);
    harness.cache.load.mockClear();
    harness.pauseAtCall.value = null;

    const retry = await harness.runner.retry({ reviewId: parent.id, idempotencyKey: 'ordinary-retry' });
    const retried = await retry.completion;

    expect(retried.modelStatus).toBe('succeeded');
    expect(harness.provider.analyze).toHaveBeenCalledTimes(7);
    expect(harness.cache.load).not.toHaveBeenCalled();
    expect(harness.repository.attempts.filter(attempt => attempt.reviewId === retried.id)).toHaveLength(4);
    expect(harness.repository.audits.some(event => event.reviewId === retried.id && event.event === 'review_batch_cache_reused')).toBe(false);
  });

  it('misses when the resolved provider configuration fingerprint changes', async () => {
    const harness = makeHarness();
    const { finished: parent } = await runInitial(harness);
    harness.fingerprint.value = 'd'.repeat(64);
    harness.pauseAtCall.value = null;

    const retry = await harness.runner.retry({ reviewId: parent.id, reuseValidatedBatches: true, idempotencyKey: 'changed-provider' });
    const retried = await retry.completion;

    expect(retried.modelStatus).toBe('succeeded');
    expect(harness.provider.analyze).toHaveBeenCalledTimes(7);
    expect(harness.cache.load).toHaveBeenCalledTimes(2);
    expect(harness.repository.audits.some(event => event.reviewId === retried.id && event.event === 'review_batch_cache_reused')).toBe(false);
    expect(harness.repository.attempts.filter(attempt => attempt.reviewId === retried.id)).toHaveLength(4);
  });

  it.each(['citation', 'support'] as const)('rejects a cached %s mutation and pays for a fresh validated batch', async mutation => {
    const harness = makeHarness();
    const { finished: parent } = await runInitial(harness);
    const [saved] = harness.cache.records.values();
    if (!saved) throw new Error('The clean first batch was not cached.');
    if (mutation === 'citation') {
      const findings = (saved.generation as { findings: Array<{ evidence: string }> }).findings;
      findings[0]!.evidence = 'not present in frozen source';
    } else {
      saved.supportRecords[0]!.references[0]!.evidence = 'not present in frozen source';
    }
    harness.pauseAtCall.value = null;

    const retry = await harness.runner.retry({ reviewId: parent.id, reuseValidatedBatches: true, idempotencyKey: `mutated-${mutation}` });
    const retried = await retry.completion;

    expect(retried.modelStatus).toBe('succeeded');
    expect(harness.provider.analyze).toHaveBeenCalledTimes(7);
    expect(harness.repository.audits.some(event => event.reviewId === retried.id && event.event === 'review_batch_cache_rejected')).toBe(true);
    expect(harness.repository.audits.some(event => event.reviewId === retried.id && event.event === 'review_batch_cache_reused')).toBe(false);
  });

  it('does not persist a batch whose semantic support contradicts the generated candidate', async () => {
    const harness = makeHarness({ disposition: 'contradicted', pauseAtCall: null });
    const { finished } = await runInitial(harness);

    expect(finished.status).toBe('pending_approval');
    expect(harness.provider.analyze).toHaveBeenCalledTimes(4);
    expect(harness.cache.save).not.toHaveBeenCalled();
  });

  it('fails closed on a cache persistence read error before making any paid retry calls', async () => {
    const harness = makeHarness();
    const { finished: parent } = await runInitial(harness);
    const callsBeforeRetry = harness.provider.analyze.mock.calls.length;
    harness.pauseAtCall.value = null;
    harness.cache.load.mockRejectedValue(new Error('cache unavailable'));

    const retry = await harness.runner.retry({ reviewId: parent.id, reuseValidatedBatches: true, idempotencyKey: 'cache-read-fails' });
    const retried = await retry.completion;

    expect(retried.status).toBe('failed');
    expect(harness.provider.analyze).toHaveBeenCalledTimes(callsBeforeRetry);
    expect(harness.repository.attempts.filter(attempt => attempt.reviewId === retried.id)).toHaveLength(0);
    expect(retried.failureReason).toContain('cache');
  });

  it('treats a corrupt receipt on read as a miss and suppresses only that batch write', async () => {
    const harness = makeHarness();
    const { finished: parent } = await runInitial(harness);
    const [firstBatchHash] = [...harness.cache.records.keys()];
    harness.pauseAtCall.value = null;
    harness.cache.load.mockRejectedValueOnce(new ValidatedBatchCacheError('corrupt cache receipt', 'invalid_receipt'));

    const retry = await harness.runner.retry({ reviewId: parent.id, reuseValidatedBatches: true, idempotencyKey: 'corrupt-receipt' });
    const retried = await retry.completion;

    expect(retried.modelStatus).toBe('succeeded');
    expect(harness.provider.analyze).toHaveBeenCalledTimes(7);
    expect(harness.cache.load).toHaveBeenCalledTimes(2);
    expect(harness.cache.save).toHaveBeenCalledTimes(2); // cold saved batch + later clean batch only
    const retryWrites = harness.cache.save.mock.calls.map(([record]) => record).filter(record => record.originReviewId === retried.id);
    expect(retryWrites).toHaveLength(1);
    expect(retryWrites[0]?.requestHash).not.toBe(firstBatchHash);
    expect(harness.repository.audits.some(event => event.reviewId === retried.id && event.event === 'review_batch_cache_rejected'
      && event.detail?.reason === 'invalid_receipt')).toBe(true);
  });

  it('skips an invalid cache write without failing an otherwise valid Review', async () => {
    const harness = makeHarness({ pauseAtCall: null });
    harness.cache.save.mockRejectedValue(new ValidatedBatchCacheError('cache schema is stricter than this Review result', 'invalid_record'));

    const { finished } = await runInitial(harness);

    expect(finished.modelStatus).toBe('succeeded');
    expect(finished.status).toBe('pending_approval');
    expect(harness.provider.analyze).toHaveBeenCalledTimes(4);
    expect(harness.cache.save).toHaveBeenCalledTimes(2);
    expect(harness.repository.audits.filter(event => event.event === 'review_batch_cache_rejected'
      && event.detail?.reason === 'invalid_record')).toHaveLength(2);
  });
});
