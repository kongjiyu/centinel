import crypto from 'node:crypto';
import { decryptSecret, encryptSecret } from '../tokenVault.js';
import type { StoreIntegration } from '../store/types.js';
import { ConnectedSourceHttpError, fetchSourceHttpClient, type SourceHttpClient } from './http.js';
import { createGitHubAdapter } from './providers/github.js';
import { createGoogleDriveAdapter } from './providers/googleDrive.js';
import { createSlackAdapter } from './providers/slack.js';
import type { IntegrationProvider } from './oauthConfig.js';
import type {
  BrowseOptions,
  BrowsePage,
  ConnectedArtifactVersionInput,
  ConnectedSource,
  ConnectedSourceItem,
  ConnectedSourceProviderAdapter,
  ConnectedSourceRepository,
  ConnectedSourceStartInput,
  ConnectedSourceStatusResult,
  ConnectedSourceSyncInput,
  ConnectedSourceSyncResult,
  ConnectedSourceSyncRun,
  IntegrationCredential,
  NewConnectedSourceItem,
  RemoteContent,
  SyncSnapshot,
} from './types.js';

export type ConnectedSourceTokenVault = {
  encrypt(value: string): string;
  decrypt(value: string): string;
};

export type ConnectedSourceImporterOptions = {
  repository: ConnectedSourceRepository;
  adapters?: ConnectedSourceProviderAdapter[];
  http?: SourceHttpClient;
  tokenVault?: ConnectedSourceTokenVault;
  maxRetries?: number;
  retryDelayMs?: number;
  maxPagesPerRun?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => string;
};

export type ConnectedSourceDisconnectResult = {
  disconnected: boolean;
  revokeAttempted: boolean;
  revoked: boolean;
};

export class ConnectedSourceImporterError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode: number | undefined;

  constructor(message: string, options: { code?: string; retryable?: boolean; statusCode?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ConnectedSourceImporterError';
    this.code = options.code ?? 'connected_source_error';
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode;
  }
}

function defaultAdapters(http: SourceHttpClient): ConnectedSourceProviderAdapter[] {
  return [createGitHubAdapter({ http }), createGoogleDriveAdapter({ http }), createSlackAdapter({ http })];
}

function validProvider(provider: string): provider is IntegrationProvider {
  return provider === 'github' || provider === 'google_drive' || provider === 'slack';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function credentialFromJson(raw: string, integration: { expiresAt: string | null; scopes: string }): IntegrationCredential {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new ConnectedSourceImporterError('The saved provider credentials are invalid. Reconnect this source.', { code: 'invalid_credentials', cause });
  }
  const row = asRecord(value);
  const accessToken = asString(row.accessToken) ?? asString(row.access_token);
  if (!accessToken) throw new ConnectedSourceImporterError('The saved provider credentials are incomplete. Reconnect this source.', { code: 'invalid_credentials' });
  return {
    accessToken,
    refreshToken: asString(row.refreshToken) ?? asString(row.refresh_token),
    expiresAt: asString(row.expiresAt) ?? asString(row.expires_at) ?? integration.expiresAt,
    scopes: asString(row.scopes) ?? integration.scopes,
  };
}

function retryDetails(cause: unknown): { code: string; retryable: boolean; statusCode?: number; message: string } {
  if (cause instanceof ConnectedSourceHttpError || cause instanceof ConnectedSourceImporterError) {
    return { code: cause.code, retryable: cause.retryable, statusCode: cause.statusCode, message: cause.message };
  }
  if (cause instanceof Error) {
    const record = cause as Error & { code?: string; retryable?: boolean; statusCode?: number };
    return { code: record.code ?? 'provider_error', retryable: record.retryable ?? false, statusCode: record.statusCode, message: record.message };
  }
  return { code: 'provider_error', retryable: false, message: 'Connected source synchronization failed.' };
}

function scopesList(scopes: string): string[] {
  return scopes.split(/[\s,]+/).map(scope => scope.trim()).filter(Boolean);
}

const SLACK_REQUIRED_READ_SCOPES = [
  'channels:history', 'channels:read', 'groups:history', 'groups:read', 'users:read', 'files:read',
] as const;

function missingProviderScopes(provider: IntegrationProvider, scopes: string): string[] {
  if (provider !== 'slack') return [];
  const granted = new Set(scopesList(scopes));
  return SLACK_REQUIRED_READ_SCOPES.filter(scope => !granted.has(scope));
}

