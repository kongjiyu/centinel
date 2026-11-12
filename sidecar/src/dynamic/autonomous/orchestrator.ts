import type { DiscoveryResult } from '../environment/controlDiscovery.js';
import type { EnvironmentInput, EnvironmentProfile } from '../environment/types.js';
import type { CheckDefinition, CheckResult, DynamicRun, MissionInput } from '../types.js';
import type { LaunchedApp, LaunchEvent } from './launcher.js';
import { LaunchError } from './launcher.js';
import { AUTO_TEST_PLAN_SCHEMA, AUTO_TEST_SYSTEM_PROMPT, buildPlanPrompt, validatePlan, type AutoTest, type DroppedTest } from './planner.js';
import type { RepoDigest } from './repoDigest.js';

/**
 * Autonomous Dynamic testing: read a folder, start its app, plan tests, run them in
 * isolated parallel lanes through the ordinary Run pipeline, and summarise. All side
 * effects come through AutoTestDeps so the state machine is testable without a browser.
 */
export type AutoTestStage = 'reading' | 'starting' | 'exploring' | 'planning' | 'testing' | 'summarizing' | 'completed' | 'failed' | 'cancelled';
export type AutoTestState = 'queued' | 'running' | 'passed' | 'failed' | 'uncertain' | 'blocked' | 'not_tested' | 'cancelled';
export type AutoTestEntry = {
  id: string; name: string; goal: string; rationale: string; requirementRef: string | null;
  sourceRefs: Array<{ path: string; line: number }>; checks: CheckDefinition[]; startPath: string;
  state: AutoTestState; laneId?: string; missionId?: string; revisionId?: string; runId?: string;
  reason?: string | null; checkResults?: CheckResult[]; explanation?: string | null; startedAt?: string; finishedAt?: string;
};
export type AutoTestLane = { id: string; url: string | null; environmentId: string | null; state: 'starting' | 'idle' | 'running' | 'stopped' | 'failed'; currentTestId: string | null };
export type AutoTestSession = {
  schemaVersion: 1; id: string; projectId: string; ownerId: string; folder: string;
  createdAt: string; updatedAt: string; stage: AutoTestStage;
  error: { reason: string; message: string; log?: string } | null;
  repository: { fingerprint: string; files: number; routes: number; forms: number; requirements: boolean; truncated: boolean; persistence: string[] } | null;
  launch: { recipeId: string; label: string; framework: string; url: string | null; portHonored: boolean | null; installing: boolean; log: string } | null;
  exploration: { pages: Array<{ path: string; controls: number }>; controls: number } | null;
  lanes: AutoTestLane[]; laneLimit: number; laneNote: string | null;
  tests: AutoTestEntry[]; dropped: DroppedTest[];
  summary: { passed: number; failed: number; uncertain: number; blocked: number; notTested: number; limitations: string[] } | null;
};

export type AutoTestDeps = {
  digest(folder: string): Promise<RepoDigest>;
  launch(input: { folder: string; recipeId?: string; port?: number; signal: AbortSignal; onEvent?(event: LaunchEvent): void }): Promise<LaunchedApp>;
  discover(url: string, paths: string[]): Promise<DiscoveryResult>;
  generate(input: { systemPrompt: string; prompt: string; outputSchema: object; signal: AbortSignal }): Promise<unknown>;
  explainFailure?(input: { test: AutoTestEntry; run: DynamicRun; excerpts: string; signal: AbortSignal }): Promise<string | null>;
  saveEnvironment(input: EnvironmentInput, id?: string): Promise<EnvironmentProfile>;
  recordData(environmentId: string, kind: 'preparation' | 'cleanup', note: string): Promise<void>;
  saveMission(input: MissionInput): Promise<{ missionId: string; revisionId: string }>;
  startRun(input: { revisionId: string; environmentId: string; idempotencyKey: string; laneId: string }): Promise<string>;
  getRun(runId: string): Promise<DynamicRun>;
  cancelRun(runId: string): Promise<void>;
  save(session: AutoTestSession): Promise<void>;
  now?(): Date;
  sleep?(ms: number): Promise<void>;
};

