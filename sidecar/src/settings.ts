import { getDb, saveDb } from './db.js';

export type AiProvider = 'mimo' | 'gemini' | 'custom';
export type AiApiFormat = 'openai-compatible' | 'anthropic-compatible' | 'google-native';

export type AiProviderSetting = {
  id: 'text' | 'vision';
  label: string;
  provider: AiProvider;
  apiFormat: AiApiFormat;
  hasApiKey: boolean;
  apiKeyPreview: string;
  baseUrl: string;
  model: string;
  updatedAt: string;
};

export type UpdateAiProviderSettingRequest = {
  provider: AiProvider;
  apiFormat: AiApiFormat;
  apiKey: string;
  baseUrl: string;
  model: string;
};

// Provider presets for easy configuration
export const PROVIDER_PRESETS: Record<string, { provider: AiProvider; apiFormat: AiApiFormat; baseUrl: string; model: string }> = {
  'mimo-openai': {
    provider: 'mimo',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
    model: 'mimo-v2.5',
  },
  'mimo-anthropic': {
    provider: 'mimo',
    apiFormat: 'anthropic-compatible',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages',
    model: 'mimo-v2.5',
  },
  'mimo-pro-openai': {
    provider: 'mimo',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
    model: 'mimo-v2.5-pro',
  },
  'mimo-pro-anthropic': {
    provider: 'mimo',
    apiFormat: 'anthropic-compatible',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages',
    model: 'mimo-v2.5-pro',
  },
  'gemini': {
    provider: 'gemini',
    apiFormat: 'google-native',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: 'gemini-2.5-flash',
  },
  'custom-openai': {
    provider: 'custom',
    apiFormat: 'openai-compatible',
    baseUrl: '',
    model: '',
  },
  'custom-anthropic': {
    provider: 'custom',
    apiFormat: 'anthropic-compatible',
    baseUrl: '',
    model: '',
  },
};

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return '••••' + key.slice(-4);
}

function mapRow(row: unknown[]): AiProviderSetting {
  const apiKey = row[4] as string;
  return {
    id: row[0] as 'text' | 'vision',
    label: row[1] as string,
    provider: (row[2] as AiProvider) || 'custom',
    apiFormat: (row[3] as AiApiFormat) || 'openai-compatible',
    hasApiKey: !!apiKey,
    apiKeyPreview: maskKey(apiKey),
    baseUrl: row[5] as string,
    model: row[6] as string,
    updatedAt: row[7] as string,
  };
}

export async function getAiSettings(): Promise<AiProviderSetting[]> {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, label, provider, api_format, api_key, base_url, model, updated_at FROM ai_provider_settings ORDER BY id');
  const rows: AiProviderSetting[] = [];
  while (stmt.step()) {
    rows.push(mapRow(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

export async function getAiSetting(id: string): Promise<AiProviderSetting | null> {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, label, provider, api_format, api_key, base_url, model, updated_at FROM ai_provider_settings WHERE id = ?');
  stmt.bind([id]);
  let setting: AiProviderSetting | null = null;
  if (stmt.step()) {
    setting = mapRow(stmt.get() as unknown[]);
  }
  stmt.free();
  return setting;
}

export async function getRawAiSetting(id: string): Promise<{ apiKey: string; baseUrl: string; model: string; provider: AiProvider; apiFormat: AiApiFormat } | null> {
  const db = await getDb();
  const stmt = db.prepare('SELECT api_key, base_url, model, provider, api_format FROM ai_provider_settings WHERE id = ?');
  stmt.bind([id]);
  let result: { apiKey: string; baseUrl: string; model: string; provider: AiProvider; apiFormat: AiApiFormat } | null = null;
  if (stmt.step()) {
    const row = stmt.get() as unknown[];
    result = {
      apiKey: row[0] as string,
      baseUrl: row[1] as string,
      model: row[2] as string,
      provider: (row[3] as AiProvider) || 'custom',
      apiFormat: (row[4] as AiApiFormat) || 'openai-compatible',
    };
  }
  stmt.free();
  return result;
}

export async function updateAiSetting(id: string, req: UpdateAiProviderSettingRequest): Promise<AiProviderSetting> {
  const db = await getDb();
  const now = new Date().toISOString();
  db.run(
    'UPDATE ai_provider_settings SET provider = ?, api_format = ?, api_key = ?, base_url = ?, model = ?, updated_at = ? WHERE id = ?',
    [req.provider, req.apiFormat, req.apiKey, req.baseUrl, req.model, now, id]
  );
  saveDb();
  const updated = await getAiSetting(id);
  return updated!;
}

export function validateUpdateRequest(body: Record<string, unknown>): { error: string } | null {
  const provider = body.provider;
  if (provider !== 'mimo' && provider !== 'gemini' && provider !== 'custom') {
    return { error: 'provider must be "mimo", "gemini", or "custom"' };
  }
  const apiFormat = body.apiFormat;
  if (apiFormat !== 'openai-compatible' && apiFormat !== 'anthropic-compatible' && apiFormat !== 'google-native') {
    return { error: 'apiFormat must be "openai-compatible", "anthropic-compatible", or "google-native"' };
  }
  const apiKey = body.apiKey;
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return { error: 'apiKey is required' };
  }
  const baseUrl = body.baseUrl;
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return { error: 'baseUrl is required' };
  }
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    return { error: 'baseUrl must start with http:// or https://' };
  }
  const model = body.model;
  if (typeof model !== 'string' || !model.trim()) {
    return { error: 'model is required' };
  }
  return null;
}

export function getPreset(presetId: string): { provider: AiProvider; apiFormat: AiApiFormat; baseUrl: string; model: string } | null {
  return PROVIDER_PRESETS[presetId] || null;
}
