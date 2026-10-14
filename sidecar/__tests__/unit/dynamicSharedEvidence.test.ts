import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadIndependentEvidence } from '../../src/dynamic/sharedEvidence/files.js';
import { SharedEvidenceRepository } from '../../src/dynamic/sharedEvidence/repository.js';
import { handleEvidenceCopyRoute } from '../../src/dynamic/sharedEvidence/routes.js';
import type { DynamicRun } from '../../src/dynamic/types.js';
let root: string;
const sid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
const ref = { id: 'proof', kind: 'screenshot' as const, sha256: sha, availability: 'local' as const, capturedAt: new Date().toISOString() };
const run = { id: 'r', projectId: 'p', state: 'completed', legacySessionId: sid, evidence: [ref] } as DynamicRun;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-shared-proof-')); fs.mkdirSync(path.join(root, 'sessions', sid, 'logs'), { recursive: true }); fs.writeFileSync(path.join(root, 'sessions', sid, 'logs', 'criterion-page.png'), bytes); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
describe('Immutable private independent evidence', () => {
    it('loads only the fixed artifact slot and refuses changed bytes, symlinks and session escape', () => { expect(loadIndependentEvidence(root, run, ref)).toEqual(bytes); fs.writeFileSync(path.join(root, 'sessions', sid, 'logs', 'criterion-page.png'), 'Changed'); expect(() => loadIndependentEvidence(root, run, ref)).toThrow('checksum'); expect(() => loadIndependentEvidence(root, { ...run, legacySessionId: '../../private' }, ref)).toThrow('unavailable'); fs.rmSync(path.join(root, 'sessions', sid, 'logs', 'criterion-page.png')); fs.writeFileSync(path.join(root, 'other.png'), bytes); fs.symlinkSync(path.join(root, 'other.png'), path.join(root, 'sessions', sid, 'logs', 'criterion-page.png')); expect(() => loadIndependentEvidence(root, run, ref)).toThrow('missing'); });
    it('checks membership before any Run, local-file or storage lookup', async () => { const deps = { requireMember: vi.fn().mockRejectedValue(Error('denied')), service: { requireRun: vi.fn() }, workspace: vi.fn(), repository: { list: vi.fn() } }; await expect(handleEvidenceCopyRoute({ method: 'GET', pathname: '/projects/p/dynamic/runs/r/evidence' }, deps as never)).rejects.toThrow('denied'); expect(deps.service.requireRun).not.toHaveBeenCalled(); expect(deps.workspace).not.toHaveBeenCalled(); expect(deps.repository.list).not.toHaveBeenCalled(); });
    it('validates the complete local set before preparing or uploading a partial copy', async () => { const deps = { requireMember: vi.fn().mockResolvedValue(undefined), service: { requireRun: vi.fn().mockResolvedValue({ ...run, evidence: [ref, { ...ref, id: 'checks', kind: 'checks' }] }) }, workspace: vi.fn().mockResolvedValue(root), repository: { prepare: vi.fn(), upload: vi.fn() } }; const result = await handleEvidenceCopyRoute({ method: 'POST', pathname: '/projects/p/dynamic/runs/r/evidence/sync' }, deps as never); expect(result?.status).toBe(409); expect(deps.repository.prepare).not.toHaveBeenCalled(); expect(deps.repository.upload).not.toHaveBeenCalled(); });
    it('verifies an object after a lost upload acknowledgement without another upload or overwrite', async () => { const upload = vi.fn().mockResolvedValue({ error: Error('Lost acknowledgement') }); const download = vi.fn(() => ({ asStream: async () => ({ error: null, data: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) }) })); const client = { storage: { from: () => ({ upload, download }) } }; const repository = new SharedEvidenceRepository(client as never); await repository.upload({ copy: { sha256: sha, bytes: bytes.length, mimeType: 'image/png' } as never, objectPath: 'p/dynamic-v1/r/c/' + sha + '.png', token: 'token' }, bytes); expect(upload).toHaveBeenCalledOnce(); expect(upload.mock.calls[0][2]).toMatchObject({ upsert: false }); expect(download).toHaveBeenCalledOnce(); });
    it('stops streamed bytes at the declared limit and refuses a checksum mismatch', async () => { const cancelled = vi.fn(); let body = bytes; const client = { storage: { from: () => ({ download: () => ({ asStream: async () => ({ error: null, data: new ReadableStream({ start(controller) { controller.enqueue(body); }, cancel: cancelled }) }) }) }) } }; const repository = new SharedEvidenceRepository(client as never); await expect(repository.download('object', { sha256: sha, bytes: 1 })).rejects.toThrow('verification'); expect(cancelled).toHaveBeenCalledOnce(); const mismatch = { storage: { from: () => ({ download: () => ({ asStream: async () => ({ error: null, data: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) }) }) }) } }; await expect(new SharedEvidenceRepository(mismatch as never).download('object', { sha256: 'a'.repeat(64), bytes: bytes.length })).rejects.toThrow('verification'); });
    it('does not start a new upload when metadata is already available or expired', async () => { const prepare = vi.fn().mockResolvedValue({ token: null, copy: { availability: 'available' } }); const deps = { requireMember: vi.fn().mockResolvedValue(undefined), service: { requireRun: vi.fn().mockResolvedValue(run) }, workspace: vi.fn().mockResolvedValue(root), repository: { prepare, upload: vi.fn(), finish: vi.fn() } }; expect((await handleEvidenceCopyRoute({ method: 'POST', pathname: '/projects/p/dynamic/runs/r/evidence/sync' }, deps as never))?.status).toBe(200); expect(deps.repository.upload).not.toHaveBeenCalled(); expect(deps.repository.finish).not.toHaveBeenCalled(); });
    it('blocks content for pending/expired/deleted copies before requesting bytes', async () => { for (const availability of ['pending', 'expired', 'deleted']) {
        const repository = { list: vi.fn().mockResolvedValue([{ id: 'copy', availability }]), download: vi.fn() };
        const deps = { repository, requireMember: vi.fn().mockResolvedValue(undefined), service: { requireRun: vi.fn().mockResolvedValue(run) }, workspace: vi.fn() };
        expect((await handleEvidenceCopyRoute({ method: 'GET', pathname: '/projects/p/dynamic/runs/r/evidence/copy/content' }, deps as never))?.status).toBe(409);
        expect(repository.download).not.toHaveBeenCalled();
    } });
});

