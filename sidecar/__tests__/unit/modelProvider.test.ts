import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfiguredTextModelProvider } from '../../src/review/modelProvider.js';
import { ModelProviderError } from '../../src/review/retry.js';

const request = {
  reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis',
  systemPrompt: 'Return JSON', prompt: 'Inspect this artifact',
};

describe('ConfiguredTextModelProvider', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('scopes a live evaluation to trusted project bindings while preserving the global hold', async () => {
    vi.stubEnv('CENTINEL_AI_ASSESSMENT_PROJECT_ALLOWLIST', 'project-1');
    vi.stubEnv('CENTINEL_AI_ASSESSMENT_PAUSED', '0');
    const resolveSettings = vi.fn(async () => null);
    const scoped = new ConfiguredTextModelProvider({ projectId: 'project-1', resolveSettings });
    await expect(scoped.analyze(request)).rejects.toMatchObject({ code: 'provider_not_configured' });
    expect(resolveSettings).toHaveBeenCalledOnce();
    resolveSettings.mockClear();
    // Input cannot impersonate an orchestration project, including unbound transports.
    for (const projectId of ['other-project', undefined]) {
      await expect(new ConfiguredTextModelProvider({ projectId, resolveSettings }).analyze(request)).rejects.toMatchObject({ code: 'assessment_paused' });
    }
    vi.stubEnv('CENTINEL_AI_ASSESSMENT_PAUSED', '1');
    await expect(scoped.analyze(request)).rejects.toMatchObject({ code: 'assessment_paused' });
    expect(resolveSettings).not.toHaveBeenCalled();
  });

  it.each(['codex-app-server', 'openai-compatible'] as const)('holds %s assessment before configuration or network access', async apiFormat => {
    vi.stubEnv('CENTINEL_AI_ASSESSMENT_PAUSED', '1');
    const resolveSettings = vi.fn(async () => ({ ownerId: 'test-user', provider: apiFormat === 'codex-app-server' ? 'codex' as const : 'custom' as const,
      apiFormat, apiKey: 'fixture-key', baseUrl: 'https://provider.example.test', model: 'fixture-model' }));
    const generate = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new ConfiguredTextModelProvider({ resolveSettings, fetchImpl, codexBackend: { generate } as any });
    await expect(provider.analyze(request)).rejects.toMatchObject({ code: 'assessment_paused', retryable: false });
    expect(resolveSettings).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('passes text, screenshots and cancellation through Codex without an API key', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '{"findings":[]}', model: 'codex-model', usage: { inputTokens: 5, outputTokens: 2 } });
    const controller = new AbortController();
    const settings = { ownerId: 'verified-user', provider: 'codex' as const, apiFormat: 'codex-app-server' as const, apiKey: '', baseUrl: '', model: 'codex-model' };
    const provider = new ConfiguredTextModelProvider({ settings, codexBackend: { generate } as any });
    const result = await provider.analyze({ ...request, imagePaths: ['/tmp/screenshot.png'], signal: controller.signal });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'codex-model', imagePaths: ['/tmp/screenshot.png'], signal: controller.signal }));
    expect(result.result).toEqual({ findings: [] });
    expect(result.settings.provider).toBe('codex');
    await expect(new ConfiguredTextModelProvider({ settings: { ...settings, ownerId: undefined }, codexBackend: { generate } as any }).analyze(request)).rejects.toMatchObject({ code: 'invalid_configuration' });
  });

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

  it('retains known provider usage when structured JSON parsing fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'this is not json' } }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    }), { status: 200 }));
    const provider = new ConfiguredTextModelProvider({
      settings: { provider: 'custom', apiFormat: 'openai-compatible', apiKey: 'secret',
        baseUrl: 'https://example.test/v1/chat/completions', model: 'fixture-model' },
      fetchImpl,
    });

    await expect(provider.analyze(request)).rejects.toMatchObject({
      code: 'malformed_response', usage: {
        inputTokens: 10, outputTokens: 4, totalTokens: 14, providerReportedTotalTokens: 14,
        totalTokensSource: 'provider_reported',
      },
    });
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
      code: 'rate_limited', statusCode: 429, retryable: false, retryAfterMs: 2000,
    });
  });

  it('retains only provider usage counters from an HTTP error response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'PRIVATE_PROMPT', usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
    }), { status: 503 }));
    const provider = new ConfiguredTextModelProvider({
      settings: { provider: 'custom', apiFormat: 'openai-compatible', apiKey: 'secret',
        baseUrl: 'https://example.test', model: 'fixture-model' }, fetchImpl,
    });

    await expect(provider.analyze(request)).rejects.toMatchObject({
      code: 'http_503', responseReceived: true,
      usage: { inputTokens: 10, outputTokens: 2, providerReportedTotalTokens: 12,
        usageObservation: { source: 'provider_error_response', completeness: 'partial', missingCounters: ['cacheReadTokens'] } },
    });
  });

  it('retains usage when a successful HTTP response has a malformed envelope', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: { malformed: true }, usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    }), { status: 200 }));
    const provider = new ConfiguredTextModelProvider({
      settings: { provider: 'custom', apiFormat: 'openai-compatible', apiKey: 'secret',
        baseUrl: 'https://example.test', model: 'fixture-model' }, fetchImpl,
    });

    await expect(provider.analyze(request)).rejects.toMatchObject({
      code: 'malformed_response', responseReceived: true,
      usage: { inputTokens: 10, outputTokens: 2, providerReportedTotalTokens: 12 },
    });
  });

  it('bounds stalled error-body reads and still applies the structured 429 pause', async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 429 }));
    const provider = new ConfiguredTextModelProvider({
      settings: { provider: 'custom', apiFormat: 'openai-compatible', apiKey: 'secret',
        baseUrl: 'https://example.test', model: 'fixture-model' }, fetchImpl,
    });
    const started = Date.now();

    await expect(provider.analyze(request)).rejects.toMatchObject({ code: 'rate_limited', responseReceived: true });
    expect(Date.now() - started).toBeLessThan(3_500);
    expect(cancelled).toHaveBeenCalled();
  });

  it('marks a fetch rejection as a no-response failure without inventing usage', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('private URL and prompt details'));
    const provider = new ConfiguredTextModelProvider({
      settings: { provider: 'custom', apiFormat: 'openai-compatible', apiKey: 'secret',
        baseUrl: 'https://example.test', model: 'fixture-model' }, fetchImpl,
    });

    await expect(provider.analyze(request)).rejects.toMatchObject({
      code: 'network_error', responseReceived: false,
    });
    await expect(provider.analyze(request)).rejects.toMatchObject({ usage: undefined });
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
