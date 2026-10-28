import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret, encryptSecret } from './tokenVault.js';
import type { AiApiFormat, AiProvider } from './settings.js';
import type { EmbeddingProviderId } from './embeddingSettingsTypes.js';
import { isVoyageEmbeddingModel, VOYAGE_EMBEDDING_BASE_URL } from './embeddingSettings.js';
import { EMBEDDING_DIMENSIONS, type EmbeddingProviderConfiguration } from './review/embeddingProvider.js';

export type ModelProviderSettingId = 'text' | 'vision' | 'embedding';

export type ModelProviderSettingView = {
  id: ModelProviderSettingId;
  label: string;
  provider: AiProvider;
  apiFormat: AiApiFormat;
  hasApiKey: boolean;
  apiKeyPreview: string;
  baseUrl: string;
  model: string;
  fallbackEnabled: boolean;
  fallbackProvider: AiProvider | null;
  fallbackApiFormat: AiApiFormat | null;
  fallbackHasApiKey: boolean;
  fallbackApiKeyPreview: string;
  fallbackBaseUrl: string;
  fallbackModel: string;
  embeddingProvider?: EmbeddingProviderId;
  embeddingDimensions?: number;
  updatedAt: string;
};

export type UpdateModelProviderSetting = {
  provider: AiProvider;
  apiFormat: AiApiFormat;
  apiKey: string;
  baseUrl: string;
  model: string;
  fallbackEnabled?: boolean;
  fallbackProvider?: AiProvider | null;
  fallbackApiFormat?: AiApiFormat | null;
  fallbackApiKey?: string;
  fallbackBaseUrl?: string;
  fallbackModel?: string;
  embeddingProvider?: EmbeddingProviderId;
  embeddingDimensions?: number;
};

type ModelRow = Record<string, unknown>;

const providerValues = new Set<AiProvider>(['mimo', 'gemini', 'custom', 'codex']);
const formatValues = new Set<AiApiFormat>(['openai-compatible', 'anthropic-compatible', 'google-native', 'codex-app-server']);

function purpose(id: ModelProviderSettingId): string {
  return id === 'text' ? 'static_review' : id;
}

function label(id: ModelProviderSettingId): string {
  return id === 'text' ? 'Static analysis' : id === 'vision' ? 'Vision analysis' : 'Source indexing';
}

function text(row: ModelRow, key: string): string {
  const value = row[key];
  return value == null ? '' : String(value);
}

function metadata(row: ModelRow): Record<string, unknown> {
  return row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
}

function savedEmbeddingProvider(row: ModelRow): EmbeddingProviderId | null {
  const value = metadata(row).embeddingProvider;
  if (value == null) return 'custom';
  return value === 'voyage' || value === 'custom' ? value : null;
}

