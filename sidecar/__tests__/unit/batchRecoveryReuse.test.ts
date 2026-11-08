import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { createStaticReviewOrchestrator } from '../../src/review/orchestrator.js';
import { InMemoryStaticReviewRepository } from '../../src/review/repository.js';
import type { ValidatedBatchCacheRecord } from '../../src/review/batchCheckpoint.js';
import type { StaticModelRequest } from '../../src/review/types.js';
import { candidateSupportResult, isCandidateSupportRequest } from '../fixtures/semanticSupport.js';
import { readPromptAnalysisMap } from '../fixtures/promptAnalysisMap.js';

// Same-Review batch reuse after lease recovery (user-approved, 6 November 2026).
const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
// Seventeen one-operation files plan several bounded batches (at most eight
// operations each), so more than one batch can finish before an interruption.
const files = [
  ...Array.from({ length: 17 }, (_, index) => ({ id: `module${index}`, path: `src/module${index}.ts`,
    body: `export function operation${index}(input) { return input.value${index}; }\n` })),
].map(file => ({ ...file, hash: crypto.createHash('sha256').update(file.body).digest('hex') }));
const artifacts: Artifact[] = files.map(file => ({
  id: file.id, projectId, versionId: `${file.id}-v1`, contentHash: file.hash, type: 'source_code', source: 'repository',
  fileName: file.path.split('/').pop()!, filePath: file.path, originalPath: null, createdAt: '2026-11-06T00:00:00.000Z',
}));

type Behaviour = 'answer' | 'hang';

function makeHarness(options: { disposition?: 'supported' | 'insufficient' } = {}) {
  const repository = new InMemoryStaticReviewRepository();
  const records = new Map<string, ValidatedBatchCacheRecord>();
  const cache = {
    load: vi.fn(async (_projectId: string, requestHash: string) => {
      const record = records.get(requestHash);
      return record ? structuredClone(record) : null;
    }),
    save: vi.fn(async (record: ValidatedBatchCacheRecord) => {
      if (!records.has(record.requestHash)) records.set(record.requestHash, structuredClone(record));
    }),
  };
  const requests: StaticModelRequest[] = [];
  const state = { hangAtCall: null as number | null, disposition: options.disposition ?? 'supported', hung: null as null | (() => void) };
  let reachedHang: () => void = () => {};
  const hangReached = new Promise<void>(resolve => { reachedHang = resolve; });
  const behaviour = (): Behaviour => state.hangAtCall === requests.length ? 'hang' : 'answer';
  const provider = { analyze: vi.fn(async (request: StaticModelRequest) => {
    requests.push(request);
    if (behaviour() === 'hang') {
      reachedHang();
      // The interrupted worker never returns (app quit / computer shut down).
      return new Promise<never>(() => {});
    }
    const result = isCandidateSupportRequest(request)
      ? candidateSupportResult(request, { disposition: state.disposition })
      : (() => {
        const map = readPromptAnalysisMap(request);
        const file = files.find(item => request.prompt.includes(item.body.trimEnd())) ?? files[0]!;
        return {
          findings: [{
            title: 'Function trusts unverified input',
            description: 'The function returns a caller-supplied field without checking authorization.',
            severity: 'high', category: 'authorization', filePath: file.path, lineNumber: 1,
            evidence: file.body.trimEnd(), recommendation: 'Validate authorization before returning the field.',
            confidence: 'high', domain: 'security', issueType: 'authorization_bypass', logicFlow: [], relatedLocations: [],
            artifactId: file.id, requirementId: null, standardId: null, standardRuleId: null, ruleId: null,
            sourceIdentity: file.path, sourceVersion: file.hash, sourceLocator: null,
          }],
          featureAssessments: map.features.map(feature => ({ featureId: feature.id, assessments: ['security', 'business', 'technical', 'personnel']
            .map(domain => ({ domain, status: 'assessed', outcome: 'no_issue_identified', summary: 'The supplied local operation was inspected.', evidence: feature.entryPoints })) })),
        };
      })();
    return { result, usage: { inputTokens: 120, outputTokens: 24, totalTokens: 144 },
      settings: { provider: 'fixture', apiFormat: 'openai-compatible', model: 'offline' } };
  }) };
  const fingerprint = { value: 'c'.repeat(64) };
  // Each runner stands for one sidecar process; the repository and cache are
  // the durable Supabase state they share across the interruption.
  const makeRunner = () => createStaticReviewOrchestrator({
    repository,
    deterministic: async () => [],
    retry: { sleep: async () => undefined, maxAttempts: 1 },
    readArtifactContent: async artifact => files.find(file => file.id === artifact.id)!.body,
    modelProvider: provider,
    modelProviderResolver: async () => ({
      primaryProvider: provider,
      primaryMetadata: { provider: 'fixture', apiFormat: 'openai-compatible', model: 'offline' },
      configurationId: 'fixture-config', configurationFingerprint: fingerprint.value,
    }),
    batchCache: cache,
    cacheOwnerId: ownerId,
  });
  return { repository, cache, records, requests, provider, state, hangReached, fingerprint, makeRunner };
}

