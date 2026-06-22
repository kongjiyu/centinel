import fs from 'fs';
import { getRawAiSetting, type AiProvider, type AiApiFormat } from './settings.js';

type TestResult = { status: string; message?: string; raw?: string; hint?: string };

type SettingLike = {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: AiProvider;
  apiFormat: AiApiFormat;
};
export type { SettingLike };

export type TestOverrides = {
  provider?: AiProvider;
  apiFormat?: AiApiFormat;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export async function testAiProvider(
  id: 'text' | 'vision',
  imagePath?: string,
  overrides: TestOverrides = {}
): Promise<TestResult> {
  const saved = await getRawAiSetting(id);
  if (!saved) return { status: 'fail', message: `Provider "${id}" not found` };

  // Form-state overrides let the Test button reflect what the user just typed,
  // not just what's persisted. Empty strings mean "ignore this override" so the
  // saved value is used. For apiKey, the frontend doesn't ship the saved key,
  // so an empty/undefined apiKey override falls back to the persisted key.
  const setting: SettingLike = {
    provider: overrides.provider ?? saved.provider,
    apiFormat: overrides.apiFormat ?? saved.apiFormat,
    apiKey: overrides.apiKey && overrides.apiKey.length > 0 ? overrides.apiKey : saved.apiKey,
    baseUrl: overrides.baseUrl && overrides.baseUrl.length > 0 ? overrides.baseUrl : saved.baseUrl,
    model: overrides.model && overrides.model.length > 0 ? overrides.model : saved.model,
  };
  if (!setting.apiKey) return { status: 'fail', message: 'API key is not configured' };

  if (id === 'text') {
    return testTextProvider(setting);
  }
  return testVisionProvider(setting, imagePath);
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
};

export type ToolSchema = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

type AnthropicContentBlock = Record<string, unknown> & { type: string };

export function parseAnthropicToolTurn(json: unknown): ToolTurn {
  const j = (json ?? {}) as { stop_reason?: string; content?: AnthropicContentBlock[] };
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
  return { content: text, toolCalls, stopReason, raw: json };
}

export function parseOpenAIToolTurn(json: unknown): ToolTurn {
  const j = (json ?? {}) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };
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
  return { content, toolCalls, stopReason, raw: json };
}

export function parseGoogleToolTurn(json: unknown): ToolTurn {
  const j = (json ?? {}) as { candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }> };
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
  return { content: text, toolCalls, stopReason, raw: json };
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

// ── Tool-use request builders (Anthropic / OpenAI / Google) ───────────────────

type ApiFormat = 'openai-compatible' | 'anthropic-compatible' | 'google-native';

export function buildAnthropicToolRequest(
  model: string,
  systemPrompt: string,
  messages: unknown[],
  tools: ToolSchema[]
): Record<string, unknown> {
  return {
    model,
    max_tokens: 8192,
    system: systemPrompt,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    })),
    messages,
  };
}

export function buildOpenAIToolRequest(
  model: string,
  systemPrompt: string,
  messages: unknown[],
  tools: ToolSchema[]
): Record<string, unknown> {
  return {
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    tools: tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    })),
    max_completion_tokens: 8192,
    thinking: { type: 'disabled' },
  };
}

export function buildGoogleToolRequest(
  model: string,
  systemPrompt: string,
  messages: unknown[],
  tools: ToolSchema[]
): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: messages,
    tools: [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        })),
      },
    ],
    generationConfig: { maxOutputTokens: 8192 },
  };
}

function buildToolRequest(
  apiFormat: ApiFormat,
  model: string,
  systemPrompt: string,
  messages: unknown[],
  tools: ToolSchema[]
): Record<string, unknown> {
  if (apiFormat === 'anthropic-compatible') return buildAnthropicToolRequest(model, systemPrompt, messages, tools);
  if (apiFormat === 'openai-compatible') return buildOpenAIToolRequest(model, systemPrompt, messages, tools);
  return buildGoogleToolRequest(model, systemPrompt, messages, tools);
}

// ── Per-format tool-result appender ───────────────────────────────────────────

export type AppendableMessage = Record<string, unknown>;

export function appendToolResults(
  messages: AppendableMessage[],
  toolCalls: ToolCall[],
  results: Array<{ toolCallId: string; name: string; content: string; isError?: boolean }>,
  apiFormat: ApiFormat
): AppendableMessage[] {
  let next: AppendableMessage[];
  if (apiFormat === 'anthropic-compatible') {
    const blocks = results.map((r) => ({
      type: 'tool_result',
      tool_use_id: r.toolCallId,
      content: r.isError ? `ERROR: ${r.content}` : r.content,
    }));
    next = [...messages, { role: 'user', content: blocks }];
  } else if (apiFormat === 'openai-compatible') {
    const newMsgs: AppendableMessage[] = results.map((r) => ({
      role: 'tool',
      tool_call_id: r.toolCallId,
      content: r.isError ? `ERROR: ${r.content}` : r.content,
    }));
    next = [...messages, ...newMsgs];
  } else {
    // google-native
    const parts = results.map((r) => ({
      functionResponse: {
        name: r.name,
        response: { content: r.content, isError: !!r.isError },
      },
    }));
    next = [...messages, { role: 'user', parts }];
  }
  return enforceMessageCap(next);
}

