import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret } from '../tokenVault.js';
import { createSupabaseClient } from '../supabase.js';
import type { AiApiFormat, AiProvider } from '../settings.js';
import { ConfiguredTextModelProvider, type ModelSettingResolver } from './modelProvider.js';
import type { ModelProviderSettings, StaticAnalysisModelProvider } from './types.js';

/**
 * The model configuration row deliberately contains no plaintext key.  The
 * encrypted values are unwrapped only inside the sidecar, immediately before
 * creating a request-scoped provider.  Keep this type separate from the
 * renderer-facing settings type so a secret cannot accidentally cross the
 * HTTP boundary.
 */
export type ModelConfigurationRecord = {
  id?: string;
  ownerId?: string;
  projectId?: string | null;
  purpose?: string;
  provider: string;
  apiFormat?: string;
  model: string;
  baseUrl?: string | null;
  secretCiphertext?: string | null;
  fallbackProvider?: string | null;
  fallbackApiFormat?: string | null;
  fallbackModel?: string | null;
  fallbackBaseUrl?: string | null;
  fallbackSecretCiphertext?: string | null;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
};

export type ModelConfigurationScope = {
  ownerId: string;
  projectId?: string | null;
  purpose?: string;
};

export type ModelConfigurationRepository = {
  /** Return the project override, or the user's global configuration when no
   * project override exists. The repository must run in the caller's RLS
   * context; ownerId is a canonical auth.users.id, never a header value. */
  getModelConfiguration(scope: ModelConfigurationScope, signal?: AbortSignal): Promise<ModelConfigurationRecord | null>;
};

export type ResolvedModelProviderChain = {
  primary: ModelProviderSettings;
  fallback: ModelProviderSettings | null;
  primaryProvider: StaticAnalysisModelProvider;
  fallbackProvider: StaticAnalysisModelProvider | null;
  primaryMetadata: Pick<ModelProviderSettings, 'provider' | 'apiFormat' | 'model'>;
  fallbackMetadata: Pick<ModelProviderSettings, 'provider' | 'apiFormat' | 'model'> | null;
  configurationId: string | null;
};

export class ModelConfigurationError extends Error {
  readonly code:
    | 'not_configured'
    | 'disabled'
    | 'invalid_provider'
    | 'invalid_format'
    | 'invalid_configuration'
    | 'secret_unavailable';

  constructor(message: string, code: ModelConfigurationError['code'], options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = 'ModelConfigurationError';
    this.code = code;
  }
}

const PROVIDERS = new Set<AiProvider>(['mimo', 'gemini', 'custom']);
const FORMATS = new Set<AiApiFormat>(['openai-compatible', 'anthropic-compatible', 'google-native']);

function rowValue(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

function textValue(row: Record<string, unknown>, ...keys: string[]): string | null {
  const value = rowValue(row, ...keys);
  return value === undefined || value === null || String(value).trim() === '' ? null : String(value);
}

function recordFromRow(value: unknown): ModelConfigurationRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const rawMetadata = rowValue(row, 'metadata');
  const metadata = rawMetadata && typeof rawMetadata === 'object' && !Array.isArray(rawMetadata)
    ? rawMetadata as Record<string, unknown>
    : {};
  return {
    id: textValue(row, 'id') ?? undefined,
    ownerId: textValue(row, 'ownerId', 'owner_id') ?? undefined,
    projectId: textValue(row, 'projectId', 'project_id'),
    purpose: textValue(row, 'purpose') ?? undefined,
    provider: textValue(row, 'provider') ?? '',
    apiFormat: textValue(row, 'apiFormat', 'api_format') ?? textValue(metadata, 'apiFormat', 'api_format') ?? undefined,
    model: textValue(row, 'model') ?? '',
    baseUrl: textValue(row, 'baseUrl', 'base_url'),
    secretCiphertext: textValue(row, 'secretCiphertext', 'secret_ciphertext'),
    fallbackProvider: textValue(row, 'fallbackProvider', 'fallback_provider') ?? textValue(metadata, 'fallbackProvider', 'fallback_provider'),
    fallbackApiFormat: textValue(row, 'fallbackApiFormat', 'fallback_api_format') ?? textValue(metadata, 'fallbackApiFormat', 'fallback_api_format'),
    fallbackModel: textValue(row, 'fallbackModel', 'fallback_model') ?? textValue(metadata, 'fallbackModel', 'fallback_model'),
    fallbackBaseUrl: textValue(row, 'fallbackBaseUrl', 'fallback_base_url') ?? textValue(metadata, 'fallbackBaseUrl', 'fallback_base_url'),
    fallbackSecretCiphertext: textValue(row, 'fallbackSecretCiphertext', 'fallback_secret_ciphertext') ?? textValue(metadata, 'fallbackSecretCiphertext', 'fallback_secret_ciphertext'),
    enabled: rowValue(row, 'enabled') === undefined ? true : Boolean(rowValue(row, 'enabled')),
    metadata,
  };
}

