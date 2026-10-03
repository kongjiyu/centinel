export type GithubRepository = {
  owner: string;
  repo: string;
  remoteUrl: string;
};

export type CollaborationStatus = {
  available: boolean;
  repository: GithubRepository | null;
  reason?: 'missing_remote' | 'missing_token' | 'unsupported_remote' | 'project_not_found';
  message?: string;
};

export type GithubUserMatch = {
  id: number;
  login: string;
  avatarUrl: string;
  htmlUrl: string;
  type: string;
};

export type GithubSearchResult = {
  email: string;
  repository: GithubRepository;
  matches: GithubUserMatch[];
};

export type GithubInviteResult = {
  username: string;
  repository: GithubRepository;
  status: 'invited' | 'already_collaborator';
};

export type GithubCollaborator = {
  id: number;
  login: string;
  avatarUrl: string;
  htmlUrl: string;
  type: string;
  permission: string;
};

export type GithubCollaboratorSnapshot = {
  repository: GithubRepository | null;
  collaborators: GithubCollaborator[];
  syncedAt: string | null;
};

export type GithubPullRequest = {
  number: number;
  title: string;
  state: 'open' | 'closed';
  htmlUrl: string;
  headRef: string;
  baseRef: string;
};

/** Collaboration errors must not expose OAuth credentials or raw provider responses. */
export class CollaborationError extends Error {
  readonly code: CollaborationStatus['reason'] | 'project_access_denied' | 'github_request_failed' | 'github_storage_failed' | 'invalid_email' | 'invalid_username';
  readonly httpStatus: number;

  constructor(message: string, code: CollaborationError['code'], httpStatus = 400) {
    super(message);
    this.name = 'CollaborationError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function parseGithubRemote(remoteUrl: string): GithubRepository | null {
  const value = remoteUrl.trim();
  if (!value) return null;

  let pathPart = '';
  let host = '';
  const scp = value.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
  if (scp && !value.includes('://')) {
    host = scp[1];
    pathPart = scp[2];
  } else {
    try {
      const parsed = new URL(value);
      host = parsed.hostname;
      pathPart = parsed.pathname;
    } catch {
      return null;
    }
  }

  if (host.toLowerCase() !== 'github.com') return null;
  const parts = pathPart.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
  if (parts.length !== 2) return null;
  const owner = parts[0].trim();
  const repo = parts[1].replace(/\.git$/i, '').trim();
  if (!owner || !repo) return null;
  return { owner, repo, remoteUrl: value };
}
