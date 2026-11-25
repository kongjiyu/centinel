import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import type { AuthGateway } from '../../src/auth/gateway.js';
import { createSidecarServer } from '../../src/index.js';
import { LocalWorkspace } from '../../src/store/localWorkspace.js';
import { DynamicService } from '../../src/dynamic/service.js';

it('runs an authorized local Vitest suite and reopens its cleanup receipt and report', async () => {
  const root = mkdtempSync(join(tmpdir(), 'centinel-unit-http-'));
  const appFolder = join(root, 'app');
  cpSync(fileURLToPath(new URL('../fixtures/vitest-workspace/', import.meta.url)), appFolder, { recursive: true });
  const manifestPath = join(appFolder, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.scripts = { ...manifest.scripts, setup: 'node setup.cjs', cleanup: 'node cleanup.cjs' };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  for (const script of ['setup.cjs', 'cleanup.cjs']) {
    cpSync(fileURLToPath(new URL('../fixtures/hook-target/' + script, import.meta.url)), join(appFolder, script));
  }
  symlinkSync(resolve('node_modules'), join(appFolder, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const directory = join(root, 'workspace');
  const owner = randomUUID();
  const workspace = new LocalWorkspace(directory);
  const project = workspace.createProject(owner, { name: 'Local Unit fixture', description: '', workspacePath: appFolder });
  const remote = vi.fn(() => { throw new Error('Hosted application data was blocked.'); });
  const auth = { authenticate: async (headers: { authorization?: string }) => {
    const userId = headers.authorization === 'Bearer owner' ? owner : 'different-owner';
    return { userId, user: { id: userId }, client: { from: remote, rpc: remote, storage: { from: remote } } };
  }, requireProjectMember: remote } as unknown as AuthGateway;
  const sidecar = (device: LocalWorkspace) => createSidecarServer(auth, { localWorkspace: device, historyPath: join(root, 'history.sqlite') });
  let server = sidecar(workspace);
  const listen = async (listener: Server) => {
    await new Promise<void>(done => listener.listen(0, '127.0.0.1', done));
    return 'http://127.0.0.1:' + (listener.address() as AddressInfo).port + '/projects/' + project.id + '/dynamic';
  };
  const close = async (listener: Server) => {
    if (listener.listening) await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()));
  };
  vi.stubEnv('CENTINEL_TOKEN_ENCRYPTION_KEY', 'unit-local-fixture-key');
  let reopened: LocalWorkspace | undefined;
  try {
    let base = await listen(server);
    const request = (path: string, body?: object, actor = 'owner') => fetch(base + path, {
      method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + actor, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    const envResponse = await request('/environments', { name: 'Unit fixture', targetUrl: 'http://localhost:3000/',
      allowedOrigins: ['http://localhost:3000'], viewport: { width: 800, height: 600 }, accountRole: '', requiredVariables: [],
      startupInstructions: '', targetVersion: 'fixture' });
    expect(envResponse.status).toBe(201);
    const profile = '/environments/' + (await envResponse.json()).id;
    const unitRoute = profile + '/unit-runs';
    const missingAuthorization = await request(unitRoute, { idempotencyKey: 'missing-authorization', timeoutMs: 10_000 });
    expect(await missingAuthorization.json()).toMatchObject({ state: 'blocked', verdict: 'not_tested',
      result: { outcome: 'configuration_error' } });
    expect(await (await request(profile + '/data')).json()).toMatchObject({ state: 'unprepared', resource: { reserved: false } });
    const inspection = await (await request(profile + '/workspace', { operation: 'inspect', directory: appFolder })).json();
    expect(inspection).toMatchObject({ inspection: { scriptDefinitions: { unit: 'vitest --run' } } });
    const authorization = await request(profile + '/workspace', { operation: 'authorize', directory: appFolder,
      packageManager: 'pnpm', scripts: { unit: 'unit' }, allowScripts: true, expectedFingerprint: inspection.inspection.fingerprint });
    expect(authorization.status).toBe(200);
    const prep = { outcome: 'completed', note: 'Prepared isolated fixture data.' };
    expect((await request(profile + '/preparation', prep)).status).toBe(200);
    const input = { idempotencyKey: 'authorized-unit-run', timeoutMs: 20_000 };
    const started = await request(unitRoute, input);
    expect(started.status).toBe(201);
    const unitId = (await started.json()).id;
    const runPath = unitRoute + '/' + unitId;
    await expect.poll(async () => (await (await request(runPath)).json()).state, { timeout: 27_000 }).not.toMatch(/queued|running/);
    const run = await (await request(runPath)).json();
    expect(run, JSON.stringify(run.result?.process)).toMatchObject({ state: 'completed', verdict: 'passed',
      result: { outcome: 'passed', assessment: { counts: { total: 1, passed: 1 } } } });
    expect(await (await request(profile + '/data')).json()).toMatchObject({ state: 'cleanup_required', unitRunId: unitId });
    expect(await (await request(unitRoute, input)).json()).toEqual(run);
    const capture = (reportId: string) => request('/unit-runs/' + unitId + '/reports', { reportId });
    const beforeCleanup = await (await capture(randomUUID())).json();
    expect(beforeCleanup).toMatchObject({ metadata: { actorId: owner, runId: unitId }, cleanupEvents: [] });
    const cleanup = { outcome: 'completed', note: 'Confirmed the isolated fixture data was clean.' };
    expect((await request(profile + '/cleanup', cleanup)).status).toBe(200);
    const reportId = randomUUID();
    const report = await (await capture(reportId)).json();
    expect(report).toMatchObject({ run: { verdict: 'passed' }, cleanupEvents: [{ ...cleanup, actorId: owner }] });
    expect(await (await capture(beforeCleanup.metadata.reportId)).json()).toEqual(beforeCleanup);
    const reportPath = '/unit-reports/' + reportId;
    const pdf = await request(reportPath + '/pdf');
    const bytes = Buffer.from(await pdf.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.headers.get('x-centinel-sha256')).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect((await request(reportPath, undefined, 'other')).status).toBe(404);

    const hookRoute = profile + '/hooks';
    const fixtureSecret = 'synthetic-hook-receipt-value-62ef';
    expect((await request(profile + '/values', { values: { QA_TOKEN: fixtureSecret } })).status).toBe(200);
    const hookAuthorization = await request(profile + '/workspace', { operation: 'authorize', directory: appFolder,
      packageManager: 'pnpm', scripts: { unit: 'unit', setup: 'setup', cleanup: 'cleanup' }, automaticCleanup: true,
      allowScripts: true, expectedFingerprint: inspection.inspection.fingerprint });
    expect(hookAuthorization.status).toBe(200);
    const setupStart = await request(hookRoute, { kind: 'setup', idempotencyKey: 'actual-hook-setup' });
    expect(setupStart.status).toBe(201);
    const setupId = (await setupStart.json()).id;
    const setupPath = hookRoute + '/' + setupId;
    const marker = join(appFolder, 'prepared.json');
    await expect.poll(async () => (await (await request(setupPath)).json()).state, { timeout: 15_000 }).not.toMatch(/queued|running/);
    const setup = await (await request(setupPath)).json();
    expect(setup, setup.result?.output).toMatchObject({ state: 'completed', verdict: 'passed' });
    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual({ scope: 'isolated-hook-fixture', ready: true });
    expect(await (await request(profile + '/data')).json()).toMatchObject({ state: 'ready', resource: { reserved: true } });
    const receiptText = await (await request(setupPath + '/output')).text();
    const receipt = JSON.parse(receiptText);
    expect(receipt).toMatchObject({ availability: 'local', result: { outcome: 'passed' } });
    expect(receipt.result.output).toContain('[REDACTED]');
    expect(receiptText).not.toContain(fixtureSecret);
    expect(receipt.sha256).toBe(createHash('sha256').update(receipt.result.output).digest('hex'));
    expect((await request(setupPath + '/output', undefined, 'other')).status).toBe(404);

    const nextRun = await request(unitRoute, { ...input, idempotencyKey: 'automatic-cleanup-unit-run' });
    expect(nextRun.status).toBe(201);
    const nextUnitId = (await nextRun.json()).id;
    await expect.poll(async () => (await (await request(profile + '/data')).json()).state, { timeout: 27_000 }).toBe('unprepared');
    expect(existsSync(marker)).toBe(false);
    const operations = await (await request(hookRoute)).json();
    const automatic = operations.find((operation: { kind: string }) => operation.kind === 'cleanup');
    expect(automatic).toMatchObject({ idempotencyKey: 'automatic-unit-' + nextUnitId, state: 'completed', verdict: 'passed' });
    expect(await (await request(profile + '/data')).json()).toMatchObject({ state: 'unprepared', resource: { reserved: false } });
    const withAutomaticCleanup = await (await request('/unit-runs/' + nextUnitId + '/reports', { reportId: randomUUID() })).json();
    expect(withAutomaticCleanup).toMatchObject({ run: { verdict: 'passed' }, cleanupEvents: [{
      kind: 'cleanup', outcome: 'completed', operationId: automatic.id,
    }] });
    await close(server);
    workspace.close();
    reopened = new LocalWorkspace(directory);
    server = sidecar(reopened);
    base = await listen(server);
    expect(await (await request(runPath)).json()).toEqual(run);
    expect(await (await request(reportPath)).json()).toEqual(report);
    expect(await (await request(hookRoute + '/' + automatic.id)).json()).toEqual(automatic);
    expect(await (await request(setupPath + '/output')).json()).toEqual(receipt);
    expect(remote).not.toHaveBeenCalled();
  } finally {
    await close(server);
    reopened?.close();
    workspace.close();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 60_000);

it('fences expired Unit workers and preserves cleanup while a cancellation is pending', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'centinel-unit-lease-'));
  const owner = randomUUID();
  const workspace = new LocalWorkspace(directory);
  const project = workspace.createProject(owner, { name: 'Lease fixture', description: '', workspacePath: '' }).id;
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const environments = workspace.environments(owner);
    const profile = await environments.save(project, { name: 'Local fixture', targetUrl: 'http://localhost:3000/',
      allowedOrigins: ['http://localhost:3000'], viewport: { width: 800, height: 600 }, accountRole: '', requiredVariables: [],
      startupInstructions: '', targetVersion: 'fixture' });
    await environments.recordData(project, profile.id, 'preparation', 'completed', 'Prepared fixture data.');
    const command = { program: 'node' as const, script: 'unit', fingerprint: 'a'.repeat(64), authorizationId: 'b'.repeat(64),
      gitCommit: null, nodeVersion: 'v22.21.1', cliSha256: 'c'.repeat(64), frameworkVersion: '4.1.8' };
    const units = workspace.unitRuns(owner);
    const { run } = await units.start(project, profile.id, 'lease-test', command, 10_000);
    const browser = new DynamicService(workspace.dynamicRuns(owner));
    const revision = await browser.saveMission(project, owner, { name: 'Read welcome', goal: 'Read welcome heading', maxSteps: 2,
      targetUrl: 'http://localhost:3000/', checks: [{ id: 'welcome', criterionId: 'welcome', description: 'Show welcome',
        kind: 'visible_text', expected: 'Welcome', required: true }] });
    await expect(browser.start(project, owner, revision.id, 'browser-during-unit')).rejects.toThrow(/Unit execution is active/);
    await units.claim(project, run.id, 'fixture-worker', 'fixture-token');
    expect(await units.heartbeat(project, run.id, 'fixture-worker', 'incorrect-token')).toBe(false);
    expect(await units.heartbeat(project, run.id, 'fixture-worker', 'fixture-token')).toBe(true);
    expect(await units.cancel(project, run.id)).toMatchObject({ state: 'running', cancelRequested: true });
    expect(await environments.data(project, profile.id)).toMatchObject({ state: 'in_use', unitRunId: run.id });
    await expect(environments.recordData(project, profile.id, 'cleanup', 'completed', 'Confirm cleanup.')).rejects.toThrow(/Unit execution is active/);
    expect(await units.heartbeat(project, run.id, 'fixture-worker', 'fixture-token')).toBe(false);
    vi.setSystemTime(Date.now() + 90_001);
    expect(await units.recover(project)).toMatchObject([{ state: 'interrupted', verdict: 'not_tested' }]);
    expect(await units.claim(project, run.id, 'new-worker', 'new-token')).toBeNull();
    expect(await environments.data(project, profile.id)).toMatchObject({ state: 'cleanup_required', unitRunId: run.id });
    expect(await units.events(project, run.id)).toEqual([]);
    await environments.recordData(project, profile.id, 'cleanup', 'completed', 'Confirmed environment cleanup.');
    expect(await units.events(project, run.id)).toMatchObject([{ kind: 'cleanup', outcome: 'completed', actorId: owner }]);
    expect(await environments.data(project, profile.id)).toMatchObject({ state: 'unprepared', resource: { reserved: false } });
    const hooks = workspace.hooks(owner);
    const hookCommand = { program: 'pnpm', script: 'setup', fingerprint: command.fingerprint,
      authorizationId: command.authorizationId, gitCommit: null };
    const { operation: setup } = await hooks.start(project, profile.id, 'setup', 'prepare', hookCommand);
    expect(await environments.data(project, profile.id)).toMatchObject({ state: 'preparing', operationId: setup.id });
    await expect(browser.start(project, owner, revision.id, 'browser-during-hook')).rejects.toThrow(/script is already active/);
    await expect(units.start(project, profile.id, 'unit-during-hook', command, 10_000)).rejects.toThrow(/script is already active/);
    await hooks.claim(project, setup.id, 'fixture-worker', 'fixture-hook-token');
    const result = { outcome: 'passed' as const, exitCode: 0, signal: null, output: 'ready', truncated: false, durationMs: 2 };
    expect(await hooks.finish(project, setup.id, 'wrong-token', result)).toBeNull();
    expect(await hooks.finish(project, setup.id, 'fixture-hook-token', result)).toMatchObject({ state: 'completed', verdict: 'passed' });
    expect(await environments.data(project, profile.id)).toMatchObject({ state: 'ready', resource: { reserved: true } });
    const { run: used } = await units.start(project, profile.id, 'used-configured-cleanup', command, 10_000);
    await units.cancel(project, used.id);
    await expect(hooks.start(project, profile.id, 'cleanup', 'wrong-source', hookCommand, { kind: 'unit', id: run.id })).rejects.toThrow(/does not permit/);
    const { operation: cleanup } = await hooks.start(project, profile.id, 'cleanup', 'clean', { ...hookCommand, script: 'cleanup' },
      { kind: 'unit', id: used.id });
    await hooks.claim(project, cleanup.id, 'fixture-worker', 'fixture-hook-token');
    await hooks.finish(project, cleanup.id, 'fixture-hook-token', result);
    expect(await units.events(project, used.id)).toMatchObject([{ kind: 'cleanup', outcome: 'completed', operationId: cleanup.id }]);
    expect(await environments.data(project, profile.id)).toMatchObject({ state: 'unprepared', resource: { reserved: false } });
    const signInProfile = await environments.save(project, { ...profile, sessionReference: 'fixture-session', sessionReadySelector: 'h1' }, profile.id);
    const captures = workspace.sessionCaptures(owner);
    const captureId = randomUUID();
    await expect(captures.acquire(project, profile.id, captureId, 'capture-secret-token', 'fixture-worker', profile.version))
      .rejects.toThrow(/environment changed/);
    expect(await captures.acquire(project, profile.id, captureId, 'capture-secret-token', 'fixture-worker', signInProfile.version)).toBe(true);
    await expect(browser.start(project, owner, revision.id, 'browser-during-capture')).rejects.toThrow(/sign-in browser/);
    await expect(units.start(project, profile.id, 'unit-during-capture', command, 10_000)).rejects.toThrow(/sign-in browser/);
    await expect(hooks.start(project, profile.id, 'setup', 'hook-during-capture', hookCommand)).rejects.toThrow(/sign-in browser/);
    expect(await captures.heartbeat(project, captureId, 'wrong-token')).toBe(false);
    vi.setSystemTime(Date.now() + 60_001);
    expect(await captures.finish(project, captureId, 'capture-secret-token', true)).toBeNull();
    const reopened = new LocalWorkspace(directory);
    try {
      await reopened.sessionCaptures(owner).recover(project);
      expect(await reopened.environments(owner).data(project, profile.id)).toMatchObject({ state: 'cleanup_required', resource: { reserved: true } });
    } finally { reopened.close(); }
  } finally {
    vi.useRealTimers();
    workspace.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
