import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { StoreIntegration } from '../../src/store/types.js';
import type {
  ConnectedArtifactVersionInput,
  ConnectedSource,
  ConnectedSourceItem,
  ConnectedSourceRepository,
  ConnectedSourceSyncRun,
  IntegrationCredential,
  NewConnectedSource,
  NewConnectedSourceItem,
  SyncSnapshot,
} from '../../src/integrations/types.js';
import { ConnectedSourceImporter } from '../../src/integrations/connectedSourceImporter.js';
import { ConnectedSourceHttpError } from '../../src/integrations/http.js';

const NOW = '2026-09-21T00:00:00.000Z';
const credentials: IntegrationCredential = {
  accessToken: 'provider-access-token',
  refreshToken: null,
  expiresAt: null,
  scopes: 'read',
};

function integration(): StoreIntegration {
  return {
    id: 'integration-1', ownerId: 'owner-1', provider: 'github', accountLabel: 'test-user', accountId: '42',
    scopes: 'read', tokenReference: `test:${JSON.stringify(credentials)}`, expiresAt: null,
    status: 'connected', createdAt: NOW, updatedAt: NOW,
  };
}

function connectedSource(): ConnectedSource {
  return {
    id: 'source-1', projectId: 'project-1', integrationId: 'integration-1', provider: 'github', kind: 'github_repository',
    remoteId: 'acme/quality', remoteUrl: 'https://github.com/acme/quality', name: 'acme/quality', selectedScope: { branch: 'main' },
    remoteRevision: null, syncCursor: null, status: 'active', syncStatus: 'idle', lastSyncedAt: null,
    lastSuccessfulSyncAt: null, lastError: null, createdAt: NOW, updatedAt: NOW,
  };
}

class MemoryConnectedSourceRepository implements ConnectedSourceRepository {
  integration = integration();
  source = connectedSource();
  items: ConnectedSourceItem[] = [];
  runs: ConnectedSourceSyncRun[] = [];
  versions = new Map<string, { id: string; hash: string; path: string }>();
  nextRunId = 1;

  async getIntegration(ownerId: string, provider: 'github' | 'google_drive' | 'slack'): Promise<StoreIntegration | null> {
    return ownerId === this.integration.ownerId && provider === this.integration.provider ? structuredClone(this.integration) : null;
  }

