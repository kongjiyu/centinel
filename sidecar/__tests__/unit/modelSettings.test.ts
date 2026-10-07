import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listModelProviderSettings, mapModelProviderSetting, resolveSavedEmbeddingProvider, saveModelProviderSetting, validateModelProviderUpdate } from '../../src/modelSettings.js';

describe('Supabase Model Provider settings', () => {
  it('accepts Codex without secrets for text and vision but excludes embeddings and mismatched formats', () => {
    const input = { provider: 'codex' as const, apiFormat: 'codex-app-server' as const, apiKey: '', baseUrl: '', model: 'account-model' };
    expect(() => validateModelProviderUpdate(input, null, 'text')).not.toThrow();
    expect(() => validateModelProviderUpdate(input, null, 'vision')).not.toThrow();
    expect(() => validateModelProviderUpdate(input, null, 'embedding')).toThrow();
    expect(() => validateModelProviderUpdate({ ...input, apiKey: 'secret' }, null)).toThrow(/local sign-in/);
    expect(() => validateModelProviderUpdate({ ...input, apiFormat: 'openai-compatible' }, null)).toThrow();
    expect(() => validateModelProviderUpdate({ ...input, fallbackEnabled: true, fallbackProvider: 'codex' }, null)).toThrow(/fallback/);
    expect(mapModelProviderSetting('text', { provider: 'codex', api_format: 'codex-app-server', model: 'account-model' })).toMatchObject({ provider: 'codex', hasApiKey: false });
  });

  it('removes API secrets and legacy fallback metadata when switching to Codex', async () => {
    let payload: any;
    const query: any = {
      select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: { id: 'saved', secret_ciphertext: 'encrypted-primary', metadata: { fallbackProvider: 'custom', fallbackSecretCiphertext: 'legacy-encrypted-key' } }, error: null }),
      update: (value: any) => { payload = value; return query; },
      single: async () => ({ data: payload, error: null }),
    };
    const client = { from: () => query } as unknown as SupabaseClient;
    const view = await saveModelProviderSetting(client, 'verified-user', 'text', { provider: 'codex', apiFormat: 'codex-app-server', apiKey: '', baseUrl: '', model: 'account-model', fallbackEnabled: false });
    expect(payload).toMatchObject({ owner_id: 'verified-user', secret_ciphertext: null, fallback_secret_ciphertext: null });
    expect(payload.metadata).not.toHaveProperty('fallbackSecretCiphertext');
    expect(view).toMatchObject({ provider: 'codex', hasApiKey: false, fallbackEnabled: false });
  });

  it('identifies the missing Phase 1 Supabase migration instead of a generic settings failure', async () => {
    const query: any = {
      select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.model_configurations' in the schema cache" } }),
    };
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;
    await expect(listModelProviderSettings(client, 'user-1')).rejects.toMatchObject({
      code: 'supabase_migration_required', statusCode: 503,
      message: expect.stringContaining('202609210001_phase1_static_foundation.sql'),
    });
  });
  it('maps encrypted primary and fallback configuration without exposing secrets', () => {
    const setting = mapModelProviderSetting('text', {
      provider: 'custom', api_format: 'openai-compatible', model: 'primary-model', base_url: 'https://primary.test/v1',
      secret_ciphertext: 'encrypted-primary', fallback_provider: 'custom', fallback_api_format: 'anthropic-compatible',
      fallback_model: 'fallback-model', fallback_base_url: 'https://fallback.test/v1', fallback_secret_ciphertext: 'encrypted-fallback',
      updated_at: '2026-09-23T00:00:00.000Z',
    });

    expect(setting).toMatchObject({
      id: 'text', provider: 'custom', apiFormat: 'openai-compatible', hasApiKey: true,
      fallbackEnabled: true, fallbackProvider: 'custom', fallbackApiFormat: 'anthropic-compatible', fallbackHasApiKey: true,
    });
    expect(JSON.stringify(setting)).not.toContain('encrypted-primary');
    expect(JSON.stringify(setting)).not.toContain('encrypted-fallback');
  });

  it('enforces complete fallback configuration while allowing preserved encrypted keys', () => {
    const input = {
      provider: 'custom' as const, apiFormat: 'openai-compatible' as const, apiKey: '',
      baseUrl: 'https://primary.test/v1', model: 'primary-model', fallbackEnabled: true,
      fallbackProvider: 'custom' as const, fallbackApiFormat: 'anthropic-compatible' as const,
      fallbackApiKey: '', fallbackBaseUrl: 'https://fallback.test/v1', fallbackModel: 'fallback-model',
    };
    expect(() => validateModelProviderUpdate(input, { secret_ciphertext: 'primary', fallback_secret_ciphertext: 'fallback' })).not.toThrow();
    expect(() => validateModelProviderUpdate({ ...input, fallbackModel: '' }, { secret_ciphertext: 'primary', fallback_secret_ciphertext: 'fallback' })).toThrow(/fallbackModel/);
  });

  it('requires an explicit custom OpenAI-compatible embedding provider without fallback', () => {
    const input = {
      provider: 'custom' as const, apiFormat: 'openai-compatible' as const,
      apiKey: 'secret', baseUrl: 'https://example.test/v1', model: 'embed-1536', fallbackEnabled: false,
    };
    expect(() => validateModelProviderUpdate(input, null, 'embedding')).not.toThrow();
    expect(() => validateModelProviderUpdate({ ...input, provider: 'mimo' }, null, 'embedding')).toThrow(/OpenAI-compatible/);
    expect(() => validateModelProviderUpdate({ ...input, apiFormat: 'google-native' }, null, 'embedding')).toThrow(/OpenAI-compatible/);
    expect(() => validateModelProviderUpdate({ ...input, fallbackEnabled: true }, null, 'embedding')).toThrow(/without fallback/);
    expect(mapModelProviderSetting('embedding', null)).toMatchObject({ id: 'embedding', label: 'Source indexing', hasApiKey: false });
  });

  it('passes cancellation into the embedding-configuration database query', async () => {
    const controller = new AbortController();
    let querySignal: AbortSignal | undefined;
    const query: any = {
      select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query,
      abortSignal: vi.fn((signal: AbortSignal) => { querySignal = signal; return query; }),
      maybeSingle: () => new Promise((_resolve, reject) => {
        querySignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    };
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;
    const pending = resolveSavedEmbeddingProvider(client, 'user-1', controller.signal);
    expect(query.abortSignal).toHaveBeenCalledWith(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
