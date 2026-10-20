import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import type { AuthenticatedRequest } from '../../src/auth/gateway.js';
import { ModelConfigurationError } from '../../src/review/modelProviderResolver.js';
import { ModelProviderError } from '../../src/review/retry.js';
import type { StaticAnalysisModelProvider } from '../../src/review/types.js';
import {
  ProjectReadinessCoordinator,
  emptyReadiness,
  type ReadinessIndex,
  type ReadinessJob,
  type ReadinessStore,
} from '../../src/readiness/service.js';
import type { ReadinessAssessment, ReadinessInput } from '../../src/readiness/types.js';

const projectId = 'project-1';
const auth = (accessToken = 'bearer-session-1') => ({ userId: 'member-1', accessToken } as AuthenticatedRequest);
let assessmentSequence = 0;

function artifact(): Artifact {
  return {
    id: 'artifact-1', projectId, type: 'source_code', source: 'repository', fileName: 'index.ts', filePath: 'src/index.ts',
    originalPath: null, contentHash: 'hash-1', versionId: 'version-1', createdAt: '2026-10-19T00:00:00.000Z',
  };
}

function index(fingerprint = 'fingerprint-1', overrides: Partial<ReadinessIndex> = {}): ReadinessIndex {
  return { description: 'A test project.', fingerprint, artifacts: [artifact()], unavailable: [], importing: false, ...overrides };
}

function assessment(readinessInput: ReadinessInput, overrides: Partial<ReadinessAssessment> = {}): ReadinessAssessment {
  return {
    id: `assessment-${readinessInput.sourceFingerprint}-${++assessmentSequence}`,
    projectId: readinessInput.projectId,
    sourceFingerprint: readinessInput.sourceFingerprint,
    assessedAt: '2026-10-19T00:01:00.000Z',
    categories: [],
    findings: [],
    ...overrides,
  };
}

function completedJob(sourceFingerprint = 'fingerprint-1'): ReadinessJob {
  const snapshot = assessment({ projectId, description: '', sourceFingerprint, artifacts: [] });
  return {
    ...emptyReadiness(projectId),
    requestId: 'previous-request',
    status: 'completed',
    trigger: 'manual',
    requestedAt: '2026-10-19T00:00:00.000Z',
    startedAt: '2026-10-19T00:00:00.100Z',
    completedAt: '2026-10-19T00:00:01.000Z',
    sourceFingerprint,
    snapshot,
    stale: false,
  };
}

function setup(options: {
  initialIndex?: ReadinessIndex;
  initialJob?: ReadinessJob;
  assess?: (input: ReadinessInput, provider: Pick<StaticAnalysisModelProvider, 'analyze'>, signal?: AbortSignal) => Promise<ReadinessAssessment>;
  debounceMs?: number;
} = {}) {
  let currentIndex = options.initialIndex ?? index();
  const jobs = new Map<string, ReadinessJob>();
  const saves: ReadinessJob[] = [];
  if (options.initialJob) jobs.set(options.initialJob.projectId, options.initialJob);
  const store: ReadinessStore = {
    latest: vi.fn(async project => jobs.get(project) ?? null),
    save: vi.fn(async job => { jobs.set(job.projectId, job); saves.push(job); }),
  };
  const provider: Pick<StaticAnalysisModelProvider, 'analyze'> = { analyze: vi.fn(async () => ({ result: {} })) };
  let clock = Date.parse('2026-10-19T01:00:00.000Z');
  const coordinator = new ProjectReadinessCoordinator({
    store: () => store,
    inspect: vi.fn(async () => currentIndex),
    read: vi.fn(async () => 'export const ready = true;'),
    provider: vi.fn(() => provider),
    assess: options.assess,
    now: () => new Date(clock++),
    debounceMs: options.debounceMs,
  });
  return {
    coordinator,
    jobs,
    saves,
    store,
    provider,
    setIndex(next: ReadinessIndex) { currentIndex = next; },
  };
}

