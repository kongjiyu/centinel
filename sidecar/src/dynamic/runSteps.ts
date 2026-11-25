import path from 'node:path';
import { readBoundedArtifactSlot } from './sharedEvidence/files.js';
import { redactObservation } from './browser/privacy.js';
import { DynamicContractError, type DynamicRun } from './types.js';
import type { DynamicService } from './service.js';

/**
 * A browser run's step timeline (19 Nov 2026, user request: show which step a failed test failed at).
 * It is read from the run's saved action trace on this device. Only public fields leave the sidecar:
 * the action kind, its target label, the page path, the outcome and a short error. Typed text is
 * reported only as a length, and the model's own reasoning is never returned. A step's screenshot is
 * served by step number; clients never name files.
 */
export type RunStep = {
  step: number;
  action: string;
  target: string | null;
  page: string | null;
  result: 'success' | 'failure' | 'blocked';
  error: string | null;
  typedLength: number | null;
  screenshot: boolean;
};
/** finalScreenshot: the page as the independent check saw it (criterion-page.png). */
export type RunTimeline = { runId: string; state: DynamicRun['state']; verdict: DynamicRun['verdict']; reason: string | null; steps: RunStep[]; truncated: boolean; finalScreenshot: boolean };

type TraceRow = {
  step?: unknown; action?: unknown; targetDescription?: unknown; selector?: unknown; text?: unknown; result?: unknown;
  error?: unknown; beforeUrl?: unknown; afterUrl?: unknown; replayScreenshotPath?: unknown; screenshotPath?: unknown;
};
const MAX_STEPS = 60;
const SCREENSHOT_NAME = /^[a-z0-9-]+\.png$/;
const FINAL_SCREENSHOT = 'criterion-page.png';

function pagePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try { const url = new URL(value); return (url.pathname || '/').slice(0, 300); } catch { return null; }
}

/** Observation references ("e6") mean nothing to a reader, so they are not shown as a target. */
function label(value: unknown, secrets: readonly string[]): string | null {
  const text = short(value, 160, secrets);
  return text && !/^e\d{1,4}$/.test(text) ? text : null;
}

function short(value: unknown, limit: number, secrets: readonly string[]): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return redactObservation(value.replace(/\s+/g, ' ').trim(), secrets).slice(0, limit);
}

/** The screenshot file of a trace row, only when it is a plain file name inside the run's screenshots folder. */
function screenshotName(row: TraceRow): string | null {
  for (const candidate of [row.replayScreenshotPath, row.screenshotPath]) {
    if (typeof candidate !== 'string' || !candidate) continue;
    const name = path.basename(candidate);
    if (SCREENSHOT_NAME.test(name) && path.basename(path.dirname(candidate)) === 'screenshots') return name;
  }
  return null;
}

function readTrace(workspace: string, run: DynamicRun): TraceRow[] {
  let raw: Buffer;
  try { raw = readBoundedArtifactSlot(workspace, run, 'action-trace.json'); } catch { return []; }
  try { const value = JSON.parse(raw.toString('utf8')); return Array.isArray(value) ? value as TraceRow[] : []; } catch { return []; }
}

export function runTimeline(workspace: string, run: DynamicRun, secrets: readonly string[] = []): RunTimeline {
  const rows = readTrace(workspace, run);
  const steps: RunStep[] = rows.slice(0, MAX_STEPS).map((row, index) => ({
    step: Number.isInteger(row.step) ? row.step as number : index + 1,
    action: typeof row.action === 'string' ? row.action.slice(0, 40) : 'unknown',
    target: label(row.targetDescription, secrets) ?? label(row.selector, secrets),
    page: pagePath(row.beforeUrl),
    result: row.result === 'failure' || row.result === 'blocked' ? row.result : 'success',
    error: short(row.error, 300, secrets),
    typedLength: typeof row.text === 'string' ? row.text.length : null,
    screenshot: !!screenshotName(row),
  }));
  let finalScreenshot = false;
  try { finalScreenshot = readBoundedArtifactSlot(workspace, run, FINAL_SCREENSHOT).length > 0; } catch { /* no independent check screenshot */ }
  return { runId: run.id, state: run.state, verdict: run.verdict, reason: run.reason ? redactObservation(run.reason, secrets).slice(0, 500) : null, steps, truncated: rows.length > MAX_STEPS, finalScreenshot };
}

export function runStepScreenshot(workspace: string, run: DynamicRun, step: number | 'final'): Buffer {
  if (step === 'final') {
    try { return readBoundedArtifactSlot(workspace, run, FINAL_SCREENSHOT); } catch { throw new DynamicContractError(404, 'This test has no saved check screenshot.'); }
  }
  const row = readTrace(workspace, run).find(item => item.step === step);
  const name = row ? screenshotName(row) : null;
  if (!name) throw new DynamicContractError(404, 'This step has no saved screenshot.');
  return readBoundedArtifactSlot(workspace, run, name, 'screenshots');
}

/** GET /projects/:p/dynamic/runs/:r/steps and /steps/:n/screenshot, for project members only. */
export async function handleRunStepsRoute(request: { method: string; pathname: string }, deps: {
  service: DynamicService; requireMember(projectId: string): Promise<void>; workspace(projectId: string): Promise<string>;
  privateValues?(projectId: string): Promise<string[]>;
  finalScreenshot?(run: DynamicRun): Buffer | null;
}): Promise<{ status: number; body: unknown } | { status: 200; body: Buffer; mimeType: string } | null> {
  const match = request.pathname.match(/^\/projects\/([^/]+)\/dynamic\/runs\/([^/]+)\/steps(?:\/(\d{1,3}|final)\/screenshot)?$/);
  if (!match) return null;
  const [, projectId, runId, stepText] = match;
  await deps.requireMember(projectId);
  if (request.method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };
  try {
    const run = await deps.service.requireRun(projectId, runId);
    const workspace = await deps.workspace(projectId);
    if (stepText) {
      const bytes = stepText === 'final' && deps.finalScreenshot ? deps.finalScreenshot(run)
        : runStepScreenshot(workspace, run, stepText === 'final' ? 'final' : Number(stepText));
      if (!bytes) throw new DynamicContractError(404, 'This test has no saved check screenshot.');
      return { status: 200, body: bytes, mimeType: 'image/png' };
    }
    const timeline = runTimeline(workspace, run, await deps.privateValues?.(projectId) ?? []);
    if (deps.finalScreenshot) {
      try { timeline.finalScreenshot = Boolean(deps.finalScreenshot(run)); }
      catch (error) {
        if (!(error instanceof DynamicContractError)) throw error;
        timeline.finalScreenshot = false;
      }
    }
    return { status: 200, body: timeline };
  } catch (error) {
    if (error instanceof DynamicContractError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}
