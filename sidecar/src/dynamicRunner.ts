import { chromium, type Browser, type Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getRawAiSetting } from './settings.js';
import { getDb, saveDb } from './db.js';
import {
  updateDynamicSessionStatus,
  addEvidence,
  type DynamicSession,
  type DynamicSessionStatus,
} from './dynamicSessions.js';
import {
  parseAnthropicToolTurn,
  parseOpenAIToolTurn,
  parseGoogleToolTurn,
  type TokenUsage,
} from './aiClient.js';
import { recordTokenUsage, type CallKind } from './tokenUsage.js';

// ─── Types ───────────────────────────────────────────────────────────────────

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

// Shared shape returned by both callVisionModel and callVisionModelWithRetry.
// `usage` is the parsed provider usage block; undefined when the provider
// omitted it (e.g. some error envelopes). The call site records each call's
// usage for the per-session cost dashboard.
type VisionResult = {
  action?: AgentAction;
  error?: string;
  rawText?: string;
  usage?: TokenUsage;
};

type ActionTraceEntry = {
  step: number;
  attempt: number;
  action: string;
  targetDescription?: string;
  selector?: string;
  x?: number;
  y?: number;
  text?: string;
  reasoning: string;
  result: 'success' | 'failure' | 'blocked';
  error?: string;
  beforeUrl: string;
  afterUrl?: string;
  screenshotPath: string;
  aiResponsePath: string;
  timestamp: string;
};

type DynamicFailureCategory =
  | 'missing_vision_provider'
  | 'vision_api_error'
  | 'invalid_ai_response'
  | 'action_execution_failed'
  | 'navigation_blocked'
  | 'timeout'
  | 'max_steps_reached'
  | 'cancelled'
  | 'unknown';

