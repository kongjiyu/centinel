import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../src/auth/gateway.js';
import type { Artifact } from '../../src/artifacts.js';
import { SourceIndexCoordinator, type SourceIndexHold, type SourceIndexJob, type SourceIndexJobStore } from '../../src/review/sourceIndexJobs.js';
import { repositoryIndexIdentity } from '../../src/review/repositoryIndexSnapshot.js';

const project = '33333333-3333-4333-8333-333333333333';
const owner = '11111111-1111-4111-8111-111111111111';
const auth = { userId: owner, accessToken: 'verified-one', client: {}, verifiedIssuedAt: 10 } as AuthenticatedRequest;
const artifact = { id: 'source', projectId: project, versionId: 'v1', contentHash: 'a'.repeat(64), filePath: 'pay.ts' } as Artifact;
const identity = (artifacts: Artifact[]) => repositoryIndexIdentity({ projectId: project,
  embedding: { provider: 'voyage', model: 'voyage-4-lite', dimensions: 1024, endpointHash: 'f'.repeat(64) },
  sources: artifacts.map(item => ({ artifactId: item.id, versionId: item.versionId!, filePath: item.filePath, contentHash: item.contentHash })) });
class MemoryStore implements SourceIndexJobStore {
  rows = new Map<string, SourceIndexJob>();
  holds = new Map<string, SourceIndexHold>();
  async hold(projectId: string, ownerId: string) { return structuredClone(this.holds.get(`${projectId}:${ownerId}`) ?? null); }
  async compareHold(projectId: string, ownerId: string, previous: SourceIndexHold | null, next: SourceIndexHold) {
    const key = `${projectId}:${ownerId}`;
    if ((this.holds.get(key)?.revision ?? null) !== (previous?.revision ?? null)) return false;
    this.holds.set(key, structuredClone(next)); return true;
  }
  async get(id: string) { return structuredClone(this.rows.get(id) ?? null); }
  async latest(projectId: string, ownerId: string) {
    return structuredClone([...this.rows.values()].filter(row => row.projectId === projectId && row.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null);
  }
  async paused(projectId: string, ownerId: string) {
    return structuredClone([...this.rows.values()].filter(row => row.projectId === projectId && row.ownerId === ownerId && row.state === 'paused'));
  }
  async insert(job: SourceIndexJob) { if (this.rows.has(job.id)) return false; this.rows.set(job.id, structuredClone(job)); return true; }
  async compareAndSet(previous: SourceIndexJob, next: SourceIndexJob) {
    if (this.rows.get(previous.id)?.revision !== previous.revision) return false;
    this.rows.set(next.id, structuredClone(next)); return true;
  }
}
const coordinators: SourceIndexCoordinator[] = [];
afterEach(() => { coordinators.splice(0).forEach(item => item.close()); vi.unstubAllEnvs(); });
function setup(store = new MemoryStore()) {
  let artifacts = [artifact]; let now = 1_800_000_000_000;
  const build = vi.fn(async (_auth: () => AuthenticatedRequest, _project: string, _artifacts: Artifact[], _signal: AbortSignal, guard: () => Promise<void>) => { await guard(); });
  const deps = { store: () => store, artifacts: vi.fn(async () => artifacts), describe: vi.fn(async (_auth: AuthenticatedRequest, _project: string, rows: Artifact[]) => identity(rows)),
    build, now: () => now, pollMs: 1 };
  const coordinator = new SourceIndexCoordinator(deps); coordinators.push(coordinator);
  return { store, build, deps, coordinator, update: () => { artifacts = [{ ...artifact, versionId: 'v2', contentHash: 'b'.repeat(64) }]; now += 1_000; }, advance: (ms: number) => { now += ms; } };
}
async function flush(coordinator: SourceIndexCoordinator) { await new Promise(resolve => setImmediate(resolve)); await coordinator.waitForIdle(); }

describe('source-event indexing lifecycle', () => {
  it('never treats an old cleared hold as permission after a new pause fails hold persistence', async () => {
    const s = setup();
    s.store.holds.set(`${project}:${owner}`, { revision: 1, code: null });
    vi.spyOn(s.store, 'compareHold').mockResolvedValue(false);
    s.build.mockRejectedValueOnce(Object.assign(new Error('held'), { code: 'quota_exhausted' }));
    await expect(s.coordinator.ensure(auth, project, [artifact], undefined, 'review')).rejects.toThrow('hold_persistence_failed');
    expect([...s.store.rows.values()][0]?.state).toBe('paused');
    await expect(s.coordinator.ensure(auth, project, [artifact], undefined, 'review')).rejects.toThrow('quota_exhausted');
    expect(s.build).toHaveBeenCalledOnce();
  });
  it('does not clear an owner hold if its paused-job snapshot cannot be read', async () => {
    const s = setup();
    s.store.holds.set(`${project}:${owner}`, { revision: 1, code: 'quota_exhausted' });
    vi.spyOn(s.store, 'paused').mockRejectedValueOnce(new Error('snapshot unavailable'));
    await expect(s.coordinator.resume(auth, project)).rejects.toThrow('snapshot unavailable');
    expect(s.store.holds.get(`${project}:${owner}`)).toEqual({ revision: 1, code: 'quota_exhausted' });
    expect(s.build).not.toHaveBeenCalled();
  });
  it('explicit resume cannot change a captured job whose revision became a live lease', async () => {
    const s = setup();
    s.build.mockRejectedValueOnce(Object.assign(new Error('held'), { code: 'quota_exhausted' }));
    const saved = await s.coordinator.notify(auth, project); await flush(s.coordinator);
    s.update();
    const original = s.store.paused.bind(s.store);
    vi.spyOn(s.store, 'paused').mockImplementationOnce(async (...args) => {
      const rows = await original(...args);
      const prior = s.store.rows.get(saved.id)!;
      s.store.rows.set(saved.id, { ...prior, revision: prior.revision + 1, state: 'running', leaseToken: 'other-device', leaseUntil: Date.now() + 100_000 });
      return rows;
    });
    await s.coordinator.resume(auth, project); await flush(s.coordinator);
    expect(s.store.rows.get(saved.id)).toMatchObject({ state: 'running', leaseToken: 'other-device' });
  });
  it('explicit owner resume also releases a paused saved-source Review identity', async () => {
    const s = setup();
    s.build.mockRejectedValueOnce(Object.assign(new Error('held'), { code: 'quota_exhausted' }));
    const saved = await s.coordinator.notify(auth, project); await flush(s.coordinator);
    expect(s.store.rows.get(saved.id)?.state).toBe('paused');
    s.update();
    await s.coordinator.notify(auth, project);
    await s.coordinator.resume(auth, project); await flush(s.coordinator);
    expect(s.store.holds.get(`${project}:${owner}`)?.code).toBeNull();
    // The Review still selects the earlier exact frozen sources, not today's
    // full project identity resumed by the Source page.
    await s.coordinator.ensure(auth, project, [artifact], undefined, 'saved-review');
    expect(s.store.rows.get(saved.id)?.state).toBe('ready');
    expect(s.build).toHaveBeenCalledTimes(3);
  });
  it('durably queues a source event, builds without a Review, and reuses an unchanged event', async () => {
    const s = setup(); const job = await s.coordinator.notify(auth, project);
    expect(s.store.rows.get(job.id)?.state).toBe('queued'); expect(s.build).not.toHaveBeenCalled();
    await flush(s.coordinator);
    expect(s.store.rows.get(job.id)?.state).toBe('ready'); expect(s.build).toHaveBeenCalledOnce();
    await s.coordinator.notify(auth, project); await flush(s.coordinator);
    expect(s.build).toHaveBeenCalledOnce();
    s.update(); const updated = await s.coordinator.notify(auth, project); await flush(s.coordinator);
    expect(updated.fingerprint).not.toBe(job.fingerprint); expect(s.build).toHaveBeenCalledTimes(2);
  });
  it('supersedes an older source build before its publication guard', async () => {
    const s = setup(); let published = false;
    s.build.mockImplementation(async (_auth, _project, _artifacts, _signal, guard) => { s.update(); await guard(); published = true; });
    const job = await s.coordinator.notify(auth, project); await flush(s.coordinator);
    expect(published).toBe(false); expect(s.store.rows.get(job.id)?.state).toBe('superseded');
  });
  it('persists capacity stops through source changes and GET recovery until explicit resume', async () => {
    const s = setup(); s.build.mockRejectedValueOnce(Object.assign(new Error('private provider message'), { code: 'quota_exhausted' }));
    const job = await s.coordinator.notify(auth, project); await flush(s.coordinator);
    expect(s.store.rows.get(job.id)).toMatchObject({ state: 'paused', errorCode: 'quota_exhausted' });
    s.update(); const changed = await s.coordinator.notify(auth, project);
    await s.coordinator.recover(auth, project); await flush(s.coordinator);
    expect(changed.state).toBe('paused'); expect(s.build).toHaveBeenCalledOnce();
    await expect(s.coordinator.ensure(auth, project, [{ ...artifact, versionId: 'v2', contentHash: 'b'.repeat(64) }], undefined, 'review'))
      .rejects.toMatchObject({ code: 'quota_exhausted' });
    await s.coordinator.resume(auth, project); await flush(s.coordinator);
    expect(s.build).toHaveBeenCalledTimes(2); expect(s.store.rows.get(changed.id)?.state).toBe('ready');
    expect(JSON.stringify([...s.store.rows.values()])).not.toContain('private provider message');
  });
  it('GET without a recorded event checks metadata but never creates embedding work', async () => {
    const s = setup(); expect(await s.coordinator.recover(auth, project)).toBeNull(); await flush(s.coordinator);
    expect(s.deps.artifacts).toHaveBeenCalledOnce(); expect(s.build).not.toHaveBeenCalled();
  });
  it('recovers a queued job after restart using the same owner session', async () => {
    const s = setup(); const job = await s.coordinator.notify(auth, project); s.coordinator.close();
    const restarted = setup(s.store); await restarted.coordinator.recover(auth, project); await flush(restarted.coordinator);
    expect(restarted.build).toHaveBeenCalledOnce(); expect(s.store.rows.get(job.id)?.state).toBe('ready');
  });
  it('holds before any build when the configured project scope is excluded', async () => {
    vi.stubEnv('CENTINEL_AI_ASSESSMENT_PROJECT_ALLOWLIST', 'another-project'); const s = setup();
    const job = await s.coordinator.notify(auth, project); await flush(s.coordinator);
    expect(s.build).not.toHaveBeenCalled(); expect(s.store.rows.get(job.id)).toMatchObject({ state: 'paused', errorCode: 'assessment_paused' });
  });
  it('one process wins a cross-device CAS claim and a live lease blocks duplicate work', async () => {
    const first = setup(); const second = setup(first.store); let release!: () => void;
    first.build.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); });
    const job = await first.coordinator.notify(auth, project);
    await new Promise(resolve => setImmediate(resolve));
    await second.coordinator.recover(auth, project); await new Promise(resolve => setImmediate(resolve));
    expect(first.store.rows.get(job.id)?.state).toBe('running'); expect(second.build).not.toHaveBeenCalled();
    release(); await flush(first.coordinator); await flush(second.coordinator);
    expect(first.build).toHaveBeenCalledOnce();
  });
  it.each([false, true])('Review waits for another device and restores after ready (different member %s)', async differentMember => {
    const first = setup(); const second = setup(first.store); let release!: () => void;
    first.build.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); });
    const job = await first.coordinator.notify(auth, project); await new Promise(resolve => setImmediate(resolve));
    const requester = differentMember ? { ...auth, userId: '22222222-2222-4222-8222-222222222222' } : auth;
    const wait = second.coordinator.ensure(requester, project, [artifact], undefined, 'review');
    await new Promise(resolve => setTimeout(resolve, 5)); expect(second.build).not.toHaveBeenCalled();
    release(); await wait; await flush(first.coordinator);
    expect(first.store.rows.get(job.id)?.state).toBe('ready'); expect(second.build).toHaveBeenCalledOnce();
  });
  it('cancels cross-device waiting without replacing the active lease', async () => {
    const first = setup(); const second = setup(first.store); let release!: () => void;
    first.build.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); });
    const job = await first.coordinator.notify(auth, project); await new Promise(resolve => setImmediate(resolve));
    const before = await first.store.get(job.id); const controller = new AbortController();
    const wait = second.coordinator.ensure(auth, project, [artifact], controller.signal, 'review');
    await new Promise(resolve => setImmediate(resolve)); controller.abort(); await expect(wait).rejects.toBeDefined();
    expect(await first.store.get(job.id)).toEqual(before); release(); await flush(first.coordinator);
  });
  it('a historical ready identity cannot bypass a newer project capacity pause', async () => {
    const s = setup(); const original = await s.coordinator.notify(auth, project); await flush(s.coordinator);
    s.update(); s.build.mockRejectedValueOnce(Object.assign(new Error('quota'), { code: 'quota_exhausted' }));
    await s.coordinator.notify(auth, project); await flush(s.coordinator);
    await expect(s.coordinator.ensure(auth, project, [artifact], undefined, 'historical-review')).rejects.toMatchObject({ code: 'quota_exhausted' });
    expect(s.build).toHaveBeenCalledTimes(2); expect(s.store.rows.get(original.id)?.state).toBe('paused');
  });
  it('one member capacity hold never pauses or clears another member live lease', async () => {
    const a = setup(); const b = setup(a.store); const memberB = { ...auth, userId: '22222222-2222-4222-8222-222222222222' };
    a.store.holds.set(`${project}:${owner}`, { revision: 0, code: 'quota_exhausted' });
    let release!: () => void;
    b.build.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); });
    const job = await b.coordinator.notify(memberB, project); await new Promise(resolve => setImmediate(resolve));
    const before = await a.store.get(job.id);
    await expect(a.coordinator.notify(auth, project)).rejects.toMatchObject({ code: 'quota_exhausted' });
    await expect(a.coordinator.ensure(auth, project, [artifact], undefined, 'review')).rejects.toMatchObject({ code: 'quota_exhausted' });
    expect(await a.store.get(job.id)).toEqual(before); release(); await flush(b.coordinator);
    expect(a.store.rows.get(job.id)?.state).toBe('ready');
  });
  it('a paused owner remains paused when another member explicitly completes the shared job', async () => {
    const a = setup(); const b = setup(a.store); const memberB = { ...auth, userId: '22222222-2222-4222-8222-222222222222' };
    a.build.mockRejectedValueOnce(Object.assign(new Error('quota'), { code: 'quota_exhausted' }));
    const job = await a.coordinator.notify(auth, project); await flush(a.coordinator);
    await b.coordinator.resume(memberB, project); await flush(b.coordinator);
    expect(a.store.rows.get(job.id)).toMatchObject({ ownerId: memberB.userId, state: 'ready' });
    expect(a.store.holds.get(`${project}:${owner}`)?.code).toBe('quota_exhausted');
    expect(await a.coordinator.recover(auth, project)).toMatchObject({ state: 'paused', errorCode: 'quota_exhausted' });
    await expect(a.coordinator.ensure(auth, project, [artifact], undefined, 'review')).rejects.toMatchObject({ code: 'quota_exhausted' });
    expect(a.build).toHaveBeenCalledOnce();
    await a.coordinator.resume(auth, project); await flush(a.coordinator);
    expect(a.store.holds.get(`${project}:${owner}`)?.code).toBeNull();
  });
  it('Review joins the source build and cancelling its wait does not cancel that build', async () => {
    const s = setup(); let release!: () => void; let buildSignal: AbortSignal | undefined;
    s.build.mockImplementation(async (_auth, _project, _artifacts, signal) => { buildSignal = signal; await new Promise<void>(resolve => { release = resolve; }); });
    const job = await s.coordinator.notify(auth, project); await new Promise(resolve => setImmediate(resolve));
    const controller = new AbortController(); const wait = s.coordinator.ensure(auth, project, [artifact], controller.signal, 'review');
    await new Promise(resolve => setImmediate(resolve)); controller.abort(); await expect(wait).rejects.toBeDefined();
    expect(buildSignal?.aborted).toBe(false); release(); await flush(s.coordinator);
    expect(s.store.rows.get(job.id)?.state).toBe('ready'); expect(s.build).toHaveBeenCalledOnce();
  });
  it('rejects a lost lease before paid work and never overwrites the new claim', async () => {
    const s = setup(); s.build.mockImplementation(async (_auth, _project, _artifacts, _signal, guard) => {
      const row = [...s.store.rows.values()][0]!;
      s.store.rows.set(row.id, { ...row, leaseToken: 'another-device', revision: row.revision + 1 });
      await guard();
    });
    const job = await s.coordinator.notify(auth, project); await flush(s.coordinator);
    expect(s.store.rows.get(job.id)?.leaseToken).toBe('another-device');
  });
  it('adopts newer authenticated credentials and ignores older concurrent sessions', async () => {
    const s = setup(); const newer = { ...auth, accessToken: 'verified-new', verifiedIssuedAt: 20, client: { newer: true } } as unknown as AuthenticatedRequest;
    s.coordinator.adoptSession(auth); s.coordinator.adoptSession(newer); s.coordinator.adoptSession(auth);
    await s.coordinator.notify(auth, project); await flush(s.coordinator);
    expect(s.deps.artifacts.mock.calls[0]?.[0].accessToken).toBe('verified-new');
  });
});
