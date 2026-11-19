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
    return { integration: null, html: renderCallbackPage(provider, false, 'The connection request expired or was not started by ORIN.') };
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
  const heading = ok ? `${label} connected` : `Could not connect to ${label}`;
  const statusPath = ok ? '<path d="m5 12 4 4L19 6"/>' : '<path d="M12 7v6m0 4h.01"/>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${heading} · ORIN</title>
  <style>
    :root {
      color-scheme: light dark;
      --canvas: #fbfaf7; --surface: #fff; --border: #e9e5de;
      --text: #1b1722; --muted: #6f6a78; --action: #1b1722; --on-action: #fff;
      --success: #15803d; --success-surface: #eaf7ed; --danger: #b8243c; --danger-surface: #fdecef;
      --glow-blue: #e1e9fc; --glow-peach: #fae5d7;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --canvas: #17141d; --surface: #211e28; --border: #3a3541;
        --text: #f7f4fa; --muted: #b9b2c2; --action: #f1eaf9; --on-action: #211e28;
        --success: #8de4a6; --success-surface: #253d30; --danger: #ff9caf; --danger-surface: #482934;
        --glow-blue: #252c46; --glow-peach: #412b33;
      }
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh; margin: 0; padding: 24px; display: grid; place-items: center;
      color: var(--text); font: 15px/1.55 system-ui, sans-serif;
      background: radial-gradient(ellipse at 14% 0%, var(--glow-blue), transparent 52%),
        radial-gradient(ellipse at 92% 100%, var(--glow-peach), transparent 48%), var(--canvas);
    }
    main {
      width: min(100%, 460px); padding: clamp(22px, 6vw, 36px);
      border: 1px solid var(--border); border-radius: 22px; background: var(--surface);
      box-shadow: 0 16px 48px rgb(22 18 28 / 9%);
    }
    .brand { display: flex; align-items: center; gap: 9px; font-weight: 700; }
    .status {
      display: inline-grid; place-items: center; width: 36px; height: 36px; margin-top: 25px;
      border-radius: 50%; background: var(--success-surface); color: var(--success);
    }
    .status.failure { background: var(--danger-surface); color: var(--danger); }
    h1 { font-size: clamp(21px, 5vw, 27px); line-height: 1.2; margin: 12px 0 8px; }
    p { margin: 0; color: var(--muted); overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
    .actions a, .actions button {
      display: inline-flex; align-items: center; min-height: 40px; padding: 7px 16px;
      border: 1px solid var(--border); border-radius: 999px; font: inherit; font-weight: 600;
      background: var(--surface); color: var(--text); cursor: pointer; text-decoration: none;
    }
    .actions a { background: var(--action); color: var(--on-action); border-color: var(--action); }
    .actions > :hover { filter: brightness(.92); }
    .actions > :focus-visible { outline: 2px solid #6085f8; outline-offset: 2px; }
  </style>
</head>
<body>
  <main>
    <div class="brand">
      <svg width="23" height="23" viewBox="0 0 64 64" aria-hidden="true">
        <path fill="currentColor" d="M2 33C2 16 17 1 34 2 30 12 27 28 2 33ZM62 31c0 17-15 32-33 31 4-10 9-27 33-31Z"/>
        <path fill="currentColor" opacity=".35" d="M33 5c14-1 28 12 29 26C48 29 36 20 33 5ZM2 33c13 2 26 10 29 25l-1 1C16 60 3 47 2 33Z"/>
      </svg>ORIN
    </div>
    <div class="status${ok ? '' : ' failure'}" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${statusPath}</svg>
    </div>
    <h1>${heading}</h1>
    <p>${copy}</p>
    <div class="actions">
      ${ok ? '<a href="centinel://integrations/connected">Open ORIN</a>' : ''}
      <button type="button" onclick="window.close()">Close</button>
    </div>
  </main>
</body>
</html>`;
}

export { redirectUri };