type Harness = ReturnType<typeof makeHarness>;

async function cleanCallCount() {
  const harness = makeHarness();
  const started = await harness.makeRunner().start({ projectId, reviewType: 'code_review', artifacts, idempotencyKey: 'probe' });
  const finished = await started.completion;
  expect(finished.modelStatus).toBe('succeeded');
  const findings = (await harness.repository.listReviewFindings(finished.id)).filter(finding => finding.source === 'model');
  return { calls: harness.requests.length, saved: harness.cache.save.mock.calls.length,
    findings: findings.map(finding => `${finding.filePath}:${finding.lineNumber}:${finding.title}`).sort() };
}

/** Run until the provider call `hangAtCall` is in flight, then simulate lease
 * recovery by a new sidecar process and resume the same Review there. */
async function interruptAndRecover(harness: Harness, hangAtCall: number, beforeResume?: (reviewId: string) => Promise<void> | void,
  recovery: 'lease' | 'none' = 'lease') {
  harness.state.hangAtCall = hangAtCall;
  const started = await harness.makeRunner().start({ projectId, reviewType: 'code_review', artifacts, idempotencyKey: 'interrupted' });
  await harness.hangReached;
  harness.state.hangAtCall = null;
  const reviewId = started.review.id;
  const callsBeforeResume = harness.requests.length;
  const attemptsBeforeResume = structuredClone(harness.repository.attempts.filter(attempt => attempt.reviewId === reviewId));
  await harness.repository.transitionReview(reviewId, ['queued', 'running'], { status: 'queued', updatedAt: new Date().toISOString() });
  if (recovery === 'lease') {
    await harness.repository.recordAudit({ reviewId, projectId, event: 'review_lease_recovered', createdAt: new Date().toISOString(),
      detail: { action: 'requeued', leaseAttempt: 1, recoveryAttempt: 1, checkpointStage: 'model_analysis' } });
  }
  await beforeResume?.(reviewId);
  harness.cache.load.mockClear();
  const resumed = await harness.makeRunner().resumeQueuedReview(reviewId);
  const finished = await resumed.completion;
  const events = harness.repository.audits.filter(event => event.reviewId === reviewId);
  return { reviewId, finished, callsBeforeResume, resumedCalls: harness.requests.length - callsBeforeResume, attemptsBeforeResume, events };
}

