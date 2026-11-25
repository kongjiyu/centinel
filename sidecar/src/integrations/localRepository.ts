import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { detectArtifactType, type Artifact } from '../artifacts.js';
import { compactCanonicalJson } from '../report/canonical.js';
import type { LocalWorkspace } from '../store/localWorkspace.js';
import type { StoreIntegration } from '../store/types.js';
import { ConnectedSourceImporterError } from './connectedSourceImporter.js';
import type { IntegrationProvider } from './oauthConfig.js';
import { safeArtifactPath } from './supabaseRepository.js';
import type { ConnectedArtifactVersionInput, ConnectedSource, ConnectedSourceItem, ConnectedSourceItemStatus,
  ConnectedSourceRepository, ConnectedSourceSyncRun, ConnectedSourceSyncRunPatch, NewConnectedSource, NewConnectedSourceItem } from './types.js';

export const localConnectedSourceSchema = `
  CREATE TABLE IF NOT EXISTS local_connected_source (
    owner TEXT NOT NULL, id TEXT NOT NULL, project TEXT NOT NULL, provider TEXT NOT NULL, remote TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, id), UNIQUE (owner, project, provider, remote),
    FOREIGN KEY (owner, project) REFERENCES project(owner, id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS local_connected_item (
    owner TEXT NOT NULL, source TEXT NOT NULL, id TEXT NOT NULL, remote TEXT, path TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, source, id), UNIQUE (owner, source, remote),
    FOREIGN KEY (owner, source) REFERENCES local_connected_source(owner, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_connected_item_path ON local_connected_item (owner, source, path);
  CREATE INDEX IF NOT EXISTS local_connected_item_artifact ON local_connected_item (owner, source, json_extract(payload, '$.artifactId'));
  CREATE TABLE IF NOT EXISTS local_connected_run (
    owner TEXT NOT NULL, id TEXT NOT NULL, source TEXT NOT NULL, request TEXT NOT NULL, created TEXT NOT NULL,
    lease TEXT, expires TEXT, payload TEXT NOT NULL,
    PRIMARY KEY (owner, id), UNIQUE (owner, source, request),
    FOREIGN KEY (owner, source) REFERENCES local_connected_source(owner, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_connected_run_order ON local_connected_run (owner, source, created DESC, id DESC);
`;

type Accounts = Pick<ConnectedSourceRepository, 'getIntegration' | 'saveIntegration' | 'disconnectIntegration'>;
type Row = Record<string, unknown>;
const decode = <T>(row: Row | undefined): T | null => row ? JSON.parse(String(row.payload)) as T : null;
const now = () => new Date().toISOString();
const recoverable = new Set(['queued', 'running', 'partial']);
export type ConnectedSourceSnapshot = { sources: ConnectedSource[]; items: ConnectedSourceItem[]; runs: ConnectedSourceSyncRun[] };

export class LocalConnectedSourceRepository implements ConnectedSourceRepository {
  private claim?: { runId: string; sourceId: string; token: string };
  constructor(private readonly db: DatabaseSync, private readonly workspace: LocalWorkspace, private readonly owner: string,
    private readonly accounts?: Accounts) {}

  async getIntegration(owner: string, provider: IntegrationProvider) {
    if (owner !== this.owner || !this.accounts) return null;
    return this.accounts.getIntegration(owner, provider);
  }

  async saveIntegration(input: StoreIntegration) {
    if (input.ownerId !== this.owner || !this.accounts) throw new Error('App Connection is unavailable.');
    await this.accounts.saveIntegration(input);
  }

  async disconnectIntegration(owner: string, provider: IntegrationProvider) {
    if (owner !== this.owner || !this.accounts) throw new Error('App Connection is unavailable.');
    await this.accounts.disconnectIntegration(owner, provider);
    this.transaction(() => {
      for (const row of this.db.prepare('SELECT payload FROM local_connected_source WHERE owner = ? AND provider = ?').all(owner, provider)) {
        const source = decode<ConnectedSource>(row)!;
        this.cancelRuns(source.id);
        this.writeSource({ ...source, status: 'disconnected', syncStatus: 'idle', lastError: null, updatedAt: now() });
      }
    });
  }