type DynamicDebugEvent = {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  phase:
    | 'session_start'
    | 'navigation'
    | 'screenshot'
    | 'context_extract'
    | 'ai_request'
    | 'ai_response'
    | 'json_parse'
    | 'action_execute'
    | 'retry'
    | 'token_usage'
    | 'session_end';
  step?: number;
  message: string;
  data?: unknown;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const CANCELLED = new Set<string>();

const RETRY_POLICY = {
  visionCallMaxAttempts: 3,
  visionCallBackoffMs: 1500,
  jsonParseRepairAttempts: 1,
  actionMaxAttempts: 2,
  navigationMaxAttempts: 2,
};

const MAX_RUNTIME_MS = 5 * 60 * 1000;

// ─── Exports ─────────────────────────────────────────────────────────────────

export function cancelSession(sessionId: string) {
  CANCELLED.add(sessionId);
}

// ─── Debug Logger ────────────────────────────────────────────────────────────

class DebugLogger {
  private events: DynamicDebugEvent[] = [];
  private logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  log(level: DynamicDebugEvent['level'], phase: DynamicDebugEvent['phase'], message: string, step?: number, data?: unknown) {
    const event: DynamicDebugEvent = {
      timestamp: new Date().toISOString(),
      level,
      phase,
      step,
      message,
      data,
    };
    this.events.push(event);

    const prefix = `[${level.toUpperCase()}][${phase}]${step !== undefined ? `[step-${step}]` : ''}`;
    if (level === 'error') {
      console.error(`${prefix} ${message}`, data ? JSON.stringify(data).slice(0, 200) : '');
    } else if (level === 'warn') {
      console.warn(`${prefix} ${message}`);
    } else {
      console.log(`${prefix} ${message}`);
    }

    this.flush();
  }

  flush() {
    try {
      fs.writeFileSync(this.logPath, JSON.stringify(this.events, null, 2));
    } catch {
      // Ignore write errors during logging
    }
  }
}

// ─── Failure Classification ──────────────────────────────────────────────────

function classifyFailure(reason: string, status: DynamicSessionStatus): DynamicFailureCategory {
  if (status === 'cancelled') return 'cancelled';
  if (reason.includes('Vision AI') || reason.includes('vision provider')) return 'missing_vision_provider';
  if (reason.includes('HTTP') || reason.includes('API') || reason.includes('network')) return 'vision_api_error';
  if (reason.includes('invalid') || reason.includes('JSON') || reason.includes('parse')) return 'invalid_ai_response';
  if (reason.includes('outside target origin')) return 'navigation_blocked';
  if (reason.includes('timed out') || reason.includes('timeout')) return 'timeout';
  if (reason.includes('max steps') || reason.includes('step limit')) return 'max_steps_reached';
  if (reason.includes('action') || reason.includes('selector') || reason.includes('consecutive')) return 'action_execution_failed';
  return 'unknown';
}

function terminalSummary(
  status: DynamicSessionStatus,
  reason: string,
  step: number,
  maxSteps: number,
  failureCategory?: DynamicFailureCategory
): string {
  switch (status) {
    case 'success':
      return `Test passed: ${reason}`;
    case 'failure':
      return `Test failed at step ${step}: ${reason}`;
    case 'blocked':
      switch (failureCategory) {
        case 'missing_vision_provider':
          return `Blocked: no vision AI provider configured.`;
        case 'vision_api_error':
          return `Blocked: vision model API error at step ${step}. ${reason}`;
        case 'invalid_ai_response':
          return `Blocked: vision model returned unparseable response at step ${step}. ${reason}`;
        case 'navigation_blocked':
          return `Blocked: navigation outside target origin at step ${step}. ${reason}`;
        case 'timeout':
          return `Blocked: session exceeded 5-minute time limit.`;
        case 'max_steps_reached':
          return `Blocked: reached step limit (${maxSteps}). Goal not achieved within allowed steps.`;
        case 'action_execution_failed':
          return `Blocked: action execution failed at step ${step}. ${reason}`;
        default:
          return `Blocked: ${reason}`;
      }
    case 'cancelled':
      return `Cancelled by user at step ${step}.`;
    default:
      return `Session ended with status ${status}.`;
  }
}

// ─── Database Helpers ────────────────────────────────────────────────────────

async function createDynamicFinding(
  projectId: string,
  sessionId: string,
  sessionName: string,
  summary: string,
  failureCategory?: DynamicFailureCategory
): Promise<void> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const category = failureCategory ? `dynamic_test:${failureCategory}` : 'dynamic_test';
  db.run(
    'INSERT INTO findings (id, project_id, session_id, source, severity, title, description, status, created_at, category, evidence_text, recommendation, confidence, from_remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, sessionId, 'dynamic', 'medium', `Dynamic test failed: ${sessionName}`, summary, 'new', now, category, summary, 'Investigate the dynamic test failure and fix the underlying issue.', 'high', 0]
  );
  saveDb();
}

// ─── Main Runner ─────────────────────────────────────────────────────────────

