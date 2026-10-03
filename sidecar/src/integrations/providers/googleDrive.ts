import type { IntegrationCredential, BrowseOptions, BrowsePage, ConnectedSource, ConnectedSourceProviderAdapter, RemoteContent, RemoteSyncPage, SyncSnapshot } from '../types.js';
import { bearerHeaders, requestJson, requestResponse, urlWithQuery, type SourceHttpClient, fetchSourceHttpClient } from '../http.js';

type GoogleDriveOptions = { http?: SourceHttpClient; env?: NodeJS.ProcessEnv; maxFileBytes?: number };
type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string; version?: string; headRevisionId?: string; webViewLink?: string; parents?: string[]; size?: string; trashed?: boolean };

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const MAX_TRACKED_FOLDERS = 500;
const NATIVE_GOOGLE = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
]);

function oauthClient(env: NodeJS.ProcessEnv): { clientId: string; clientSecret: string } {
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error('Google Drive OAuth is not configured.');
  return { clientId, clientSecret };
}

function itemPath(file: DriveFile): string {
  const name = file.name.replace(/[\\/\u0000-\u001f]/g, '_');
  return `${file.id}/${name || file.id}`;
}

function revision(file: DriveFile): string | null {
  return file.headRevisionId ?? file.version ?? file.modifiedTime ?? null;
}

function exportMime(file: DriveFile): string {
  if (file.mimeType === 'application/vnd.google-apps.spreadsheet') return 'text/csv';
  if (file.mimeType === 'application/vnd.google-apps.presentation') return 'text/plain';
  return 'text/plain';
}

export class GoogleDriveConnectedSourceAdapter implements ConnectedSourceProviderAdapter {
  readonly provider = 'google_drive' as const;
  private readonly http: SourceHttpClient;
  private readonly env: NodeJS.ProcessEnv;
  private readonly maxFileBytes: number;

  constructor(options: GoogleDriveOptions = {}) {
    this.http = options.http ?? fetchSourceHttpClient;
    this.env = options.env ?? process.env;
    this.maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024;
  }

  private headers(token: string): Record<string, string> {
    return bearerHeaders(token, { Accept: 'application/json' });
  }

  async browse(credentials: IntegrationCredential, options: BrowseOptions = {}): Promise<BrowsePage> {
    const perPage = Math.max(1, Math.min(1000, options.pageSize ?? 100));
    const queryParts = ['trashed = false'];
    if (options.remoteId) queryParts.push(`'${options.remoteId.replace(/'/g, "\\'")}' in parents`);
    if (options.query?.trim()) {
      const needle = options.query.replace(/'/g, "\\'");
      queryParts.push(`name contains '${needle}'`);
    }
    const result = await requestJson<{ files?: DriveFile[]; nextPageToken?: string }>(this.http, urlWithQuery(`${DRIVE_API}/files`, {
      q: queryParts.join(' and '),
      pageSize: perPage,
      pageToken: options.cursor ?? undefined,
      orderBy: 'folder,name',
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,version,headRevisionId,webViewLink,parents,size,trashed)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    }), { headers: this.headers(credentials.accessToken) }, 'Google Drive browse');
    return {
      items: (result.files ?? []).map(file => ({
        id: file.id,
        name: file.name,
        kind: file.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
        mimeType: file.mimeType,
        remoteUrl: file.webViewLink ?? null,
        revision: revision(file),
        metadata: { parentIds: file.parents ?? [], modifiedTime: file.modifiedTime ?? null, version: file.version ?? null, headRevisionId: file.headRevisionId ?? null, size: file.size ? Number(file.size) : null },
      })),
      nextCursor: result.nextPageToken ?? null,
    };
  }

