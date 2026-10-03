import type { SupabaseClient } from '@supabase/supabase-js';
import { CentinelApplicationRepository } from './applicationRepository.js';
import { getIntegrationCredentials } from './integrations.js';
import { CollaborationError, type CollaborationStatus, type GithubCollaborator, type GithubCollaboratorSnapshot, type GithubInviteResult, type GithubPullRequest, type GithubRepository, type GithubSearchResult } from './githubTypes.js';

export function githubRepository(remoteId: string | null, remoteUrl: string | null): GithubRepository | null {
  const raw = remoteId || remoteUrl || '';
  const value = raw.startsWith('https://github.com/') ? new URL(raw).pathname.replace(/^\//, '') : raw;
  const match = value.replace(/\.git$/i, '').replace(/\/$/, '').match(/^([\w.-]+)\/([\w.-]+)$/);
  return match ? { owner: match[1], repo: match[2], remoteUrl: remoteUrl || `https://github.com/${match[1]}/${match[2]}` } : null;
}

function headers(token: string): Record<string, string> {
  return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Centinel' };
}

type StoredGithubCollaborators = Pick<GithubCollaboratorSnapshot, 'collaborators' | 'syncedAt'>;

type GithubCollaboratorPersistence = {
  list(projectId: string): Promise<StoredGithubCollaborators>;
  replace(projectId: string, collaborators: GithubCollaborator[], syncedAt: string): Promise<void>;
};

type CollaboratorRow = Record<string, unknown>;

function mapCollaboratorRow(value: unknown): GithubCollaborator | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as CollaboratorRow;
  const id = Number(row.github_user_id);
  if (!Number.isSafeInteger(id) || typeof row.login !== 'string' || !row.login) return null;
  return {
    id,
    login: row.login,
    avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : '',
    htmlUrl: typeof row.html_url === 'string' ? row.html_url : '',
    type: typeof row.account_type === 'string' ? row.account_type : 'User',
    permission: typeof row.permission === 'string' ? row.permission : 'unknown',
  };
}

class SupabaseGithubCollaboratorPersistence implements GithubCollaboratorPersistence {
  constructor(private readonly client: SupabaseClient) {}

  async list(projectId: string): Promise<StoredGithubCollaborators> {
    const [result, syncResult] = await Promise.all([
      this.client.from('github_project_collaborators')
        .select('github_user_id, login, avatar_url, html_url, account_type, permission, synced_at')
        .eq('project_id', projectId)
        .order('login', { ascending: true }),
      this.client.from('github_project_collaborator_syncs')
        .select('synced_at').eq('project_id', projectId).maybeSingle(),
    ]);
    if (result.error || syncResult.error) {
      throw new CollaborationError('Saved GitHub collaborators could not be loaded. Check the database migration and try again.', 'github_storage_failed', 502);
    }
    const rows = Array.isArray(result.data) ? result.data as CollaboratorRow[] : [];
    const collaborators = rows.flatMap(row => {
      const mapped = mapCollaboratorRow(row);
      return mapped ? [mapped] : [];
    });
    const timestamps = rows.map(row => typeof row.synced_at === 'string' ? row.synced_at : '').filter(Boolean).sort();
    return { collaborators, syncedAt: syncResult.data?.synced_at || timestamps[timestamps.length - 1] || null };
  }

  async replace(projectId: string, collaborators: GithubCollaborator[], syncedAt: string): Promise<void> {
    const result = await this.client.rpc('replace_github_project_collaborators', {
      p_project_id: projectId,
      p_synced_at: syncedAt,
      p_collaborators: collaborators.map(collaborator => ({
        github_user_id: collaborator.id,
        login: collaborator.login,
        avatar_url: collaborator.avatarUrl,
        html_url: collaborator.htmlUrl,
        account_type: collaborator.type,
        permission: collaborator.permission,
      })),
    });
    if (result.error) {
      if (result.error.code === '42501') {
        throw new CollaborationError('Project owner or member access is required to sync GitHub collaborators.', 'project_access_denied', 403);
      }
      throw new CollaborationError('GitHub collaborators could not be saved. Check the database migration and project access, then try again.', 'github_storage_failed', 502);
    }
  }
}