export async function runDynamicSession(
  session: DynamicSession,
  projectWorkspacePath: string
): Promise<void> {
  const sessionDir = path.join(projectWorkspacePath, 'sessions', session.id);
  const screenshotsDir = path.join(sessionDir, 'screenshots');
  const aiDir = path.join(sessionDir, 'ai');
  const logsDir = path.join(sessionDir, 'logs');

  // Ensure directories exist
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(aiDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const debugLog = new DebugLogger(path.join(logsDir, 'session-debug.json'));
  debugLog.log('info', 'session_start', `Starting dynamic session: ${session.name}`, undefined, {
    goal: session.goal,
    targetUrl: session.targetUrl,
    maxSteps: session.maxSteps,
    missionType: session.missionType,
  });

  const visionSetting = await getRawAiSetting('vision');
  if (!visionSetting || !visionSetting.apiKey) {
    const reason = 'Vision AI provider not configured';
    const category: DynamicFailureCategory = 'missing_vision_provider';
    const summary = terminalSummary('blocked', reason, 0, session.maxSteps, category);
    debugLog.log('error', 'session_start', reason);
    await updateDynamicSessionStatus(session.id, 'blocked', summary, reason);
    await createDynamicFinding(session.projectId, session.id, session.name, summary, category);
    return;
  }

  let targetOrigin: string;
  try {
    targetOrigin = new URL(session.targetUrl).origin;
  } catch (err) {
    const reason = `Invalid target URL: ${session.targetUrl}`;
    const category: DynamicFailureCategory = 'navigation_blocked';
    const summary = terminalSummary('blocked', reason, 0, session.maxSteps, category);
    debugLog.log('error', 'session_start', reason);
    await updateDynamicSessionStatus(session.id, 'blocked', summary, reason);
    await createDynamicFinding(session.projectId, session.id, session.name, summary, category);
    return;
  }

  await updateDynamicSessionStatus(session.id, 'running');

  let browser: Browser | null = null;
  const actionTrace: ActionTraceEntry[] = [];
  const consoleLogs: string[] = [];
  const startTime = Date.now();
  let consecutiveFailures = 0;

  try {
    debugLog.log('info', 'navigation', 'Launching browser');
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    page.on('console', msg => {
      const entry = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(entry);
    });

    debugLog.log('info', 'navigation', `Navigating to ${session.targetUrl}`);
    await page.goto(session.targetUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    debugLog.log('info', 'navigation', 'Page loaded successfully');

    let step = 0;
    let status: DynamicSessionStatus = 'running';
    let terminalReason = '';
    let failureCategory: DynamicFailureCategory | undefined;

    while (step < session.maxSteps && status === 'running') {
      // Check cancellation
      if (CANCELLED.has(session.id)) {
        status = 'cancelled';
        terminalReason = 'Cancelled by user';
        failureCategory = 'cancelled';
        debugLog.log('info', 'session_end', 'Session cancelled by user', step);
        break;
      }

      // Check timeout
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        status = 'blocked';
        terminalReason = 'Session timed out after 5 minutes';
        failureCategory = 'timeout';
        debugLog.log('error', 'session_end', 'Session timed out', step);
        break;
      }

      debugLog.log('info', 'screenshot', 'Taking screenshot', step);
      const screenshotPath = path.join(screenshotsDir, `step-${String(step).padStart(3, '0')}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      debugLog.log('info', 'context_extract', 'Extracting page context', step);
      const context = await extractPageContext(page);

      const aiRequestPath = path.join(aiDir, `step-${String(step).padStart(3, '0')}-request.json`);
      const aiResponsePath = path.join(aiDir, `step-${String(step).padStart(3, '0')}-response.json`);

      const prompt = buildPrompt(session.goal, context, actionTrace, step);
      fs.writeFileSync(aiRequestPath, JSON.stringify({ prompt, context, step }, null, 2));
      await addEvidence(session.projectId, session.id, 'ai_request', aiRequestPath, `Step ${step} AI request`);

      // Call vision model with retry
      debugLog.log('info', 'ai_request', 'Calling vision model', step);
      let aiResult = await callVisionModelWithRetry(visionSetting, screenshotPath, prompt, debugLog, step);
      fs.writeFileSync(aiResponsePath, JSON.stringify(aiResult, null, 2));
      await addEvidence(session.projectId, session.id, 'ai_response', aiResponsePath, `Step ${step} AI response`);
      await addEvidence(session.projectId, session.id, 'screenshot', screenshotPath, `Step ${step} screenshot`);

      // Record the vision call's usage (vision scope). Token failures are
      // logged but never thrown — accounting is best-effort and must not
      // break the session if the DB is briefly unavailable.
      if (aiResult.usage) {
        try {
          await recordTokenUsage({
            ...aiResult.usage,
            scope: 'vision',
            callKind: 'dynamic' as CallKind,
            projectId: session.projectId,
            sessionId: session.id,
            stage: `step_${step}`,
            roundNumber: null,
            provider: visionSetting.provider as 'mimo' | 'gemini' | 'custom',
            apiFormat: visionSetting.apiFormat as 'openai-compatible' | 'anthropic-compatible' | 'google-native',
            model: visionSetting.model,
          });
        } catch (err) {
          debugLog.log('warn', 'token_usage', `Failed to record vision usage: ${err}`, step);
        }
      }

      // If still no action after retry, try JSON repair
      if (!aiResult.action && aiResult.rawText) {
        debugLog.log('warn', 'json_parse', 'Attempting JSON repair', step);
        aiResult = await attemptJsonRepair(aiResult.rawText, visionSetting, debugLog, step);
        if (aiResult.action) {
          debugLog.log('info', 'json_parse', 'JSON repair successful', step);
        }
        // attemptJsonRepair uses the text provider — record under the text
        // scope so the dashboard splits vision vs text usage correctly.
        if (aiResult.usage) {
          try {
            const textSetting = await getRawAiSetting('text');
            if (textSetting) {
              await recordTokenUsage({
                ...aiResult.usage,
                scope: 'text',
                callKind: 'dynamic' as CallKind,
                projectId: session.projectId,
                sessionId: session.id,
                stage: `step_${step}_repair`,
                roundNumber: null,
                provider: textSetting.provider,
                apiFormat: textSetting.apiFormat,
                model: textSetting.model,
              });
            }
          } catch (err) {
            debugLog.log('warn', 'token_usage', `Failed to record repair usage: ${err}`, step);
          }
        }
      }

      if (!aiResult.action) {
        const errorMsg = aiResult.error || 'Unknown error';
        failureCategory = classifyFailure(errorMsg, 'blocked');
        debugLog.log('error', 'json_parse', `No valid action: ${errorMsg}`, step);
        actionTrace.push({
          step, attempt: 1, action: 'invalid',
          reasoning: `Model returned invalid response: ${errorMsg}`,
          result: 'blocked', error: errorMsg,
          beforeUrl: context.url, screenshotPath, aiResponsePath,
          timestamp: new Date().toISOString(),
        });
        status = 'blocked';
        terminalReason = `Model returned invalid response: ${errorMsg}`;
        break;
      }

      const action = aiResult.action as AgentAction;
      const beforeUrl = page.url();

      const trace: ActionTraceEntry = {
        step,
        attempt: 1,
        action: action.action,
        targetDescription: 'targetDescription' in action ? action.targetDescription : undefined,
        selector: 'selector' in action ? action.selector : undefined,
        x: 'x' in action ? action.x : undefined,
        y: 'y' in action ? action.y : undefined,
        text: 'text' in action ? action.text : undefined,
        reasoning: action.reasoning,
        result: 'success',
        beforeUrl,
        screenshotPath,
        aiResponsePath,
        timestamp: new Date().toISOString(),
      };

      try {
        // Handle terminal actions
        if (action.action === 'finish_success') {
          trace.result = 'success';
          trace.afterUrl = page.url();
          actionTrace.push(trace);
          saveActionTrace(logsDir, actionTrace);
          status = 'success';
          terminalReason = action.summary;
          debugLog.log('info', 'action_execute', `Goal achieved: ${action.summary}`, step);
          await updateDynamicSessionStatus(session.id, 'success', terminalSummary('success', action.summary, step, session.maxSteps));
          break;
        }

        if (action.action === 'finish_failure') {
          trace.result = 'failure';
          trace.afterUrl = page.url();
          actionTrace.push(trace);
          saveActionTrace(logsDir, actionTrace);
          status = 'failure';
          terminalReason = action.summary;
          failureCategory = 'action_execution_failed';
          debugLog.log('warn', 'action_execute', `Goal failed: ${action.summary}`, step);
          await updateDynamicSessionStatus(session.id, 'failure',
            terminalSummary('failure', action.summary, step, session.maxSteps),
            action.summary
          );
          await createDynamicFinding(session.projectId, session.id, session.name,
            terminalSummary('failure', action.summary, step, session.maxSteps), failureCategory);
          break;
        }

        // Same-origin guard for navigate
        if (action.action === 'navigate') {
          const navOrigin = new URL(action.url).origin;
          if (navOrigin !== targetOrigin) {
            throw new Error(`Navigate blocked: ${action.url} is outside target origin ${targetOrigin}`);
          }
        }

        // Execute action with retry
        debugLog.log('info', 'action_execute', `Executing ${action.action}`, step);
        await executeActionWithRetry(page, action, debugLog, step);
        trace.result = 'success';
        trace.afterUrl = page.url();
        consecutiveFailures = 0;
        debugLog.log('info', 'action_execute', `Action ${action.action} succeeded`, step);
      } catch (err) {
        trace.result = 'failure';
        trace.error = String(err);
        trace.afterUrl = page.url();
        consecutiveFailures++;
        debugLog.log('error', 'action_execute', `Action failed: ${String(err)}`, step, { consecutiveFailures });
        if (consecutiveFailures >= 3) {
          actionTrace.push(trace);
          saveActionTrace(logsDir, actionTrace);
          status = 'blocked';
          terminalReason = `3 consecutive action failures: ${String(err)}`;
          failureCategory = 'action_execution_failed';
          break;
        }
      }

      actionTrace.push(trace);
      saveActionTrace(logsDir, actionTrace);

      await page.waitForTimeout(1000);
      step++;
    }

    // Handle loop exit without terminal status
    if (status === 'running') {
      if (step >= session.maxSteps) {
        status = 'blocked';
        terminalReason = `Reached max steps (${session.maxSteps})`;
        failureCategory = 'max_steps_reached';
      }
    }

    // Final screenshot
    debugLog.log('info', 'screenshot', 'Taking final screenshot');
    const finalPath = path.join(screenshotsDir, 'final.png');
    await page.screenshot({ path: finalPath, fullPage: false });

    // Save console logs
    fs.writeFileSync(path.join(logsDir, 'console.json'), JSON.stringify(consoleLogs, null, 2));

    // Build and save summary
    const finalSummary = terminalSummary(status, terminalReason, step, session.maxSteps, failureCategory);
    const summaryMd = buildSummaryMd(session, actionTrace, status, finalSummary, failureCategory);
    fs.writeFileSync(path.join(sessionDir, 'summary.md'), summaryMd);

    // Update status if still running
    if (status !== 'success' && status !== 'failure' && status !== 'cancelled') {
      await updateDynamicSessionStatus(session.id, status, finalSummary, terminalReason);
    }
    if (status === 'blocked' || status === 'failure') {
      await createDynamicFinding(session.projectId, session.id, session.name, finalSummary, failureCategory);
    }

    // Add final evidence entries
    await addEvidence(session.projectId, session.id, 'screenshot', finalPath, 'Final screenshot');
    await addEvidence(session.projectId, session.id, 'action_trace', path.join(logsDir, 'action-trace.json'), 'Action trace');
    await addEvidence(session.projectId, session.id, 'console_log', path.join(logsDir, 'console.json'), 'Console logs');
    await addEvidence(session.projectId, session.id, 'session_summary', path.join(sessionDir, 'summary.md'), 'Session summary');
    await addEvidence(session.projectId, session.id, 'debug_log', path.join(logsDir, 'session-debug.json'), 'Debug log');

    debugLog.log('info', 'session_end', `Session ended: ${status}`, step, { failureCategory, terminalReason });

  } catch (err) {
    const reason = String(err);
    const category: DynamicFailureCategory = 'unknown';
    const summary = terminalSummary('failure', reason, 0, session.maxSteps, category);
    debugLog.log('error', 'session_end', `Session crashed: ${reason}`);
    await updateDynamicSessionStatus(session.id, 'failure', summary, reason);
    await createDynamicFinding(session.projectId, session.id, session.name, summary, category);
  } finally {
    CANCELLED.delete(session.id);
    if (browser) await browser.close();
  }
}

// ─── Retry Logic ─────────────────────────────────────────────────────────────

async function callVisionModelWithRetry(
  setting: { apiKey: string; baseUrl: string; model: string; provider: string; apiFormat: string },
  screenshotPath: string,
  prompt: string,
  debugLog: DebugLogger,
  step: number
): Promise<VisionResult> {
  let lastError = '';

  for (let attempt = 1; attempt <= RETRY_POLICY.visionCallMaxAttempts; attempt++) {
    debugLog.log('info', 'ai_request', `Vision call attempt ${attempt}/${RETRY_POLICY.visionCallMaxAttempts}`, step);

    const result = await callVisionModel(setting, screenshotPath, prompt);

    if (result.action) {
      return result;
    }

    lastError = result.error || 'Unknown error';
    debugLog.log('warn', 'retry', `Attempt ${attempt} failed: ${lastError}`, step);

    if (attempt < RETRY_POLICY.visionCallMaxAttempts) {
      const backoff = RETRY_POLICY.visionCallBackoffMs * attempt;
      debugLog.log('info', 'retry', `Waiting ${backoff}ms before retry`, step);
      await new Promise(r => setTimeout(r, backoff));
    }

    // Return raw text for potential repair
    if (result.rawText) {
      return { ...result, rawText: result.rawText };
    }
  }

  return { error: `Failed after ${RETRY_POLICY.visionCallMaxAttempts} attempts: ${lastError}` };
}

async function attemptJsonRepair(
  rawText: string,
  setting: { apiKey: string; baseUrl: string; model: string; provider: string; apiFormat: string },
  debugLog: DebugLogger,
  step: number
): Promise<VisionResult> {
  const repairPrompt = `Convert the following response into exactly one valid JSON action object.
Do not add explanation. Only output the JSON object.

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

Response to repair:
${rawText.slice(0, 2000)}`;

  // Use text setting for repair (cheaper than vision)
  const textSetting = await getRawAiSetting('text');
  if (!textSetting || !textSetting.apiKey) {
    debugLog.log('warn', 'json_parse', 'No text provider for JSON repair', step);
    return { error: 'No text provider available for JSON repair' };
  }

  debugLog.log('info', 'json_parse', 'Calling text model for JSON repair', step);
  const result = await callTextModel(textSetting, repairPrompt);

  if (result.action) {
    return result;
  }

  debugLog.log('warn', 'json_parse', 'JSON repair failed', step, { error: result.error });
  return { error: `JSON repair failed: ${result.error}` };
}

async function executeActionWithRetry(
  page: Page,
  action: AgentAction,
  debugLog: DebugLogger,
  step: number
): Promise<void> {
  let lastError = '';

  for (let attempt = 1; attempt <= RETRY_POLICY.actionMaxAttempts; attempt++) {
    try {
      debugLog.log('info', 'action_execute', `Action attempt ${attempt}/${RETRY_POLICY.actionMaxAttempts}`, step);
      await executeAction(page, action);
      return;
    } catch (err) {
      lastError = String(err);
      debugLog.log('warn', 'retry', `Action attempt ${attempt} failed: ${lastError}`, step);

      if (attempt < RETRY_POLICY.actionMaxAttempts) {
        // Wait a bit and try again
        await page.waitForTimeout(500);
      }
    }
  }

  throw new Error(`Action failed after ${RETRY_POLICY.actionMaxAttempts} attempts: ${lastError}`);
}

// ─── Model Callers ───────────────────────────────────────────────────────────

async function callTextModel(
  setting: { apiKey: string; baseUrl: string; model: string; provider: string; apiFormat: string },
  prompt: string
): Promise<VisionResult> {
  let body: string;
  let headers: Record<string, string>;
  let fetchUrl = setting.baseUrl;

  function getAuthHeaders(): Record<string, string> {
    if (setting.provider === 'mimo') {
      return { 'Content-Type': 'application/json', 'api-key': setting.apiKey };
    }
    if (setting.apiFormat === 'anthropic-compatible') {
      return { 'Content-Type': 'application/json', 'api-key': setting.apiKey };
    }
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${setting.apiKey}` };
  }

  if (setting.apiFormat === 'google-native') {
    fetchUrl = `${setting.baseUrl}/${setting.model}:generateContent?key=${setting.apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1024 },
    });
  } else if (setting.apiFormat === 'anthropic-compatible') {
    headers = getAuthHeaders();
    body = JSON.stringify({
      model: setting.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
  } else {
    headers = getAuthHeaders();
    body = JSON.stringify({
      model: setting.model,
      max_completion_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
      thinking: { type: 'disabled' },
    });
  }

  try {
    const res = await fetch(fetchUrl, { method: 'POST', headers, body });
    if (!res.ok) {
      const text = await res.text();
      return { error: `HTTP ${res.status}: ${text}` };
    }

    const json = await res.json() as Record<string, unknown>;
    let text = '';

    if (setting.apiFormat === 'google-native') {
      const candidates = json.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
      text = candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    } else if (setting.apiFormat === 'anthropic-compatible') {
      const content = json.content as Array<{ type: string; text?: string }> | undefined;
      text = content?.find(c => c.type === 'text')?.text ?? '';
    } else {
      const choices = json.choices as Array<{ message?: { content?: string } }> | undefined;
      text = choices?.[0]?.message?.content ?? '';
    }

    // Extract usage via the shared parsers. Returned on success and on
    // "empty response" so the call site can always account for the round.
    const usage = setting.apiFormat === 'anthropic-compatible'
      ? parseAnthropicToolTurn(json).usage
      : setting.apiFormat === 'openai-compatible'
      ? parseOpenAIToolTurn(json).usage
      : parseGoogleToolTurn(json).usage;

    if (!text) {
      return { error: 'Empty response', usage };
    }

    return { ...parseActionFromText(text), usage };
  } catch (err) {
    return { error: String(err) };
  }
}

async function callVisionModel(
  setting: { apiKey: string; baseUrl: string; model: string; provider: string; apiFormat: string },
  screenshotPath: string,
  prompt: string
): Promise<VisionResult> {
  const imageBuf = fs.readFileSync(screenshotPath);
  const base64 = imageBuf.toString('base64');

  let body: string;
  let headers: Record<string, string>;
  let fetchUrl = setting.baseUrl;

  function getAuthHeaders(): Record<string, string> {
    if (setting.provider === 'mimo') {
      return { 'Content-Type': 'application/json', 'api-key': setting.apiKey };
    }
    if (setting.apiFormat === 'anthropic-compatible') {
      return { 'Content-Type': 'application/json', 'api-key': setting.apiKey };
    }
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${setting.apiKey}` };
  }

  if (setting.apiFormat === 'google-native') {
    fetchUrl = `${setting.baseUrl}/${setting.model}:generateContent?key=${setting.apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType: 'image/png', data: base64 } },
          { text: prompt },
        ],
      }],
      generationConfig: { maxOutputTokens: 1024 },
    });
  } else if (setting.apiFormat === 'anthropic-compatible') {
    headers = getAuthHeaders();
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
    headers = getAuthHeaders();
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
      thinking: { type: 'disabled' },
    });
  }

  try {
    const res = await fetch(fetchUrl, { method: 'POST', headers, body });
    if (!res.ok) {
      const text = await res.text();
      return { error: `HTTP ${res.status}: ${text}` };
    }

    const json = await res.json() as Record<string, unknown>;

    let text = '';
    if (setting.apiFormat === 'google-native') {
      const candidates = json.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
      text = candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    } else if (setting.apiFormat === 'anthropic-compatible') {
      const content = json.content as Array<{ type: string; text?: string }> | undefined;
      text = content?.find(c => c.type === 'text')?.text ?? '';
    } else {
      const choices = json.choices as Array<{ message?: { content?: string } }> | undefined;
      text = choices?.[0]?.message?.content ?? '';
    }

    // Extract usage via the shared parsers so token accounting is consistent
    // with the static-review path. The returned usage is undefined when the
    // provider omitted the block — that case is silently dropped from
    // accounting (we don't want to inflate totals with zero rows).
    const usage = setting.apiFormat === 'anthropic-compatible'
      ? parseAnthropicToolTurn(json).usage
      : setting.apiFormat === 'openai-compatible'
      ? parseOpenAIToolTurn(json).usage
      : parseGoogleToolTurn(json).usage;

    if (!text) {
      return { error: 'Model returned empty response', rawText: '', usage };
    }

    const result = parseActionFromText(text);
    return { ...result, rawText: text, usage };
  } catch (err) {
    return { error: String(err) };
  }
}

// ─── JSON Parsing ────────────────────────────────────────────────────────────

function parseActionFromText(text: string): { action?: AgentAction; error?: string } {
  // Strip markdown code blocks if present
  let cleanText = text.trim();
  const codeBlockMatch = cleanText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    cleanText = codeBlockMatch[1].trim();
  }

  // Try multiple parsing strategies
  const strategies = [
    // Direct parse
    () => {
      if (cleanText.startsWith('{')) {
        return JSON.parse(cleanText);
      }
      return null;
    },
    // Balanced braces
    () => {
      const match = cleanText.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
      return match ? JSON.parse(match[0]) : null;
    },
    // Greedy match
    () => {
      const match = cleanText.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : null;
    },
  ];

  for (const strategy of strategies) {
    try {
      const parsed = strategy();
      if (parsed && typeof parsed === 'object' && 'action' in parsed) {
        return { action: parsed as AgentAction };
      }
    } catch {
      // Try next strategy
    }
  }

  return { error: `No valid JSON action found in response: ${text.slice(0, 200)}` };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function saveActionTrace(logsDir: string, trace: ActionTraceEntry[]) {
  fs.writeFileSync(path.join(logsDir, 'action-trace.json'), JSON.stringify(trace, null, 2));
}

async function extractPageContext(page: Page): Promise<{
  url: string;
  title: string;
  visibleText: string;
  elements: string[];
}> {
  const url = page.url();
  const title = await page.title();

  const visibleText = await page.evaluate(() => {
    const body = document.body;
    if (!body) return '';
    return body.innerText.slice(0, 2000);
  });

  const elements = await page.evaluate(() => {
    const els = document.querySelectorAll('a, button, input, textarea, select, [role="button"], [onclick], [tabindex]');
    const results: string[] = [];
    for (let i = 0; i < Math.min(els.length, 30); i++) {
      const el = els[i] as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const text = (el.textContent || '').trim().slice(0, 60);
      const type = el.getAttribute('type') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const href = el.getAttribute('href') || '';
      const role = el.getAttribute('role') || '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      const ariaDescribedBy = el.getAttribute('aria-describedby') || '';
      const name = el.getAttribute('name') || '';
      const id = el.getAttribute('id') || '';
      const titleAttr = el.getAttribute('title') || '';

      // Build a rich description
      const attrs: string[] = [];
      if (type) attrs.push(`type="${type}"`);
      if (placeholder) attrs.push(`placeholder="${placeholder}"`);
      if (role) attrs.push(`role="${role}"`);
      if (ariaLabel) attrs.push(`aria-label="${ariaLabel}"`);
      if (name) attrs.push(`name="${name}"`);
      if (id) attrs.push(`id="${id}"`);
      if (titleAttr) attrs.push(`title="${titleAttr}"`);

      const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
      const textStr = text ? ` ${text}` : '';
      const hrefStr = href ? ` [href]` : '';

      results.push(`<${tag}${attrStr}>${textStr}${hrefStr}`);
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

function buildSummaryMd(
  session: DynamicSession,
  trace: ActionTraceEntry[],
  status: DynamicSessionStatus,
  finalSummary: string,
  failureCategory?: DynamicFailureCategory
): string {
  const lines = [
    `# Dynamic Test Summary`,
    ``,
    `- **Status:** ${status}`,
    `- **Goal:** ${session.goal}`,
    `- **Target:** ${session.targetUrl}`,
    `- **Steps taken:** ${trace.length}`,
    failureCategory ? `- **Failure Category:** ${failureCategory}` : '',
    ``,
    `## Result`,
    ``,
    finalSummary,
    ``,
    `## Actions`,
    ``,
  ];

  for (const t of trace) {
    const target = t.targetDescription ? ` → ${t.targetDescription}` : '';
    const detail = t.text ? ` "${t.text}"` : '';
    const attempt = t.attempt > 1 ? ` (attempt ${t.attempt})` : '';
    lines.push(`${t.step}. **${t.action}**${target}${detail}${attempt} (${t.result}) — ${t.reasoning}`);
  }

  return lines.filter(Boolean).join('\n');
}
