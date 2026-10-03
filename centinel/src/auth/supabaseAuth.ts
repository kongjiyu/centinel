import { createClient, type Session, type SupabaseClient, type UserIdentity } from '@supabase/supabase-js';
import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

const accessTokenKey = 'centinel:supabase-access-token';
const userIdKey = 'centinel:supabase-user-id';
const authCallbackEvent = 'centinel://auth-callback';
const pendingIdentityLinkKey = 'centinel:pending-identity-link';
const identityLinkResultKey = 'centinel:identity-link-result';
export const identityLinkResultEvent = 'centinel:identity-link-result';

export type LinkableIdentityProvider = 'google' | 'github';
type PendingIdentityLink = { provider: LinkableIdentityProvider; userId: string };
export type IdentityLinkResult = {
  provider: LinkableIdentityProvider;
  status: 'linked' | 'cancelled' | 'error';
  message?: string;
};

export type IdentityLinkErrorCode =
  | 'not_configured'
  | 'unauthenticated'
  | 'already_linked'
  | 'conflict'
  | 'cancelled'
  | 'callback_error'
  | 'final_identity'
  | 'unknown';

export class IdentityLinkError extends Error {
  readonly code: IdentityLinkErrorCode;
  readonly provider?: LinkableIdentityProvider;

  constructor(message: string, code: IdentityLinkErrorCode, provider?: LinkableIdentityProvider) {
    super(message);
    this.name = 'IdentityLinkError';
    this.code = code;
    this.provider = provider;
  }
}

let client: SupabaseClient | null | undefined;

function readEnv(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  return typeof value === 'string' ? value.trim() : '';
}

function identityStorage(): Storage | null {
  if (typeof localStorage !== 'undefined') return localStorage;
  if (typeof sessionStorage !== 'undefined') return sessionStorage;
  return null;
}

function pendingIdentityLink(): PendingIdentityLink | null {
  const value = identityStorage()?.getItem(pendingIdentityLinkKey);
  if (!value) return null;
  try {
    const pending = JSON.parse(value) as Partial<PendingIdentityLink>;
    return (pending.provider === 'google' || pending.provider === 'github') && typeof pending.userId === 'string'
      ? { provider: pending.provider, userId: pending.userId } : null;
  } catch {
    // A pre-upgrade marker cannot prove which signed-in user started linking.
    return value === 'google' || value === 'github' ? { provider: value, userId: '' } : null;
  }
}

function setPendingIdentityLink(provider: LinkableIdentityProvider, userId: string): void {
  identityStorage()?.setItem(pendingIdentityLinkKey, JSON.stringify({ provider, userId } satisfies PendingIdentityLink));
}

function clearPendingIdentityLink(): PendingIdentityLink | null {
  const pending = pendingIdentityLink();
  identityStorage()?.removeItem(pendingIdentityLinkKey);
  return pending;
}

function publishIdentityLinkResult(result: IdentityLinkResult): void {
  const storage = identityStorage();
  storage?.setItem(identityLinkResultKey, JSON.stringify(result));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(identityLinkResultEvent, { detail: result }));
  }
}

export function consumeIdentityLinkResult(): IdentityLinkResult | null {
  const storage = identityStorage();
  const serialized = storage?.getItem(identityLinkResultKey) ?? null;
  if (serialized) storage?.removeItem(identityLinkResultKey);
  if (!serialized) return null;
  try {
    const parsed = JSON.parse(serialized) as Partial<IdentityLinkResult>;
    if ((parsed.provider !== 'google' && parsed.provider !== 'github') ||
      (parsed.status !== 'linked' && parsed.status !== 'cancelled' && parsed.status !== 'error')) return null;
    return {
      provider: parsed.provider,
      status: parsed.status,
      ...(typeof parsed.message === 'string' ? { message: parsed.message } : {}),
    };
  } catch {
    return null;
  }
}

