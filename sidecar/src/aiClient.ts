import fs from 'fs';
import type { AiProvider, AiApiFormat } from './settings.js';

type TestResult = {
  status: string;
  message?: string;
  raw?: string;
  hint?: string;
  usage?: TokenUsage;
  responseReceived?: boolean;
  usageAccounting?: UsageAccounting;
};

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
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Only populated when the raw provider usage payload explicitly supplied a total. */
  providerReportedTotalTokens?: number;
  /** Origin of totalTokens, which may be adapter-derived when provider total is absent. */
  totalTokensSource?: 'provider_reported' | 'adapter_derived';
  /** Normalized total retained for compatibility; adapters may derive it. */
  totalTokens?: number;
  /** Safe provenance for a provider usage block. No raw response content is retained. */
  usageObservation?: TokenUsageObservation;
};

export type TokenUsageObservation = {
  source: 'provider_response' | 'provider_error_response' | 'codex_thread_total' | 'codex_turn_last';
  completeness: 'complete' | 'partial';
  missingCounters?: UsageCounter[];
};

export type UsageCounter = 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheCreationTokens' | 'totalTokens';

export type UsageAccounting = {
  basis: 'assumed_zero_no_response';
  accountedTokens: 0;
};

function usageCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function usageObservation(
  source: TokenUsageObservation['source'],
  fields: Array<[UsageCounter, unknown]>,
): TokenUsageObservation {
  const missingCounters = fields.filter(([, value]) => usageCount(value) === undefined).map(([name]) => name);
  return { source, completeness: missingCounters.length ? 'partial' : 'complete', ...(missingCounters.length ? { missingCounters } : {}) };
}

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
  const input = usageCount(usage.input_tokens);
  const output = usageCount(usage.output_tokens);
  const cacheRead = usageCount(usage.cache_read_input_tokens);
  const cacheCreation = usageCount(usage.cache_creation_input_tokens);
  const hasCompleteCounts = input !== undefined && output !== undefined && cacheRead !== undefined && cacheCreation !== undefined;
  return {
    ...(input === undefined ? {} : { inputTokens: input }),
    ...(output === undefined ? {} : { outputTokens: output }),
    ...(cacheRead === undefined ? {} : { cacheReadTokens: cacheRead }),
    ...(cacheCreation === undefined ? {} : { cacheCreationTokens: cacheCreation }),
    ...(hasCompleteCounts ? { totalTokens: input! + output! + cacheRead! + cacheCreation!, totalTokensSource: 'adapter_derived' as const } : {}),
    usageObservation: usageObservation('provider_response', [
      ['inputTokens', usage.input_tokens], ['outputTokens', usage.output_tokens],
      ['cacheReadTokens', usage.cache_read_input_tokens], ['cacheCreationTokens', usage.cache_creation_input_tokens],
    ]),
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
  const input = usageCount(usage.prompt_tokens);
  const output = usageCount(usage.completion_tokens);
  const cached = usageCount(usage.prompt_tokens_details?.cached_tokens);
  const reportedTotal = usageCount(usage.total_tokens);
  const total = reportedTotal ?? (input !== undefined && output !== undefined ? input + output : undefined);
  return {
    ...(input === undefined ? {} : { inputTokens: input }),
    ...(output === undefined ? {} : { outputTokens: output }),
    ...(cached === undefined ? {} : { cacheReadTokens: cached }),
    ...(total === undefined ? {} : { totalTokens: total, totalTokensSource: reportedTotal === undefined ? 'adapter_derived' as const : 'provider_reported' as const }),
    ...(reportedTotal === undefined ? {} : { providerReportedTotalTokens: reportedTotal }),
    usageObservation: usageObservation('provider_response', [
      ['inputTokens', usage.prompt_tokens], ['outputTokens', usage.completion_tokens], ['cacheReadTokens', usage.prompt_tokens_details?.cached_tokens],
    ]),
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
  const input = usageCount(meta.promptTokenCount);
  const output = usageCount(meta.candidatesTokenCount);
  const cached = usageCount(meta.cachedContentTokenCount);
  const reportedTotal = usageCount(meta.totalTokenCount);
  const total = reportedTotal ?? (input !== undefined && output !== undefined ? input + output : undefined);
  return {
    ...(input === undefined ? {} : { inputTokens: input }),
    ...(output === undefined ? {} : { outputTokens: output }),
    ...(cached === undefined ? {} : { cacheReadTokens: cached }),
    ...(total === undefined ? {} : { totalTokens: total, totalTokensSource: reportedTotal === undefined ? 'adapter_derived' as const : 'provider_reported' as const }),
    ...(reportedTotal === undefined ? {} : { providerReportedTotalTokens: reportedTotal }),
    usageObservation: usageObservation('provider_response', [
      ['inputTokens', meta.promptTokenCount], ['outputTokens', meta.candidatesTokenCount], ['cacheReadTokens', meta.cachedContentTokenCount],
    ]),
  };
}

/** Extract only token counters from a bounded provider payload. The payload
 * itself is never returned or retained by this helper. */
export function parseProviderResponseUsage(
  apiFormat: AiApiFormat,
  payload: unknown,
  source: TokenUsageObservation['source'] = 'provider_response',
): TokenUsage | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const root = payload as Record<string, unknown>;
  const error = root.error && typeof root.error === 'object' && !Array.isArray(root.error)
    ? root.error as Record<string, unknown> : undefined;
  const response = root.response && typeof root.response === 'object' && !Array.isArray(root.response)
    ? root.response as Record<string, unknown> : undefined;
  const candidates = [root, error, response].filter((value): value is Record<string, unknown> => Boolean(value));
  for (const candidate of candidates) {
    const value = apiFormat === 'anthropic-compatible' ? candidate.usage
      : apiFormat === 'google-native' ? candidate.usageMetadata : candidate.usage;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const parsed = apiFormat === 'anthropic-compatible'
      ? parseAnthropicUsage(value as Parameters<typeof parseAnthropicUsage>[0])
      : apiFormat === 'google-native'
        ? parseGoogleUsage(value as Parameters<typeof parseGoogleUsage>[0])
        : parseOpenAIUsage(value as Parameters<typeof parseOpenAIUsage>[0]);
    if (parsed) return {
      ...parsed,
      usageObservation: parsed.usageObservation ? { ...parsed.usageObservation, source } : undefined,
    };
  }
  return undefined;
}