  async saveIntegration(input: StoreIntegration): Promise<void> { this.integration = structuredClone(input); }
  async listSources(projectId: string): Promise<ConnectedSource[]> { return projectId === this.source.projectId ? [structuredClone(this.source)] : []; }
  async getSource(projectId: string, sourceId: string): Promise<ConnectedSource | null> {
    return projectId === this.source.projectId && sourceId === this.source.id ? structuredClone(this.source) : null;
  }
  async saveSource(input: NewConnectedSource): Promise<ConnectedSource> {
    this.source = { ...this.source, ...structuredClone(input), remoteRevision: null, syncCursor: null, status: 'active', syncStatus: 'idle', lastSyncedAt: null, lastSuccessfulSyncAt: null, lastError: null };
    return structuredClone(this.source);
  }
  async updateSource(sourceId: string, patch: Partial<Pick<ConnectedSource, 'remoteRevision' | 'syncCursor' | 'status' | 'syncStatus' | 'lastSyncedAt' | 'lastSuccessfulSyncAt' | 'lastError'>>): Promise<ConnectedSource> {
    if (sourceId !== this.source.id) throw new Error('source missing');
    this.source = { ...this.source, ...structuredClone(patch) };
    return structuredClone(this.source);
  }
  async listSourceItems(sourceId: string): Promise<ConnectedSourceItem[]> { return sourceId === this.source.id ? structuredClone(this.items) : []; }
  async getSourceItem(sourceId: string, remoteId: string | null, path: string): Promise<ConnectedSourceItem | null> {
    return structuredClone(this.items.find(item => item.sourceId === sourceId && (remoteId ? item.remoteId === remoteId : item.path === path)) ?? null);
  }
  async saveSourceItem(input: NewConnectedSourceItem): Promise<ConnectedSourceItem> {
    const existingIndex = this.items.findIndex(item => item.sourceId === input.sourceId && (input.remoteId ? item.remoteId === input.remoteId : item.path === input.path));
    const previous = existingIndex < 0 ? null : this.items[existingIndex];
    const saved: ConnectedSourceItem = { ...structuredClone(input), id: previous?.id ?? `item-${this.items.length + 1}`, createdAt: previous?.createdAt ?? NOW, updatedAt: NOW };
    if (existingIndex < 0) this.items.push(saved); else this.items[existingIndex] = saved;
    return structuredClone(saved);
  }
  async markMissingItems(sourceId: string, seenRemoteIds: Set<string>): Promise<number> {
    let count = 0;
    this.items = this.items.map(item => {
      if (item.sourceId !== sourceId || item.status !== 'available' || item.remoteId == null || seenRemoteIds.has(item.remoteId)) return item;
      count++;
      return { ...item, status: 'removed', unavailableAt: NOW, updatedAt: NOW };
    });
    return count;
  }
  async markSourceItemsStatus(sourceId: string, status: 'available' | 'removed' | 'inaccessible' | 'unsupported', reason: string): Promise<number> {
    let count = 0;
    this.items = this.items.map(item => {
      if (item.sourceId !== sourceId || item.status === status) return item;
      count++;
      return { ...item, status, error: reason, unavailableAt: NOW, updatedAt: NOW };
    });
    return count;
  }
  async startSyncRun(source: ConnectedSource, idempotencyKey: string, snapshot?: SyncSnapshot | null): Promise<ConnectedSourceSyncRun> {
    const existing = this.runs.find(run => run.sourceId === source.id && run.idempotencyKey === idempotencyKey);
    if (existing) return structuredClone(existing);
    const run: ConnectedSourceSyncRun = {
      id: `run-${this.nextRunId++}`, projectId: source.projectId, sourceId: source.id, status: 'queued', idempotencyKey,
      remoteRevision: snapshot?.remoteRevision ?? null, cursorStart: structuredClone(snapshot?.cursor ?? null), cursorEnd: null,
      attemptCount: 0, importedCount: 0, updatedCount: 0, unchangedCount: 0, removedCount: 0, inaccessibleCount: 0,
      errorCode: null, errorMessage: null, retryable: false, startedAt: null, completedAt: null, createdAt: NOW,
    };
    this.runs.push(run);
    return structuredClone(run);
  }
  async listSyncRuns(sourceId: string): Promise<ConnectedSourceSyncRun[]> { return structuredClone(this.runs.filter(run => run.sourceId === sourceId)); }
  async getSyncRun(runId: string): Promise<ConnectedSourceSyncRun | null> { return structuredClone(this.runs.find(run => run.id === runId) ?? null); }
  async updateSyncRun(runId: string, patch: Partial<Pick<ConnectedSourceSyncRun, 'status' | 'remoteRevision' | 'cursorStart' | 'cursorEnd' | 'attemptCount' | 'importedCount' | 'updatedCount' | 'unchangedCount' | 'removedCount' | 'inaccessibleCount' | 'errorCode' | 'errorMessage' | 'retryable' | 'startedAt' | 'completedAt'>>): Promise<ConnectedSourceSyncRun> {
    const index = this.runs.findIndex(run => run.id === runId);
    if (index < 0) throw new Error('run missing');
    this.runs[index] = { ...this.runs[index]!, ...structuredClone(patch) };
    return structuredClone(this.runs[index]!);
  }
  async persistArtifactVersion(input: ConnectedArtifactVersionInput) {
    const hash = crypto.createHash('sha256').update(input.content).digest('hex');
    const key = `${input.path}:${hash}`;
    const existing = this.versions.get(key);
    const saved = existing ?? { id: `version-${this.versions.size + 1}`, hash, path: input.path };
    this.versions.set(key, saved);
    return { artifactId: `artifact-${input.path}`, artifactVersionId: saved.id, contentHash: hash, storagePath: `storage/${hash}`, unchanged: Boolean(existing) };
  }
  async disconnectIntegration(): Promise<void> { this.integration = { ...this.integration, status: 'disconnected', tokenReference: null }; }
}

function sourceAdapter(pages: Array<{ cursor: Record<string, unknown> | null; done: boolean; remoteRevision?: string }>) {
  let pageIndex = 0;
  return {
    provider: 'github' as const,
    listItemsCalls: () => pageIndex,
    async browse() { return { items: [], nextCursor: null }; },
    async prepareSync(): Promise<SyncSnapshot> { return { remoteRevision: 'commit-a', cursor: { page: 1 } }; },
    isSourceRevisionUnchanged(source: ConnectedSource, snapshot: SyncSnapshot) { return Boolean(source.lastSuccessfulSyncAt && source.remoteRevision === snapshot.remoteRevision); },
    async listItems(_token: IntegrationCredential, _source: ConnectedSource, snapshot: SyncSnapshot, cursor: Record<string, unknown> | null) {
      const page = pages[pageIndex++]!;
      const first = pageIndex === 1;
      return {
        items: first ? [{ remoteId: 'src/check.ts', path: 'src/check.ts', name: 'check.ts', mimeType: 'text/plain', revision: page.remoteRevision ?? 'blob-a', content: new TextEncoder().encode('const ok = true;'), metadata: { repository: 'acme/quality', branch: 'main', commitSha: snapshot.remoteRevision, remotePath: 'src/check.ts' } }] : [],
        nextCursor: page.cursor,
        done: page.done,
        completeSnapshot: page.done,
      };
    },
  };
}

