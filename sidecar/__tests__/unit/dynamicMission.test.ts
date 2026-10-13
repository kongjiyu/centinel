import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { InMemoryDynamicRepository } from '../../src/dynamic/inMemoryRepository.js';
import { DynamicService, validateMission } from '../../src/dynamic/service.js';
import { aggregateChecks, checkPage } from '../../src/dynamic/checker.js';
import { createStaticContextFixture } from '../../src/dynamic/testing/staticContextStub.js';
import { handleDynamicRoute } from '../../src/dynamic/routes.js';
import type { MissionInput } from '../../src/dynamic/types.js';

const input = (): MissionInput => ({ name: 'Login', goal: 'Open signed-in home', targetUrl: 'http://localhost:3000', maxSteps: 15, context: createStaticContextFixture('project-a'), contextAcknowledged: false,
  checks: [{ id: 'home', criterionId: 'MOCK-RWA-AUTH-01-C1', description: 'Signed-in home URL', kind: 'url', expected: 'http://localhost:3000/', required: true }] });
const evidence = [{ id: 'screenshot', kind: 'screenshot' as const, sha256: 'a'.repeat(64), availability: 'local' as const, capturedAt: '2026-10-13T00:00:00Z' }];
const results = (verdict: 'passed' | 'failed' = 'passed') => [{ checkId: 'home', criterionId: 'MOCK-RWA-AUTH-01-C1', verdict, observed: 'http://localhost:3000/', reason: 'Compared actual URL', evidenceIds: ['screenshot'], checkedAt: '2026-10-13T00:00:00Z' }];
const setup = async () => {
  const repository = new InMemoryDynamicRepository(); const service = new DynamicService(repository);
  const revision = await service.saveMission('project-a', 'actor-a', input());
  return { repository, service, revision };
};

describe('Mission revisions and Run lifecycle', () => {
  it('pins old mission inputs across edits and keeps reruns independent', async () => {
    const { repository, service, revision } = await setup();
    const first = await service.start('project-a', 'actor-a', revision.id, 'request-1');
    await service.claim('project-a', first.run.id);
    await service.finish('project-a', first.run.id, results(), evidence);
    const second = await service.start('project-a', 'actor-a', revision.id, 'request-2');
    await service.claim('project-a', second.run.id);
    await service.finish('project-a', second.run.id, results('failed'), evidence);
    const changed = await service.saveMission('project-a', 'actor-a', { ...input(), goal: 'Changed goal' }, revision.missionId);
    expect(changed.revision).toBe(2);
    const runs = await repository.listRuns('project-a', revision.missionId);
    expect(runs.map(run => run.verdict)).toEqual(['passed', 'failed']);
    expect(runs.every(run => run.revision.id === revision.id && run.revision.goal === input().goal)).toBe(true);
    revision.goal = 'Mutated returned object';
    expect((await repository.getRevision('project-a', first.run.revision.id))!.goal).toBe(input().goal);
  });
  it('deduplicates concurrent identical starts and rejects conflicting active runs', async () => {
    const { service, revision } = await setup();
    const parallel = await Promise.all([service.start('project-a', 'actor-a', revision.id, 'same'), service.start('project-a', 'actor-a', revision.id, 'same')]);
    expect(parallel[0].run.id).toBe(parallel[1].run.id);
    expect(parallel.map(result => result.reused)).toEqual([false, true]);
    await expect(service.start('project-a', 'actor-a', revision.id, 'other')).rejects.toThrow('active');
    await expect(service.start('project-a', 'actor-b', revision.id, 'same')).rejects.toThrow('different request');
  });
  it('prevents reuse of an idempotency key for a different revision', async () => {
    const { service, revision } = await setup();
    const first = await service.start('project-a', 'actor-a', revision.id, 'same');
    await service.stop('project-a', first.run.id, 'cancelled', 'Stopped');
    const next = await service.saveMission('project-a', 'actor-a', input(), revision.missionId);
    await expect(service.start('project-a', 'actor-a', next.id, 'same')).rejects.toThrow('different request');
  });
  it('never overwrites cancelled or completed results with a late completion', async () => {
    const { service, revision } = await setup();
    const { run } = await service.start('project-a', 'actor-a', revision.id, 'one');
    await service.claim('project-a', run.id);
    await service.stop('project-a', run.id, 'cancelled', 'Stopped');
    await expect(service.finish('project-a', run.id, results(), evidence)).rejects.toThrow('running');
    expect((await service.requireRun('project-a', run.id)).verdict).toBe('not_tested');
  });
  it('does not pass missing checks or unsupported evidence', async () => {
    const { service, revision } = await setup();
    const { run } = await service.start('project-a', 'actor-a', revision.id, 'one');
    await service.claim('project-a', run.id);
    expect((await service.finish('project-a', run.id, [], [])).verdict).toBe('uncertain');
    const next = await service.start('project-a', 'actor-a', revision.id, 'two');
    await service.claim('project-a', next.run.id);
    const missingEvidence = results().map(result => ({ ...result, evidenceIds: [] }));
    expect((await service.finish('project-a', next.run.id, missingEvidence, [])).verdict).toBe('uncertain');
  });
  it('rejects forged result IDs and dangling evidence', async () => {
    const { service, revision } = await setup();
    const { run } = await service.start('project-a', 'actor-a', revision.id, 'one');
    await service.claim('project-a', run.id);
    await expect(service.finish('project-a', run.id, [{ ...results()[0], checkId: 'other' }], evidence)).rejects.toThrow('Unknown');
    await expect(service.finish('project-a', run.id, results(), [])).rejects.toThrow('Dangling');
  });
  it('does not expose records across projects and blocked execution has no defect verdict', async () => {
    const { service, revision } = await setup();
    await expect(service.start('project-b', 'actor-a', revision.id, 'one')).rejects.toThrow('not found');
    const { run } = await service.start('project-a', 'actor-a', revision.id, 'one');
    const blocked = await service.stop('project-a', run.id, 'blocked', 'Provider unavailable');
    expect(blocked).toMatchObject({ state: 'blocked', verdict: 'not_tested', checks: [] });
    await expect(service.requireRun('project-b', run.id)).rejects.toThrow('not found');
  });
});

