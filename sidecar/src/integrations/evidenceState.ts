import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artifact } from '../artifacts.js';
import type { EvidenceSourceState } from '../review/evidenceSufficiency.js';

type Row = Record<string, unknown>;

export type ConnectedEvidenceState = { state: EvidenceSourceState; detail?: string };

function row(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function classifyConnectedSourceEvidence(input: {
  itemStatus: string;
  itemError?: string | null;
  sourceStatus: string;
  syncStatus: string;
  lastSuccessfulSyncAt?: string | null;
  sourceError?: string | null;
  now?: number;
  staleAfterMs?: number;
}): ConnectedEvidenceState {
  if (input.itemStatus === 'removed' || input.sourceStatus === 'removed') {
    return { state: 'deleted', detail: input.itemError ?? input.sourceError ?? 'The connected-source item was removed.' };
  }
  if (input.itemStatus === 'inaccessible' || input.itemStatus === 'unsupported' || input.sourceStatus === 'inaccessible') {
    return { state: 'inaccessible', detail: input.itemError ?? input.sourceError ?? 'The connected-source item cannot be read.' };
  }
  if (input.sourceStatus === 'disconnected') {
    return { state: 'stale', detail: 'The provider is disconnected, so the frozen item cannot be checked for a newer revision.' };
  }
  if (input.syncStatus === 'error') {
    return { state: 'stale', detail: input.sourceError ?? 'The most recent connected-source synchronization failed.' };
  }
  const syncedAt = input.lastSuccessfulSyncAt ? Date.parse(input.lastSuccessfulSyncAt) : NaN;
  const staleAfterMs = input.staleAfterMs ?? 24 * 60 * 60 * 1000;
  if (!Number.isFinite(syncedAt) || (input.now ?? Date.now()) - syncedAt > staleAfterMs) {
    return { state: 'stale', detail: 'The connected source has not completed a recent successful synchronization.' };
  }
  return { state: 'available' };
}

/** Resolve provider availability for an artifact through the caller's RLS client. */
export class SupabaseConnectedEvidenceStateResolver {
  constructor(
    private readonly client: SupabaseClient,
    private readonly options: { now?: () => number; staleAfterMs?: number } = {},
  ) {}

  async resolve(artifact: Artifact, signal?: AbortSignal): Promise<ConnectedEvidenceState | undefined> {
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    const itemResult = await (this.client as any).from('connected_source_items').select('source_id,status,error,last_seen_at,updated_at')
      .eq('project_id', artifact.projectId).eq('artifact_id', artifact.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (itemResult.error) throw new Error(`Connected-source evidence lookup failed: ${String(itemResult.error.message ?? itemResult.error)}`);
    if (!itemResult.data) return undefined;
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    const item = row(itemResult.data);
    const sourceId = text(item.source_id);
    if (!sourceId) return { state: 'inaccessible', detail: 'The connected-source item has no source record.' };
    const sourceResult = await (this.client as any).from('project_sources').select('status,sync_status,last_successful_sync_at,last_error')
      .eq('project_id', artifact.projectId).eq('id', sourceId).maybeSingle();
    if (sourceResult.error) throw new Error(`Connected-source state lookup failed: ${String(sourceResult.error.message ?? sourceResult.error)}`);
    if (!sourceResult.data) return { state: 'deleted', detail: 'The connected source no longer exists.' };
    const source = row(sourceResult.data);
    return classifyConnectedSourceEvidence({
      itemStatus: text(item.status) ?? 'available', itemError: text(item.error),
      sourceStatus: text(source.status) ?? 'active', syncStatus: text(source.sync_status) ?? 'idle',
      lastSuccessfulSyncAt: text(source.last_successful_sync_at), sourceError: text(source.last_error),
      now: this.options.now?.(), staleAfterMs: this.options.staleAfterMs,
    });
  }
}
