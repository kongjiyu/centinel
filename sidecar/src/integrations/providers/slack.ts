import type { IntegrationCredential, BrowseOptions, BrowsePage, ConnectedSource, ConnectedSourceProviderAdapter, RemoteContent, RemoteSyncPage, SyncSnapshot } from '../types.js';
import { bearerHeaders, requestJson, requestResponse, urlWithQuery, type SourceHttpClient, fetchSourceHttpClient } from '../http.js';
import { ConnectedSourceHttpError } from '../http.js';
import { slackMessageToMarkdown } from '../slackMarkdown.js';

type SlackOptions = { http?: SourceHttpClient; env?: NodeJS.ProcessEnv; maxFileBytes?: number; pageSize?: number; fullReconciliationIntervalMs?: number; now?: () => number };
type SlackResponse<T> = T & { ok?: boolean; error?: string; response_metadata?: { next_cursor?: string } };
type SlackChannel = { id: string; name: string; is_private?: boolean; is_archived?: boolean; num_members?: number; topic?: { value?: string }; purpose?: { value?: string } };
type SlackFile = { id: string; name?: string; title?: string; mimetype?: string; filetype?: string; size?: number; url_private_download?: string; url_private?: string; permalink?: string };
type SlackMessage = { type?: string; user?: string; username?: string; ts?: string; text?: string; thread_ts?: string; reply_count?: number; files?: SlackFile[]; subtype?: string };

function oauthClient(env: NodeJS.ProcessEnv): { clientId: string; clientSecret: string } {
  const clientId = env.SLACK_CLIENT_ID?.trim();
  const clientSecret = env.SLACK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error('Slack OAuth is not configured.');
  return { clientId, clientSecret };
}