// ── Message-list cap (drop oldest tool result) ────────────────────────────────

const MAX_MESSAGE_CHARS_DEFAULT = 200_000;
const DROP_MARKER = '[earliest tool result dropped to stay within the message limit; re-fetch if needed]';

function getMaxMessageChars(): number {
  const fromEnv = Number(process.env.STATIC_REVIEW_MAX_MESSAGE_CHARS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : MAX_MESSAGE_CHARS_DEFAULT;
}

function enforceMessageCap(messages: AppendableMessage[]): AppendableMessage[] {
  const cap = getMaxMessageChars();
  const serialized = JSON.stringify(messages);
  if (serialized.length <= cap) return messages;

  // Find the first message that looks like a tool result and replace its content with the marker.
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'user' && Array.isArray(m.content)) {
      // Anthropic tool_result blocks
      const blocks = m.content as Array<Record<string, unknown>>;
      const idx = blocks.findIndex((b) => b.type === 'tool_result');
      if (idx >= 0) {
        const newBlocks = [...blocks];
        newBlocks[idx] = { ...newBlocks[idx], content: DROP_MARKER };
        return [...messages.slice(0, i), { ...m, content: newBlocks }, ...messages.slice(i + 1)];
      }
    } else if (m.role === 'tool') {
      // OpenAI single tool message
      return [...messages.slice(0, i), { ...m, content: DROP_MARKER }, ...messages.slice(i + 1)];
    } else if (m.role === 'user' && Array.isArray((m as Record<string, unknown>).parts)) {
      // Google functionResponse parts
      const parts = (m as Record<string, unknown>).parts as Array<Record<string, unknown>>;
      const idx = parts.findIndex((p) => p.functionResponse);
      if (idx >= 0) {
        const newParts = [...parts];
        newParts[idx] = {
          functionResponse: { name: 'dropped', response: { content: DROP_MARKER } },
        };
        return [...messages.slice(0, i), { ...m, parts: newParts }, ...messages.slice(i + 1)];
      }
    }
  }
  return messages;
}

// ── Main loop ─────────────────────────────────────────────────────────────────

export type CallAiWithToolsOpts = {
  apiKey: string;
  apiFormat: ApiFormat;
  model: string;
  baseUrl: string;
  provider: 'mimo' | 'gemini' | 'custom';
  systemPrompt: string;
  messages: AppendableMessage[];
  tools: ToolSchema[];
  maxRounds?: number;
  signal?: AbortSignal;
  /** Called once per model-emitted tool call (per round). Useful for surfacing
   *  what the model is investigating in the progress stream. */
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
};