  listProjectSources(project: string) {
    const rows = this.db.prepare('SELECT payload FROM local_connected_source WHERE owner = ? AND project = ? ORDER BY id').all(this.owner, project);
    return rows.map(row => {
      const source = decode<ConnectedSource>(row)!;
      return { ...source, latestSyncRun: this.latest(source.id) };
    });
  }

  async listSources(project: string) { return this.listProjectSources(project); }

  async getSource(project: string, source: string) {
    const found = this.source(source);
    return found?.projectId === project ? found : null;
  }

  async saveSource(input: NewConnectedSource) {
    return this.transaction(() => {
      const existing = decode<ConnectedSource>(this.db.prepare(`SELECT payload FROM local_connected_source
        WHERE owner = ? AND project = ? AND provider = ? AND remote = ?`).get(this.owner, input.projectId, input.provider, input.remoteId));
      const changed = existing && (compactCanonicalJson(existing.selectedScope) !== compactCanonicalJson(input.selectedScope)
        || existing.integrationId !== input.integrationId);
      const reactivated = existing && existing.status !== 'active';
      if (existing && (changed || reactivated)) this.cancelRuns(existing.id);
      return this.writeSource({ ...input, id: existing?.id ?? randomUUID(), status: 'active',
        syncStatus: changed || reactivated ? 'idle' : existing?.syncStatus ?? 'idle',
        remoteRevision: changed ? null : existing?.remoteRevision ?? null, syncCursor: changed ? null : existing?.syncCursor ?? null,
        lastSuccessfulSyncAt: changed ? null : existing?.lastSuccessfulSyncAt ?? null,
        lastSyncedAt: changed ? null : existing?.lastSyncedAt ?? null, lastError: changed || reactivated ? null : existing?.lastError ?? null,
        createdAt: existing?.createdAt ?? now(), updatedAt: now() });
    });
  }

  async updateSource(id: string, patch: Parameters<ConnectedSourceRepository['updateSource']>[1]) {
    return this.transaction(() => {
      const source = this.requireSource(id);
      if (patch.status !== 'disconnected') this.assertCurrentClaim(id, true);
      if (source.status === 'disconnected' && patch.status !== 'disconnected') throw new Error('The connected source is disconnected.');
      if (patch.status === 'disconnected') this.cancelRuns(id);
      return this.writeSource({ ...source, ...patch, updatedAt: now() });
    });
  }

  listItems(id: string): ConnectedSourceItem[] {
    return this.db.prepare('SELECT payload FROM local_connected_item WHERE owner = ? AND source = ? ORDER BY path, id')
      .all(this.owner, id).map(row => decode<ConnectedSourceItem>(row)!);
  }

  async listSourceItems(id: string) { return this.listItems(id); }

  async getSourceItem(id: string, remote: string | null, path: string) { return this.item(id, remote, path); }

  async saveSourceItem(input: NewConnectedSourceItem) {
    this.assertCurrentClaim(input.sourceId);
    if (this.requireSource(input.sourceId).projectId !== input.projectId) throw new Error('Connected item scope mismatch.');
    return this.transaction(() => this.writeItem(input));
  }

  async markMissingItems(id: string, seen: Set<string>) {
    this.assertCurrentClaim(id);
    return this.transaction(() => this.markItems(id, 'removed', 'The provider no longer lists this item in the selected source.',
      item => item.status === 'available' && !!item.remoteId && !seen.has(item.remoteId)));
  }

  async markSourceItemsStatus(id: string, status: ConnectedSourceItemStatus, reason: string) {
    this.assertCurrentClaim(id, true);
    return this.transaction(() => this.markItems(id, status, reason, item => item.status !== status));
  }