describe('Mission validation', () => {
  it.each([0, 26, NaN, 1.5])('rejects invalid step budget %s', maxSteps => {
    expect(() => validateMission({ ...input(), maxSteps }, 'project-a')).toThrow('maxSteps');
  });
  it('rejects empty checks, duplicate IDs, unsafe targets and cross-origin expectations', () => {
    for (const mission of [{ ...input(), checks: [] }, { ...input(), checks: [...input().checks, ...input().checks] }, { ...input(), targetUrl: 'file:///tmp/a' }, { ...input(), targetUrl: 'http://user:password@localhost:3000' }, { ...input(), checks: [{ ...input().checks[0], expected: 'http://other.test/' }] }]) expect(() => validateMission(mission, 'project-a')).toThrow();
  });
  it('rejects cross-project context and dangling requirement/source references', () => {
    expect(() => validateMission(input(), 'project-b')).toThrow('cross-project');
    const dangling = input(); dangling.context!.requirements[0].sourceId = 'absent';
    expect(() => validateMission(dangling, 'project-a')).toThrow('dangling');
    const missing = input(); missing.checks[0].criterionId = 'absent';
    expect(() => validateMission(missing, 'project-a')).toThrow('absent');
  });
  it.each(['stale', 'conflicting', 'unapproved'] as const)('requires acknowledgement for %s context', scenario => {
    const mission = { ...input(), context: createStaticContextFixture('project-a', scenario) };
    expect(() => validateMission(mission, 'project-a')).toThrow('Acknowledge');
    expect(validateMission({ ...mission, contextAcknowledged: true }, 'project-a').context?.provenance).toBe('mock-static');
  });
});

describe('Independent page checker', () => {
  it('ignores model declarations and verifies actual URL/text/visibility', async () => {
    const page = { isClosed: () => false, url: () => 'http://localhost:3000/signin', locator: (selector: string) => selector === 'body'
      ? { innerText: async () => 'Sign in' } : { count: async () => 1, isVisible: async () => true } } as unknown as Page;
    const checks = [...input().checks,
      { id: 'text', criterionId: 'text', description: 'Login text', required: true, kind: 'visible_text' as const, expected: 'Sign in' },
      { id: 'element', criterionId: 'element', description: 'Login form', required: true, kind: 'element_visible' as const, selector: 'form' }];
    const checked = await checkPage(page, checks, ['screenshot']);
    expect(checked.map(check => check.verdict)).toEqual(['failed', 'passed', 'passed']);
    expect(aggregateChecks(checks, checked)).toBe('failed');
  });
  it('marks closed, ambiguous and cancelled observations uncertain', async () => {
    const page = { isClosed: () => false, locator: () => ({ count: async () => 2 }) } as unknown as Page;
    const check = { id: 'element', criterionId: 'element', description: 'Button', required: true, kind: 'element_visible' as const, selector: 'button' };
    expect((await checkPage(page, [check], []))[0].verdict).toBe('uncertain');
    const abort = new AbortController(); abort.abort();
    expect((await checkPage(page, [check], [], abort.signal))[0].verdict).toBe('uncertain');
  });
});

describe('Dynamic HTTP contract handler', () => {
  it('checks membership before body reads and creates explicit mock missions', async () => {
    const { service } = await setup(); const prepareExecution = vi.fn();
    const deps = { actorId: 'actor-a', service, requireProjectMember: vi.fn(), prepareExecution, cancelExecution: vi.fn() };
    const body = { ...input(), context: undefined, contextScenario: 'normal' };
    const result = await handleDynamicRoute({ method: 'POST', pathname: '/projects/project-a/dynamic/missions', readBody: async () => body }, deps);
    expect(result?.status).toBe(201); expect((result?.body as any).context.provenance).toBe('mock-static');
    deps.requireProjectMember.mockRejectedValueOnce(new Error('Forbidden'));
    const readBody = vi.fn();
    await expect(handleDynamicRoute({ method: 'POST', pathname: '/projects/project-b/dynamic/missions', readBody }, deps)).rejects.toThrow('Forbidden');
    expect(readBody).not.toHaveBeenCalled();
  });
  it('starts once, replays without rerunning, and stops before cancelling the executor', async () => {
    const { service, revision } = await setup(); const execute = vi.fn().mockResolvedValue(undefined);
    const deps = { actorId: 'actor-a', service, requireProjectMember: vi.fn(), prepareExecution: vi.fn().mockResolvedValue(execute), cancelExecution: vi.fn() };
    const request = { method: 'POST', pathname: '/projects/project-a/dynamic/runs', readBody: async () => ({ revisionId: revision.id, idempotencyKey: 'one' }) };
    const first = await handleDynamicRoute(request, deps); const again = await handleDynamicRoute(request, deps);
    expect(first?.status).toBe(201); expect(again?.status).toBe(200); expect(execute).toHaveBeenCalledTimes(1);
    const runId = (first?.body as any).id;
    const cancelled = await handleDynamicRoute({ method: 'POST', pathname: `/projects/project-a/dynamic/runs/${runId}/cancel`, readBody: async () => ({}) }, deps);
    expect((cancelled?.body as any).state).toBe('cancelled');
    expect(deps.cancelExecution).toHaveBeenCalledWith(expect.objectContaining({ state: 'cancelled' }));
  });
});
