import { chromium, type Browser, type Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { getRawAiSetting } from './settings.js';
import {
  updateDynamicSessionStatus,
  addEvidence,
  type DynamicSession,
  type DynamicSessionStatus,
} from './dynamicSessions.js';

type AgentAction =
  | { action: 'click'; targetDescription: string; selector?: string; x?: number; y?: number; reasoning: string }
  | { action: 'type'; targetDescription: string; text: string; selector?: string; x?: number; y?: number; reasoning: string }
  | { action: 'press_key'; key: string; reasoning: string }
  | { action: 'scroll'; direction: 'up' | 'down'; amount: 'small' | 'medium' | 'large'; reasoning: string }
  | { action: 'wait'; milliseconds: number; reasoning: string }
  | { action: 'navigate'; url: string; reasoning: string }
  | { action: 'assert_visible'; text: string; reasoning: string }
  | { action: 'finish_success'; summary: string; reasoning: string }
  | { action: 'finish_failure'; summary: string; reasoning: string };

type ActionTraceEntry = {
  step: number;
  action: string;
  target?: string;
  text?: string;
  reasoning: string;
  result: 'success' | 'failure' | 'blocked';
  error?: string;
  timestamp: string;
};

const CANCELLED = new Set<string>();

export function cancelSession(sessionId: string) {
  CANCELLED.add(sessionId);
}

export async function runDynamicSession(
  session: DynamicSession,
  projectWorkspacePath: string
): Promise<void> {
  const sessionDir = path.join(projectWorkspacePath, 'sessions', session.id);
  const screenshotsDir = path.join(sessionDir, 'screenshots');
  const aiDir = path.join(sessionDir, 'ai');
  const logsDir = path.join(sessionDir, 'logs');

  const visionSetting = await getRawAiSetting('vision');
  if (!visionSetting || !visionSetting.apiKey) {
    await updateDynamicSessionStatus(session.id, 'blocked', '', 'Vision AI provider not configured');
    return;
  }

  await updateDynamicSessionStatus(session.id, 'running');

  let browser: Browser | null = null;
  const actionTrace: ActionTraceEntry[] = [];
  const consoleLogs: string[] = [];
  const startTime = Date.now();
  const maxRuntime = 5 * 60 * 1000; // 5 minutes

  try {
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    // Collect console logs
    page.on('console', msg => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    // Navigate to target
    await page.goto(session.targetUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    let step = 0;
    let status: DynamicSessionStatus = 'running';

    while (step < session.maxSteps && status === 'running') {
      // Check cancellation
      if (CANCELLED.has(session.id)) {
        status = 'cancelled';
        break;
      }

      // Check timeout
      if (Date.now() - startTime > maxRuntime) {
        status = 'blocked';
        await updateDynamicSessionStatus(session.id, 'blocked', '', 'Session timed out after 5 minutes');
        break;
      }

      // Capture screenshot
      const screenshotPath = path.join(screenshotsDir, `step-${String(step).padStart(3, '0')}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      // Extract page context
      const context = await extractPageContext(page);

      // Ask vision model for action
      const aiRequestPath = path.join(aiDir, `step-${String(step).padStart(3, '0')}-request.json`);
      const aiResponsePath = path.join(aiDir, `step-${String(step).padStart(3, '0')}-response.json`);

      const prompt = buildPrompt(session.goal, context, actionTrace, step);

      // Save AI request
      fs.writeFileSync(aiRequestPath, JSON.stringify({ prompt, context, step }, null, 2));

      const aiResult = await callVisionModel(visionSetting, screenshotPath, prompt);

      // Save AI response
      fs.writeFileSync(aiResponsePath, JSON.stringify(aiResult, null, 2));

      await addEvidence(session.id, session.id, 'ai_response', aiResponsePath, `Step ${step} AI response`);

      if (!aiResult.action) {
        // Invalid response
        actionTrace.push({
          step, action: 'invalid', reasoning: 'Model returned invalid JSON',
          result: 'blocked', error: aiResult.error, timestamp: new Date().toISOString(),
        });
        status = 'blocked';
        await updateDynamicSessionStatus(session.id, 'blocked', '', 'Model returned invalid response');
        break;
      }

      const action = aiResult.action as AgentAction;

      // Execute action
      const trace: ActionTraceEntry = {
        step,
        action: action.action,
        reasoning: action.reasoning,
        result: 'success',
        timestamp: new Date().toISOString(),
      };

      try {
        if (action.action === 'finish_success') {
          trace.result = 'success';
          actionTrace.push(trace);
          status = 'success';
          await updateDynamicSessionStatus(session.id, 'success', action.summary);
          break;
        }

        if (action.action === 'finish_failure') {
          trace.result = 'failure';
          actionTrace.push(trace);
          status = 'failure';
          await updateDynamicSessionStatus(session.id, 'failure', action.summary, action.summary);
          break;
        }

        await executeAction(page, action);
        trace.result = 'success';
      } catch (err) {
        trace.result = 'failure';
        trace.error = String(err);
        // Don't break on single action failure - let model try recovery
      }

      actionTrace.push(trace);

      // Save action trace
      fs.writeFileSync(path.join(logsDir, 'action-trace.json'), JSON.stringify(actionTrace, null, 2));

      // Wait a bit between actions
      await page.waitForTimeout(1000);
      step++;
    }

    // If we exited the loop without a terminal status
    if (status === 'running') {
      if (step >= session.maxSteps) {
        await updateDynamicSessionStatus(session.id, 'blocked', '', `Reached max steps (${session.maxSteps})`);
      }
    }

    // Save final screenshot
    const finalPath = path.join(screenshotsDir, 'final.png');
    await page.screenshot({ path: finalPath, fullPage: false });

    // Save console logs
    fs.writeFileSync(path.join(logsDir, 'console.json'), JSON.stringify(consoleLogs, null, 2));

    // Save action trace
    fs.writeFileSync(path.join(logsDir, 'action-trace.json'), JSON.stringify(actionTrace, null, 2));

    // Save summary
    const summaryMd = buildSummaryMd(session, actionTrace, status);
    fs.writeFileSync(path.join(sessionDir, 'summary.md'), summaryMd);

    // Add evidence entries
    await addEvidence(session.id, session.id, 'screenshot', finalPath, 'Final screenshot');
    await addEvidence(session.id, session.id, 'action_trace', path.join(logsDir, 'action-trace.json'), 'Action trace');
    await addEvidence(session.id, session.id, 'console_log', path.join(logsDir, 'console.json'), 'Console logs');
    await addEvidence(session.id, session.id, 'session_summary', path.join(sessionDir, 'summary.md'), 'Session summary');

  } catch (err) {
    await updateDynamicSessionStatus(session.id, 'failure', '', String(err));
  } finally {
    CANCELLED.delete(session.id);
    if (browser) await browser.close();
  }
}

async function extractPageContext(page: Page): Promise<{
  url: string;
  title: string;
  visibleText: string;
  elements: string[];
}> {
  const url = page.url();
  const title = await page.title();

  // Get visible text (truncated)
  const visibleText = await page.evaluate(() => {
    const body = document.body;
    if (!body) return '';
    return body.innerText.slice(0, 2000);
  });

  // Get interactive elements
  const elements = await page.evaluate(() => {
    const els = document.querySelectorAll('a, button, input, textarea, select, [role="button"], [onclick]');
    const results: string[] = [];
    for (let i = 0; i < Math.min(els.length, 30); i++) {
      const el = els[i] as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const text = (el.textContent || '').trim().slice(0, 60);
      const type = el.getAttribute('type') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const href = el.getAttribute('href') || '';
      const role = el.getAttribute('role') || '';
      results.push(`<${tag}${type ? ` type="${type}"` : ''}${placeholder ? ` placeholder="${placeholder}"` : ''}${role ? ` role="${role}"` : ''}> ${text}${href ? ` [href]` : ''}`);
    }
    return results;
  });

  return { url, title, visibleText, elements };
}

function buildPrompt(
  goal: string,
  context: { url: string; title: string; visibleText: string; elements: string[] },
  trace: ActionTraceEntry[],
  step: number
): string {
  const prevActions = trace.slice(-5).map(t => `Step ${t.step}: ${t.action} (${t.result}) - ${t.reasoning}`).join('\n');

  return `You are a QA testing agent. Your goal: ${goal}

Current page: ${context.url}
Title: ${context.title}

Visible elements:
${context.elements.map((e, i) => `${i}: ${e}`).join('\n')}

Page text (truncated):
${context.visibleText.slice(0, 1000)}

${prevActions ? `Previous actions:\n${prevActions}\n` : ''}
Step: ${step}

Respond with exactly ONE JSON action. No markdown, no explanation outside JSON.

Available actions:
- click: {"action":"click","targetDescription":"...","selector":"...","reasoning":"..."}
- type: {"action":"type","targetDescription":"...","text":"...","selector":"...","reasoning":"..."}
- press_key: {"action":"press_key","key":"Enter","reasoning":"..."}
- scroll: {"action":"scroll","direction":"down","amount":"medium","reasoning":"..."}
- wait: {"action":"wait","milliseconds":2000,"reasoning":"..."}
- navigate: {"action":"navigate","url":"...","reasoning":"..."}
- assert_visible: {"action":"assert_visible","text":"...","reasoning":"..."}
- finish_success: {"action":"finish_success","summary":"...","reasoning":"..."}
- finish_failure: {"action":"finish_failure","summary":"...","reasoning":"..."}

Rules:
- Use selector when possible, fall back to x/y coordinates only if needed.
- Never execute destructive actions (delete, payment, file upload).
- Stay on the same origin unless following a login/demo redirect.
- Finish when the goal is achieved or clearly impossible.
- Respond with ONLY the JSON object, nothing else.`;
}

async function callVisionModel(
  setting: { apiKey: string; baseUrl: string; model: string; compatibilityMode: string },
  screenshotPath: string,
  prompt: string
): Promise<{ action?: AgentAction; error?: string }> {
  const imageBuf = fs.readFileSync(screenshotPath);
  const base64 = imageBuf.toString('base64');

  let body: string;
  let headers: Record<string, string>;

  if (setting.compatibilityMode === 'anthropic') {
    headers = { 'Content-Type': 'application/json', 'api-key': setting.apiKey };
    body = JSON.stringify({
      model: setting.model,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
          { type: 'text', text: prompt },
        ],
      }],
    });
  } else {
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${setting.apiKey}` };
    body = JSON.stringify({
      model: setting.model,
      max_completion_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
          { type: 'text', text: prompt },
        ],
      }],
    });
  }

  try {
    const res = await fetch(setting.baseUrl, { method: 'POST', headers, body });
    if (!res.ok) {
      const text = await res.text();
      return { error: `HTTP ${res.status}: ${text}` };
    }

    const json = await res.json() as Record<string, unknown>;

    // Extract text from response
    let text = '';
    if (setting.compatibilityMode === 'anthropic') {
      const content = json.content as Array<{ type: string; text?: string }> | undefined;
      text = content?.find(c => c.type === 'text')?.text ?? '';
    } else {
      const choices = json.choices as Array<{ message?: { content?: string } }> | undefined;
      text = choices?.[0]?.message?.content ?? '';
    }

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { error: 'No JSON found in response', action: undefined };
    }

    const action = JSON.parse(jsonMatch[0]) as AgentAction;
    return { action };
  } catch (err) {
    return { error: String(err) };
  }
}

