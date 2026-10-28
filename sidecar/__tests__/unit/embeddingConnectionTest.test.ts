import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { testSavedEmbeddingModel } from '../../src/embeddingConnectionTest.js';
import { EmbeddingProviderError } from '../../src/review/embeddingProvider.js';

const client = {} as SupabaseClient;
const configuration = { apiKey: 'PRIVATE_TEST_KEY', baseUrl: 'https://api.voyageai.com/v1',
  model: 'voyage-4-lite', embeddingProvider: 'voyage' as const, dimensions: 1024 };
const result = { embedding: Array.from({ length: 1024 }, () => 0.5), model: 'voyage-4-lite', inputTokens: 3, providerReportedTotalTokens: 3 };

describe('saved embedding connection test', () => {
  it('labels a failed no-response probe as assumed zero while keeping actual usage unknown', async () => {
    const saveUsage = vi.fn(async () => undefined);
    await testSavedEmbeddingModel(client, 'owner', { resolve: async () => configuration,
      embed: async () => { throw new EmbeddingProviderError('Could not reach provider.', 'network_error', undefined, { responseReceived: false }); }, saveUsage });
    expect(saveUsage).toHaveBeenCalledWith(client, expect.objectContaining({ inputTokens: null, outputTokens: null, metadata: expect.objectContaining({
      responseReceived: false, usageAccounting: { basis: 'assumed_zero_no_response', accountedTokens: 0 },
    }) }));
  });
  it('does not call a provider or write usage when configuration is missing', async () => {
    const embed = vi.fn(); const saveUsage = vi.fn();
    expect(await testSavedEmbeddingModel(client, 'owner', { resolve: async () => null, embed, saveUsage }))
      .toMatchObject({ statusCode: 409, result: { status: 'fail' } });
    expect(embed).not.toHaveBeenCalled(); expect(saveUsage).not.toHaveBeenCalled();
  });

  it('tests the saved model once and records actual usage without saving vectors or secrets', async () => {
    const embed = vi.fn(async () => result); const saveUsage = vi.fn(async () => undefined);
    const response = await testSavedEmbeddingModel(client, 'owner', { resolve: async () => configuration, embed, saveUsage });
    expect(response).toMatchObject({ statusCode: 200, result: { status: 'pass', message: expect.stringContaining('1024-dimensional') } });
    expect(embed).toHaveBeenCalledOnce();
    expect(saveUsage).toHaveBeenCalledWith(client, expect.objectContaining({ ownerId: 'owner', projectId: null,
      outcome: 'success', model: 'voyage-4-lite', inputTokens: 3, metadata: expect.objectContaining({ scope: 'embedding',
        embeddingProtocol: 'voyage', embeddingDimensions: 1024, providerReportedTotalTokens: 3 }) }));
    expect(JSON.stringify(saveUsage.mock.calls)).not.toContain('PRIVATE_TEST_KEY');
    expect(JSON.stringify(response)).not.toContain('PRIVATE_TEST_KEY');
  });

  it('stops on capacity errors with one attempt, no fallback and unknown usage', async () => {
    const embed = vi.fn(async () => { throw new EmbeddingProviderError('The provider is rate limited.', 'rate_limited'); });
    const saveUsage = vi.fn(async () => undefined);
    expect(await testSavedEmbeddingModel(client, 'owner', { resolve: async () => configuration, embed, saveUsage }))
      .toMatchObject({ statusCode: 502, result: { status: 'fail', code: 'rate_limited' } });
    expect(embed).toHaveBeenCalledOnce();
    expect(saveUsage).toHaveBeenCalledWith(client, expect.objectContaining({ outcome: 'permanent_error', inputTokens: null,
      outputTokens: null, errorCode: 'rate_limited', metadata: expect.objectContaining({ providerReportedTotalTokens: null }) }));
  });

  it('retains known usage from a malformed provider result', async () => {
    const embed = vi.fn(async () => { throw Object.assign(new EmbeddingProviderError('Invalid vector dimensions.', 'invalid_dimensions'),
      { safeUsage: { inputTokens: 9, providerReportedTotalTokens: 9 } }); });
    const saveUsage = vi.fn(async () => undefined);
    await testSavedEmbeddingModel(client, 'owner', { resolve: async () => configuration, embed, saveUsage });
    expect(saveUsage).toHaveBeenCalledWith(client, expect.objectContaining({ outcome: 'permanent_error', inputTokens: 9,
      metadata: expect.objectContaining({ providerReportedTotalTokens: 9 }) }));
  });

  it('shows a successful provider result even when the usage ledger fails', async () => {
    const response = await testSavedEmbeddingModel(client, 'owner', { resolve: async () => configuration,
      embed: async () => result, saveUsage: async () => { throw Error('PRIVATE_DATABASE_DETAIL'); } });
    expect(response).toMatchObject({ statusCode: 200, result: { status: 'pass', hint: expect.stringContaining('could not be recorded') } });
    expect(JSON.stringify(response)).not.toContain('PRIVATE_DATABASE_DETAIL');
  });

  it('does not expose unexpected provider exception details', async () => {
    const response = await testSavedEmbeddingModel(client, 'owner', { resolve: async () => configuration,
      embed: async () => { throw Error('PRIVATE_TEST_KEY'); }, saveUsage: async () => undefined });
    expect(response).toMatchObject({ statusCode: 502, result: { status: 'fail', code: 'provider_unavailable' } });
    expect(JSON.stringify(response)).not.toContain('PRIVATE_TEST_KEY');
  });
});
