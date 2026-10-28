import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listModelProviderSettings, mapModelProviderSetting, resolveSavedEmbeddingConfiguration, resolveSavedEmbeddingProvider, saveModelProviderSetting, validateModelProviderUpdate } from '../../src/modelSettings.js';
import { encryptSecret } from '../../src/tokenVault.js';
import { VOYAGE_EMBEDDING_BASE_URL } from '../../src/embeddingSettings.js';

function savedEmbeddingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'embedding-setting', owner_id: 'user-1', purpose: 'embedding', enabled: true,
    provider: 'custom', api_format: 'openai-compatible', model: 'custom-embedder',
    base_url: 'https://custom.example.test/v1', secret_ciphertext: encryptSecret('saved-key'),
    metadata: {}, ...overrides,
  };
}

function singleRowClient(row: Record<string, unknown> | null) {
  const query: any = {
    select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: vi.fn(() => query) } as unknown as SupabaseClient;
}

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

  it('keeps a new embedding form unconfigured and maps legacy custom rows to 1536 dimensions', () => {
    expect(mapModelProviderSetting('embedding', null)).not.toHaveProperty('embeddingProvider');
    expect(mapModelProviderSetting('embedding', {
      provider: 'custom', api_format: 'openai-compatible', model: 'old-embedder', base_url: 'https://old.example.test/v1',
      secret_ciphertext: 'ciphertext', metadata: {},
    })).toMatchObject({ embeddingProvider: 'custom', embeddingDimensions: 1536 });
  });

  it('resolves owner-scoped Voyage settings but rejects them from the legacy 1536 Review resolver', async () => {
    process.env.CENTINEL_TOKEN_ENCRYPTION_KEY = 'embedding-settings-test-key';
    try {
      const client = singleRowClient(savedEmbeddingRow({
        model: 'voyage-4-lite', base_url: VOYAGE_EMBEDDING_BASE_URL,
        metadata: { embeddingProvider: 'voyage', embeddingProtocol: 'voyage', embeddingDimensions: 1024 },
      }));
      const configuration = await resolveSavedEmbeddingConfiguration(client, 'user-1');
      expect(configuration).toMatchObject({
        apiKey: 'saved-key', baseUrl: VOYAGE_EMBEDDING_BASE_URL, model: 'voyage-4-lite',
        embeddingProvider: 'voyage', dimensions: 1024,
      });
      await expect(resolveSavedEmbeddingProvider(client, 'user-1')).rejects.toThrow(/existing Review index requires 1536-dimensional custom embeddings/);
      expect(JSON.stringify(configuration)).not.toContain('secret_ciphertext');
    } finally {
      delete process.env.CENTINEL_TOKEN_ENCRYPTION_KEY;
    }
  });

  it('resolves legacy custom 1536 settings and rejects unsupported dimensions or protocols', async () => {
    process.env.CENTINEL_TOKEN_ENCRYPTION_KEY = 'embedding-settings-test-key';
    try {
      const client = singleRowClient(savedEmbeddingRow());
      expect(await resolveSavedEmbeddingConfiguration(client, 'user-1')).toMatchObject({ embeddingProvider: 'custom', dimensions: 1536 });
      expect(await resolveSavedEmbeddingProvider(client, 'user-1')).toMatchObject({ baseUrl: 'https://custom.example.test/v1', model: 'custom-embedder' });
      await expect(resolveSavedEmbeddingConfiguration(singleRowClient(savedEmbeddingRow({ metadata: { embeddingProvider: 'custom', embeddingProtocol: 'openai-compatible', embeddingDimensions: 1024 } })), 'user-1'))
        .rejects.toThrow(/saved embedding dimensions are not supported/);
      await expect(resolveSavedEmbeddingConfiguration(singleRowClient(savedEmbeddingRow({ metadata: { embeddingProvider: 'voyage', embeddingProtocol: 'voyage', embeddingDimensions: 1024 } })), 'user-1'))
        .rejects.toThrow(/saved Voyage embedding model is not supported/);
    } finally {
      delete process.env.CENTINEL_TOKEN_ENCRYPTION_KEY;
    }
  });

  it('requires a fresh key when the embedding provider or endpoint changes', () => {
    const existing = { provider: 'custom', base_url: 'https://custom.example.test/v1', secret_ciphertext: 'opaque-saved-ciphertext', metadata: {} };
    const common = { provider: 'custom' as const, apiFormat: 'openai-compatible' as const, apiKey: '', model: 'embed-model', fallbackEnabled: false };
    expect(() => validateModelProviderUpdate({
      ...common, embeddingProvider: 'voyage', embeddingDimensions: 1024,
      baseUrl: VOYAGE_EMBEDDING_BASE_URL, model: 'voyage-4-lite',
    }, existing, 'embedding')).toThrow(/apiKey is required when changing the embedding provider or endpoint/);
    expect(() => validateModelProviderUpdate({
      ...common, embeddingProvider: 'custom', embeddingDimensions: 1536,
      baseUrl: 'https://different.example.test/v1',
    }, existing, 'embedding')).toThrow(/apiKey is required when changing the embedding provider or endpoint/);
  });

  it('persists Voyage protocol/dimensions in metadata while retaining the custom database row format', async () => {
    process.env.CENTINEL_TOKEN_ENCRYPTION_KEY = 'embedding-settings-test-key';
    try {
      let payload: any;
      const query: any = {
        select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query,
        maybeSingle: async () => ({ data: null, error: null }),
        insert: (value: any) => { payload = value; return query; },
        single: async () => ({ data: payload, error: null }),
      };
      const client = { from: () => query } as unknown as SupabaseClient;
      const view = await saveModelProviderSetting(client, 'user-1', 'embedding', {
        provider: 'custom', apiFormat: 'openai-compatible', apiKey: 'fresh-voyage-key',
        baseUrl: VOYAGE_EMBEDDING_BASE_URL, model: 'voyage-4-large', fallbackEnabled: false,
        embeddingProvider: 'voyage', embeddingDimensions: 1024,
      });
      expect(payload).toMatchObject({ provider: 'custom', api_format: 'openai-compatible', base_url: VOYAGE_EMBEDDING_BASE_URL, model: 'voyage-4-large' });
      expect(payload.metadata).toMatchObject({ embeddingProvider: 'voyage', embeddingProtocol: 'voyage', embeddingDimensions: 1024 });
      expect(view).toMatchObject({ embeddingProvider: 'voyage', embeddingDimensions: 1024, hasApiKey: true });
      expect(JSON.stringify(view)).not.toContain('fresh-voyage-key');
    } finally {
      delete process.env.CENTINEL_TOKEN_ENCRYPTION_KEY;
    }
  });
});