function asProvider(value: string | null | undefined, label: string): AiProvider {
  const provider = value as AiProvider;
  if (!PROVIDERS.has(provider)) throw new ModelConfigurationError(`${label} provider configuration is invalid.`, 'invalid_provider');
  return provider;
}

function asFormat(value: string | null | undefined, label: string, provider: AiProvider): AiApiFormat {
  // The migration predates api_format. Keep a deterministic default for old
  // rows while allowing the newer metadata field to select a native format.
  const format = (value || (provider === 'gemini' ? 'google-native' : 'openai-compatible')) as AiApiFormat;
  if (!FORMATS.has(format)) throw new ModelConfigurationError(`${label} API format configuration is invalid.`, 'invalid_format');
  return format;
}

function unwrapSecret(ciphertext: string | null | undefined, label: string): string {
  if (!ciphertext) throw new ModelConfigurationError(`${label} credentials are not configured.`, 'secret_unavailable');
  try {
    const value = decryptSecret(ciphertext);
    if (!value.trim()) throw new Error('empty secret');
    return value;
  } catch (cause) {
    // Never include ciphertext, plaintext, or crypto details in the message.
    throw new ModelConfigurationError(`${label} credentials could not be opened.`, 'secret_unavailable', { cause });
  }
}

function resolveSettings(record: ModelConfigurationRecord): { primary: ModelProviderSettings; fallback: ModelProviderSettings | null } {
  if (record.enabled === false) throw new ModelConfigurationError('The static-analysis Model Provider configuration is disabled.', 'disabled');
  const provider = asProvider(record.provider, 'Primary');
  const apiFormat = asFormat(record.apiFormat, 'Primary', provider);
  const baseUrl = record.baseUrl?.trim() ?? '';
  const model = record.model.trim();
  if (!baseUrl || !model) throw new ModelConfigurationError('Primary Model Provider configuration is incomplete.', 'invalid_configuration');
  const primary: ModelProviderSettings = {
    provider,
    apiFormat,
    apiKey: unwrapSecret(record.secretCiphertext, 'Primary'),
    baseUrl,
    model,
  };

  const fallbackProviderValue = record.fallbackProvider?.trim();
  if (!fallbackProviderValue) return { primary, fallback: null };
  const fallbackProvider = asProvider(fallbackProviderValue, 'Fallback');
  const fallbackApiFormat = asFormat(record.fallbackApiFormat, 'Fallback', fallbackProvider);
  const fallbackBaseUrl = (record.fallbackBaseUrl ?? record.baseUrl ?? '').trim();
  const fallbackModel = (record.fallbackModel ?? '').trim();
  if (!fallbackBaseUrl || !fallbackModel) throw new ModelConfigurationError('Fallback Model Provider configuration is incomplete.', 'invalid_configuration');
  const fallback: ModelProviderSettings = {
    provider: fallbackProvider,
    apiFormat: fallbackApiFormat,
    apiKey: unwrapSecret(record.fallbackSecretCiphertext, 'Fallback'),
    baseUrl: fallbackBaseUrl,
    model: fallbackModel,
  };
  return { primary, fallback };
}

