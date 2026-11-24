import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConversationRequest } from './types.js';
import { DynamicContractError } from '../dynamic/types.js';

export interface ConversationStore {
  get(projectId: string, id: string): Promise<ConversationRequest | null>;
  list(projectId: string, before?: { ownerId: string; createdAt: string }): Promise<ConversationRequest[]>;
  listEarlierCompleted(projectId: string, ownerId: string, before: string, limit: number): Promise<ConversationRequest[]>;
  listEarlierTurns(projectId: string, ownerId: string, before: string, limit: number): Promise<ConversationRequest[]>;
  listActive?(projectId: string, ownerId: string): Promise<ConversationRequest[]>;
  create(record: ConversationRequest): Promise<boolean>;
  update(record: ConversationRequest, revision: number): Promise<boolean>;
}

const entity = 'project_conversation';
const event = 'project_conversation_request';

export class SupabaseConversationStore implements ConversationStore {
  constructor(private source: SupabaseClient | (() => SupabaseClient)) {}
  private get client() { return typeof this.source === 'function' ? this.source() : this.source; }
  private query() {
    return this.client.from('audit_events').select('payload').eq('entity_type', entity).eq('event_type', event);
  }
  async get(projectId: string, id: string) {
    const result = await this.query().eq('project_id', projectId).eq('id', id).maybeSingle();
    if (result.error) throw new Error('Conversation history is unavailable.');
    return (result.data?.payload?.request ?? null) as ConversationRequest | null;
  }
  async list(projectId: string, before?: { ownerId: string; createdAt: string }) {
    const base = this.query().eq('project_id', projectId);
    const query = before ? base.eq('actor_id', before.ownerId).lt('created_at', before.createdAt) : base;
    const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(50);
    if (result.error) {
      const code = typeof result.error.code === 'string' && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(result.error.code)
        ? result.error.code : 'unknown';
      console.warn(`[conversation] History read failed (${code}).`);
      throw new DynamicContractError(503, 'Conversation history is temporarily unavailable.');
    }
    return (result.data ?? []).flatMap(row => row.payload?.request ? [row.payload.request as ConversationRequest] : []);
  }
  async listEarlierCompleted(projectId: string, ownerId: string, before: string, limit: number) {
    const result = await this.query().eq('project_id', projectId).eq('actor_id', ownerId)
      .eq('payload->request->>state', 'completed').lt('created_at', before)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
    if (result.error) throw new Error('Earlier conversation turns are unavailable.');
    return (result.data ?? []).map(row => row.payload.request as ConversationRequest);
  }
  async listEarlierTurns(projectId: string, ownerId: string, before: string, limit: number) {
    const result = await this.query().eq('project_id', projectId).eq('actor_id', ownerId)
      .lt('created_at', before)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
    if (result.error) throw new Error('Earlier conversation turns are unavailable.');
    return (result.data ?? []).map(row => row.payload.request as ConversationRequest);
  }
  async listActive(projectId: string, ownerId: string) {
    const records: ConversationRequest[] = [];
    let after: string | undefined;
    for (;;) {
      let query = this.client.from('audit_events').select('id,payload').eq('entity_type', entity).eq('event_type', event)
        .eq('project_id', projectId).eq('actor_id', ownerId)
        .in('payload->request->>state', ['accepted', 'planning', 'awaiting_permission', 'running']).order('id').limit(1000);
      if (after) query = query.gt('id', after);
      const result = await query;
      if (result.error) throw new Error('Active conversation requests could not be read.');
      const rows = result.data ?? [];
      records.push(...rows.map(row => row.payload.request as ConversationRequest));
      if (rows.length < 1000) return records;
      after = rows[rows.length - 1].id;
    }
  }
  async create(record: ConversationRequest) {
    const result = await this.client.from('audit_events').insert({
      id: record.id, project_id: record.projectId, actor_id: record.ownerId, entity_id: record.projectId,
      entity_type: entity, event_type: event, idempotency_key: 'conversation:' + record.id,
      created_at: record.createdAt, payload: { version: 1, revision: record.revision, request: record },
    });
    if (result.error?.code === '23505') return false;
    if (result.error) throw new Error('The request could not be saved.');
    return true;
  }
  async update(record: ConversationRequest, revision: number) {
    const result = await this.client.from('audit_events').update({
      payload: { version: 1, revision: record.revision, request: record },
    }).eq('id', record.id).eq('project_id', record.projectId).eq('actor_id', record.ownerId)
      .eq('entity_type', entity).eq('event_type', event).eq('payload->>revision', String(revision)).select('id');
    if (result.error) throw new Error('Conversation progress could not be saved.');
    return result.data?.length === 1;
  }
}
