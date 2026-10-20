import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';

describe('sidecar authentication response handling', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('does not expire the local session for a Supabase time-validation error', async () => {
    const onExpired = vi.fn();
    window.addEventListener('centinel:auth-expired', onExpired);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Supabase rejected the session timestamp. Check the device date and time, then retry.',
      code: 'supabase_jwt_future',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })));

    await expect(api.projects()).rejects.toMatchObject({ status: 503, code: 'supabase_jwt_future' });
    expect(onExpired).not.toHaveBeenCalled();
    window.removeEventListener('centinel:auth-expired', onExpired);
  });

  it('expires the local session only for an explicit unauthenticated response', async () => {
    const onExpired = vi.fn();
    window.addEventListener('centinel:auth-expired', onExpired);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Your session is missing or expired. Sign in again.',
      code: 'unauthenticated',
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })));

    await expect(api.projects()).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
    expect(onExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener('centinel:auth-expired', onExpired);
  });
});
