import { getOAuthCallbackBaseUrl } from '../config.js';

export type IntegrationProvider = 'github' | 'google_drive' | 'slack';
export const SUPPORTED_PROVIDERS: IntegrationProvider[] = ['github', 'google_drive', 'slack'];

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string;
};

export type OAuthIdentity = { accountId: string; accountLabel: string };

async function providerFetch(provider: string, operation: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    // Keep the provider response useful without leaking authorization codes or tokens.
    console.warn(`[oauth] ${provider} ${operation} request failed`, error);
    throw new Error(`${provider} ${operation} could not reach the provider. Check your internet connection and try again.`);
  }
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function redirectUri(provider: IntegrationProvider): string {
  const path = provider === 'google_drive' ? 'google_drive' : provider;
  return `${getOAuthCallbackBaseUrl().replace(/\/$/, '')}/integrations/${path}/callback`;
}

function requireEnv(...names: string[]): string[] {
  const missing = names.filter(name => !env(name));
  if (missing.length > 0) throw new Error(`OAuth provider is not configured. Set: ${missing.join(', ')}`);
  return names.map(name => env(name)!);
}

export function assertProviderConfigured(provider: IntegrationProvider): void {
  if (provider === 'github') requireEnv('GITHUB_REPO_CLIENT_ID', 'GITHUB_REPO_CLIENT_SECRET');
  if (provider === 'google_drive') requireEnv('GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET');
  if (provider === 'slack') requireEnv('SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET');
}

export function buildAuthorizeUrl(provider: IntegrationProvider, state: string): string {
  assertProviderConfigured(provider);
  const redirect = redirectUri(provider);
  if (provider === 'github') {
    const [clientId] = requireEnv('GITHUB_REPO_CLIENT_ID', 'GITHUB_REPO_CLIENT_SECRET');
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, scope: 'repo read:user', state, allow_signup: 'false' });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }
  if (provider === 'google_drive') {
    const [clientId] = requireEnv('GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET');
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/drive.readonly', access_type: 'offline', prompt: 'consent', state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }
  const [clientId] = requireEnv('SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET');
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, scope: 'channels:history,channels:read,groups:history,groups:read,users:read,files:read', state });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function exchangeCode(provider: IntegrationProvider, code: string): Promise<OAuthTokens> {
  assertProviderConfigured(provider);
  const redirect = redirectUri(provider);
  if (provider === 'github') {
    const [clientId, clientSecret] = requireEnv('GITHUB_REPO_CLIENT_ID', 'GITHUB_REPO_CLIENT_SECRET');
    const response = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirect }) });
    if (!response.ok) throw new Error(`GitHub OAuth exchange failed (HTTP ${response.status}).`);
    const body = await response.json() as { access_token?: string; scope?: string; error?: string };
    if (!body.access_token) throw new Error(`GitHub OAuth exchange failed${body.error ? `: ${body.error}` : '.'}`);
    return { accessToken: body.access_token, refreshToken: null, expiresAt: null, scopes: body.scope ?? 'repo read:user' };
  }
  if (provider === 'google_drive') {
    const [clientId, clientSecret] = requireEnv('GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET');
    const response = await providerFetch('Google Drive', 'token exchange', 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirect }).toString() });
    if (!response.ok) throw new Error(`Google OAuth exchange failed (HTTP ${response.status}).`);
    const body = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
    if (!body.access_token) throw new Error(`Google OAuth exchange failed${body.error ? `: ${body.error}` : '.'}`);
    return { accessToken: body.access_token, refreshToken: body.refresh_token ?? null, expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null, scopes: body.scope ?? 'https://www.googleapis.com/auth/drive.readonly' };
  }
  const [clientId, clientSecret] = requireEnv('SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET');
  const response = await fetch('https://slack.com/api/oauth.v2.access', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirect }).toString() });
  if (!response.ok) throw new Error(`Slack OAuth exchange failed (HTTP ${response.status}).`);
  const body = await response.json() as { ok?: boolean; access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!body.ok || !body.access_token) throw new Error(`Slack OAuth exchange failed${body.error ? `: ${body.error}` : '.'}`);
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? null, expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null, scopes: body.scope ?? '' };
}

export async function fetchIdentity(provider: IntegrationProvider, accessToken: string): Promise<OAuthIdentity> {
  if (provider === 'github') {
    const response = await fetch('https://api.github.com/user', { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Centinel' } });
    if (!response.ok) throw new Error('GitHub identity lookup failed.');
    const body = await response.json() as { id?: number; login?: string; name?: string };
    return { accountId: body.id ? String(body.id) : body.login ?? 'github-user', accountLabel: body.login ? `@${body.login}` : body.name ?? 'GitHub user' };
  }
  if (provider === 'google_drive') {
    const response = await providerFetch('Google Drive', 'identity lookup', 'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error('Google Drive identity lookup failed.');
    const body = await response.json() as { user?: { permissionId?: string; displayName?: string; emailAddress?: string } };
    return { accountId: body.user?.permissionId ?? body.user?.emailAddress ?? 'google-drive-user', accountLabel: body.user?.displayName ?? body.user?.emailAddress ?? 'Google Drive user' };
  }
  const response = await fetch('https://slack.com/api/auth.test', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error('Slack identity lookup failed.');
  const body = await response.json() as { ok?: boolean; team_id?: string; team?: string; error?: string };
  if (!body.ok) throw new Error('Slack identity lookup failed.');
  return { accountId: body.team_id ?? 'slack-workspace', accountLabel: body.team ?? 'Slack workspace' };
}
