import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { runDynamicSession } from '../../src/dynamicRunner.js';
import type { LiveSink } from '../../src/dynamic/live/liveHub.js';

const model = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock('../../src/review/modelProvider.js', () => ({ ConfiguredModelProvider: class { analyze(request: unknown) { return model.analyze(request); } } }));
vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }));
vi.mock('../../src/db.js', () => ({ getDb: async () => ({ run: vi.fn() }), saveDb: vi.fn() }));
vi.mock('../../src/dynamicSessions.js', () => ({ updateDynamicSessionStatus: vi.fn(), addEvidence: vi.fn() }));
vi.mock('../../src/tokenUsage.js', () => ({ recordTokenUsage: vi.fn() }));

const setting = { ownerId: 'verified-user', provider: 'codex' as const, apiFormat: 'codex-app-server' as const, model: 'account-model', apiKey: '', baseUrl: '' };
const session = { id: 'live-session', projectId: 'project-1', type: 'dynamic' as const, name: 'Demo', status: 'queued' as const, targetUrl: 'https://example.test', goal: 'Check page', missionType: 'smoke' as const, browserMode: 'headed' as const, maxSteps: 1, finalSummary: '', failureReason: '', createdAt: '', updatedAt: '' };
let workspace: string; let page: any; let onFrame: ((frame: unknown) => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks(); onFrame = undefined;
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-live-runner-'));
  page = {
    context: () => ({ pages: () => [], on: vi.fn(), route: vi.fn(), routeWebSocket: vi.fn() }), frames: () => [], on: vi.fn(), goto: vi.fn(), waitForTimeout: vi.fn(),
    screenshot: vi.fn(async ({ path: file }: { path: string }) => fs.writeFileSync(file, 'fixture')), url: () => 'https://example.test', title: async () => 'Demo',
    evaluate: vi.fn().mockResolvedValueOnce('Demo content').mockResolvedValueOnce([]),
    screencast: { start: vi.fn(async (options: { onFrame: (frame: unknown) => void }) => { onFrame = options.onFrame; return { [Symbol.dispose]() {} }; }), stop: vi.fn(async () => {}) },
  };
  vi.mocked(chromium.launch).mockResolvedValue({ on: vi.fn(), newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) } as any);
  model.analyze.mockResolvedValue({ result: { action: 'finish_failure', summary: 'Expected content missing', reasoning: 'Compared to goal' }, usage: { inputTokens: 10, outputTokens: 2 } });
});
afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));

describe('Dynamic runner live instrumentation', () => {
  it('keeps the normal headed launch and never starts a screencast without the live option', async () => {
    await runDynamicSession(session, workspace, { vision: setting });
    expect(chromium.launch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(chromium.launch).mock.calls[0][0]).toEqual({ headless: false, proxy: { server: expect.any(String) }, args: ['--proxy-bypass-list=<-loopback>', '--disable-quic', '--disable-http2', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
    expect(page.screencast.start).not.toHaveBeenCalled();
    expect(page.screencast.stop).not.toHaveBeenCalled();
  });
  it('launches headless, streams throttled frames to the sink and stops the screencast at finish', async () => {
    const sink: LiveSink = { frame: vi.fn(), action: vi.fn() };
    page.goto = vi.fn(async () => { for (let i = 0; i < 5; i++) onFrame?.({ data: Buffer.from([0xff, 0xd8, i]), viewportWidth: 1280, viewportHeight: 720 }); });
    await runDynamicSession(session, workspace, { vision: setting, live: { laneId: 'lane-1', headless: true, perStepScreenshots: true, sink } });
    expect(vi.mocked(chromium.launch).mock.calls[0][0]).toMatchObject({ headless: true });
    expect(page.screencast.start).toHaveBeenCalledWith({ size: { width: 1280, height: 720 }, quality: 60, onFrame: expect.any(Function) });
    // Five frames in the same instant collapse to one at ~8 fps.
    expect(sink.frame).toHaveBeenCalledTimes(1);
    expect(page.screencast.stop).toHaveBeenCalledTimes(1);
    onFrame?.({ data: Buffer.from([1]), viewportWidth: 1, viewportHeight: 1 });
    expect(sink.frame).toHaveBeenCalledTimes(1);
  });
  it('stops the screencast when the run errors', async () => {
    const sink: LiveSink = { frame: vi.fn(), action: vi.fn() };
    page.goto = vi.fn(async () => { throw new Error('Target unavailable'); });
    await runDynamicSession(session, workspace, { vision: setting, live: { laneId: 'lane-1', headless: true, perStepScreenshots: true, sink } });
    expect(page.screencast.start).toHaveBeenCalledTimes(1);
    expect(page.screencast.stop).toHaveBeenCalledTimes(1);
  });
});
