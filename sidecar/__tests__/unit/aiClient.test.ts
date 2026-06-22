import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/settings.js', () => ({
  getRawAiSetting: vi.fn(),
}));

import { getRawAiSetting } from '../../src/settings';
import { testAiProvider } from '../../src/aiClient';

describe('testAiProvider', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns a hint when the upstream returns 404 with a non-standard baseUrl', async () => {
    vi.mocked(getRawAiSetting).mockResolvedValue({
      apiKey: 'sk-test',
      baseUrl: 'https://api.minimax.io/anthropic',
      model: 'MiniMax-M3',
      provider: 'mimo',
      apiFormat: 'openai-compatible',
    });

    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'Page not found',
    } as Response);

    const result = await testAiProvider('text');
    expect(result.status).toBe('fail');
    expect(result.message).toContain('HTTP 404');
    expect(result.hint).toMatch(/baseUrl|apiFormat|endpoint/i);
  });

  it('returns a hint for network failures (DNS, refused)', async () => {
    vi.mocked(getRawAiSetting).mockResolvedValue({
      apiKey: 'sk-test',
      baseUrl: 'https://does-not-exist.example.com',
      model: 'm',
      provider: 'mimo',
      apiFormat: 'openai-compatible',
    });

    fetchSpy.mockRejectedValueOnce(new Error('fetch failed'));

    const result = await testAiProvider('text');
    expect(result.status).toBe('fail');
    expect(result.hint).toMatch(/reach|sidecar|network|DNS/i);
  });
});
