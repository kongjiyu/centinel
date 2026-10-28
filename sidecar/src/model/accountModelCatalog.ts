import type { CodexModel, ExternalChatgptTokens } from './codex.js';

export class AccountModelCatalogError extends Error {
  constructor(readonly diagnostic: 'http' | 'shape' | 'empty', readonly status?: number) {
    super(diagnostic === 'empty' ? 'No displayable account models are available.' : 'Account model catalog unavailable.');
  }
}

/** Current account choices, using only the already selected ChatGPT identity.
 * The fixed vendor URL, no redirects and bounded body keep credentials local
 * to their intended recipient. Never surface response bodies or tokens. */
export async function readAccountModelCatalog(
  tokens: ExternalChatgptTokens,
  nativeModels: CodexModel[],
  fetchImpl: typeof fetch = fetch,
): Promise<CodexModel[]> {
  const response = await fetchImpl('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Cache-Control': 'no-cache' },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new AccountModelCatalogError('http', response.status); }
  const reader = response.body?.getReader();
  if (!reader) throw Error('Account model catalog unavailable.');
  let body = '', size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) { body += decoder.decode(); break; }
      size += next.value.byteLength;
      if (size > 2 * 1024 * 1024) throw Error('Account model catalog exceeds its limit.');
      body += decoder.decode(next.value, {stream:true});
    }
  } finally { await reader.cancel().catch(()=>undefined); }
  let data: unknown;
  try { data = JSON.parse(body); } catch { throw Error('Account model catalog unavailable.'); }
  const raw = data && typeof data==='object' ? (data as {models?:unknown}).models : undefined;
  if (!Array.isArray(raw) || raw.length > 2000) throw new AccountModelCatalogError('shape');
  const seen = new Set<string>();
  const result: CodexModel[] = [];
  for (const item of raw) {
    if (!item || item.visibility!=='list' || typeof item.slug!=='string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(item.slug) || seen.has(item.slug)) continue;
    seen.add(item.slug);
    const native = nativeModels.find(model=>model.id===item.slug);
    const modalities: unknown = item.input_modalities ?? item.inputModalities ?? item.modalities?.input;
    const knownModalities = Array.isArray(modalities) && modalities.every(value=>typeof value==='string');
    const known = knownModalities || Boolean(native && native.imageSupportKnown!==false);
    result.push({ id:item.slug,
      label: typeof item.display_name==='string' && item.display_name.trim() ? item.display_name.trim().slice(0,200) : item.slug,
      supportsImages: knownModalities ? modalities.includes('image') : native?.supportsImages ?? false,
      isDefault: item.is_default===true || native?.isDefault===true,
      ...(!known ? {imageSupportKnown:false} : {}),
    });
  }
  if (!result.length) throw new AccountModelCatalogError('empty');
  return result;
}
