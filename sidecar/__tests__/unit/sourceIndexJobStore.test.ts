import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseSourceIndexJobStore } from '../../src/review/sourceIndexJobStore.js';
import { sourceIndexJobId, type SourceIndexJob } from '../../src/review/sourceIndexJobs.js';

const project = '33333333-3333-4333-8333-333333333333';
const owner = '11111111-1111-4111-8111-111111111111';
const fingerprint = 'a'.repeat(64);
const job: SourceIndexJob = { id: sourceIndexJobId(project, fingerprint), projectId: project, ownerId: owner, fingerprint,
  revision: 0, state: 'queued', trigger: 'source_changed', updatedAt: '2026-10-27T12:00:00.000Z', leaseToken: null, leaseUntil: null, errorCode: null };
function setup(body: unknown, status = 200) {
  const send = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  const client = createClient('https://example.supabase.co', 'test-only-placeholder', { global: { fetch: send }, auth: { persistSession: false, autoRefreshToken: false } });
  return { send, store: new SupabaseSourceIndexJobStore(client, owner) };
}
describe('source index durable journal', () => {
  it('records capacity holds separately by owner and releases only the expected revision', async () => {
    const s = setup([{ id: 'hold' }]);
    expect(await s.store.compareHold(project, owner, { revision: 2, code: 'quota_exhausted' }, { revision: 3, code: null })).toBe(true);
    const [url, init] = s.send.mock.calls[0]!; const params = new URL(String(url)).searchParams;
    expect(params.get('entity_type')).toBe('eq.source_index_hold'); expect(params.get('payload->>revision')).toBe('eq.2');
    expect(JSON.parse(String(init?.body))).toMatchObject({ payload: { ownerId: owner, revision: 3, code: null } });
    await expect(s.store.compareHold(project, 'different-member', null, { revision: 0, code: null })).rejects.toThrow('Invalid source index capacity');
  });
  it('uses the existing member-scoped audit journal and no bearer in the payload', async () => {
    const s = setup(null, 201); expect(await s.store.insert(job)).toBe(true);
    const [url, init] = s.send.mock.calls[0]!;
    expect(String(url)).toContain('/rest/v1/audit_events');
    const row = JSON.parse(String(init?.body));
    expect(row).toMatchObject({ id: job.id, project_id: project, actor_id: owner, entity_type: 'source_index', event_type: 'source_index_job', payload: { version: 1, ...job } });
    expect(row.payload).not.toHaveProperty('accessToken');
  });
  it('uses a conditional revision update so only one concurrent claimant wins', async () => {
    const s = setup([{ id: job.id }]);
    expect(await s.store.compareAndSet(job, { ...job, revision: 1, state: 'running' })).toBe(true);
    const [url, init] = s.send.mock.calls[0]!; const params = new URL(String(url)).searchParams;
    expect(init?.method).toBe('PATCH'); expect(params.get('id')).toBe(`eq.${job.id}`);
    expect(params.get('project_id')).toBe(`eq.${project}`); expect(params.get('payload->>revision')).toBe('eq.0');
    expect(params.get('select')).toBe('id');
    expect(await setup([]).store.compareAndSet(job, { ...job, revision: 1 })).toBe(false);
  });
  it('queries recovery only for the authenticated owner and newest recorded project event', async () => {
    const s = setup([{ id: job.id, payload: { version: 1, ...job } }]);
    expect(await s.store.latest(project, owner)).toMatchObject(job);
    const params = new URL(String(s.send.mock.calls[0]![0])).searchParams;
    expect(params.get('project_id')).toBe(`eq.${project}`); expect(params.get('payload->>ownerId')).toBe(`eq.${owner}`);
    expect(params.get('order')).toBe('payload->>updatedAt.desc,id.desc'); expect(params.get('limit')).toBe('1');
  });
  it('treats an insert conflict as an existing shared claim and fails closed on persistence errors', async () => {
    expect(await setup({ code: '23505' }, 409).store.insert(job)).toBe(false);
    await expect(setup({ code: '42501' }, 403).store.insert(job)).rejects.toThrow('could not be saved');
    await expect(setup({ code: '42501' }, 403).store.get(job.id)).rejects.toThrow('unavailable');
  });
  it('rejects corrupt job records and identity-changing CAS transitions', async () => {
    await expect(setup({ payload: { ...job, version: 1, revision: -1 } }).store.get(job.id)).rejects.toThrow('Invalid source index');
    const s = setup([]);
    await expect(s.store.compareAndSet(job, { ...job, revision: 1, fingerprint: 'b'.repeat(64) })).rejects.toThrow('Invalid source index transition');
    expect(s.send).not.toHaveBeenCalled();
  });
});
