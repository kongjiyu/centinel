import { describe, expect, it, vi } from 'vitest';
import { InMemoryDynamicRepository } from '../../src/dynamic/inMemoryRepository.js';
import { DynamicService } from '../../src/dynamic/service.js';
import { handleDynamicRoute } from '../../src/dynamic/routes.js';
import type { MissionInput } from '../../src/dynamic/types.js';
import { SupabaseDynamicRepository } from '../../src/dynamic/supabaseRepository.js';

const input = (): MissionInput => ({
  name: 'Login', goal: 'Open signed-in home', targetUrl: 'http://localhost:3000', maxSteps: 10, context: null, contextAcknowledged: false,
  checks: [{ id: 'home', criterionId: 'manual-home', description: 'Signed-in home', kind: 'visible_text', expected: 'Home', required: true }],
});
const setup = async () => {
  const repository = new InMemoryDynamicRepository();
  const service = new DynamicService(repository);
  const revision = await service.saveMission('project-a', 'actor-a', input());
  const execute = vi.fn().mockResolvedValue(undefined);
  const deps = { actorId: 'actor-b', service, requireProjectMember: vi.fn(), prepareExecution: vi.fn().mockResolvedValue(execute), cancelExecution: vi.fn() };
  return { repository, service, revision, deps, execute };
};
const post = (pathname: string, body: Record<string, unknown> = {}) => ({ method: 'POST', pathname, readBody: vi.fn(async () => body) });

