import type { StoreIntegration } from '../store/types.js';
import type { IntegrationProvider, OAuthTokens } from './oauthConfig.js';

export type ConnectedSourceStatus = 'active' | 'removed' | 'inaccessible' | 'disconnected';
export type ConnectedSourceItemStatus = 'available' | 'removed' | 'inaccessible' | 'unsupported';
export type ConnectedSourceSyncStatus = 'idle' | 'syncing' | 'ready' | 'error';
export type ConnectedSourceSyncRunStatus = 'queued' | 'running' | 'partial' | 'success' | 'failure' | 'cancelled';

export type ConnectedSource = {
  id: string;
  projectId: string;
  integrationId: string;
  provider: IntegrationProvider;
  kind: 'github_repository' | 'google_drive' | 'slack_channel';
  remoteId: string;
  remoteUrl: string | null;
  name: string;
  selectedScope: Record<string, unknown>;
  remoteRevision: string | null;
  syncCursor: Record<string, unknown> | null;
  status: ConnectedSourceStatus;
  syncStatus: ConnectedSourceSyncStatus;
  lastSyncedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConnectedSourceItem = {
  id: string;
  projectId: string;
  sourceId: string;
  remoteId: string | null;
  path: string;
  name: string;
  mimeType: string | null;
  contentHash: string | null;
  storagePath: string | null;
  artifactId: string | null;
  artifactVersionId: string | null;
  revision: string | null;
  status: ConnectedSourceItemStatus;
  metadata: Record<string, unknown>;
  lastSeenAt: string | null;
  unavailableAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConnectedSourceSyncRun = {
  id: string;
  projectId: string;
  sourceId: string;
  status: ConnectedSourceSyncRunStatus;
  idempotencyKey: string;
  remoteRevision: string | null;
  cursorStart: Record<string, unknown> | null;
  cursorEnd: Record<string, unknown> | null;
  attemptCount: number;
  importedCount: number;
  updatedCount: number;
  unchangedCount: number;
  removedCount: number;
  inaccessibleCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type IntegrationCredential = OAuthTokens;

export type BrowseOptions = {
  remoteId?: string;
  cursor?: string | null;
  query?: string;
  pageSize?: number;
};

export type BrowseEntry = {
  id: string;
  name: string;
  kind: 'repository' | 'branch' | 'folder' | 'file' | 'workspace' | 'channel';
  mimeType?: string | null;
  remoteUrl?: string | null;
  revision?: string | null;
  metadata?: Record<string, unknown>;
};

export type BrowsePage = { items: BrowseEntry[]; nextCursor: string | null };

export type RemoteContent = {
  remoteId: string;
  path: string;
  name: string;
  mimeType: string;
  revision: string | null;
  content: Uint8Array;
  metadata: Record<string, unknown>;
  status?: ConnectedSourceItemStatus;
  error?: string | null;
};

export type RemoteSyncPage = {
  items: RemoteContent[];
  deletedRemoteIds?: string[];
  inaccessibleRemoteIds?: string[];
  nextCursor: Record<string, unknown> | null;
  /** True means the adapter enumerated the entire current source snapshot. */
  completeSnapshot?: boolean;
  done: boolean;
};

export type SyncSnapshot = {
  remoteRevision: string | null;
  cursor: Record<string, unknown> | null;
};

export type ConnectedSourceProviderAdapter = {
  provider: IntegrationProvider;
  browse(credentials: IntegrationCredential, options?: BrowseOptions): Promise<BrowsePage>;
  prepareSync(credentials: IntegrationCredential, source: ConnectedSource): Promise<SyncSnapshot>;
  isSourceRevisionUnchanged?(source: ConnectedSource, snapshot: SyncSnapshot): boolean;
  listItems(credentials: IntegrationCredential, source: ConnectedSource, snapshot: SyncSnapshot, cursor: Record<string, unknown> | null): Promise<RemoteSyncPage>;
  refreshCredentials?(credentials: IntegrationCredential): Promise<IntegrationCredential | null>;
  revokeCredentials?(credentials: IntegrationCredential): Promise<boolean>;
};

export type NewConnectedSource = Pick<ConnectedSource,
  'projectId' | 'integrationId' | 'provider' | 'kind' | 'remoteId' | 'remoteUrl' | 'name' | 'selectedScope'
>;

export type NewConnectedSourceItem = Omit<ConnectedSourceItem, 'id' | 'createdAt' | 'updatedAt'>;

export type ConnectedArtifactVersionInput = {
  projectId: string;
  sourceId: string;
  provider: IntegrationProvider;
  path: string;
  name: string;
  mimeType: string;
  content: Uint8Array;
  revision: string | null;
  remoteId: string | null;
  metadata: Record<string, unknown>;
};

export type PersistedConnectedArtifact = {
  artifactId: string;
  artifactVersionId: string;
  contentHash: string;
  storagePath: string;
  unchanged: boolean;
};

export interface ConnectedSourceRepository {
  getIntegration(ownerId: string, provider: IntegrationProvider): Promise<StoreIntegration | null>;
  saveIntegration(input: StoreIntegration): Promise<void>;
  listSources(projectId: string): Promise<ConnectedSource[]>;
  getSource(projectId: string, sourceId: string): Promise<ConnectedSource | null>;
  saveSource(input: NewConnectedSource): Promise<ConnectedSource>;
  updateSource(sourceId: string, patch: Partial<Pick<ConnectedSource, 'remoteRevision' | 'syncCursor' | 'status' | 'syncStatus' | 'lastSyncedAt' | 'lastSuccessfulSyncAt' | 'lastError'>>): Promise<ConnectedSource>;
  listSourceItems(sourceId: string): Promise<ConnectedSourceItem[]>;
  getSourceItem(sourceId: string, remoteId: string | null, path: string): Promise<ConnectedSourceItem | null>;
  saveSourceItem(item: NewConnectedSourceItem): Promise<ConnectedSourceItem>;
  markMissingItems(sourceId: string, seenRemoteIds: Set<string>): Promise<number>;
  markSourceItemsStatus(sourceId: string, status: ConnectedSourceItemStatus, reason: string): Promise<number>;
  startSyncRun(source: ConnectedSource, idempotencyKey: string, snapshot?: SyncSnapshot | null): Promise<ConnectedSourceSyncRun>;
  listSyncRuns(sourceId: string): Promise<ConnectedSourceSyncRun[]>;
  getSyncRun(runId: string): Promise<ConnectedSourceSyncRun | null>;
  updateSyncRun(runId: string, patch: Partial<Pick<ConnectedSourceSyncRun, 'status' | 'remoteRevision' | 'cursorStart' | 'cursorEnd' | 'attemptCount' | 'importedCount' | 'updatedCount' | 'unchangedCount' | 'removedCount' | 'inaccessibleCount' | 'errorCode' | 'errorMessage' | 'retryable' | 'startedAt' | 'completedAt'>>): Promise<ConnectedSourceSyncRun>;
  persistArtifactVersion(input: ConnectedArtifactVersionInput): Promise<PersistedConnectedArtifact>;
  disconnectIntegration(ownerId: string, provider: IntegrationProvider): Promise<void>;
}

export type ConnectedSourceSyncResult = {
  source: ConnectedSource;
  run: ConnectedSourceSyncRun;
  complete: boolean;
  imported: number;
  updated: number;
  unchanged: number;
  removed: number;
  inaccessible: number;
};

export type ConnectedSourceStatusResult = {
  provider: IntegrationProvider;
  connected: boolean;
  accountLabel: string | null;
  accountId: string | null;
  scopes: string[];
  expiresAt: string | null;
  status: string;
  reauthorizationRequired: boolean;
  missingScopes: string[];
  sources: ConnectedSource[];
};

export type CredentialUpdater = (provider: IntegrationProvider, input: StoreIntegration) => Promise<void>;

export type ConnectedSourceStartInput = {
  ownerId: string;
  projectId: string;
  provider: IntegrationProvider;
  remoteId: string;
  remoteUrl?: string | null;
  name: string;
  kind: ConnectedSource['kind'];
  selectedScope?: Record<string, unknown>;
  sync?: boolean;
  idempotencyKey?: string;
};

export type ConnectedSourceSyncInput = {
  ownerId: string;
  projectId: string;
  sourceId: string;
  idempotencyKey?: string;
  runId?: string;
  maxPages?: number;
  force?: boolean;
};
