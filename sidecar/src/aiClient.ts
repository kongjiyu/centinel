import fs from 'fs';
import type { AiProvider, AiApiFormat } from './settings.js';

type TestResult = { status: string; message?: string; raw?: string; hint?: string; usage?: TokenUsage };

type SettingLike = {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: AiProvider;
  apiFormat: AiApiFormat;
};
export type { SettingLike };

/**
 * Token usage as reported by the provider in the API response's `usage` block.
 * Every field is optional because:
 *   - Not all providers report cache tokens (only Anthropic does today)
 *   - Older model versions may omit usage entirely
 *   - A 4xx error never reaches the parser
 *
 * Values are integers. Zero is a valid value (e.g. a tool-call round with no
 * extra text) and is preserved so cost dashboards can distinguish "no tokens
 * billed" from "usage unknown".
 */
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  totalTokens?: number;
};

export function getAuthHeaders(setting: SettingLike): Record<string, string> {
  // MiMo uses x-api-key header (Anthropic-compatible convention)
  if (setting.provider === 'mimo') {
    return { 'Content-Type': 'application/json', 'x-api-key': setting.apiKey, 'anthropic-version': '2023-06-01' };
  }
  // Anthropic-compatible uses x-api-key header + required anthropic-version
  if (setting.apiFormat === 'anthropic-compatible') {
    return { 'Content-Type': 'application/json', 'x-api-key': setting.apiKey, 'anthropic-version': '2023-06-01' };
  }
  // OpenAI-compatible uses Authorization Bearer
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${setting.apiKey}` };
}

// ── Tool-use types and per-format parsers ─────────────────────────────────────

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export type ToolTurn = {
  content: string | null;
  toolCalls: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_rounds' | 'error';
  raw?: unknown;
  usage?: TokenUsage;
};

type AnthropicContentBlock = Record<string, unknown> & { type: string };

export function parseAnthropicToolTurn(json: unknown): ToolTurn {
  const j = (json ?? {}) as {
    stop_reason?: string;
    content?: AnthropicContentBlock[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  const blocks = Array.isArray(j.content) ? j.content : [];
  const textParts = blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string);
  const text = textParts.length > 0 ? textParts.join('\n') : null;
  const toolCalls: ToolCall[] = blocks
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({
      id: String(b.id ?? ''),
      name: String(b.name ?? ''),
      input: (b.input as Record<string, unknown>) ?? {},
    }));
  const stopReason: ToolTurn['stopReason'] = j.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn';
  return { content: text, toolCalls, stopReason, raw: json, usage: parseAnthropicUsage(j.usage) };
}

function parseAnthropicUsage(usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const input = Number(usage.input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
  const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0);
  // Skip rows that have literally nothing — some providers omit usage on
  // 4xx-returned error envelopes and we don't want to record a "0" row that
  // pollutes the dashboard.
  if (input === 0 && output === 0 && cacheRead === 0 && cacheCreation === 0) return undefined;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead || undefined,
    cacheCreationTokens: cacheCreation || undefined,
    totalTokens: input + output + cacheRead + cacheCreation,
  };
}

export function parseOpenAIToolTurn(json: unknown): ToolTurn {
  const j = (json ?? {}) as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
  const msg = j.choices?.[0]?.message ?? {};
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((c) => {
    let input: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(c.function.arguments || '{}');
      if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>;
    } catch { /* leave as {} */ }
    return { id: c.id, name: c.function.name, input };
  });
  const content = msg.content ?? null;
  const stopReason: ToolTurn['stopReason'] = toolCalls.length > 0 ? 'tool_use' : 'end_turn';
  return { content, toolCalls, stopReason, raw: json, usage: parseOpenAIUsage(j.usage) };
}

function parseOpenAIUsage(usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const input = Number(usage.prompt_tokens ?? 0);
  const output = Number(usage.completion_tokens ?? 0);
  const cached = Number(usage.prompt_tokens_details?.cached_tokens ?? 0);
  if (input === 0 && output === 0 && cached === 0) return undefined;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cached || undefined,
    totalTokens: usage.total_tokens ?? input + output,
  };
}

export function parseGoogleToolTurn(json: unknown): ToolTurn {
  const j = (json ?? {}) as {
    candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
      cachedContentTokenCount?: number;
    };
  };
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  const textParts = parts
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text as string);
  const text = textParts.length > 0 ? textParts.join('\n') : null;
  const fcalls = parts.filter((p) => p.functionCall);
  const toolCalls: ToolCall[] = fcalls.map((p, i) => {
    const fc = p.functionCall as { name: string; args?: Record<string, unknown> };
    return {
      id: `google-${Date.now()}-${i}`,
      name: fc.name,
      input: fc.args ?? {},
    };
  });
  const stopReason: ToolTurn['stopReason'] = toolCalls.length > 0 ? 'tool_use' : 'end_turn';
  return { content: text, toolCalls, stopReason, raw: json, usage: parseGoogleUsage(j.usageMetadata) };
}

function parseGoogleUsage(meta: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number; cachedContentTokenCount?: number } | undefined): TokenUsage | undefined {
  if (!meta) return undefined;
  const input = Number(meta.promptTokenCount ?? 0);
  const output = Number(meta.candidatesTokenCount ?? 0);
  const cached = Number(meta.cachedContentTokenCount ?? 0);
  if (input === 0 && output === 0 && cached === 0) return undefined;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cached || undefined,
    totalTokens: meta.totalTokenCount ?? input + output,
  };
}

// Build the actual URL to fetch for a given setting.
// Anthropic-compatible endpoints are always rooted at /v1/messages, so users
// can supply either the base URL (e.g. https://api.minimax.io/anthropic) or
// the full URL (https://api.minimax.io/anthropic/v1/messages). If they
// supplied the base, we append the canonical path. The full URL is left alone
// so saved settings from older versions still work.
export function buildRequestUrl(setting: SettingLike): string {
  if (setting.apiFormat === 'google-native') {
    return `${setting.baseUrl.replace(/\/+$/, '')}/${setting.model}:generateContent?key=${setting.apiKey}`;
  }
  if (setting.apiFormat === 'anthropic-compatible') {
    if (!/\/v1\/messages\/?$/.test(setting.baseUrl)) {
      return setting.baseUrl.replace(/\/+$/, '') + '/v1/messages';
    }
  }
  return setting.baseUrl;
}

export async function testTextProvider(setting: SettingLike): Promise<TestResult> {
  const prompt = 'Reply with exactly this JSON: {"status":"ok"}';

  let body: string;
  let headers: Record<string, string>;
  const fetchUrl = buildRequestUrl(setting);

  if (setting.apiFormat === 'google-native') {
    // Google Gemini API format
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 128 },
    });
  } else if (setting.apiFormat === 'anthropic-compatible') {
    headers = getAuthHeaders(setting);
    body = JSON.stringify({
      model: setting.model,
      max_tokens: 128,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
  } else {
    // openai-compatible
    headers = getAuthHeaders(setting);
    body = JSON.stringify({
      model: setting.model,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 128,
      // Disable thinking mode for MiMo to prevent token exhaustion
      thinking: { type: 'disabled' },
    });
  }

  return doFetch(fetchUrl, headers, body, { apiFormat: setting.apiFormat });
}

export async function testVisionProvider(setting: SettingLike, imagePath?: string): Promise<TestResult> {
  let base64 = '';
  if (imagePath && fs.existsSync(imagePath)) {
    const buf = fs.readFileSync(imagePath);
    base64 = buf.toString('base64');
  }

  const prompt = 'Describe this image briefly. Return JSON: {"status":"ok","description":"..."}';

  let body: string;
  let headers: Record<string, string>;
  const fetchUrl = buildRequestUrl(setting);

  if (setting.apiFormat === 'google-native') {
    // Google Gemini API format
    headers = { 'Content-Type': 'application/json' };
    const parts: unknown[] = [];
    if (base64) {
      parts.push({ inlineData: { mimeType: 'image/png', data: base64 } });
    }
    parts.push({ text: prompt });
    body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: 256 },
    });
  } else if (setting.apiFormat === 'anthropic-compatible') {
    headers = getAuthHeaders(setting);
    const content: unknown[] = [];
    if (base64) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: base64 },
      });
    }
    content.push({ type: 'text', text: prompt });
    body = JSON.stringify({
      model: setting.model,
      max_tokens: 256,
      messages: [{ role: 'user', content }],
    });
  } else {
    // openai-compatible (MiMo default)
    headers = getAuthHeaders(setting);
    const content: unknown[] = [];
    if (base64) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${base64}` },
      });
    }
    content.push({ type: 'text', text: prompt });
    body = JSON.stringify({
      model: setting.model,
      messages: [{ role: 'user', content }],
      max_completion_tokens: 256,
      // Disable thinking mode for MiMo to prevent token exhaustion
      thinking: { type: 'disabled' },
    });
  }

  return doFetch(fetchUrl, headers, body, { apiFormat: setting.apiFormat });
}

