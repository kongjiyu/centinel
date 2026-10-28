import type { SupabaseClient, User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { AuthGateway } from '../../src/auth/gateway.js';
import { RefreshableSupabaseRuntime } from '../../src/runtime/supabaseRuntime.js';

const user = { id: 'owner', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' } as User;
const token = (iat: unknown, suffix = 'test', sub = user.id) => `test.${Buffer.from(JSON.stringify({ sub, iat })).toString('base64url')}.${suffix}`;
function client(allowed = true) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user: allowed ? user : null },
    error: allowed ? null : { message: 'invalid token' } })) } } as unknown as SupabaseClient;
}
async function authenticated(iat: unknown, suffix = 'test') {
  return new AuthGateway({ clientFactory: () => client() }).authenticate({ authorization: `Bearer ${token(iat, suffix)}` });
}
describe('verified same-owner session ordering', () => {
  it.each([99, 100, null, '101', -1, 1.5])('keeps in-flight work valid for older/equal/unknown issuance %s', async issuedAt => {
    const initial = await authenticated(100);
    const runtime = new RefreshableSupabaseRuntime(initial);
    let release!: () => void;
    const pending = runtime.withClient(async current => {
      await new Promise<void>(resolve => { release = resolve; });
      return current;
    });
    expect(runtime.adoptVerifiedSession(await authenticated(issuedAt, 'other-session'))).toBe(false);
    expect(runtime.state().generation).toBe(0);
    release();
    await expect(pending).resolves.toBe(initial.client);
  });
  it('adopts strictly newer verified credentials, retains stale-snapshot rejection and blocks replay', async () => {
    const initial = await authenticated(100);
    const runtime = new RefreshableSupabaseRuntime(initial);
    const snapshot = runtime.snapshot();
    let release!: () => void;
    const pending = runtime.withClient(async () => new Promise<void>(resolve => { release = resolve; }));
    const rejected = expect(pending).rejects.toThrow('refreshed');
    const newer = await authenticated(101);
    expect(runtime.adoptVerifiedSession(newer)).toBe(true);
    expect(runtime.client).toBe(newer.client);
    expect(runtime.adoptVerifiedSession(initial)).toBe(false);
    expect(runtime.state().generation).toBe(1);
    expect(() => runtime.assertCurrent(snapshot)).toThrow('refreshed');
    release();
    await rejected;
  });
  it('does not replace the same bearer merely because a new HTTP client was made', async () => {
    const initial = await authenticated(100);
    const runtime = new RefreshableSupabaseRuntime(initial);
    expect(runtime.adoptVerifiedSession(await authenticated(100))).toBe(false);
    expect(runtime.client).toBe(initial.client);
    expect(runtime.state().generation).toBe(0);
  });
  it('fails closed across owners, without replacing the client or generation', async () => {
    const initial = await authenticated(100);
    const runtime = new RefreshableSupabaseRuntime(initial);
    expect(() => runtime.adoptVerifiedSession({ ...initial, userId: 'other', accessToken: token(999) })).toThrow('different owner');
    expect(runtime.client).toBe(initial.client);
    expect(runtime.state().generation).toBe(0);
  });
  it('keeps opaque-token compatibility until a verified timestamp establishes the watermark', async () => {
    const initial = { userId: user.id, accessToken: 'opaque-initial', client: client() };
    const runtime = new RefreshableSupabaseRuntime(initial);
    expect(runtime.adoptVerifiedSession({ ...initial, accessToken: 'opaque-refreshed' })).toBe(true);
    expect(runtime.adoptVerifiedSession(await authenticated(100))).toBe(true);
    expect(runtime.adoptVerifiedSession(initial)).toBe(false);
  });
  it('extracts issuance only after exact-token authentication succeeds', async () => {
    const denied = client(false);
    const gateway = new AuthGateway({ clientFactory: () => denied });
    const bearer = token(999_999);
    await expect(gateway.authenticate({ authorization: `Bearer ${bearer}` })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(denied.auth.getUser).toHaveBeenCalledWith(bearer);
    expect((await authenticated(101)).verifiedIssuedAt).toBe(101);
  });
  it('does not take issuance from a mismatched JWT subject or malformed payload', async () => {
    const gateway = new AuthGateway({ clientFactory: () => client() });
    expect((await gateway.authenticate({ authorization: `Bearer ${token(999, 'test', 'other')}` })).verifiedIssuedAt).toBeNull();
    expect((await gateway.authenticate({ authorization: 'Bearer test.invalid-json.test' })).verifiedIssuedAt).toBeNull();
  });
});
