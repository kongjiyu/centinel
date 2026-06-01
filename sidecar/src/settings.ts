import { getDb, saveDb } from './db.js';

export type AiCompatibilityMode = 'openai' | 'anthropic';

export type AiProviderSetting = {
  id: 'text' | 'vision';
  label: string;
  compatibilityMode: AiCompatibilityMode;
  hasApiKey: boolean;
  apiKeyPreview: string;
  baseUrl: string;
  model: string;
  updatedAt: string;
};

export type UpdateAiProviderSettingRequest = {
  compatibilityMode: AiCompatibilityMode;
  apiKey: string;
  baseUrl: string;
  model: string;
};

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return '••••' + key.slice(-4);
}

function mapRow(row: unknown[]): AiProviderSetting {
  const apiKey = row[3] as string;
  return {
    id: row[0] as 'text' | 'vision',
    label: row[1] as string,
    compatibilityMode: row[2] as AiCompatibilityMode,
    hasApiKey: !!apiKey,
    apiKeyPreview: maskKey(apiKey),
    baseUrl: row[4] as string,
    model: row[5] as string,
    updatedAt: row[6] as string,
  };
}

export async function getAiSettings(): Promise<AiProviderSetting[]> {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, label, compatibility_mode, api_key, base_url, model, updated_at FROM ai_provider_settings ORDER BY id');
  const rows: AiProviderSetting[] = [];
  while (stmt.step()) {
    rows.push(mapRow(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}

export async function getAiSetting(id: string): Promise<AiProviderSetting | null> {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, label, compatibility_mode, api_key, base_url, model, updated_at FROM ai_provider_settings WHERE id = ?');
  stmt.bind([id]);
  let setting: AiProviderSetting | null = null;
  if (stmt.step()) {
    setting = mapRow(stmt.get() as unknown[]);
  }
  stmt.free();
  return setting;
}

export async function getRawAiSetting(id: string): Promise<{ apiKey: string; baseUrl: string; model: string; compatibilityMode: AiCompatibilityMode } | null> {
  const db = await getDb();
  const stmt = db.prepare('SELECT api_key, base_url, model, compatibility_mode FROM ai_provider_settings WHERE id = ?');
  stmt.bind([id]);
  let result: { apiKey: string; baseUrl: string; model: string; compatibilityMode: AiCompatibilityMode } | null = null;
  if (stmt.step()) {
    const row = stmt.get() as unknown[];
    result = {
      apiKey: row[0] as string,
      baseUrl: row[1] as string,
      model: row[2] as string,
      compatibilityMode: row[3] as AiCompatibilityMode,
    };
  }
  stmt.free();
  return result;
}

export async function updateAiSetting(id: string, req: UpdateAiProviderSettingRequest): Promise<AiProviderSetting> {
  const db = await getDb();
  const now = new Date().toISOString();
  db.run(
    'UPDATE ai_provider_settings SET compatibility_mode = ?, api_key = ?, base_url = ?, model = ?, updated_at = ? WHERE id = ?',
    [req.compatibilityMode, req.apiKey, req.baseUrl, req.model, now, id]
  );
  saveDb();
  const updated = await getAiSetting(id);
  return updated!;
}

export function validateUpdateRequest(body: Record<string, unknown>): { error: string } | null {
  const mode = body.compatibilityMode;
  if (mode !== 'openai' && mode !== 'anthropic') {
    return { error: 'compatibilityMode must be "openai" or "anthropic"' };
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