/** Read a bounded response clone and retain only normalized usage counters.
 * Raw provider error text is discarded and never returned to callers. */
export async function readProviderErrorUsage(response: Response, apiFormat: AiApiFormat): Promise<TokenUsage | undefined> {
  const reader = response.clone().body?.getReader();
  if (!reader) return undefined;
  const maxBytes = 16_384;
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>(resolve => {
    deadlineTimer = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      resolve(null);
    }, 1_000);
  });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part === null) return undefined;
      if (part.done) { text += decoder.decode(); break; }
      bytes += part.value.byteLength;
      if (bytes > maxBytes) return undefined;
      text += decoder.decode(part.value, { stream: true });
    }
    return parseProviderResponseUsage(apiFormat, JSON.parse(text), 'provider_error_response');
  } catch {
    return undefined;
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    void reader.cancel().catch(() => undefined);
  }
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
  let responseReceived = false;
  try {
    const res = await fetch(url, { method: 'POST', headers, body });
    responseReceived = true;
    if (!res.ok) {
      const text = await res.text();
      const hint = buildHint(res.status, url, ctx.apiFormat, text);
      let usage: TokenUsage | undefined;
      try { usage = parseProviderResponseUsage(ctx.apiFormat, JSON.parse(text), 'provider_error_response'); } catch { /* no structured usage block */ }
      return { status: 'fail', message: `HTTP ${res.status}: ${res.statusText}`, raw: text, hint, usage, responseReceived };
    }
    const json = await res.json();
    // Test calls also count toward usage — the user clicks "Test" to verify
    // the provider works, and that round-trip costs real tokens. Surface the
    // usage so the /settings/ai/test handler can record it.
    const usage = parseProviderResponseUsage(ctx.apiFormat, json);
    return { status: 'pass', message: 'ok', raw: JSON.stringify(json), usage, responseReceived };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 'fail',
      message: msg,
      hint: 'Could not reach the configured endpoint. Verify the sidecar is running, the Base URL is correct, and the network allows outbound HTTPS.',
      responseReceived,
      ...(!responseReceived ? { usageAccounting: { basis: 'assumed_zero_no_response', accountedTokens: 0 } as const } : {}),
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
