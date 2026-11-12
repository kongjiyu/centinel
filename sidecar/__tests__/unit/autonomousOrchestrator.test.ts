import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryResult } from '../../src/dynamic/environment/controlDiscovery.js';
import type { EnvironmentProfile } from '../../src/dynamic/environment/types.js';
import type { DynamicRun, MissionInput } from '../../src/dynamic/types.js';
import type { LaunchedApp } from '../../src/dynamic/autonomous/launcher.js';
import { buildPlanPrompt, knownSelectors, validatePlan } from '../../src/dynamic/autonomous/planner.js';
import { newAutoTestSession, runAutoTest, scanPaths, type AutoTestDeps, type AutoTestSession } from '../../src/dynamic/autonomous/orchestrator.js';
import { handleAutoTestRoute, AutoTestRuntime } from '../../src/dynamic/autonomous/routes.js';
import { MemoryAutoTestStore } from '../../src/dynamic/autonomous/store.js';
import type { RepoDigest } from '../../src/dynamic/autonomous/repoDigest.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
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
  it('runs every test in isolated parallel lanes and summarises from Run verdicts', async () => {
    const fake = fakes();
    const session = await runAutoTest(newAutoTestSession({ id: 'a'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo' }), fake.deps, new AbortController().signal);
    expect(session.stage).toBe('completed');
    expect(session.lanes.map(lane => lane.id)).toEqual(['lane-1', 'lane-2', 'lane-3']);
    expect(new Set(session.tests.map(test => test.laneId)).size).toBe(3);
    expect(session.summary).toMatchObject({ passed: 3, failed: 1, blocked: 0 });
    expect(session.tests.find(test => test.state === 'failed')?.explanation).toContain('server.js:45');
    // Each lane test after the first restarts that lane's app on the same port, and every app is stopped.
    expect(fake.launches.filter(launch => launch.port !== undefined)).toHaveLength(1);
    expect(fake.stopped.length).toBe(fake.launches.length);
    // Every run is prepared before and cleaned after.
    expect(fake.data.filter(entry => entry.startsWith('preparation'))).toHaveLength(4);
    expect(fake.data.filter(entry => entry.startsWith('cleanup'))).toHaveLength(4);
    // Missions point at the lane's own app.
    expect(new Set(fake.missions.map(mission => new URL(mission.targetUrl).port)).size).toBe(3);
    expect(fake.saved.at(-1)?.stage).toBe('completed');
  });

  it('falls back to one lane when the app keeps data outside its process or ignores PORT', async () => {
    for (const option of [{ persistence: true }, { portHonored: false }]) {
      const session = await runAutoTest(newAutoTestSession({ id: 'b'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo' }), fakes(option).deps, new AbortController().signal);
      expect(session.lanes).toHaveLength(1);
      expect(session.laneNote).toBeTruthy();
      expect(session.summary?.limitations).toContain(session.laneNote);
    }
  });

  it('reports blocked runs honestly and fails with the start-up log when the app cannot start', async () => {
    const blocked = await runAutoTest(newAutoTestSession({ id: 'c'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo', lanes: 1 }), fakes({ verdicts: ['blocked'], tests: 2 }).deps, new AbortController().signal);
    expect(blocked.summary).toMatchObject({ passed: 0, failed: 0, blocked: 2 });
    const failed = await runAutoTest(newAutoTestSession({ id: 'd'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo' }), fakes({ failLaunch: true }).deps, new AbortController().signal);
    expect(failed).toMatchObject({ stage: 'failed', error: { message: 'Missing DATABASE_URL' } });
  });

  it('fails clearly when the AI writes no usable test', async () => {
    const fake = fakes();
    fake.deps.generate = async () => ({ tests: [signInTest({ controls: [{ selector: '#nope', actions: ['click'] }] })] });
    const session = await runAutoTest(newAutoTestSession({ id: 'e'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo' }), fake.deps, new AbortController().signal);
    expect(session).toMatchObject({ stage: 'failed', dropped: [{ reason: 'Used controls Centinel did not find in the app.' }] });
    expect(fake.stopped).toHaveLength(1);
  });

  it('cancels running work and stops every app', async () => {
    const fake = fakes({ tests: 4 });
    const controller = new AbortController();
    const getRun = fake.deps.getRun;
    fake.deps.getRun = async id => { controller.abort(); const run = fake.runs.get(id)!; return run.state === 'cancelled' ? structuredClone(run) : { ...structuredClone(run), state: 'running' } as DynamicRun; };
    void getRun;
    const session = await runAutoTest(newAutoTestSession({ id: 'f'.repeat(36), projectId: PROJECT, ownerId: 'u', folder: '/repo' }), fake.deps, controller.signal);
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
