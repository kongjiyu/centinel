import { describe, it, expect } from 'vitest';
import { projectBatchCacheUsage } from '../../src/review/batchCacheUsage.js';

const source = { artifactId: 'a', artifactVersionId: 'v1', contentHash: 'hash', filePath: 'a.ts', lineStart: 1, lineEnd: 4 };
const origin = '11111111-1111-4111-8111-111111111111';
const event = (batchId = 'batch-1', reference = source) => ({ event_type: 'review_batch_cache_reused', payload: {
  detail: { batchId, originReviewId: origin, providerCallsAvoided: 2, sourceReferences: [reference] },
} });
const manifest = new Map([['a', source]]);

describe('validated batch reuse accounting', () => {
  it('deduplicates journal replays and reports historical evidence separately', () => {
    expect(projectBatchCacheUsage([event(), event(), event('batch-2')], manifest)).toEqual({
      status: 'available', batchCount: 2, minimumCallsAvoided: 4, originReviewIds: [origin], uniqueFileCount: 1,
      files: [{ ...source, lineStart: null, lineEnd: null }],
    });
  });
  it('does not count mismatched frozen versions as inspected files', () => {
    const result = projectBatchCacheUsage([event('batch-1', { ...source, artifactVersionId: 'other' })], manifest);
    expect(result).toMatchObject({ status: 'partial', batchCount: null, minimumCallsAvoided: null, uniqueFileCount: null, files: [] });
  });
  it('preserves missing journals and manifests as unavailable/partial', () => {
    expect(projectBatchCacheUsage(null, manifest)).toMatchObject({ status: 'unavailable', batchCount: null });
    expect(projectBatchCacheUsage([event()], null)).toMatchObject({ status: 'partial', uniqueFileCount: null });
    expect(projectBatchCacheUsage([], null)).toMatchObject({ status: 'available', batchCount: 0, uniqueFileCount: 0 });
  });
  it('rejects malformed counts and ignores unrelated provider/harness events', () => {
    const bad = event(); bad.payload.detail.providerCallsAvoided = 900;
    expect(projectBatchCacheUsage([bad], manifest)).toMatchObject({ status: 'partial', batchCount: null });
    expect(projectBatchCacheUsage([{ event_type: 'model_attempt', payload: { inputTokens: 10 } }], manifest))
      .toMatchObject({ status: 'available', batchCount: 0, minimumCallsAvoided: 0 });
  });
});
