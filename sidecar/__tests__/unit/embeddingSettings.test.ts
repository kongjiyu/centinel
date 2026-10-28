import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getEmbeddingSettingsCatalog } from '../../src/embeddingSettings.js';

function ledgerClient(rows: Record<string, unknown>[], fail = false) {
  const filters: unknown[][] = [];
  const query: any = {
    select: () => query, order: () => query,
    eq: (...args: unknown[]) => { filters.push(args); return query; },
    range: () => Promise.resolve({ data: rows, error: fail ? { message: 'PRIVATE_DATABASE_ERROR' } : null }),
  };
  return { client: { from: vi.fn(() => query) } as unknown as SupabaseClient, filters };
}

function usage(id: string, model: string, tokens: number | null, callKind = 'test') {
  return { id, owner_id: 'owner', model, provider: 'custom', stage: 'embedding-provider-test', attempt: 1,
    input_tokens: tokens, output_tokens: tokens === null ? null : 0,
    cache_read_tokens: 0, cache_creation_tokens: 0,
    metadata: { scope: 'embedding', callKind, apiFormat: 'openai-compatible' },
  };
}

describe('embedding settings catalog', () => {
  it('aggregates owner ledger usage across test and review calls without deriving remaining balance', async () => {
    const { client, filters } = ledgerClient([
      usage('one', 'voyage-4-lite', 4), usage('two', 'voyage-4-lite', 6, 'review'),
      usage('three', 'voyage-4-lite', null), usage('four', 'voyage-4', 20),
      { ...usage('text', 'text-model', 900), stage: 'provider-test', metadata: { scope: 'text' } },
    ]);
    const catalog = await getEmbeddingSettingsCatalog(client, 'owner');
    expect(filters).toContainEqual(['owner_id', 'owner']);
    expect(catalog).toMatchObject({ usageAvailable: true, remaining: { status: 'not_reported', tokens: null } });
    expect(catalog.usage).toEqual([
      { model: 'voyage-4', knownTokens: 20, calls: 1, unknownCalls: 0 },
      { model: 'voyage-4-lite', knownTokens: 10, calls: 3, unknownCalls: 1 },
    ]);
    expect(catalog.models.map(model => model.id)).toEqual(['voyage-4-lite', 'voyage-4', 'voyage-4-large']);
    expect(catalog.models.every(model => model.dimensions === 1024)).toBe(true);
  });

  it('distinguishes all-unknown calls, no usage, and unavailable ledger data', async () => {
    const unknown = await getEmbeddingSettingsCatalog(ledgerClient([usage('unknown', 'voyage-4-lite', null)]).client, 'owner');
    expect(unknown.usage).toEqual([{ model: 'voyage-4-lite', knownTokens: 0, calls: 1, unknownCalls: 1 }]);
    const empty = await getEmbeddingSettingsCatalog(ledgerClient([]).client, 'owner');
    expect(empty).toMatchObject({ usageAvailable: true, usage: [] });
    const unavailable = await getEmbeddingSettingsCatalog(ledgerClient([], true).client, 'owner');
    expect(unavailable).toMatchObject({ usageAvailable: false, usage: [], remaining: { tokens: null } });
    expect(unavailable.models).toHaveLength(3);
    expect(JSON.stringify(unavailable)).not.toContain('PRIVATE_DATABASE_ERROR');
  });
});