export function cancelPendingIdentityLink(provider?: LinkableIdentityProvider): void {
  const current = pendingIdentityLink();
  if (!current || (provider && current.provider !== provider)) return;
  clearPendingIdentityLink();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return typeof error === 'string' ? error : '';
}

function normalizeIdentityLinkError(error: unknown, provider?: LinkableIdentityProvider): IdentityLinkError {
  if (error instanceof IdentityLinkError) return error;
  const raw = errorMessage(error).trim();
  const lower = raw.toLowerCase();
  if (/cancel|denied|closed|aborted|access_denied/.test(lower)) {
    return new IdentityLinkError('Linking was cancelled. No sign-in method was changed.', 'cancelled', provider);
  }
  if (/already.?linked|identity.?already|identity_already|duplicate|conflict|already exists|already registered/.test(lower)) {
    return new IdentityLinkError('This sign-in method could not be linked because the provider identity is already associated with another Centinel account. Nothing was changed; sign in to that account or use a different provider identity.', 'conflict', provider);
  }
  if (/manual.?link|linking.*disabled|disabled.*link/.test(lower)) {
    return new IdentityLinkError('Identity linking is not enabled for this Supabase project. Ask an administrator to enable manual linking, then try again.', 'callback_error', provider);
  }
  if (/session|jwt|not authenticated|unauthenticated|sign in/.test(lower)) {
    return new IdentityLinkError('Your Centinel session is no longer active. Sign in again before linking a sign-in method.', 'unauthenticated', provider);
  }
  return new IdentityLinkError(raw && raw.length <= 300 ? raw : 'The sign-in method could not be linked. No account identities were changed.', 'unknown', provider);
}

function identityRedirectUrl(): string | undefined {
  return readEnv('VITE_SUPABASE_AUTH_REDIRECT_URL') || (typeof window !== 'undefined' ? window.location.origin : undefined);
}

const identityScopes: Record<LinkableIdentityProvider, string> = {
  google: 'openid email profile',
  github: 'read:user user:email',
};

export function isSupabaseAuthConfigured(): boolean {
  return Boolean(readEnv('VITE_SUPABASE_URL') && readEnv('VITE_SUPABASE_ANON_KEY'));
}

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = readEnv('VITE_SUPABASE_URL');
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY');
  client = url && anonKey
    ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'centinel.supabase.auth',
      },
    })
    : null;
  return client;
}

export function cacheSession(session: Session | null): void {
  if (typeof sessionStorage === 'undefined') return;
  if (!session) {
    sessionStorage.removeItem(accessTokenKey);
    sessionStorage.removeItem(userIdKey);
    return;
  }
  sessionStorage.setItem(accessTokenKey, session.access_token);
  sessionStorage.setItem(userIdKey, session.user.id);
}

export async function restoreSupabaseSession(): Promise<Session | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  cacheSession(data.session);
  return data.session;
}

export async function signInWithPassword(email: string, password: string): Promise<Session> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error('Supabase Auth is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error('Supabase did not return an authenticated session.');
  cacheSession(data.session);
  return data.session;
}

async function startSocialSignIn(provider: 'google' | 'github'): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error('Supabase Auth is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  const redirectTo = readEnv('VITE_SUPABASE_AUTH_REDIRECT_URL') || (typeof window !== 'undefined' ? window.location.origin : undefined);
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });
  if (error) throw error;
}

export function startGoogleSignIn(): Promise<void> {
  return startSocialSignIn('google');
}

export function startGithubSignIn(): Promise<void> {
  return startSocialSignIn('github');
}

/** Return the identities Supabase currently links to the authenticated user. */
export async function getLinkedIdentities(): Promise<UserIdentity[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new IdentityLinkError('Supabase Auth is not configured for this workspace.', 'not_configured');
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error || !data) throw normalizeIdentityLinkError(error ?? new Error('Supabase did not return sign-in methods.'));
  return data.identities;
}

/**
 * Start an explicit Supabase identity-linking redirect from the current
 * authenticated session. This never compares emails or attempts a renderer
 * side merge; Supabase remains the authority for ownership and conflicts.
 */
