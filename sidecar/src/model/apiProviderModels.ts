import { resolveSavedProviderForTest, type ModelSettingsSource, type UpdateModelProviderSetting } from '../modelSettings.js';

export async function listApiProviderModels(client: ModelSettingsSource, ownerId: string, input: Partial<UpdateModelProviderSetting>) {
  const base = typeof input.baseUrl === 'string' ? input.baseUrl.trim().replace(/\/+$/, '') : '';
  const gemini = input.provider === 'gemini' && input.apiFormat === 'google-native'
    && base === 'https://generativelanguage.googleapis.com/v1beta/models';
  const claude = input.provider === 'custom' && input.apiFormat === 'anthropic-compatible'
    && base === 'https://api.anthropic.com/v1/messages';
  const mimo = input.provider === 'mimo' && (
    input.apiFormat === 'openai-compatible' && /^https:\/\/(?:api|token-plan-(?:cn|sgp|ams))\.xiaomimimo\.com\/v1(?:\/chat\/completions)?$/.test(base)
    || input.apiFormat === 'anthropic-compatible' && /^https:\/\/(?:api|token-plan-(?:cn|sgp|ams))\.xiaomimimo\.com\/anthropic$/.test(base));
  if (!gemini && !claude && !mimo) throw new Error('Model discovery is unavailable for this endpoint.');
  const { apiKey } = await resolveSavedProviderForTest(client, ownerId, 'text', {
    provider: input.provider, apiFormat: input.apiFormat, baseUrl: base,
    apiKey: typeof input.apiKey === 'string' ? input.apiKey : '', model: 'catalog',
  });
  if (mimo && base.startsWith('https://token-plan-') && apiKey.startsWith('sk-')) {
    throw new Error('Model discovery requires a Token Plan key for this endpoint. Select MiMo Pay-as-you-go to use a pay-as-you-go key.');
  }
  const url = new URL(gemini ? base : '/v1/models', base);
  const headers: Record<string, string> = gemini ? { 'x-goog-api-key': apiKey }
    : claude ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { 'api-key': apiKey };
  const models = new Map<string, { id: string; label: string }>();
  const signal = AbortSignal.timeout(15_000);
  for (let page = 0; page < 20; page++) {
    const response = await fetch(url, { headers: new Headers(headers), redirect: 'error', signal });
    if (!response.ok) {
      await response.body?.cancel();
      if (mimo && (response.status === 401 || response.status === 403)) {
        throw new Error(`The provider model catalog rejected the MiMo key (HTTP ${response.status}). Check that the key belongs to the configured Token Plan region or pay-as-you-go endpoint.`);
      }
      throw new Error('The provider model catalog returned HTTP ' + response.status + '.');
    }
    const data = await response.json();
    const rows = gemini ? data?.models : data?.data;
    if (!Array.isArray(rows)) throw new Error('The provider returned an invalid model catalog.');
    for (const row of rows) {
      if (gemini && (!Array.isArray(row?.supportedGenerationMethods) || !row.supportedGenerationMethods.includes('generateContent'))) continue;
      const id = gemini ? typeof row.name === 'string' && row.name.replace(/^models\//, '') : row?.id;
      if (typeof id !== 'string' || !/^[\w./:-]{1,200}$/.test(id)) continue;
      if (mimo && /(?:^|-)(?:tts|asr)(?:-|$)/i.test(id)) continue;
      const label = gemini ? row.displayName : row.display_name;
      models.set(id, { id, label: typeof label === 'string' && label.trim() ? label.slice(0, 200) : id });
    }
    const cursor = gemini ? data.nextPageToken : claude && data.has_more ? data.last_id : null;
    if (!cursor) return [...models.values()];
    const parameter = gemini ? 'pageToken' : 'after_id';
    if (typeof cursor !== 'string' || cursor === url.searchParams.get(parameter)) break;
    url.searchParams.set(parameter, cursor);
  }
  throw new Error('The provider model catalog could not be read completely.');
}