describe('ConnectedSourceImporter', () => {
  it('requires Slack reauthorization when read scopes are missing', async () => {
    const repository = new MemoryConnectedSourceRepository();
    repository.integration = {
      ...repository.integration,
      provider: 'slack',
      scopes: 'channels:read channels:history',
      tokenReference: `test:${JSON.stringify({ ...credentials, scopes: 'channels:read channels:history' })}`,
    };
    const importer = new ConnectedSourceImporter({
      repository,
      adapters: [{ provider: 'slack', async browse() { return { items: [], nextCursor: null }; }, async prepareSync() { return { remoteRevision: null, cursor: null }; }, async listItems() { return { items: [], nextCursor: null, done: true }; } }],
      tokenVault: { encrypt: value => `test:${value}`, decrypt: value => value.replace(/^test:/, '') },
    });

    await expect(importer.status('owner-1', 'slack')).resolves.toMatchObject({ connected: false, status: 'reauthorization_required', reauthorizationRequired: true, missingScopes: ['groups:history', 'groups:read', 'users:read', 'files:read'] });
    await expect(importer.browse('owner-1', 'slack')).rejects.toMatchObject({ code: 'slack_missing_scope', statusCode: 403 });
  });

  it('imports artifact bytes with revision provenance and resumes a partial run', async () => {
    const repository = new MemoryConnectedSourceRepository();
    const adapter = sourceAdapter([{ cursor: { page: 2 }, done: false }, { cursor: null, done: true }]);
    const importer = new ConnectedSourceImporter({ repository, adapters: [adapter], tokenVault: { encrypt: value => `test:${value}`, decrypt: value => value.replace(/^test:/, '') } });

    const first = await importer.sync({ ownerId: 'owner-1', projectId: 'project-1', sourceId: 'source-1', idempotencyKey: 'sync-1', maxPages: 1 });
    expect(first.run.status).toBe('partial');
    expect(first.imported).toBe(1);
    expect(repository.items[0]?.metadata).toMatchObject({ repository: 'acme/quality', branch: 'main', commitSha: 'commit-a', remotePath: 'src/check.ts' });

    const resumed = await importer.resumeSync({ ownerId: 'owner-1', projectId: 'project-1', sourceId: 'source-1', runId: first.run.id });
    expect(resumed.complete).toBe(true);
    expect(resumed.run.status).toBe('success');
    expect(adapter.listItemsCalls()).toBe(2);
  });

  it('continues the latest partial run when Sync is clicked again with a new idempotency key', async () => {
    const repository = new MemoryConnectedSourceRepository();
    const pageCursors: Array<Record<string, unknown> | null> = [];
    const adapter = {
      provider: 'github' as const,
      async browse() { return { items: [], nextCursor: null }; },
      async prepareSync() { return { remoteRevision: 'commit-a', cursor: { treeSha: 'tree-a', offset: 0 } }; },
      isSourceRevisionUnchanged(source: ConnectedSource, snapshot: SyncSnapshot) {
        return Boolean(source.lastSuccessfulSyncAt && source.remoteRevision === snapshot.remoteRevision);
      },
      async listItems(_token: IntegrationCredential, _source: ConnectedSource, snapshot: SyncSnapshot, cursor: Record<string, unknown> | null) {
        pageCursors.push(structuredClone(cursor));
        const secondPage = cursor?.offset === 1;
        const path = secondPage ? 'src/two.ts' : 'src/one.ts';
        return {
          items: [{
            remoteId: path, path, name: path.split('/').pop()!, mimeType: 'text/plain', revision: path,
            content: new TextEncoder().encode(path), metadata: { commitSha: snapshot.remoteRevision },
          }],
          nextCursor: secondPage ? null : { treeSha: 'tree-a', offset: 1 },
          done: secondPage,
          completeSnapshot: secondPage,
        };
      },
    };
    const importer = new ConnectedSourceImporter({
      repository, adapters: [adapter],
      tokenVault: { encrypt: value => `test:${value}`, decrypt: value => value.replace(/^test:/, '') },
    });

    const first = await importer.sync({ ownerId: 'owner-1', projectId: 'project-1', sourceId: 'source-1', idempotencyKey: 'first-click', maxPages: 1 });
    expect(first.run.status).toBe('partial');
    expect(first.imported).toBe(1);

    // A completed sync for an earlier revision must not make this incomplete
    // snapshot look current just because the source now stores the new SHA.
    repository.source.lastSuccessfulSyncAt = '2026-09-20T00:00:00.000Z';
    const continued = await importer.sync({ ownerId: 'owner-1', projectId: 'project-1', sourceId: 'source-1', idempotencyKey: 'second-click' });

    expect(continued.run.id).toBe(first.run.id);
    expect(continued.run.status).toBe('success');
    expect(continued.imported).toBe(2);
    expect(repository.items.map(item => item.path).sort()).toEqual(['src/one.ts', 'src/two.ts']);
    expect(pageCursors).toEqual([{ treeSha: 'tree-a', offset: 0 }, { treeSha: 'tree-a', offset: 1 }]);
  });

  it('returns the prior result for a completed idempotency key without importing twice', async () => {
    const repository = new MemoryConnectedSourceRepository();
    const adapter = sourceAdapter([{ cursor: null, done: true }]);
    const importer = new ConnectedSourceImporter({ repository, adapters: [adapter], tokenVault: { encrypt: value => `test:${value}`, decrypt: value => value.replace(/^test:/, '') } });

    const first = await importer.sync({ ownerId: 'owner-1', projectId: 'project-1', sourceId: 'source-1', idempotencyKey: 'same-key' });
    const second = await importer.sync({ ownerId: 'owner-1', projectId: 'project-1', sourceId: 'source-1', idempotencyKey: 'same-key' });
    expect(second.run.id).toBe(first.run.id);
    expect(second.imported).toBe(1);
    expect(adapter.listItemsCalls()).toBe(1);
  });

  it('refreshes an expired token before browsing and persists only encrypted credentials', async () => {
    const repository = new MemoryConnectedSourceRepository();
    repository.integration = {
      ...repository.integration,
      expiresAt: '2026-09-20T23:00:00.000Z',
      tokenReference: `test:${JSON.stringify({ ...credentials, accessToken: 'old-token', refreshToken: 'refresh-token', expiresAt: '2026-09-20T23:00:00.000Z' })}`,
    };
    let observedToken = '';
    const importer = new ConnectedSourceImporter({
      repository,
      adapters: [{
        provider: 'github',
        async browse(token) { observedToken = token.accessToken; return { items: [], nextCursor: null }; },
        async prepareSync() { return { remoteRevision: null, cursor: null }; },
        async listItems() { return { items: [], nextCursor: null, done: true }; },
        async refreshCredentials() { return { ...credentials, accessToken: 'new-token', refreshToken: 'rotated-refresh', expiresAt: '2026-09-22T00:00:00.000Z' }; },
      }],
      tokenVault: {
        encrypt: value => `encrypted:${Buffer.from(value).toString('base64')}`,
        decrypt: value => value.startsWith('encrypted:') ? Buffer.from(value.slice('encrypted:'.length), 'base64').toString('utf8') : value.replace(/^test:/, ''),
      },
      now: () => NOW,
    });

    await importer.browse('owner-1', 'github');
    expect(observedToken).toBe('new-token');
    expect(repository.integration.status).toBe('connected');
    const persisted = JSON.parse(Buffer.from(repository.integration.tokenReference!.slice('encrypted:'.length), 'base64').toString('utf8')) as IntegrationCredential;
    expect(persisted).toMatchObject({ accessToken: 'new-token', refreshToken: 'rotated-refresh' });
    expect(repository.integration.tokenReference).not.toContain('new-token');
  });

  it('marks a rejected GitHub token expired and asks for reconnection', async () => {
    const repository = new MemoryConnectedSourceRepository();
    const importer = new ConnectedSourceImporter({
      repository,
      adapters: [{
        provider: 'github',
        async browse() { return { items: [], nextCursor: null }; },
        async prepareSync() { throw new ConnectedSourceHttpError('GitHub revision lookup request failed (HTTP 401).', { statusCode: 401, code: 'http_401' }); },
        async listItems() { return { items: [], nextCursor: null, done: true }; },
      }],
      tokenVault: { encrypt: value => `test:${value}`, decrypt: value => value.replace(/^test:/, '') },
      now: () => NOW,
    });

    await expect(importer.sync({ ownerId: 'owner-1', projectId: 'project-1', sourceId: 'source-1' })).rejects.toThrow('Reconnect GitHub');
    expect(repository.integration.status).toBe('expired');
    expect(repository.source.lastError).toContain('Reconnect GitHub');
    expect(repository.runs[0]?.errorCode).toBe('http_401');
  });

  it('retries provider rate limits and records removed items from a complete snapshot', async () => {
    const repository = new MemoryConnectedSourceRepository();
    let failOnce = true;
    const retryingAdapter = {
      provider: 'github' as const,
      async browse() { return { items: [], nextCursor: null }; },
      async prepareSync() { return { remoteRevision: 'commit-1', cursor: { page: 1 } }; },
      async listItems() {
        if (failOnce) { failOnce = false; throw new ConnectedSourceHttpError('rate limited', { statusCode: 429, retryable: true, code: 'http_429' }); }
        return {
          items: [{ remoteId: 'src/check.ts', path: 'src/check.ts', name: 'check.ts', mimeType: 'text/plain', revision: 'blob-a', content: new TextEncoder().encode('const ok = true;'), metadata: { remotePath: 'src/check.ts' } }],
          nextCursor: null, done: true, completeSnapshot: true,
        };
      },
    };
    const importer = new ConnectedSourceImporter({
      repository, adapters: [retryingAdapter], tokenVault: { encrypt: value => `test:${value}`, decrypt: value => value.replace(/^test:/, '') },
      maxRetries: 1, retryDelayMs: 0, sleep: async () => {},
    });
    await importer.sync({ ownerId: 'owner-1', projectId: 'project-1', sourceId: 'source-1', idempotencyKey: 'first' });
    expect(repository.items[0]?.status).toBe('available');

    const emptyAdapter = {
      provider: 'github' as const,
      async browse() { return { items: [], nextCursor: null }; },
      async prepareSync() { return { remoteRevision: 'commit-2', cursor: { page: 1 } }; },
      async listItems() { return { items: [], nextCursor: null, done: true, completeSnapshot: true }; },
    };
    const secondImporter = new ConnectedSourceImporter({ repository, adapters: [emptyAdapter], tokenVault: { encrypt: value => `test:${value}`, decrypt: value => value.replace(/^test:/, '') } });
    const second = await secondImporter.sync({ ownerId: 'owner-1', projectId: 'project-1', sourceId: 'source-1', idempotencyKey: 'second' });
    expect(second.removed).toBe(1);
    expect(repository.items[0]?.status).toBe('removed');
  });

  it('skips GitHub tree and blob processing when a completed commit revision is unchanged', async () => {
    const repository = new MemoryConnectedSourceRepository();
    const adapter = sourceAdapter([{ cursor: null, done: true }]);
    const importer = new ConnectedSourceImporter({ repository, adapters: [adapter], tokenVault: { encrypt: value => `test:${value}`, decrypt: value => value.replace(/^test:/, '') } });

    const first = await importer.sync({ ownerId: 'owner-1', projectId: 'project-1', sourceId: 'source-1', idempotencyKey: 'revision-a' });
    const second = await importer.sync({ ownerId: 'owner-1', projectId: 'project-1', sourceId: 'source-1', idempotencyKey: 'revision-a-again' });
    expect(first.imported).toBe(1);
    expect(second.unchanged).toBe(1);
    expect(adapter.listItemsCalls()).toBe(1);
  });

  it('exposes route-ready source registration, status, and sync history without credentials', async () => {
    const repository = new MemoryConnectedSourceRepository();
    const adapter = sourceAdapter([]);
    const importer = new ConnectedSourceImporter({ repository, adapters: [adapter], tokenVault: { encrypt: value => `test:${value}`, decrypt: value => value.replace(/^test:/, '') } });

    const imported = await importer.importSource({ ownerId: 'owner-1', projectId: 'project-1', provider: 'github', kind: 'github_repository', remoteId: 'acme/quality', name: 'acme/quality', sync: false });
    const status = await importer.status('owner-1', 'github', 'project-1');
    expect(imported.source.remoteId).toBe('acme/quality');
    expect(imported.syncResult).toBeNull();
    expect(status).toMatchObject({ provider: 'github', connected: true, accountLabel: 'test-user', scopes: ['read'] });
    expect(status).not.toHaveProperty('tokenReference');
    expect(await importer.syncHistory('project-1', imported.source.id)).toEqual([]);
  });
});
