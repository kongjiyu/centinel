import type { SupabaseClient } from '@supabase/supabase-js';
import type { TokenUsageSummary, TokenUsageRow, TokenUsageListFilter } from './tokenUsage.js';

type UsageRecord = {
  id: string;
  project_id: string | null;
  review_session_id: string | null;
  stage: string;
  attempt: number;
  provider: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function usageKind(row: UsageRecord): TokenUsageRow['callKind'] {
  const value = row.metadata?.callKind;
  return value === 'test' || value === 'dynamic' ? value : 'review';
}

function usageScope(row: UsageRecord): TokenUsageRow['scope'] {
  return row.metadata?.scope === 'embedding' || row.stage === 'embedding-provider-test' ? 'embedding'
    : row.metadata?.scope === 'vision' || row.stage === 'vision-provider-test' ? 'vision' : 'text';
}

/** Account-scoped Settings usage is read from the same Supabase ledger that
 * Review execution writes. Pagination avoids silently truncating totals at
 * PostgREST's per-request row limit. */
export async function getSupabaseModelUsageSummary(
  client: SupabaseClient,
  ownerId: string,
  filter: TokenUsageListFilter = {},
): Promise<TokenUsageSummary> {
  const rows: UsageRecord[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = client.from('model_usage_records').select('*').eq('owner_id', ownerId)
      .order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
    if (filter.projectId) query = query.eq('project_id', filter.projectId);
    if (filter.sessionId) query = query.eq(filter.callKind === 'dynamic' ? 'metadata->>dynamicSessionId' : 'review_session_id', filter.sessionId);
    const result = await query;
    if (result.error) throw new Error(`Supabase model usage query failed: ${result.error.message}`);
    const page = (result.data ?? []) as UsageRecord[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, calls: 0 };
  const groups = new Map<string, TokenUsageSummary['byGroup'][number]>();
  const recent: TokenUsageRow[] = [];
  for (const row of rows) {
    const callKind = usageKind(row);
    const scope = usageScope(row);
    if (filter.scope && filter.scope !== scope) continue;
    if (filter.callKind && filter.callKind !== callKind) continue;
    const inputTokens = row.input_tokens ?? 0;
    const outputTokens = row.output_tokens ?? 0;
    const cacheReadTokens = row.cache_read_tokens ?? 0;
    const cacheCreationTokens = row.cache_creation_tokens ?? 0;
    const apiFormat = typeof row.metadata?.apiFormat === 'string' ? row.metadata.apiFormat : 'openai';
    const key = `${row.provider}\u0000${apiFormat}\u0000${row.model}`;
    const group = groups.get(key) ?? {
      provider: row.provider as TokenUsageRow['provider'],
      apiFormat: apiFormat as TokenUsageRow['apiFormat'],
      model: row.model,
      totalInput: 0, totalOutput: 0, totalCacheRead: 0, totalCacheCreation: 0, totalCalls: 0,
    };
    group.totalInput += inputTokens;
    group.totalOutput += outputTokens;
    group.totalCacheRead += cacheReadTokens;
    group.totalCacheCreation += cacheCreationTokens;
    group.totalCalls++;
    groups.set(key, group);
    totals.input += inputTokens;
    totals.output += outputTokens;
    totals.cacheRead += cacheReadTokens;
    totals.cacheCreation += cacheCreationTokens;
    totals.calls++;
    if (recent.length < 50) recent.push({
      id: row.id,
      projectId: row.project_id,
      sessionId: row.review_session_id ?? (typeof row.metadata?.dynamicSessionId === 'string' ? row.metadata.dynamicSessionId : null),
      scope,
      callKind,
      stage: row.stage,
      roundNumber: row.attempt,
      provider: group.provider,
      apiFormat: group.apiFormat,
      model: row.model,
      inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
      totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
      createdAt: row.created_at,
    });
  }
  return { totals, byGroup: [...groups.values()].sort((a, b) => b.totalInput + b.totalOutput - a.totalInput - a.totalOutput), recent };
}
