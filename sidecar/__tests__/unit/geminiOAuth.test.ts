import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { geminiOAuthHeaders, listGeminiOAuthModels } from '../../src/model/geminiOAuth.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('binds Gemini OAuth to one owner and only contacts Google endpoints', async () => {
  const file = path.join(os.tmpdir(), `centinel-adc-${crypto.randomUUID()}.json`);
  await fs.writeFile(file, JSON.stringify({
    type: 'authorized_user', client_id: 'fixture-client', client_secret: 'fixture-secret',
    refresh_token: 'fixture-refresh', quota_project_id: 'fixture-project',
  }), { flag: 'wx' });
  vi.stubEnv('CENTINEL_GEMINI_OAUTH_OWNER_ID', 'fixture-owner');
  vi.stubEnv('CENTINEL_GEMINI_OAUTH_PROJECT', 'fixture-project');
  vi.stubEnv('CENTINEL_GEMINI_OAUTH_ADC_FILE', file);
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'fixture-access', expires_in: 300 }))
    .mockResolvedValueOnce(Response.json({ models: [
      { name: 'models/gemini-fixture', displayName: 'Gemini Fixture', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-embed', supportedGenerationMethods: ['embedContent'] },
    ], nextPageToken: 'next + page' }))
    .mockResolvedValueOnce(Response.json({ models: [
      { name: 'models/gemma-fixture', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-fixture', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/../unsafe', supportedGenerationMethods: ['generateContent'] },
    ] }));
  vi.stubGlobal('fetch', fetch);
  try {
    await expect(geminiOAuthHeaders('another-owner', 'fixture-project')).rejects.toMatchObject({ code: 'gemini_oauth_unavailable' });
    await expect(geminiOAuthHeaders('fixture-owner', 'another-project')).rejects.toMatchObject({ code: 'gemini_oauth_unavailable' });
    expect(fetch).not.toHaveBeenCalled();
    await expect(listGeminiOAuthModels('fixture-owner', 'fixture-project')).resolves.toEqual([
      { id: 'gemini-fixture', label: 'Gemini Fixture' }, { id: 'gemma-fixture', label: 'gemma-fixture' },
    ]);
    expect(fetch.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
    expect(fetch.mock.calls[1]).toEqual([
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({
        Authorization: 'Bearer fixture-access', 'x-goog-user-project': 'fixture-project',
      }) }),
    ]);
    const next = new URL(fetch.mock.calls[2][0]);
    expect(next.searchParams.get('pageSize')).toBe('1000');
    expect(next.searchParams.get('pageToken')).toBe('next + page');
  } finally { await fs.unlink(file); }
});