export const DEFAULT_LANES = 3;
export const MAX_LANES = 4;
const TERMINAL_RUN = new Set(['completed', 'blocked', 'cancelled', 'interrupted']);
const RUN_POLL_MS = 1000;
const RUN_WAIT_LIMIT_MS = 6 * 60_000;

export function newAutoTestSession(input: { id: string; projectId: string; ownerId: string; folder: string; lanes?: number; now?: Date }): AutoTestSession {
  const at = (input.now ?? new Date()).toISOString();
  return {
    schemaVersion: 1, id: input.id, projectId: input.projectId, ownerId: input.ownerId, folder: input.folder,
    createdAt: at, updatedAt: at, stage: 'reading', error: null, repository: null, launch: null, exploration: null,
    lanes: [], laneLimit: Math.min(MAX_LANES, Math.max(1, Math.floor(input.lanes ?? DEFAULT_LANES))), laneNote: null,
    tests: [], dropped: [], summary: null,
  };
}

/** Pages worth scanning: page routes first, then GET server routes that are not APIs. */
export function scanPaths(digest: RepoDigest, limit = 19): string[] {
  const paths = new Set<string>();
  const usable = (path: string) => path.startsWith('/') && !/[:*{[(]/.test(path) && !/^\/api(\/|$)/.test(path) && path !== '/';
  for (const route of digest.routes) if (route.kind === 'page' && usable(route.path)) paths.add(route.path);
  for (const route of digest.routes) if (route.kind === 'server' && (!route.method || route.method === 'GET') && usable(route.path)) paths.add(route.path);
  return [...paths].slice(0, limit);
}

function verdictState(run: DynamicRun): AutoTestState {
  if (run.state === 'completed') return run.verdict === 'passed' ? 'passed' : run.verdict === 'failed' ? 'failed' : run.verdict === 'uncertain' ? 'uncertain' : 'not_tested';
  if (run.state === 'cancelled') return 'cancelled';
  return 'blocked';
}

function excerptsFor(test: AutoTestEntry, digest: RepoDigest): string {
  const wanted = new Set(test.sourceRefs.map(ref => ref.path));
  return digest.entries.filter(entry => wanted.has(entry.path)).map(entry => `--- ${entry.path}:${entry.startLine}\n${entry.text.slice(0, 3000)}`).join('\n').slice(0, 8000);
}

export async function runAutoTest(session: AutoTestSession, deps: AutoTestDeps, signal: AbortSignal): Promise<AutoTestSession> {
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const servers = new Map<string, LaunchedApp>();
  let saving = Promise.resolve();
  const persist = () => {
    session.updatedAt = now();
    const snapshot = structuredClone(session);
    saving = saving.then(() => deps.save(snapshot)).catch(() => undefined);
    return saving;
  };
  const stage = async (value: AutoTestStage) => { session.stage = value; await persist(); };
  const checkCancelled = () => { if (signal.aborted) throw new LaunchError('cancelled', 'Cancelled.'); };

  try {
    // 1. Read the repository.
    await stage('reading');
    const digest = await deps.digest(session.folder);
    session.repository = {
      fingerprint: digest.fingerprint, files: new Set(digest.entries.map(entry => entry.path)).size, routes: digest.routes.length,
      forms: digest.forms.length, requirements: !!digest.requirementsText, truncated: digest.truncated,
      persistence: digest.persistenceHints.map(hint => hint.detail).slice(0, 10),
    };
    checkCancelled();

    // 2. Start the app (lane 1).
    await stage('starting');
    let lastLog = 0;
    const firstLane: AutoTestLane = { id: 'lane-1', url: null, environmentId: null, state: 'starting', currentTestId: null };
    session.lanes = [firstLane];
    const first = await deps.launch({
      folder: session.folder, signal,
      onEvent: event => {
        if (event.stage === 'detected') session.launch = { recipeId: event.recipe.id, label: event.recipe.label, framework: event.recipe.framework, url: null, portHonored: null, installing: false, log: '' };
        else if (session.launch && (event.stage === 'installing' || event.stage === 'starting')) {
          session.launch.installing = event.stage === 'installing';
          session.launch.label = event.command;
          if (event.log) session.launch.log = event.log.slice(-4000);
          if (Date.now() - lastLog > 1000) { lastLog = Date.now(); void persist(); }
        }
      },
    });
    servers.set(firstLane.id, first);
    firstLane.url = first.server.url;
    firstLane.state = 'idle';
    if (session.launch) Object.assign(session.launch, { url: first.server.url, portHonored: first.server.portHonored, installing: false, log: first.server.logs().slice(-4000) });
    checkCancelled();

    // 3. Explore what the running app actually shows.
    await stage('exploring');
    const discovery = await deps.discover(first.server.url, scanPaths(digest));
    session.exploration = { pages: discovery.pages.map(page => ({ path: new URL(page.finalUrl).pathname, controls: page.controls })), controls: discovery.controls.length };
    checkCancelled();

    // 4. Plan tests.
    await stage('planning');
    const raw = await deps.generate({ systemPrompt: AUTO_TEST_SYSTEM_PROMPT, prompt: buildPlanPrompt({ appUrl: first.server.url, digest, discovery }), outputSchema: AUTO_TEST_PLAN_SCHEMA, signal });
    const plan = validatePlan(raw, { appUrl: first.server.url, projectId: session.projectId, digest, discovery });
    session.dropped = plan.dropped;
    const byId = new Map<string, AutoTest>(plan.tests.map(test => [test.id, test]));
    session.tests = plan.tests.map(test => ({
      id: test.id, name: test.name, goal: test.goal, rationale: test.rationale, requirementRef: test.requirementRef,
      sourceRefs: test.sourceRefs, checks: test.mission.checks, startPath: test.startPath, state: 'queued',
    }));
    if (!session.tests.length) throw new LaunchError('unsupported', 'The AI could not write any usable test for this app.');
    checkCancelled();

    // 5. Lanes: each gets its own app instance so tests never share in-memory state.
    await stage('testing');
    let laneCount = Math.min(session.laneLimit, session.tests.length);
    if (laneCount > 1 && digest.persistenceHints.length) { laneCount = 1; session.laneNote = 'The app keeps data outside its own process (a database or file), so tests run one at a time to avoid sharing state.'; }
    else if (laneCount > 1 && !first.server.portHonored) { laneCount = 1; session.laneNote = 'The app always uses the same port, so only one copy can run at a time.'; }
    for (let index = 2; index <= laneCount; index++) {
      const lane: AutoTestLane = { id: `lane-${index}`, url: null, environmentId: null, state: 'starting', currentTestId: null };
      session.lanes.push(lane);
      try {
        const app = await deps.launch({ folder: session.folder, recipeId: first.recipe.id, signal });
        servers.set(lane.id, app);
        lane.url = app.server.url;
        lane.state = 'idle';
      } catch (error) {
        if (signal.aborted) throw error;
        lane.state = 'failed';
        session.laneNote = 'A second copy of the app could not start, so fewer tests run at once.';
      }
    }
    await persist();

    const queue = [...session.tests];
    const finishedOnLane = new Map<string, number>();
    const runLane = async (lane: AutoTestLane) => {
      while (!signal.aborted) {
        const entry = queue.shift();
        if (!entry) break;
        const test = byId.get(entry.id)!;
        lane.state = 'running';
        lane.currentTestId = entry.id;
        entry.laneId = lane.id;
        entry.state = 'running';
        entry.startedAt = now();
        await persist();
        try {
          // A fresh app instance per test: restart the lane's own process after the first test.
          let app = servers.get(lane.id)!;
          if (finishedOnLane.get(lane.id)) {
            await app.server.stop();
            app = await deps.launch({ folder: session.folder, recipeId: first.recipe.id, port: app.server.port, signal });
            servers.set(lane.id, app);
          }
          const origin = new URL(app.server.url).origin;
          const mission: MissionInput = { ...test.mission, targetUrl: new URL(new URL(test.mission.targetUrl).pathname + new URL(test.mission.targetUrl).search, origin).href, checks: test.mission.checks.map(check => check.kind === 'url' ? { ...check, expected: new URL(new URL(check.expected).pathname + new URL(check.expected).search, origin).href } : check) };
          const environment = await deps.saveEnvironment({
            name: `Auto test – ${session.folder.split(/[\\/]/).filter(Boolean).pop() ?? 'app'} · ${lane.id.replace('lane-', 'lane ')}`,
            targetUrl: origin + '/', allowedOrigins: [origin], viewport: { width: 1280, height: 720 },
            accountRole: 'Visitor', requiredVariables: [], targetVersion: digest.fingerprint.slice(0, 12),
            startupInstructions: `Started automatically by Centinel Auto test with "${first.recipe.label}".`,
            actionPolicy: { schemaVersion: 1, interactions: test.controls.map(control => ({ selector: control.selector, actions: control.actions })), allowCoordinates: false },
          }, lane.environmentId ?? undefined);
          lane.environmentId = environment.id;
          await deps.recordData(environment.id, 'preparation', 'Centinel started a fresh copy of the app for this test; its in-memory state is new.');
          const saved = await deps.saveMission(mission);
          entry.missionId = saved.missionId;
          entry.revisionId = saved.revisionId;
          const runId = await deps.startRun({ revisionId: saved.revisionId, environmentId: environment.id, idempotencyKey: `autotest:${session.id.slice(0, 8)}:${entry.id}`, laneId: lane.id });
          entry.runId = runId;
          await persist();
          let run = await deps.getRun(runId);
          const deadline = Date.now() + RUN_WAIT_LIMIT_MS;
          let cancelRequested = false;
          while (!TERMINAL_RUN.has(run.state)) {
            if (!cancelRequested && (signal.aborted || Date.now() > deadline)) { cancelRequested = true; await deps.cancelRun(runId).catch(() => undefined); }
            await sleep(RUN_POLL_MS);
            run = await deps.getRun(runId);
          }
          entry.state = verdictState(run);
          entry.reason = run.reason;
          entry.checkResults = run.checks;
          await deps.recordData(environment.id, 'cleanup', 'Centinel stopped this copy of the app after the test; nothing persists outside its process.').catch(() => undefined);
          if (entry.state === 'failed' && deps.explainFailure && !signal.aborted) {
            entry.explanation = await deps.explainFailure({ test: entry, run, excerpts: excerptsFor(entry, digest), signal }).catch(() => null);
          }
        } catch (error) {
          entry.state = signal.aborted ? 'cancelled' : 'blocked';
          entry.reason = error instanceof Error ? error.message.slice(0, 500) : 'The test could not run.';
        }
        entry.finishedAt = now();
        finishedOnLane.set(lane.id, (finishedOnLane.get(lane.id) ?? 0) + 1);
        lane.currentTestId = null;
        lane.state = 'idle';
        await persist();
      }
    };
    await Promise.all(session.lanes.filter(lane => lane.state === 'idle').map(runLane));
    for (const entry of session.tests) if (entry.state === 'queued') entry.state = signal.aborted ? 'cancelled' : 'not_tested';
    checkCancelled();

    // 6. Summarise. Counts come only from Run verdicts.
    await stage('summarizing');
    const count = (state: AutoTestState) => session.tests.filter(test => test.state === state).length;
    const limitations = [
      'Only the journeys listed were tested; this is not a complete test of the app.',
      'Pass and fail come from Centinel\'s own checks on the page, not from the AI\'s opinion.',
      ...(session.dropped.length ? [`${session.dropped.length} proposed test(s) were dropped because they could not be checked safely.`] : []),
      ...(digest.truncated ? ['The repository was larger than what the AI could read at once; some files were not considered.'] : []),
      ...(session.laneNote ? [session.laneNote] : []),
    ];
    session.summary = { passed: count('passed'), failed: count('failed'), uncertain: count('uncertain'), blocked: count('blocked'), notTested: count('not_tested'), limitations };
    session.stage = 'completed';
  } catch (error) {
    if (signal.aborted) {
      session.stage = 'cancelled';
      for (const entry of session.tests) if (entry.state === 'queued' || entry.state === 'running') entry.state = 'cancelled';
    } else {
      session.stage = 'failed';
      session.error = error instanceof LaunchError
        ? { reason: error.reason, message: error.message, ...(error.logs ? { log: error.logs.slice(-4000) } : {}) }
        : { reason: 'internal', message: error instanceof Error ? error.message.slice(0, 500) : 'Auto test failed.' };
    }
  } finally {
    await Promise.all([...servers.values()].map(app => app.server.stop().catch(() => undefined)));
    for (const lane of session.lanes) { lane.state = lane.state === 'failed' ? 'failed' : 'stopped'; lane.currentTestId = null; }
    await persist();
  }
  return session;
}