function githubPermission(item: Record<string, unknown>): string {
  if (typeof item.role_name === 'string' && item.role_name.trim()) return item.role_name;
  if (typeof item.permission === 'string' && item.permission.trim()) return item.permission;
  const permissions = item.permissions && typeof item.permissions === 'object' ? item.permissions as Record<string, unknown> : {};
  for (const permission of ['admin', 'maintain', 'push', 'triage', 'pull']) {
    if (permissions[permission] === true) return permission;
  }
  return 'unknown';
}

function mapGithubCollaborator(value: unknown): GithubCollaborator | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'number' || !Number.isSafeInteger(item.id) || typeof item.login !== 'string' || !item.login.trim()) return null;
  return {
    id: item.id,
    login: item.login,
    avatarUrl: typeof item.avatar_url === 'string' ? item.avatar_url : '',
    htmlUrl: typeof item.html_url === 'string' ? item.html_url : '',
    type: typeof item.type === 'string' ? item.type : 'User',
    permission: githubPermission(item),
  };
}

/** GitHub collaboration resolves project/source membership in Supabase; no
 * local SQLite project row or environment token is an authorization source. */
export class SupabaseGithubCollaborationService {
  private readonly repository: Pick<CentinelApplicationRepository, 'requireProjectMember' | 'getProject' | 'listSources'>;
  private readonly collaboratorPersistence: GithubCollaboratorPersistence;
  private readonly getToken: () => Promise<string | null>;
  private readonly fetchImpl: typeof fetch;

  constructor(client: SupabaseClient, ownerId: string, accessToken: string, options: {
    repository?: Pick<CentinelApplicationRepository, 'requireProjectMember' | 'getProject' | 'listSources'>;
    collaboratorPersistence?: GithubCollaboratorPersistence;
    getToken?: () => Promise<string | null>;
    fetchImpl?: typeof fetch;
  } = {}) {
    this.repository = options.repository ?? new CentinelApplicationRepository(client, ownerId);
    this.collaboratorPersistence = options.collaboratorPersistence ?? new SupabaseGithubCollaboratorPersistence(client);
    this.getToken = options.getToken ?? (async () => (await getIntegrationCredentials('github', ownerId, accessToken))?.accessToken ?? null);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async repositoryForProject(projectId: string): Promise<GithubRepository | null> {
    await this.repository.requireProjectMember(projectId);
    const project = await this.repository.getProject(projectId);
    if (!project) throw new CollaborationError('Project not found.', 'project_not_found', 404);
    const sources = await this.repository.listSources(projectId);
    const source = sources.find(item => item.kind === 'github_repository' && item.remoteId);
    return source ? githubRepository(source.remoteId, source.remoteUrl) : null;
  }

  private async context(projectId: string): Promise<{ repository: GithubRepository; token: string }> {
    const repository = await this.repositoryForProject(projectId);
    if (!repository) throw new CollaborationError('Connect a GitHub repository to this project first.', 'missing_remote', 400);
    const token = await this.getToken();
    if (!token) throw new CollaborationError('Connect GitHub repository access in Settings.', 'missing_token', 409);
    return { repository, token };
  }

  async status(projectId: string): Promise<CollaborationStatus> {
    const repository = await this.repositoryForProject(projectId);
    if (!repository) return { available: false, repository: null, reason: 'missing_remote', message: 'Connect a GitHub repository to this project first.' };
    const token = await this.getToken();
    if (!token) return { available: false, repository, reason: 'missing_token', message: 'Connect GitHub repository access in Settings.' };
    return { available: true, repository };
  }

  async listPullRequests(projectId: string): Promise<{ repository: GithubRepository; pullRequests: GithubPullRequest[] }> {
    const { repository, token } = await this.context(projectId);
    const endpoint = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/pulls?state=all&per_page=30&sort=updated&direction=desc`;
    const response = await this.request(endpoint, { headers: headers(token) });
    const body = await response.json() as Array<Record<string, unknown>>;
    if (!Array.isArray(body)) throw new CollaborationError('GitHub returned an invalid pull request response.', 'github_request_failed', 502);
    const pullRequests = body.flatMap(item => {
      if (typeof item.number !== 'number' || typeof item.title !== 'string') return [];
      const head = item.head && typeof item.head === 'object' ? item.head as Record<string, unknown> : {};
      const base = item.base && typeof item.base === 'object' ? item.base as Record<string, unknown> : {};
      return [{ number: item.number, title: item.title, state: item.state === 'closed' ? 'closed' as const : 'open' as const,
        htmlUrl: typeof item.html_url === 'string' ? item.html_url : '',
        headRef: typeof head.ref === 'string' ? head.ref : '', baseRef: typeof base.ref === 'string' ? base.ref : '' }];
    });
    return { repository, pullRequests };
  }

  async listCollaborators(projectId: string): Promise<GithubCollaboratorSnapshot> {
    const repository = await this.repositoryForProject(projectId);
    const saved = await this.collaboratorPersistence.list(projectId);
    return { repository, ...saved };
  }

  async syncCollaborators(projectId: string): Promise<GithubCollaboratorSnapshot> {
    const { repository, token } = await this.context(projectId);
    const collaborators: GithubCollaborator[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const endpoint = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/collaborators?per_page=100&page=${page}`;
      const response = await this.request(endpoint, { headers: headers(token) });
      let body: unknown;
      try { body = await response.json(); }
      catch { throw new CollaborationError('GitHub returned an invalid collaborator response.', 'github_request_failed', 502); }
      if (!Array.isArray(body)) throw new CollaborationError('GitHub returned an invalid collaborator response.', 'github_request_failed', 502);
      collaborators.push(...body.flatMap(item => {
        const mapped = mapGithubCollaborator(item);
        return mapped ? [mapped] : [];
      }));
      if (body.length < 100) break;
      if (page === 100) throw new CollaborationError('The repository has too many collaborators to sync in one request.', 'github_request_failed', 502);
    }

    const syncedAt = new Date().toISOString();
    await this.collaboratorPersistence.replace(projectId, collaborators, syncedAt);
    return { repository, collaborators, syncedAt };
  }