export async function linkIdentity(provider: LinkableIdentityProvider): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new IdentityLinkError('Supabase Auth is not configured for this workspace.', 'not_configured', provider);

  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.error) throw normalizeIdentityLinkError(sessionResult.error, provider);
  if (!sessionResult.data.session?.user?.id) {
    throw new IdentityLinkError('Your Centinel session is no longer active. Sign in again before linking a sign-in method.', 'unauthenticated', provider);
  }

  const identities = await getLinkedIdentities();
  if (identities.some(identity => identity.provider === provider)) {
    throw new IdentityLinkError(`${provider === 'google' ? 'Google' : 'GitHub'} is already linked to this Centinel account.`, 'already_linked', provider);
  }

  setPendingIdentityLink(provider, sessionResult.data.session.user.id);
  try {
    const { data, error } = await supabase.auth.linkIdentity({
      provider,
      options: {
        redirectTo: identityRedirectUrl(),
        scopes: identityScopes[provider],
      },
    });
    if (error) throw normalizeIdentityLinkError(error, provider);
    if (!data?.url) throw new IdentityLinkError('The provider authorization page could not be opened. No sign-in method was changed.', 'callback_error', provider);
  } catch (error) {
    clearPendingIdentityLink();
    throw normalizeIdentityLinkError(error, provider);
  }
}

/** Remove an identity only when another usable sign-in method remains. */
export async function unlinkIdentity(identity: UserIdentity): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new IdentityLinkError('Supabase Auth is not configured for this workspace.', 'not_configured');
  const identities = await getLinkedIdentities();
  if (identities.length <= 1) {
    throw new IdentityLinkError('Keep at least one usable sign-in method on this account.', 'final_identity');
  }
  const current = identities.find(candidate => candidate.identity_id === identity.identity_id);
  if (!current) throw new IdentityLinkError('That sign-in method is no longer linked. Refresh the account page and try again.', 'unknown');
  const { error } = await supabase.auth.unlinkIdentity(current);
  if (error) throw normalizeIdentityLinkError(error);
}

/**
 * Accepts only the application's registered authentication callback URL and
 * establishes the Supabase session in this renderer. Supabase currently uses
 * a PKCE `code` callback, but the implicit token form is supported for
 * existing projects during the transition.
 */
