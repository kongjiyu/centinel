import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import type { AuthenticatedRequest } from '../../src/auth/gateway.js';
import { emptyReadiness, ProjectReadinessCoordinator, type ReadinessDependencies, type ReadinessJob, type ReadinessIndex } from '../../src/readiness/service.js';
import type { ReadinessAssessment } from '../../src/readiness/types.js';

const projectId = 'project-1';

function artifact(index: number): Artifact {
  return {
    id: `artifact-${index}`, projectId, versionId: `version-${index}`, type: 'source_code', source: 'repository',
    fileName: `${index}.ts`, filePath: `src/${index}.ts`, originalPath: null, contentHash: '', createdAt: '2026-10-23',
  };
}

function indexOf(count: number): ReadinessIndex {
  return {
    description: 'Fixture project.', fingerprint: 'fingerprint-new', artifacts: Array.from({ length: count }, (_, index) => artifact(index)),
    unavailable: [], preloaded: [], importing: false,
  };
}

function dependencies(
  index: ReadinessIndex,
  patch: Partial<ReadinessDependencies> = {},
) {
  let current: ReadinessJob | null = null;
  const store = {
    latest: vi.fn(async () => current),
    save: vi.fn(async (job: ReadinessJob) => { current = structuredClone(job); }),
  };
  const dependencySet = {
    store: () => store,
    inspect: vi.fn(async () => index),
    read: vi.fn(async (_auth: AuthenticatedRequest, source: Artifact, signal: AbortSignal) => `${source.id}:${String(signal.aborted)}`),
    provider: vi.fn(() => ({ analyze: vi.fn() })),
    assess: vi.fn(async (input: Parameters<NonNullable<ConstructorParameters<typeof ProjectReadinessCoordinator>[0]['assess']>>[0]) => ({
      id: 'snapshot-new', projectId: input.projectId, sourceFingerprint: input.sourceFingerprint, assessedAt: '2026-10-23T00:00:00.000Z',
      categories: [], findings: [],
    } as ReadinessAssessment)),
    ...patch,
  };
  return { dependencySet, store, getCurrent: () => current };
}

const auth = { userId: 'member-1', client: {} } as unknown as AuthenticatedRequest;