async function doFetch(url: string, headers: Record<string, string>, body: string, ctx: { apiFormat: AiApiFormat }): Promise<TestResult> {
  try {
    const res = await fetch(url, { method: 'POST', headers, body });
    if (!res.ok) {
      const text = await res.text();
      const hint = buildHint(res.status, url, ctx.apiFormat, text);
      return { status: 'fail', message: `HTTP ${res.status}: ${res.statusText}`, raw: text, hint };
    }
    const json = await res.json();
    // Test calls also count toward usage — the user clicks "Test" to verify
    // the provider works, and that round-trip costs real tokens. Surface the
    // usage so the /settings/ai/test handler can record it.
    const usage = ctx.apiFormat === 'anthropic-compatible'
      ? parseAnthropicToolTurn(json).usage
      : ctx.apiFormat === 'openai-compatible'
      ? parseOpenAIToolTurn(json).usage
      : parseGoogleToolTurn(json).usage;
    return { status: 'pass', message: 'ok', raw: JSON.stringify(json), usage };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 'fail',
      message: msg,
      hint: 'Could not reach the configured endpoint. Verify the sidecar is running, the Base URL is correct, and the network allows outbound HTTPS.',
    };
  }
}

function buildHint(status: number, url: string, apiFormat: AiApiFormat, body: string): string {
  if (status === 404) {
    if (apiFormat === 'openai-compatible' && /\/anthropic/i.test(url)) {
      return 'The endpoint URL contains "/anthropic" but the format is "openai-compatible". Switch the API format to "anthropic-compatible" or use the OpenAI chat-completions URL (e.g. /v1/chat/completions).';
    }
    if (apiFormat === 'anthropic-compatible' && !/\/v1\/messages/.test(url)) {
      return 'Anthropic-compatible endpoints typically end with /v1/messages. Check that the Base URL points to the messages endpoint.';
    }
    if (apiFormat === 'openai-compatible' && !/\/chat\/completions/.test(url)) {
      return 'OpenAI-compatible endpoints typically end with /v1/chat/completions. Check that the Base URL points to the chat-completions endpoint.';
    }
    return 'The endpoint returned 404. The Base URL may be wrong, the path may be missing a suffix (e.g. /v1/chat/completions), or the model may be unavailable at this URL.';
  }
  if (status === 401 || status === 403) {
    // Surface provider-specific auth guidance (e.g. MiniMax requires "X-Api-Key").
    if (/X-Api-Key/i.test(body)) {
      return 'Authentication failed: the provider requires the API key in the "X-Api-Key" header. This is the standard header; verify the sidecar is sending it (it does for Anthropic-compatible and MiMo formats).';
    }
    return 'Authentication failed. Verify the API key has access to the configured model.';
  }
  if (status === 429) {
    return 'Rate limited. Wait a moment and try again, or check your plan quota.';
  }
  if (status >= 500) {
    return 'The upstream service is having trouble. Try again in a few seconds.';
  }
  return `Unexpected status ${status}. Inspect the raw response in the test result.`;
}
