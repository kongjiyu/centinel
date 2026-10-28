import { describe, it, expect } from 'vitest';

import {
  parseAnthropicToolTurn,
  parseOpenAIToolTurn,
  parseGoogleToolTurn,
  parseProviderResponseUsage,
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

describe('parse*ToolTurn usage extraction', () => {
  it('preserves a partial provider usage block without filling omitted counters with zero', () => {
    const turn = parseOpenAIToolTurn({ usage: { prompt_tokens: 10 } });
    expect(turn.usage).toEqual({
      inputTokens: 10,
      usageObservation: { source: 'provider_response', completeness: 'partial', missingCounters: ['outputTokens', 'cacheReadTokens'] },
    });
    expect(parseOpenAIToolTurn({}).usage).toBeUndefined();
  });

  it('reads only safe usage counters from provider error envelopes', () => {
    expect(parseProviderResponseUsage('openai-compatible', {
      error: { message: 'private prompt echoed here', usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
    }, 'provider_error_response')).toEqual({
      inputTokens: 10, outputTokens: 2, totalTokens: 12, providerReportedTotalTokens: 12, totalTokensSource: 'provider_reported',
      usageObservation: { source: 'provider_error_response', completeness: 'partial', missingCounters: ['cacheReadTokens'] },
    });
  });

  it('parses Anthropic usage including cache tokens', async () => {
    const { parseAnthropicToolTurn } = await import('../../src/aiClient');
    const json = {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 20,
      },
    };
    const turn = parseAnthropicToolTurn(json);
    expect(turn.usage).toBeDefined();
    expect(turn.usage!.inputTokens).toBe(100);
    expect(turn.usage!.outputTokens).toBe(50);
    expect(turn.usage!.cacheReadTokens).toBe(80);
    expect(turn.usage!.cacheCreationTokens).toBe(20);
    expect(turn.usage!.totalTokens).toBe(250);
    expect(turn.usage).not.toHaveProperty('providerReportedTotalTokens');
  });

  it('parses OpenAI usage including prompt_tokens_details.cached_tokens', async () => {
    const { parseOpenAIToolTurn } = await import('../../src/aiClient');
    const json = {
      choices: [{ message: { content: 'ok' } }],
      usage: {
        prompt_tokens: 200,
        completion_tokens: 75,
        total_tokens: 275,
        prompt_tokens_details: { cached_tokens: 150 },
      },
    };
    const turn = parseOpenAIToolTurn(json);
    expect(turn.usage).toBeDefined();
    expect(turn.usage!.inputTokens).toBe(200);
    expect(turn.usage!.outputTokens).toBe(75);
    expect(turn.usage!.cacheReadTokens).toBe(150);
    expect(turn.usage!.totalTokens).toBe(275);
    expect(turn.usage!.providerReportedTotalTokens).toBe(275);
  });

  it('parses Google usage including cachedContentTokenCount', async () => {
    const { parseGoogleToolTurn } = await import('../../src/aiClient');
    const json = {
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: {
        promptTokenCount: 300,
        candidatesTokenCount: 100,
        totalTokenCount: 400,
        cachedContentTokenCount: 250,
      },
    };
    const turn = parseGoogleToolTurn(json);
    expect(turn.usage).toBeDefined();
    expect(turn.usage!.inputTokens).toBe(300);
    expect(turn.usage!.outputTokens).toBe(100);
    expect(turn.usage!.cacheReadTokens).toBe(250);
    expect(turn.usage!.totalTokens).toBe(400);
    expect(turn.usage!.providerReportedTotalTokens).toBe(400);
  });

  it('does not label adapter-derived totals as provider-reported', async () => {
    const { parseOpenAIToolTurn, parseGoogleToolTurn } = await import('../../src/aiClient');
    const openAi = parseOpenAIToolTurn({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    });
    const google = parseGoogleToolTurn({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 },
    });

    expect(openAi.usage?.totalTokens).toBe(25);
    expect(openAi.usage).not.toHaveProperty('providerReportedTotalTokens');
    expect(google.usage?.totalTokens).toBe(25);
    expect(google.usage).not.toHaveProperty('providerReportedTotalTokens');
  });

  it('preserves explicit zero provider counts as observed usage', async () => {
    const { parseAnthropicToolTurn, parseOpenAIToolTurn, parseGoogleToolTurn } = await import('../../src/aiClient');
    expect(parseAnthropicToolTurn({ usage: { input_tokens: 0, output_tokens: 0 } }).usage).toMatchObject({
      inputTokens: 0, outputTokens: 0, usageObservation: { completeness: 'partial' },
    });
    expect(parseOpenAIToolTurn({ usage: { prompt_tokens: 0, completion_tokens: 0 } }).usage).toMatchObject({
      inputTokens: 0, outputTokens: 0, totalTokens: 0, usageObservation: { completeness: 'partial' },
    });
    expect(parseGoogleToolTurn({ usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 } }).usage).toMatchObject({
      inputTokens: 0, outputTokens: 0, totalTokens: 0, usageObservation: { completeness: 'partial' },
    });
  });

  it('returns undefined usage when the usage block is missing entirely', async () => {
    const { parseAnthropicToolTurn, parseOpenAIToolTurn, parseGoogleToolTurn } = await import('../../src/aiClient');
    expect(parseAnthropicToolTurn({ content: [] }).usage).toBeUndefined();
    expect(parseOpenAIToolTurn({ choices: [{ message: { content: 'x' } }] }).usage).toBeUndefined();
    expect(parseGoogleToolTurn({ candidates: [] }).usage).toBeUndefined();
  });
});
