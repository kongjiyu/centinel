import { beforeEach, expect, it, vi } from 'vitest';
import { createAutoTestDeps } from '../../src/dynamic/autonomous/runtimeDeps.js';
const { analyze } = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock('../../src/review/modelProvider.js', () => ({
  ConfiguredTextModelProvider: class {
    analyze = analyze;
    async getSettings() { return { provider: 'codex', model: 'configured-model' }; }
  },
}));
beforeEach(() => vi.resetAllMocks());
async function generate(recordUsage: ReturnType<typeof vi.fn>) {
  const deps = await createAutoTestDeps({
    projectId: 'project', ownerId: 'owner', session: {} as never, store: {} as never, environments: {} as never,
    service: {} as never, dynamicRouteDeps: {} as never, home: '/fixture',
    modelChain: async () => ({ primary: { provider: 'codex' } as never }), recordUsage,
  });
  return deps.generate({ systemPrompt: 'Plan tests', prompt: 'Use the fixture', outputSchema: {}, signal: new AbortController().signal });
}
it('persists a reservation before a paid model request and updates the same usage ID', async () => {
  const usage = vi.fn().mockResolvedValue(undefined);
  analyze.mockResolvedValue({ result: { tests: [] }, settings: { provider: 'codex', model: 'configured-model' }, usage: { inputTokens: 50, outputTokens: 10 } });
  await generate(usage);
  expect(usage.mock.calls.map(([row]) => row.outcome)).toEqual(['in_progress', 'success']);
  expect(usage.mock.calls[0][0].id).toBe(usage.mock.calls[1][0].id);
  expect(usage.mock.invocationCallOrder[0]).toBeLessThan(analyze.mock.invocationCallOrder[0]);
  expect(usage.mock.calls[1][0]).toMatchObject({ inputTokens: 50, outputTokens: 10 });
});
it('makes no provider call when the reservation fails', async () => {
  await expect(generate(vi.fn().mockRejectedValue(new Error('ledger unavailable')))).rejects.toThrow('ledger unavailable');
  expect(analyze).not.toHaveBeenCalled();
});
it('does not repeat or relabel a successful provider response when final accounting fails', async () => {
  const usage = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('ledger unavailable'));
  analyze.mockResolvedValue({ result: { tests: [] }, settings: { provider: 'codex', model: 'configured-model' } });
  await expect(generate(usage)).rejects.toThrow('ledger unavailable');
  expect(analyze).toHaveBeenCalledOnce();
  expect(usage.mock.calls.map(([row]) => row.outcome)).toEqual(['in_progress', 'success']);
});