export async function callAiWithTools(opts: CallAiWithToolsOpts): Promise<ToolTurn> {
  const envRounds = Number(process.env.STATIC_REVIEW_MAX_ROUNDS);
  const maxRounds = opts.maxRounds ?? (Number.isFinite(envRounds) ? envRounds : 3);
  const { apiFormat, model, baseUrl, provider, systemPrompt } = opts;
  let messages = opts.messages;
  const tools = opts.tools;

  // The caller is expected to have wired `executeTool` into a wrapper; we accept
  // a registry of tool names → handlers via the global. `setToolExecutor` is
  // called by staticReview.ts at session start. Default to throwing so an
  // unconfigured loop fails loudly.
  const toolExecutor: ToolExecutor = (globalThis as any).__centinelToolExecutor ?? defaultToolExecutor;

  let lastTurn: ToolTurn | null = null;
  for (let round = 0; round < maxRounds; round++) {
    messages = enforceMessageCap(messages);
    const body = buildToolRequest(apiFormat, model, systemPrompt, messages, tools);
    const url = buildRequestUrl({ apiKey: '', baseUrl, model, provider, apiFormat } as SettingLike);
    const headers = getAuthHeaders({ apiKey: opts.apiKey, baseUrl, model, provider, apiFormat } as SettingLike);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI API error: HTTP ${res.status} — ${text}`);
    }
    const json = await res.json();

    const turn = apiFormat === 'anthropic-compatible'
      ? parseAnthropicToolTurn(json)
      : apiFormat === 'openai-compatible'
      ? parseOpenAIToolTurn(json)
      : parseGoogleToolTurn(json);
    lastTurn = turn;

    if (turn.stopReason === 'end_turn') return turn;
    if (turn.toolCalls.length === 0) return turn;

    // Surface each tool call to the caller (e.g. for progress UI) before
    // dispatching to the executor.
    if (opts.onToolCall) {
      for (const call of turn.toolCalls) {
        opts.onToolCall(call.name, call.input);
      }
    }

    // Skip tool execution on the last round — returning max_rounds means
    // "stop without consuming more rounds", so pending tools are abandoned
    // rather than executed. This avoids triggering the (uninstalled) executor
    // in tests and in early integration before setToolExecutor is called.
    const isLastRound = round === maxRounds - 1;
    if (isLastRound) {
      return { ...turn, stopReason: 'max_rounds' as const };
    }

    // Execute tools in parallel
    const results = await Promise.all(turn.toolCalls.map(toolExecutor));
    messages = appendToolResults(messages, turn.toolCalls, results, apiFormat);
  }

  if (lastTurn) return { ...lastTurn, stopReason: 'max_rounds' };
  return { content: null, toolCalls: [], stopReason: 'max_rounds' };
}

// ── Tool executor registry (installed by staticReview.ts) ─────────────────────

export type ToolResult = { toolCallId: string; name: string; content: string; isError?: boolean };
export type ToolExecutor = (call: ToolCall) => Promise<ToolResult>;

export function setToolExecutor(executor: ToolExecutor): void {
  (globalThis as any).__centinelToolExecutor = executor;
}

const defaultToolExecutor: ToolExecutor = async (call) => {
  throw new Error(`No tool executor registered; cannot run ${call.name}`);
};

// ── Prompt size cap ────────────────────────────────────────────────────
//
// Provider context windows are finite. The static review pipeline concatenates
// artifact content across stages (Stage 3 in particular sends requirement
// content + source code content + earlier-stage summaries in a single call),
// so a single oversized prompt can blow past the window and get a 400.
//
// Rather than try to tokenize the prompt, we cap in characters with a generous
// ceiling (~25K tokens at a 4-char/token heuristic) and leave room for an
// 8K-token response. The cap is applied to the user-content text only — the
// system prompt is never truncated, so instructions stay intact.

export const MAX_PROMPT_CHARS = 100_000;

const TRUNCATION_MARKER = '\n\n[... prompt truncated to fit model context window ...]';

/**
 * Return the prompt unchanged if it fits within `maxChars`. Otherwise, cut it
 * to `maxChars - markerLength` and append a marker so the AI knows it is
 * seeing a partial prompt.
 */
export function capPrompt(prompt: string, maxChars: number = MAX_PROMPT_CHARS): string {
  if (prompt.length <= maxChars) return prompt;
  return prompt.substring(0, maxChars - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

/**
 * Cap the user content inside a messages array, leaving the system prompt and
 * any prior conversation turns untouched. Supports both Anthropic-style content
 * blocks (`{ type: 'text', text }`) and OpenAI-style plain strings.
 *
 * Returns `{ messages, truncated }` so callers can surface the trim in the
 * progress UI. If `messages` is not a recognized shape, the array is returned
 * unchanged.
 */
type AnyMessage = Record<string, unknown>;
type CapResult = { messages: AnyMessage[]; truncated: boolean };

export function capMessages(
  messages: AnyMessage[],
  maxChars: number = MAX_PROMPT_CHARS
): CapResult {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages, truncated: false };
  }
  // Walk to the last user-role message; if none, cap the last message.
  let targetIdx = messages.length - 1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      targetIdx = i;
      break;
    }
  }
  const target = { ...messages[targetIdx] };
  const content = target.content;
  let userText: string | null = null;
  let textField: 'text' | 'content' = 'text';

  if (typeof content === 'string') {
    userText = content;
    textField = 'content';
  } else if (Array.isArray(content)) {
    // Anthropic-style: find the first text block on the last user message.
    const textBlock = (content as unknown[]).find(
      (b): b is Record<string, unknown> =>
        typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'text' && typeof (b as Record<string, unknown>).text === 'string'
    );
    if (textBlock) {
      userText = textBlock.text as string;
      textField = 'text';
    }
  }

  if (userText === null || userText.length <= maxChars) {
    return { messages, truncated: false };
  }

  const truncatedText = capPrompt(userText, maxChars);
  if (typeof content === 'string') {
    target.content = truncatedText;
  } else if (Array.isArray(content)) {
    target.content = (content as unknown[]).map((b) => {
      if (
        typeof b === 'object' &&
        b !== null &&
        (b as Record<string, unknown>).type === 'text' &&
        typeof (b as Record<string, unknown>).text === 'string'
      ) {
        return { ...(b as Record<string, unknown>), [textField]: truncatedText };
      }
      return b;
    });
  }
  const next = messages.slice();
  next[targetIdx] = target;
  return { messages: next, truncated: true };
}

async function testTextProvider(setting: SettingLike): Promise<TestResult> {
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

async function testVisionProvider(setting: SettingLike, imagePath?: string): Promise<TestResult> {
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
    return { status: 'pass', message: 'ok', raw: JSON.stringify(json) };
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