async function executeAction(page: Page, action: AgentAction): Promise<void> {
  switch (action.action) {
    case 'click': {
      if (action.selector) {
        try {
          await page.click(action.selector, { timeout: 5000 });
          return;
        } catch { /* fall through to coordinates */ }
      }
      if (action.x !== undefined && action.y !== undefined) {
        await page.mouse.click(action.x, action.y);
        return;
      }
      throw new Error('No selector or coordinates for click');
    }

    case 'type': {
      if (action.selector) {
        try {
          await page.fill(action.selector, action.text, { timeout: 5000 });
          return;
        } catch { /* fall through */ }
      }
      if (action.x !== undefined && action.y !== undefined) {
        await page.mouse.click(action.x, action.y);
        await page.keyboard.type(action.text);
        return;
      }
      throw new Error('No selector or coordinates for type');
    }

    case 'press_key':
      await page.keyboard.press(action.key);
      break;

    case 'scroll': {
      const amounts = { small: 200, medium: 500, large: 1000 };
      const delta = amounts[action.amount] || 500;
      await page.mouse.wheel(0, action.direction === 'down' ? delta : -delta);
      break;
    }

    case 'wait':
      await page.waitForTimeout(action.milliseconds);
      break;

    case 'navigate':
      await page.goto(action.url, { timeout: 30000, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      break;

    case 'assert_visible': {
      const visible = await page.evaluate((text) => {
        return document.body?.innerText.includes(text) ?? false;
      }, action.text);
      if (!visible) throw new Error(`Text "${action.text}" not visible on page`);
      break;
    }

    default:
      throw new Error(`Unknown action: ${(action as { action: string }).action}`);
  }
}

function buildSummaryMd(session: DynamicSession, trace: ActionTraceEntry[], status: DynamicSessionStatus): string {
  const lines = [
    `# Dynamic Test Summary`,
    ``,
    `- **Status:** ${status}`,
    `- **Goal:** ${session.goal}`,
    `- **Target:** ${session.targetUrl}`,
    `- **Steps taken:** ${trace.length}`,
    ``,
    `## Actions`,
    ``,
  ];

  for (const t of trace) {
    lines.push(`${t.step}. **${t.action}** (${t.result}) — ${t.reasoning}`);
  }

  return lines.join('\n');
}
