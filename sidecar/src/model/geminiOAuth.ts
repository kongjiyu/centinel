import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ModelProviderError } from '../review/retry.js';

export const GEMINI_OAUTH_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const isGeminiOAuthModelId = (value: string): boolean => /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value);
type Credentials = { client_id: string; client_secret: string; refresh_token: string };
let cached: { key: string; token: string; expiresAt: number } | undefined;

export function geminiOAuthProject(ownerId?: string): string | null {
  const project = process.env.CENTINEL_GEMINI_OAUTH_PROJECT?.trim();
  return ownerId && ownerId === process.env.CENTINEL_GEMINI_OAUTH_OWNER_ID?.trim()
    && process.env.CENTINEL_GEMINI_OAUTH_ADC_FILE?.trim() && project && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)
    ? project : null;
}

function unavailable() {
  return new ModelProviderError('Gemini OAuth requires a valid Google Cloud sign-in and quota project for this Centinel account.', {
    code: 'gemini_oauth_unavailable', retryable: false,
  });
}

export async function geminiOAuthHeaders(ownerId: string | undefined, project: string, signal?: AbortSignal): Promise<Record<string, string>> {
  if (geminiOAuthProject(ownerId) !== project) throw unavailable();
  let credentials: Credentials;
  try {
    const file = process.env.CENTINEL_GEMINI_OAUTH_ADC_FILE!.trim();
    const handle = await fs.open(file, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 65_536) throw unavailable();
      const parsed = JSON.parse(await handle.readFile('utf8'));
      if (parsed.type !== 'authorized_user' || (parsed.quota_project_id && parsed.quota_project_id !== project)
        || !['client_id', 'client_secret', 'refresh_token'].every(key => typeof parsed[key] === 'string' && parsed[key].trim())) throw unavailable();
      credentials = parsed;
    } finally { await handle.close(); }
  } catch { throw unavailable(); }

  const key = createHash('sha256').update(JSON.stringify([ownerId, project, credentials.client_id, credentials.client_secret, credentials.refresh_token])).digest('hex');
  let token = cached?.key === key && cached.expiresAt > Date.now() + 60_000 ? cached.token : null;
  if (!token) {
    try {
      const timeout = AbortSignal.timeout(12_000);
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: credentials.client_id,
          client_secret: credentials.client_secret, refresh_token: credentials.refresh_token }),
      });
      if (!response.ok) throw unavailable();
      const body = await response.json();
      if (typeof body.access_token !== 'string' || !body.access_token || !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw unavailable();
      token = body.access_token as string;
      cached = { key, token, expiresAt: Date.now() + Math.min(body.expires_in, 3600) * 1000 };
    } catch (error) {
      if (signal?.aborted) throw error;
      throw unavailable();
    }
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-goog-user-project': project };
}

export async function listGeminiOAuthModels(ownerId: string, project: string) {
  const headers = await geminiOAuthHeaders(ownerId, project);
  const models = new Map<string, { id: string; label: string }>();
  const seenTokens = new Set<string>();
  const params = new URLSearchParams({ pageSize: '1000' });
  const signal = AbortSignal.timeout(12_000);
  for (let page = 0; page < 10; page++) {
    const response = await fetch(`${GEMINI_OAUTH_BASE_URL}?${params}`, { headers, redirect: 'error', signal });
    if (!response.ok) throw unavailable();
    const body = await response.json();
    if (!body || (body.models !== undefined && !Array.isArray(body.models))) throw unavailable();
    for (const model of body.models ?? []) {
      if (typeof model?.name !== 'string' || !model.name.startsWith('models/')
        || !Array.isArray(model.supportedGenerationMethods) || !model.supportedGenerationMethods.includes('generateContent')) continue;
      const id = model.name.slice('models/'.length);
      if (isGeminiOAuthModelId(id) && !models.has(id)) models.set(id, {
        id, label: typeof model.displayName === 'string' && model.displayName.trim() ? model.displayName : id,
      });
    }
    if (!body.nextPageToken) return [...models.values()];
    if (typeof body.nextPageToken !== 'string' || seenTokens.has(body.nextPageToken)) throw unavailable();
    seenTokens.add(body.nextPageToken);
    params.set('pageToken', body.nextPageToken);
  }
  throw unavailable();
}
