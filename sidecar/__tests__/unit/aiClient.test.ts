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

import {
  parseAnthropicToolTurn,
  parseOpenAIToolTurn,
  parseGoogleToolTurn,
  callAiWithTools,
  appendToolResults,
} from '../../src/aiClient';

describe('parseAnthropicToolTurn', () => {
  it('extracts text, tool_use blocks, and stop_reason', () => {
    const turn = parseAnthropicToolTurn({
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'I need to inspect auth.ts' },
        { type: 'tool_use', id: 'tu_1', name: 'fetch_file', input: { path: 'src/auth.ts' } },
      ],
    });
    expect(turn.content).toBe('I need to inspect auth.ts');
    expect(turn.toolCalls).toEqual([
      { id: 'tu_1', name: 'fetch_file', input: { path: 'src/auth.ts' } },
    ]);
    expect(turn.stopReason).toBe('tool_use');
  });

  it('returns end_turn when there are no tool_use blocks', () => {
    const turn = parseAnthropicToolTurn({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'all done' }],
    });
    expect(turn.stopReason).toBe('end_turn');
    expect(turn.toolCalls).toEqual([]);
  });

  it('handles empty content array', () => {
    const turn = parseAnthropicToolTurn({ stop_reason: 'end_turn', content: [] });
    expect(turn.content).toBeNull();
    expect(turn.stopReason).toBe('end_turn');
  });
});

describe('parseOpenAIToolTurn', () => {
  it('extracts tool_calls from the first choice message', () => {
    const turn = parseOpenAIToolTurn({
      choices: [{
        message: {
          content: null,
          tool_calls: [
            { id: 'call_1', function: { name: 'fetch_file', arguments: '{"path":"a.ts"}' } },
          ],
        },
      }],
    });
    expect(turn.toolCalls).toEqual([
      { id: 'call_1', name: 'fetch_file', input: { path: 'a.ts' } },
    ]);
    expect(turn.stopReason).toBe('tool_use');
  });

  it('parses content when no tool_calls', () => {
    const turn = parseOpenAIToolTurn({
      choices: [{ message: { content: 'hello' } }],
    });
    expect(turn.content).toBe('hello');
    expect(turn.stopReason).toBe('end_turn');
  });

  it('handles malformed tool_call arguments gracefully (defaults to {})', () => {
    const turn = parseOpenAIToolTurn({
      choices: [{
        message: {
          tool_calls: [{ id: 'c1', function: { name: 'fetch_file', arguments: 'not-json' } }],
        },
      }],
    });
    expect(turn.toolCalls[0].input).toEqual({});
  });
});

describe('parseGoogleToolTurn', () => {
  it('extracts functionCall parts and synthesizes IDs', () => {
    const turn = parseGoogleToolTurn({
      candidates: [{
        content: {
          parts: [
            { text: 'inspecting' },
            { functionCall: { name: 'fetch_file', args: { path: 'b.ts' } } },
          ],
        },
      }],
    });
    expect(turn.content).toBe('inspecting');
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].name).toBe('fetch_file');
    expect(turn.toolCalls[0].input).toEqual({ path: 'b.ts' });
    expect(turn.toolCalls[0].id).toMatch(/^google-/);
  });

  it('returns end_turn when there are no functionCall parts', () => {
    const turn = parseGoogleToolTurn({
      candidates: [{ content: { parts: [{ text: 'done' }] } }],
    });
    expect(turn.stopReason).toBe('end_turn');
    expect(turn.content).toBe('done');
  });
});

