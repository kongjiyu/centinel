import { getRawAiSetting } from './settings.js';
import { parseAnthropicToolTurn, parseOpenAIToolTurn, parseGoogleToolTurn, getAuthHeaders, buildRequestUrl, type ToolSchema } from './aiClient.js';
import { TOOL_SCHEMAS } from './tools.js';

async function probe() {
  const setting = await getRawAiSetting('text');
  if (!setting) {
    console.error('FAIL: no text AI provider configured');
    process.exit(1);
  }
  if (!setting.apiKey) {
    console.error('FAIL: API key not configured');
    process.exit(1);
  }

  const toolSubset: ToolSchema[] = [TOOL_SCHEMAS[0]]; // fetch_file only

  // Build the request body inline — all three shapes as JSON literals.
  // Do NOT import buildAnthropicToolRequest (owned by aiClient.ts/Task 4).
  const body = setting.apiFormat === 'anthropic-compatible'
    ? {
        model: setting.model,
        messages: [
          { role: 'user', content: 'You are a probe. Call the fetch_file tool with any path.' },
          { role: 'user', content: 'Please call the tool now.' },
        ],
        tools: [
          {
            name: TOOL_SCHEMAS[0].name,
            description: TOOL_SCHEMAS[0].description,
            input_schema: TOOL_SCHEMAS[0].input_schema,
          },
        ],
        max_tokens: 128,
      }
    : setting.apiFormat === 'openai-compatible'
    ? {
        model: setting.model,
        messages: [
          { role: 'system', content: 'You are a probe. Call the fetch_file tool with any path.' },
          { role: 'user', content: 'Please call the tool now.' },
        ],
        tools: [{ type: 'function', function: { name: 'fetch_file', description: TOOL_SCHEMAS[0].description, parameters: TOOL_SCHEMAS[0].input_schema } }],
        max_completion_tokens: 128,
        thinking: { type: 'disabled' },
      }
    : {
        systemInstruction: { parts: [{ text: 'You are a probe. Call the fetch_file tool with any path.' }] },
        contents: [{ role: 'user', parts: [{ text: 'Please call the tool now.' }] }],
        tools: [{ functionDeclarations: [{ name: 'fetch_file', description: TOOL_SCHEMAS[0].description, parameters: TOOL_SCHEMAS[0].input_schema }] }],
        generationConfig: { maxOutputTokens: 128 },
      };

  const headers = getAuthHeaders({
    apiKey: setting.apiKey, baseUrl: setting.baseUrl, model: setting.model,
    provider: setting.provider, apiFormat: setting.apiFormat,
  });
  const url = buildRequestUrl({
    apiKey: setting.apiKey, baseUrl: setting.baseUrl, model: setting.model,
    provider: setting.provider, apiFormat: setting.apiFormat,
  });

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    console.error(`FAIL: HTTP ${res.status} — ${await res.text()}`);
    process.exit(1);
  }
  const json = await res.json();

  // Parse with the appropriate parser
  const turn = setting.apiFormat === 'anthropic-compatible'
    ? parseAnthropicToolTurn(json)
    : setting.apiFormat === 'openai-compatible'
    ? parseOpenAIToolTurn(json)
    : parseGoogleToolTurn(json);

  console.log('Provider:', setting.provider);
  console.log('Model:', setting.model);
  console.log('API format:', setting.apiFormat);
  console.log('Stop reason:', turn.stopReason);
  console.log('Content:', turn.content);
  console.log('Tool calls:', JSON.stringify(turn.toolCalls, null, 2));

  if (turn.toolCalls.length === 0) {
    console.error('\nFAIL: model did NOT return a tool call. The configured model/provider does not support tool use, or it requires a different invocation. Do NOT enable the tool path for this provider until this probe returns a tool call.');
    process.exit(1);
  }
  console.log('\nPASS: model returned a tool call. Safe to enable the tool path for this provider.');
}

probe().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
