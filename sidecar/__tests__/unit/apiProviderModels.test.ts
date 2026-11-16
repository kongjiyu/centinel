import { afterEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listApiProviderModels } from '../../src/model/apiProviderModels.js';

vi.mock('../../src/modelSettings.js', () => ({
  resolveSavedProviderForTest: vi.fn(async () => ({ apiKey: 'test-key' })),
}));
afterEach(() => vi.unstubAllGlobals());
const client = {} as SupabaseClient;

it('follows Gemini pagination and excludes embedding-only models', async () => {
  const send = vi.fn()
    .mockResolvedValueOnce(Response.json({ models: [{ name: 'models/embed', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'next' }))
    .mockResolvedValueOnce(Response.json({ models: [{ name: 'models/gemini-test', displayName: 'Gemini Test', supportedGenerationMethods: ['generateContent'] }] }));
  vi.stubGlobal('fetch', send);
  expect(await listApiProviderModels(client, 'owner', {
    provider: 'gemini', apiFormat: 'google-native', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
  })).toEqual([{ id: 'gemini-test', label: 'Gemini Test' }]);
  expect(String(send.mock.calls[1][0])).toContain('pageToken=next');
  expect(send.mock.calls[0][1].headers.get('x-goog-api-key')).toBe('test-key');
});

it('uses the MiMo regional catalog for the Anthropic-compatible preset', async () => {
  const send = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'mimo-test' }, { id: 'mimo-v2.5-tts' }] }));
  vi.stubGlobal('fetch', send);
  expect(await listApiProviderModels(client, 'owner', {
    provider: 'mimo', apiFormat: 'anthropic-compatible', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic',
  })).toEqual([{ id: 'mimo-test', label: 'mimo-test' }]);
  expect(String(send.mock.calls[0][0])).toBe('https://token-plan-sgp.xiaomimimo.com/v1/models');
  expect(send.mock.calls[0][1].headers.get('api-key')).toBe('test-key');
  expect(send.mock.calls[0][1].headers.has('authorization')).toBe(false);
  expect(send.mock.calls[0][1].redirect).toBe('error');
  await expect(listApiProviderModels(client, 'owner', {
    provider: 'mimo', apiFormat: 'anthropic-compatible', baseUrl: 'https://example.com/anthropic',
  })).rejects.toThrow('unavailable');
  expect(send).toHaveBeenCalledTimes(1);
});
