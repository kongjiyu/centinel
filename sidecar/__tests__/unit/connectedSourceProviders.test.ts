import { describe, expect, it } from 'vitest';
import type { SourceHttpClient } from '../../src/integrations/http.js';
import { GitHubConnectedSourceAdapter } from '../../src/integrations/providers/github.js';
import { GoogleDriveConnectedSourceAdapter } from '../../src/integrations/providers/googleDrive.js';
import { SlackConnectedSourceAdapter } from '../../src/integrations/providers/slack.js';
import type { ConnectedSource, IntegrationCredential } from '../../src/integrations/types.js';

const credentials: IntegrationCredential = { accessToken: 'fake-token', refreshToken: null, expiresAt: null, scopes: 'read' };

const source: ConnectedSource = {
  id: 'source-1', projectId: 'project-1', integrationId: 'integration-1', provider: 'github', kind: 'github_repository',
  remoteId: 'acme/demo', remoteUrl: 'https://github.com/acme/demo', name: 'acme/demo', selectedScope: { branch: 'main' },
  remoteRevision: null, syncCursor: null, status: 'active', syncStatus: 'idle', lastSyncedAt: null, lastSuccessfulSyncAt: null,
  lastError: null, createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
};

class FakeHttp implements SourceHttpClient {
  calls: Array<{ url: string; init?: RequestInit }> = [];
  constructor(private readonly replies: Response[]) {}
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    this.calls.push({ url: String(input), init });
    const response = this.replies.shift();
    if (!response) throw new Error(`Unexpected HTTP request: ${String(input)}`);
    return response;
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('connected source provider adapters', () => {
  it('browses GitHub repositories and imports a text blob with commit and path provenance', async () => {
    const http = new FakeHttp([
      json([{ id: 1, full_name: 'acme/demo', name: 'demo', html_url: 'https://github.com/acme/demo', default_branch: 'main', private: true }]),
      json({ sha: 'commit-a' }),
      json({ tree: { sha: 'tree-a' } }),
      json({ tree: [{ path: 'src/app.ts', type: 'blob', mode: '100644', sha: 'blob-a', size: 5, url: 'https://api.github.com/blobs/blob-a' }] }),
      json({ content: Buffer.from('const x').toString('base64'), encoding: 'base64', size: 7 }),
    ]);
    const adapter = new GitHubConnectedSourceAdapter({ http });

    const browse = await adapter.browse(credentials);
    expect(browse.items[0]).toMatchObject({ id: 'acme/demo', kind: 'repository', metadata: { private: true, defaultBranch: 'main' } });
    const snapshot = await adapter.prepareSync(credentials, source);
    const page = await adapter.listItems(credentials, source, snapshot, snapshot.cursor);
    expect(page.items[0]).toMatchObject({ remoteId: 'src/app.ts', path: 'src/app.ts', revision: 'blob-a', metadata: { commitSha: 'commit-a', remotePath: 'src/app.ts', blobSha: 'blob-a' } });
    expect(Buffer.from(page.items[0]!.content).toString('utf8')).toBe('const x');
    expect(http.calls[0]?.init?.headers).toMatchObject({ Authorization: 'Bearer fake-token' });
  });

  it('reads the tree SHA from the GitHub Git commit response', async () => {
    const http = new FakeHttp([
      json({ sha: 'commit-a' }),
      json({ sha: 'commit-a', tree: { sha: 'tree-a' } }),
    ]);
    const adapter = new GitHubConnectedSourceAdapter({ http });

    await expect(adapter.prepareSync(credentials, source)).resolves.toEqual({ remoteRevision: 'commit-a', cursor: { treeSha: 'tree-a', offset: 0 } });
  });

  it('resolves the repository default branch when a GitHub project source has no selected branch', async () => {
    const http = new FakeHttp([
      json({ default_branch: 'develop' }),
      json({ sha: 'commit-develop' }),
      json({ sha: 'commit-develop', tree: { sha: 'tree-develop' } }),
    ]);
    const adapter = new GitHubConnectedSourceAdapter({ http });

    await expect(adapter.prepareSync(credentials, { ...source, selectedScope: {} })).resolves.toEqual({
      remoteRevision: 'commit-develop', cursor: { treeSha: 'tree-develop', offset: 0 },
    });
    expect(new URL(http.calls[0]!.url).pathname).toBe('/repos/acme/demo');
    expect(new URL(http.calls[1]!.url).pathname).toBe('/repos/acme/demo/commits/develop');
  });

  it('exports a selected Google spreadsheet and retains its Drive revision', async () => {
    const http = new FakeHttp([
      json({ startPageToken: 'drive-start' }),
      json({ id: 'file-1', name: 'control-matrix', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-09-20T10:00:00Z', headRevisionId: 'rev-8', webViewLink: 'https://drive.google.com/file/d/file-1' }),
      new Response('id,control\n1,approve', { status: 200 }),
    ]);
    const adapter = new GoogleDriveConnectedSourceAdapter({ http });
    const driveSource: ConnectedSource = { ...source, provider: 'google_drive', kind: 'google_drive', remoteId: 'file-1', selectedScope: { resourceKind: 'file' } };

    const snapshot = await adapter.prepareSync(credentials, driveSource);
    const page = await adapter.listItems(credentials, driveSource, snapshot, snapshot.cursor);
    expect(page.completeSnapshot).toBe(true);
    expect(page.items[0]).toMatchObject({ remoteId: 'file-1', name: 'control-matrix.csv', mimeType: 'text/csv', revision: 'rev-8', metadata: { fileId: 'file-1', exportMimeType: 'text/csv', headRevisionId: 'rev-8' } });
    expect(Buffer.from(page.items[0]!.content).toString('utf8')).toContain('approve');
    expect(decodeURIComponent(http.calls[2]!.url)).toContain('mimeType=text/csv');
  });

  it('recursively baselines a folder discovered by the Google Drive changes feed', async () => {
    const http = new FakeHttp([
      json({ changes: [{ fileId: 'folder-new', file: { id: 'folder-new', name: 'New controls', mimeType: 'application/vnd.google-apps.folder', parents: ['folder-root'] } }], newStartPageToken: 'drive-next' }),
      json({ files: [{ id: 'doc-new', name: 'approval.txt', mimeType: 'text/plain', modifiedTime: '2026-09-22T10:00:00Z', parents: ['folder-new'] }] }),
      new Response('two reviewers required', { status: 200 }),
    ]);
    const adapter = new GoogleDriveConnectedSourceAdapter({ http });
    const driveSource: ConnectedSource = {
      ...source,
      provider: 'google_drive', kind: 'google_drive', remoteId: 'folder-root', selectedScope: { resourceKind: 'folder' },
      syncCursor: { mode: 'changes', pageToken: 'drive-current', folderIds: ['folder-root'] },
    };

    const changes = await adapter.listItems(credentials, driveSource, { remoteRevision: null, cursor: driveSource.syncCursor }, driveSource.syncCursor);
    expect(changes.done).toBe(false);
    expect(changes.nextCursor).toMatchObject({ mode: 'baseline', startPageToken: 'drive-next', activeFolder: 'folder-new', folderIds: ['folder-root', 'folder-new'] });

    const baseline = await adapter.listItems(credentials, driveSource, { remoteRevision: null, cursor: changes.nextCursor }, changes.nextCursor);
    expect(baseline.items[0]).toMatchObject({ remoteId: 'doc-new', name: 'approval.txt' });
    expect(Buffer.from(baseline.items[0]!.content).toString('utf8')).toBe('two reviewers required');
    expect(baseline.nextCursor).toMatchObject({ mode: 'changes', pageToken: 'drive-next', folderIds: ['folder-root', 'folder-new'] });
  });

  it('browses Slack channels and preserves workspace, message, author, timestamp, and permalink provenance', async () => {
    const http = new FakeHttp([
      json({ ok: true, channels: [{ id: 'C123', name: 'release-planning', is_private: true, num_members: 4 }] }),
      json({ ok: true, team_id: 'T123', team: 'Acme', url: 'https://acme.slack.com/' }),
      json({ ok: true, messages: [{ user: 'U123', ts: '1789999999.000001', text: 'Ship *safely* <https://example.com|today>' }], has_more: false }),
    ]);
    const adapter = new SlackConnectedSourceAdapter({ http });
    const browse = await adapter.browse(credentials);
    expect(browse.items[0]).toMatchObject({ id: 'C123', name: '#release-planning', kind: 'channel', metadata: { isPrivate: true } });
    const slackSource: ConnectedSource = { ...source, provider: 'slack', kind: 'slack_channel', remoteId: 'C123', name: '#release-planning', selectedScope: { workspaceId: 'T123', channelName: 'release-planning' } };
    const snapshot = await adapter.prepareSync(credentials, slackSource);
    const page = await adapter.listItems(credentials, slackSource, snapshot, snapshot.cursor);
    expect(page.items[0]).toMatchObject({ remoteId: 'C123:1789999999.000001', mimeType: 'text/markdown', metadata: { workspaceId: 'T123', channelId: 'C123', authorId: 'U123', messageTs: '1789999999.000001', permalink: 'https://acme.slack.com/archives/C123/p1789999999000001' } });
    expect(Buffer.from(page.items[0]!.content).toString('utf8')).toContain('**safely**');
    expect(page.completeSnapshot).toBe(true);
  });

  it('periodically performs a bounded Slack full reconciliation for edits, deletions, and older replies', async () => {
    const http = new FakeHttp([
      json({ ok: true, team_id: 'T123', team: 'Acme', url: 'https://acme.slack.com/' }),
      json({ ok: true, messages: [{ user: 'U123', ts: '1700000000.000001', text: 'Edited policy text' }], has_more: false }),
    ]);
    const now = Date.parse('2026-09-22T12:00:00.000Z');
    const adapter = new SlackConnectedSourceAdapter({ http, now: () => now, fullReconciliationIntervalMs: 60_000 });
    const slackSource: ConnectedSource = {
      ...source, provider: 'slack', kind: 'slack_channel', remoteId: 'C123', name: '#release-planning',
      selectedScope: { workspaceId: 'T123', channelName: 'release-planning' },
      syncCursor: { mode: 'incremental', newestTs: '1800000000.000001', lastFullReconciliationAt: '2026-09-22T10:00:00.000Z', workspaceId: 'T123' },
    };

    const snapshot = await adapter.prepareSync(credentials, slackSource);
    expect(snapshot.cursor).toMatchObject({ mode: 'baseline', oldest: null });
    const page = await adapter.listItems(credentials, slackSource, snapshot, snapshot.cursor);

    expect(page.completeSnapshot).toBe(true);
    expect(page.nextCursor).toMatchObject({ mode: 'incremental', lastFullReconciliationAt: '2026-09-22T12:00:00.000Z' });
    const historyUrl = new URL(http.calls[1]!.url);
    expect(historyUrl.searchParams.has('oldest')).toBe(false);
    expect(Buffer.from(page.items[0]!.content).toString('utf8')).toContain('Edited policy text');
  });
});