function kindMatches(provider: IntegrationProvider, kind: ConnectedSource['kind']): boolean {
  return provider === 'github' ? kind === 'github_repository'
    : provider === 'google_drive' ? kind === 'google_drive'
      : kind === 'slack_channel';
}

function cursorValue(value: Record<string, unknown> | null): Record<string, unknown> | null {
  return value === null ? null : structuredClone(value);
}

function syncResult(source: ConnectedSource, run: ConnectedSourceSyncRun, complete: boolean): ConnectedSourceSyncResult {
  return {
    source,
    run,
    complete,
    imported: run.importedCount,
    updated: run.updatedCount,
    unchanged: run.unchangedCount,
    removed: run.removedCount,
    inaccessible: run.inaccessibleCount,
  };
}

/**
 * Provider-neutral synchronization boundary. The repository is expected to
 * use the request's authenticated Supabase/RLS context; provider credentials
 * are decrypted only for a provider call and encrypted again before saving.
 */
export class ConnectedSourceImporter {
  private readonly repository: ConnectedSourceRepository;
  private readonly adapters: Map<IntegrationProvider, ConnectedSourceProviderAdapter>;
  private readonly tokenVault: ConnectedSourceTokenVault;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxPagesPerRun: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => string;

  constructor(options: ConnectedSourceImporterOptions) {
    this.repository = options.repository;
    const adapters = options.adapters ?? defaultAdapters(options.http ?? fetchSourceHttpClient);
    this.adapters = new Map(adapters.map(adapter => [adapter.provider, adapter]));
    this.tokenVault = options.tokenVault ?? { encrypt: encryptSecret, decrypt: decryptSecret };
    this.maxRetries = Math.max(0, Math.min(5, options.maxRetries ?? 2));
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
    this.maxPagesPerRun = Math.max(1, Math.min(200, options.maxPagesPerRun ?? 30));
    this.sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async status(ownerId: string, provider: IntegrationProvider, projectId?: string): Promise<ConnectedSourceStatusResult> {
    this.assertProvider(provider);
    const integration = await this.repository.getIntegration(ownerId, provider);
    const expiresAt = integration?.expiresAt ?? null;
    const isExpired = Boolean(expiresAt && Date.parse(expiresAt) <= Date.parse(this.now()));
    const missingScopes = integration ? missingProviderScopes(provider, integration.scopes) : [];
    const reauthorizationRequired = Boolean(integration?.tokenReference && integration.status === 'connected' && !isExpired && missingScopes.length);
    const status = !integration ? 'disconnected' : isExpired && integration.status === 'connected' ? 'expired' : reauthorizationRequired ? 'reauthorization_required' : integration.status;
    const sources = projectId ? (await this.repository.listSources(projectId)).filter(source => source.provider === provider) : [];
    return {
      provider,
      connected: Boolean(integration?.tokenReference && integration.status === 'connected' && !isExpired && !reauthorizationRequired),
      accountLabel: integration?.accountLabel ?? null,
      accountId: integration?.accountId ?? null,
      scopes: integration ? scopesList(integration.scopes) : [],
      expiresAt,
      status,
      reauthorizationRequired,
      missingScopes,
      sources,
    };
  }

  async listSources(projectId: string): Promise<ConnectedSource[]> {
    return this.repository.listSources(projectId);
  }

  async disconnectSource(projectId: string, sourceId: string): Promise<ConnectedSource> {
    const source = await this.repository.getSource(projectId, sourceId);
    if (!source) throw new ConnectedSourceImporterError('Connected source was not found in this project.', { code: 'source_not_found' });
    if (source.status === 'disconnected') return source;
    return this.repository.updateSource(source.id, { status: 'disconnected', syncStatus: 'idle', lastError: null });
  }

  async browse(ownerId: string, provider: IntegrationProvider, options: BrowseOptions = {}): Promise<BrowsePage> {
    const adapter = this.adapter(provider);
    const credentials = await this.requireCredentials(ownerId, provider, adapter);
    try {
      return await this.withRetry(() => adapter.browse(credentials, options));
    } catch (cause) {
      await this.noteAuthenticationFailure(ownerId, provider, cause);
      throw cause;
    }
  }

  async importSource(input: ConnectedSourceStartInput): Promise<{ source: ConnectedSource; syncResult: ConnectedSourceSyncResult | null }> {
    if (!kindMatches(input.provider, input.kind)) {
      throw new ConnectedSourceImporterError(`Source kind ${input.kind} does not match provider ${input.provider}.`, { code: 'invalid_source_kind' });
    }
    if (!input.remoteId.trim() || !input.name.trim()) {
      throw new ConnectedSourceImporterError('A source identifier and name are required.', { code: 'invalid_source' });
    }
    const adapter = this.adapter(input.provider);
    const integration = await this.repository.getIntegration(input.ownerId, input.provider);
    await this.requireCredentials(input.ownerId, input.provider, adapter);
    if (!integration) throw new ConnectedSourceImporterError(`Connect ${providerLabel(input.provider)} before using this source.`, { code: 'integration_disconnected' });
    const source = await this.repository.saveSource({
      projectId: input.projectId,
      integrationId: integration.id,
      provider: input.provider,
      kind: input.kind,
      remoteId: input.remoteId,
      remoteUrl: input.remoteUrl ?? null,
      name: input.name,
      selectedScope: input.selectedScope ?? {},
    });
    if (input.sync === false) return { source, syncResult: null };
    const result = await this.sync({ ownerId: input.ownerId, projectId: input.projectId, sourceId: source.id, idempotencyKey: input.idempotencyKey });
    return { source: result.source, syncResult: result };
  }

  async sync(input: ConnectedSourceSyncInput): Promise<ConnectedSourceSyncResult> {
    const source = await this.repository.getSource(input.projectId, input.sourceId);
    if (!source) throw new ConnectedSourceImporterError('Connected source was not found in this project.', { code: 'source_not_found' });
    if (!validProvider(source.provider) || source.status === 'disconnected') {
      throw new ConnectedSourceImporterError('This source is disconnected. Reconnect it before synchronizing.', { code: 'source_disconnected' });
    }
    const provider = source.provider;
    const adapter = this.adapter(provider);
    const credentials = await this.requireCredentials(input.ownerId, provider, adapter);
    const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
    const requestedRun = input.runId ? await this.repository.getSyncRun(input.runId) : null;
    if (input.runId && (!requestedRun || requestedRun.sourceId !== source.id || requestedRun.projectId !== input.projectId)) {
      throw new ConnectedSourceImporterError('Synchronization run does not belong to this source.', { code: 'sync_run_not_found' });
    }
    // The Project Sources screen retries through the ordinary Sync endpoint,
    // which creates a fresh idempotency key for each click. Continue the most
    // recent partial snapshot in that case so large repositories make forward
    // progress instead of starting over (or being mistaken for already current
    // after the source revision was updated by an earlier partial run).
    const latestRun = !requestedRun && !input.force
      ? (await this.repository.listSyncRuns(source.id)).sort((left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id, undefined, { numeric: true }))[0] ?? null
      : null;
    const resumableRun = latestRun?.status === 'partial' ? latestRun : null;
    let run = requestedRun ?? resumableRun ?? await this.repository.startSyncRun(source, idempotencyKey);
    if (run.sourceId !== source.id || run.projectId !== input.projectId) throw new ConnectedSourceImporterError('Synchronization run does not belong to this source.', { code: 'sync_run_not_found' });
    if (run.status === 'success') return syncResult(source, run, true);
    if (run.status === 'cancelled') throw new ConnectedSourceImporterError('This synchronization run was cancelled.', { code: 'sync_cancelled' });

    const nowMs = Date.parse(this.now());
    const previousSyncMs = source.lastSyncedAt ? Date.parse(source.lastSyncedAt) : Number.NEGATIVE_INFINITY;
    const now = new Date(Math.max(Number.isFinite(nowMs) ? nowMs : Date.now(), Number.isFinite(previousSyncMs) ? previousSyncMs + 1 : Number.NEGATIVE_INFINITY)).toISOString();
    let snapshot: SyncSnapshot;
    let cursor: Record<string, unknown> | null;
    const hasStoredSnapshot = Boolean(run.remoteRevision || run.cursorStart || run.cursorEnd);
    if (input.force || !hasStoredSnapshot) {
      try {
        snapshot = await this.withRetry(() => adapter.prepareSync(credentials, source));
      } catch (cause) {
        await this.noteAuthenticationFailure(input.ownerId, provider, cause);
        return this.failRun(source, run, cause, 0, false);
      }
      if (!input.force && run.status === 'queued' && run.attemptCount === 0 && adapter.isSourceRevisionUnchanged?.(source, snapshot)) {
        const itemCount = (await this.repository.listSourceItems(source.id)).filter(item => item.status === 'available' || item.status === 'unsupported').length;
        const completedAt = this.now();
        run = await this.repository.updateSyncRun(run.id, {
          status: 'success', remoteRevision: snapshot.remoteRevision, cursorStart: cursorValue(snapshot.cursor),
          cursorEnd: cursorValue(snapshot.cursor), attemptCount: 1, unchangedCount: itemCount,
          startedAt: now, completedAt, retryable: false, errorCode: null, errorMessage: null,
        });
        const unchangedSource = await this.repository.updateSource(source.id, {
          status: 'active', syncStatus: 'ready', remoteRevision: snapshot.remoteRevision,
          lastSyncedAt: completedAt, lastSuccessfulSyncAt: completedAt, lastError: null,
        });
        return syncResult(unchangedSource, run, true);
      }
      cursor = cursorValue(snapshot.cursor);
      run = await this.repository.updateSyncRun(run.id, { remoteRevision: snapshot.remoteRevision, cursorStart: cursorValue(snapshot.cursor), cursorEnd: cursorValue(snapshot.cursor), status: 'running', attemptCount: run.attemptCount + 1, startedAt: run.startedAt ?? now, completedAt: null, errorCode: null, errorMessage: null, retryable: false });
    } else {
      snapshot = { remoteRevision: run.remoteRevision, cursor: cursorValue(run.cursorStart) };
      cursor = cursorValue(run.cursorEnd ?? run.cursorStart);
      run = await this.repository.updateSyncRun(run.id, { status: 'running', attemptCount: run.attemptCount + 1, startedAt: run.startedAt ?? now, completedAt: null, errorCode: null, errorMessage: null, retryable: false });
    }
    let currentSource = await this.repository.updateSource(source.id, { status: 'active', syncStatus: 'syncing', lastError: null });
    const maxPages = Math.max(1, Math.min(this.maxPagesPerRun, input.maxPages ?? this.maxPagesPerRun));
    let pagesProcessed = 0;
    let complete = false;
    let currentRevision = snapshot.remoteRevision;

    try {
      while (pagesProcessed < maxPages) {
        const page = await this.withRetry(() => adapter.listItems(credentials, currentSource, snapshot, cursor));
        for (const item of page.items) {
          const result = await this.persistItem(currentSource, item);
          if (result === 'removed') run = await this.repository.updateSyncRun(run.id, { removedCount: run.removedCount + 1 });
          else if (result === 'inaccessible') run = await this.repository.updateSyncRun(run.id, { inaccessibleCount: run.inaccessibleCount + 1 });
          else if (result === 'imported') run = await this.repository.updateSyncRun(run.id, { importedCount: run.importedCount + 1 });
          else if (result === 'updated') run = await this.repository.updateSyncRun(run.id, { updatedCount: run.updatedCount + 1 });
          else run = await this.repository.updateSyncRun(run.id, { unchangedCount: run.unchangedCount + 1 });
        }
        for (const remoteId of page.deletedRemoteIds ?? []) {
          const changed = await this.markItemUnavailable(currentSource, remoteId, 'removed', null);
          if (changed) run = await this.repository.updateSyncRun(run.id, { removedCount: run.removedCount + 1 });
        }
        for (const remoteId of page.inaccessibleRemoteIds ?? []) {
          const changed = await this.markItemUnavailable(currentSource, remoteId, 'inaccessible', 'The provider no longer grants access to this item.');
          if (changed) run = await this.repository.updateSyncRun(run.id, { inaccessibleCount: run.inaccessibleCount + 1 });
        }

        cursor = cursorValue(page.nextCursor);
        const cursorRevision = cursor && typeof cursor.newestTs === 'string' ? cursor.newestTs : currentRevision;
        currentRevision = cursorRevision;
        run = await this.repository.updateSyncRun(run.id, { cursorEnd: cursor, remoteRevision: currentRevision });
        currentSource = await this.repository.updateSource(currentSource.id, { remoteRevision: currentRevision, syncCursor: cursor, lastSyncedAt: this.now() });
        pagesProcessed++;
        if (page.completeSnapshot) {
          const seenSinceStart = new Set((await this.repository.listSourceItems(currentSource.id))
            .filter(item => item.remoteId && item.lastSeenAt && item.lastSeenAt >= (run.startedAt ?? now))
            .map(item => item.remoteId!));
          const missing = await this.repository.markMissingItems(currentSource.id, seenSinceStart);
          if (missing > 0) run = await this.repository.updateSyncRun(run.id, { removedCount: run.removedCount + missing });
        }
        if (page.done) {
          complete = true;
          break;
        }
      }

      if (complete) {
        run = await this.repository.updateSyncRun(run.id, { status: 'success', cursorEnd: cursor, completedAt: this.now(), errorCode: null, errorMessage: null, retryable: false });
        currentSource = await this.repository.updateSource(currentSource.id, { status: 'active', syncStatus: 'ready', remoteRevision: currentRevision, syncCursor: cursor, lastSyncedAt: this.now(), lastSuccessfulSyncAt: this.now(), lastError: null });
      } else {
        run = await this.repository.updateSyncRun(run.id, { status: 'partial', cursorEnd: cursor, completedAt: null });
        currentSource = await this.repository.updateSource(currentSource.id, { status: 'active', syncStatus: currentSource.lastSuccessfulSyncAt ? 'ready' : 'idle', remoteRevision: currentRevision, syncCursor: cursor, lastSyncedAt: this.now(), lastError: null });
      }
      return syncResult(currentSource, run, complete);
    } catch (cause) {
      await this.noteAuthenticationFailure(input.ownerId, provider, cause);
      return this.failRun(currentSource, run, cause, pagesProcessed, false);
    }
  }

  async resumeSync(input: Omit<ConnectedSourceSyncInput, 'idempotencyKey'> & { runId: string }): Promise<ConnectedSourceSyncResult> {
    return this.sync(input);
  }

  async syncHistory(projectId: string, sourceId: string): Promise<ConnectedSourceSyncRun[]> {
    const source = await this.repository.getSource(projectId, sourceId);
    if (!source) throw new ConnectedSourceImporterError('Connected source was not found in this project.', { code: 'source_not_found' });
    return this.repository.listSyncRuns(sourceId);
  }

  async disconnect(ownerId: string, provider: IntegrationProvider): Promise<ConnectedSourceDisconnectResult> {
    const adapter = this.adapter(provider);
    const integration = await this.repository.getIntegration(ownerId, provider);
    let revokeAttempted = false;
    let revoked = false;
    if (integration?.tokenReference && adapter.revokeCredentials) {
      try {
        const credentials = this.readCredentials(integration);
        revokeAttempted = true;
        revoked = await adapter.revokeCredentials(credentials);
      } catch {
        // Credential discard is the important local guarantee; revocation is best effort.
      }
    }
    await this.repository.disconnectIntegration(ownerId, provider);
    return { disconnected: true, revokeAttempted, revoked };
  }

  private adapter(provider: IntegrationProvider): ConnectedSourceProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new ConnectedSourceImporterError(`No connected-source adapter is registered for ${provider}.`, { code: 'provider_not_supported' });
    return adapter;
  }

