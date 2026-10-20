import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReadinessJob, ReadinessStore } from './service.js';

/** Reuse the existing project-member RLS journal; no local fallback or new schema. */
export class SupabaseReadinessStore implements ReadinessStore {
  constructor(private readonly client: SupabaseClient, private readonly userId: string) {}
  async latest(projectId: string): Promise<ReadinessJob | null> {
    const result = await this.client.from('audit_events').select('payload').eq('project_id', projectId)
      .eq('entity_type', 'project_readiness').eq('event_type', 'project_readiness_job')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1);
    if (result.error) throw new Error('Readiness history is unavailable');
    const job = (result.data?.[0]?.payload as { version?: number; job?: ReadinessJob } | undefined)?.job;
    if (!job) return null;
    if (job.projectId !== projectId) throw new Error('Readiness history scope mismatch');
    return job;
  }
  async save(job: ReadinessJob) {
    if (!job.requestId) throw new Error('Readiness request id is required');
    const result = await this.client.from('audit_events').upsert({ id: job.requestId, project_id: job.projectId, actor_id: this.userId,
      entity_type: 'project_readiness', entity_id: job.projectId, event_type: 'project_readiness_job',
      idempotency_key: `readiness:${job.requestId}`, created_at: job.requestedAt,
      payload: { version: 1, job } }, { onConflict: 'id' });
    if (result.error) throw new Error('Readiness progress could not be saved');
  }
}
