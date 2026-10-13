import { describe, expect, it } from 'vitest';
import { InMemoryDynamicRepository } from '../../src/dynamic/inMemoryRepository.js';
import { DynamicService } from '../../src/dynamic/service.js';

const input = { name: 'Recovery', goal: 'Check page', targetUrl: 'http://localhost:3000', maxSteps: 3, context: null, contextAcknowledged: false, checks: [{ id: 'one', criterionId: 'one', description: 'URL', kind: 'url' as const, expected: 'http://localhost:3000/', required: true }] };
async function fixture() {
  let time = Date.parse('2026-10-13T00:00:00Z');
  const repository = new InMemoryDynamicRepository(() => time);
  const worker = new DynamicService(repository, 'worker-a'); const restarted = new DynamicService(repository, 'worker-b');
  const revision = await worker.saveMission('project', 'actor', input);
  const { run } = await worker.start('project', 'actor', revision.id, 'one');
  return { repository, worker, restarted, run, advance(ms: number) { time += ms; } };
}

describe('Dynamic worker restart recovery', () => {
  it('preserves a healthy worker on another process and exposes no fencing token', async () => {
    const { worker, restarted, run, advance } = await fixture();
    await worker.claim('project', run.id, 'local-session');
    advance(40_000); expect(await worker.heartbeat('project', run.id)).toBe(true);
    advance(40_000); expect(await restarted.recover('project')).toEqual([]);
    expect((await restarted.requireRun('project', run.id)).state).toBe('running');
    expect(JSON.stringify(await restarted.requireRun('project', run.id))).not.toContain('leaseToken');
  });
  it('reconciles expired running work to interruption and rejects old completion', async () => {
    const { worker, restarted, run, advance } = await fixture();
    await worker.claim('project', run.id, 'local-session'); advance(60_001);
    const recovered = await restarted.recover('project');
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ state: 'interrupted', verdict: 'not_tested', legacySessionId: 'local-session' });
    expect(await worker.heartbeat('project', run.id)).toBe(false);
    await expect(worker.finish('project', run.id, [], [])).rejects.toThrow('running');
    expect(await restarted.recover('project')).toEqual([]);
  });
  it('cannot finalize with an expired lease even before recovery is invoked', async () => {
    const { worker, run, advance } = await fixture();
    await worker.claim('project', run.id); advance(60_001);
    await expect(worker.finish('project', run.id, [], [])).rejects.toThrow('stopped');
    expect(await worker.heartbeat('project', run.id)).toBe(false);
  });
  it('recovers abandoned queued starts but does not execute them again', async () => {
    const { worker, restarted, run, advance } = await fixture();
    advance(89_000); expect(await restarted.recover('project')).toEqual([]);
    advance(2_000); await expect(worker.claim('project', run.id)).rejects.toThrow('claimed or stopped');
    expect((await restarted.recover('project'))[0].state).toBe('interrupted');
    const replay = await restarted.start('project', 'actor', run.revision.id, 'one');
    expect(replay.reused).toBe(true); expect(replay.run.state).toBe('interrupted');
    expect((await restarted.start('project', 'actor', run.revision.id, 'new-key')).reused).toBe(false);
  });
  it('allows cancellation to fence a worker and never changes completed history', async () => {
    const { worker, restarted, run, advance } = await fixture();
    await worker.claim('project', run.id);
    await restarted.stop('project', run.id, 'cancelled', 'Stopped by member');
    expect(await worker.heartbeat('project', run.id)).toBe(false);
    advance(100_000); expect(await restarted.recover('project')).toEqual([]);
    expect((await restarted.requireRun('project', run.id)).state).toBe('cancelled');
  });
  it('cannot borrow another process lease or recover another project', async () => {
    const { worker, restarted, run, repository, advance } = await fixture();
    await worker.claim('project', run.id);
    expect(await restarted.heartbeat('project', run.id)).toBe(false);
    expect(await repository.heartbeatRun('project', run.id, 'worker-b', 'fake-token')).toBe(false);
    advance(100_000); expect(await restarted.recover('other-project')).toEqual([]);
    expect((await worker.requireRun('project', run.id)).state).toBe('running');
  });
});