/** Resolve encrypted settings once for a Review execution. The returned
 * providers retain only the decrypted key in memory for that operation and
 * never query SQLite or process environment provider settings. */
export async function resolveModelProviderChain(
  repository: ModelConfigurationRepository,
  scope: ModelConfigurationScope,
  options: { fetchImpl?: typeof fetch; maxOutputTokens?: number; signal?: AbortSignal } = {},
): Promise<ResolvedModelProviderChain> {
  const rawRecord = await repository.getModelConfiguration(scope, options.signal);
  if (!rawRecord) throw new ModelConfigurationError('No static-analysis Model Provider is configured.', 'not_configured');
  const record = recordFromRow(rawRecord) ?? rawRecord;
  const settings = resolveSettings(record);
  const primaryProvider = new ConfiguredTextModelProvider({ settings: settings.primary, fetchImpl: options.fetchImpl, maxOutputTokens: options.maxOutputTokens });
  const fallbackProvider = settings.fallback
    ? new ConfiguredTextModelProvider({ settings: settings.fallback, fetchImpl: options.fetchImpl, maxOutputTokens: options.maxOutputTokens })
    : null;
  return {
    ...settings,
    primaryProvider,
    fallbackProvider,
    primaryMetadata: { provider: settings.primary.provider, apiFormat: settings.primary.apiFormat, model: settings.primary.model },
    fallbackMetadata: settings.fallback
      ? { provider: settings.fallback.provider, apiFormat: settings.fallback.apiFormat, model: settings.fallback.model }
      : null,
    configurationId: record.id ?? null,
  };
}

/** A lazy resolver suitable for ConfiguredTextModelProvider when a caller only
 * needs the primary settings. It still uses the request-scoped repository and
 * does not fall back to the legacy SQLite settings table. */
export function createSupabaseModelSettingResolver(
  repository: ModelConfigurationRepository,
  scope: ModelConfigurationScope,
): ModelSettingResolver {
  return async () => {
    const rawRecord = await repository.getModelConfiguration(scope);
    if (!rawRecord) return null;
    return resolveSettings(recordFromRow(rawRecord) ?? rawRecord).primary;
  };
}

function queryError(label: string, error: unknown): Error {
  const message = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error);
  return new Error(`Supabase ${label} failed: ${message}`);
}

/** Request-scoped repository for encrypted per-user/per-project settings.
 * Project configuration is preferred; the user's global configuration is used
 * only when no project row is visible through the same RLS client. */
export class SupabaseModelConfigurationRepository implements ModelConfigurationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getModelConfiguration(scope: ModelConfigurationScope, signal?: AbortSignal): Promise<ModelConfigurationRecord | null> {
    const purpose = scope.purpose ?? 'static_review';
    const baseQuery = () => this.client.from('model_configurations').select('*')
      .eq('owner_id', scope.ownerId).eq('purpose', purpose).eq('enabled', true);
    let projectQuery = scope.projectId
      ? baseQuery().eq('project_id', scope.projectId).order('updated_at', { ascending: false }).limit(1)
      : null;
    if (projectQuery && signal) projectQuery = projectQuery.abortSignal(signal);
    if (projectQuery) {
      const projectResult = await projectQuery.maybeSingle();
      if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
      if (projectResult.error) throw queryError('model configuration lookup', projectResult.error);
      const projectRecord = recordFromRow(projectResult.data);
      if (projectRecord) return projectRecord;
    }
    let globalQuery = baseQuery().is('project_id', null).order('updated_at', { ascending: false }).limit(1);
    if (signal) globalQuery = globalQuery.abortSignal(signal);
    const globalResult = await globalQuery.maybeSingle();
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    if (globalResult.error) throw queryError('global model configuration lookup', globalResult.error);
    return recordFromRow(globalResult.data);
  }
}

export function createSupabaseModelConfigurationRepository(accessToken: string): SupabaseModelConfigurationRepository {
  const client = createSupabaseClient(accessToken);
  if (!client) throw new Error('Supabase is not configured for model provider settings.');
  return new SupabaseModelConfigurationRepository(client);
}

export { recordFromRow as mapModelConfigurationRow };
