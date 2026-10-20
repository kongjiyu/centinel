import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseClient, isBearerScopedPostgrestRead, isSupabaseJwtIssuedAtFuture } from '../../src/supabase.js';

const FUTURE_JWT = {
  code: 'PGRST303',
  message: 'JWT issued at future',
  details: null,
  hint: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Supabase future-issued JWT recovery', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('validates the signed user and retries only the bearer-scoped PostgREST read', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://supabase.example.test');
    vi.stubEnv('SUPABASE_ANON_KEY', 'public-anon-key');
    const requests: Array<{ path: string; method: string; authorization: string | null }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      requests.push({
        path: url.pathname,
        method: request.method,
        authorization: request.headers.get('authorization'),
      });

      if (url.pathname === '/auth/v1/user') {
        return jsonResponse({
          id: 'canonical-user',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'user@example.test',
          app_metadata: {},
          user_metadata: {},
          created_at: '2026-01-01T00:00:00.000Z',
        });
      }

      if (url.pathname === '/rest/v1/integrations' && requests.filter(item => item.path === url.pathname).length === 1) {
        return jsonResponse(FUTURE_JWT, 401);
      }

      return jsonResponse([{ id: 'integration-1' }]);
    });
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const client = createSupabaseClient('signed-session-token', { fetchImpl, sleep })!;

    const { data: user, error: authError } = await client.auth.getUser('signed-session-token');
    expect(authError).toBeNull();
    expect(user.user?.id).toBe('canonical-user');

    const { data, error } = await client.from('integrations').select('id');
    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'integration-1' }]);

    const postgrestRequests = requests.filter(item => item.path === '/rest/v1/integrations');
    expect(postgrestRequests).toHaveLength(2);
    expect(postgrestRequests.every(item => item.method === 'GET')).toBe(true);
    expect(postgrestRequests.every(item => item.authorization === 'Bearer signed-session-token')).toBe(true);
    expect(requests.filter(item => item.path === '/auth/v1/user')).toHaveLength(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('stops after three future-JWT read attempts and exposes the stable classification', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://supabase.example.test');
    vi.stubEnv('SUPABASE_ANON_KEY', 'public-anon-key');
    let readAttempts = 0;
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const onFutureJwtRetry = vi.fn();
    const client = createSupabaseClient('signed-session-token', {
      sleep,
      onFutureJwtRetry,
      fetchImpl: vi.fn(async () => {
        readAttempts += 1;
        return jsonResponse(FUTURE_JWT, 401);
      }),
    })!;

    const { error } = await client.from('integrations').select('id');

    expect(readAttempts).toBe(3);
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([1000, 3000]);
    expect(onFutureJwtRetry.mock.calls.map(([event]) => event)).toEqual([
      { service: 'Supabase PostgREST', operation: 'bearer-scoped read', attempt: 2, maxAttempts: 3, delayMs: 1000, errorCode: 'supabase_jwt_future' },
      { service: 'Supabase PostgREST', operation: 'bearer-scoped read', attempt: 3, maxAttempts: 3, delayMs: 3000, errorCode: 'supabase_jwt_future' },
    ]);
    expect(isSupabaseJwtIssuedAtFuture(error)).toBe(true);
    expect(isSupabaseJwtIssuedAtFuture({ code: 'PGRST303', message: 'JWT expired' })).toBe(false);
  });

  it('does not retry matching paths on a different origin', () => {
    const request = new Request('https://attacker.example/rest/v1/integrations', {
      method: 'GET',
      headers: { Authorization: 'Bearer signed-session-token' },
    });

    expect(isBearerScopedPostgrestRead(request, undefined, 'signed-session-token', 'https://supabase.example.test')).toBe(false);
    expect(isBearerScopedPostgrestRead(
      new Request('https://supabase.example.test/rest/v1/integrations', {
        method: 'GET',
        headers: { Authorization: 'Bearer signed-session-token' },
      }),
      undefined,
      'signed-session-token',
      'https://supabase.example.test',
    )).toBe(true);
  });

  it('cancels the retry wait when the PostgREST operation signal is aborted', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://supabase.example.test');
    vi.stubEnv('SUPABASE_ANON_KEY', 'public-anon-key');
    const controller = new AbortController();
    let readAttempts = 0;
    const client = createSupabaseClient('signed-session-token', {
      fetchImpl: vi.fn(async () => {
        readAttempts += 1;
        setTimeout(() => controller.abort(), 1);
        return jsonResponse(FUTURE_JWT, 401);
      }),
    })!;

    const result = await client.from('integrations').select('id').abortSignal(controller.signal);

    expect(result.error).not.toBeNull();
    expect(readAttempts).toBe(1);
  });

  it('does not retry writes or other PostgREST failures', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://supabase.example.test');
    vi.stubEnv('SUPABASE_ANON_KEY', 'public-anon-key');
    const fetchImpl = vi.fn(async () => jsonResponse(FUTURE_JWT, 401));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const client = createSupabaseClient('signed-session-token', { fetchImpl, sleep })!;

    const { error } = await client.from('integrations').insert({ provider: 'github' });

    expect(error?.code).toBe('PGRST303');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
