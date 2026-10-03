import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseClient } from '../../src/supabase.js';
import { completeIntegrationOAuth, deleteIntegration, getIntegrationCredentials, listIntegrations, startIntegrationOAuth } from '../../src/integrations.js';

vi.mock('../../src/supabase.js', () => ({ requireSupabaseClient: vi.fn() }));
vi.mock('../../src/tokenVault.js', () => ({ encryptSecret: vi.fn((value: string) => `encrypted:${value}`), decryptSecret: vi.fn() }));
vi.mock('../../src/integrations/oauthConfig.js', () => ({
  SUPPORTED_PROVIDERS: ['github', 'google_drive', 'slack'],
  assertProviderConfigured: vi.fn(),
  buildAuthorizeUrl: vi.fn(() => 'https://example.test/authorize'),
  exchangeCode: vi.fn(async () => ({ accessToken: 'github-token', refreshToken: null, expiresAt: null, scopes: 'repo read:user' })),
  fetchIdentity: vi.fn(async () => ({ accountId: 'github-user-id', accountLabel: '@github-user' })),
  redirectUri: vi.fn(),
}));

describe('integration credential authority', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires a user bearer rather than falling back to the local database', async () => {
    await expect(listIntegrations('owner-1')).rejects.toThrow('authenticated Supabase bearer');
    await expect(deleteIntegration('github', 'owner-1')).rejects.toThrow('authenticated Supabase bearer');
    await expect(getIntegrationCredentials('github', 'owner-1')).rejects.toThrow('authenticated Supabase bearer');
    expect(() => startIntegrationOAuth('github', 'owner-1')).toThrow('authenticated Supabase bearer');
    expect(requireSupabaseClient).not.toHaveBeenCalled();
  });

  it('reads and deletes only the owner-scoped Supabase integration row', async () => {
    const filters: Array<[string, unknown]> = [];
    const row = {
      id: 'integration-1', provider: 'github', account_label: '@owner', account_id: 'owner',
      scopes: 'repo', expires_at: null, status: 'connected',
      created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z',
    };
    const query = {
      select: () => query,
      delete: () => query,
      eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
      order: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [row], error: null })),
    };
    const from = vi.fn(() => query);
    vi.mocked(requireSupabaseClient).mockReturnValue({ from } as unknown as SupabaseClient);

    expect(await listIntegrations('owner-1', 'bearer-1')).toEqual([expect.objectContaining({ provider: 'github', accountLabel: '@owner' })]);
    expect(filters).toContainEqual(['owner_id', 'owner-1']);
    expect(await deleteIntegration('github', 'owner-1', 'bearer-1')).toBe(true);
    expect(filters).toContainEqual(['provider', 'github']);
    expect(from).toHaveBeenCalledWith('integrations');
    expect(requireSupabaseClient).toHaveBeenCalledWith('bearer-1');
  });

  it('reconnects without changing an integration ID referenced by project sources', async () => {
    const existing = {
      id: 'integration-1', owner_id: 'owner-1', provider: 'github', account_label: '@old-user', account_id: 'old-id',
      scopes: 'repo', token_reference: 'old-token', expires_at: null, status: 'connected',
      created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z',
    };
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [existing], error: null })),
      upsert: async (payload: Record<string, unknown>) => {
        if ('id' in payload && payload.id !== existing.id) {
          return { error: { message: 'update or delete on table "integrations" violates foreign key constraint "project_sources_integration_id_fkey"' } };
        }
        Object.assign(existing, payload);
        return { error: null };
      },
    };
    vi.mocked(requireSupabaseClient).mockReturnValue({ from: vi.fn(() => query) } as unknown as SupabaseClient);

    const { state } = startIntegrationOAuth('github', 'owner-1', 'bearer-1');
    const result = await completeIntegrationOAuth('github', 'oauth-code', state);

    expect(result.integration).toMatchObject({ id: 'integration-1', accountLabel: '@github-user', status: 'connected' });
    expect(existing.id).toBe('integration-1');
    expect(existing.created_at).toBe('2026-09-23T00:00:00Z');
  });
});