  async prepareSync(credentials: IntegrationCredential, source: ConnectedSource): Promise<SyncSnapshot> {
    if (source.syncCursor && Object.keys(source.syncCursor).length) return { remoteRevision: source.remoteRevision, cursor: source.syncCursor };
    const token = await requestJson<{ startPageToken?: string }>(this.http, `${DRIVE_API}/changes/startPageToken?supportsAllDrives=true`, { headers: this.headers(credentials.accessToken) }, 'Google Drive sync cursor');
    const startPageToken = token.startPageToken;
    if (!startPageToken) throw new Error('Google Drive did not return an initial change cursor.');
    return { remoteRevision: source.remoteRevision, cursor: { mode: 'baseline', startPageToken, pageToken: null } };
  }

  async listItems(credentials: IntegrationCredential, source: ConnectedSource, snapshot: SyncSnapshot, cursor: Record<string, unknown> | null): Promise<RemoteSyncPage> {
    const current = cursor ?? snapshot.cursor;
    const mode = String(current?.mode ?? 'baseline');
    if (mode === 'changes') return this.listChanges(credentials, source, current ?? {});
    return this.listBaseline(credentials, source, current);
  }

  private async listBaseline(credentials: IntegrationCredential, source: ConnectedSource, cursor: Record<string, unknown> | null): Promise<RemoteSyncPage> {
    const perPage = 100;
    const startPageToken = String(cursor?.startPageToken ?? '');
    const pageToken = cursor?.pageToken == null ? null : String(cursor.pageToken);
    const selectedKind = String(source.selectedScope.resourceKind ?? 'folder');
    let files: DriveFile[] = [];
    let nextPageToken: string | undefined;
    let activeFolder = String(cursor?.activeFolder ?? source.remoteId);
    const folderQueue = Array.isArray(cursor?.folderQueue) ? cursor.folderQueue.filter((id): id is string => typeof id === 'string') : [];
    const folderIds = new Set(Array.isArray(cursor?.folderIds) ? cursor.folderIds.filter((id): id is string => typeof id === 'string') : [source.remoteId]);
    if (selectedKind === 'file') {
      if (pageToken) return { items: [], nextCursor: { mode: 'changes', pageToken: startPageToken, folderIds: [...folderIds] }, done: true, completeSnapshot: true };
      const file = await this.getFile(credentials, source.remoteId);
      files = [file];
    } else {
      const query = [`'${activeFolder.replace(/'/g, "\\'")}' in parents`, 'trashed = false'].join(' and ');
      const result = await requestJson<{ files?: DriveFile[]; nextPageToken?: string }>(this.http, urlWithQuery(`${DRIVE_API}/files`, {
        q: query, pageSize: perPage, pageToken: pageToken ?? undefined, orderBy: 'name',
        fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,version,headRevisionId,webViewLink,parents,size,trashed)',
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      }), { headers: this.headers(credentials.accessToken) }, 'Google Drive source list');
      files = result.files ?? [];
      nextPageToken = result.nextPageToken;
      const childFolders = files.filter(file => file.mimeType === 'application/vnd.google-apps.folder');
      for (const folder of childFolders) {
        if (folderIds.has(folder.id)) continue;
        if (folderIds.size >= MAX_TRACKED_FOLDERS) throw new Error(`Google Drive folder scope exceeds the ${MAX_TRACKED_FOLDERS} folder sync limit.`);
        folderIds.add(folder.id);
        folderQueue.push(folder.id);
      }
      files = files.filter(file => file.mimeType !== 'application/vnd.google-apps.folder');
    }
    const items = await Promise.all(files.map(file => this.toRemoteContent(credentials, source, file)));
    if (nextPageToken) return { items, nextCursor: { mode: 'baseline', startPageToken, pageToken: nextPageToken, activeFolder, folderQueue, folderIds: [...folderIds] }, done: false };
    if (folderQueue.length > 0) {
      activeFolder = folderQueue.shift()!;
      return { items, nextCursor: { mode: 'baseline', startPageToken, pageToken: null, activeFolder, folderQueue, folderIds: [...folderIds] }, done: false };
    }
    return { items, nextCursor: { mode: 'changes', pageToken: startPageToken, folderIds: [...folderIds] }, done: true, completeSnapshot: true };
  }

  private async listChanges(credentials: IntegrationCredential, source: ConnectedSource, cursor: Record<string, unknown>): Promise<RemoteSyncPage> {
    const pageToken = String(cursor.pageToken ?? '');
    const result = await requestJson<{ changes?: Array<{ fileId: string; removed?: boolean; file?: DriveFile }>; nextPageToken?: string; newStartPageToken?: string }>(
      this.http,
      urlWithQuery(`${DRIVE_API}/changes`, { pageToken, pageSize: 100, includeRemoved: true, supportsAllDrives: true, includeItemsFromAllDrives: true, fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,modifiedTime,version,headRevisionId,webViewLink,parents,size,trashed))' }),
      { headers: this.headers(credentials.accessToken) },
      'Google Drive change list',
    );
    const deletedRemoteIds: string[] = [];
    const files: DriveFile[] = [];
    const selectedKind = String(source.selectedScope.resourceKind ?? 'folder');
    const folderIds = new Set(Array.isArray(cursor.folderIds) ? cursor.folderIds.filter((id): id is string => typeof id === 'string') : [source.remoteId]);
    const changes = result.changes ?? [];
    const newFolders: DriveFile[] = [];

    // Drive's changes feed is not guaranteed to put a parent folder before
    // its children. Expand the selected folder set to a fixed point, then
    // baseline every newly discovered subtree before resuming the cursor.
    if (selectedKind !== 'file') {
      let discovered = true;
      while (discovered) {
        discovered = false;
        for (const change of changes) {
          const file = change.file;
          if (change.removed || file?.trashed || file?.mimeType !== 'application/vnd.google-apps.folder' || folderIds.has(change.fileId)) continue;
          if (!(file.parents?.some(parent => folderIds.has(parent)) ?? false)) continue;
          if (folderIds.size >= MAX_TRACKED_FOLDERS) throw new Error(`Google Drive folder scope exceeds the ${MAX_TRACKED_FOLDERS} folder sync limit.`);
          folderIds.add(change.fileId);
          newFolders.push(file);
          discovered = true;
        }
      }
    }

    const newFolderIds = new Set(newFolders.map(folder => folder.id));
    for (const change of changes) {
      if (change.removed || change.file?.trashed) {
        deletedRemoteIds.push(change.fileId);
        continue;
      }
      if (!change.file || change.file.mimeType === 'application/vnd.google-apps.folder') continue;
      const isSelected = selectedKind === 'file'
        ? change.fileId === source.remoteId
        : change.file.parents?.some(parent => folderIds.has(parent)) ?? false;
      if (!isSelected) deletedRemoteIds.push(change.fileId);
      else if (!(change.file.parents?.some(parent => newFolderIds.has(parent)) ?? false)) files.push(change.file);
    }
    const items = await Promise.all(files.map(file => this.toRemoteContent(credentials, source, file)));
    const resumePageToken = result.nextPageToken ?? result.newStartPageToken ?? pageToken;
    if (newFolders.length > 0) {
      const [activeFolder, ...folderQueue] = newFolders.map(folder => folder.id);
      return {
        items,
        deletedRemoteIds,
        nextCursor: { mode: 'baseline', startPageToken: resumePageToken, pageToken: null, activeFolder, folderQueue, folderIds: [...folderIds] },
        done: false,
      };
    }
    if (result.nextPageToken) return { items, deletedRemoteIds, nextCursor: { mode: 'changes', pageToken: result.nextPageToken, folderIds: [...folderIds] }, done: false };
    return { items, deletedRemoteIds, nextCursor: { mode: 'changes', pageToken: result.newStartPageToken ?? pageToken, folderIds: [...folderIds] }, done: true };
  }

  private async getFile(credentials: IntegrationCredential, id: string): Promise<DriveFile> {
    return requestJson<DriveFile>(this.http, urlWithQuery(`${DRIVE_API}/files/${encodeURIComponent(id)}`, { fields: 'id,name,mimeType,modifiedTime,version,headRevisionId,webViewLink,parents,size,trashed' }), { headers: this.headers(credentials.accessToken) }, 'Google Drive file lookup');
  }

  private async toRemoteContent(credentials: IntegrationCredential, source: ConnectedSource, file: DriveFile): Promise<RemoteContent> {
    const nativeGoogle = NATIVE_GOOGLE.has(file.mimeType);
    const contentType = nativeGoogle ? exportMime(file) : file.mimeType || 'application/octet-stream';
    const name = nativeGoogle ? `${file.name}${file.mimeType.endsWith('spreadsheet') ? '.csv' : file.mimeType.endsWith('presentation') ? '.txt' : '.txt'}` : file.name;
    const path = itemPath({ ...file, name });
    if (Number(file.size ?? 0) > this.maxFileBytes) {
      return { remoteId: file.id, path, name, mimeType: contentType, revision: revision(file), content: new Uint8Array(), status: 'unsupported', error: `File exceeds the ${this.maxFileBytes} byte import limit.`, metadata: { fileId: file.id, originalName: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime ?? null, exportMimeType: nativeGoogle ? contentType : null, parentIds: file.parents ?? [], webViewLink: file.webViewLink ?? null } };
    }
    const url = nativeGoogle
      ? urlWithQuery(`${DRIVE_API}/files/${encodeURIComponent(file.id)}/export`, { mimeType: contentType })
      : `${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`;
    const response = await requestResponse(this.http, url, { headers: this.headers(credentials.accessToken) }, 'Google Drive file download');
    const content = new Uint8Array(await response.arrayBuffer());
    if (content.byteLength > this.maxFileBytes) {
      return { remoteId: file.id, path, name, mimeType: contentType, revision: revision(file), content: new Uint8Array(), status: 'unsupported', error: `File exceeds the ${this.maxFileBytes} byte import limit.`, metadata: { fileId: file.id, originalName: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime ?? null, exportMimeType: nativeGoogle ? contentType : null, parentIds: file.parents ?? [], webViewLink: file.webViewLink ?? null } };
    }
    return {
      remoteId: file.id,
      path,
      name,
      mimeType: contentType,
      revision: revision(file),
      content,
      metadata: { fileId: file.id, originalName: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime ?? null, version: file.version ?? null, headRevisionId: file.headRevisionId ?? null, exportMimeType: nativeGoogle ? contentType : null, parentIds: file.parents ?? [], webViewLink: file.webViewLink ?? null },
    };
  }

  async refreshCredentials(credentials: IntegrationCredential): Promise<IntegrationCredential | null> {
    if (!credentials.refreshToken) return null;
    const { clientId, clientSecret } = oauthClient(this.env);
    const response = await requestResponse(this.http, 'https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: credentials.refreshToken, grant_type: 'refresh_token' }).toString(),
    }, 'Google OAuth refresh');
    const body = await response.json() as { access_token?: string; expires_in?: number; scope?: string; refresh_token?: string };
    if (!body.access_token) return null;
    return { accessToken: body.access_token, refreshToken: body.refresh_token ?? credentials.refreshToken, expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : credentials.expiresAt, scopes: body.scope ?? credentials.scopes };
  }

  async revokeCredentials(credentials: IntegrationCredential): Promise<boolean> {
    const response = await this.http.fetch(urlWithQuery('https://oauth2.googleapis.com/revoke', { token: credentials.refreshToken ?? credentials.accessToken }), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    return response.ok || response.status === 400;
  }
}

export function createGoogleDriveAdapter(options: GoogleDriveOptions = {}): GoogleDriveConnectedSourceAdapter {
  return new GoogleDriveConnectedSourceAdapter(options);
}
