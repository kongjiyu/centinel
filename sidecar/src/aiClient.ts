import fs from 'fs';
import { getRawAiSetting } from './settings.js';

type TestResult = { status: string; message?: string; raw?: string };

export async function testAiProvider(id: 'text' | 'vision', imagePath?: string): Promise<TestResult> {
  const setting = await getRawAiSetting(id);
  if (!setting) return { status: 'fail', message: `Provider "${id}" not found` };
  if (!setting.apiKey) return { status: 'fail', message: 'API key is not configured' };

  if (id === 'text') {
    return testTextProvider(setting);
  }
  return testVisionProvider(setting, imagePath);
}

async function testTextProvider(setting: { apiKey: string; baseUrl: string; model: string; compatibilityMode: string }): Promise<TestResult> {
  const prompt = 'Reply with exactly this JSON: {"status":"ok"}';

  let body: string;
  let headers: Record<string, string>;

  if (setting.compatibilityMode === 'anthropic') {
    headers = { 'Content-Type': 'application/json', 'api-key': setting.apiKey };
    body = JSON.stringify({
      model: setting.model,
      max_tokens: 128,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
  } else {
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${setting.apiKey}` };
    body = JSON.stringify({
      model: setting.model,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 128,
    });
  }

  return doFetch(setting.baseUrl, headers, body);
}

async function testVisionProvider(setting: { apiKey: string; baseUrl: string; model: string; compatibilityMode: string }, imagePath?: string): Promise<TestResult> {
  let base64 = '';
  if (imagePath && fs.existsSync(imagePath)) {
    const buf = fs.readFileSync(imagePath);
    base64 = buf.toString('base64');
  }

  const prompt = 'Describe this image briefly.';

  let body: string;
  let headers: Record<string, string>;

  if (setting.compatibilityMode === 'anthropic') {
    headers = { 'Content-Type': 'application/json', 'api-key': setting.apiKey };
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
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${setting.apiKey}` };
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
    });
  }

  return doFetch(setting.baseUrl, headers, body);
}

async function doFetch(url: string, headers: Record<string, string>, body: string): Promise<TestResult> {
  try {
    const res = await fetch(url, { method: 'POST', headers, body });
    if (!res.ok) {
      const text = await res.text();
      return { status: 'fail', message: `HTTP ${res.status}: ${res.statusText}`, raw: text };
    }
    const json = await res.json();
    return { status: 'pass', message: 'ok', raw: JSON.stringify(json) };
  } catch (err) {
    return { status: 'fail', message: String(err) };
  }
}
