import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoreIntegration } from '../store/types.js';
import type { IntegrationProvider } from './oauthConfig.js';
import type {
  ConnectedArtifactVersionInput,
  ConnectedSource,
  ConnectedSourceItem,
  ConnectedSourceRepository,
  ConnectedSourceSyncRun,
  ConnectedSourceStatus,
  ConnectedSourceSyncRunStatus,
  ConnectedSourceItemStatus,
  NewConnectedSource,
  NewConnectedSourceItem,
  PersistedConnectedArtifact,
  SyncSnapshot,
} from './types.js';

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function text(row: Row, key: string, fallback = ''): string {
  return row[key] === null || row[key] === undefined ? fallback : String(row[key]);
}

function optionalText(row: Row, key: string): string | null {
  return row[key] === null || row[key] === undefined || row[key] === '' ? null : String(row[key]);
}

function number(row: Row, key: string, fallback = 0): number {
  return row[key] === null || row[key] === undefined ? fallback : Number(row[key]);
}

function bool(row: Row, key: string, fallback = false): boolean {
  return row[key] === null || row[key] === undefined ? fallback : Boolean(row[key]);
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Supabase ${label} query returned no data.`);
  return value;
}

function providerFor(kind: string): IntegrationProvider | null {
  if (kind === 'github_repository') return 'github';
  if (kind === 'google_drive') return 'google_drive';
  if (kind === 'slack_channel') return 'slack';
  return null;
}

function mapSource(row: Row): ConnectedSource | null {
  const provider = optionalText(row, 'provider') ?? providerFor(text(row, 'kind'));
  if (provider !== 'github' && provider !== 'google_drive' && provider !== 'slack') return null;
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), integrationId: optionalText(row, 'integration_id') ?? '',
    provider, kind: text(row, 'kind') as ConnectedSource['kind'], remoteId: text(row, 'remote_id'), remoteUrl: optionalText(row, 'remote_url'),
    name: text(row, 'name'), selectedScope: asRecord(row.selected_scope), remoteRevision: optionalText(row, 'remote_revision'),
    syncCursor: row.sync_cursor == null ? null : asRecord(row.sync_cursor), status: text(row, 'status', 'active') as ConnectedSourceStatus,
    syncStatus: text(row, 'sync_status', 'idle') as ConnectedSource['syncStatus'], lastSyncedAt: optionalText(row, 'last_synced_at'),
    lastSuccessfulSyncAt: optionalText(row, 'last_successful_sync_at'), lastError: optionalText(row, 'last_error'),
    createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  };
}

function mapSourceItem(row: Row): ConnectedSourceItem {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), sourceId: text(row, 'source_id'), remoteId: optionalText(row, 'remote_id'),
    path: text(row, 'path'), name: text(row, 'name'), mimeType: optionalText(row, 'mime_type'), contentHash: optionalText(row, 'content_hash'),
    storagePath: optionalText(row, 'storage_path'), artifactId: optionalText(row, 'artifact_id'), artifactVersionId: optionalText(row, 'artifact_version_id'),
    revision: optionalText(row, 'revision'), status: text(row, 'status', 'available') as ConnectedSourceItemStatus,
    metadata: asRecord(row.metadata), lastSeenAt: optionalText(row, 'last_seen_at'), unavailableAt: optionalText(row, 'unavailable_at'),
    error: optionalText(row, 'error'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  };
}

function mapSyncRun(row: Row): ConnectedSourceSyncRun {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), sourceId: text(row, 'source_id'),
    status: text(row, 'status', 'queued') as ConnectedSourceSyncRunStatus, idempotencyKey: text(row, 'idempotency_key'),
    remoteRevision: optionalText(row, 'remote_revision'), cursorStart: row.cursor_start == null ? null : asRecord(row.cursor_start),
    cursorEnd: row.cursor_end == null ? null : asRecord(row.cursor_end), attemptCount: number(row, 'attempt_count'),
    importedCount: number(row, 'imported_count'), updatedCount: number(row, 'updated_count'), unchangedCount: number(row, 'unchanged_count'),
    removedCount: number(row, 'removed_count'), inaccessibleCount: number(row, 'inaccessible_count'),
    errorCode: optionalText(row, 'error_code'), errorMessage: optionalText(row, 'error_message'), retryable: bool(row, 'retryable'),
    startedAt: optionalText(row, 'started_at'), completedAt: optionalText(row, 'completed_at'), createdAt: text(row, 'created_at'),
  };
}

function integrationPayload(input: StoreIntegration): Row {
  return {
    id: input.id, owner_id: input.ownerId, provider: input.provider, account_label: input.accountLabel, account_id: input.accountId,
    scopes: input.scopes, token_reference: input.tokenReference, expires_at: input.expiresAt, status: input.status,
    created_at: input.createdAt, updated_at: input.updatedAt,
  };
}

function sourcePayload(input: NewConnectedSource): Row {
  return {
    project_id: input.projectId, integration_id: input.integrationId, provider: input.provider, kind: input.kind,
    name: input.name, remote_id: input.remoteId, remote_url: input.remoteUrl, selected_scope: input.selectedScope,
  };
}

function sourceItemPayload(input: NewConnectedSourceItem): Row {
  return {
    project_id: input.projectId, source_id: input.sourceId, remote_id: input.remoteId, path: input.path, name: input.name,
    mime_type: input.mimeType, content_hash: input.contentHash, storage_path: input.storagePath, artifact_id: input.artifactId,
    artifact_version_id: input.artifactVersionId, revision: input.revision, status: input.status, metadata: input.metadata,
    last_seen_at: input.lastSeenAt, unavailable_at: input.unavailableAt, error: input.error,
  };
}

function runPayload(source: ConnectedSource, idempotencyKey: string, snapshot?: SyncSnapshot | null): Row {
  return {
    project_id: source.projectId, source_id: source.id, idempotency_key: idempotencyKey, status: 'queued',
    remote_revision: snapshot?.remoteRevision ?? null, cursor_start: snapshot?.cursor ?? null, cursor_end: snapshot?.cursor ?? null,
    imported_count: 0, updated_count: 0, unchanged_count: 0, removed_count: 0, inaccessible_count: 0,
    attempt_count: 0, retryable: false,
  };
}

function safeArtifactPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => part === '.' || part === '..') || normalized.includes('\u0000')) {
    throw new Error('Connected artifact path is invalid.');
  }
  if (normalized.length > 1024) throw new Error('Connected artifact path is too long.');
  return normalized;
}

function mapSourcePatch(patch: Partial<Pick<ConnectedSource, 'remoteRevision' | 'syncCursor' | 'status' | 'syncStatus' | 'lastSyncedAt' | 'lastSuccessfulSyncAt' | 'lastError'>>): Row {
  const result: Row = {};
  if ('remoteRevision' in patch) result.remote_revision = patch.remoteRevision;
  if ('syncCursor' in patch) result.sync_cursor = patch.syncCursor;
  if ('status' in patch) result.status = patch.status;
  if ('syncStatus' in patch) result.sync_status = patch.syncStatus;
  if ('lastSyncedAt' in patch) result.last_synced_at = patch.lastSyncedAt;
  if ('lastSuccessfulSyncAt' in patch) result.last_successful_sync_at = patch.lastSuccessfulSyncAt;
  if ('lastError' in patch) result.last_error = patch.lastError;
  result.updated_at = new Date().toISOString();
  return result;
}

function mapRunPatch(patch: Partial<Pick<ConnectedSourceSyncRun, 'status' | 'remoteRevision' | 'cursorStart' | 'cursorEnd' | 'attemptCount' | 'importedCount' | 'updatedCount' | 'unchangedCount' | 'removedCount' | 'inaccessibleCount' | 'errorCode' | 'errorMessage' | 'retryable' | 'startedAt' | 'completedAt'>>): Row {
  const result: Row = {};
  const fields: Array<[keyof typeof patch, string]> = [
    ['status', 'status'], ['remoteRevision', 'remote_revision'], ['cursorStart', 'cursor_start'], ['cursorEnd', 'cursor_end'],
    ['attemptCount', 'attempt_count'], ['importedCount', 'imported_count'], ['updatedCount', 'updated_count'],
    ['unchangedCount', 'unchanged_count'], ['removedCount', 'removed_count'], ['inaccessibleCount', 'inaccessible_count'],
    ['errorCode', 'error_code'], ['errorMessage', 'error_message'], ['retryable', 'retryable'], ['startedAt', 'started_at'], ['completedAt', 'completed_at'],
  ];
  for (const [domainKey, column] of fields) if (domainKey in patch) result[column] = patch[domainKey];
  return result;
}

function digest(content: Uint8Array): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function asMessage(error: { message?: string } | null, label: string): void {
  if (error) throw new Error(`Supabase ${label} failed: ${error.message ?? 'unknown error'}`);
}

/** RLS-scoped Supabase persistence for connected sources and immutable files. */
export class SupabaseConnectedSourceRepository implements ConnectedSourceRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getIntegration(ownerId: string, provider: IntegrationProvider): Promise<StoreIntegration | null> {
    const { data, error } = await this.client.from('integrations').select('*').eq('owner_id', ownerId).eq('provider', provider).maybeSingle();
    asMessage(error, 'connected-source integration query');
    if (!data) return null;
    const row = asRow(data);
    return {
      id: text(row, 'id'), ownerId: text(row, 'owner_id'), provider: text(row, 'provider'), accountLabel: text(row, 'account_label'),
      accountId: text(row, 'account_id'), scopes: text(row, 'scopes'), tokenReference: optionalText(row, 'token_reference'),
      expiresAt: optionalText(row, 'expires_at'), status: text(row, 'status', 'connected'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
    };
  }

  async saveIntegration(input: StoreIntegration): Promise<void> {
    const { error } = await this.client.from('integrations').upsert(integrationPayload(input), { onConflict: 'owner_id,provider' });
    asMessage(error, 'connected-source integration save');
  }

  async listSources(projectId: string): Promise<ConnectedSource[]> {
    const sources: ConnectedSource[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.client.from('project_sources').select('*').eq('project_id', projectId).not('provider', 'is', null).order('created_at').order('id').range(offset, offset + 999);
      asMessage(error, 'connected-source list');
      for (const row of data ?? []) {
        const source = mapSource(asRow(row));
        if (source) sources.push(source);
      }
      if ((data ?? []).length < 1000) break;
    }
    return sources;
  }

  async getSource(projectId: string, sourceId: string): Promise<ConnectedSource | null> {
    const { data, error } = await this.client.from('project_sources').select('*').eq('project_id', projectId).eq('id', sourceId).maybeSingle();
    asMessage(error, 'connected-source lookup');
    return data ? mapSource(asRow(data)) : null;
  }

  async saveSource(input: NewConnectedSource): Promise<ConnectedSource> {
    const payload = sourcePayload(input);
    const { data: existing, error: lookupError } = await this.client.from('project_sources').select('id,selected_scope,status,sync_status,last_error').eq('project_id', input.projectId).eq('provider', input.provider).eq('remote_id', input.remoteId).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    asMessage(lookupError, 'connected-source lookup');
    const existingRow = asRow(existing);
    const scopeChanged = Boolean(existing) && stableJson(asRecord(existingRow.selected_scope)) !== stableJson(input.selectedScope);
    const reactivated = Boolean(existing) && text(existingRow, 'status', 'active') !== 'active';
    const savePayload = {
      ...payload,
      status: reactivated || !existing ? 'active' : text(existingRow, 'status', 'active'),
      sync_status: scopeChanged || reactivated || !existing ? 'idle' : text(existingRow, 'sync_status', 'idle'),
      last_error: scopeChanged || reactivated ? null : optionalText(existingRow, 'last_error'),
      updated_at: new Date().toISOString(),
      ...(scopeChanged ? { remote_revision: null, sync_cursor: null, last_successful_sync_at: null, last_synced_at: null } : {}),
    };
    const query = existing
      ? this.client.from('project_sources').update(savePayload).eq('id', String(existingRow.id))
      : this.client.from('project_sources').insert(savePayload);
    const { data, error } = await query.select('*').single();
    asMessage(error, 'connected-source save');
    return required(mapSource(asRow(data)), 'connected-source');
  }

  async updateSource(sourceId: string, patch: Partial<Pick<ConnectedSource, 'remoteRevision' | 'syncCursor' | 'status' | 'syncStatus' | 'lastSyncedAt' | 'lastSuccessfulSyncAt' | 'lastError'>>): Promise<ConnectedSource> {
    const { data, error } = await this.client.from('project_sources').update(mapSourcePatch(patch)).eq('id', sourceId).select('*').single();
    asMessage(error, 'connected-source update');
    return required(mapSource(asRow(data)), 'connected-source');
  }

  async listSourceItems(sourceId: string): Promise<ConnectedSourceItem[]> {
    const items: ConnectedSourceItem[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.client.from('source_items').select('*').eq('source_id', sourceId).order('path').range(offset, offset + 999);
      asMessage(error, 'connected-source item list');
      items.push(...(data ?? []).map(row => mapSourceItem(asRow(row))));
      if ((data ?? []).length < 1000) break;
    }
    return items;
  }

  async getSourceItem(sourceId: string, remoteId: string | null, path: string): Promise<ConnectedSourceItem | null> {
    let query = this.client.from('source_items').select('*').eq('source_id', sourceId);
    query = remoteId ? query.eq('remote_id', remoteId) : query.eq('path', path);
    const { data, error } = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();
    asMessage(error, 'connected-source item lookup');
    return data ? mapSourceItem(asRow(data)) : null;
  }

  async saveSourceItem(input: NewConnectedSourceItem): Promise<ConnectedSourceItem> {
    const previous = await this.getSourceItem(input.sourceId, input.remoteId, input.path);
    let existing = previous;
    if (!existing && input.remoteId) existing = await this.getSourceItem(input.sourceId, null, input.path);
    const payload = sourceItemPayload(input);
    const query = existing
      ? this.client.from('source_items').update(payload).eq('id', existing.id)
      : this.client.from('source_items').insert(payload);
    const { data, error } = await query.select('*').single();
    asMessage(error, 'connected-source item save');
    return mapSourceItem(asRow(required(data, 'connected-source item')));
  }

  async markMissingItems(sourceId: string, seenRemoteIds: Set<string>): Promise<number> {
    const missing = (await this.listSourceItems(sourceId)).filter(item => item.status === 'available' && item.remoteId && !seenRemoteIds.has(item.remoteId));
    for (const item of missing) {
      await this.saveSourceItem({
        projectId: item.projectId, sourceId: item.sourceId, remoteId: item.remoteId, path: item.path, name: item.name,
        mimeType: item.mimeType, contentHash: item.contentHash, storagePath: item.storagePath, artifactId: item.artifactId,
        artifactVersionId: item.artifactVersionId, revision: item.revision, status: 'removed', metadata: item.metadata,
        lastSeenAt: item.lastSeenAt, unavailableAt: new Date().toISOString(), error: 'The provider no longer lists this item in the selected source.',
      });
    }
    return missing.length;
  }

  async markSourceItemsStatus(sourceId: string, status: ConnectedSourceItemStatus, reason: string): Promise<number> {
    const existing = (await this.listSourceItems(sourceId)).filter(item => item.status !== status);
    for (const item of existing) {
      await this.saveSourceItem({
        projectId: item.projectId, sourceId: item.sourceId, remoteId: item.remoteId, path: item.path, name: item.name,
        mimeType: item.mimeType, contentHash: item.contentHash, storagePath: item.storagePath, artifactId: item.artifactId,
        artifactVersionId: item.artifactVersionId, revision: item.revision, status, metadata: item.metadata,
        lastSeenAt: item.lastSeenAt, unavailableAt: new Date().toISOString(), error: reason,
      });
    }
    return existing.length;
  }

  async startSyncRun(source: ConnectedSource, idempotencyKey: string, snapshot?: SyncSnapshot | null): Promise<ConnectedSourceSyncRun> {
    const { data: existing, error: lookupError } = await this.client.from('source_sync_runs').select('*').eq('source_id', source.id).eq('idempotency_key', idempotencyKey).maybeSingle();
    asMessage(lookupError, 'connected-source sync idempotency lookup');
    if (existing) return mapSyncRun(asRow(existing));
    const { data, error } = await this.client.from('source_sync_runs').insert(runPayload(source, idempotencyKey, snapshot)).select('*').single();
    if (error?.code === '23505') {
      const retry = await this.client.from('source_sync_runs').select('*').eq('source_id', source.id).eq('idempotency_key', idempotencyKey).single();
      asMessage(retry.error, 'connected-source sync idempotency lookup');
      return mapSyncRun(asRow(retry.data));
    }
    asMessage(error, 'connected-source sync start');
    return mapSyncRun(asRow(required(data, 'connected-source sync run')));
  }

  async listSyncRuns(sourceId: string): Promise<ConnectedSourceSyncRun[]> {
    const runs: ConnectedSourceSyncRun[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.client.from('source_sync_runs').select('*').eq('source_id', sourceId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 999);
      asMessage(error, 'connected-source sync history');
      runs.push(...(data ?? []).map(row => mapSyncRun(asRow(row))));
      if ((data ?? []).length < 1000) break;
    }
    return runs;
  }

  async getSyncRun(runId: string): Promise<ConnectedSourceSyncRun | null> {
    const { data, error } = await this.client.from('source_sync_runs').select('*').eq('id', runId).maybeSingle();
    asMessage(error, 'connected-source sync run lookup');
    return data ? mapSyncRun(asRow(data)) : null;
  }

  async updateSyncRun(runId: string, patch: Partial<Pick<ConnectedSourceSyncRun, 'status' | 'remoteRevision' | 'cursorStart' | 'cursorEnd' | 'attemptCount' | 'importedCount' | 'updatedCount' | 'unchangedCount' | 'removedCount' | 'inaccessibleCount' | 'errorCode' | 'errorMessage' | 'retryable' | 'startedAt' | 'completedAt'>>): Promise<ConnectedSourceSyncRun> {
    const { data, error } = await this.client.from('source_sync_runs').update(mapRunPatch(patch)).eq('id', runId).select('*').single();
    asMessage(error, 'connected-source sync update');
    return mapSyncRun(asRow(required(data, 'connected-source sync run')));
  }

  async persistArtifactVersion(input: ConnectedArtifactVersionInput): Promise<PersistedConnectedArtifact> {
    // Project artifacts are keyed by path, while two connected sources may
    // contain the same remote path. Namespace durable paths by source identity
    // and keep the unmodified provider path in metadata/source_items.
    const artifactIdentity = input.provider === 'google_drive' && input.remoteId
      ? `drive/${input.remoteId}`
      : input.path;
    const path = safeArtifactPath(`connected/${input.sourceId}/${artifactIdentity}`);
    const contentHash = digest(input.content);
    let { data: artifactData, error: artifactLookupError } = await this.client.from('artifacts').select('*').eq('project_id', input.projectId).eq('path', path).maybeSingle();
    asMessage(artifactLookupError, 'connected artifact lookup');
    const previousMetadata = asRecord(asRow(artifactData).metadata);
    const artifactPayload = {
      project_id: input.projectId, source_id: input.sourceId, path, name: input.name, kind: 'connected_source', mime_type: input.mimeType,
      metadata: { ...previousMetadata, ...input.metadata, provider: input.provider, remoteId: input.remoteId, sourceId: input.sourceId, sourcePath: input.path },
    };
    if (artifactData) {
      const { data, error } = await this.client.from('artifacts').update(artifactPayload).eq('id', String(asRow(artifactData).id)).select('*').single();
      asMessage(error, 'connected artifact update');
      artifactData = data;
    } else {
      const { data, error } = await this.client.from('artifacts').upsert(artifactPayload, { onConflict: 'project_id,path' }).select('*').single();
      asMessage(error, 'connected artifact create');
      artifactData = data;
    }
    const artifactId = text(asRow(required(artifactData, 'artifact')), 'id');

    const { data: existingVersion, error: versionLookupError } = await this.client.from('artifact_versions').select('*').eq('artifact_id', artifactId).eq('content_hash', contentHash).maybeSingle();
    asMessage(versionLookupError, 'connected artifact version lookup');
    if (existingVersion) {
      const row = asRow(existingVersion);
      return { artifactId, artifactVersionId: text(row, 'id'), contentHash, storagePath: text(row, 'storage_path'), unchanged: true };
    }

    const storagePath = `${input.projectId}/${artifactId}/${contentHash}`;
    const { error: uploadError } = await this.client.storage.from('project-artifacts').upload(storagePath, Buffer.from(input.content), {
      contentType: input.mimeType,
      cacheControl: '31536000',
      upsert: false,
    });
    if (uploadError) {
      // Concurrent identical imports can win the storage upload. Re-read the
      // version row before treating that deterministic object collision as an error.
      const { data: racedVersion, error: racedLookupError } = await this.client.from('artifact_versions').select('*').eq('artifact_id', artifactId).eq('content_hash', contentHash).maybeSingle();
      asMessage(racedLookupError, 'connected artifact version lookup');
      if (racedVersion) {
        const row = asRow(racedVersion);
        return { artifactId, artifactVersionId: text(row, 'id'), contentHash, storagePath: text(row, 'storage_path'), unchanged: true };
      }
      throw new Error(`Supabase connected artifact upload failed: ${uploadError.message}`);
    }

    const { data: latest, error: latestError } = await this.client.from('artifact_versions').select('version_number').eq('artifact_id', artifactId).order('version_number', { ascending: false }).limit(1).maybeSingle();
    asMessage(latestError, 'connected artifact version sequence lookup');
    const versionNumber = Number(asRow(latest).version_number ?? 0) + 1;
    const versionMetadata = { ...input.metadata, provider: input.provider, remoteId: input.remoteId, sourceId: input.sourceId, sourcePath: input.path, immutable: true };
    const { data: version, error: versionError } = await this.client.from('artifact_versions').insert({
      project_id: input.projectId, artifact_id: artifactId, version_number: versionNumber, content_hash: contentHash,
      byte_size: input.content.byteLength, storage_path: storagePath, source_revision: input.revision,
      content_type: input.mimeType, metadata: versionMetadata,
    }).select('*').single();
    if (versionError?.code === '23505') {
      const raced = await this.client.from('artifact_versions').select('*').eq('artifact_id', artifactId).eq('content_hash', contentHash).single();
      asMessage(raced.error, 'connected artifact version lookup');
      const row = asRow(raced.data);
      return { artifactId, artifactVersionId: text(row, 'id'), contentHash, storagePath: text(row, 'storage_path'), unchanged: true };
    }
    asMessage(versionError, 'connected artifact version save');
    return { artifactId, artifactVersionId: text(asRow(required(version, 'artifact version')), 'id'), contentHash, storagePath, unchanged: false };
  }

  async disconnectIntegration(ownerId: string, provider: IntegrationProvider): Promise<void> {
    const integration = await this.getIntegration(ownerId, provider);
    if (!integration) return;
    const { error: integrationError } = await this.client.from('integrations').update({ token_reference: null, status: 'disconnected', updated_at: new Date().toISOString() }).eq('owner_id', ownerId).eq('provider', provider);
    asMessage(integrationError, 'connected-source disconnect');
    const { error: sourceError } = await this.client.from('project_sources').update({ status: 'disconnected', sync_status: 'idle', last_error: null, updated_at: new Date().toISOString() }).eq('integration_id', integration.id);
    asMessage(sourceError, 'connected-source disconnect');
  }
}