function cursor(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function maxTs(values: Array<string | undefined>, fallback: string | null): string | null {
  const candidates = values.filter((value): value is string => Boolean(value));
  if (fallback) candidates.push(fallback);
  return candidates.sort((a, b) => Number(a) - Number(b)).at(-1) ?? null;
}

function isoTime(ts: string | undefined): string | null {
  if (!ts) return null;
  const milliseconds = Number.parseFloat(ts) * 1000;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function safeName(value: string | undefined, fallback: string): string {
  return (value || fallback).replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 180) || fallback;
}

function supportsTextFile(file: SlackFile): boolean {
  const type = (file.mimetype ?? '').toLowerCase();
  const extension = (file.name ?? '').slice((file.name ?? '').lastIndexOf('.')).toLowerCase();
  return type.startsWith('text/') || ['.md', '.markdown', '.txt', '.json', '.csv', '.yaml', '.yml', '.xml', '.html', '.log'].includes(extension);
}

function messagePermalink(workspaceUrl: string | null, channelId: string, timestamp: string): string | null {
  if (!workspaceUrl || !timestamp) return null;
  try {
    const url = new URL(workspaceUrl);
    if (!url.hostname.endsWith('.slack.com')) return null;
    const compactTimestamp = timestamp.replace('.', '');
    return `${url.origin}/archives/${encodeURIComponent(channelId)}/p${compactTimestamp}`;
  } catch {
    return null;
  }
}

export class SlackConnectedSourceAdapter implements ConnectedSourceProviderAdapter {
  readonly provider = 'slack' as const;
  private readonly http: SourceHttpClient;
  private readonly env: NodeJS.ProcessEnv;
  private readonly maxFileBytes: number;
  private readonly pageSize: number;
  private readonly fullReconciliationIntervalMs: number;
  private readonly now: () => number;

  constructor(options: SlackOptions = {}) {
    this.http = options.http ?? fetchSourceHttpClient;
    this.env = options.env ?? process.env;
    this.maxFileBytes = options.maxFileBytes ?? 2 * 1024 * 1024;
    this.pageSize = Math.max(1, Math.min(200, options.pageSize ?? 100));
    this.fullReconciliationIntervalMs = Math.max(60_000, options.fullReconciliationIntervalMs ?? 24 * 60 * 60 * 1000);
    this.now = options.now ?? (() => Date.now());
  }

  private headers(accessToken: string): Record<string, string> {
    return bearerHeaders(accessToken, { Accept: 'application/json' });
  }

  private async api<T>(method: string, accessToken: string, query: Record<string, string | number | boolean | undefined | null> = {}): Promise<SlackResponse<T>> {
    const body = await requestJson<SlackResponse<T>>(this.http, urlWithQuery(`https://slack.com/api/${method}`, query), { headers: this.headers(accessToken) }, `Slack ${method}`);
    if (body.ok === false) {
      const error = body.error ?? 'provider_error';
      throw new ConnectedSourceHttpError(`Slack ${method} failed (${error}).`, { code: `slack_${error}`, retryable: error === 'ratelimited' || error === 'internal_error' });
    }
    return body;
  }

  async browse(credentials: IntegrationCredential, options: BrowseOptions = {}): Promise<BrowsePage> {
    const result = await this.api<{ channels?: SlackChannel[]; response_metadata?: { next_cursor?: string } }>('conversations.list', credentials.accessToken, {
      types: 'public_channel,private_channel', exclude_archived: true, limit: Math.max(1, Math.min(200, options.pageSize ?? this.pageSize)),
      cursor: options.cursor ?? undefined,
    });
    const query = options.query?.trim().toLowerCase();
    const items = (result.channels ?? []).filter(channel => !query || channel.name.toLowerCase().includes(query)).map(channel => ({
      id: channel.id,
      name: `#${channel.name}`,
      kind: 'channel' as const,
      remoteUrl: null,
      metadata: { isPrivate: channel.is_private ?? false, isArchived: channel.is_archived ?? false, memberCount: channel.num_members ?? null, topic: channel.topic?.value ?? '', purpose: channel.purpose?.value ?? '' },
    }));
    return { items, nextCursor: cursor(result.response_metadata?.next_cursor) };
  }

  async prepareSync(credentials: IntegrationCredential, source: ConnectedSource): Promise<SyncSnapshot> {
    const identity = await this.api<{ team_id?: string; team?: string; url?: string }>('auth.test', credentials.accessToken);
    const lastTs = cursor(source.syncCursor?.newestTs);
    const storedWorkspace = cursor(source.syncCursor?.workspaceId);
    const lastFullReconciliationAt = cursor(source.syncCursor?.lastFullReconciliationAt);
    const lastFullTime = lastFullReconciliationAt ? Date.parse(lastFullReconciliationAt) : NaN;
    const fullReconciliationDue = !lastTs || !Number.isFinite(lastFullTime) || this.now() - lastFullTime >= this.fullReconciliationIntervalMs;
    return {
      remoteRevision: lastTs,
      cursor: {
        mode: fullReconciliationDue ? 'baseline' : 'incremental',
        pageToken: null,
        oldest: fullReconciliationDue ? null : lastTs,
        newestTs: lastTs,
        lastFullReconciliationAt,
        workspaceId: storedWorkspace ?? identity.team_id ?? null,
        workspaceName: cursor(source.syncCursor?.workspaceName) ?? identity.team ?? null,
        workspaceUrl: cursor(source.syncCursor?.workspaceUrl) ?? identity.url ?? null,
      },
    };
  }

  async listItems(credentials: IntegrationCredential, source: ConnectedSource, snapshot: SyncSnapshot, position: Record<string, unknown> | null): Promise<RemoteSyncPage> {
    const current = position ?? snapshot.cursor ?? {};
    const mode = String(current.mode ?? snapshot.cursor?.mode ?? 'baseline');
    const priorTs = cursor(current.newestTs) ?? cursor(snapshot.cursor?.newestTs);
    const oldest = cursor(current.oldest) ?? cursor(snapshot.cursor?.oldest);
    const pageToken = cursor(current.pageToken);
    const lastFullReconciliationAt = cursor(current.lastFullReconciliationAt) ?? cursor(snapshot.cursor?.lastFullReconciliationAt);
    const result = await this.api<{ messages?: SlackMessage[]; has_more?: boolean; response_metadata?: { next_cursor?: string } }>('conversations.history', credentials.accessToken, {
      channel: source.remoteId,
      limit: this.pageSize,
      cursor: pageToken ?? undefined,
      oldest: mode === 'incremental' ? oldest ?? undefined : undefined,
      inclusive: mode === 'incremental' && Boolean(oldest),
    });
    const rawMessages = result.messages ?? [];
    const messages: SlackMessage[] = [];
    for (const message of rawMessages) {
      if (!message.ts) continue;
      messages.push(message);
      if (!message.thread_ts && (message.reply_count ?? 0) > 0) {
        const replies = await this.api<{ messages?: SlackMessage[] }>('conversations.replies', credentials.accessToken, {
          channel: source.remoteId, ts: message.ts, limit: 100,
        });
        messages.push(...(replies.messages ?? []).filter(reply => reply.ts && reply.ts !== message.ts));
      }
    }

    const workspaceId = cursor(current.workspaceId) ?? cursor(source.selectedScope.workspaceId);
    const workspaceName = cursor(current.workspaceName) ?? cursor(source.selectedScope.workspaceName);
    const workspaceUrl = cursor(current.workspaceUrl) ?? cursor(source.selectedScope.workspaceUrl);
    const contents = (await Promise.all(messages.map(message => this.toRemoteContents(credentials, source, message, workspaceId, workspaceName, workspaceUrl)))).flat();
    const newestTs = maxTs(messages.map(message => message.ts), priorTs);
    const nextPageToken = cursor(result.response_metadata?.next_cursor);
    if (result.has_more && !nextPageToken) throw new ConnectedSourceHttpError('Slack indicated another page but did not return a cursor.', { code: 'missing_cursor' });
    const done = !nextPageToken && !result.has_more;
    const nextCursor = done
      ? { mode: 'incremental', pageToken: null, oldest: newestTs, newestTs, lastFullReconciliationAt: mode === 'baseline' ? new Date(this.now()).toISOString() : lastFullReconciliationAt, workspaceId, workspaceName, workspaceUrl }
      : { mode, pageToken: nextPageToken, oldest, newestTs, lastFullReconciliationAt, workspaceId, workspaceName, workspaceUrl };
    return {
      items: contents,
      nextCursor,
      done,
      completeSnapshot: done && mode === 'baseline',
    };
  }

  private async toRemoteContents(credentials: IntegrationCredential, source: ConnectedSource, message: SlackMessage, workspaceId: string | null, workspaceName: string | null, workspaceUrl: string | null): Promise<RemoteContent[]> {
    const timestamp = message.ts ?? '';
    const parent = !message.thread_ts || message.thread_ts === timestamp;
    const threadTs = parent ? timestamp : message.thread_ts!;
    const remoteId = `${source.remoteId}:${timestamp}`;
    const date = isoTime(timestamp);
    const channelName = String(source.selectedScope.channelName ?? source.name ?? source.remoteId).replace(/^#/, '');
    const permalink = messagePermalink(workspaceUrl, source.remoteId, timestamp);
    const attachments: Record<string, unknown>[] = [];
    const attachmentContents: Array<{ file: SlackFile; bytes: Uint8Array }> = [];
    const unavailableAttachments: RemoteContent[] = [];
    for (const file of message.files ?? []) {
      const info = { id: file.id, name: file.name ?? file.title ?? file.id, mimeType: file.mimetype ?? null, size: file.size ?? null, permalink: file.permalink ?? null };
      attachments.push(info);
      if (!supportsTextFile(file)) continue;
      const attachmentPath = `${source.remoteId}/attachments/${file.id}/${safeName(file.name, file.id)}`;
      const attachmentMetadata = {
        provider: 'slack', workspaceId, workspaceName, workspaceUrl, channelId: source.remoteId, channelName,
        messageTs: timestamp, threadTs, authorId: message.user ?? null, attachedToMessage: remoteId,
        permalink: file.permalink ?? null, messagePermalink: permalink,
      };
      if ((file.size ?? 0) > this.maxFileBytes) {
        unavailableAttachments.push({ remoteId: `file:${file.id}`, path: attachmentPath, name: safeName(file.name, file.id), mimeType: file.mimetype ?? 'text/plain', revision: timestamp, content: new Uint8Array(), status: 'unsupported', error: `Attachment exceeds the ${this.maxFileBytes} byte import limit.`, metadata: attachmentMetadata });
        continue;
      }
      if (!file.url_private_download) {
        unavailableAttachments.push({ remoteId: `file:${file.id}`, path: attachmentPath, name: safeName(file.name, file.id), mimeType: file.mimetype ?? 'text/plain', revision: timestamp, content: new Uint8Array(), status: 'inaccessible', error: 'Slack did not provide a downloadable attachment URL.', metadata: attachmentMetadata });
        continue;
      }
      try {
        const response = await requestResponse(this.http, file.url_private_download, { headers: this.headers(credentials.accessToken) }, 'Slack attachment download');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > this.maxFileBytes) {
          unavailableAttachments.push({ remoteId: `file:${file.id}`, path: attachmentPath, name: safeName(file.name, file.id), mimeType: file.mimetype ?? 'text/plain', revision: timestamp, content: new Uint8Array(), status: 'unsupported', error: `Attachment exceeds the ${this.maxFileBytes} byte import limit.`, metadata: attachmentMetadata });
        } else attachmentContents.push({ file, bytes });
      } catch (cause) {
        if (cause instanceof ConnectedSourceHttpError && [403, 404].includes(cause.statusCode ?? 0)) {
          unavailableAttachments.push({ remoteId: `file:${file.id}`, path: attachmentPath, name: safeName(file.name, file.id), mimeType: file.mimetype ?? 'text/plain', revision: timestamp, content: new Uint8Array(), status: 'inaccessible', error: 'The provider no longer grants access to this attachment.', metadata: attachmentMetadata });
          continue;
        }
        throw cause;
      }
    }
    const formatted = slackMessageToMarkdown(message, userId => userId ?? message.username ?? 'unknown');
    const body = [
      `# ${parent ? 'Slack message' : 'Slack thread reply'}`,
      '',
      `Workspace: ${workspaceName ?? workspaceId ?? 'unknown'}`,
      `Channel: #${channelName}`,
      `Author: ${message.user ?? message.username ?? 'unknown'}`,
      `Timestamp: ${date ?? timestamp}`,
      ...(parent && (message.reply_count ?? 0) > 0 ? [`Thread replies: ${message.reply_count}`] : []),
      ...(permalink ? [`Permalink: ${permalink}`] : []),
      '',
      formatted,
      ...(attachments.length ? ['', 'Attachments:', ...attachments.map(file => `- ${String(file.name)}${file.permalink ? ` (${String(file.permalink)})` : ''}`)] : []),
    ].join('\n');
    const content: RemoteContent = {
      remoteId,
      path: `${source.remoteId}/${threadTs}/${timestamp}.md`,
      name: `${channelName}-${timestamp}${parent ? '' : '-reply'}.md`,
      mimeType: 'text/markdown',
      revision: timestamp,
      content: new TextEncoder().encode(body),
      metadata: {
        provider: 'slack', workspaceId, workspaceName, workspaceUrl, channelId: source.remoteId, channelName,
        messageTs: timestamp, threadTs, parentMessage: parent, authorId: message.user ?? null,
        authorName: message.username ?? null, createdAt: date, permalink, attachments,
      },
    };
    const contents: RemoteContent[] = [content, ...unavailableAttachments];
    // A Slack file is a separate immutable artifact with its own remote identity.
    for (const { file, bytes } of attachmentContents) {
      contents.push({
        remoteId: `file:${file.id}`,
        path: `${source.remoteId}/attachments/${file.id}/${safeName(file.name, file.id)}`,
        name: safeName(file.name, file.id),
        mimeType: file.mimetype ?? 'text/plain',
        revision: timestamp,
        content: bytes,
        metadata: {
          provider: 'slack', workspaceId, workspaceName, workspaceUrl, channelId: source.remoteId, channelName,
          messageTs: timestamp, threadTs, authorId: message.user ?? null, attachedToMessage: remoteId,
          permalink: file.permalink ?? null, messagePermalink: permalink,
        },
      });
    }
    return contents;
  }

  async refreshCredentials(credentials: IntegrationCredential): Promise<IntegrationCredential | null> {
    if (!credentials.refreshToken) return null;
    const { clientId, clientSecret } = oauthClient(this.env);
    const response = await requestResponse(this.http, 'https://slack.com/api/oauth.v2.access', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: credentials.refreshToken }).toString(),
    }, 'Slack OAuth refresh');
    const body = await response.json() as { ok?: boolean; access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
    if (!body.ok || !body.access_token) return null;
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? credentials.refreshToken,
      expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : credentials.expiresAt,
      scopes: body.scope ?? credentials.scopes,
    };
  }

  async revokeCredentials(credentials: IntegrationCredential): Promise<boolean> {
    const response = await this.http.fetch('https://slack.com/api/auth.revoke', { method: 'POST', headers: this.headers(credentials.accessToken) });
    if (!response.ok) return false;
    const body = await response.json() as { ok?: boolean };
    return body.ok === true;
  }
}

export function createSlackAdapter(options: SlackOptions = {}): SlackConnectedSourceAdapter {
  return new SlackConnectedSourceAdapter(options);
}
