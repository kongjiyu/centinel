import { describe, expect, it, vi } from 'vitest';
import { ConfiguredTextModelProvider } from '../../src/review/modelProvider.js';
import { ModelProviderError } from '../../src/review/retry.js';

const request = {
  reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis',
  systemPrompt: 'Return JSON', prompt: 'Inspect this artifact',
};

describe('ConfiguredTextModelProvider', () => {
  it('rejects construction without an authenticated configuration source', () => {
    expect(() => new ConfiguredTextModelProvider()).toThrow('authenticated Model Provider setting or resolver');
  });

  it('uses configured settings, parses OpenAI structured output, and returns usage', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ findings: [] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = new ConfiguredTextModelProvider({
      settings: {
        provider: 'mimo', apiFormat: 'openai-compatible', apiKey: 'secret',
        baseUrl: 'https://example.test/v1/chat/completions', model: 'mimo-v2.5',
      }, fetchImpl,
    });
    const result = await provider.analyze(request);
    expect(result.result).toEqual({ findings: [] });
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 4, totalTokens: 14 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/v1/chat/completions',
      expect.objectContaining({ method: 'POST', signal: undefined }),
    );
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.messages[0]).toEqual({ role: 'system', content: 'Return JSON' });
  });

  it('supports Anthropic-compatible base URL normalization and repair prompts', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: '```json\n{"findings":[]}\n```' }],
      usage: { input_tokens: 5, output_tokens: 2 },
    }), { status: 200 }));
    const provider = new ConfiguredTextModelProvider({
      settings: {
        provider: 'custom', apiFormat: 'anthropic-compatible', apiKey: 'secret',
        baseUrl: 'https://example.test/anthropic', model: 'custom-model',
      }, fetchImpl,
    });
    const result = await provider.analyze({ ...request, repair: true });
    expect(result.result).toEqual({ findings: [] });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://example.test/anthropic/v1/messages');
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.messages[0].content[0].text).toContain('Repair the previous response');
  });

  it('fails permanently for missing configuration and does not fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new ConfiguredTextModelProvider({
      settings: {
        provider: 'mimo', apiFormat: 'openai-compatible', apiKey: '',
        baseUrl: 'https://example.test', model: 'mimo',
      }, fetchImpl,
    });
    await expect(provider.analyze(request)).rejects.toMatchObject({ code: 'invalid_credentials', retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('classifies non-success responses with status and retry hints', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'slow down' }), {
      status: 429, headers: { 'retry-after': '2', 'content-type': 'application/json' },
    }));
    const provider = new ConfiguredTextModelProvider({
      settings: {
        provider: 'mimo', apiFormat: 'openai-compatible', apiKey: 'secret',
        baseUrl: 'https://example.test', model: 'mimo',
      }, fetchImpl,
    });
    await expect(provider.analyze(request)).rejects.toMatchObject({
      code: 'http_429', statusCode: 429, retryable: true, retryAfterMs: 2000,
    });
  });

  it('forwards the cancellation signal to fetch', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException('aborted', 'AbortError');
    });
    const provider = new ConfiguredTextModelProvider({
      settings: {
        provider: 'mimo', apiFormat: 'openai-compatible', apiKey: 'secret',
        baseUrl: 'https://example.test', model: 'mimo',
      }, fetchImpl,
    });
    controller.abort();
    await expect(provider.analyze({ ...request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