  private assertProvider(provider: string): asserts provider is IntegrationProvider {
    if (!validProvider(provider)) throw new ConnectedSourceImporterError('Unsupported connected-source provider.', { code: 'provider_not_supported' });
  }

  private readCredentials(integration: { tokenReference: string | null; expiresAt: string | null; scopes: string }): IntegrationCredential {
    if (!integration.tokenReference) throw new ConnectedSourceImporterError('This provider is not connected. Connect it before browsing or synchronizing.', { code: 'integration_disconnected' });
    try {
      return credentialFromJson(this.tokenVault.decrypt(integration.tokenReference), integration);
    } catch (cause) {
      if (cause instanceof ConnectedSourceImporterError) throw cause;
      throw new ConnectedSourceImporterError('The saved provider credentials could not be decrypted. Reconnect this source.', { code: 'invalid_credentials', cause });
    }
  }

  private async requireCredentials(ownerId: string, provider: IntegrationProvider, adapter: ConnectedSourceProviderAdapter): Promise<IntegrationCredential> {
    const integration = await this.repository.getIntegration(ownerId, provider);
    if (!integration || integration.status === 'disconnected' || !integration.tokenReference) {
      throw new ConnectedSourceImporterError(`Connect ${providerLabel(provider)} before using this source.`, { code: 'integration_disconnected' });
    }
    const credentials = this.readCredentials(integration);
    const missingScopes = missingProviderScopes(provider, credentials.scopes || integration.scopes);
    if (missingScopes.length) {
      throw new ConnectedSourceImporterError(
        `${providerLabel(provider)} must be reconnected before syncing. Missing scopes: ${missingScopes.join(', ')}.`,
        { code: 'slack_missing_scope', statusCode: 403 },
      );
    }
    const expiresAt = credentials.expiresAt ? Date.parse(credentials.expiresAt) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt > Date.parse(this.now()) + 60_000) return credentials;
    if (!credentials.refreshToken || !adapter.refreshCredentials) {
      await this.repository.saveIntegration({ ...integration, status: 'expired', updatedAt: this.now() });
      throw new ConnectedSourceImporterError(`${providerLabel(provider)} authorization expired. Reconnect the integration.`, { code: 'token_expired' });
    }
    try {
      const refreshed = await adapter.refreshCredentials(credentials);
      if (!refreshed) {
        await this.repository.saveIntegration({ ...integration, status: 'expired', updatedAt: this.now() });
        throw new ConnectedSourceImporterError(`${providerLabel(provider)} authorization expired. Reconnect the integration.`, { code: 'token_expired' });
      }
      const saved: StoreIntegration = {
        ...integration,
        scopes: refreshed.scopes,
        expiresAt: refreshed.expiresAt,
        tokenReference: this.tokenVault.encrypt(JSON.stringify(refreshed)),
        status: 'connected',
        updatedAt: this.now(),
      };
      await this.repository.saveIntegration(saved);
      return refreshed;
    } catch (cause) {
      if (cause instanceof ConnectedSourceImporterError && cause.code === 'token_expired') throw cause;
      await this.repository.saveIntegration({ ...integration, status: 'error', updatedAt: this.now() });
      const details = retryDetails(cause);
      throw new ConnectedSourceImporterError(`${providerLabel(provider)} token refresh failed. Reconnect the integration or retry later.`, { code: details.code, retryable: details.retryable, statusCode: details.statusCode, cause });
    }
  }

  private async noteAuthenticationFailure(ownerId: string, provider: IntegrationProvider, cause: unknown): Promise<void> {
    const details = retryDetails(cause);
    if (details.statusCode !== 401 && !['slack_invalid_auth', 'slack_token_revoked', 'slack_token_expired'].includes(details.code)) return;
    const integration = await this.repository.getIntegration(ownerId, provider);
    if (integration) await this.repository.saveIntegration({ ...integration, status: 'expired', updatedAt: this.now() });
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (cause) {
        lastError = cause;
        if (!retryDetails(cause).retryable || attempt >= this.maxRetries) throw cause;
        await this.sleep(this.retryDelayMs * (attempt + 1));
      }
    }
    throw lastError;
  }

  private async persistItem(source: ConnectedSource, content: RemoteContent): Promise<'imported' | 'updated' | 'unchanged' | 'removed' | 'inaccessible'> {
    const previous = await this.repository.getSourceItem(source.id, content.remoteId, content.path);
    const now = this.now();
    if (content.status === 'removed' || content.status === 'inaccessible') {
      await this.repository.saveSourceItem({
        projectId: source.projectId, sourceId: source.id, remoteId: content.remoteId, path: content.path, name: content.name,
        mimeType: content.mimeType, contentHash: previous?.contentHash ?? null, storagePath: previous?.storagePath ?? null,
        artifactId: previous?.artifactId ?? null, artifactVersionId: previous?.artifactVersionId ?? null, revision: content.revision,
        status: content.status, metadata: content.metadata, lastSeenAt: previous?.lastSeenAt ?? null, unavailableAt: now,
        error: content.error ?? (content.status === 'removed' ? null : 'The provider no longer grants access to this item.'),
      });
      return content.status;
    }
    if (content.status === 'unsupported') {
      const item: NewConnectedSourceItem = {
        projectId: source.projectId, sourceId: source.id, remoteId: content.remoteId, path: content.path, name: content.name,
        mimeType: content.mimeType, contentHash: null, storagePath: null, artifactId: null, artifactVersionId: null,
        revision: content.revision, status: 'unsupported', metadata: content.metadata, lastSeenAt: now, unavailableAt: now,
        error: content.error ?? 'This item type is not supported for import.',
      };
      await this.repository.saveSourceItem(item);
      return previous ? 'updated' : 'imported';
    }
    const artifactInput: ConnectedArtifactVersionInput = {
      projectId: source.projectId, sourceId: source.id, provider: source.provider, path: content.path, name: content.name,
      mimeType: content.mimeType, content: content.content, revision: content.revision, remoteId: content.remoteId, metadata: content.metadata,
    };
    const persisted = await this.repository.persistArtifactVersion(artifactInput);
    await this.repository.saveSourceItem({
      projectId: source.projectId, sourceId: source.id, remoteId: content.remoteId, path: content.path, name: content.name,
      mimeType: content.mimeType, contentHash: persisted.contentHash, storagePath: persisted.storagePath,
      artifactId: persisted.artifactId, artifactVersionId: persisted.artifactVersionId, revision: content.revision,
      status: 'available', metadata: content.metadata, lastSeenAt: now, unavailableAt: null, error: null,
    });
    if (previous?.status === 'available' && previous.contentHash === persisted.contentHash) return 'unchanged';
    return previous ? 'updated' : 'imported';
  }

  private async markItemUnavailable(source: ConnectedSource, remoteId: string, status: 'removed' | 'inaccessible', reason: string | null): Promise<boolean> {
    const items = await this.repository.listSourceItems(source.id);
    let changed = false;
    for (const item of items.filter(candidate => candidate.remoteId === remoteId && candidate.status !== status)) {
      changed = true;
      await this.repository.saveSourceItem({
        projectId: item.projectId, sourceId: item.sourceId, remoteId: item.remoteId, path: item.path, name: item.name,
        mimeType: item.mimeType, contentHash: item.contentHash, storagePath: item.storagePath, artifactId: item.artifactId,
        artifactVersionId: item.artifactVersionId, revision: item.revision, status, metadata: item.metadata,
        lastSeenAt: item.lastSeenAt, unavailableAt: this.now(), error: reason,
      });
    }
    return changed;
  }

  private async failRun(source: ConnectedSource, run: ConnectedSourceSyncRun, cause: unknown, pagesProcessed: number, forceInaccessible: boolean): Promise<never> {
    const details = retryDetails(cause);
    const inaccessible = forceInaccessible || details.statusCode === 403 || ['slack_channel_not_found', 'slack_not_in_channel', 'slack_missing_scope'].includes(details.code);
    const message = details.statusCode === 401
      ? `${providerLabel(source.provider)} rejected the saved authorization. Reconnect ${providerLabel(source.provider)} in Settings, then sync this source again.`
      : details.message || 'Connected source synchronization failed.';
    let updatedSource: ConnectedSource;
    let inaccessibleCount = 0;
    if (inaccessible) {
      inaccessibleCount = await this.repository.markSourceItemsStatus(source.id, 'inaccessible', message);
      updatedSource = await this.repository.updateSource(source.id, { status: 'inaccessible', syncStatus: 'error', lastError: message, lastSyncedAt: this.now() });
    } else {
      updatedSource = await this.repository.updateSource(source.id, { syncStatus: 'error', lastError: message, lastSyncedAt: this.now() });
    }
    const resumable = pagesProcessed > 0 || run.importedCount + run.updatedCount + run.unchangedCount > 0 || (details.retryable && Boolean(run.cursorStart));
    const status = resumable ? 'partial' : 'failure';
    await this.repository.updateSyncRun(run.id, {
      status,
      inaccessibleCount: run.inaccessibleCount + inaccessibleCount,
      errorCode: details.code,
      errorMessage: message,
      retryable: details.retryable,
      completedAt: status === 'failure' ? this.now() : null,
    });
    void updatedSource;
    throw new ConnectedSourceImporterError(message, { code: details.code, retryable: details.retryable, statusCode: details.statusCode, cause });
  }
}

function providerLabel(provider: IntegrationProvider): string {
  return provider === 'google_drive' ? 'Google Drive' : provider === 'github' ? 'GitHub' : 'Slack';
}
