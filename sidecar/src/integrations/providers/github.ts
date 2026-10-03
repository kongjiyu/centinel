import type { IntegrationCredential, BrowseOptions, BrowsePage, ConnectedSource, ConnectedSourceProviderAdapter, RemoteContent, RemoteSyncPage, SyncSnapshot } from '../types.js';
import { bearerHeaders, requestJson, requestResponse, urlWithQuery, type SourceHttpClient, fetchSourceHttpClient } from '../http.js';
import { ConnectedSourceHttpError } from '../http.js';

type GitHubOptions = { http?: SourceHttpClient; env?: NodeJS.ProcessEnv; maxFileBytes?: number; pageSize?: number };
type GitHubRepo = { id: number; full_name: string; name: string; html_url: string; default_branch: string; private: boolean; description?: string | null; pushed_at?: string };
type GitHubBranch = { name: string; commit: { sha: string } };
type GitHubTreeEntry = { path: string; type: string; mode: string; sha: string; size?: number; url: string };

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs', '.java', '.cs', '.rb', '.php', '.sh', '.sql', '.toml', '.ini', '.csv', '.svg', '.c', '.h', '.cpp', '.properties']);

function repoPath(remoteId: string): string {
  const parts = remoteId.split('/');
  if (parts.length !== 2 || parts.some(part => !part || part === '.' || part === '..')) throw new Error('GitHub repository id must be owner/repository.');
  return `${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`;
}

function cursorNumber(cursor: string | null | undefined): number {
  const value = Number(cursor ?? 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function oauthClient(env: NodeJS.ProcessEnv): { clientId: string; clientSecret: string } {
  const clientId = env.GITHUB_REPO_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_REPO_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error('GitHub repository OAuth is not configured.');
  return { clientId, clientSecret };
}

async function maybeRefresh(credentials: IntegrationCredential, http: SourceHttpClient, env: NodeJS.ProcessEnv): Promise<IntegrationCredential | null> {
  if (!credentials.refreshToken) return null;
  const { clientId, clientSecret } = oauthClient(env);
  const response = await requestResponse(http, 'https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: credentials.refreshToken }),
  }, 'GitHub OAuth refresh');
  const body = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; scope?: string; error?: string };
  if (!body.access_token) return null;
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? credentials.refreshToken,
    expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : credentials.expiresAt,
    scopes: body.scope ?? credentials.scopes,
  };
}

export class GitHubConnectedSourceAdapter implements ConnectedSourceProviderAdapter {
  readonly provider = 'github' as const;
  private readonly http: SourceHttpClient;
  private readonly env: NodeJS.ProcessEnv;
  private readonly maxFileBytes: number;
  private readonly pageSize: number;
  private readonly treeCache = new Map<string, GitHubTreeEntry[]>();

  constructor(options: GitHubOptions = {}) {
    this.http = options.http ?? fetchSourceHttpClient;
    this.env = options.env ?? process.env;
    this.maxFileBytes = options.maxFileBytes ?? 2 * 1024 * 1024;
    this.pageSize = Math.max(1, Math.min(100, options.pageSize ?? 40));
  }

