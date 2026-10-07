import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret, encryptSecret } from './tokenVault.js';
import type { AiApiFormat, AiProvider } from './settings.js';

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
  if (id === 'embedding' && (input.provider !== 'custom' || input.apiFormat !== 'openai-compatible' || input.fallbackEnabled)) {
    throw new Error('Source indexing requires one custom OpenAI-compatible embedding provider without fallback.');
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
    base_url: input.baseUrl.trim(),
    secret_ciphertext: primarySecret,
    fallback_provider: input.fallbackEnabled ? input.fallbackProvider : null,
    fallback_api_format: input.fallbackEnabled ? input.fallbackApiFormat : null,
    fallback_model: input.fallbackEnabled ? input.fallbackModel?.trim() : null,
    fallback_base_url: input.fallbackEnabled ? input.fallbackBaseUrl?.trim() : null,
    fallback_secret_ciphertext: fallbackSecret,
    enabled: true,
    metadata: { ...cleanMetadata, apiFormat: input.apiFormat },
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
export async function resolveSavedEmbeddingProvider(
  client: SupabaseClient,
  userId: string,
  signal?: AbortSignal,
): Promise<{ apiKey: string; baseUrl: string; model: string } | null> {
  const row = await findRow(client, userId, 'embedding', signal);
  if (!row || row.enabled === false) return null;
  if (row.provider !== 'custom' || row.api_format !== 'openai-compatible') {
    throw new Error('The source-indexing provider must use the custom OpenAI-compatible format.');
  }
  const secret = text(row, 'secret_ciphertext');
  if (!secret || !text(row, 'base_url') || !text(row, 'model')) throw new Error('The source-indexing provider configuration is incomplete.');
  return { apiKey: decryptSecret(secret), baseUrl: text(row, 'base_url'), model: text(row, 'model') };
}
