import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseGithubCollaborationService, githubRepository } from '../../src/githubCollaboration.js';
import type { CentinelApplicationRepository } from '../../src/applicationRepository.js';

const project = { id: 'project-1', name: 'Project', description: '', workspacePath: '', createdAt: '', updatedAt: '' };
const source = { id: 'source-1', projectId: project.id, integrationId: 'integration-1', kind: 'github_repository' as const,
  name: 'repo', remoteId: 'team/repo', remoteUrl: 'https://github.com/team/repo', syncStatus: 'ready' as const,
  lastSyncedAt: null, createdAt: '', updatedAt: '' };

function service(options: { sources?: typeof source[]; token?: string | null; fetchImpl?: typeof fetch;
  collaboratorPersistence?: { list: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn> } } = {}) {
  const repository = {
    requireProjectMember: vi.fn().mockResolvedValue(undefined),
    getProject: vi.fn().mockResolvedValue(project),
    listSources: vi.fn().mockResolvedValue(options.sources ?? [source]),
  } as unknown as Pick<CentinelApplicationRepository, 'requireProjectMember' | 'getProject' | 'listSources'>;
  return { repository, instance: new SupabaseGithubCollaborationService({} as SupabaseClient, 'user-1', 'bearer', {
    repository, getToken: async () => options.token === undefined ? 'github-oauth-token' : options.token,
    fetchImpl: options.fetchImpl, collaboratorPersistence: options.collaboratorPersistence,
  }) };
}

describe('Supabase GitHub collaboration', () => {
  it('derives the repository from a project source, never a local Git checkout', async () => {
    expect(githubRepository('team/repo', null)).toEqual({ owner: 'team', repo: 'repo', remoteUrl: 'https://github.com/team/repo' });
    expect(githubRepository('https://github.com/team/repo.git', null)?.repo).toBe('repo');
    const { instance, repository } = service();
    expect(await instance.status(project.id)).toMatchObject({ available: true, repository: { owner: 'team', repo: 'repo' } });
    expect(repository.requireProjectMember).toHaveBeenCalledWith(project.id);
    expect((await service({ token: null }).instance.status(project.id)).reason).toBe('missing_token');
    expect((await service({ sources: [] }).instance.status(project.id)).reason).toBe('missing_remote');
  });

  it('uses the OAuth token only in the GitHub request and returns no credential', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ number: 7, title: 'Fix login', state: 'open', html_url: 'https://github.com/team/repo/pull/7', head: { ref: 'fix' }, base: { ref: 'main' } }]), { status: 200 })) as unknown as typeof fetch;
    const result = await service({ fetchImpl }).instance.listPullRequests(project.id);
    expect(result.pullRequests).toMatchObject([{ number: 7, headRef: 'fix', baseRef: 'main' }]);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/repos/team/repo/pulls'), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer github-oauth-token' }) }));
    expect(JSON.stringify(result)).not.toContain('github-oauth-token');
  });

  it('syncs GitHub collaborator permissions into the project snapshot', async () => {
    const persistence = { list: vi.fn(), replace: vi.fn().mockResolvedValue(undefined) };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { id: 42, login: 'octocat', avatar_url: 'https://github.com/avatar', html_url: 'https://github.com/octocat', role_name: 'admin' },
    ]), { status: 200 })) as unknown as typeof fetch;
    const result = await service({ fetchImpl, collaboratorPersistence: persistence }).instance.syncCollaborators(project.id);

    expect(result.collaborators).toMatchObject([{ id: 42, login: 'octocat', permission: 'admin' }]);
    expect(result.syncedAt).toBeTruthy();
    expect(persistence.replace).toHaveBeenCalledWith(project.id, result.collaborators, result.syncedAt);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/repos/team/repo/collaborators?per_page=100&page=1'), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer github-oauth-token' }) }));
    expect(JSON.stringify(result)).not.toContain('github-oauth-token');
  });

  it('records a successful empty snapshot without inventing collaborators', async () => {
    const persistence = { list: vi.fn(), replace: vi.fn().mockResolvedValue(undefined) };
    const fetchImpl = vi.fn().mockResolvedValue(new Response('[]', { status: 200 })) as unknown as typeof fetch;
    const result = await service({ fetchImpl, collaboratorPersistence: persistence }).instance.syncCollaborators(project.id);

    expect(result.collaborators).toEqual([]);
    expect(persistence.replace).toHaveBeenCalledWith(project.id, [], result.syncedAt);
  });

  it('preserves the previous snapshot when GitHub rejects access', async () => {
    const persistence = { list: vi.fn(), replace: vi.fn() };
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 403 })) as unknown as typeof fetch;
    await expect(service({ fetchImpl, collaboratorPersistence: persistence }).instance.syncCollaborators(project.id))
      .rejects.toThrow(/GitHub denied this request/);
    expect(persistence.replace).not.toHaveBeenCalled();
  });
});