describe('callAiWithTools', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Per-test isolation: each test sets up its own fetch queue explicitly.
    // We still create the spy once and re-use it, but we mockReset + re-stub
    // so no state bleeds from previous tests.
    if (!fetchSpy) {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    }
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    // Prevent defaultToolExecutor from throwing in tests that don't install one.
    // Task 5 will install the real executor via setToolExecutor.
    (globalThis as any).__centinelToolExecutor = vi.fn().mockResolvedValue({
      toolCallId: 't1',
      name: 'fetch_file',
      content: '{}',
    });
  });

  afterEach(() => {
    fetchSpy.mockClear();
    delete (globalThis as any).__centinelToolExecutor;
  });

  afterAll(() => {
    fetchSpy.mockRestore();
  });

  it('returns end_turn after one tool call → result cycle (Anthropic)', async () => {
    // Round 1: model requests fetch_file
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'looking at auth' },
          { type: 'tool_use', id: 't1', name: 'fetch_file', input: { path: 'a.ts' } },
        ],
      }),
    } as Response);
    // Round 2: model returns end_turn
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'reviewed' }],
      }),
    } as Response);

    const turn = await callAiWithTools({
      apiKey: 'test-key',
      apiFormat: 'anthropic-compatible',
      model: 'm',
      baseUrl: 'https://example.test/v1/messages',
      provider: 'mimo',
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'review a.ts' }] }],
      tools: [{ name: 'fetch_file', description: 'd', input_schema: { type: 'object', properties: {} } }],
    });

    expect(turn.stopReason).toBe('end_turn');
    expect(turn.content).toBe('reviewed');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('passes apiKey to x-api-key header on Anthropic-compatible calls', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] }),
    } as Response);

    await callAiWithTools({
      apiKey: 'sk-real-key-abc123',
      apiFormat: 'anthropic-compatible',
      model: 'm',
      baseUrl: 'https://example.test/v1/messages',
      provider: 'mimo',
      systemPrompt: 'sys',
      messages: [],
      tools: [],
      maxRounds: 1,
    });

    const headers = fetchSpy.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-real-key-abc123');
  });

  it('returns max_rounds when the model keeps calling tools', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'fetch_file', input: { path: 'a' } }],
      }),
    } as Response);

    const turn = await callAiWithTools({
      apiKey: 'test-key',
      apiFormat: 'anthropic-compatible',
      model: 'm',
      baseUrl: 'https://example.test/v1/messages',
      provider: 'mimo',
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'review' }] }],
      tools: [{ name: 'fetch_file', description: 'd', input_schema: { type: 'object' } }],
      maxRounds: 1,
    });

    expect(turn.stopReason).toBe('max_rounds');
    expect(turn.toolCalls).toHaveLength(1);
  });

  it('returns a stub for maxRounds=0 without calling the API', async () => {
    const turn = await callAiWithTools({
      apiKey: 'test-key',
      apiFormat: 'anthropic-compatible',
      model: 'm',
      baseUrl: 'https://example.test/v1/messages',
      provider: 'mimo',
      systemPrompt: 'sys',
      messages: [],
      tools: [],
      maxRounds: 0,
    });
    expect(turn.stopReason).toBe('max_rounds');
    expect(turn.content).toBeNull();
    expect(turn.toolCalls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('drops the oldest tool result when the message list exceeds STATIC_REVIEW_MAX_MESSAGE_CHARS', async () => {
    // Build a messages array whose total length is just under the cap,
    // then add a tool result that pushes it over.
    const oldResult = 'x'.repeat(195_000);
    const newResult = 'y'.repeat(10_000);
    const messages: any[] = [
      { role: 'user', content: [{ type: 'text', text: 'review' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'fetch_file', input: { path: 'a' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: oldResult }] },
    ];

    const next = appendToolResults(
      messages,
      [{ id: 't2', name: 'fetch_file', input: { path: 'b' } }],
      [{ toolCallId: 't2', name: 'fetch_file', content: newResult }],
      'anthropic-compatible'
    );

    // The new tool result was appended; the oldest tool_result was dropped
    // and replaced with a marker.
    const serialized = JSON.stringify(next);
    expect(serialized.length).toBeLessThan(220_000);
    expect(serialized).toContain('earliest tool result dropped');
  });
});