describe('same-Review validated batch reuse after lease recovery', () => {
  it('reuses every batch finished before the interruption and re-sends only unfinished work', async () => {
    const clean = await cleanCallCount();
    // Every batch is one generation plus one support call in this fixture.
    expect(clean.calls).toBe(clean.saved * 2);
    expect(clean.saved).toBeGreaterThanOrEqual(2);
    const finishedBatches = clean.saved - 1;
    expect(finishedBatches).toBeGreaterThanOrEqual(2);
    const harness = makeHarness();
    const run = await interruptAndRecover(harness, finishedBatches * 2 + 1);

    expect(run.finished.status).toBe('pending_approval');
    expect(run.finished.modelStatus).toBe('succeeded');
    expect(run.callsBeforeResume).toBe(finishedBatches * 2 + 1);
    // Only the batch that was in flight is sent again.
    expect(run.resumedCalls).toBe(2);
    const reused = run.events.filter(event => event.event === 'review_batch_cache_reused');
    expect(reused).toHaveLength(finishedBatches);
    for (const event of reused) {
      expect(event.detail).toMatchObject({ originReviewId: run.reviewId, reuseKind: 'lease_recovery', providerCallsAvoided: 2 });
      // Reused batches add no new attempts or usage; the original records stay.
      const stage = `model_analysis:${event.detail?.batchId}`;
      const attempts = harness.repository.attempts.filter(attempt => attempt.reviewId === run.reviewId && attempt.stage === stage);
      expect(attempts).toEqual(run.attemptsBeforeResume.filter(attempt => attempt.stage === stage));
      expect(attempts.length).toBeGreaterThan(0);
    }
    expect(run.events.some(event => event.event === 'review_batch_cache_rejected')).toBe(false);
    // Reused and fresh batches persist the same findings as an uninterrupted run.
    const findings = (await harness.repository.listReviewFindings(run.reviewId)).filter(finding => finding.source === 'model');
    expect(findings.map(finding => `${finding.filePath}:${finding.lineNumber}:${finding.title}`).sort()).toEqual(clean.findings);
  });

  it('reuses finished batches when the resumed run reads its traceability snapshot back with reordered keys', async () => {
    // 8 November 2026: the first run builds traceability records in memory, the
    // resumed run reads them from Postgres jsonb, which stores object keys in
    // its own order. The prompt (and so the cache identity) must not change.
    const clean = await cleanCallCount();
    const finishedBatches = clean.saved - 1;
    const harness = makeHarness();
    const capturedAt = '2026-11-08T13:23:49.615Z';
    const record = { requirementId: 'req-1', title: 'Catalogue is public', description: 'Anyone can list products.',
      category: 'acceptance_criterion', state: 'missing', mappingIds: [], sourceArtifactIds: [], sourceSymbolIds: [],
      confidence: null, capturedAt, evidenceStatus: 'verified', mappings: [] };
    const reversed = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).reverse());
    const capture = harness.repository.captureTraceabilitySnapshot.bind(harness.repository);
    let calls = 0;
    vi.spyOn(harness.repository, 'captureTraceabilitySnapshot').mockImplementation(async (...args) => {
      const snapshot = await capture(...args);
      calls++;
      return { ...snapshot, records: [calls === 1 ? record : reversed(record)] as typeof snapshot.records };
    });
    const run = await interruptAndRecover(harness, finishedBatches * 2 + 1);
    expect(calls).toBe(2);
    const prompts = harness.requests.map(request => request.prompt);
    expect(prompts[0]).toContain(JSON.stringify(Object.fromEntries(Object.entries(record).sort(([a], [b]) => a < b ? -1 : 1))));
    expect(run.events.filter(event => event.event === 'review_batch_cache_reused')).toHaveLength(finishedBatches);
    expect(run.resumedCalls).toBe(2);
  });

  it('reuses nothing when the Review was not requeued by lease recovery', async () => {
    const harness = makeHarness();
    const run = await interruptAndRecover(harness, 3, undefined, 'none');
    expect(run.finished.modelStatus).toBe('succeeded');
    expect(run.events.some(event => event.event === 'review_batch_cache_reused')).toBe(false);
    expect(harness.cache.load).not.toHaveBeenCalled();
  });

  it.each([
    ['provider configuration', (harness: Harness) => { harness.fingerprint.value = 'd'.repeat(64); }],
    ['frozen source manifest', (harness: Harness, reviewId: string) => {
      const manifest = harness.repository.manifests.get(reviewId)!;
      manifest.artifacts = manifest.artifacts.map(artifact => ({ ...artifact, versionId: `${artifact.versionId}-renamed` }));
    }],
    ['origin Review', (harness: Harness) => {
      for (const record of harness.records.values()) record.originReviewId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    }],
  ] as const)('re-sends finished batches when the %s does not match', async (_label, mutate) => {
    const harness = makeHarness();
    const run = await interruptAndRecover(harness, 3, reviewId => mutate(harness, reviewId));
    const clean = await cleanCallCount();
    expect(run.events.some(event => event.event === 'review_batch_cache_reused')).toBe(false);
    expect(run.resumedCalls).toBe(clean.calls);
  });

  it('re-runs a batch whose journal records it as needing verification', async () => {
    const harness = makeHarness();
    const run = await interruptAndRecover(harness, 3, async reviewId => {
      const saved = harness.repository.audits.find(event => event.reviewId === reviewId && event.event === 'review_analysis_batch_saved');
      await harness.repository.recordAudit({ reviewId, projectId, event: 'review_batch_needs_verification', stage: 'model_analysis',
        createdAt: new Date().toISOString(), detail: { batchId: saved?.detail?.batchId, reason: 'model_timeout' } });
    });
    const clean = await cleanCallCount();
    expect(harness.records.size).toBeGreaterThan(0);
    expect(run.events.some(event => event.event === 'review_batch_cache_reused')).toBe(false);
    expect(run.resumedCalls).toBe(clean.calls);
  });

  it('never caches or reuses an unverified (insufficient-support) batch', async () => {
    const harness = makeHarness({ disposition: 'insufficient' });
    const run = await interruptAndRecover(harness, 3);
    expect(harness.cache.save).not.toHaveBeenCalled();
    expect(run.events.some(event => event.event === 'review_batch_cache_reused')).toBe(false);
    // The batch finished before the interruption is sent again after recovery.
    expect(run.resumedCalls).toBeGreaterThanOrEqual(2);
    const firstBatch = harness.requests[0]!.prompt;
    expect(harness.requests.slice(run.callsBeforeResume).some(request => request.prompt === firstBatch)).toBe(true);
  });
});
