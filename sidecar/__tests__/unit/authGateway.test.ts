import type { SupabaseClient, User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { AuthGateway, AuthGatewayError, ensureProfile, extractBearerToken } from '../../src/auth/index.js';

function user(id = 'user-canonical'): User {
  return { id, aud: 'authenticated', role: 'authenticated', email: 'user@example.test', app_metadata: {}, user_metadata: {}, created_at: new Date(0).toISOString() };
}

function clientFor(getUser: () => Promise<{ data: { user: User | null }; error: { message: string } | null }>): SupabaseClient {
  return { auth: { getUser } } as unknown as SupabaseClient;
}

describe('AuthGateway', () => {
  it('requires exactly one bearer token', () => {
    expect(() => extractBearerToken({})).toThrowError(AuthGatewayError);
    expect(() => extractBearerToken({ authorization: 'Basic abc' })).toThrowError(AuthGatewayError);
    expect(() => extractBearerToken({ authorization: 'Bearer a b' })).toThrowError(AuthGatewayError);
    expect(extractBearerToken({ authorization: 'bearer token-1' })).toBe('token-1');
  });

  it('derives canonical identity from the token and ignores spoofed identity headers', async () => {
    const getUser = vi.fn(async () => ({ data: { user: user() }, error: null }));
    const gateway = new AuthGateway({ clientFactory: token => {
      expect(token).toBe('signed-access-token');
      return clientFor(getUser);
    } });
    const context = await gateway.authenticate({ authorization: 'Bearer signed-access-token', 'x-centinel-user-id': 'attacker' });
    expect(context.userId).toBe('user-canonical');
    expect(context.suppliedUserId).toBe('attacker');
    expect(getUser).toHaveBeenCalledWith('signed-access-token');
  });

  it('returns a consistent 401 for expired or invalid sessions', async () => {
    const gateway = new AuthGateway({ clientFactory: () => clientFor(async () => ({ data: { user: null }, error: { message: 'JWT expired' } })) });
    await expect(gateway.authenticate({ authorization: 'Bearer expired' })).rejects.toMatchObject({ statusCode: 401, code: 'unauthenticated' });
  });

  it('returns 503 when Supabase is not configured', async () => {
    const gateway = new AuthGateway({ clientFactory: () => null });
    await expect(gateway.authenticate({ authorization: 'Bearer token' })).rejects.toMatchObject({ statusCode: 503, code: 'auth_unavailable' });
  });

  it('uses the RLS-scoped client for membership and does not accept missing projects', async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const client = { from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })) } as unknown as SupabaseClient;
    const gateway = new AuthGateway();
    await expect(gateway.requireProjectMember({ userId: 'u', accessToken: 't', client, user: user('u'), suppliedUserId: null }, 'project-1')).rejects.toMatchObject({ statusCode: 403, code: 'forbidden' });
  });
});

describe('ensureProfile', () => {
  it('is idempotent and returns the canonical profile', async () => {
    const profile = { id: 'user-canonical', display_name: 'User', avatar_url: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' };
    const upsert = vi.fn(async () => ({ error: null }));
    const single = vi.fn(async () => ({ data: profile, error: null }));
    const client = { from: vi.fn(() => ({ upsert, select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })) } as unknown as SupabaseClient;
    const result = await ensureProfile(client, { id: 'user-canonical', user_metadata: { full_name: 'User', avatar_url: 'https://example.test/avatar' } });
    expect(result.displayName).toBe('User');
    expect(upsert).toHaveBeenCalledWith({ id: 'user-canonical', display_name: 'User', avatar_url: 'https://example.test/avatar' }, { onConflict: 'id', ignoreDuplicates: true });
  });
});
