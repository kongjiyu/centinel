import crypto from 'node:crypto';
import { decryptSecret, encryptSecret } from './tokenVault.js';
import { requireSupabaseClient } from './supabase.js';
import {
  assertProviderConfigured,
  buildAuthorizeUrl,
  exchangeCode,
  fetchIdentity,
  redirectUri,
  SUPPORTED_PROVIDERS,
  type IntegrationProvider,
} from './integrations/oauthConfig.js';

export type Integration = {
  id: string;
  provider: IntegrationProvider;
  accountLabel: string;
  accountId: string;
  scopes: string;
  expiresAt: string | null;
  status: 'connected' | 'expired' | 'error';
  createdAt: string;
  updatedAt: string;
};

type PendingOAuth = { provider: IntegrationProvider; ownerId: string; accessToken: string; createdAt: number };
const pendingOAuth = new Map<string, PendingOAuth>();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function isProvider(value: string): value is IntegrationProvider {
  return (SUPPORTED_PROVIDERS as string[]).includes(value);
}

export function normalizeProvider(value: string): IntegrationProvider | null {
  return isProvider(value) ? value : null;
}

function cleanPending(): void {
  const cutoff = Date.now() - OAUTH_STATE_TTL_MS;
  for (const [state, value] of pendingOAuth) if (value.createdAt < cutoff) pendingOAuth.delete(state);
}

function mapSupabaseIntegration(row: Record<string, unknown>): Integration {
  const expiresAt = row.expires_at ? String(row.expires_at) : null;
  return {
    id: String(row.id),
    provider: String(row.provider) as IntegrationProvider,
    accountLabel: String(row.account_label ?? ''),
    accountId: String(row.account_id ?? ''),
    scopes: String(row.scopes ?? ''),
    expiresAt,
    status: expiresAt && Date.parse(expiresAt) <= Date.now() ? 'expired' : String(row.status ?? 'connected') as Integration['status'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function integrationClient(accessToken?: string | null) {
  const bearer = accessToken?.trim();
  if (!bearer) throw new Error('An authenticated Supabase bearer is required for integrations.');
  return requireSupabaseClient(bearer);
}

export async function listIntegrations(ownerId: string, accessToken?: string | null): Promise<Integration[]> {
  const client = integrationClient(accessToken);
  const { data, error } = await client.from('integrations').select('id, provider, account_label, account_id, scopes, expires_at, status, created_at, updated_at').eq('owner_id', ownerId).order('created_at', { ascending: false });
  if (error) throw new Error(`Supabase integrations query failed: ${error.message}`);
  return (data ?? []).map(row => mapSupabaseIntegration(row as Record<string, unknown>));
}

export async function getIntegration(provider: IntegrationProvider, ownerId: string, accessToken?: string | null): Promise<Integration | null> {
  return (await listIntegrations(ownerId, accessToken)).find(item => item.provider === provider) ?? null;
}

export async function deleteIntegration(provider: IntegrationProvider, ownerId: string, accessToken?: string | null): Promise<boolean> {
  const client = integrationClient(accessToken);
  const { error } = await client.from('integrations').delete().eq('provider', provider).eq('owner_id', ownerId);
  if (error) throw new Error(`Supabase integration removal failed: ${error.message}`);
  return true;
}

export function startIntegrationOAuth(provider: IntegrationProvider, ownerId: string, accessToken?: string | null): { authorizeUrl: string; state: string } {
  const bearer = accessToken?.trim();
  if (!bearer) throw new Error('An authenticated Supabase bearer is required for integrations.');
  integrationClient(bearer);
  assertProviderConfigured(provider);
  cleanPending();
  const state = crypto.randomBytes(24).toString('hex');
  pendingOAuth.set(state, { provider, ownerId, accessToken: bearer, createdAt: Date.now() });
  return { state, authorizeUrl: buildAuthorizeUrl(provider, state) };
}

export async function completeIntegrationOAuth(provider: IntegrationProvider, code: string, state: string): Promise<{ integration: Integration | null; html: string }> {
  cleanPending();
  const pending = pendingOAuth.get(state);
  pendingOAuth.delete(state);
  if (!pending || pending.provider !== provider) {
    return { integration: null, html: renderCallbackPage(provider, false, 'The connection request expired or was not started by Centinel.') };
  }

  try {
    const tokens = await exchangeCode(provider, code);
    const identity = await fetchIdentity(provider, tokens.accessToken);
    const now = new Date().toISOString();
    // Only encrypted credentials are stored; API responses expose metadata.
    const accessReference = encryptSecret(JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }));
    const supabase = integrationClient(pending.accessToken);
    const { error } = await supabase.from('integrations').upsert({
      owner_id: pending.ownerId,
      provider,
      token_reference: accessReference,
      expires_at: tokens.expiresAt,
      scopes: tokens.scopes,
      account_label: identity.accountLabel,
      account_id: identity.accountId,
      status: 'connected',
      updated_at: now,
    }, { onConflict: 'owner_id,provider' });
    if (error) throw new Error(`Supabase integration save failed: ${error.message}`);
    const integration = await getIntegration(provider, pending.ownerId, pending.accessToken);
    if (!integration) throw new Error('Connection was saved but could not be read back.');
    return { integration, html: renderCallbackPage(provider, true, `Connected as ${identity.accountLabel}.`) };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The provider connection failed.';
    return { integration: null, html: renderCallbackPage(provider, false, message) };
  }
}

/** Internal adapter hook. No caller should send this value to the renderer. */
export async function getIntegrationCredentials(provider: IntegrationProvider, ownerId: string, accessToken?: string | null): Promise<{ accessToken: string; refreshToken: string | null } | null> {
  const client = integrationClient(accessToken);
  const { data, error } = await client.from('integrations').select('token_reference').eq('provider', provider).eq('owner_id', ownerId).maybeSingle();
  if (error) throw new Error(`Supabase integration query failed: ${error.message}`);
  if (!data?.token_reference) return null;
  const parsed = JSON.parse(decryptSecret(String(data.token_reference))) as { accessToken?: string; refreshToken?: string | null };
  return parsed.accessToken ? { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken ?? null } : null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function providerLabel(provider: IntegrationProvider): string {
  return provider === 'google_drive' ? 'Google Drive' : provider === 'github' ? 'GitHub' : 'Slack';
}

export function renderCallbackPage(provider: IntegrationProvider, ok: boolean, message: string): string {
  const label = escapeHtml(providerLabel(provider));
  const copy = escapeHtml(message);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ok ? 'Connected' : 'Connection failed'} — ${label}</title><style>body{font:14px system-ui,sans-serif;background:#f4f7f4;color:#17231c;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}.card{background:#fff;border:1px solid #d8e2d8;border-radius:12px;padding:32px;max-width:460px;width:100%;text-align:center;box-sizing:border-box}h1{font-size:20px;margin:0 0 12px;color:${ok ? '#176b42' : '#a13b36'}}p{line-height:1.5}.actions{display:flex;justify-content:center;gap:10px;margin-top:22px;flex-wrap:wrap}.actions a,.actions button{font:inherit;padding:10px 18px;border-radius:8px;cursor:pointer;text-decoration:none}.actions a{background:#176b42;color:#fff;border:1px solid #176b42}.actions button{background:#fff;color:#17231c;border:1px solid #b9c9bd}</style></head><body><main class="card"><h1>${ok ? 'Connection complete' : 'Could not connect'} — ${label}</h1><p>${copy}</p><div class="actions">${ok ? '<a href="centinel://integrations/connected">Open Centinel</a>' : ''}<button type="button" onclick="window.close()">Close</button></div></main></body></html>`;
}

export { redirectUri };
