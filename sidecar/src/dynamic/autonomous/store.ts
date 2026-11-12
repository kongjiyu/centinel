import type { SupabaseClient } from '@supabase/supabase-js';
import type { LiveRunOptions } from '../live/liveHub.js';
import type { AutoTestSession } from './orchestrator.js';

export interface AutoTestStore {
  list(projectId: string, limit?: number): Promise<AutoTestSession[]>;
  get(projectId: string, id: string): Promise<AutoTestSession | null>;
  save(session: AutoTestSession): Promise<void>;
}

const ENTITY = 'dynamic_autonomous';
const EVENT = 'dynamic_autonomous_session';

function parse(projectId: string, payload: unknown): AutoTestSession | null {
  const session = (payload as { version?: number; session?: AutoTestSession } | null)?.session;
  if (!session || session.schemaVersion !== 1) return null;
  if (session.projectId !== projectId) throw new Error('Auto test history scope mismatch');
  return session;
}

/** Reuses the project-member RLS audit journal (one upserted row per session); no new schema. */
export class SupabaseAutoTestStore implements AutoTestStore {
  constructor(private readonly client: SupabaseClient, private readonly userId: string) {}
  async list(projectId: string, limit = 10) {
    const result = await this.client.from('audit_events').select('payload').eq('project_id', projectId)
      .eq('entity_type', ENTITY).eq('event_type', EVENT).order('created_at', { ascending: false }).limit(limit);
    if (result.error) throw new Error('Auto test history is unavailable');
    return (result.data ?? []).map(row => parse(projectId, row.payload)).filter((session): session is AutoTestSession => !!session);
  }
  async get(projectId: string, id: string) {
    const result = await this.client.from('audit_events').select('payload').eq('project_id', projectId).eq('id', id)
      .eq('entity_type', ENTITY).eq('event_type', EVENT).limit(1);
    if (result.error) throw new Error('Auto test history is unavailable');
    return result.data?.[0] ? parse(projectId, result.data[0].payload) : null;
  }
  async save(session: AutoTestSession) {
    const result = await this.client.from('audit_events').upsert({
      id: session.id, project_id: session.projectId, actor_id: this.userId, entity_type: ENTITY, entity_id: session.projectId,
      event_type: EVENT, idempotency_key: `autotest:${session.id}`, created_at: session.createdAt, payload: { version: 1, session },
    }, { onConflict: 'id' });
    if (result.error) throw new Error('Auto test progress could not be saved');
  }
}

export class MemoryAutoTestStore implements AutoTestStore {
  readonly sessions = new Map<string, AutoTestSession>();
  async list(projectId: string, limit = 10) { return [...this.sessions.values()].filter(session => session.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(session => structuredClone(session)); }
  async get(projectId: string, id: string) { const session = this.sessions.get(id); return session && session.projectId === projectId ? structuredClone(session) : null; }
  async save(session: AutoTestSession) { this.sessions.set(session.id, structuredClone(session)); }
}

/**
 * Live options for Runs started by Auto test, keyed by the Run's idempotency key so the
 * ordinary Run route can attach the live view without changing its HTTP contract.
 */
export class AutoTestLiveRuns {
  private readonly entries = new Map<string, LiveRunOptions>();
  register(idempotencyKey: string, options: LiveRunOptions) { this.entries.set(idempotencyKey, options); }
  get(idempotencyKey: string) { return this.entries.get(idempotencyKey); }
  release(idempotencyKey: string) { this.entries.delete(idempotencyKey); }
}
export const autoTestLiveRuns = new AutoTestLiveRuns();
