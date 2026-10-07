import fs from 'node:fs';
import type { ModelRequest } from '../model/types.js';
import { getCodexBackend, type CodexBackend } from '../model/codex.js';
import {
  buildRequestUrl,
  getAuthHeaders,
  parseAnthropicToolTurn,
  parseGoogleToolTurn,
  parseOpenAIToolTurn,
  type TokenUsage,
} from '../aiClient.js';
import { ModelProviderError } from './retry.js';
import type {
  ModelProviderSettings,
  StaticAnalysisModelProvider,
  StaticModelResult,
} from './types.js';

export type ModelSettingResolver = () => Promise<ModelProviderSettings | null> | ModelProviderSettings | null;

export type ConfiguredTextModelProviderOptions = {
  settings?: ModelProviderSettings;
  resolveSettings?: ModelSettingResolver;
  fetchImpl?: typeof fetch;
  /** Used by tests and controlled integrations; defaults to global fetch. */
  maxOutputTokens?: number;
  codexBackend?: CodexBackend;
};

function parseRetryAfterHeader(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const timestamp = Date.parse(raw);
  if (Number.isFinite(timestamp)) return Math.max(0, timestamp - Date.now());
  return undefined;
}

function extractText(apiFormat: ModelProviderSettings['apiFormat'], json: unknown): { text: string | null; usage?: TokenUsage } {
  if (apiFormat === 'anthropic-compatible') {
    const turn = parseAnthropicToolTurn(json);
    return { text: turn.content, usage: turn.usage };
  }
  if (apiFormat === 'google-native') {
    const turn = parseGoogleToolTurn(json);
    return { text: turn.content, usage: turn.usage };
  }
  const turn = parseOpenAIToolTurn(json);
  return { text: turn.content, usage: turn.usage };
}

