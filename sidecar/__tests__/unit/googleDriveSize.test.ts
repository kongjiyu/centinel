import { describe, expect, it } from 'vitest';
import { GOOGLE_DRIVE_MAX_FILE_BYTES, GoogleDriveConnectedSourceAdapter } from '../../src/integrations/providers/googleDrive.js';
import type { ConnectedSource, IntegrationCredential } from '../../src/integrations/types.js';

const credentials: IntegrationCredential = { accessToken: 'test-token', refreshToken: null, expiresAt: null, scopes: 'read' };
const source = { id: 'drive', projectId: 'project', provider: 'google_drive', kind: 'google_drive', remoteId: 'file', selectedScope: { resourceKind: 'file' }, syncCursor: null } as ConnectedSource;
function adapterFor(size: number, body: Response, maxFileBytes?: number) {
  const calls: string[] = [];
  const adapter = new GoogleDriveConnectedSourceAdapter({ maxFileBytes, http: { async fetch(url) {
    calls.push(String(url));
    if (String(url).includes('startPageToken')) return Response.json({ startPageToken: 'start' });
    if (!String(url).includes('alt=media')) return Response.json({ id: 'file', name: 'report.pdf', mimeType: 'application/pdf', size: String(size), headRevisionId: 'revision' });
    return body;
  } } });
  return { adapter, calls, async read() { const snapshot = await adapter.prepareSync(credentials, source); return adapter.listItems(credentials, source, snapshot, snapshot.cursor); } };
}

describe('bounded Google Drive attachments', () => {
  it('accepts an exact 100 MiB streamed attachment at the default boundary', async () => {
    expect(GOOGLE_DRIVE_MAX_FILE_BYTES).toBe(104_857_600);
    let chunks = 0;
    const block = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (chunks++ < 100) controller.enqueue(block); else controller.close();
    } });
    const test = adapterFor(GOOGLE_DRIVE_MAX_FILE_BYTES, new Response(stream));
    const page = await test.read();
    expect(page.items[0]!.status).not.toBe('unsupported');
    expect(page.items[0]!.content.byteLength).toBe(GOOGLE_DRIVE_MAX_FILE_BYTES);
    expect(page.items[0]!.revision).toBe('revision');
  });

  it('rejects metadata above 100 MiB before requesting file content', async () => {
    const test = adapterFor(GOOGLE_DRIVE_MAX_FILE_BYTES + 1, new Response('unused'));
    const page = await test.read();
    expect(page.items[0]).toMatchObject({ status: 'unsupported', content: new Uint8Array() });
    expect(test.calls.some(url => url.includes('alt=media'))).toBe(false);
  });

  it('cancels an oversized stream even when metadata understates its size', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(3)); }, cancel() { cancelled = true; } });
    const test = adapterFor(2, new Response(stream), 4);
    const page = await test.read();
    expect(page.items[0]).toMatchObject({ status: 'unsupported', content: new Uint8Array() });
    expect(cancelled).toBe(true);
  });

  it('rejects an oversized declared response before collecting it', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const test = adapterFor(2, new Response(stream, { headers: { 'Content-Length': '5' } }), 4);
    expect((await test.read()).items[0]!.status).toBe('unsupported');
    expect(cancelled).toBe(true);
  });

  it('bounds folder and changes pages to one maximum-sized attachment', async () => {
    const calls: string[] = [];
    const adapter = new GoogleDriveConnectedSourceAdapter({ http: { async fetch(url) {
      calls.push(String(url));
      return Response.json(String(url).includes('/changes?') ? { changes: [], newStartPageToken: 'next' } : { files: [] });
    } } });
    const folder = { ...source, remoteId: 'folder', selectedScope: { resourceKind: 'folder' } };
    await adapter.listItems(credentials, folder, { remoteRevision: null, cursor: { mode: 'baseline', startPageToken: 'first' } }, null);
    await adapter.listItems(credentials, folder, { remoteRevision: null, cursor: { mode: 'changes', pageToken: 'first' } }, null);
    expect(calls.map(url => new URL(url).searchParams.get('pageSize'))).toEqual(['1', '1']);
  });
});
