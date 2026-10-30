import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import type { SourceIndexHold, SourceIndexJob, SourceIndexJobStore } from './sourceIndexJobs.js';
import { sourceIndexJobId } from './sourceIndexJobs.js';

const ENTITY = 'source_index';
const EVENT = 'source_index_job';
/** Existing audit journal and project-member RLS; no service role or local fallback. */
export class SupabaseSourceIndexJobStore implements SourceIndexJobStore {
  constructor(private client: SupabaseClient, private userId: string) {}
  async hold(projectId: string, ownerId: string): Promise<SourceIndexHold | null> {
    const result = await this.client.from('audit_events').select('payload').eq('id', holdId(projectId, ownerId))
      .eq('project_id', projectId).eq('entity_type', 'source_index_hold').eq('event_type', 'source_index_hold').maybeSingle();
    if (result.error) throw new Error('Source index capacity status is unavailable.');
    if (!result.data) return null;
    const payload = result.data.payload as SourceIndexHold & { ownerId: string; version: number };
    if (payload.version !== 1 || payload.ownerId !== ownerId || !Number.isSafeInteger(payload.revision) || payload.revision < 0
      || payload.code !== null && !['rate_limited', 'quota_exhausted', 'credits_exhausted', 'billing_required', 'assessment_paused', 'index_paused'].includes(payload.code))
      throw new Error('Source index capacity status is invalid.');
    return { revision: payload.revision, code: payload.code };
  }
  async compareHold(projectId: string, ownerId: string, previous: SourceIndexHold | null, next: SourceIndexHold): Promise<boolean> {
    if (ownerId !== this.userId || next.revision !== (previous?.revision ?? -1) + 1) throw new Error('Invalid source index capacity transition.');
    const id = holdId(projectId, ownerId); const payload = { version: 1, ownerId, ...next };
    const result = previous ? await this.client.from('audit_events').update({ payload }).eq('id', id).eq('project_id', projectId)
      .eq('entity_type', 'source_index_hold').eq('event_type', 'source_index_hold').eq('payload->>revision', String(previous.revision)).select('id')
      : await this.client.from('audit_events').insert({ id, project_id: projectId, actor_id: this.userId,
        entity_type: 'source_index_hold', entity_id: projectId, event_type: 'source_index_hold', idempotency_key: `source-index-hold:${id}`, payload });
    if (result.error?.code === '23505') return false;
    if (result.error) throw new Error('Source index capacity status could not be saved.');
    return previous ? result.data?.length === 1 : true;
  }
  async get(id: string): Promise<SourceIndexJob | null> {
    const result = await this.client.from('audit_events').select('payload').eq('id', id)
      .eq('entity_type', ENTITY).eq('event_type', EVENT).maybeSingle();
    if (result.error) throw new Error('Source index progress is unavailable.');
    return decode(result.data?.payload, id);
  }
  async latest(projectId: string, ownerId: string): Promise<SourceIndexJob | null> {
    const result = await this.client.from('audit_events').select('id,payload').eq('project_id', projectId)
      .eq('entity_type', ENTITY).eq('event_type', EVENT).eq('payload->>ownerId', ownerId)
      .order('payload->>updatedAt', { ascending: false }).order('id', { ascending: false }).limit(1);
    if (result.error) throw new Error('Source index progress is unavailable.');
    const row = result.data?.[0];
    const job = row ? decode(row.payload, row.id) : null;
    if (job && (job.projectId !== projectId || job.ownerId !== ownerId)) throw new Error('Source index job scope mismatch.');
    return job;
  }
  async paused(projectId: string, ownerId: string): Promise<SourceIndexJob[]> {
    if (ownerId !== this.userId) throw new Error('Source index resume owner mismatch.');
    const jobs: SourceIndexJob[] = [];
    let after: string | undefined;
    for (;;) {
      let query = this.client.from('audit_events').select('id,payload').eq('project_id', projectId)
        .eq('entity_type', ENTITY).eq('event_type', EVENT).eq('payload->>ownerId', ownerId)
        .eq('payload->>state', 'paused').order('id').limit(1000);
      if (after) query = query.gt('id', after);
      const result = await query;
      if (result.error) throw new Error('Paused source index progress is unavailable.');
      for (const row of result.data ?? []) {
        const job = decode(row.payload, row.id);
        if (!job || job.projectId !== projectId || job.ownerId !== ownerId || job.state !== 'paused')
          throw new Error('Source index resume scope mismatch.');
        jobs.push(job);
      }
      if ((result.data?.length ?? 0) < 1000) return jobs;
      after = result.data![result.data!.length - 1]!.id;
    }
  }
  async insert(job: SourceIndexJob): Promise<boolean> {
    const result = await this.client.from('audit_events').insert({ id: job.id, project_id: job.projectId, actor_id: this.userId,
      entity_type: ENTITY, entity_id: job.projectId, event_type: EVENT, idempotency_key: `source-index:${job.id}`,
      created_at: job.updatedAt, payload: { version: 1, ...job } });
    if (result.error?.code === '23505') return false;
    if (result.error) throw new Error('Source index event could not be saved.');
    return true;
  }
  async compareAndSet(previous: SourceIndexJob, next: SourceIndexJob): Promise<boolean> {
    if (next.id !== previous.id || next.projectId !== previous.projectId || next.fingerprint !== previous.fingerprint
      || next.revision !== previous.revision + 1) throw new Error('Invalid source index transition.');
    const result = await this.client.from('audit_events').update({ payload: { version: 1, ...next } })
      .eq('id', previous.id).eq('project_id', previous.projectId).eq('entity_type', ENTITY).eq('event_type', EVENT)
      .eq('payload->>revision', String(previous.revision)).select('id');
    if (result.error) throw new Error('Source index progress could not be saved.');
    return result.data?.length === 1;
  }
}
function holdId(projectId: string, ownerId: string): string {
  return sourceIndexJobId(projectId, crypto.createHash('sha256').update(`source-index-owner-hold-v1:${ownerId}:${projectId}`).digest('hex'));
}
function decode(payload: unknown, id: string): SourceIndexJob | null {
  if (!payload) return null;
  const job = payload as SourceIndexJob & { version: number };
  if (job.version !== 1 || job.id !== id || typeof job.projectId !== 'string' || typeof job.ownerId !== 'string'
    || !/^[a-f\d]{64}$/.test(job.fingerprint) || !Number.isSafeInteger(job.revision) || job.revision < 0
    || !['queued', 'running', 'ready', 'paused', 'failed', 'superseded'].includes(job.state)
    || !['source_changed', 'review', 'manual'].includes(job.trigger) || !Number.isFinite(Date.parse(job.updatedAt))
    || job.leaseToken !== null && typeof job.leaseToken !== 'string'
    || job.leaseUntil !== null && !Number.isFinite(job.leaseUntil)
    || job.errorCode !== null && typeof job.errorCode !== 'string'
    || sourceIndexJobId(job.projectId, job.fingerprint) !== id) throw new Error('Invalid source index progress.');
  return job;
}