function buildRequestBody(settings: ModelProviderSettings, request: ModelRequest, maxOutputTokens: number): Record<string, unknown> {
  const prompt = request.repair
    ? `Return only a valid JSON object matching the requested schema. Repair the previous response without adding commentary.\n\n${request.prompt}`
    : request.prompt;
  const images = (request.imagePaths ?? []).map(file => fs.readFileSync(file).toString('base64'));
  if (settings.apiFormat === 'anthropic-compatible') {
    return {
      model: settings.model,
      max_tokens: maxOutputTokens,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: [...images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } })), { type: 'text', text: prompt }] }],
    };
  }
  if (settings.apiFormat === 'google-native') {
    return {
      systemInstruction: { parts: [{ text: request.systemPrompt }] },
      contents: [{ role: 'user', parts: [...images.map(data => ({ inlineData: { mimeType: 'image/png', data } })), { text: prompt }] }],
      generationConfig: { maxOutputTokens, responseMimeType: 'application/json' },
    };
  }
  return {
    model: settings.model,
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: images.length ? [...images.map(data => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${data}` } })), { type: 'text', text: prompt }] : prompt },
    ],
    max_completion_tokens: maxOutputTokens,
    // MiMo/OpenAI-compatible providers may reject an enabled reasoning mode
    // for structured review calls; keep it explicit and deterministic.
    thinking: { type: 'disabled' },
    response_format: { type: 'json_object' },
  };
}

function parseJsonContent(content: string | null): unknown {
  if (!content || !content.trim()) {
    throw new ModelProviderError('Model returned an empty structured response', {
      code: 'malformed_response', malformed: true, retryable: true,
    });
  }
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1].trim();
  try {
    return JSON.parse(text);
  } catch (cause) {
    // Some providers prepend a short sentence despite the JSON-only prompt.
    // A bounded object extraction keeps repair attempts useful without
    // accepting arbitrary prose as a successful analysis.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { /* repair below */ }
    }
    throw new ModelProviderError('Model returned malformed JSON', {
      code: 'malformed_response', malformed: true, retryable: true, cause,
    });
  }
}

/**
 * Shared Model Provider adapter for text and screenshot analysis. Settings must be supplied by
 * the authenticated caller; there is no local SQLite or environment fallback.
 */
export class ConfiguredTextModelProvider implements StaticAnalysisModelProvider {
  private readonly resolve: ModelSettingResolver;
  private readonly fetchImpl: typeof fetch;
  private readonly maxOutputTokens: number;
  private readonly codexBackend?: CodexBackend;

  constructor(options: ConfiguredTextModelProviderOptions = {}) {
    if (!options.resolveSettings && !options.settings) throw new Error('An authenticated Model Provider setting or resolver is required.');
    this.resolve = options.resolveSettings ?? (() => options.settings ?? null);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxOutputTokens = options.maxOutputTokens ?? 8_192;
    this.codexBackend = options.codexBackend;
  }

  async getSettings(): Promise<ModelProviderSettings | null> {
    return this.resolve();
  }

  async analyze(request: ModelRequest): Promise<StaticModelResult> {
    const settings = await this.resolve();
    if (!settings) {
      throw new ModelProviderError('Text Model Provider is not configured', {
        code: 'provider_not_configured', retryable: false,
      });
    }
    if (settings.provider === 'codex') {
      if (settings.apiFormat !== 'codex-app-server' || !settings.ownerId || !settings.model) {
        throw new ModelProviderError('Codex requires an authenticated user and selected model.', { code: 'invalid_configuration', retryable: false });
      }
      const reply = await (this.codexBackend ?? getCodexBackend(settings.ownerId)).generate({
        model: settings.model, systemPrompt: request.systemPrompt, prompt: request.prompt,
        imagePaths: request.imagePaths, signal: request.signal, outputSchema: request.outputSchema,
      });
      return { result: parseJsonContent(reply.text), usage: reply.usage,
        settings: { provider: 'codex', apiFormat: 'codex-app-server', model: reply.model } };
    }
    if (settings.apiFormat === 'codex-app-server') throw new ModelProviderError('Codex format requires the Codex provider.', { code: 'invalid_configuration', retryable: false });
    if (!settings.apiKey) {
      throw new ModelProviderError('Text Model Provider API key is not configured', {
        code: 'invalid_credentials', retryable: false,
      });
    }
    if (!settings.baseUrl || !settings.model) {
      throw new ModelProviderError('Text Model Provider model configuration is incomplete', {
        code: 'invalid_configuration', retryable: false,
      });
    }
    if (request.signal?.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    const response = await this.fetchImpl(buildRequestUrl(settings), {
      method: 'POST',
      headers: getAuthHeaders(settings),
      body: JSON.stringify(buildRequestBody(settings, request, this.maxOutputTokens)),
      signal: request.signal,
    });
    if (!response.ok) {
      // Upstream bodies may echo private prompts or credential details.
      throw new ModelProviderError(`Model Provider request failed with HTTP ${response.status}`, {
        code: `http_${response.status}`,
        statusCode: response.status,
        retryable: [408, 409, 425, 429, 500, 502, 503, 504, 507, 529].includes(response.status),
        retryAfterMs: parseRetryAfterHeader(response),
      });
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (cause) {
      throw new ModelProviderError('Model Provider returned a non-JSON response', {
        code: 'malformed_response', malformed: true, retryable: true,
        statusCode: response.status, cause,
      });
    }
    const parsed = extractText(settings.apiFormat, json);
    return {
      result: parseJsonContent(parsed.text),
      usage: parsed.usage,
      settings: {
        provider: settings.provider,
        apiFormat: settings.apiFormat,
        model: settings.model,
      },
      raw: json,
    };
  }
}

export function createConfiguredTextModelProvider(options: ConfiguredTextModelProviderOptions = {}): ConfiguredTextModelProvider {
  return new ConfiguredTextModelProvider(options);
}

/** Existing Review imports remain compatible. */
export { ConfiguredTextModelProvider as ConfiguredModelProvider };
