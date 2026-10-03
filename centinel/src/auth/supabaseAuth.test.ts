import { afterEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUserIdentities: vi.fn(),
  linkIdentity: vi.fn(),
  unlinkIdentity: vi.fn(),
  signInWithOAuth: vi.fn(),
  setSession: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: authMocks })),
}));

describe('Supabase social authentication', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.resetModules();
  });

  it('starts identity-only GitHub sign-in through Supabase', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://centinel-test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    vi.stubEnv('VITE_SUPABASE_AUTH_REDIRECT_URL', 'centinel://auth/callback');
    authMocks.signInWithOAuth.mockResolvedValue({ error: null });

    const { startGithubSignIn } = await import('./supabaseAuth');
    await startGithubSignIn();

    expect(authMocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: { redirectTo: 'centinel://auth/callback' },
    });
    expect(JSON.stringify(authMocks.signInWithOAuth.mock.calls)).not.toContain('repo');
  });

  it('restores an implicit OAuth session delivered by the Centinel deep link', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://centinel-test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    const session = { access_token: 'access-token', user: { id: 'user-1' } };
    authMocks.setSession.mockResolvedValue({ data: { session }, error: null });

    const { completeDeepLinkSignIn } = await import('./supabaseAuth');
    await expect(completeDeepLinkSignIn('centinel://auth/callback#access_token=access-token&refresh_token=refresh-token'))
      .resolves.toEqual(session);

    expect(authMocks.setSession).toHaveBeenCalledWith({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });
  });

  it('rejects a callback from an unrecognised deep-link route', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://centinel-test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    const { completeDeepLinkSignIn } = await import('./supabaseAuth');

    await expect(completeDeepLinkSignIn('centinel://wrong/callback#access_token=access&refresh_token=refresh'))
      .rejects.toThrow('not a Centinel authentication callback');
  });

  it('starts explicit Google linking with identity-only scopes for the current session', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://centinel-test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    vi.stubEnv('VITE_SUPABASE_AUTH_REDIRECT_URL', 'centinel://auth/callback');
    authMocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
    authMocks.getUserIdentities.mockResolvedValue({ data: { identities: [{ identity_id: 'email-1', user_id: 'user-1', provider: 'email' }] }, error: null });
    authMocks.linkIdentity.mockResolvedValue({ data: { provider: 'google', url: 'https://accounts.google.com/authorize' }, error: null });

    const { linkIdentity } = await import('./supabaseAuth');
    await linkIdentity('google');

    expect(authMocks.linkIdentity).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'centinel://auth/callback', scopes: 'openid email profile' },
    });
    expect(JSON.stringify(authMocks.linkIdentity.mock.calls)).not.toContain('drive');
  });

  it('blocks a provider identity conflict without attempting a renderer-side merge', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://centinel-test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    authMocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
    authMocks.getUserIdentities.mockResolvedValue({ data: { identities: [{ identity_id: 'github-1', user_id: 'user-1', provider: 'github' }] }, error: null });

    const { linkIdentity } = await import('./supabaseAuth');
    await expect(linkIdentity('github')).rejects.toMatchObject({ code: 'already_linked' });
    expect(authMocks.linkIdentity).not.toHaveBeenCalled();
  });

  it('reports provider cancellation from the callback and preserves a visible result', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://centinel-test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    authMocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
    authMocks.getUserIdentities.mockResolvedValue({ data: { identities: [{ identity_id: 'email-1', user_id: 'user-1', provider: 'email' }] }, error: null });
    authMocks.linkIdentity.mockResolvedValue({ data: { provider: 'github', url: 'https://github.com/login/oauth/authorize' }, error: null });

    const { completeDeepLinkSignIn, consumeIdentityLinkResult, linkIdentity } = await import('./supabaseAuth');
    await linkIdentity('github');
    await expect(completeDeepLinkSignIn('centinel://auth/callback?error=access_denied&error_description=The%20user%20cancelled'))
      .rejects.toMatchObject({ code: 'cancelled' });
    expect(consumeIdentityLinkResult()).toMatchObject({ provider: 'github', status: 'cancelled' });
  });

  it('rejects linking when the signed-in account changed before the callback', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://centinel-test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    authMocks.getSession
      .mockResolvedValueOnce({ data: { session: { user: { id: 'user-1' } } }, error: null })
      .mockResolvedValueOnce({ data: { session: { user: { id: 'user-2' } } }, error: null });
    authMocks.getUserIdentities.mockResolvedValue({ data: { identities: [{ identity_id: 'email-1', user_id: 'user-1', provider: 'email' }] }, error: null });
    authMocks.linkIdentity.mockResolvedValue({ data: { provider: 'github', url: 'https://github.com/login/oauth/authorize' }, error: null });

    const { completeDeepLinkSignIn, consumeIdentityLinkResult, linkIdentity } = await import('./supabaseAuth');
    await linkIdentity('github');
    await expect(completeDeepLinkSignIn('centinel://auth/callback?code=callback-code'))
      .rejects.toMatchObject({ code: 'unauthenticated' });
    expect(authMocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(consumeIdentityLinkResult()).toMatchObject({ provider: 'github', status: 'error' });
  });

  it('restores the original account when a linking callback returns a different user', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://centinel-test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    const originalSession = { access_token: 'original-access', refresh_token: 'original-refresh', user: { id: 'user-1' } };
    const otherSession = { access_token: 'other-access', refresh_token: 'other-refresh', user: { id: 'user-2' } };
    authMocks.getSession.mockResolvedValue({ data: { session: originalSession }, error: null });
    authMocks.getUserIdentities.mockResolvedValue({ data: { identities: [{ identity_id: 'email-1', user_id: 'user-1', provider: 'email' }] }, error: null });
    authMocks.linkIdentity.mockResolvedValue({ data: { provider: 'google', url: 'https://accounts.google.com/authorize' }, error: null });
    authMocks.exchangeCodeForSession.mockResolvedValue({ data: { session: otherSession }, error: null });
    authMocks.setSession.mockResolvedValue({ data: { session: originalSession }, error: null });

    const { completeDeepLinkSignIn, consumeIdentityLinkResult, linkIdentity } = await import('./supabaseAuth');
    await linkIdentity('google');
    await expect(completeDeepLinkSignIn('centinel://auth/callback?code=callback-code'))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(authMocks.setSession).toHaveBeenCalledWith({ access_token: 'original-access', refresh_token: 'original-refresh' });
    expect(window.sessionStorage.getItem('centinel:supabase-access-token')).toBe('original-access');
    expect(consumeIdentityLinkResult()).toMatchObject({ provider: 'google', status: 'error' });
  });

  it('reports linking as complete only after Supabase confirms the provider identity on the same user', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://centinel-test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    const session = { access_token: 'access', refresh_token: 'refresh', user: { id: 'user-1' } };
    authMocks.getSession.mockResolvedValue({ data: { session }, error: null });
    authMocks.getUserIdentities
      .mockResolvedValueOnce({ data: { identities: [{ identity_id: 'email-1', user_id: 'user-1', provider: 'email' }] }, error: null })
      .mockResolvedValueOnce({ data: { identities: [{ identity_id: 'email-1', user_id: 'user-1', provider: 'email' }, { identity_id: 'github-1', user_id: 'user-1', provider: 'github' }] }, error: null });
    authMocks.linkIdentity.mockResolvedValue({ data: { provider: 'github', url: 'https://github.com/login/oauth/authorize' }, error: null });
    authMocks.exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });

    const { completeDeepLinkSignIn, consumeIdentityLinkResult, linkIdentity } = await import('./supabaseAuth');
    await linkIdentity('github');
    await expect(completeDeepLinkSignIn('centinel://auth/callback?code=callback-code')).resolves.toEqual(session);
    expect(consumeIdentityLinkResult()).toMatchObject({ provider: 'github', status: 'linked' });
  });

  it('does not claim a link when the provider identity is absent after the callback', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://centinel-test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    const session = { access_token: 'access', refresh_token: 'refresh', user: { id: 'user-1' } };
    authMocks.getSession.mockResolvedValue({ data: { session }, error: null });
    authMocks.getUserIdentities.mockResolvedValue({ data: { identities: [{ identity_id: 'email-1', user_id: 'user-1', provider: 'email' }] }, error: null });
    authMocks.linkIdentity.mockResolvedValue({ data: { provider: 'github', url: 'https://github.com/login/oauth/authorize' }, error: null });
    authMocks.exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });

    const { completeDeepLinkSignIn, consumeIdentityLinkResult, linkIdentity } = await import('./supabaseAuth');
    await linkIdentity('github');
    await expect(completeDeepLinkSignIn('centinel://auth/callback?code=callback-code'))
      .rejects.toMatchObject({ code: 'callback_error' });
    expect(consumeIdentityLinkResult()).toMatchObject({ provider: 'github', status: 'error' });
  });

  it('prevents unlinking the final usable identity', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://centinel-test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    authMocks.getUserIdentities.mockResolvedValue({ data: { identities: [{ identity_id: 'email-1', user_id: 'user-1', provider: 'email' }] }, error: null });

    const { unlinkIdentity } = await import('./supabaseAuth');
    await expect(unlinkIdentity({ identity_id: 'email-1', user_id: 'user-1', provider: 'email', id: 'email', identity_data: {} }))
      .rejects.toMatchObject({ code: 'final_identity' });
    expect(authMocks.unlinkIdentity).not.toHaveBeenCalled();
  });
});
