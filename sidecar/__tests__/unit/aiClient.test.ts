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

  it('sends x-api-key (not api-key) for anthropic-compatible providers', async () => {
    vi.mocked(getRawAiSetting).mockResolvedValue({
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.minimax.io/anthropic/v1/messages',
      model: 'MiniMax-M2.7',
      provider: 'mimo',
      apiFormat: 'anthropic-compatible',
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ content: [{ type: 'text', text: '{"status":"ok"}' }] }),
    } as Response);

    const result = await testAiProvider('text');
    expect(result.status).toBe('pass');

    // Verify the sidecar sent the right header name
    const call = fetchSpy.mock.calls[0];
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['api-key']).toBeUndefined();
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('surfaces MiniMax-style X-Api-Key hint on 401', async () => {
    vi.mocked(getRawAiSetting).mockResolvedValue({
      apiKey: 'bad-key',
      baseUrl: 'https://api.minimax.io/anthropic/v1/messages',
      model: 'MiniMax-M2.7',
      provider: 'mimo',
      apiFormat: 'anthropic-compatible',
    });

    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () =>
        '{"type":"error","error":{"type":"authentication_error","message":"login fail: Please carry the API secret key in the X-Api-Key field of the request header"}}',
    } as Response);

    const result = await testAiProvider('text');
    expect(result.status).toBe('fail');
    expect(result.hint).toMatch(/X-Api-Key/i);
  });

  it('uses form-state overrides (URL, model, key) instead of saved values', async () => {
    // Saved setting has a wrong URL (no /v1/messages) and a wrong key.
    vi.mocked(getRawAiSetting).mockResolvedValue({
      apiKey: 'saved-key',
      baseUrl: 'https://api.minimax.io/anthropic',
      model: 'saved-model',
      provider: 'mimo',
      apiFormat: 'openai-compatible',
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ content: [{ type: 'text', text: '{"status":"ok"}' }] }),
    } as Response);

    // User typed a new URL/model/key and clicked Test without saving first.
    const result = await testAiProvider('text', undefined, {
      provider: 'mimo',
      apiFormat: 'anthropic-compatible',
      apiKey: 'form-typed-key',
      baseUrl: 'https://api.minimax.io/anthropic/v1/messages',
      model: 'MiniMax-M2.7',
    });
    expect(result.status).toBe('pass');

    // Verify the request used the override URL, NOT the saved one.
    const call = fetchSpy.mock.calls[0];
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://api.minimax.io/anthropic/v1/messages');
    expect(headers['x-api-key']).toBe('form-typed-key');
    expect(headers['api-key']).toBeUndefined();
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('falls back to saved values when override fields are empty/undefined', async () => {
    vi.mocked(getRawAiSetting).mockResolvedValue({
      apiKey: 'saved-key',
      baseUrl: 'https://api.minimax.io/anthropic/v1/messages',
      model: 'MiniMax-M2.7',
      provider: 'mimo',
      apiFormat: 'anthropic-compatible',
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ content: [{ type: 'text', text: '{"status":"ok"}' }] }),
    } as Response);

    // Empty apiKey override (user didn't retype) must use the saved key,
    // not be treated as an empty/missing key.
    const result = await testAiProvider('text', undefined, {
      apiKey: '',
      baseUrl: '',
    });
    expect(result.status).toBe('pass');

    const call = fetchSpy.mock.calls[0];
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://api.minimax.io/anthropic/v1/messages');
    expect(headers['x-api-key']).toBe('saved-key');
  });

  it('appends /v1/messages to a base URL for anthropic-compatible', async () => {
    vi.mocked(getRawAiSetting).mockResolvedValue({
      apiKey: 'sk-test',
      baseUrl: 'https://api.minimax.io/anthropic',  // base URL, no /v1/messages
      model: 'MiniMax-M2.7',
      provider: 'mimo',
      apiFormat: 'anthropic-compatible',
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ content: [{ type: 'text', text: '{"status":"ok"}' }] }),
    } as Response);

    const result = await testAiProvider('text');
    expect(result.status).toBe('pass');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe('https://api.minimax.io/anthropic/v1/messages');
  });

  it('strips a trailing slash before appending /v1/messages', async () => {
    vi.mocked(getRawAiSetting).mockResolvedValue({
      apiKey: 'sk-test',
      baseUrl: 'https://api.minimax.io/anthropic/',
      model: 'MiniMax-M2.7',
      provider: 'mimo',
      apiFormat: 'anthropic-compatible',
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ content: [{ type: 'text', text: '{"status":"ok"}' }] }),
    } as Response);

    const result = await testAiProvider('text');
    expect(result.status).toBe('pass');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe('https://api.minimax.io/anthropic/v1/messages');
  });

  it('leaves a full URL with /v1/messages alone (backward compat)', async () => {
    vi.mocked(getRawAiSetting).mockResolvedValue({
      apiKey: 'sk-test',
      baseUrl: 'https://api.minimax.io/anthropic/v1/messages',
      model: 'MiniMax-M2.7',
      provider: 'mimo',
      apiFormat: 'anthropic-compatible',
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ content: [{ type: 'text', text: '{"status":"ok"}' }] }),
    } as Response);

    const result = await testAiProvider('text');
    expect(result.status).toBe('pass');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe('https://api.minimax.io/anthropic/v1/messages');
  });
});
