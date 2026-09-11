import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getDb, saveDb } from './db.js';

export type Project = {
  id: string;
  name: string;
  description: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectUpdate = {
  name?: string;
  description?: string;
  workspacePath?: string;
};

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

export type GithubPullRequest = {
  number: number;
  title: string;
  state: 'open' | 'closed';
  htmlUrl: string;
  headRef: string;
  baseRef: string;
};

export type GithubConnectionStatus = {
  connected: boolean;
  login: string | null;
  message: string;
};

/**
 * Errors returned by the collaboration boundary are intentionally generic.
 * In particular, never include the configured GitHub token in a message or
 * pass through a provider response that could contain request metadata.
 */
export class CollaborationError extends Error {
  readonly code: CollaborationStatus['reason'] | 'github_request_failed' | 'invalid_email' | 'invalid_username';
  readonly httpStatus: number;

  constructor(
    message: string,
    code: CollaborationError['code'],
    httpStatus = 400,
  ) {
    super(message);
    this.name = 'CollaborationError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const execFileAsync = promisify(execFile);

function mapRow(row: unknown[]): Project {
  return {
    id: row[0] as string,
    name: row[1] as string,
    description: row[2] as string,
    workspacePath: row[3] as string,
    createdAt: row[4] as string,
    updatedAt: row[5] as string,
  };
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, name, description, workspace_path, created_at, updated_at FROM projects ORDER BY created_at DESC');
  const rows: Project[] = [];
  while (stmt.step()) {
    rows.push(mapRow(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

export async function getProject(id: string): Promise<Project | null> {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, name, description, workspace_path, created_at, updated_at FROM projects WHERE id = ?');
  stmt.bind([id]);
  let project: Project | null = null;
  if (stmt.step()) {
    project = mapRow(stmt.get() as unknown[]);
  }
  stmt.free();
  return project;
}

export async function createProject(
  name: string,
  description: string,
  workspacePath: string,
  source?: { type: 'local-repository' } | { type: 'github'; repoUrl: string },
): Promise<Project> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let resolvedWorkspace = workspacePath.trim();

  if (source?.type === 'github') {
    const safeName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
    const defaultRoot = path.resolve(process.cwd(), 'data', 'projects');
    resolvedWorkspace = path.join(defaultRoot, `${safeName}-${id.slice(0, 8)}`);
    fs.mkdirSync(defaultRoot, { recursive: true });
    await execFileAsync('git', ['clone', '--depth', '1', '--', source.repoUrl, resolvedWorkspace], { windowsHide: true });
  }

  if (!resolvedWorkspace) throw new Error('Workspace path is required');

  fs.mkdirSync(path.join(resolvedWorkspace, 'artifacts'), { recursive: true });
  fs.mkdirSync(path.join(resolvedWorkspace, 'evidence'), { recursive: true });
  fs.mkdirSync(path.join(resolvedWorkspace, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(resolvedWorkspace, 'sessions'), { recursive: true });

  db.run(
    'INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, name.trim(), description.trim(), resolvedWorkspace, now, now]
  );
  saveDb();

  return { id, name: name.trim(), description: description.trim(), workspacePath: resolvedWorkspace, createdAt: now, updatedAt: now };
}

export async function updateProject(id: string, updates: ProjectUpdate): Promise<Project | null> {
  const db = await getDb();
  const existing = await getProject(id);
  if (!existing) return null;

  const next: Project = {
    ...existing,
    name: updates.name === undefined ? existing.name : updates.name.trim(),
    description: updates.description === undefined ? existing.description : updates.description.trim(),
    workspacePath: updates.workspacePath === undefined ? existing.workspacePath : updates.workspacePath.trim(),
    updatedAt: new Date().toISOString(),
  };

  if (!next.name) throw new Error('Project name is required');
  if (!next.workspacePath) throw new Error('Workspace path is required');

  db.run(
    'UPDATE projects SET name = ?, description = ?, workspace_path = ?, updated_at = ? WHERE id = ?',
    [next.name, next.description, next.workspacePath, next.updatedAt, id],
  );
  saveDb();
  return next;
}

export async function deleteProject(id: string): Promise<boolean> {
  const db = await getDb();
  const project = await getProject(id);
  if (!project) return false;

  db.run('DELETE FROM evidence WHERE project_id = ?', [id]);
  db.run('DELETE FROM findings WHERE project_id = ?', [id]);
  db.run('DELETE FROM sessions WHERE project_id = ?', [id]);
  db.run('DELETE FROM static_sessions WHERE project_id = ?', [id]);
  db.run('DELETE FROM artifacts WHERE project_id = ?', [id]);
  db.run('DELETE FROM requirement_mappings WHERE requirement_id IN (SELECT id FROM requirements WHERE project_id = ?)', [id]);
  db.run('DELETE FROM requirements WHERE project_id = ?', [id]);
  db.run('DELETE FROM projects WHERE id = ?', [id]);
  saveDb();
  return true;
}

function githubToken(): string | null {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  return token || null;
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

async function getGithubRepository(project: Project): Promise<GithubRepository | null> {
  try {
    const result = await execFileAsync('git', ['-C', project.workspacePath, 'remote', 'get-url', 'origin'], {
      windowsHide: true,
    });
    return parseGithubRemote(String(result.stdout));
  } catch {
    return null;
  }
}

export async function getCollaborationStatus(projectId: string): Promise<CollaborationStatus> {
  const project = await getProject(projectId);
  if (!project) {
    return {
      available: false,
      repository: null,
      reason: 'project_not_found',
      message: 'Project not found.',
    };
  }

  const repository = await getGithubRepository(project);
  if (!repository) {
    return {
      available: false,
      repository: null,
      reason: 'missing_remote',
      message: 'A GitHub origin remote is required before collaborators can be invited.',
    };
  }

  if (!githubToken()) {
    return {
      available: false,
      repository,
      reason: 'missing_token',
      message: 'Set GITHUB_TOKEN or GH_TOKEN in the sidecar environment to use GitHub collaboration.',
    };
  }

  return { available: true, repository };
}

async function getGithubContext(projectId: string): Promise<{ repository: GithubRepository; token: string }> {
  const project = await getProject(projectId);
  if (!project) throw new CollaborationError('Project not found.', 'project_not_found', 404);

  const repository = await getGithubRepository(project);
  if (!repository) {
    throw new CollaborationError(
      'A GitHub origin remote is required before collaborators can be invited.',
      'missing_remote',
      400,
    );
  }

  const token = githubToken();
  if (!token) {
    throw new CollaborationError(
      'Set GITHUB_TOKEN or GH_TOKEN in the sidecar environment to use GitHub collaboration.',
      'missing_token',
      503,
    );
  }
  return { repository, token };
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Centinel',
  };
}

/**
 * Validate the shared GitHub credential used by project imports, pull-request
 * review scope, and collaborator actions. The token itself never crosses the
 * HTTP boundary or appears in an error message.
 */
export async function getGithubConnectionStatus(): Promise<GithubConnectionStatus> {
  const token = githubToken();
  if (!token) {
    return {
      connected: false,
      login: null,
      message: 'GitHub is not connected. Configure GITHUB_TOKEN or GH_TOKEN for private repositories and pull requests.',
    };
  }

  try {
    const response = await fetch('https://api.github.com/user', { headers: githubHeaders(token) });
    if (response.status === 401 || response.status === 403) {
      return { connected: false, login: null, message: 'The GitHub credential was rejected. Update it and try again.' };
    }
    if (!response.ok) {
      return { connected: false, login: null, message: 'GitHub could not verify the connection. Try again later.' };
    }
    const body = await response.json() as { login?: unknown };
    const login = typeof body.login === 'string' && body.login.trim() ? body.login.trim() : null;
    return {
      connected: true,
      login,
      message: login ? `Connected to GitHub as ${login}.` : 'GitHub connection verified.',
    };
  } catch {
    return { connected: false, login: null, message: 'GitHub could not be reached. Try again later.' };
  }
}

/** Return the repository pull requests that can be selected for a PR review. */
export async function listGithubPullRequests(projectId: string): Promise<{ repository: GithubRepository; pullRequests: GithubPullRequest[] }> {
  const project = await getProject(projectId);
  if (!project) throw new CollaborationError('Project not found.', 'project_not_found', 404);
  const repository = await getGithubRepository(project);
  if (!repository) {
    throw new CollaborationError('A GitHub origin remote is required before selecting a pull request.', 'missing_remote', 400);
  }
  const token = githubToken();
  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/pulls?state=all&per_page=30&sort=updated&direction=desc`,
      { headers: token ? githubHeaders(token) : { Accept: 'application/vnd.github+json', 'User-Agent': 'Centinel' } },
    );
  } catch {
    throw new CollaborationError('GitHub could not be reached. Try again later.', 'github_request_failed', 502);
  }
  if (!response.ok) {
    throw new CollaborationError('GitHub could not load pull requests for this repository.', 'github_request_failed', 502);
  }
  let body: Array<Record<string, unknown>> = [];
  try {
    body = await response.json() as Array<Record<string, unknown>>;
  } catch {
    throw new CollaborationError('GitHub returned an invalid pull request response.', 'github_request_failed', 502);
  }
  const pullRequests = body.flatMap(item => {
    const number = typeof item.number === 'number' ? item.number : null;
    const title = typeof item.title === 'string' ? item.title : '';
    const state = item.state === 'closed' ? 'closed' : 'open';
    const htmlUrl = typeof item.html_url === 'string' ? item.html_url : '';
    const head = item.head && typeof item.head === 'object' ? item.head as Record<string, unknown> : {};
    const base = item.base && typeof item.base === 'object' ? item.base as Record<string, unknown> : {};
    const headRef = typeof head.ref === 'string' ? head.ref : '';
    const baseRef = typeof base.ref === 'string' ? base.ref : '';
    if (number === null || !title) return [];
    return [{ number, title, state: state as 'open' | 'closed', htmlUrl, headRef, baseRef }];
  });
  return { repository, pullRequests };
}

export async function searchGithubUsers(projectId: string, email: string): Promise<GithubSearchResult> {
  const normalizedEmail = email.trim();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new CollaborationError('Enter a valid email address.', 'invalid_email', 400);
  }

  const { repository, token } = await getGithubContext(projectId);
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/search/users?q=${encodeURIComponent(normalizedEmail)}`, {
      headers: githubHeaders(token),
    });
  } catch {
    throw new CollaborationError('GitHub could not be reached. Try again later.', 'github_request_failed', 502);
  }

  if (!response.ok) {
    throw new CollaborationError(
      response.status === 401 || response.status === 403
        ? 'The configured GitHub credential was rejected.'
        : 'GitHub could not search for that email address.',
      'github_request_failed',
      response.status === 401 || response.status === 403 ? 502 : 502,
    );
  }

  let body: { items?: Array<Record<string, unknown>> } = {};
  try {
    body = await response.json() as { items?: Array<Record<string, unknown>> };
  } catch {
    throw new CollaborationError('GitHub returned an invalid search response.', 'github_request_failed', 502);
  }

  const matches = (body.items ?? []).slice(0, 10).flatMap(item => {
    const id = typeof item.id === 'number' ? item.id : null;
    const login = typeof item.login === 'string' ? item.login : '';
    if (id === null || !login) return [];
    return [{
      id,
      login,
      avatarUrl: typeof item.avatar_url === 'string' ? item.avatar_url : '',
      htmlUrl: typeof item.html_url === 'string' ? item.html_url : '',
      type: typeof item.type === 'string' ? item.type : 'User',
    }];
  });

  return { email: normalizedEmail, repository, matches };
}

export async function inviteGithubCollaborator(projectId: string, username: string): Promise<GithubInviteResult> {
  const normalizedUsername = username.trim();
  if (!/^[A-Za-z0-9-]+$/.test(normalizedUsername)) {
    throw new CollaborationError('Select a valid GitHub account before sending an invitation.', 'invalid_username', 400);
  }

  const { repository, token } = await getGithubContext(projectId);
  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/collaborators/${encodeURIComponent(normalizedUsername)}`,
      {
        method: 'PUT',
        headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission: 'pull' }),
      },
    );
  } catch {
    throw new CollaborationError('GitHub could not be reached. The invitation was not sent.', 'github_request_failed', 502);
  }

  if (!response.ok) {
    throw new CollaborationError('GitHub could not send the invitation. Check repository permissions and try again.', 'github_request_failed', 502);
  }

  return {
    username: normalizedUsername,
    repository,
    status: response.status === 200 ? 'already_collaborator' : 'invited',
  };
}
