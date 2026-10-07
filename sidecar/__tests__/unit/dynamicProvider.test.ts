import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelProviderError } from '../../src/review/retry.js';
import { cancelSession, isValidAgentAction, runDynamicSession } from '../../src/dynamicRunner.js';
import { chromium } from 'playwright';
import { updateDynamicSessionStatus } from '../../src/dynamicSessions.js';

const model = vi.hoisted(() => ({ analyze: vi.fn(), options: [] as any[] }));
const db = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../src/review/modelProvider.js', () => ({ ConfiguredModelProvider: class {
  constructor(options: unknown) { model.options.push(options); }
  analyze(request: unknown) { return model.analyze(request); }
} }));
vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }));
vi.mock('../../src/db.js', () => ({ getDb: async () => db, saveDb: vi.fn() }));
vi.mock('../../src/dynamicSessions.js', () => ({ updateDynamicSessionStatus: vi.fn(), addEvidence: vi.fn() }));
vi.mock('../../src/tokenUsage.js', () => ({ recordTokenUsage: vi.fn() }));
const setting = { ownerId: 'verified-user', provider: 'codex' as const, apiFormat: 'codex-app-server' as const, model: 'account-model', apiKey: '', baseUrl: '' };
const session = { id: 'session-1', projectId: 'project-1', type: 'dynamic' as const, name: 'Demo', status: 'queued' as const, targetUrl: 'https://example.test', goal: 'Check page', missionType: 'smoke' as const, browserMode: 'headed' as const, maxSteps: 1, finalSummary: '', failureReason: '', createdAt: '', updatedAt: '' };
let workspace: string;
beforeEach(() => {
  vi.clearAllMocks(); model.options.length = 0;
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-dynamic-unit-'));
  const page = { on: vi.fn(), goto: vi.fn(), waitForTimeout: vi.fn(), screenshot: vi.fn(async ({ path: file }: { path: string }) => fs.writeFileSync(file, 'fixture')), url: () => 'https://example.test', title: async () => 'Demo', evaluate: async () => 'Demo content' };
  vi.mocked(chromium.launch).mockResolvedValue({ newPage: async () => page, close: vi.fn().mockResolvedValue(undefined) } as any);
  model.analyze.mockResolvedValue({ result: { action: 'finish_failure', summary: 'Expected content missing', reasoning: 'Compared to goal' }, usage: { inputTokens: 10, outputTokens: 2 } });
  // The page-context helper expects its second evaluation to return elements.
  (page as any).evaluate = vi.fn().mockResolvedValueOnce('Demo content').mockResolvedValueOnce([]);
});
afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));

describe('Dynamic shared provider and run basics', () => {
  it('uses the authenticated screenshot provider, records usage, and creates one finding', async () => {
    const recordUsage = vi.fn();
    await runDynamicSession(session, workspace, { vision: setting, recordUsage });
    expect(model.options[0].settings).toMatchObject({ ownerId: 'verified-user', provider: 'codex', apiKey: '' });
    expect(model.analyze).toHaveBeenCalledWith(expect.objectContaining({ imagePaths: [expect.stringContaining('step-000.png')], signal: expect.any(AbortSignal) }));
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'codex', inputTokens: 10, outputTokens: 2, callKind: 'dynamic' }));
    expect(db.run.mock.calls.filter(([sql]) => sql.includes('INSERT INTO findings'))).toHaveLength(1);
    expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id, 'failure', expect.any(String), 'Expected content missing');
  });
  it('marks model/auth failures blocked without creating a product finding', async () => {
    model.analyze.mockRejectedValue(new ModelProviderError('Reconnect Codex.', { code: 'codex_not_connected', retryable: false }));
    await runDynamicSession(session, workspace, { vision: setting });
    expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id, 'blocked', expect.any(String), 'Reconnect Codex.');
    expect(db.run).not.toHaveBeenCalled();
  });
  it('aborts an active model call on cancellation and preserves cancelled status', async () => {
    model.analyze.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
    const running = runDynamicSession(session, workspace, { vision: setting });
    await vi.waitFor(() => expect(model.analyze).toHaveBeenCalled());
    cancelSession(session.id); await running;
    expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id, 'cancelled', expect.any(String), 'Cancelled by user');
    expect(db.run).not.toHaveBeenCalled();
  });
  it('does not turn browser startup failure into an application defect', async () => {
    vi.mocked(chromium.launch).mockRejectedValue(new Error('Missing browser binary'));
    await runDynamicSession(session, workspace, { vision: setting });
    expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id, 'blocked', expect.any(String), expect.any(String));
    expect(db.run).not.toHaveBeenCalled();
  });
  it('rejects unknown, incomplete, non-http and unbounded browser actions', () => {
    for (const value of [{ action: 'delete' }, { action: 'click', reasoning: '' }, { action: 'navigate', url: 'file:///private', reasoning: '' }, { action: 'wait', milliseconds: 1e9, reasoning: '' }, { action: 'type', targetDescription: 'field', selector: 'input', text: 1, reasoning: '' }]) expect(isValidAgentAction(value)).toBe(false);
    expect(isValidAgentAction({ action: 'assert_visible', text: 'Success', reasoning: 'Verify goal' })).toBe(true);
  });
});
