import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { runDynamicSession } from '../../src/dynamicRunner.js';
import { addEvidence } from '../../src/dynamicSessions.js';
import type { LiveActionEvent, LiveFrameInput } from '../../src/dynamic/live/liveHub.js';

const model = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock('../../src/review/modelProvider.js', () => ({ ConfiguredModelProvider: class { analyze(request: unknown) { return model.analyze(request); } } }));
vi.mock('../../src/db.js', () => ({ getDb: async () => ({ run: vi.fn() }), saveDb: vi.fn() }));
vi.mock('../../src/dynamicSessions.js', () => ({ updateDynamicSessionStatus: vi.fn(), addEvidence: vi.fn() }));
vi.mock('../../src/tokenUsage.js', () => ({ recordTokenUsage: vi.fn() }));

const page = `<!doctype html><title>Live</title><style>body{margin:0}#go{position:absolute;left:300px;top:150px;width:140px;height:40px}</style><h1>Live fixture</h1><button id="go" onclick="document.querySelector('h1').textContent='Clicked'">Go</button>`;
let server: http.Server; let origin: string;
beforeAll(async () => {
  server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

describe('Live runner against a local page', () => {
  it('streams frames, records the click box in the trace and keeps protected per-step screenshots', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-live-runner-browser-'));
    try {
      model.analyze.mockReset()
        .mockResolvedValueOnce({ result: { action: 'click', selector: '#go', targetDescription: 'Go button', reasoning: 'Open' }, usage: { inputTokens: 1, outputTokens: 1 } })
        .mockResolvedValueOnce({ result: { action: 'finish_failure', summary: 'Stop', reasoning: 'Done' }, usage: { inputTokens: 1, outputTokens: 1 } });
      const frames: LiveFrameInput[] = []; const events: LiveActionEvent[] = [];
      const session = { id: 'live-browser-session', projectId: 'project-1', type: 'dynamic' as const, name: 'Live', status: 'queued' as const, targetUrl: origin + '/', goal: 'Click go', missionType: 'smoke' as const, browserMode: 'headed' as const, maxSteps: 2, finalSummary: '', failureReason: '', createdAt: '', updatedAt: '' };
      await runDynamicSession(session, workspace, {
        vision: { ownerId: 'u', provider: 'codex', apiFormat: 'codex-app-server', model: 'm', apiKey: '', baseUrl: '' } as any,
        observationMode: 'dom_first', viewport: { width: 1024, height: 640 },
        live: { laneId: 'lane-1', headless: true, perStepScreenshots: true, sink: { frame: frame => frames.push(frame), action: event => events.push(event) } },
      });
      expect(frames.length).toBeGreaterThan(0);
      expect(events.map(event => event.phase)).toEqual(['move', 'press', 'done']);
      expect(events[0]).toMatchObject({ laneId: 'lane-1', step: 0, action: 'click', targetLabel: 'Go button', box: { x: 300, y: 150, width: 140, height: 40 }, viewport: { width: 1024, height: 640 } });
      const logs = path.join(workspace, 'sessions', session.id);
      const trace = JSON.parse(fs.readFileSync(path.join(logs, 'logs', 'action-trace.json'), 'utf8'));
      expect(trace[0]).toMatchObject({ action: 'click', result: 'success', box: { x: 300, y: 150, width: 140, height: 40 }, replayScreenshotPath: expect.stringContaining('step-000-replay.png') });
      expect(fs.existsSync(path.join(logs, 'screenshots', 'step-000-replay.png'))).toBe(true);
      expect(fs.existsSync(path.join(logs, 'screenshots', 'step-001-replay.png'))).toBe(true);
      expect(vi.mocked(addEvidence)).toHaveBeenCalledWith('project-1', session.id, 'screenshot', expect.stringContaining('step-000-replay.png'), 'Step 0 replay screenshot');
      // DOM-first planning stays text-only: the replay screenshot is evidence, not model input.
      for (const [request] of model.analyze.mock.calls) expect((request as { imagePaths?: string[] }).imagePaths ?? []).toEqual([]);
    } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
  }, 30000);
});