  /** Seed an authorized snapshot inside the workspace import transaction. */
  seed(project: string, snapshot: ConnectedSourceSnapshot) {
    if (!Array.isArray(snapshot.sources) || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.runs)) {
      throw new Error('Connected-source snapshot lists are missing.');
    }
    const known = new Set<string>();
    for (const source of snapshot.sources) {
      if (!source?.id || source.projectId !== project || known.has(source.id) || !source.integrationId || !source.remoteId
        || !['github', 'google_drive', 'slack'].includes(source.provider)) throw new Error('Connected-source snapshot scope mismatch.');
      known.add(source.id);
    }
    if (snapshot.items.some(item => !item?.id || item.projectId !== project || !known.has(item.sourceId) || typeof item.path !== 'string')
      || snapshot.runs.some(run => !run?.id || run.projectId !== project || !known.has(run.sourceId) || !run.idempotencyKey
        || !Number.isFinite(Date.parse(run.createdAt)) || !['queued', 'running', 'partial', 'success', 'failure', 'cancelled'].includes(run.status))) {
      throw new Error('Connected-source history contains invalid items or runs.');
    }
    if (this.db.prepare('SELECT 1 FROM local_connected_source WHERE owner = ? AND project = ? LIMIT 1').get(this.owner, project)) return;
    for (const { latestSyncRun: _, ...source } of snapshot.sources) this.writeSource(source);
    const writeItem = this.db.prepare('INSERT INTO local_connected_item VALUES (?, ?, ?, ?, ?, ?)');
    const lookupVersion = this.db.prepare("SELECT hash, json_extract(metadata, '$.sourceId') AS source FROM source_version WHERE owner = ? AND project = ? AND artifact = ? AND version = ?");
    for (const item of snapshot.items) {
      if (item.artifactVersionId) {
        const version = lookupVersion.get(this.owner, project, item.artifactId, item.artifactVersionId);
        if (!version || version.hash !== item.contentHash || version.source !== item.sourceId) {
          throw new Error('Connected-source item refers to unavailable frozen bytes.');
        }
      }
      const saved = { ...item, storagePath: item.artifactVersionId ? item.contentHash : null };
      writeItem.run(this.owner, item.sourceId, item.id, item.remoteId, item.path, JSON.stringify(saved));
    }
    const writeRun = this.db.prepare('INSERT INTO local_connected_run VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)');
    for (const run of snapshot.runs) {
      // Only the renderer-safe run fields move. A hosted worker claim must never carry over.
      const { id, projectId, sourceId, status, idempotencyKey, remoteRevision, cursorStart, cursorEnd, attemptCount, importedCount,
        updatedCount, unchangedCount, removedCount, inaccessibleCount, errorCode, errorMessage, retryable, retryService, retryOperation,
        retryAttempt, retryLimit, retryDelayMs, nextAttemptAt, startedAt, completedAt, createdAt } = run;
      const saved: ConnectedSourceSyncRun = { id, projectId, sourceId, status, idempotencyKey, remoteRevision, cursorStart, cursorEnd,
        attemptCount, importedCount, updatedCount, unchangedCount, removedCount, inaccessibleCount, errorCode, errorMessage, retryable,
        retryService, retryOperation, retryAttempt, retryLimit, retryDelayMs, nextAttemptAt, startedAt, completedAt, createdAt, leaseExpiresAt: null };
      writeRun.run(this.owner, id, sourceId, idempotencyKey, createdAt, JSON.stringify(saved));
    }
  }

  async startSyncRun(input: ConnectedSource, key: string) {
    return this.transaction(() => {
      const source = this.requireSource(input.id);
      if (source.projectId !== input.projectId || !key.trim() || source.status === 'disconnected') throw new Error('Invalid connected sync request.');
      const existing = decode<ConnectedSourceSyncRun>(this.db.prepare(`SELECT payload FROM local_connected_run
        WHERE owner = ? AND source = ? AND request = ?`).get(this.owner, input.id, key));
      if (existing) return existing;
      const resumable = this.latest(input.id, true);
      if (resumable) return resumable;
      const run: ConnectedSourceSyncRun = { id: randomUUID(), projectId: source.projectId, sourceId: source.id, idempotencyKey: key,
        status: 'queued', remoteRevision: null, cursorStart: null, cursorEnd: null, attemptCount: 0, importedCount: 0, updatedCount: 0,
        unchangedCount: 0, removedCount: 0, inaccessibleCount: 0, errorCode: null, errorMessage: null, retryable: false,
        startedAt: null, completedAt: null, leaseExpiresAt: null, createdAt: now() };
      this.db.prepare('INSERT INTO local_connected_run VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)')
        .run(this.owner, run.id, source.id, key, run.createdAt, JSON.stringify(run));
      return run;
    });
  }

  async listSyncRuns(id: string) {
    return this.db.prepare('SELECT payload FROM local_connected_run WHERE owner = ? AND source = ? ORDER BY created DESC, id DESC')
      .all(this.owner, id).map(row => decode<ConnectedSourceSyncRun>(row)!);
  }

  async getSyncRun(id: string) { return decode<ConnectedSourceSyncRun>(this.run(id)); }

  async getLatestSyncRun(id: string) { return this.latest(id); }

  async claimSyncRun(id: string, token: string, seconds: number) {
    return this.transaction(() => {
      const row = this.run(id);
      const run = decode<ConnectedSourceSyncRun>(row);
      if (!row || !run || !token || !recoverable.has(run.status) || this.requireSource(run.sourceId).status === 'disconnected'
        || (row.lease !== token && typeof row.expires === 'string' && row.expires > now())) return false;
      this.writeRun(run, token, new Date(Date.now() + Math.min(900, Math.max(30, seconds)) * 1000).toISOString());
      this.claim = { sourceId: run.sourceId, runId: run.id, token };
      return true;
    });
  }

  async updateSyncRun(id: string, patch: ConnectedSourceSyncRunPatch, token?: string) {
    return this.transaction(() => {
      const row = this.run(id);
      const run = decode<ConnectedSourceSyncRun>(row);
      if (!row || !run || (token && (row.lease !== token || typeof row.expires !== 'string' || row.expires <= now()))) {
        throw new ConnectedSourceImporterError('This synchronization worker no longer owns the run.', { code: 'sync_lease_lost' });
      }
      const release = patch.status && patch.status !== 'running' && patch.status !== 'queued';
      const saved = this.writeRun({ ...run, ...patch }, release ? null : row.lease as string | null,
        release ? null : token ? new Date(Date.now() + 120_000).toISOString() : row.expires as string | null);
      // Publish the source's successful cursor and the run together. Recovery can
      // observe either the previous checkpoint or the entire completed sync.
      if (patch.status === 'success') {
        const source = this.requireSource(run.sourceId);
        const completed = saved.completedAt ?? now();
        this.writeSource({ ...source, status: 'active', syncStatus: 'ready', remoteRevision: saved.remoteRevision,
          syncCursor: saved.cursorEnd, lastSyncedAt: completed, lastSuccessfulSyncAt: completed, lastError: null, updatedAt: completed });
      }
      return saved;
    });
  }

  async persistArtifactVersion(input: ConnectedArtifactVersionInput) {
    this.assertCurrentClaim(input.sourceId);
    const source = this.requireSource(input.sourceId);
    const project = this.workspace.project(this.owner, input.projectId);
    if (!project || source.projectId !== input.projectId || source.provider !== input.provider || source.status === 'disconnected') {
      throw new Error('Connected artifact scope mismatch.');
    }
    const identity = input.provider === 'google_drive' && input.remoteId ? `drive/${input.remoteId}` : input.path;
    const filePath = safeArtifactPath(`connected/${input.sourceId}/${identity}`);
    const bytes = Buffer.from(input.content);
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const previous = this.workspace.connectedArtifact(this.owner, input.projectId, input.sourceId, filePath);
    const known = previous?.id ? this.workspace.matchSourceVersion(this.owner, input.projectId, previous.id, contentHash, input.mimeType) : null;
    if (known) {
      this.workspace.importSnapshot(this.owner, project, [{ artifact: known, bytes, mimeType: input.mimeType }]);
      return { artifactId: known.id, artifactVersionId: known.versionId, contentHash, storagePath: contentHash, unchanged: true };
    }
    const commit = input.metadata.commitSha;
    const repository = input.metadata.repository;
    const git = input.provider === 'github' && typeof repository === 'string' && typeof commit === 'string' && /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(commit)
      ? { repository, commit, branch: typeof input.metadata.branch === 'string' ? input.metadata.branch : undefined,
        subject: typeof input.metadata.commitSubject === 'string' ? input.metadata.commitSubject : undefined } : undefined;
    const artifact: Artifact & { versionId: string } = { id: previous?.id ?? randomUUID(), versionId: randomUUID(), projectId: input.projectId,
      sourceId: input.sourceId, source: input.provider === 'github' ? 'repository' : input.provider === 'google_drive' ? 'drive' : 'documents',
      type: detectArtifactType(input.name), fileName: input.name, filePath, originalPath: input.path, contentHash, git,
      createdAt: previous?.createdAt ?? now(), updatedAt: now(), currency: previous?.currency };
    this.workspace.importSnapshot(this.owner, project, [{ artifact, bytes, mimeType: input.mimeType }]);
    return { artifactId: artifact.id, artifactVersionId: artifact.versionId, contentHash, storagePath: contentHash, unchanged: false };
  }

  private source(id: string) {
    return decode<ConnectedSource>(this.db.prepare('SELECT payload FROM local_connected_source WHERE owner = ? AND id = ?').get(this.owner, id));
  }

  private assertCurrentClaim(source: string, allowReleased = false) {
    if (!this.claim || this.claim.sourceId !== source) return;
    const row = this.run(this.claim.runId);
    const valid = row?.lease === this.claim.token && typeof row.expires === 'string' && row.expires > now();
    const status = decode<ConnectedSourceSyncRun>(row)?.status;
    const justReleased = allowReleased && row?.lease === null && status !== 'cancelled' && this.latest(source)?.id === this.claim.runId;
    if (!valid && !justReleased) throw new ConnectedSourceImporterError('This synchronization worker no longer owns the run.', { code: 'sync_lease_lost' });
  }

  private requireSource(id: string) {
    const source = this.source(id);
    if (!source) throw new Error('Connected source is unavailable.');
    return source;
  }

  private writeSource(source: ConnectedSource) {
    this.db.prepare('INSERT INTO local_connected_source VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (owner, id) DO UPDATE SET payload = excluded.payload')
      .run(this.owner, source.id, source.projectId, source.provider, source.remoteId, JSON.stringify(source));
    return source;
  }

  private item(id: string, remote: string | null, path: string) {
    return decode<ConnectedSourceItem>(this.db.prepare(`SELECT payload FROM local_connected_item WHERE owner = ? AND source = ?
      AND ${remote ? 'remote' : 'path'} = ? ORDER BY id LIMIT 1`).get(this.owner, id, remote || path));
  }

  private writeItem(item: NewConnectedSourceItem) {
    const legacy = item.remoteId ? decode<ConnectedSourceItem>(this.db.prepare(`SELECT payload FROM local_connected_item
      WHERE owner = ? AND source = ? AND path = ? AND remote IS NULL ORDER BY id LIMIT 1`).get(this.owner, item.sourceId, item.path)) : null;
    const existing = this.item(item.sourceId, item.remoteId, item.path) ?? legacy;
    const saved: ConnectedSourceItem = { ...item, id: existing?.id ?? randomUUID(), createdAt: existing?.createdAt ?? now(), updatedAt: now() };
    this.db.prepare(`INSERT INTO local_connected_item VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, source, id) DO UPDATE SET remote = excluded.remote, path = excluded.path, payload = excluded.payload`)
      .run(this.owner, saved.sourceId, saved.id, saved.remoteId, saved.path, JSON.stringify(saved));
    return saved;
  }

  private markItems(id: string, status: ConnectedSourceItemStatus, error: string, predicate: (item: ConnectedSourceItem) => boolean) {
    const items = this.listItems(id).filter(predicate);
    for (const item of items) this.writeItem({ ...item, status, error, unavailableAt: now() });
    return items.length;
  }

  private run(id: string) {
    return this.db.prepare('SELECT payload, lease, expires FROM local_connected_run WHERE owner = ? AND id = ?').get(this.owner, id);
  }

  private latest(id: string, active = false) {
    return decode<ConnectedSourceSyncRun>(this.db.prepare(`SELECT payload FROM local_connected_run WHERE owner = ? AND source = ?
      ${active ? "AND json_extract(payload, '$.status') IN ('queued', 'running', 'partial')" : ''}
      ORDER BY created DESC, id DESC LIMIT 1`).get(this.owner, id));
  }

  private writeRun(run: ConnectedSourceSyncRun, lease: string | null, expires: string | null) {
    const stored = { ...run, leaseExpiresAt: expires };
    this.db.prepare('UPDATE local_connected_run SET payload = ?, lease = ?, expires = ? WHERE owner = ? AND id = ?')
      .run(JSON.stringify(stored), lease, expires, this.owner, run.id);
    return stored;
  }

  private cancelRuns(source: string) {
    const rows = this.db.prepare(`SELECT payload FROM local_connected_run WHERE owner = ? AND source = ?
      AND json_extract(payload, '$.status') IN ('queued', 'running', 'partial')`).all(this.owner, source);
    for (const row of rows) this.writeRun({ ...decode<ConnectedSourceSyncRun>(row)!, status: 'cancelled', completedAt: now() }, null, null);
  }

  private transaction<T>(write: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = write();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
