import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryResult } from '../../src/dynamic/environment/controlDiscovery.js';
import type { EnvironmentProfile } from '../../src/dynamic/environment/types.js';
import type { DynamicRun, MissionInput } from '../../src/dynamic/types.js';
import { LaunchError, type LaunchedApp } from '../../src/dynamic/autonomous/launcher.js';
import { buildPlanPrompt, knownSelectors, validatePlan, type AutoTestPreset, type AutoTestRequest } from '../../src/dynamic/autonomous/planner.js';
import { newAutoTestSession, presetFromEntry, runAutoTest, scanPaths, type AutoTestDeps, type AutoTestSession } from '../../src/dynamic/autonomous/orchestrator.js';
import { handleAutoTestRoute, AutoTestRuntime } from '../../src/dynamic/autonomous/routes.js';
import { MemoryAutoTestStore } from '../../src/dynamic/autonomous/store.js';
import { vitestScript, type UnitSummary } from '../../src/dynamic/autonomous/unitTests.js';
import { autoRepeatable, exploratoryTests } from '../../src/dynamic/autonomous/suite.js';
import type { RepoDigest } from '../../src/dynamic/autonomous/repoDigest.js';
import { ModelProviderError } from '../../src/review/retry.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const NO_SUITE = { smoke: false, exploratory: false, usability: false };
const digest = (overrides: Partial<RepoDigest> = {}): RepoDigest => ({
  entries: [{ path: 'server.js', kind: 'route', startLine: 40, endLine: 50, text: "if (url.pathname === '/api/login') { send(401, 'No account uses this email.') }" },
    { path: 'docs/requirements.md', kind: 'doc', startLine: 1, endLine: 5, text: 'REQ-1 Sign-in errors must say "Email or password is incorrect."' }],
  routes: [{ method: 'POST', path: '/api/login', kind: 'server', file: 'server.js', line: 42 }, { path: '/', kind: 'page', file: 'public/index.html', line: 1 }, { path: '/orders', kind: 'page', file: 'public/orders.html', line: 1 }],
  forms: [{ file: 'public/index.html', line: 10, endLine: 20, id: 'signin-form', fields: [{ tag: 'input', id: 'email', type: 'email' }, { tag: 'input', id: 'password', type: 'password' }, { tag: 'button', type: 'submit' }] }],
  fixtures: [], requirementsText: 'REQ-1 Sign-in errors must say "Email or password is incorrect."', persistenceHints: [], truncated: false, omittedCount: 0, fingerprint: 'f'.repeat(64),
  ...overrides,
});
const discovery: DiscoveryResult = { controls: [{ selector: '#discount-code', label: 'Discount', actions: ['type', 'click'], kind: 'input', page: '/' }], pages: [{ url: 'http://localhost:5000/', finalUrl: 'http://localhost:5000/', controls: 1, redirected: false }] };
const signInTest = (overrides: Record<string, unknown> = {}) => ({
  name: 'Unknown email gets the generic error', goal: 'Type nobody@example.com and wrong-password, then click Sign in.', rationale: 'REQ-1', startPath: '/', requirementRef: 'REQ-1',
  sourceRefs: [{ path: 'server.js', line: 45 }, { path: 'invented.js', line: 3 }],
  controls: [{ selector: '#email', actions: ['type'] }, { selector: '#password', actions: ['type'] }, { selector: '#signin-form button[type="submit"]', actions: ['click'] }],
  checks: [{ kind: 'visible_text', description: 'Generic error shown', expected: 'Email or password is incorrect.', selector: null }],
  ...overrides,
});
const ctx = { appUrl: 'http://localhost:5000', projectId: PROJECT, digest: digest(), discovery };