describe('ProjectReadinessCoordinator', () => {
  it('recovers a legacy rate-limit failure as paused without re-assessing updated sources', async () => {
    const previous = { ...completedJob(), status: 'failed' as const, errorCode: 'rate_limited' as const, error: 'Old failure copy' };
    const assess = vi.fn();
    const test = setup({ initialJob: previous, initialIndex: index('new-sources'), assess });
    const status = await test.coordinator.status(auth(), projectId);
    await test.coordinator.waitForIdle();
    expect(status.status).toBe('paused');
    expect(status.snapshot).toEqual(previous.snapshot);
    expect(assess).not.toHaveBeenCalled();
    test.coordinator.close();
  });
  it('also pauses a replacement job queued by source changes during the blocked provider call', async () => {
    let rejectAssessment!: (error: Error) => void;
    const assess = vi.fn(() => new Promise<ReadinessAssessment>((_resolve, reject) => { rejectAssessment = reject; }));
    const test = setup({ assess });
    await test.coordinator.request(auth(), projectId, 'manual', true);
    await vi.waitFor(() => expect(assess).toHaveBeenCalledOnce());
    test.setIndex(index('changed-during-assessment'));
    const replacement = await test.coordinator.request(auth(), projectId, 'source_sync');
    rejectAssessment(new ModelProviderError('private', { code: 'quota_exhausted' }));
    await test.coordinator.waitForIdle();
    expect((await test.store.latest(projectId))).toMatchObject({ requestId: replacement.requestId, status: 'paused', errorCode: 'quota_exhausted' });
    expect(assess).toHaveBeenCalledOnce();
    test.coordinator.close();
  });
  it.each(['rate_limited', 'quota_exhausted', 'credits_exhausted', 'billing_required'])('preserves the snapshot and durably pauses %s until a manual request', async code => {
    const previous = completedJob();
    const assess = vi.fn(async () => { throw new ModelProviderError('private provider payload', { code, retryable: true }); });
    const test = setup({ initialJob: previous, initialIndex: index('changed-2'), assess });
    await test.coordinator.request(auth(), projectId, 'manual', true);
    await test.coordinator.waitForIdle();
    const paused = (await test.store.latest(projectId))!;
    expect(paused.status).toBe('paused');
    expect(paused.errorCode).toBe(code);
    expect(paused.error).not.toContain('private');
    expect(paused.snapshot).toEqual(previous.snapshot);
    expect(paused.stale).toBe(true);

    test.setIndex(index('changed-again-3'));
    await test.coordinator.status(auth(), projectId);
    await test.coordinator.request(auth(), projectId, 'source_sync');
    await test.coordinator.waitForIdle();
    expect(assess).toHaveBeenCalledOnce();
    test.coordinator.close();

    const recoveredAssess = vi.fn(async (input: ReadinessInput) => assessment(input));
    const recovered = setup({ initialJob: paused, initialIndex: index('changed-again-3'), assess: recoveredAssess });
    expect((await recovered.coordinator.status(auth(), projectId)).status).toBe('paused');
    await recovered.coordinator.waitForIdle();
    expect(recoveredAssess).not.toHaveBeenCalled();
    await recovered.coordinator.request(auth(), projectId, 'manual', true);
    await recovered.coordinator.waitForIdle();
    expect(recoveredAssess).toHaveBeenCalledOnce();
    expect((await recovered.store.latest(projectId))?.status).toBe('completed');
    recovered.coordinator.close();
  });
  it('durably completes one job while deduplicating concurrent requests for the same sources', async () => {
    const assess = vi.fn(async (readinessInput: ReadinessInput) => assessment(readinessInput));
    const test = setup({ assess });

    const [first, duplicate] = await Promise.all([
      test.coordinator.request(auth(), projectId, 'manual', true),
      test.coordinator.request(auth(), projectId, 'manual', true),
    ]);
    await test.coordinator.waitForIdle();
    const durable = await test.store.latest(projectId);

    expect(first.requestId).toBeTruthy();
    expect(duplicate.requestId).toBe(first.requestId);
    expect(durable?.status).toBe('completed');
    expect(durable?.snapshot?.sourceFingerprint).toBe('fingerprint-1');
    expect(durable?.stale).toBe(false);
    expect(assess).toHaveBeenCalledOnce();
    expect(test.saves.some(job => job.status === 'completed')).toBe(true);
  });

  it('preserves the previous snapshot on failure and allows a manual retry to replace it', async () => {
    const oldJob = completedJob();
    const oldSnapshot = oldJob.snapshot;
    const providerFailure = new Error('Private provider response must not be exposed.');
    const assess = vi.fn(async (readinessInput: ReadinessInput) => assessment(readinessInput))
      .mockImplementationOnce(async () => { throw providerFailure; });
    const test = setup({ initialJob: oldJob, assess });

    await test.coordinator.request(auth(), projectId, 'manual', true);
    await test.coordinator.waitForIdle();
    const failed = await test.store.latest(projectId);

    expect(failed?.status).toBe('failed');
    expect(failed?.errorCode).toBe('assessment_failed');
    expect(failed?.snapshot).toEqual(oldSnapshot);
    expect(failed?.error).toBe('Readiness could not finish. Check source access and Model Provider configuration, then select Start to retry.');
    expect(failed?.error).not.toContain(providerFailure.message);
    expect(failed?.error).not.toContain('Private');

    await test.coordinator.request(auth(), projectId, 'manual', true);
    await test.coordinator.waitForIdle();
    const retried = await test.store.latest(projectId);
    expect(retried?.status).toBe('completed');
    expect(retried?.snapshot?.id).not.toBe(oldSnapshot?.id);
    expect(assess).toHaveBeenCalledTimes(2);
  });

  it('persists actionable configuration guidance without exposing the provider error', async () => {
    const oldJob = completedJob();
    const oldSnapshot = oldJob.snapshot;
    const assess = vi.fn(async () => { throw new ModelConfigurationError('private configuration detail', 'not_configured'); });
    const test = setup({ initialJob: oldJob, assess });

    await test.coordinator.request(auth(), projectId, 'manual', true);
    await test.coordinator.waitForIdle();
    const failed = await test.store.latest(projectId);

    expect(failed?.status).toBe('failed');
    expect(failed?.errorCode).toBe('not_configured');
    expect(failed?.error).toContain('Configure one in Settings');
    expect(failed?.error).not.toContain('private configuration detail');
    expect(failed?.snapshot).toEqual(oldSnapshot);
  });

  it('classifies a persistence failure and retains the previous snapshot when the failure can be saved', async () => {
    const oldJob = completedJob();
    const test = setup({ initialJob: oldJob });

    await test.coordinator.request(auth(), projectId, 'manual', true);
    vi.mocked(test.store.save).mockImplementationOnce(async () => { throw new Error('private database response'); });
    await test.coordinator.waitForIdle();
    const failed = await test.store.latest(projectId);

    expect(failed?.status).toBe('failed');
    expect(failed?.errorCode).toBe('persistence');
    expect(failed?.error).toContain('Check the project connection');
    expect(failed?.error).not.toContain('private database response');
    expect(failed?.snapshot).toEqual(oldJob.snapshot);
  });

  it('rejects an obsolete result when the source fingerprint changes during model assessment', async () => {
    let releaseFirst!: (value: ReadinessAssessment) => void;
    const firstResult = new Promise<ReadinessAssessment>(resolve => { releaseFirst = resolve; });
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const assess = vi.fn(async (readinessInput: ReadinessInput) => {
      if (readinessInput.sourceFingerprint === 'fingerprint-1') {
        markStarted();
        return firstResult;
      }
      return assessment(readinessInput);
    });
    const test = setup({ assess });

    await test.coordinator.request(auth(), projectId, 'manual', true);
    await started;
    test.setIndex(index('fingerprint-2'));
    releaseFirst(assessment({ projectId, description: '', sourceFingerprint: 'fingerprint-1', artifacts: [] }));
    await test.coordinator.waitForIdle();
    const durable = await test.store.latest(projectId);

    expect(assess.mock.calls.map(call => call[0].sourceFingerprint)).toEqual(['fingerprint-1', 'fingerprint-2']);
    expect(durable?.status).toBe('completed');
    expect(durable?.sourceFingerprint).toBe('fingerprint-2');
    expect(durable?.snapshot?.sourceFingerprint).toBe('fingerprint-2');
    expect(test.saves.filter(job => job.status === 'completed').every(job => job.snapshot?.sourceFingerprint === 'fingerprint-2')).toBe(true);
  });

  it('recovers a durable running job after coordinator restart', async () => {
    const interrupted: ReadinessJob = {
      ...completedJob(), requestId: 'interrupted-request', status: 'running', completedAt: null, snapshot: null, stale: true,
    };
    const assess = vi.fn(async (readinessInput: ReadinessInput) => assessment(readinessInput));
    const test = setup({ initialJob: interrupted, assess });

    const status = await test.coordinator.status(auth('refreshed-session'), projectId);
    await test.coordinator.waitForIdle();
    const durable = await test.store.latest(projectId);

    expect(status.status).toBe('running');
    expect(durable?.requestId).toBe('interrupted-request');
    expect(durable?.status).toBe('completed');
    expect(assess).toHaveBeenCalledOnce();
  });

  it('keeps queued work deferred during import and resumes it after import completion', async () => {
    const assess = vi.fn(async (readinessInput: ReadinessInput) => assessment(readinessInput));
    const test = setup({ initialIndex: index('fingerprint-1', { importing: true }), assess });

    const queued = await test.coordinator.request(auth(), projectId, 'repository_imported', true);
    await test.coordinator.waitForIdle();
    expect(queued.status).toBe('queued');
    expect((await test.store.latest(projectId))?.status).toBe('queued');
    expect(assess).not.toHaveBeenCalled();

    test.setIndex(index('fingerprint-1', { importing: false }));
    await test.coordinator.status(auth(), projectId);
    await test.coordinator.waitForIdle();
    expect((await test.store.latest(projectId))?.status).toBe('completed');
    expect(assess).toHaveBeenCalledOnce();
  });

  it('debounces source notifications and retains the latest trigger', async () => {
    const assess = vi.fn(async (readinessInput: ReadinessInput) => assessment(readinessInput));
    const test = setup({ assess, debounceMs: 25 });
    test.coordinator.notify(auth(), projectId, 'source_changed');
    test.coordinator.notify(auth('rotated-session'), projectId, 'document_uploaded');
    test.coordinator.notify(auth('latest-session'), projectId, 'source_removed');
    await new Promise(resolve => setTimeout(resolve, 60));
    await test.coordinator.waitForIdle();

    const durable = await test.store.latest(projectId);
    expect(assess).toHaveBeenCalledOnce();
    expect(durable?.trigger).toBe('source_removed');
  });

  it('fails closed when the assessment returns a different project', async () => {
    const oldJob = completedJob();
    const wrongProjectAssess = vi.fn(async (readinessInput: ReadinessInput) => assessment(readinessInput, { projectId: 'project-elsewhere' }));
    const test = setup({ initialJob: oldJob, assess: wrongProjectAssess });

    await test.coordinator.request(auth(), projectId, 'manual', true);
    await test.coordinator.waitForIdle();
    const durable = await test.store.latest(projectId);

    expect(durable?.status).toBe('failed');
    expect(durable?.snapshot).toEqual(oldJob.snapshot);
    expect(durable?.snapshot?.projectId).toBe(projectId);
  });
});