describe('Saved test rename and archive', () => {
  it('renames only the saved test, without a new revision or changes to recorded Runs', async () => {
    const { repository, service, revision, deps } = await setup();
    const { run } = await service.start('project-a', 'actor-a', revision.id, 'one');
    const result = await handleDynamicRoute(post(`/projects/project-a/dynamic/missions/${revision.missionId}/rename`, { name: '  Checkout smoke  ' }), deps);
    expect(result?.status).toBe(200);
    expect(result?.body).toMatchObject({ id: revision.missionId, currentRevisionId: revision.id, displayName: 'Checkout smoke', updatedBy: 'actor-b' });
    expect((await repository.getRevision('project-a', revision.id))?.name).toBe('Login');
    expect((await repository.getRun('project-a', run.id))?.revision.name).toBe('Login');
    expect((await repository.listMissions('project-a'))).toHaveLength(1);
  });

  it('rejects empty or oversized names', async () => {
    const { revision, deps } = await setup();
    for (const name of ['', '   ', 'x'.repeat(201), 42]) {
      const result = await handleDynamicRoute(post(`/projects/project-a/dynamic/missions/${revision.missionId}/rename`, { name }), deps);
      expect(result?.status).toBe(400);
    }
  });

  it('checks project membership before reading the body or changing a saved test', async () => {
    const { repository, revision, deps } = await setup();
    deps.requireProjectMember.mockRejectedValue(new Error('Forbidden'));
    const rename = post(`/projects/project-a/dynamic/missions/${revision.missionId}/rename`, { name: 'Taken over' });
    await expect(handleDynamicRoute(rename, deps)).rejects.toThrow('Forbidden');
    expect(rename.readBody).not.toHaveBeenCalled();
    await expect(handleDynamicRoute(post(`/projects/project-a/dynamic/missions/${revision.missionId}/archive`), deps)).rejects.toThrow('Forbidden');
    expect(deps.requireProjectMember).toHaveBeenCalledWith('project-a');
    const mission = await repository.getMission('project-a', revision.missionId);
    expect(mission?.displayName).toBeUndefined();
    expect(mission?.archivedAt).toBeUndefined();
  });

  it('does not reach saved tests through another project', async () => {
    const { repository, revision, deps } = await setup();
    const rename = await handleDynamicRoute(post(`/projects/project-b/dynamic/missions/${revision.missionId}/rename`, { name: 'Other' }), deps);
    const archive = await handleDynamicRoute(post(`/projects/project-b/dynamic/missions/${revision.missionId}/archive`), deps);
    expect(rename?.status).toBe(404);
    expect(archive?.status).toBe(404);
    expect(deps.requireProjectMember).toHaveBeenCalledWith('project-b');
    expect((await repository.getMission('project-a', revision.missionId))?.archivedAt).toBeUndefined();
  });

  it('archives without deleting history, blocks new Runs and edits, and unarchives', async () => {
    const { repository, service, revision, deps, execute } = await setup();
    const { run } = await service.start('project-a', 'actor-a', revision.id, 'before-archive');
    await service.stop('project-a', run.id, 'cancelled', 'Stopped');
    const archived = await handleDynamicRoute(post(`/projects/project-a/dynamic/missions/${revision.missionId}/archive`), deps);
    expect(archived?.status).toBe(200);
    expect(archived?.body).toMatchObject({ archivedBy: 'actor-b', archivedAt: expect.any(String) });
    // History and evidence records stay readable.
    expect(await repository.listRuns('project-a')).toHaveLength(1);
    expect((await handleDynamicRoute({ method: 'GET', pathname: `/projects/project-a/dynamic/runs/${run.id}`, readBody: async () => ({}) }, deps))?.status).toBe(200);
    expect((await handleDynamicRoute({ method: 'GET', pathname: `/projects/project-a/dynamic/revisions/${revision.id}`, readBody: async () => ({}) }, deps))?.status).toBe(200);
    const listed = await handleDynamicRoute({ method: 'GET', pathname: '/projects/project-a/dynamic/missions', readBody: async () => ({}) }, deps);
    expect((listed?.body as any[])[0].archivedAt).toEqual(expect.any(String));

    const blocked = await handleDynamicRoute(post('/projects/project-a/dynamic/runs', { revisionId: revision.id, idempotencyKey: 'after-archive' }), deps);
    expect(blocked).toEqual({ status: 409, body: { error: 'Unarchive this saved test before running it.' } });
    expect(deps.prepareExecution).not.toHaveBeenCalled();
    await expect(service.start('project-a', 'actor-a', revision.id, 'direct')).rejects.toThrow('Unarchive');
    const edit = await handleDynamicRoute(post(`/projects/project-a/dynamic/missions/${revision.missionId}/revisions`, { ...input(), goal: 'Changed' }), deps);
    expect(edit?.status).toBe(409);

    const restored = await handleDynamicRoute(post(`/projects/project-a/dynamic/missions/${revision.missionId}/unarchive`), deps);
    expect(restored?.status).toBe(200);
    expect((restored?.body as any).archivedAt).toBeUndefined();
    const started = await handleDynamicRoute(post('/projects/project-a/dynamic/runs', { revisionId: revision.id, idempotencyKey: 'after-unarchive' }), deps);
    expect(started?.status).toBe(201);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('keeps the first archive time and returns 404 for unknown saved tests', async () => {
    const { revision, deps } = await setup();
    const first = await handleDynamicRoute(post(`/projects/project-a/dynamic/missions/${revision.missionId}/archive`), deps);
    const again = await handleDynamicRoute(post(`/projects/project-a/dynamic/missions/${revision.missionId}/archive`), deps);
    expect((again?.body as any).archivedAt).toBe((first?.body as any).archivedAt);
    const missing = await handleDynamicRoute(post('/projects/project-a/dynamic/missions/00000000-0000-4000-8000-000000000000/archive'), deps);
    expect(missing?.status).toBe(404);
  });

  it('lets a later saved revision name replace an earlier rename', async () => {
    const { repository, service, revision } = await setup();
    await service.renameMission('project-a', 'actor-a', revision.missionId, 'Renamed');
    const next = await service.saveMission('project-a', 'actor-a', { ...input(), name: 'Edited name' }, revision.missionId);
    const mission = await repository.getMission('project-a', revision.missionId);
    expect(mission?.currentRevisionId).toBe(next.id);
    expect(mission?.displayName).toBeUndefined();
  });

  it('does not accept unsupported mission actions', async () => {
    const { revision, deps } = await setup();
    const result = await handleDynamicRoute(post(`/projects/project-a/dynamic/missions/${revision.missionId}/cancel`), deps);
    expect(result?.status).toBe(405);
  });
});

describe('Supabase saved test management', () => {
  it('writes through the guarded RPC with the authenticated actor and maps missing records', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { id: 'm' }, error: null }).mockResolvedValueOnce({ data: null, error: { code: 'P0002' } });
    const repository = new SupabaseDynamicRepository({ rpc } as any);
    await repository.updateMission('p', 'actor', 'm', { displayName: null, archived: true });
    expect(rpc).toHaveBeenCalledWith('update_dynamic_mission', { p_project_id: 'p', p_actor_id: 'actor', p_mission_id: 'm', p_display_name: null, p_clear_display_name: true, p_archived: true });
    await expect(repository.updateMission('p', 'actor', 'missing', { displayName: 'Name' })).rejects.toMatchObject({ status: 404 });
    expect(rpc).toHaveBeenLastCalledWith('update_dynamic_mission', expect.objectContaining({ p_display_name: 'Name', p_clear_display_name: false, p_archived: null }));
  });
});
