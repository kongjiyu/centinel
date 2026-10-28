import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveSavedEmbeddingConfiguration } from './modelSettings.js';
import { createEmbedding, EmbeddingProviderError, embeddingFailureUsage } from './review/embeddingProvider.js';
import { SupabaseCentinelStore } from './store/supabase.js';
import type { StoreModelUsage } from './store/types.js';

type UsageInput = Omit<StoreModelUsage, 'id' | 'createdAt'>;
type Dependencies = {
  resolve: typeof resolveSavedEmbeddingConfiguration;
  embed: typeof createEmbedding;
  saveUsage: (client: SupabaseClient, input: UsageInput) => Promise<unknown>;
};

const defaults: Dependencies = {
  resolve: resolveSavedEmbeddingConfiguration,
  embed: createEmbedding,
  saveUsage: (client, input) => new SupabaseCentinelStore(client).saveModelUsage(input),
};

/** A deliberate saved-settings probe. Never indexes files or retries/falls back. */
export async function testSavedEmbeddingModel(
  client: SupabaseClient,
  ownerId: string,
  overrides: Partial<Dependencies> = {},
): Promise<{ statusCode: number; result: { status: 'pass' | 'fail'; message: string; code?: string; hint?: string } }> {
  const dependencies = { ...defaults, ...overrides };
  let configuration: Awaited<ReturnType<typeof resolveSavedEmbeddingConfiguration>>;
  try { configuration = await dependencies.resolve(client, ownerId); }
  catch {
    return { statusCode: 409, result: { status: 'fail', message: 'The saved embedding configuration is incomplete.' } };
  }
  if (!configuration) return { statusCode: 409, result: { status: 'fail', message: 'Save an embedding provider before testing it.' } };
  const started = Date.now();
  let inputTokens: number | null = null;
  let providerTotal: number | null = null;
  let errorCode: string | null = null;
  let dimensions: number | null = null;
  let model = configuration.model;
  let failure: unknown;
  let failed = false;
  let responseReceived: boolean | undefined;
  let usageObservation: EmbeddingProviderError['usageObservation'];
  try {
    const embedded = await dependencies.embed(configuration, 'Centinel embedding connection test.');
    inputTokens = embedded.inputTokens;
    providerTotal = embedded.providerReportedTotalTokens ?? null;
    dimensions = embedded.embedding.length;
    model = embedded.model;
    responseReceived = true;
  } catch (cause) {
    failed = true;
    failure = cause;
    errorCode = cause instanceof EmbeddingProviderError ? cause.code : 'provider_unavailable';
    // Some malformed responses still report real usage. Retain safe counts if
    // supplied by the adapter, without exposing response bodies or credentials.
    const observed = embeddingFailureUsage(cause);
    const usage = observed.safeUsage;
    const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    inputTokens = count(usage?.inputTokens);
    providerTotal = count(usage?.providerReportedTotalTokens);
    responseReceived = observed.responseReceived;
    usageObservation = observed.usageObservation;
  }
  let recorded = true;
  try {
    await dependencies.saveUsage(client, {
      projectId: null, reviewSessionId: null, ownerId, stage: 'embedding-provider-test', attempt: 1,
      provider: 'custom', model, outcome: failed ? 'permanent_error' : 'success',
      inputTokens, outputTokens: failed ? null : 0,
      cacheReadTokens: failed ? null : 0, cacheCreationTokens: failed ? null : 0,
      durationMs: Date.now() - started, errorCode, cost: null,
      metadata: {
        apiFormat: 'openai-compatible', embeddingProtocol: configuration.embeddingProvider === 'voyage' ? 'voyage' : 'openai-compatible',
        callKind: 'test', scope: 'embedding', embeddingProvider: configuration.embeddingProvider,
        embeddingDimensions: dimensions, providerReportedTotalTokens: providerTotal,
        normalizedTotalTokens: inputTokens, normalizedTotalTokensSource: inputTokens === null ? null : 'adapter_derived',
        responseReceived, usageObservation,
        ...(failed && responseReceived === false && inputTokens === null && providerTotal === null
          ? { usageAccounting: { basis: 'assumed_zero_no_response', accountedTokens: 0 } } : {}),
      },
    });
  } catch { recorded = false; }
  const hint = recorded ? undefined : 'The provider result is shown, but this test’s usage could not be recorded.';
  return failed
    ? { statusCode: 502, result: { status: 'fail', code: errorCode!, hint,
      message: failure instanceof EmbeddingProviderError ? failure.message : 'The embedding provider could not be tested.' } }
    : { statusCode: 200, result: { status: 'pass', hint,
      message: `The saved embedding model returned a valid ${dimensions}-dimensional vector. No repository index was changed.` } };
}
