import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleRunStepsRoute, runStepScreenshot, runTimeline } from '../../src/dynamic/runSteps.js';
import type { DynamicRun } from '../../src/dynamic/types.js';

const SESSION = '11111111-2222-4333-8444-555555555555';
function workspace(trace: unknown[] | ((session: string) => unknown[])) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-steps-'));
  const session = path.join(root, 'sessions', SESSION);
  fs.mkdirSync(path.join(session, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(session, 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(session, 'logs', 'action-trace.json'), JSON.stringify(typeof trace === 'function' ? trace(session) : trace));
  fs.writeFileSync(path.join(session, 'screenshots', 'step-002-replay.png'), Buffer.from('png-bytes'));
  return { root, session };
}
const run = { id: 'run-1', projectId: 'p', legacySessionId: SESSION, state: 'completed', verdict: 'failed', reason: null } as unknown as DynamicRun;

describe('browser run step timeline', () => {
  it('returns public step fields only: typed text as a length, no model reasoning', () => {
    const { root } = workspace(session => [
      { step: 1, action: 'type', targetDescription: 'Email field', text: 'nobody@example.com', reasoning: 'private model thought', result: 'success', beforeUrl: 'http://localhost:5000/signin?next=1' },
      { step: 2, action: 'click', selector: '#signin', result: 'blocked', error: 'This potentially mutating control was already activated in this Run.', beforeUrl: 'http://localhost:5000/signin', replayScreenshotPath: path.join(session, 'screenshots', 'step-002-replay.png') },
    ]);
    const timeline = runTimeline(root, run, ['nobody@example.com']);
    expect(timeline.steps).toEqual([
      { step: 1, action: 'type', target: 'Email field', page: '/signin', result: 'success', error: null, typedLength: 18, screenshot: false },
      { step: 2, action: 'click', target: '#signin', page: '/signin', result: 'blocked', error: 'This potentially mutating control was already activated in this Run.', typedLength: null, screenshot: true },
    ]);
    expect(JSON.stringify(timeline)).not.toMatch(/private model thought|nobody@example\.com/);
    expect(runStepScreenshot(root, run, 2).toString()).toBe('png-bytes');
    expect(() => runStepScreenshot(root, run, 1)).toThrow('no saved screenshot');
    expect(timeline.finalScreenshot).toBe(false);
    expect(() => runStepScreenshot(root, run, 'final')).toThrow('no saved check screenshot');
    fs.writeFileSync(path.join(root, 'sessions', SESSION, 'logs', 'criterion-page.png'), Buffer.from('final-png'));
    expect(runTimeline(root, run).finalScreenshot).toBe(true);
    expect(runStepScreenshot(root, run, 'final').toString()).toBe('final-png');
  });

  it('never serves a screenshot outside the run folder', () => {
    const { root } = workspace([{ step: 1, action: 'click', result: 'success', replayScreenshotPath: '/etc/passwd.png' }]);
    expect(() => runStepScreenshot(root, run, 1)).toThrow('no saved screenshot');
  });

  it('checks project membership before reading anything', async () => {
    const order: string[] = [];
    const deps = {
      requireMember: async () => { order.push('member'); throw new Error('Not a project member'); },
      service: { requireRun: async () => { order.push('run'); return run; } } as never,
      workspace: async () => { order.push('workspace'); return '/tmp'; },
    };
    await expect(handleRunStepsRoute({ method: 'GET', pathname: '/projects/p/dynamic/runs/run-1/steps' }, deps)).rejects.toThrow('Not a project member');
    expect(order).toEqual(['member']);
    expect(await handleRunStepsRoute({ method: 'GET', pathname: '/projects/p/dynamic/runs/run-1/evidence' }, deps)).toBeNull();
  });
});
