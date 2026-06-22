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

export async function testAiProvider(id: 'text' | 'vision', imagePath?: string): Promise<TestResult> {
  const setting = await getRawAiSetting(id);
  if (!setting) return { status: 'fail', message: `Provider "${id}" not found` };
  if (!setting.apiKey) return { status: 'fail', message: 'API key is not configured' };

  if (id === 'text') {
    return testTextProvider(setting);
  }
  return testVisionProvider(setting, imagePath);
}

function getAuthHeaders(setting: SettingLike): Record<string, string> {
  // MiMo uses api-key header, not Authorization Bearer
  if (setting.provider === 'mimo') {
    return { 'Content-Type': 'application/json', 'api-key': setting.apiKey };
  }
  // Anthropic-compatible uses api-key header
  if (setting.apiFormat === 'anthropic-compatible') {
    return { 'Content-Type': 'application/json', 'api-key': setting.apiKey };
  }
  // OpenAI-compatible uses Authorization Bearer
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${setting.apiKey}` };
}

async function testTextProvider(setting: SettingLike): Promise<TestResult> {
  const prompt = 'Reply with exactly this JSON: {"status":"ok"}';

  let body: string;
  let headers: Record<string, string>;
  let fetchUrl = setting.baseUrl;

  if (setting.apiFormat === 'google-native') {
    // Google Gemini API format
    fetchUrl = `${setting.baseUrl}/${setting.model}:generateContent?key=${setting.apiKey}`;
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
  let fetchUrl = setting.baseUrl;

  if (setting.apiFormat === 'google-native') {
    // Google Gemini API format
    fetchUrl = `${setting.baseUrl}/${setting.model}:generateContent?key=${setting.apiKey}`;
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
