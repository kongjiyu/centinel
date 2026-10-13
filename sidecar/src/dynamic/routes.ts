import type { EnvironmentSnapshot } from './environment/types.js';
import { createStaticContextFixture, type StubScenario } from './testing/staticContextStub.js';
import { DynamicService } from './service.js';
import { DynamicContractError, type DynamicRun } from './types.js';

export type DynamicRouteDependencies = {
  validateAuthoring?(projectId: string, body: Record<string, unknown>): Promise<void>;
  actorId: string;
  service: DynamicService;
  requireProjectMember(projectId: string): Promise<void>;
  prepareExecution(projectId: string, revisionId?: string, environmentId?: string): Promise<((run: DynamicRun) => Promise<void>) | {execute(run: DynamicRun): Promise<void>; environment: EnvironmentSnapshot}>;
  cancelExecution(run: DynamicRun): void;
};

export async function handleDynamicRoute(request: { method: string; pathname: string; readBody(): Promise<Record<string, unknown>> }, deps: DynamicRouteDependencies): Promise<{ status: number; body: unknown } | null> {
  const match = request.pathname.match(/^\/projects\/([^/]+)\/dynamic\/(missions|revisions|runs)(?:\/([^/]+))?(?:\/(revisions|cancel))?$/);
  if (!match) return null;
  const [, projectId, resource, id, action] = match;
  await deps.requireProjectMember(projectId);
  try {
    const { service } = deps;
    // Reconcile only expired work in this authenticated project's context.
    // Healthy workers, including other devices, retain their leases.
    if (request.method === 'GET' || (resource === 'runs' && request.method === 'POST' && !id)) {
      const recovered = await service.recover(projectId);
      for (const run of recovered) deps.cancelExecution(run);
    }
    if (resource === 'missions' && !id && request.method === 'GET') return { status: 200, body: await service.repository.listMissions(projectId) };
    if (resource === 'missions' && request.method === 'POST' && (!id || action === 'revisions')) {
      const body = await request.readBody();
      if ('contextScenario' in body) {
        const scenarios: StubScenario[] = ['normal', 'stale', 'conflicting', 'unapproved', 'incomplete', 'absent'];
        if (!scenarios.includes(body.contextScenario as StubScenario)) throw new DynamicContractError(400, 'Unknown mock scenario.');
        // Explicit authoring input, not a fallback for missing/failed real context.
        body.context = createStaticContextFixture(projectId, body.contextScenario as StubScenario);
      }
      await deps.validateAuthoring?.(projectId,body);
      return { status: 201, body: await service.saveMission(projectId, deps.actorId, body, id) };
    }
    if (resource === 'revisions' && id && request.method === 'GET') {
      const revision = await service.repository.getRevision(projectId, id);
      if (!revision) throw new DynamicContractError(404, 'Revision not found.');
      return { status: 200, body: revision };
    }
    if (resource === 'runs' && !id && request.method === 'GET') return { status: 200, body: await service.repository.listRuns(projectId) };
    if (resource === 'runs' && !id && request.method === 'POST') {
      const body = await request.readBody();
      if (typeof body.revisionId !== 'string') throw new DynamicContractError(400, 'revisionId is required.');
      // Replay completed/running requests even if the provider subsequently becomes unavailable.
      if (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim() || body.idempotencyKey.length > 128) throw new DynamicContractError(400, 'A bounded idempotencyKey is required.');
      const old = await service.repository.getRunByKey(projectId, body.idempotencyKey.trim());
      if ('environmentId' in body && (typeof body.environmentId !== 'string' || !body.environmentId)) throw new DynamicContractError(400, 'Select a valid environment.');
      if (old) {
        if (old.environment?.id !== body.environmentId) throw new DynamicContractError(409, 'Idempotency environment conflict.');
        if (old.revision.id !== body.revisionId || old.createdBy !== deps.actorId) throw new DynamicContractError(409, 'Idempotency key belongs to a different request.');
        return { status: 200, body: old };
      }
      const prepared = await deps.prepareExecution(projectId, body.revisionId, body.environmentId as string | undefined);
      const execute = typeof prepared === 'function' ? prepared : prepared.execute;
      const environment = typeof prepared === 'function' ? undefined : prepared.environment;
      const result = await service.start(projectId, deps.actorId, body.revisionId, body.idempotencyKey as string, environment);
      if (!result.reused) void execute(result.run).catch(async () => { await service.stop(projectId, result.run.id, 'blocked', 'Execution unavailable.').catch(() => {}); });
      return { status: result.reused ? 200 : 201, body: result.run };
    }
    if (resource === 'runs' && id && !action && request.method === 'GET') return { status: 200, body: await service.requireRun(projectId, id) };
    if (resource === 'runs' && id && action === 'cancel' && request.method === 'POST') {
      const stopped = await service.stop(projectId, id, 'cancelled', 'Cancelled by a project member.');
      deps.cancelExecution(stopped);
      return { status: 200, body: stopped };
    }
    return { status: 405, body: { error: 'Unsupported Dynamic operation.' } };
  } catch (error) {
    if (error instanceof DynamicContractError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}
