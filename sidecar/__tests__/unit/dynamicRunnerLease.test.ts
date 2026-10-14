import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), cancel: vi.fn() }));
vi.mock('../../src/dynamicRunner.js', () => ({ runDynamicSession: mocks.execute, cancelSession: mocks.cancel }));
vi.mock('../../src/dynamicSessions.js', () => ({
  createDynamicSession: vi.fn(async () => ({ id: 'private-session', maxSteps: 3 })),
  getDynamicSession: vi.fn(async () => ({ status: 'cancelled' })),
  updateDynamicSessionStatus: vi.fn(async () => {}), addEvidence: vi.fn(async () => {}),
}));
import { executeMissionRun } from '../../src/dynamic/runnerBridge.js';
import { DynamicService } from '../../src/dynamic/service.js';
import { InMemoryDynamicRepository } from '../../src/dynamic/inMemoryRepository.js';
const input = { name: 'Lease', goal: 'Read page', targetUrl: 'http://localhost:3000', maxSteps: 3,
  context: null, checks: [{ id: 'one', criterionId: 'one', description: 'Heading', kind: 'visible_text' as const, expected: 'Sign in', required: true }] };
async function fixture() {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] });
  mocks.cancel.mockReset(); mocks.execute.mockReset();
  const service = new DynamicService(new InMemoryDynamicRepository(), 'worker');
  const revision = await service.saveMission('project', 'actor', input);
  const { run } = await service.start('project', 'actor', revision.id, 'key');
  let release!: () => void;
  mocks.execute.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  return { service, run, release: () => release() };
}
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
afterEach(() => vi.useRealTimers());
describe('Mission worker watchdog integration', () => {
  it('expires a pending heartbeat and blocks existing proxy forwarding without waiting for its reply', async () => {
    const { service, run, release } = await fixture();
    let reply!: (alive: boolean) => void;
    vi.spyOn(service, 'heartbeat').mockImplementation(() => new Promise(resolve => { reply = resolve; }));
    const execution = executeMissionRun(service, run, '/tmp/not-used', { vision: {} as any });
    await settle(); const options = mocks.execute.mock.calls[0][2];
    expect(options.canForward()).toBe(true);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(mocks.cancel).toHaveBeenCalledWith('private-session'); expect(options.canForward()).toBe(false);
    reply(true); await settle(); expect(options.canForward()).toBe(false);
    release(); await execution;
    expect(await service.requireRun('project', run.id)).toMatchObject({ state: 'blocked', verdict: 'not_tested', reason: expect.stringContaining('confirmation expired') });
  });
  it('keeps healthy workers alive but stops them at an independent absolute runtime deadline', async () => {
    const { service, run, release } = await fixture();
    vi.spyOn(service, 'heartbeat').mockResolvedValue(true);
    const execution = executeMissionRun(service, run, '/tmp/not-used', { vision: {} as any, runtimeMs: 70_000 });
    await settle(); const options = mocks.execute.mock.calls[0][2];
    await vi.advanceTimersByTimeAsync(69_000); expect(options.canForward()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000); expect(options.canForward()).toBe(false);
    release(); await execution;
    expect((await service.requireRun('project', run.id)).reason).toContain('deadline');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never launches the browser after a claim acknowledgment arrives past local freshness', async () => {
    const { service, run } = await fixture(); const claim = service.claim.bind(service);
    let acknowledge!: () => void;
    vi.spyOn(service, 'claim').mockImplementation(async (...args) => { const result = await claim(...args); await new Promise<void>(resolve => { acknowledge = resolve; }); return result; });
    const execution = executeMissionRun(service, run, '/tmp/not-used', { vision: {} as any });
    await settle(); await vi.advanceTimersByTimeAsync(45_000); acknowledge(); await execution;
    expect(mocks.execute).not.toHaveBeenCalled(); expect((await service.requireRun('project', run.id)).state).toBe('blocked');
  });
  it('includes claim latency in the absolute deadline instead of granting a fresh runtime after acknowledgment', async () => {
    const { service, run, release } = await fixture(); const claim = service.claim.bind(service);let claimStarted=0;
    vi.spyOn(service, 'claim').mockImplementation(async (...args) => { claimStarted=performance.now();const result = await claim(...args); await vi.advanceTimersByTimeAsync(600); return result; });
    const execution = executeMissionRun(service, run, '/tmp/not-used', { vision: {} as any, runtimeMs: 2000 });
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalled());
    const options = mocks.execute.mock.calls[0][2]; expect(options.runtimeMs).toBeLessThanOrEqual(1400);
    const remaining=claimStarted+2000-performance.now();
    await vi.advanceTimersByTimeAsync(remaining-1); expect(options.canForward()).toBe(true);
    await vi.advanceTimersByTimeAsync(1); expect(options.canForward()).toBe(false);
    release(); await execution; expect(vi.getTimerCount()).toBe(0);
  });
});