export async function completeDeepLinkSignIn(callbackUrl: string): Promise<Session> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error('Supabase Auth is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');

  const callback = new URL(callbackUrl);
  if (callback.protocol !== 'centinel:' || callback.hostname !== 'auth' || callback.pathname !== '/callback') {
    throw new Error('This link is not a Centinel authentication callback.');
  }

  const callbackHash = new URLSearchParams(callback.hash.slice(1));
  const callbackError = callback.searchParams.get('error') || callbackHash.get('error');
  const callbackErrorCode = callback.searchParams.get('error_code') || callbackHash.get('error_code');
  const callbackErrorDescription = callback.searchParams.get('error_description') || callbackHash.get('error_description');
  if (callbackError || callbackErrorCode) {
    const pendingProvider = clearPendingIdentityLink()?.provider;
    const linkError = normalizeIdentityLinkError(
      new Error(`${callbackErrorCode || callbackError || 'callback_error'}${callbackErrorDescription ? `: ${callbackErrorDescription}` : ''}`),
      pendingProvider ?? undefined,
    );
    if (pendingProvider) {
      publishIdentityLinkResult({ provider: pendingProvider, status: linkError.code === 'cancelled' ? 'cancelled' : 'error', message: linkError.message });
    }
    throw linkError;
  }

  const pending = pendingIdentityLink();
  const priorSession = pending ? await supabase.auth.getSession() : null;
  if (pending && (!pending.userId || priorSession?.error || priorSession?.data.session?.user.id !== pending.userId)) {
    clearPendingIdentityLink();
    const error = new IdentityLinkError('Your signed-in account changed while linking. No identity was linked in Centinel; sign in to the intended account and try again.', 'unauthenticated', pending.provider);
    publishIdentityLinkResult({ provider: pending.provider, status: 'error', message: error.message });
    throw error;
  }

  const code = callback.searchParams.get('code');
  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.setSession({
      access_token: new URLSearchParams(callback.hash.slice(1)).get('access_token') ?? '',
      refresh_token: callbackHash.get('refresh_token') ?? '',
    });
  if (result.error || !result.data.session) {
    const pendingProvider = clearPendingIdentityLink()?.provider;
    const linkError = pendingProvider
      ? normalizeIdentityLinkError(result.error ?? new Error('The authentication callback did not contain a usable session.'), pendingProvider)
      : result.error ?? new Error('The authentication callback did not contain a usable session.');
    if (pendingProvider) {
      publishIdentityLinkResult({ provider: pendingProvider, status: linkError instanceof IdentityLinkError && linkError.code === 'cancelled' ? 'cancelled' : 'error', message: linkError instanceof Error ? linkError.message : undefined });
    }
    throw linkError;
  }
  if (pending && result.data.session.user.id !== pending.userId) {
    let restored = false;
    const previous = priorSession?.data.session;
    if (previous?.access_token && previous.refresh_token) {
      try {
        const restoration = await supabase.auth.setSession({ access_token: previous.access_token, refresh_token: previous.refresh_token });
        if (!restoration.error && restoration.data.session?.user.id === pending.userId) {
          cacheSession(restoration.data.session);
          restored = true;
        }
      } catch { /* The wrong account must not be retained even if restoration fails. */ }
    }
    if (!restored) {
      await supabase.auth.signOut().catch(() => undefined);
      cacheSession(null);
    }
    clearPendingIdentityLink();
    const error = new IdentityLinkError('The provider returned a different Centinel account. Linking was stopped; no accounts were merged.', 'conflict', pending.provider);
    publishIdentityLinkResult({ provider: pending.provider, status: 'error', message: error.message });
    throw error;
  }
  if (pending) {
    const identitiesResult = await supabase.auth.getUserIdentities().catch(() => null);
    if (!identitiesResult || identitiesResult.error || !identitiesResult.data?.identities?.some(identity =>
      identity.provider === pending.provider && identity.user_id === pending.userId)) {
      clearPendingIdentityLink();
      const error = new IdentityLinkError(
        'The provider callback finished, but Centinel could not confirm that the sign-in method is linked. Refresh your account methods before trying again.',
        'callback_error', pending.provider,
      );
      publishIdentityLinkResult({ provider: pending.provider, status: 'error', message: error.message });
      throw error;
    }
  }
  cacheSession(result.data.session);
  const pendingProvider = clearPendingIdentityLink()?.provider;
  if (pendingProvider) publishIdentityLinkResult({ provider: pendingProvider, status: 'linked' });
  return result.data.session;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_IPC__' in window;
}

/** Listen for a browser-to-desktop OAuth hand-off, including one received before the renderer loaded. */
export function subscribeToDeepLinkAuth(
  onSession: (session: Session) => void,
  onError: (error: unknown) => void,
): () => void {
  if (!isTauriRuntime()) return () => undefined;
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  const consume = (url: string) => {
    void completeDeepLinkSignIn(url).then(onSession).catch(onError);
  };

  void invoke<string | null>('take_auth_callback')
    .then(url => { if (!disposed && url) consume(url); })
    .catch(onError);
  void listen<string>(authCallbackEvent, event => {
    if (!disposed) consume(event.payload);
  }).then(handler => {
    if (disposed) handler();
    else unlisten = handler;
  }).catch(onError);

  return () => {
    disposed = true;
    unlisten?.();
  };
}

export async function signOutSupabase(): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  cacheSession(null);
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function subscribeToSupabaseAuth(callback: (session: Session | null) => void): () => void {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cacheSession(session);
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}