describe('Readiness frozen source batch reads', () => {
  it('reads every selected artifact with at most four concurrent operations and stable input order', async () => {
    const index = indexOf(11);
    let active = 0;
    let maximumActive = 0;
    const { dependencySet, store } = dependencies(index, {
      read: vi.fn(async (_auth, source, signal) => {
        expect(signal.aborted).toBe(false);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active -= 1;
        return source.id;
      }),
      assess: vi.fn(async input => ({
        id: 'snapshot-new', projectId: input.projectId, sourceFingerprint: input.sourceFingerprint,
        assessedAt: '2026-10-23T00:00:00.000Z', categories: [], findings: [],
      })),
    });
    const coordinator = new ProjectReadinessCoordinator(dependencySet);
    await coordinator.request(auth, projectId, 'manual');
    await coordinator.waitForIdle();

    expect(maximumActive).toBe(4);
    expect(dependencySet.read).toHaveBeenCalledTimes(index.artifacts.length);
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'completed',
      snapshot: expect.objectContaining({ id: 'snapshot-new' }),
    }));
    const assessmentInput = vi.mocked(dependencySet.assess).mock.calls[0][0];
    expect(assessmentInput.artifacts.map(item => item.artifact.id)).toEqual(index.artifacts.map(item => item.id));
    coordinator.close();
  });

  it('passes a live same-owner auth getter through provider execution and uses the refreshed context for final revalidation', async () => {
    const index = indexOf(2);
    const refreshed = { ...auth, accessToken: 'owner-token-refreshed', client: { session: 'refreshed' } } as AuthenticatedRequest;
    const providerContexts: Array<{ auth: AuthenticatedRequest; currentAuth?: () => AuthenticatedRequest }> = [];
    const inspectionContexts: AuthenticatedRequest[] = [];
    const storeContexts: AuthenticatedRequest[] = [];
    let coordinator!: ProjectReadinessCoordinator;
    const { dependencySet, store } = dependencies(index, {
      provider: vi.fn((providerAuth, currentAuth) => {
        providerContexts.push({ auth: providerAuth, currentAuth });
        return { analyze: vi.fn() };
      }),
      assess: vi.fn(async input => {
        coordinator.adoptSession(refreshed);
        expect(providerContexts[0]?.currentAuth?.()).toBe(refreshed);
        return {
          id: 'snapshot-new', projectId: input.projectId, sourceFingerprint: input.sourceFingerprint,
          assessedAt: '2026-10-23T00:00:00.000Z', categories: [], findings: [],
        };
      }),
    });
    dependencySet.inspect = vi.fn(async currentAuth => { inspectionContexts.push(currentAuth); return index; });
    dependencySet.store = vi.fn(currentAuth => { storeContexts.push(currentAuth); return store; });
    coordinator = new ProjectReadinessCoordinator(dependencySet);

    await coordinator.request(auth, projectId, 'manual');
    await coordinator.waitForIdle();

    expect(dependencySet.provider).toHaveBeenCalledTimes(1);
    expect(providerContexts[0]).toMatchObject({ auth, currentAuth: expect.any(Function) });
    expect(inspectionContexts).toContain(refreshed);
    expect(storeContexts).toContain(refreshed);
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'completed', snapshot: expect.objectContaining({ id: 'snapshot-new' }),
    }));
    coordinator.close();
  });

  it('does not publish a frozen snapshot after source revalidation finds an active import', async () => {
    const index = indexOf(1);
    const changedIndex = { ...index, fingerprint: 'fingerprint-changed', importing: true };
    const previousSnapshot: ReadinessAssessment = {
      id: 'snapshot-previous', projectId, sourceFingerprint: 'fingerprint-previous',
      assessedAt: '2026-10-22T00:00:00.000Z', categories: [], findings: [],
    };
    let inspectCount = 0;
    const { dependencySet, store, getCurrent } = dependencies(index, {
      inspect: vi.fn(async () => ++inspectCount <= 2 ? index : changedIndex),
    });
    await dependencySet.store(auth).save({
      ...emptyReadiness(projectId), requestId: 'request-previous', status: 'completed',
      sourceFingerprint: previousSnapshot.sourceFingerprint, snapshot: previousSnapshot,
    });
    const coordinator = new ProjectReadinessCoordinator(dependencySet);

    await coordinator.request(auth, projectId, 'manual');
    await coordinator.waitForIdle();

    expect(dependencySet.assess).toHaveBeenCalledTimes(1);
    expect(getCurrent()).toMatchObject({
      status: 'queued', sourceFingerprint: 'fingerprint-changed', snapshot: previousSnapshot,
    });
    expect(store.save).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed', snapshot: expect.objectContaining({ id: 'snapshot-new' }),
    }));
    coordinator.close();
  });

  it('cancels in-flight reads at the shared deadline and retains the previous snapshot', async () => {
    const index = indexOf(9);
    const oldSnapshot: ReadinessAssessment = {
      id: 'snapshot-old', projectId, sourceFingerprint: 'fingerprint-old', assessedAt: '2026-10-22T00:00:00.000Z', categories: [], findings: [],
    };
    const { dependencySet, store, getCurrent } = dependencies(index, {
      jobTimeoutMs: 15,
      read: vi.fn((_auth, _source, signal) => new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      })),
    });
    const prior: ReadinessJob = {
      ...emptyReadiness(projectId), requestId: 'request-old', status: 'completed', trigger: 'manual',
      requestedAt: '2026-10-22T00:00:00.000Z', completedAt: '2026-10-22T00:00:00.000Z',
      sourceFingerprint: 'fingerprint-old', snapshot: oldSnapshot, stale: false,
    };
    await dependencySet.store(auth).save(prior);
    const coordinator = new ProjectReadinessCoordinator(dependencySet);
    await coordinator.request(auth, projectId, 'manual');
    await coordinator.waitForIdle();

    expect(dependencySet.read).toHaveBeenCalledTimes(4);
    expect(dependencySet.read.mock.calls.every(([, , signal]) => signal.aborted)).toBe(true);
    expect(dependencySet.assess).not.toHaveBeenCalled();
    expect(getCurrent()).toMatchObject({ status: 'failed', errorCode: 'timeout', stale: true, snapshot: oldSnapshot });
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed', snapshot: oldSnapshot }));
    coordinator.close();
  });

  it('allows sequential batch work to exceed three minutes within the default job budget', async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const { dependencySet, store } = dependencies(indexOf(1), {
      assess: vi.fn(async (input, _provider, signal) => {
        // Model five sequential provider batches at 40 seconds each. This was
        // enough to exceed the former 180-second whole-job deadline.
        for (let batch = 0; batch < 5; batch += 1) {
          await new Promise<void>(resolve => setTimeout(resolve, 40_000));
          expect(signal.aborted).toBe(false);
        }
        return {
          id: 'snapshot-new', projectId: input.projectId, sourceFingerprint: input.sourceFingerprint,
          assessedAt: '2026-10-23T00:00:00.000Z', categories: [], findings: [],
        };
      }),
    });
    const coordinator = new ProjectReadinessCoordinator(dependencySet);

    try {
      await coordinator.request(auth, projectId, 'manual');
      const idle = coordinator.waitForIdle();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(200_000);
      await idle;

      expect(Date.now() - startedAt).toBeGreaterThan(180_000);
      expect(dependencySet.assess).toHaveBeenCalledTimes(1);
      expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({
        status: 'completed', snapshot: expect.objectContaining({ id: 'snapshot-new' }),
      }));
    } finally {
      coordinator.close();
      vi.useRealTimers();
    }
  });

  it.each(['assessment', 'revalidation'])('does not publish a late snapshot when the deadline expires during %s', async stage => {
    vi.useFakeTimers();
    const index=indexOf(1);
    let assessed=false;
    const previous: ReadinessAssessment={id:'previous',projectId,sourceFingerprint:'old',assessedAt:'2026-10-22',categories:[],findings:[]};
    const {dependencySet,getCurrent}=dependencies(index,{
      jobTimeoutMs:20,
      inspect:vi.fn(async()=>{
        if(assessed&&stage==='revalidation') await new Promise(resolve=>setTimeout(resolve,30));
        return index;
      }),
      assess:vi.fn(async input=>{
        if(stage==='assessment') await new Promise(resolve=>setTimeout(resolve,30));
        assessed=true;
        return {id:'late',projectId,sourceFingerprint:input.sourceFingerprint,assessedAt:'2026-10-23',categories:[],findings:[]};
      }),
    });
    await dependencySet.store(auth).save({...emptyReadiness(projectId),requestId:'old',sourceFingerprint:'old',status:'completed',snapshot:previous});
    const coordinator=new ProjectReadinessCoordinator(dependencySet);
    try {
      await coordinator.request(auth,projectId,'manual');
      const idle=coordinator.waitForIdle();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(30);
      await idle;
      expect(getCurrent()).toMatchObject({status:'failed',errorCode:'timeout',snapshot:previous,stale:true});
    } finally {coordinator.close();vi.useRealTimers();}
  });
});
