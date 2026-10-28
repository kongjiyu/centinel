import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StaticModelRequest } from '../../src/review/types.js';

const fixtures = vi.hoisted(() => ({
  currentClient: null as object | null,
  rejectClient: null as object | null,
  rotateAfterAnalyze: null as object | null,
  configurationClients: [] as unknown[],
  usageClients: [] as unknown[],
}));

vi.mock('../../src/store/index.js', () => ({
  SupabaseCentinelStore: class {
    constructor(private readonly client: unknown) {}

    async saveModelUsage() {
      fixtures.usageClients.push(this.client);
      if (this.client === fixtures.rejectClient) throw new Error('The expired Supabase client rejected the usage write.');
      return {};
    }
  },
}));

vi.mock('../../src/review/modelProviderResolver.js', () => ({
  SupabaseModelConfigurationRepository: class {
    constructor(private readonly client: unknown) {}

    async getModelConfiguration() {
      fixtures.configurationClients.push(this.client);
      if (this.client === fixtures.rejectClient) throw new Error('The expired Supabase client rejected configuration access.');
      return {};
    }
  },
  resolveModelProviderChain: async (repository: { getModelConfiguration: () => Promise<unknown> }) => {
    await repository.getModelConfiguration();
    return {
      primaryProvider: {
        analyze: async () => {
          if (fixtures.rotateAfterAnalyze) fixtures.currentClient = fixtures.rotateAfterAnalyze;
          return {
            result: { accepted: true },
            settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'synthetic' },
          };
        },
      },
      fallbackProvider: null,
      primaryMetadata: { provider: 'custom', apiFormat: 'openai-compatible', model: 'synthetic' },
      fallbackMetadata: null,
    };
  },
}));

import { createGroundingModelProvider } from '../../src/review/groundingProvider.js';

const request = (batch: number): StaticModelRequest => ({
  reviewId: `readiness:project-1:batch-${batch}`,
  projectId: 'project-1',
  stage: 'project_readiness_assessment',
  systemPrompt: 'synthetic',
  prompt: `batch ${batch}`,
});

beforeEach(() => {
  fixtures.currentClient = null;
  fixtures.rejectClient = null;
  fixtures.rotateAfterAnalyze = null;
  fixtures.configurationClients.length = 0;
  fixtures.usageClients.length = 0;
});

describe('readiness grounding provider client freshness', () => {
  it('refreshes the configuration client per batch and each attempt write', async () => {
    const staleClient = { label: 'expired' };
    const firstBatchClient = { label: 'current-before-batch-one' };
    const firstBatchCompletionClient = { label: 'current-after-batch-one' };
    const secondBatchCompletionClient = { label: 'current-after-batch-two' };
    fixtures.currentClient = staleClient;
    fixtures.rejectClient = staleClient;

    const provider = createGroundingModelProvider(
      () => fixtures.currentClient as unknown as SupabaseClient,
      'owner-1',
    );

    // The provider was created with a stale session; the first batch begins after refresh.
    fixtures.currentClient = firstBatchClient;
    fixtures.rotateAfterAnalyze = firstBatchCompletionClient;
    await expect(provider.analyze(request(1))).resolves.toMatchObject({ result: { accepted: true } });

    // Reuse the same provider for the next batch, then refresh again while its model call runs.
    fixtures.rotateAfterAnalyze = secondBatchCompletionClient;
    await expect(provider.analyze(request(2))).resolves.toMatchObject({ result: { accepted: true } });

    expect(fixtures.configurationClients).toEqual([firstBatchClient, firstBatchCompletionClient]);
    expect(fixtures.usageClients).toEqual([
      firstBatchClient, firstBatchCompletionClient,
      firstBatchCompletionClient, secondBatchCompletionClient,
    ]);
    expect(fixtures.configurationClients).not.toContain(staleClient);
    expect(fixtures.usageClients).not.toContain(staleClient);

    const pinnedProvider = createGroundingModelProvider(staleClient as unknown as SupabaseClient, 'owner-1');
    await expect(pinnedProvider.analyze(request(3))).rejects.toThrow('expired Supabase client rejected configuration access');
  });
});