describe('Auto test planner validation', () => {
  it('accepts a grounded test, keeps known source refs and drops invented ones', () => {
    const plan = validatePlan({ tests: [signInTest()] }, ctx);
    expect(plan.dropped).toEqual([]);
    expect(plan.tests[0]).toMatchObject({ requirementRef: 'REQ-1', startPath: '/', sourceRefs: [{ path: 'server.js', line: 45 }] });
    expect(plan.tests[0].mission).toMatchObject({ targetUrl: 'http://localhost:5000/', maxSteps: 15, mode: 'guided' });
    expect(plan.tests[0].mission.checks[0]).toMatchObject({ kind: 'visible_text', criterionId: 'REQ-1', required: true });
  });

  it('allows form fields from source as controls and lists them in the prompt', () => {
    expect([...knownSelectors(digest(), discovery).keys()]).toEqual(expect.arrayContaining(['#discount-code', '#email', '#password', '#signin-form button[type="submit"]']));
    const prompt = buildPlanPrompt({ appUrl: 'http://localhost:5000', digest: digest(), discovery });
    expect(prompt).toContain('#email: type, click');
    expect(prompt).toContain('REQ-1');
  });

  it('drops unsafe or unverifiable tests with a reason', () => {
    const plan = validatePlan({ tests: [
      signInTest({ name: 'Off-site', startPath: 'https://evil.example/' }),
      signInTest({ name: 'Unknown controls', controls: [{ selector: '#made-up', actions: ['click'] }] }),
      signInTest({ name: 'No checks', checks: [{ kind: 'element_visible', description: 'x', expected: null, selector: '#made-up' }] }),
      signInTest({ name: 'Secret', goal: 'Use key sk-abcdefghijklmnopqrstuvwx to sign in.' }),
      signInTest({ name: 'Cross-origin URL check', checks: [{ kind: 'url', description: 'x', expected: 'https://other.example/done', selector: null }] }),
      signInTest(), signInTest(),
    ] }, ctx);
    expect(plan.tests.map(test => test.name)).toEqual(['Unknown email gets the generic error']);
    expect(plan.dropped.map(entry => entry.name)).toEqual(['Off-site', 'Unknown controls', 'No checks', 'Secret', 'Cross-origin URL check', 'Unknown email gets the generic error']);
    expect(plan.dropped.at(-1)?.reason).toBe('Duplicate test name.');
  });

  it('drops a plan whose required permissions would be incomplete', () => {
    const plan = validatePlan({ tests: [signInTest({ controls: [{ selector: '#email', actions: ['type'] }, { selector: '#missing', actions: ['click'] }] })] }, ctx);
    expect(plan.tests).toEqual([]);
    expect(plan.dropped[0]?.reason).toMatch(/control or action was unavailable/);
  });

  it('turns relative URL checks into app URLs and never trusts missing plans', () => {
    const plan = validatePlan({ tests: [signInTest({ checks: [{ kind: 'url', description: 'Lands on orders', expected: '/orders', selector: null }] })] }, ctx);
    expect(plan.tests[0].mission.checks[0]).toMatchObject({ kind: 'url', expected: 'http://localhost:5000/orders' });
    expect(validatePlan(null, ctx)).toEqual({ tests: [], dropped: [] });
  });

  it('scans page routes and plain GET routes, never APIs or parameterised paths', () => {
    expect(scanPaths(digest({ routes: [...digest().routes, { method: 'GET', path: '/products/:id', kind: 'server', file: 's', line: 1 }, { method: 'GET', path: '/about', kind: 'server', file: 's', line: 2 }] }))).toEqual(['/orders', '/about']);
  });
});
type Fake = { deps: AutoTestDeps; launches: Array<{ recipeId?: string; port?: number }>; stopped: number[]; runs: Map<string, DynamicRun>; saved: AutoTestSession[]; data: string[]; missions: MissionInput[] };
function fakes(options: { verdicts?: string[]; tests?: number; persistence?: boolean; portHonored?: boolean; failLaunch?: boolean } = {}): Fake {
  let port = 6000;
  const launches: Fake['launches'] = []; const stopped: number[] = []; const runs = new Map<string, DynamicRun>(); const saved: AutoTestSession[] = []; const data: string[] = []; const missions: MissionInput[] = [];
  let runIndex = 0;
  const verdicts = options.verdicts ?? ['passed', 'failed', 'passed', 'passed'];
  const deps: AutoTestDeps = {
    digest: async () => digest(options.persistence ? { persistenceHints: [{ kind: 'database_url', detail: 'DATABASE_URL', file: '.env.example' }] } : {}),
    launch: async input => {
      if (options.failLaunch) throw Object.assign(new Error('Missing DATABASE_URL'), {});
      launches.push({ recipeId: input.recipeId, port: input.port });
      input.onEvent?.({ stage: 'detected', recipe: { id: 'node-entry:server.js', kind: 'node_entry', framework: 'node', label: 'node server.js', needsInstall: false, portStrategy: 'env', score: 1 }, detection: { folder: '/repo', recipes: [] } });
      const assigned = input.port ?? port++;
      return { recipe: { id: 'node-entry:server.js', kind: 'node_entry', framework: 'node', label: 'node server.js', needsInstall: false, portStrategy: 'env', score: 1 }, detection: { folder: '/repo', recipes: [] },
        server: { url: `http://localhost:${assigned}`, port: assigned, portHonored: options.portHonored ?? true, pid: 1, logs: () => '', exited: new Promise(() => {}), stop: async () => { stopped.push(assigned); } } } as LaunchedApp;
    },
    discover: async () => discovery,
    generate: async () => ({ tests: Array.from({ length: options.tests ?? 4 }, (_, index) => signInTest({ name: `Test ${index + 1}` })) }),
    explainFailure: async () => 'The server returns a different message for unknown emails (likely server.js:45).',
    saveEnvironment: async (value, id) => ({ ...value, id: id ?? `env-${value.name}`, projectId: PROJECT, version: 1, updatedBy: 'u', updatedAt: '' }) as EnvironmentProfile,
    recordData: async (id, kind) => { data.push(`${kind}:${id}`); },
    saveMission: async mission => { missions.push(mission); return { missionId: `m${missions.length}`, revisionId: `r${missions.length}` }; },
    startRun: async ({ idempotencyKey }) => {
      const id = `run-${++runIndex}`;
      const verdict = verdicts[(runIndex - 1) % verdicts.length];
      runs.set(id, { id, idempotencyKey, state: verdict === 'blocked' ? 'blocked' : 'running', verdict: verdict === 'blocked' ? 'not_tested' : verdict, reason: null, checks: [{ checkId: 'c', criterionId: 'REQ-1', verdict, observed: 'No account uses this email.', reason: '', evidenceIds: ['e'], checkedAt: '' }] } as unknown as DynamicRun);
      return id;
    },
    getRun: async id => { const run = runs.get(id)!; if (run.state === 'running') run.state = 'completed'; return structuredClone(run); },
    cancelRun: async id => { const run = runs.get(id)!; run.state = 'cancelled'; },
    save: async session => { saved.push(session); },
    sleep: async () => undefined,
  };
  return { deps, launches, stopped, runs, saved, data, missions };
}