  private headers(token: string): Record<string, string> {
    return bearerHeaders(token, { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Centinel' });
  }

  async browse(credentials: IntegrationCredential, options: BrowseOptions = {}): Promise<BrowsePage> {
    const page = cursorNumber(options.cursor);
    const perPage = Math.max(1, Math.min(100, options.pageSize ?? 100));
    if (options.remoteId) {
      const remote = repoPath(options.remoteId);
      const rows = await requestJson<GitHubBranch[]>(this.http, urlWithQuery(`https://api.github.com/repos/${remote}/branches`, { per_page: perPage, page }), { headers: this.headers(credentials.accessToken) }, 'GitHub branches');
      return {
        items: rows.map(branch => ({ id: branch.name, name: branch.name, kind: 'branch', revision: branch.commit.sha, metadata: { repository: options.remoteId } })),
        nextCursor: rows.length >= perPage ? String(page + 1) : null,
      };
    }
    const rows = await requestJson<GitHubRepo[]>(this.http, urlWithQuery('https://api.github.com/user/repos', { sort: 'updated', per_page: perPage, page, affiliation: 'owner,collaborator,organization_member' }), { headers: this.headers(credentials.accessToken) }, 'GitHub repositories');
    const query = options.query?.trim().toLowerCase();
    return {
      items: rows.filter(repo => !query || repo.full_name.toLowerCase().includes(query) || repo.name.toLowerCase().includes(query)).map(repo => ({
        id: repo.full_name, name: repo.full_name, kind: 'repository', remoteUrl: repo.html_url,
        revision: repo.default_branch,
        metadata: { private: repo.private, defaultBranch: repo.default_branch, description: repo.description ?? '', pushedAt: repo.pushed_at ?? null },
      })),
      nextCursor: rows.length >= perPage ? String(page + 1) : null,
    };
  }

  async prepareSync(credentials: IntegrationCredential, source: ConnectedSource): Promise<SyncSnapshot> {
    const remote = repoPath(source.remoteId);
    const pullRequest = Number(source.selectedScope.pullRequestNumber);
    let revisionUrl: string;
    if (Number.isInteger(pullRequest) && pullRequest > 0) {
      revisionUrl = `https://api.github.com/repos/${remote}/pulls/${pullRequest}`;
    } else {
      let branch = typeof source.selectedScope.branch === 'string' ? source.selectedScope.branch.trim() : '';
      if (!branch) {
        const repository = await requestJson<Pick<GitHubRepo, 'default_branch'>>(
          this.http,
          `https://api.github.com/repos/${remote}`,
          { headers: this.headers(credentials.accessToken) },
          'GitHub repository lookup',
        );
        branch = repository.default_branch?.trim() ?? '';
      }
      if (!branch) throw new ConnectedSourceHttpError('GitHub did not return a default branch.', { code: 'missing_default_branch' });
      revisionUrl = `https://api.github.com/repos/${remote}/commits/${encodeURIComponent(branch)}`;
    }
    const revision = await requestJson<{ sha?: string; head?: { sha?: string } }>(this.http, revisionUrl, { headers: this.headers(credentials.accessToken) }, 'GitHub revision lookup');
    const commitSha = revision.head?.sha ?? revision.sha;
    if (!commitSha) throw new ConnectedSourceHttpError('GitHub did not return a source revision.', { code: 'missing_revision' });
    const commit = await requestJson<{ tree?: { sha?: string } }>(this.http, `https://api.github.com/repos/${remote}/git/commits/${encodeURIComponent(commitSha)}`, { headers: this.headers(credentials.accessToken) }, 'GitHub tree lookup');
    const treeSha = commit.tree?.sha;
    if (!treeSha) throw new ConnectedSourceHttpError('GitHub did not return a repository tree.', { code: 'missing_tree' });
    return { remoteRevision: commitSha, cursor: { treeSha, offset: 0 } };
  }

  isSourceRevisionUnchanged(source: ConnectedSource, snapshot: SyncSnapshot): boolean {
    return Boolean(source.remoteRevision && snapshot.remoteRevision && source.remoteRevision === snapshot.remoteRevision && source.lastSuccessfulSyncAt);
  }

  async listItems(credentials: IntegrationCredential, source: ConnectedSource, snapshot: SyncSnapshot, cursor: Record<string, unknown> | null): Promise<RemoteSyncPage> {
    const remote = repoPath(source.remoteId);
    const treeSha = String(cursor?.treeSha ?? snapshot.cursor?.treeSha ?? '');
    const offset = Number(cursor?.offset ?? 0);
    if (!treeSha || !Number.isInteger(offset) || offset < 0) throw new Error('GitHub sync cursor is invalid.');
    const cacheKey = `${source.remoteId}:${treeSha}`;
    let entries = this.treeCache.get(cacheKey);
    if (!entries) {
      entries = await this.readTree(credentials, remote, treeSha);
      this.treeCache.set(cacheKey, entries);
      while (this.treeCache.size > 4) this.treeCache.delete(this.treeCache.keys().next().value!);
    }
    const files = entries.filter(item => item.type === 'blob').filter(item => TEXT_EXTENSIONS.has(item.path.slice(item.path.lastIndexOf('.')).toLowerCase()));
    const page = files.slice(offset, offset + this.pageSize);
    const items = await Promise.all(page.map(async file => {
      if ((file.size ?? 0) > this.maxFileBytes) {
        return { remoteId: file.path, path: file.path, name: file.path.split('/').pop() ?? file.path, mimeType: 'application/octet-stream', revision: file.sha, content: new Uint8Array(), status: 'unsupported' as const, error: `File exceeds the ${this.maxFileBytes} byte import limit.`, metadata: { repository: source.remoteId, branch: source.selectedScope.branch ?? null, commitSha: snapshot.remoteRevision, remotePath: file.path, blobSha: file.sha, size: file.size ?? null } } satisfies RemoteContent;
      }
      const blob = await requestJson<{ content?: string; encoding?: string; size?: number }>(this.http, `https://api.github.com/repos/${remote}/git/blobs/${encodeURIComponent(file.sha)}`, { headers: this.headers(credentials.accessToken) }, 'GitHub file content');
      const bytes = blob.encoding === 'base64' ? Buffer.from((blob.content ?? '').replace(/\s/g, ''), 'base64') : Buffer.from(blob.content ?? '', 'utf8');
      if (bytes.byteLength > this.maxFileBytes) {
        return { remoteId: file.path, path: file.path, name: file.path.split('/').pop() ?? file.path, mimeType: 'application/octet-stream', revision: file.sha, content: new Uint8Array(), status: 'unsupported', error: `File exceeds the ${this.maxFileBytes} byte import limit.`, metadata: { repository: source.remoteId, branch: source.selectedScope.branch ?? null, commitSha: snapshot.remoteRevision, remotePath: file.path, blobSha: file.sha, size: bytes.byteLength } } satisfies RemoteContent;
      }
      const mimeType = file.path.toLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain';
      return {
        remoteId: file.path, path: file.path, name: file.path.split('/').pop() ?? file.path, mimeType,
        revision: file.sha, content: bytes,
        metadata: { repository: source.remoteId, branch: source.selectedScope.branch ?? null, commitSha: snapshot.remoteRevision, remotePath: file.path, blobSha: file.sha, size: file.size ?? bytes.byteLength, pullRequestNumber: source.selectedScope.pullRequestNumber ?? null },
      } satisfies RemoteContent;
    }));
    const nextOffset = offset + page.length;
    const done = nextOffset >= files.length;
    return { items, nextCursor: done ? null : { treeSha, offset: nextOffset }, done, completeSnapshot: done };
  }

  private async readTree(credentials: IntegrationCredential, remote: string, treeSha: string, prefix = '', depth = 0): Promise<GitHubTreeEntry[]> {
    if (depth > 24) throw new ConnectedSourceHttpError('GitHub repository tree nesting exceeds the import limit.', { code: 'tree_depth_limit' });
    const endpoint = `https://api.github.com/repos/${remote}/git/trees/${encodeURIComponent(treeSha)}`;
    const recursive = await requestJson<{ tree?: GitHubTreeEntry[]; truncated?: boolean }>(this.http, `${endpoint}?recursive=1`, { headers: this.headers(credentials.accessToken) }, 'GitHub source tree');
    if (!recursive.truncated) return (recursive.tree ?? []).map(entry => ({ ...entry, path: prefix ? `${prefix}/${entry.path}` : entry.path }));

    // GitHub truncates recursive trees at its response ceiling. Walk shallow
    // child trees instead of silently reconciling an incomplete snapshot.
    const shallow = await requestJson<{ tree?: GitHubTreeEntry[]; truncated?: boolean }>(this.http, endpoint, { headers: this.headers(credentials.accessToken) }, 'GitHub source tree');
    if (shallow.truncated) throw new ConnectedSourceHttpError('GitHub returned a truncated top-level tree. Select a smaller repository scope.', { code: 'tree_truncated' });
    const entries: GitHubTreeEntry[] = [];
    for (const entry of shallow.tree ?? []) {
      const path = prefix ? `${prefix}/${entry.path}` : entry.path;
      if (entry.type === 'tree') entries.push(...await this.readTree(credentials, remote, entry.sha, path, depth + 1));
      else entries.push({ ...entry, path });
    }
    return entries;
  }

  async refreshCredentials(credentials: IntegrationCredential): Promise<IntegrationCredential | null> {
    return maybeRefresh(credentials, this.http, this.env);
  }

  async revokeCredentials(credentials: IntegrationCredential): Promise<boolean> {
    const { clientId, clientSecret } = oauthClient(this.env);
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await this.http.fetch(`https://api.github.com/applications/${encodeURIComponent(clientId)}/grant`, {
      method: 'DELETE', headers: { Authorization: `Basic ${basic}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: credentials.accessToken }),
    });
    return response.ok || response.status === 404;
  }
}

export function createGitHubAdapter(options: GitHubOptions = {}): GitHubConnectedSourceAdapter {
  return new GitHubConnectedSourceAdapter(options);
}