  async searchUsers(projectId: string, email: string): Promise<GithubSearchResult> {
    const normalizedEmail = email.trim();
    if (!normalizedEmail.includes('@')) throw new CollaborationError('Enter a valid email address.', 'invalid_email', 400);
    const { repository, token } = await this.context(projectId);
    const response = await this.request(`https://api.github.com/search/users?q=${encodeURIComponent(normalizedEmail)}`, { headers: headers(token) });
    const body = await response.json() as { items?: Array<Record<string, unknown>> };
    const matches = (Array.isArray(body.items) ? body.items : []).slice(0, 10).flatMap(item =>
      typeof item.id === 'number' && typeof item.login === 'string' ? [{
        id: item.id, login: item.login,
        avatarUrl: typeof item.avatar_url === 'string' ? item.avatar_url : '',
        htmlUrl: typeof item.html_url === 'string' ? item.html_url : '',
        type: typeof item.type === 'string' ? item.type : 'User',
      }] : []);
    return { email: normalizedEmail, repository, matches };
  }

  async invite(projectId: string, username: string): Promise<GithubInviteResult> {
    const normalizedUsername = username.trim();
    if (!/^[A-Za-z0-9-]+$/.test(normalizedUsername)) throw new CollaborationError('Select a valid GitHub account before sending an invitation.', 'invalid_username', 400);
    const { repository, token } = await this.context(projectId);
    const response = await this.request(`https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/collaborators/${encodeURIComponent(normalizedUsername)}`, {
      method: 'PUT', headers: { ...headers(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ permission: 'pull' }),
    });
    return { username: normalizedUsername, repository, status: response.status === 200 ? 'already_collaborator' : 'invited' };
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try { response = await this.fetchImpl(url, init); }
    catch { throw new CollaborationError('GitHub could not be reached. Try again later.', 'github_request_failed', 502); }
    if (!response.ok) throw new CollaborationError(response.status === 401 || response.status === 403
      ? 'GitHub denied this request. Reconnect the repository account or check repository permissions.'
      : 'GitHub could not complete this request. Try again later.', 'github_request_failed', 502);
    return response;
  }
}