function savedEmbeddingDimensions(row: ModelRow, provider: EmbeddingProviderId): number | null {
  const value = metadata(row).embeddingDimensions;
  if (value == null && provider === 'custom') return EMBEDDING_DIMENSIONS;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizedEndpoint(value: string): string {
  try {
    const url = new URL(value.trim());
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim();
  }
}

function embeddingProtocol(provider: EmbeddingProviderId): 'voyage' | 'openai-compatible' {
  return provider === 'voyage' ? 'voyage' : 'openai-compatible';
}

function masked(ciphertext: string): string {
  if (!ciphertext) return '';
  return '••••••••';
}

function asProvider(value: unknown): AiProvider | null {
  return providerValues.has(value as AiProvider) ? value as AiProvider : null;
}

function asFormat(value: unknown): AiApiFormat | null {
  return formatValues.has(value as AiApiFormat) ? value as AiApiFormat : null;
}

export function mapModelProviderSetting(id: ModelProviderSettingId, row: ModelRow | null): ModelProviderSettingView {
  const meta = row ? metadata(row) : {};
  const secret = row ? text(row, 'secret_ciphertext') : '';
  const fallbackSecret = row ? text(row, 'fallback_secret_ciphertext') || text(meta, 'fallbackSecretCiphertext') : '';
  const fallbackProvider = row ? asProvider(row.fallback_provider ?? meta.fallbackProvider) : null;
  const fallbackApiFormat = row ? asFormat(row.fallback_api_format ?? meta.fallbackApiFormat) : null;
  return {
    id,
    label: label(id),
    provider: (row && asProvider(row.provider)) || 'custom',
    apiFormat: (row && asFormat(row.api_format ?? meta.apiFormat)) || 'openai-compatible',
    hasApiKey: Boolean(secret),
    apiKeyPreview: masked(secret),
    baseUrl: row ? text(row, 'base_url') : '',
    model: row ? text(row, 'model') : '',
    fallbackEnabled: Boolean(fallbackProvider),
    fallbackProvider,
    fallbackApiFormat,
    fallbackHasApiKey: Boolean(fallbackSecret),
    fallbackApiKeyPreview: masked(fallbackSecret),
    fallbackBaseUrl: row ? text(row, 'fallback_base_url') || text(meta, 'fallbackBaseUrl') : '',
    fallbackModel: row ? text(row, 'fallback_model') : '',
    ...(id === 'embedding' && row ? {
      embeddingProvider: savedEmbeddingProvider(row) ?? 'custom',
      embeddingDimensions: savedEmbeddingProvider(row)
        ? savedEmbeddingDimensions(row, savedEmbeddingProvider(row)!) ?? undefined
        : undefined,
    } : {}),
    updatedAt: row ? text(row, 'updated_at') : '',
  };
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return String(error ?? 'unknown error');
}

export class SupabaseMigrationRequiredError extends Error {
  readonly code = 'supabase_migration_required';
  readonly statusCode = 503;

  constructor() {
    super('Supabase Model Provider tables are missing. Apply 202609210001_phase1_static_foundation.sql and every later migration in filename order to the Supabase project configured in .env, then reopen Settings.');
    this.name = 'SupabaseMigrationRequiredError';
  }
}

export function validateModelProviderUpdate(input: UpdateModelProviderSetting, existing?: ModelRow | null, id: ModelProviderSettingId = 'text'): void {
  if (!providerValues.has(input.provider)) throw new Error('provider must be mimo, gemini, custom, or codex');
  if (!formatValues.has(input.apiFormat)) throw new Error('apiFormat is invalid');
  let embeddingProvider: EmbeddingProviderId | null = null;
  if (id === 'embedding' && (input.provider !== 'custom' || input.apiFormat !== 'openai-compatible' || input.fallbackEnabled)) {
    throw new Error('Source indexing requires one custom OpenAI-compatible embedding provider without fallback.');
  }
  if (id === 'embedding') {
    const priorEmbeddingProvider = existing ? savedEmbeddingProvider(existing) : 'custom';
    if (existing && !priorEmbeddingProvider) throw new Error('The saved embedding provider protocol is not supported.');
    embeddingProvider = input.embeddingProvider ?? priorEmbeddingProvider ?? 'custom';
    if (embeddingProvider !== 'voyage' && embeddingProvider !== 'custom') throw new Error('embeddingProvider must be voyage or custom');
    const dimensions = input.embeddingDimensions ?? (embeddingProvider === 'voyage' ? 1024 : EMBEDDING_DIMENSIONS);
    if (embeddingProvider === 'voyage') {
      if (dimensions !== 1024) throw new Error('Voyage embeddings require exactly 1024 dimensions.');
      if (!isVoyageEmbeddingModel(input.model.trim())) throw new Error('Select a published Voyage embedding model.');
      if (normalizedEndpoint(input.baseUrl) !== normalizedEndpoint(VOYAGE_EMBEDDING_BASE_URL)) {
        throw new Error(`Voyage embeddings require the official endpoint ${VOYAGE_EMBEDDING_BASE_URL}.`);
      }
    } else if (dimensions !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Custom source indexing requires ${EMBEDDING_DIMENSIONS} dimensions for the existing index.`);
    }
    const previousSecret = text(existing ?? {}, 'secret_ciphertext');
    const providerChanged = priorEmbeddingProvider !== embeddingProvider;
    const endpointChanged = !existing
      || normalizedEndpoint(text(existing, 'base_url')) !== normalizedEndpoint(input.baseUrl);
    if (!input.apiKey.trim() && (!previousSecret || providerChanged || endpointChanged)) {
      throw new Error('apiKey is required when changing the embedding provider or endpoint.');
    }
  }
  if (input.provider === 'codex' || input.apiFormat === 'codex-app-server') {
    if (input.provider !== 'codex' || input.apiFormat !== 'codex-app-server' || id === 'embedding') throw new Error('Codex is available only for text and vision analysis.');
    if (!input.model.trim()) throw new Error('model is required');
    if (input.apiKey.trim() || input.baseUrl.trim()) throw new Error('Codex uses local sign-in, not an API key or endpoint.');
  } else if (!input.apiKey.trim() && !text(existing ?? {}, 'secret_ciphertext')) throw new Error('apiKey is required');
  if (input.provider !== 'codex' && !/^https?:\/\//i.test(input.baseUrl.trim())) throw new Error('baseUrl must start with http:// or https://');
  if (!input.model.trim()) throw new Error('model is required');
  if (!input.fallbackEnabled) return;
  if (input.fallbackProvider === 'codex' || input.fallbackApiFormat === 'codex-app-server') throw new Error('Codex fallback is not supported; select an API fallback.');
  if (!input.fallbackProvider || !providerValues.has(input.fallbackProvider)) throw new Error('fallbackProvider is required');
  if (!input.fallbackApiFormat || !formatValues.has(input.fallbackApiFormat)) throw new Error('fallbackApiFormat is required');
  const previousFallbackSecret = text(existing ?? {}, 'fallback_secret_ciphertext') || text(metadata(existing ?? {}), 'fallbackSecretCiphertext');
  if (!input.fallbackApiKey?.trim() && !previousFallbackSecret) throw new Error('fallbackApiKey is required');
  if (!/^https?:\/\//i.test(input.fallbackBaseUrl?.trim() ?? '')) throw new Error('fallbackBaseUrl must start with http:// or https://');
  if (!input.fallbackModel?.trim()) throw new Error('fallbackModel is required');
}

async function findRow(client: SupabaseClient, userId: string, id: ModelProviderSettingId, signal?: AbortSignal): Promise<ModelRow | null> {
  let query = client.from('model_configurations').select('*')
    .eq('owner_id', userId).eq('purpose', purpose(id)).is('project_id', null)
    .order('updated_at', { ascending: false }).limit(1);
  if (signal) query = query.abortSignal(signal);
  const result = await query.maybeSingle();
  if (result.error?.code === 'PGRST205' || result.error?.code === '42P01') throw new SupabaseMigrationRequiredError();
  if (result.error) throw new Error(`Model Provider lookup failed: ${result.error.message}`);
  return result.data as ModelRow | null;
}

export async function listModelProviderSettings(client: SupabaseClient, userId: string): Promise<ModelProviderSettingView[]> {
  const [textRow, visionRow, embeddingRow] = await Promise.all([findRow(client, userId, 'text'), findRow(client, userId, 'vision'), findRow(client, userId, 'embedding')]);
  return [mapModelProviderSetting('text', textRow), mapModelProviderSetting('vision', visionRow), mapModelProviderSetting('embedding', embeddingRow)];
}

export async function saveModelProviderSetting(
  client: SupabaseClient,
  userId: string,
  id: ModelProviderSettingId,
  input: UpdateModelProviderSetting,
): Promise<ModelProviderSettingView> {
  const existing = await findRow(client, userId, id);
  validateModelProviderUpdate(input, existing, id);
  const meta = metadata(existing ?? {});
  const primarySecret = input.provider === 'codex' ? null : input.apiKey.trim() ? encryptSecret(input.apiKey.trim()) : text(existing ?? {}, 'secret_ciphertext');
  const previousFallbackSecret = text(existing ?? {}, 'fallback_secret_ciphertext') || text(meta, 'fallbackSecretCiphertext');
  const fallbackSecret = input.fallbackEnabled
    ? (input.fallbackApiKey?.trim() ? encryptSecret(input.fallbackApiKey.trim()) : previousFallbackSecret)
    : null;
  const cleanMetadata = { ...meta };
  for (const key of ['fallbackProvider', 'fallbackApiFormat', 'fallbackModel', 'fallbackBaseUrl', 'fallbackSecretCiphertext']) delete cleanMetadata[key];
  const payload = {
    owner_id: userId,
    project_id: null,
    purpose: purpose(id),
    provider: input.provider,
    api_format: input.apiFormat,
    model: input.model.trim(),
    base_url: id === 'embedding' && (input.embeddingProvider ?? (existing ? savedEmbeddingProvider(existing) : 'custom')) === 'voyage'
      ? VOYAGE_EMBEDDING_BASE_URL : input.baseUrl.trim(),
    secret_ciphertext: primarySecret,
    fallback_provider: input.fallbackEnabled ? input.fallbackProvider : null,
    fallback_api_format: input.fallbackEnabled ? input.fallbackApiFormat : null,
    fallback_model: input.fallbackEnabled ? input.fallbackModel?.trim() : null,
    fallback_base_url: input.fallbackEnabled ? input.fallbackBaseUrl?.trim() : null,
    fallback_secret_ciphertext: fallbackSecret,
    enabled: true,
    metadata: {
      ...cleanMetadata,
      apiFormat: input.apiFormat,
      ...(id === 'embedding' ? {
        embeddingProvider: input.embeddingProvider ?? (existing ? savedEmbeddingProvider(existing) : 'custom') ?? 'custom',
        embeddingProtocol: embeddingProtocol(input.embeddingProvider ?? (existing ? savedEmbeddingProvider(existing) : 'custom') ?? 'custom'),
        embeddingDimensions: input.embeddingDimensions ?? ((input.embeddingProvider ?? (existing ? savedEmbeddingProvider(existing) : 'custom')) === 'voyage' ? 1024 : EMBEDDING_DIMENSIONS),
      } : {}),
    },
    updated_at: new Date().toISOString(),
  };
  const query = existing?.id
    ? client.from('model_configurations').update(payload).eq('id', String(existing.id)).select('*').single()
    : client.from('model_configurations').insert(payload).select('*').single();
  const result = await query;
  if (result.error || !result.data) throw new Error(`Model Provider save failed: ${errorMessage(result.error)}`);
  return mapModelProviderSetting(id, result.data as ModelRow);
}

export async function resolveSavedProviderForTest(
  client: SupabaseClient,
  userId: string,
  id: 'text' | 'vision',
  input: Partial<UpdateModelProviderSetting> = {},
  useFallback = false,
): Promise<{ provider: AiProvider; apiFormat: AiApiFormat; apiKey: string; baseUrl: string; model: string }> {
  const row = await findRow(client, userId, id);
  const selectedProvider = useFallback ? input.fallbackProvider ?? row?.fallback_provider : input.provider ?? row?.provider;
  if (selectedProvider === 'codex') {
    const model = input.model ?? text(row ?? {}, 'model');
    if (useFallback || !model.trim()) throw new Error('Codex model is not configured.');
    return { provider: 'codex', apiFormat: 'codex-app-server', apiKey: '', baseUrl: '', model };
  }
  if (!row && !input.apiKey) throw new Error('The Model Provider is not configured.');
  const meta = metadata(row ?? {});
  const fallback = useFallback;
  const secret = fallback
    ? input.fallbackApiKey?.trim() || decryptSecret(text(row ?? {}, 'fallback_secret_ciphertext') || text(meta, 'fallbackSecretCiphertext'))
    : input.apiKey?.trim() || decryptSecret(text(row ?? {}, 'secret_ciphertext'));
  const provider = fallback
    ? input.fallbackProvider ?? asProvider(row?.fallback_provider ?? meta.fallbackProvider)
    : input.provider ?? asProvider(row?.provider);
  const apiFormat = fallback
    ? input.fallbackApiFormat ?? asFormat(row?.fallback_api_format ?? meta.fallbackApiFormat)
    : input.apiFormat ?? asFormat(row?.api_format ?? meta.apiFormat);
  const baseUrl = fallback
    ? (input.fallbackBaseUrl ?? (text(row ?? {}, 'fallback_base_url') || text(meta, 'fallbackBaseUrl')))
    : (input.baseUrl ?? text(row ?? {}, 'base_url'));
  const model = fallback ? input.fallbackModel ?? text(row ?? {}, 'fallback_model') : input.model ?? text(row ?? {}, 'model');
  if (!provider || !apiFormat || !secret || !baseUrl || !model) throw new Error('The selected Model Provider configuration is incomplete.');
  return { provider, apiFormat, apiKey: secret, baseUrl, model };
}

/** No environment or built-in provider fallback: indexing uses only the
 * credential explicitly configured in the signed-in user's settings. */
export type SavedEmbeddingConfiguration = EmbeddingProviderConfiguration & {
  embeddingProvider: EmbeddingProviderId;
  dimensions: number;
};

export async function resolveSavedEmbeddingConfiguration(
  client: SupabaseClient,
  userId: string,
  signal?: AbortSignal,
): Promise<SavedEmbeddingConfiguration | null> {
  const row = await findRow(client, userId, 'embedding', signal);
  if (!row || row.enabled === false) return null;
  if (row.provider !== 'custom' || row.api_format !== 'openai-compatible') {
    throw new Error('Source indexing requires the custom OpenAI-compatible database provider format.');
  }
  const provider = savedEmbeddingProvider(row);
  if (!provider) throw new Error('The saved embedding protocol is not supported.');
  const meta = metadata(row);
  const expectedProtocol = embeddingProtocol(provider);
  if (meta.embeddingProtocol != null && meta.embeddingProtocol !== expectedProtocol) {
    throw new Error('The saved embedding protocol metadata is inconsistent.');
  }
  const dimensions = savedEmbeddingDimensions(row, provider);
  if (dimensions == null || dimensions !== (provider === 'voyage' ? 1024 : EMBEDDING_DIMENSIONS)) {
    throw new Error('The saved embedding dimensions are not supported.');
  }
  const model = text(row, 'model');
  const storedBaseUrl = text(row, 'base_url');
  if (!model || !storedBaseUrl) throw new Error('The source-indexing provider configuration is incomplete.');
  if (provider === 'voyage') {
    if (!isVoyageEmbeddingModel(model)) throw new Error('The saved Voyage embedding model is not supported.');
    if (normalizedEndpoint(storedBaseUrl) !== normalizedEndpoint(VOYAGE_EMBEDDING_BASE_URL)) {
      throw new Error('The saved Voyage embedding endpoint is not the official API endpoint.');
    }
  }
  const secret = text(row, 'secret_ciphertext');
  if (!secret) throw new Error('The source-indexing provider configuration is incomplete.');
  const baseUrl = provider === 'voyage' ? VOYAGE_EMBEDDING_BASE_URL : storedBaseUrl;
  return { apiKey: decryptSecret(secret), baseUrl, model, embeddingProvider: provider, dimensions };
}

export async function resolveSavedEmbeddingProvider(
  client: SupabaseClient,
  userId: string,
  signal?: AbortSignal,
): Promise<{ apiKey: string; baseUrl: string; model: string } | null> {
  const configuration = await resolveSavedEmbeddingConfiguration(client, userId, signal);
  if (!configuration) return null;
  if (configuration.embeddingProvider !== 'custom' || configuration.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(`The existing Review index requires ${EMBEDDING_DIMENSIONS}-dimensional custom embeddings. Voyage's 1024-dimensional vectors are incompatible.`);
  }
  return { apiKey: configuration.apiKey, baseUrl: configuration.baseUrl, model: configuration.model };
}
