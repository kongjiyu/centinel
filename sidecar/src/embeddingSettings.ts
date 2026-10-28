import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingModelOption, EmbeddingModelUsage, EmbeddingSettingsCatalog } from './embeddingSettingsTypes.js';
import { getSupabaseModelUsageSummary } from './modelUsageSummary.js';

export const VOYAGE_EMBEDDING_BASE_URL = 'https://api.voyageai.com/v1';
export const VOYAGE_EMBEDDING_DASHBOARD_URL = 'https://dashboard.voyageai.com/';
export const VOYAGE_EMBEDDING_DOCUMENTATION_URL = 'https://docs.voyageai.com/reference/embeddings-api';
export const VOYAGE_EMBEDDING_PRICING_URL = 'https://docs.voyageai.com/docs/pricing';
export const EMBEDDING_SETTINGS_VERIFIED_AT = '2026-10-26';

export const VOYAGE_EMBEDDING_MODELS: readonly EmbeddingModelOption[] = [
  { id: 'voyage-4-lite', label: 'Voyage 4 Lite', provider: 'voyage', dimensions: 1024, publishedFreeTokens: 200_000_000, documentationUrl: VOYAGE_EMBEDDING_DOCUMENTATION_URL },
  { id: 'voyage-4', label: 'Voyage 4', provider: 'voyage', dimensions: 1024, publishedFreeTokens: 200_000_000, documentationUrl: VOYAGE_EMBEDDING_DOCUMENTATION_URL },
  { id: 'voyage-4-large', label: 'Voyage 4 Large', provider: 'voyage', dimensions: 1024, publishedFreeTokens: 200_000_000, documentationUrl: VOYAGE_EMBEDDING_DOCUMENTATION_URL },
];

export function isVoyageEmbeddingModel(model: string): boolean {
  return VOYAGE_EMBEDDING_MODELS.some(option => option.id === model);
}

function safeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function embeddingUsage(summary: Awaited<ReturnType<typeof getSupabaseModelUsageSummary>>): EmbeddingModelUsage[] {
  const grouped = new Map<string, { knownTokens: number | null; calls: number; unknownCalls: number }>();
  for (const group of summary.byGroup) {
    if (!group.model) continue;
    const calls = safeCount(group.totalCalls) ?? 0;
    const knownTokens = safeCount(group.totalTokens);
    // A missing unknown-call count is incomplete evidence; keep those calls unknown.
    const unknownCalls = safeCount(group.unknownTotalCalls) ?? calls;
    const prior = grouped.get(group.model);
    if (!prior) {
      grouped.set(group.model, { knownTokens, calls, unknownCalls });
      continue;
    }
    prior.knownTokens = prior.knownTokens === null || knownTokens === null
      ? null
      : prior.knownTokens + knownTokens;
    prior.calls += calls;
    prior.unknownCalls += unknownCalls;
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([model, usage]) => ({ model, ...usage }));
}

/**
 * Builds the published, non-entitlement model catalog and reads only the
 * owner's existing embedding usage ledger. It never contacts an embedding API.
 */
export async function getEmbeddingSettingsCatalog(client: SupabaseClient, userId: string): Promise<EmbeddingSettingsCatalog> {
  const remaining = {
    status: 'not_reported' as const,
    tokens: null,
    message: 'Remaining account balance is not available through this integration. Check the Voyage dashboard.',
    dashboardUrl: VOYAGE_EMBEDDING_DASHBOARD_URL,
  };
  try {
    const summary = await getSupabaseModelUsageSummary(client, userId, { scope: 'embedding' });
    return {
      source: 'published_catalog',
      verifiedAt: EMBEDDING_SETTINGS_VERIFIED_AT,
      models: [...VOYAGE_EMBEDDING_MODELS],
      usageAvailable: true,
      usage: embeddingUsage(summary),
      remaining,
    };
  } catch {
    return {
      source: 'published_catalog',
      verifiedAt: EMBEDDING_SETTINGS_VERIFIED_AT,
      models: [...VOYAGE_EMBEDDING_MODELS],
      usageAvailable: false,
      usage: [],
      remaining,
    };
  }
}