describe('Auto test orchestrator', () => {
  it('bounds cancellation recovery and admits no later tests when a child cannot confirm stopping', async () => {
    const fake = fakes({ persistence: true });
    let time = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => time);
    const getRun = fake.deps.getRun;
    fake.deps.getRun = async id => ({ ...await getRun(id), state: 'running' });
    fake.deps.cancelRun = vi.fn().mockRejectedValue(new Error('cancel unavailable'));
    fake.deps.sleep = async () => { time += 60 * 60_000; };
    try {
      const result = await runAutoTest(newAutoTestSession({ id: 'a'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1 }), fake.deps, new AbortController().signal);
      expect(result.stage).toBe('failed');
      expect(result.error?.message).toContain('could not confirm stopping');
      expect(fake.missions).toHaveLength(1);
      expect(fake.deps.cancelRun).toHaveBeenCalledOnce();
    } finally { clock.mockRestore(); }
  });
  it('stops later tests when the explanation provider reports exhausted capacity', async () => {
    const fake = fakes({ persistence: true });
    fake.deps.explainFailure = vi.fn().mockRejectedValue(new ModelProviderError('Capacity unavailable', { code: 'quota_exhausted', retryable: false }));
    const original = fake.deps.getRun;
    fake.deps.getRun = async id => ({ ...await original(id), state: 'completed', verdict: 'failed' });
    const result = await runAutoTest(newAutoTestSession({ id: 'a'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1, suite: NO_SUITE }), fake.deps, new AbortController().signal);
    expect(result.stage).toBe('failed');
    expect(result.error?.reason).toBe('provider_paused');
    expect(fake.deps.explainFailure).toHaveBeenCalledOnce();
    expect(fake.missions).toHaveLength(1);
  });
  it('stops before launching the app when a progress checkpoint cannot be saved', async () => {
    const fake = fakes();
    fake.deps.save = vi.fn().mockRejectedValue(new Error('progress unavailable'));
    await expect(runAutoTest(newAutoTestSession({ id: 'a'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo' }), fake.deps, new AbortController().signal))
      .rejects.toThrow('progress unavailable');
    expect(fake.launches).toHaveLength(0);
    expect(fake.missions).toHaveLength(0);
  });
  it('runs every test in isolated parallel lanes and summarises from Run verdicts', async () => {
    // The fifth run confirms the failed test.
    const fake = fakes({ verdicts: ['passed', 'failed', 'passed', 'passed', 'failed'] });
    const session = await runAutoTest(newAutoTestSession({ id: 'a'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', suite: NO_SUITE }), fake.deps, new AbortController().signal);
    expect(session.stage).toBe('completed');
    expect(session.lanes.map(lane => lane.id)).toEqual(['lane-1', 'lane-2', 'lane-3']);
    expect(new Set(session.tests.map(test => test.laneId)).size).toBe(3);
    expect(session.summary).toMatchObject({ passed: 3, failed: 1, blocked: 0 });
    expect(session.tests.find(test => test.state === 'failed')?.explanation).toContain('server.js:45');
    // Each lane test after the first restarts that lane's app on the same port, and every app is stopped.
    expect(fake.launches.filter(launch => launch.port !== undefined)).toHaveLength(2);
    expect(fake.stopped.length).toBe(fake.launches.length);
    // Every run is prepared before and cleaned after, including the confirming run.
    expect(fake.data.filter(entry => entry.startsWith('preparation'))).toHaveLength(5);
    expect(fake.data.filter(entry => entry.startsWith('cleanup'))).toHaveLength(5);
    // Missions point at the lane's own app.
    expect(new Set(fake.missions.map(mission => new URL(mission.targetUrl).port)).size).toBe(3);
    expect(fake.saved.at(-1)?.stage).toBe('completed');
  });

  it('falls back to one lane when the app keeps data outside its process or ignores PORT', async () => {
    for (const option of [{ persistence: true }, { portHonored: false }]) {
      const session = await runAutoTest(newAutoTestSession({ id: 'b'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', suite: NO_SUITE }), fakes(option).deps, new AbortController().signal);
      expect(session.lanes).toHaveLength(1);
      expect(session.laneNote).toBeTruthy();
      expect(session.summary?.limitations).toContain(session.laneNote);
    }
  });

  it('reports blocked runs honestly and fails with the start-up log when the app cannot start', async () => {
    const blocked = await runAutoTest(newAutoTestSession({ id: 'c'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1, suite: NO_SUITE }), fakes({ verdicts: ['blocked'], tests: 2 }).deps, new AbortController().signal);
    expect(blocked.summary).toMatchObject({ passed: 0, failed: 0, blocked: 2 });
    const failed = await runAutoTest(newAutoTestSession({ id: 'd'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', suite: NO_SUITE }), fakes({ failLaunch: true }).deps, new AbortController().signal);
    expect(failed).toMatchObject({ stage: 'failed', error: { message: 'Missing DATABASE_URL' } });
  });

  it('fails clearly when the AI writes no usable test', async () => {
    const fake = fakes();
    fake.deps.generate = async () => ({ tests: [signInTest({ controls: [{ selector: '#nope', actions: ['click'] }] })] });
    const session = await runAutoTest(newAutoTestSession({ id: 'e'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', suite: NO_SUITE }), fake.deps, new AbortController().signal);
    expect(session).toMatchObject({ stage: 'failed', dropped: [{ reason: 'A required control or action was unavailable or duplicated.' }] });
    expect(fake.stopped).toHaveLength(1);
  });

  it('cancels running work and stops every app', async () => {
    const fake = fakes({ tests: 4 });
    const controller = new AbortController();
    const getRun = fake.deps.getRun;
    fake.deps.getRun = async id => { controller.abort(); const run = fake.runs.get(id)!; return run.state === 'cancelled' ? structuredClone(run) : { ...structuredClone(run), state: 'running' } as DynamicRun; };
    void getRun;
    const session = await runAutoTest(newAutoTestSession({ id: 'f'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', suite: NO_SUITE }), fake.deps, controller.signal);
    expect(session.stage).toBe('cancelled');
    expect(session.tests.every(test => test.state === 'cancelled')).toBe(true);
    expect(fake.stopped.length).toBe(fake.launches.length);
  });
});

describe('Auto test routes', () => {
  const route = (method: string, pathname: string, body: Record<string, unknown> = {}, extra: Partial<Parameters<typeof handleAutoTestRoute>[1]> = {}) => handleAutoTestRoute(
    { method, pathname, readBody: async () => body },
    { ownerId: 'u', store: new MemoryAutoTestStore(), runtime: new AutoTestRuntime(), requireMember: async () => undefined, defaultFolder: async () => process.cwd(), createDeps: async () => fakes().deps, ...extra },
  );

  it.each(['ask', 'auto'] as const)('publishes an owner-only startup question and accepts one matching answer in %s mode', async startupPermission => {
    const store = new MemoryAutoTestStore();
    const runtime = new AutoTestRuntime();
    const fake = fakes({ tests: 1 });
    const installed = vi.fn();
    const launch = fake.deps.launch;
    fake.deps.launch = async input => {
      if (!await input.approveInstall?.({ command: 'npm ci', packages: ['vite'], packageCount: 1 })) throw new LaunchError('install_declined', 'Installation paused');
      installed();
      return launch(input);
    };
    const root = `/projects/${PROJECT}/dynamic/autonomous`;
    const deps = { store, runtime, createDeps: async () => ({ ...fake.deps, save: (session: AutoTestSession) => store.save(session) }) };
    const started = await route('POST', root, { startupPermission, lanes: 1 }, deps) as { status: number; body: AutoTestSession };
    const url = `${root}/${started.body.id}`;
    try {
      const question = await vi.waitFor(async () => {
        const current = await route('GET', url, {}, deps) as { body: AutoTestSession };
        expect(current.body.startupQuestion).toMatchObject({ command: 'npm ci', packages: ['vite'] });
        return current.body.startupQuestion!;
      });
      expect(installed).not.toHaveBeenCalled();
      expect((await route('GET', url, {}, { ...deps, ownerId: 'other' }) as { body: AutoTestSession }).body.startupQuestion).toBeUndefined();
      expect(await route('POST', `${url}/startup-answer`, { questionId: question.id, choice: 'install' }, { ...deps, ownerId: 'other' })).toMatchObject({ status: 403 });
      expect(await route('POST', `${url}/startup-answer`, { questionId: 'stale', choice: 'install' }, deps)).toMatchObject({ status: 409 });
      expect(await route('POST', `${url}/startup-answer`, { questionId: question.id, choice: 'install' }, deps)).toMatchObject({ status: 202 });
      expect(await route('POST', `${url}/startup-answer`, { questionId: question.id, choice: 'install' }, deps)).toMatchObject({ status: 409 });
      await vi.waitFor(() => expect(installed).toHaveBeenCalledOnce());
    } finally { await runtime.stopAll(); }
  });

  it('rejects non-members before anything else, including the live stream', async () => {
    const requireMember = vi.fn(async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); });
    await expect(route('GET', `/projects/${PROJECT}/dynamic/autonomous/${'a'.repeat(8)}-aaaa-4aaa-8aaa-${'a'.repeat(12)}/live`, {}, { requireMember })).rejects.toThrow('Forbidden');
    await expect(route('POST', `/projects/${PROJECT}/dynamic/autonomous`, { folder: process.cwd() }, { requireMember })).rejects.toThrow('Forbidden');
  });

  it('starts a session for a real folder, refuses missing folders and a second concurrent run', async () => {
    const store = new MemoryAutoTestStore(); const runtime = new AutoTestRuntime();
    let release: () => void = () => undefined;
    const slow = fakes(); slow.deps.digest = () => new Promise(resolve => { release = () => resolve(digest()); });
    const deps = { store, runtime, createDeps: async () => slow.deps };
    const started = await route('POST', `/projects/${PROJECT}/dynamic/autonomous`, { folder: process.cwd(), lanes: 2 }, deps) as { status: number; body: AutoTestSession };
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ laneLimit: 2, stage: 'reading' });
    expect(await route('POST', `/projects/${PROJECT}/dynamic/autonomous`, { folder: process.cwd() }, deps)).toMatchObject({ status: 409 });
    expect(await route('POST', `/projects/${PROJECT}/dynamic/autonomous`, { folder: '/definitely/missing' }, deps)).toMatchObject({ status: 400 });
    expect(await route('POST', `/projects/${PROJECT}/dynamic/autonomous`, { folder: 'relative/path' }, deps)).toMatchObject({ status: 400 });
    expect(await route('GET', `/projects/${PROJECT}/dynamic/autonomous/${started.body.id}/live`, {}, deps)).toEqual({ live: { projectId: PROJECT, sessionId: started.body.id } });
    release();
    await runtime.cancel(started.body.id);
  });

  it('marks a session left running by a restarted sidecar as interrupted', async () => {
    const store = new MemoryAutoTestStore();
    const stale = newAutoTestSession({ id: '22222222-2222-4222-8222-222222222222', projectId: PROJECT, ownerId: 'u', folder: '/repo' });
    stale.stage = 'testing';
    stale.tests = [{ id: 't', name: 'x', goal: 'g', rationale: '', requirementRef: null, sourceRefs: [], checks: [], startPath: '/', state: 'running' }];
    await store.save(stale);
    const response = await route('GET', `/projects/${PROJECT}/dynamic/autonomous/${stale.id}`, {}, { store }) as { body: AutoTestSession };
    expect(response.body).toMatchObject({ stage: 'failed', error: { reason: 'interrupted' }, tests: [{ state: 'not_tested' }] });
  });
});

describe('Auto test from the project conversation', () => {
  const request = (text: string, extra: Partial<AutoTestRequest> = {}): AutoTestRequest => ({ text, base: null, history: [], ...extra });

  it('writes the prompt around the person’s request, reuses earlier messages and allows their test data', () => {
    const prompt = buildPlanPrompt({ ...ctx, request: request('Test that a wrong password shows the generic error', { history: ['Use admin@test.com / test123'] }) });
    expect(prompt).toContain('"""Test that a wrong password shows the generic error"""');
    expect(prompt).toContain('- Use admin@test.com / test123');
    expect(prompt).toContain('given by the person');
    expect(prompt).not.toContain('Cover the most important user journeys');
  });

  it('asks for one complete revision when changing an existing test', () => {
    const base: AutoTestPreset = { name: 'Coupon', goal: 'Apply SAVE10', startPath: '/', requirementRef: null, sourceRefs: [], checks: [{ id: 'c1', criterionId: 'x', description: 'Total', required: true, kind: 'visible_text', expected: '$10.80' }], controls: [{ selector: '#discount-code', actions: ['type'] }] };
    const prompt = buildPlanPrompt({ ...ctx, request: request('Also check an expired code', { base }) });
    expect(prompt).toContain('Return ONE complete revised test');
    expect(prompt).toContain('visible_text = $10.80');
  });

  it('runs at most three tests for a request and keeps the model reply and test controls', async () => {
    const fake = fakes();
    fake.deps.generate = async () => ({ reply: 'I wrote a test for the sign-in error.', tests: Array.from({ length: 5 }, (_, index) => signInTest({ name: `Test ${index + 1}` })) });
    const session = await runAutoTest(newAutoTestSession({ id: '3'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1, request: request('Test sign-in errors') }), fake.deps, new AbortController().signal);
    expect(session.stage).toBe('completed');
    expect(session.tests).toHaveLength(3);
    expect(session.reply).toBe('I wrote a test for the sign-in error.');
    expect(session.tests[0].controls?.map(control => control.selector)).toContain('#email');
    expect(presetFromEntry(session.tests[0])).toMatchObject({ name: 'Test 1', startPath: '/' });
  });

  it('marks only clicked controls repeatable, and passes that to the environment', async () => {
    const plan = validatePlan({ tests: [signInTest({ controls: [{ selector: '#email', actions: ['type'], repeatable: true }, { selector: '#signin-form button[type="submit"]', actions: ['click'], repeatable: true }] })] }, ctx);
    expect(plan.tests[0].controls).toEqual([{ selector: '#email', actions: ['type'] }, { selector: '#signin-form button[type="submit"]', actions: ['click'], repeatable: true }]);
    const fake = fakes({ tests: 1 });
    const saved: unknown[] = [];
    const saveEnvironment = fake.deps.saveEnvironment;
    fake.deps.saveEnvironment = async (value, id) => { saved.push(value.actionPolicy); return saveEnvironment(value, id); };
    fake.deps.generate = async () => ({ reply: '', tests: [signInTest({ controls: [{ selector: '#signin-form button[type="submit"]', actions: ['click'], repeatable: true }] })] });
    await runAutoTest(newAutoTestSession({ id: '9'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1, request: request('Click sign in twice') }), fake.deps, new AbortController().signal);
    expect(saved[0]).toMatchObject({ interactions: [{ selector: '#signin-form button[type="submit"]', actions: ['click'], repeatable: true }] });
  });

  it('answers a question in words and runs nothing', async () => {
    const fake = fakes();
    fake.deps.generate = async () => ({ reply: 'That needs a database check, which the browser cannot see.', tests: [] });
    const session = await runAutoTest(newAutoTestSession({ id: '4'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', request: request('Is the database encrypted?') }), fake.deps, new AbortController().signal);
    expect(session).toMatchObject({ stage: 'completed', tests: [], reply: 'That needs a database check, which the browser cannot see.' });
    expect(fake.runs.size).toBe(0);
    expect(fake.stopped.length).toBe(fake.launches.length);
  });

  it('runs saved tests again without exploring or asking the model', async () => {
    const fake = fakes();
    const generate = vi.fn(fake.deps.generate); const discover = vi.fn(fake.deps.discover);
    fake.deps.generate = generate; fake.deps.discover = discover;
    const preset: AutoTestPreset = { name: 'Saved sign-in', goal: 'Sign in', startPath: '/', requirementRef: 'REQ-1', sourceRefs: [], checks: [{ id: 'c1', criterionId: 'REQ-1', description: 'Error', required: true, kind: 'url', expected: 'http://localhost:1234/login' }], controls: [{ selector: '#email', actions: ['type'] }] };
    const session = await runAutoTest(newAutoTestSession({ id: '5'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1, presets: [preset], planning: false }), fake.deps, new AbortController().signal);
    expect(generate).not.toHaveBeenCalled();
    expect(discover).not.toHaveBeenCalled();
    expect(session.tests.map(test => test.name)).toEqual(['Saved sign-in']);
    // The saved URL check is moved to the app's current address.
    expect(fake.missions[0].checks[0]).toMatchObject({ expected: `${new URL(fake.missions[0].targetUrl).origin}/login` });
  });

  it('reruns saved assertion-only tests without adding fixed suite tests', async () => {
    const entry: Parameters<typeof presetFromEntry>[0] = {
      id: 'assertion-only', name: 'Welcome page appears', goal: 'Check the current page.', rationale: '', requirementRef: null,
      sourceRefs: [], checks: [{ id: 'c1', criterionId: 'REQ-1', description: 'Welcome text appears.', required: true, kind: 'visible_text', expected: 'Welcome' }],
      startPath: '/', state: 'failed', controls: [],
    };
    const preset = presetFromEntry(entry);
    expect(preset).toMatchObject({ name: entry.name, controls: [] });
    if (!preset) throw new Error('Assertion-only saved test was not reusable.');
    for (const kind of ['smoke', 'exploratory', 'usability', 'unit'] as const) {
      expect(presetFromEntry({ ...entry, kind })).toBeNull();
    }

    const fake = fakes();
    const generate = vi.fn(fake.deps.generate);
    const discover = vi.fn(fake.deps.discover);
    fake.deps.generate = generate;
    fake.deps.discover = discover;
    const policies: unknown[] = [];
    const saveEnvironment = fake.deps.saveEnvironment;
    fake.deps.saveEnvironment = async (environment, id) => {
      policies.push(environment.actionPolicy);
      return saveEnvironment(environment, id);
    };
    const session = await runAutoTest(newAutoTestSession({ id: '5b'.repeat(18), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1, presets: [preset], planning: false }), fake.deps, new AbortController().signal);

    expect(session.stage).toBe('completed');
    expect(session.suite).toBeUndefined();
    expect(session.tests.map(test => test.name)).toEqual([entry.name]);
    expect(session.tests[0].controls).toEqual([]);
    expect(fake.missions[0].checks).toMatchObject([{ kind: 'visible_text', expected: 'Welcome' }]);
    expect(policies[0]).toMatchObject({ interactions: [] });
    expect(discover).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('validates conversation requests and loads the test being changed', async () => {
    const store = new MemoryAutoTestStore(); const runtime = new AutoTestRuntime();
    const earlier = newAutoTestSession({ id: '66666666-6666-4666-8666-666666666666', projectId: PROJECT, ownerId: 'u', folder: '/repo', request: request('Use admin@test.com / test123') });
    earlier.stage = 'completed';
    earlier.tests = [{ id: '77777777-7777-4777-8777-777777777777', name: 'Coupon', goal: 'Apply SAVE10', rationale: '', requirementRef: null, sourceRefs: [], startPath: '/', state: 'passed',
      checks: [{ id: 'c1', criterionId: 'x', description: 'Total', required: true, kind: 'visible_text', expected: '$10.80' }], controls: [{ selector: '#discount-code', actions: ['type'] }] }];
    await store.save(earlier);
    let created: AutoTestSession | null = null;
    const deps = { store, runtime, createDeps: async (_project: string, session: AutoTestSession) => { created = session; return fakes().deps; } };
    const url = `/projects/${PROJECT}/dynamic/autonomous`;
    expect(await route('POST', url, { folder: process.cwd(), request: '   ' }, deps)).toMatchObject({ status: 400 });
    expect(await route('POST', url, { folder: process.cwd(), base: { sessionId: earlier.id, testId: earlier.tests[0].id } }, deps)).toMatchObject({ status: 400 });
    expect(await route('POST', url, { folder: process.cwd(), request: 'x', base: { sessionId: earlier.id, testId: '88888888-8888-4888-8888-888888888888' } }, deps)).toMatchObject({ status: 404 });
    const started = await route('POST', url, { folder: process.cwd(), request: 'Also check an expired code', base: { sessionId: earlier.id, testId: earlier.tests[0].id } }, deps) as { status: number; body: AutoTestSession };
    expect(started.status).toBe(202);
    expect(created!.laneLimit).toBe(1);
    expect(created!.request).toMatchObject({ text: 'Also check an expired code', base: { name: 'Coupon' }, history: ['Use admin@test.com / test123'] });
    await runtime.cancel(started.body.id);
  });

  function route(method: string, pathname: string, body: Record<string, unknown>, extra: Partial<Parameters<typeof handleAutoTestRoute>[1]>) {
    return handleAutoTestRoute({ method, pathname, readBody: async () => body },
      { ownerId: 'u', store: new MemoryAutoTestStore(), runtime: new AutoTestRuntime(), requireMember: async () => undefined, defaultFolder: async () => process.cwd(), createDeps: async () => fakes().deps, ...extra });
  }
});

describe('Full check fixed tests (smoke, exploratory, usability)', () => {
  const healthy = { status: 200, pageErrors: 0, consoleErrors: 0, serverErrors: 0, messages: [] };
  const scanned = (home = healthy, other = healthy): DiscoveryResult => ({
    controls: [
      { selector: '#discount-code', label: 'Discount', actions: ['type'], kind: 'Text field', page: '/' },
      { selector: 'a[href="/orders"]', label: 'Orders', actions: ['click'], kind: 'Link', page: '/' },
      { selector: '#buy', label: 'Buy now', actions: ['click'], kind: 'Button', page: '/' },
      { selector: '#logout', label: 'Log out', actions: ['click'], kind: 'Button', page: '/' },
      { selector: '#checkout', label: 'Place order', actions: ['click'], kind: 'Button', page: '/' },
    ],
    pages: [
      { url: 'http://localhost:6000/', finalUrl: 'http://localhost:6000/', controls: 4, redirected: false, health: home },
      { url: 'http://localhost:6000/orders', finalUrl: 'http://localhost:6000/orders', controls: 0, redirected: false, health: other },
    ],
  });
  function withSuite(discoveryResult: DiscoveryResult, usabilityFailures = 0) {
    const fake = fakes({ verdicts: ['passed'], tests: 1 });
    const healthRequests: Array<boolean | undefined> = [];
    fake.deps.discover = async (_url, _paths, options) => { healthRequests.push(options?.collectHealth); return discoveryResult; };
    const explain = vi.fn(async () => 'AI text');
    fake.deps.explainFailure = explain;
    const start = fake.deps.startRun;
    fake.deps.startRun = async input => {
      const id = await start(input);
      const mission = fake.missions.at(-1)!;
      const run = fake.runs.get(id)!;
      if (mission.mode === 'exploratory') run.exploration = {
        // The same Orders link appears on every screen; it is one control, not three.
        states: ['s1', 's2', 's3'].map(id => ({ id, controls: [{ ref: 'e1', role: 'link', name: 'Orders', selector: 'a[href="/orders"]' }, { ref: 'e2', role: 'textbox', name: 'Discount', selector: '#discount-code' }] })),
        actions: [{ status: 'dispatched', beforeStateId: 's1', targetRef: 'e1' }, { status: 'blocked', beforeStateId: 's2' }], unvisitedControls: [{}, {}, {}, {}, {}], truncated: false,
      } as unknown as DynamicRun['exploration'];
      if (mission.usability) run.usability = { schemaVersion: 1, config: mission.usability, keyboardActions: 3, assessedAt: '', limitations: ['Persona simulation is not a real-user study.'],
        observations: [
          ...Array.from({ length: usabilityFailures }, (_, index) => ({ ruleId: 'labels', persona: 'first_time', kind: 'deterministic', verdict: 'failed', expected: '', observed: '', controlRef: `c${index}`, evidenceIds: [] })),
          { ruleId: 'focus', persona: 'first_time', kind: 'deterministic', verdict: 'uncertain', expected: '', observed: '', controlRef: 'c9', evidenceIds: [] },
        ] } as unknown as DynamicRun['usability'];
      return id;
    };
    return { fake, healthRequests, explain };
  }

  it('adds a smoke test, one exploration and one usability run to a full check', async () => {
    const { fake, healthRequests, explain } = withSuite(scanned(healthy, { status: 500, pageErrors: 1, consoleErrors: 0, serverErrors: 0, messages: ['TypeError: x is undefined'] }), 2);
    const session = await runAutoTest(newAutoTestSession({ id: '5'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1 }), fake.deps, new AbortController().signal);
    expect(session.suite).toEqual({ smoke: true, exploratory: true, usability: true, unit: true });
    expect(healthRequests).toEqual([true]);
    expect(session.tests.map(test => [test.kind ?? 'planned', test.state])).toEqual([['smoke', 'failed'], ['exploratory', 'passed'], ['planned', 'passed'], ['usability', 'failed']]);
    const [smoke, explore, , usability] = session.tests;
    expect(smoke.smoke?.pages).toEqual([
      { path: '/', status: 200, ok: true, problem: null },
      { path: '/orders', status: 500, ok: false, problem: 'The page answered with HTTP 500. 1 script error on the page. First message: TypeError: x is undefined' },
    ]);
    expect(smoke.runId).toBeUndefined();
    const exploreMission = fake.missions.find(mission => mission.mode === 'exploratory')!;
    expect(exploreMission.maxSteps).toBe(25);
    expect(explore.exploration).toEqual({ screens: 3, actions: 1, untried: 0, outOfScope: 1, seen: 2, truncated: false });
    expect(explore.controls).toBeUndefined();
    expect(usability.usability?.failures).toEqual([{ rule: 'labels', expected: expect.any(String), observed: '2 controls have no label or name.', count: 2 }]);
    expect(fake.missions.find(mission => mission.usability)?.usability).toMatchObject({ persona: 'first_time', rules: ['labels', 'keyboard', 'focus'] });
    expect(explain).not.toHaveBeenCalled();
    expect(presetFromEntry(usability)).toBeNull();
    expect(session.tests.filter(test => test.kind).every(test => presetFromEntry(test) === null)).toBe(true);
    expect(session.summary).toMatchObject({ passed: 2, failed: 2 });
    expect(session.summary?.limitations.join(' ')).toMatch(/Exploration is bounded/);
  });

  it('lets the exploration click only safe controls', async () => {
    const { fake } = withSuite(scanned());
    const policies: unknown[] = [];
    const save = fake.deps.saveEnvironment;
    fake.deps.saveEnvironment = async (value, id) => { policies.push(value.actionPolicy); return save(value, id); };
    await runAutoTest(newAutoTestSession({ id: '6'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1 }), fake.deps, new AbortController().signal);
    expect(policies[0]).toMatchObject({ interactions: [{ selector: 'a[href="/orders"]', actions: ['click'], repeatable: true }] });
  });

  it('stops before writing tests when the first page answers with a server error', async () => {
    const { fake } = withSuite(scanned({ status: 502, pageErrors: 0, consoleErrors: 0, serverErrors: 0, messages: [] }));
    const generate = vi.fn(fake.deps.generate);
    fake.deps.generate = generate;
    const session = await runAutoTest(newAutoTestSession({ id: '7'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo' }), fake.deps, new AbortController().signal);
    expect(generate).not.toHaveBeenCalled();
    expect(fake.runs.size).toBe(0);
    expect(session.stage).toBe('completed');
    expect(session.tests.map(test => [test.kind, test.state])).toEqual([['smoke', 'failed']]);
    expect(session.summary).toMatchObject({ failed: 1 });
  });

  it('runs no fixed tests for a typed request', async () => {
    const session = newAutoTestSession({ id: '8'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', request: { text: 'Test sign-in', base: null, history: [] } });
    expect(session.suite).toBeUndefined();
  });
});

describe('Full check smoke result when planning fails', () => {
  it('keeps the smoke test result when the model is unavailable', async () => {
    const fake = fakes();
    fake.deps.discover = async () => ({ controls: [], pages: [{ url: 'http://localhost:6000/', finalUrl: 'http://localhost:6000/', controls: 0, redirected: false, health: { status: 200, pageErrors: 0, consoleErrors: 0, serverErrors: 0, messages: [] } }] });
    fake.deps.generate = async () => { throw new Error('The selected Codex model is unavailable.'); };
    const session = await runAutoTest(newAutoTestSession({ id: '9a'.repeat(18), projectId: PROJECT, ownerId: 'u', folder: '/repo' }), fake.deps, new AbortController().signal);
    expect(session.stage).toBe('failed');
    expect(session.tests.map(test => [test.kind, test.state])).toEqual([['smoke', 'passed']]);
  });
});

describe('Full check project unit tests', () => {
  const summary = (outcome: UnitSummary['outcome'], failures: UnitSummary['failures'] = []): UnitSummary => ({ outcome, script: 'test:unit', framework: 'Vitest 3.2.4', counts: { total: 3, passed: 3 - failures.length, failed: failures.length, skipped: 0 }, failures, reason: 'r' });
  it('runs them beside the browser tests and records Vitest’s own result', async () => {
    const fake = fakes({ verdicts: ['passed'], tests: 1 });
    const folders: string[] = [];
    fake.deps.runUnitTests = async ({ folder }) => { folders.push(folder); return summary('failed', [{ file: 'src/a.test.ts', name: 'adds', message: 'expected 2 to be 3' }]); };
    const session = await runAutoTest(newAutoTestSession({ id: 'ab'.repeat(18), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1, suite: { smoke: false, exploratory: false, usability: false, unit: true } }), fake.deps, new AbortController().signal);
    expect(folders).toEqual(['/repo']);
    const unit = session.tests.find(test => test.kind === 'unit')!;
    expect(unit).toMatchObject({ state: 'failed', name: 'Project unit tests', unit: { failures: [{ file: 'src/a.test.ts' }] } });
    expect(presetFromEntry(unit)).toBeNull();
    expect(session.summary).toMatchObject({ passed: 1, failed: 1 });
  });

  it('reports an unsupported test setup as not tested, never as a pass', async () => {
    const fake = fakes({ verdicts: ['passed'], tests: 1 });
    fake.deps.runUnitTests = async () => ({ ...summary('unsupported'), counts: null });
    const session = await runAutoTest(newAutoTestSession({ id: 'ac'.repeat(18), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1, suite: { smoke: false, exploratory: false, usability: false, unit: true } }), fake.deps, new AbortController().signal);
    expect(session.tests.find(test => test.kind === 'unit')?.state).toBe('not_tested');
  });

  it('picks a plain Vitest script and ignores shell-wrapped ones', () => {
    expect(vitestScript({ scriptNames: ['test', 'test:unit', 'test:unit:ci', 'lint'], scriptDefinitions: { test: 'yarn cypress:open', 'test:unit': 'vitest', 'test:unit:ci': 'vitest --run', lint: 'eslint .' } })).toBe('test:unit:ci');
    expect(vitestScript({ scriptNames: ['test'], scriptDefinitions: { test: 'vitest --coverage && echo done' } })).toBeNull();
    expect(vitestScript({ scriptNames: ['test'], scriptDefinitions: { test: 'jest' } })).toBeNull();
  });
});


describe('Covering more of the app (19 Nov 2026)', () => {
  it('lets ordinary buttons be pressed more than once, but keeps one click for orders, payment and submit', () => {
    expect(autoRepeatable({ selector: '#product-list > li:nth-of-type(1) > button', actions: ['click'] }, 'Add to cart — Ceramic Mug')).toBe(true);
    expect(autoRepeatable({ selector: '#checkout', actions: ['click'] }, 'Place order')).toBe(false);
    expect(autoRepeatable({ selector: '#pay', actions: ['click'] }, 'Pay now')).toBe(false);
    expect(autoRepeatable({ selector: 'form button[type="submit"]', actions: ['click'] }, undefined)).toBe(false);
    expect(autoRepeatable({ selector: '#email', actions: ['type'] }, 'Email')).toBe(false);
  });

  it('passes the repeat-click rule to each test’s permissions', async () => {
    const fake = fakes({ tests: 1 });
    fake.deps.discover = async () => ({ ...discovery, controls: [...discovery.controls, { selector: '#signin-form button[type="submit"]', label: 'Sign in', actions: ['click'], kind: 'Button', page: '/' }] });
    const saved: unknown[] = [];
    const save = fake.deps.saveEnvironment;
    fake.deps.saveEnvironment = async (value, id) => { saved.push(value.actionPolicy); return save(value, id); };
    await runAutoTest(newAutoTestSession({ id: 'ad'.repeat(18), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1, suite: NO_SUITE }), fake.deps, new AbortController().signal);
    expect(saved[0]).toMatchObject({ interactions: expect.arrayContaining([{ selector: '#signin-form button[type="submit"]', actions: ['click'], repeatable: true }, { selector: '#email', actions: ['type'] }]) });
  });

  it('runs a test that could not run once more on a fresh app, and keeps the first attempt', async () => {
    const fake = fakes({ verdicts: ['blocked', 'passed'], tests: 1 });
    const session = await runAutoTest(newAutoTestSession({ id: 'ae'.repeat(18), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1, suite: NO_SUITE }), fake.deps, new AbortController().signal);
    const [entry] = session.tests;
    expect(entry.state).toBe('passed');
    expect(entry.firstAttempt).toMatchObject({ runId: 'run-1', reason: null, state: 'blocked' });
    expect(entry.runId).toBe('run-2');
    expect([...fake.runs.values()].map(run => run.idempotencyKey)).toEqual([`autotest:aeaeaeae:${entry.id}`, `autotest:aeaeaeae:${entry.id}:retry`]);
    const twice = fakes({ verdicts: ['blocked'], tests: 1 });
    const again = await runAutoTest(newAutoTestSession({ id: 'af'.repeat(18), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1, suite: NO_SUITE }), twice.deps, new AbortController().signal);
    expect(again.tests[0].state).toBe('blocked');
    expect(twice.runs.size).toBe(2);
  });

  it('splits the buttons across up to three explorations that share the navigation links', () => {
    const controls = [
      { selector: 'a[href="/orders"]', label: 'Orders', actions: ['click'], kind: 'Link', page: '/' },
      ...Array.from({ length: 9 }, (_, index) => ({ selector: `#b${index}`, label: `Add ${index}`, actions: ['click'], kind: 'Button', page: '/' })),
      { selector: '#checkout', label: 'Place order', actions: ['click'], kind: 'Button', page: '/' },
    ] as DiscoveryResult['controls'];
    const runs = exploratoryTests({ appUrl: 'http://localhost:5000', projectId: PROJECT, discovery: { controls, pages: [] } });
    expect(runs.map(run => run.name)).toEqual(['Explore the app (1 of 3)', 'Explore the app (2 of 3)', 'Explore the app (3 of 3)']);
    const buttons = runs.map(run => run.controls.map(control => control.selector).filter(selector => selector.startsWith('#b')));
    expect(buttons).toEqual([['#b0', '#b1', '#b2'], ['#b3', '#b4', '#b5'], ['#b6', '#b7', '#b8']]);
    expect(runs.every(run => run.controls.some(control => control.selector === 'a[href="/orders"]'))).toBe(true);
    expect(JSON.stringify(runs)).not.toContain('#checkout');
    expect(runs.every(run => run.mission.mode === 'exploratory' && !run.goal.includes('Add 0'))).toBe(true);
  });

  it('confirms a failure with a second run; one failure and one pass is unclear, not a problem', async () => {
    const twice = fakes({ verdicts: ['failed'], tests: 1 });
    const confirmed = await runAutoTest(newAutoTestSession({ id: 'b1'.repeat(18), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1, suite: NO_SUITE }), twice.deps, new AbortController().signal);
    expect(confirmed.tests[0]).toMatchObject({ state: 'failed', runId: 'run-2', firstAttempt: { state: 'failed', runId: 'run-1' } });
    expect(twice.runs.size).toBe(2);
    const flaky = fakes({ verdicts: ['failed', 'passed'], tests: 1 });
    const unclear = await runAutoTest(newAutoTestSession({ id: 'b2'.repeat(18), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1, suite: NO_SUITE }), flaky.deps, new AbortController().signal);
    expect(unclear.tests[0].state).toBe('uncertain');
    expect(unclear.tests[0].reason).toContain('failed once and passed once');
    expect(unclear.summary).toMatchObject({ failed: 0, uncertain: 1 });
    const lost = fakes({ verdicts: ['failed', 'blocked'], tests: 1 });
    const kept = await runAutoTest(newAutoTestSession({ id: 'b3'.repeat(18), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1, suite: NO_SUITE }), lost.deps, new AbortController().signal);
    expect(kept.tests[0]).toMatchObject({ state: 'failed', runId: 'run-1' });
  });

  it('asks the plan for text the page can show and exact click counts', () => {
    const prompt = buildPlanPrompt({ appUrl: 'http://localhost:5000', digest: digest(), discovery });
    expect(prompt).toContain('Do not expect error messages from server routes the page never calls');
    expect(prompt).toContain('Say exactly how many times to press each control');
  });
});
