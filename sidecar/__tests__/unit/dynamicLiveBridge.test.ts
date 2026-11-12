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
const input = { name: 'Live', goal: 'Read page', targetUrl: 'http://localhost:3000', maxSteps: 3,
  context: null, checks: [{ id: 'one', criterionId: 'one', description: 'Heading', kind: 'visible_text' as const, expected: 'Sign in', required: true }] };
async function queued() {
  mocks.execute.mockReset().mockResolvedValue(undefined);
  const service = new DynamicService(new InMemoryDynamicRepository(), 'worker');
  const revision = await service.saveMission('project', 'actor', input);
  const { run } = await service.start('project', 'actor', revision.id, 'key');
  return { service, run };
}
afterEach(() => vi.useRealTimers());
describe('Mission bridge live option', () => {
  it('omits live and keeps dom_first observation when not requested', async () => {
    const { service, run } = await queued();
    await executeMissionRun(service, run, '/tmp/not-used', { vision: {} as any });
    const options = mocks.execute.mock.calls[0][2];
    expect(options).not.toHaveProperty('live');
    expect(options.vision).not.toHaveProperty('codexSlot');
    expect(options.observationMode).toBe('dom_first');
  });
  it('forwards the live option unchanged to the browser runner', async () => {
    const { service, run } = await queued();
    const live = { laneId: 'lane-2', headless: true as const, perStepScreenshots: true as const, sink: { frame: vi.fn(), action: vi.fn() } };
    await executeMissionRun(service, run, '/tmp/not-used', { vision: {} as any, live });
    const options = mocks.execute.mock.calls[0][2];
    expect(options.live).toBe(live);
    expect(options.observationMode).toBe('dom_first');
    expect(options.vision.codexSlot).toBe('lane-2');
  });
});