describe('Evidence transfer identity',()=>{
 it('preserves the verified bearer when fetch options replace SDK headers',async()=>{
  const {evidenceStorageClient}=await import('../../src/dynamic/sharedEvidence/client.js');
  const originalUrl=process.env.SUPABASE_URL,originalKey=process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_ANON_KEY='public-test-key';
  const fetchMock=vi.fn().mockResolvedValue(new Response(bytes,{status:200,headers:{'Content-Type':'image/png'}}));vi.stubGlobal('fetch',fetchMock);
  try{const client=evidenceStorageClient('verified-test-actor');const result=await client.storage.from('dynamic-evidence').download('project/dynamic-v1/proof',{}, {headers:{'Cache-Control':'no-cache'}} as never).asStream();expect(result.error).toBeNull();const options=fetchMock.mock.calls[0][1];const headers=new Headers(options.headers);expect(headers.get('Authorization')).toBe('Bearer verified-test-actor');expect(headers.get('apikey')).toBe('public-test-key');expect(headers.get('Cache-Control')).toBe('no-cache');expect(options.cache).toBe('no-store');expect(options.signal).toBeInstanceOf(AbortSignal);await result.data?.cancel();}
  finally{vi.unstubAllGlobals();if(originalUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=originalUrl;if(originalKey===undefined)delete process.env.SUPABASE_ANON_KEY;else process.env.SUPABASE_ANON_KEY=originalKey;}
 });
});
