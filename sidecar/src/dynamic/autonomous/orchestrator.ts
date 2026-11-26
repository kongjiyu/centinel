import { randomUUID } from 'node:crypto';
import type { DiscoveryResult } from '../environment/controlDiscovery.js';
import type { EnvironmentInput, EnvironmentProfile } from '../environment/types.js';
import type { CheckDefinition, CheckResult, DynamicRun, MissionInput } from '../types.js';
import type { InstallPlan, LaunchedApp, LaunchEvent } from './launcher.js';
import { LaunchError } from './launcher.js';
import { AUTO_TEST_PLAN_SCHEMA, AUTO_TEST_SYSTEM_PROMPT, buildPlanPrompt, MAX_REQUEST_TESTS, planReply, presetToTest, validatePlan, type AutoTest, type AutoTestControl, type AutoTestPreset, type AutoTestRequest, type DroppedTest } from './planner.js';
import type { RepoDigest } from './repoDigest.js';
import { reviewProviderPause } from '../../review/providerPause.js';
import { unitState, type UnitSummary } from './unitTests.js';
import { autoRepeatable } from './suite.js';
import { explorationSummary, exploratoryTests, FULL_SUITE, smokeBlocksTesting, smokeResult, usabilitySummary, usabilityTest, type AutoTestKind, type AutoTestSuite, type ExplorationSummary, type SmokeResult, type UsabilitySummary } from './suite.js';

/**
 * Autonomous Dynamic testing: read a folder, start its app, plan tests, run them in
 * isolated parallel lanes through the ordinary Run pipeline, and summarise. All side
 * effects come through AutoTestDeps so the state machine is testable without a browser.
 */
export type AutoTestStage = 'reading' | 'starting' | 'exploring' | 'planning' | 'testing' | 'summarizing' | 'completed' | 'failed' | 'cancelled';
export type StartupPermission = 'ask' | 'auto' | 'bypass';
export type StartupQuestion = InstallPlan & { id: string };
export type AutoTestState = 'queued' | 'running' | 'passed' | 'failed' | 'uncertain' | 'blocked' | 'not_tested' | 'cancelled';
export type AutoTestEntry = {
  id: string; name: string; goal: string; rationale: string; requirementRef: string | null;
  sourceRefs: Array<{ path: string; line: number }>; checks: CheckDefinition[]; startPath: string;
  state: AutoTestState; laneId?: string; missionId?: string; revisionId?: string; runId?: string;
  reason?: string | null; checkResults?: CheckResult[]; explanation?: string | null; startedAt?: string; finishedAt?: string;
  /** Allowed controls, kept so the test can be run again from the conversation. Absent on older sessions. */
  controls?: AutoTestControl[];
  /** Fixed full-check tests (18 Nov 2026); absent for tests the AI wrote. */
  kind?: AutoTestKind;
  smoke?: SmokeResult;
  exploration?: ExplorationSummary;
  usability?: UsabilitySummary;
  unit?: UnitSummary;
  /** The first attempt of a test that was run again: after it could not run, or to confirm a failure (19 Nov 2026). */
  firstAttempt?: { runId: string | null; reason: string | null; state?: AutoTestState; checkResults?: CheckResult[]; explanation?: string | null };
};
export type AutoTestLane = { id: string; url: string | null; environmentId: string | null; state: 'starting' | 'idle' | 'running' | 'stopped' | 'failed'; currentTestId: string | null };
export type AutoTestSession = {
  schemaVersion: 1; id: string; projectId: string; ownerId: string; folder: string;
  createdAt: string; updatedAt: string; stage: AutoTestStage;
  error: { reason: string; message: string; log?: string } | null;
  repository: { fingerprint: string; files: number; routes: number; forms: number; requirements: boolean; truncated: boolean; persistence: string[] } | null;
  launch: { recipeId: string; label: string; framework: string; url: string | null; portHonored: boolean | null; installing: boolean; installStarted?: boolean; log: string } | null;
  exploration: { pages: Array<{ path: string; controls: number }>; controls: number } | null;
  lanes: AutoTestLane[]; laneLimit: number; laneNote: string | null;
  tests: AutoTestEntry[]; dropped: DroppedTest[];
  summary: { passed: number; failed: number; uncertain: number; blocked: number; notTested: number; limitations: string[] } | null;
  /** Project conversation (additive): the person's request, the model's plain reply, and saved tests to run. */
  request?: AutoTestRequest | null;
  reply?: string | null;
  presets?: AutoTestPreset[];
  /** False when only saved tests run, without writing new ones. */
  planning?: boolean;
  startupPermission?: StartupPermission;
  startupQuestion?: StartupQuestion;
  /** Fixed tests added to a full check: smoke, exploratory and usability. Absent on older sessions and requests. */
  suite?: AutoTestSuite;
};

export type AutoTestDeps = {
  digest(folder: string): Promise<RepoDigest>;
  launch(input: { folder: string; recipeId?: string; port?: number; signal: AbortSignal; onEvent?(event: LaunchEvent): void; approveInstall?(plan: InstallPlan): Promise<boolean> }): Promise<LaunchedApp>;
  waitForInstallDecision?(question: StartupQuestion, signal: AbortSignal): Promise<boolean>;
  discover(url: string, paths: string[], options?: { collectHealth?: boolean }): Promise<DiscoveryResult>;
  generate(input: { systemPrompt: string; prompt: string; outputSchema: object; signal: AbortSignal }): Promise<unknown>;
  /** The project's own unit tests (plain Vitest only). Absent: the full check skips them. */
  runUnitTests?(input: { folder: string; signal: AbortSignal }): Promise<UnitSummary>;
  explainFailure?(input: { test: AutoTestEntry; run: DynamicRun; excerpts: string; signal: AbortSignal }): Promise<string | null>;
  saveEnvironment(input: EnvironmentInput, id?: string): Promise<EnvironmentProfile>;
  recordData(environmentId: string, kind: 'preparation' | 'cleanup', note: string): Promise<void>;
  saveMission(input: MissionInput): Promise<{ missionId: string; revisionId: string }>;
  startRun(input: { revisionId: string; environmentId: string; idempotencyKey: string; laneId: string }): Promise<string>;
  getRun(runId: string): Promise<DynamicRun>;
  cancelRun(runId: string): Promise<void>;
  save(session: AutoTestSession): Promise<void>;
  beforeAction?(): Promise<void>;
  validatePlanned?(tests: AutoTest[]): Promise<void>;
  now?(): Date;
  sleep?(ms: number): Promise<void>;
};

export const DEFAULT_LANES = 3;
export const MAX_LANES = 4;
const TERMINAL_RUN = new Set(['completed', 'blocked', 'cancelled', 'interrupted']);
const RUN_POLL_MS = 1000;
const RUN_WAIT_LIMIT_MS = 6 * 60_000;

export function newAutoTestSession(input: { id: string; projectId: string; ownerId: string; folder: string; lanes?: number; now?: Date; request?: AutoTestRequest | null; presets?: AutoTestPreset[]; planning?: boolean; startupPermission?: StartupPermission; suite?: AutoTestSuite }): AutoTestSession {
  const at = (input.now ?? new Date()).toISOString();
  return {
    schemaVersion: 1, id: input.id, projectId: input.projectId, ownerId: input.ownerId, folder: input.folder,
    createdAt: at, updatedAt: at, stage: 'reading', error: null, repository: null, launch: null, exploration: null,
    lanes: [], laneLimit: Math.min(MAX_LANES, Math.max(1, Math.floor(input.lanes ?? DEFAULT_LANES))), laneNote: null,
    tests: [], dropped: [], summary: null,
    ...(input.request ? { request: input.request } : {}),
    ...(input.presets?.length ? { presets: input.presets } : {}),
    ...(input.planning === false ? { planning: false } : {}),
    ...(input.startupPermission ? { startupPermission: input.startupPermission } : {}),
    // A full check (no typed request, new tests planned) also runs the fixed smoke, exploratory and usability tests.
    ...(input.suite ? { suite: input.suite } : !input.request && input.planning !== false ? { suite: { ...FULL_SUITE } } : {}),
  };
}

/** The saved definition of a test from an earlier session, if it can be run again. */
export function presetFromEntry(entry: AutoTestEntry): AutoTestPreset | null {
  if (entry.kind || !entry.controls || !entry.checks.length) return null;
  return { name: entry.name, goal: entry.goal, startPath: entry.startPath, requirementRef: entry.requirementRef, sourceRefs: entry.sourceRefs, checks: entry.checks, controls: entry.controls };
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
  let persistenceError: unknown;
  let admissionError: unknown;
  const persist = () => {
    session.updatedAt = now();
    const snapshot = structuredClone(session);
    saving = saving.then(async () => {
      if (persistenceError) return;
      try { await deps.save(snapshot); } catch (error) { persistenceError = error; }
    });
    return saving.then(() => { if (persistenceError) throw persistenceError; });
  };
  const stage = async (value: AutoTestStage) => { session.stage = value; await persist(); };
  const checkCancelled = () => { if (signal.aborted) throw new LaunchError('cancelled', 'Cancelled.'); };
  const approveInstall = session.startupPermission && session.startupPermission !== 'bypass' ? async (plan: InstallPlan) => {
    if (!deps.waitForInstallDecision || session.startupQuestion) return false;
    const question = { ...plan, id: randomUUID() };
    const answer = deps.waitForInstallDecision(question, signal);
    session.startupQuestion = question;
    await persist();
    const approved = await answer;
    delete session.startupQuestion;
    await persist();
    checkCancelled();
    if (approved) await deps.beforeAction?.();
    return approved;
  } : undefined;

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
    await deps.beforeAction?.();
    const first = await deps.launch({
      folder: session.folder, signal, approveInstall,
      onEvent: event => {
        if (event.stage === 'detected') session.launch = { recipeId: event.recipe.id, label: event.recipe.label, framework: event.recipe.framework, url: null, portHonored: null, installing: false, log: '' };
        else if (session.launch && (event.stage === 'installing' || event.stage === 'starting')) {
          session.launch.installing = event.stage === 'installing';
          if (session.launch.installing) session.launch.installStarted = true;
          session.launch.label = event.command;
          if (event.log) session.launch.log = event.log.slice(-4000);
          if (Date.now() - lastLog > 1000) { lastLog = Date.now(); void persist().catch(() => undefined); }
        }
      },
    });
    servers.set(firstLane.id, first);
    firstLane.url = first.server.url;
    firstLane.state = 'idle';
    if (session.launch) Object.assign(session.launch, { url: first.server.url, portHonored: first.server.portHonored, installing: false, log: first.server.logs().slice(-4000) });
    checkCancelled();

    // 3-4. Saved tests run as they are; otherwise explore what the running app shows and plan.
    const planned: AutoTest[] = [];
    // Visible names of the controls the page scan saw, for the repeat-click rule.
    const controlLabels = new Map<string, string>();
    const kinds = new Map<string, AutoTestKind>();
    let smokeEntry: AutoTestEntry | null = null;
    for (const preset of session.presets ?? []) {
      const test = presetToTest(preset, { appUrl: first.server.url, projectId: session.projectId });
      if (test) planned.push(test); else session.dropped.push({ name: preset.name, reason: 'This saved test could not be rebuilt for the running app.' });
    }
    if (session.planning !== false) {
      await stage('exploring');
      const suite = session.suite;
      const discovery = await deps.discover(first.server.url, scanPaths(digest), suite?.smoke ? { collectHealth: true } : undefined);
      for (const control of discovery.controls) controlLabels.set(control.selector, control.label);
      session.exploration = { pages: discovery.pages.map(page => ({ path: new URL(page.finalUrl).pathname, controls: page.controls })), controls: discovery.controls.length };
      if (suite?.smoke) {
        const smoke = smokeResult(discovery);
        const failed = smoke.pages.filter(page => !page.ok).length;
        smokeEntry = {
          id: randomUUID(), kind: 'smoke', name: 'Pages open without errors', state: failed ? 'failed' : 'passed', smoke,
          goal: `Open ${smoke.pages.length} page${smoke.pages.length === 1 ? '' : 's'} of the app and look for server errors and script errors.`,
          rationale: 'Smoke test: ORIN loads each page itself and reads the status and errors. No AI is involved.',
          requirementRef: null, sourceRefs: [], checks: [], startPath: '/',
          reason: failed ? `${failed} of ${smoke.pages.length} pages showed an error.` : null, startedAt: now(), finishedAt: now(),
        };
        // Shown while tests are written, and kept if a later step fails.
        session.tests = [smokeEntry];
        await persist();
        if (smokeBlocksTesting(smoke)) {
          session.laneNote = 'The first page of the app answers with a server error, so the other browser tests did not run.';
          await stage('summarizing');
          session.summary = { passed: 0, failed: 1, uncertain: 0, blocked: 0, notTested: 0, limitations: [session.laneNote] };
          session.stage = 'completed';
          return session;
        }
      }
      checkCancelled();

      await stage('planning');
      const request = session.request ?? null;
      const raw = await deps.generate({ systemPrompt: AUTO_TEST_SYSTEM_PROMPT, prompt: buildPlanPrompt({ appUrl: first.server.url, digest, discovery, request }), outputSchema: AUTO_TEST_PLAN_SCHEMA, signal });
      const plan = validatePlan(raw, { appUrl: first.server.url, projectId: session.projectId, digest, discovery, ...(request ? { maxTests: request.base ? 1 : MAX_REQUEST_TESTS } : {}) });
      session.dropped.push(...plan.dropped);
      if (request) session.reply = planReply(raw);
      planned.push(...plan.tests);
      // Fixed full-check tests. Exploration goes first in the queue because it takes the most steps.
      const explorations = suite?.exploratory ? exploratoryTests({ appUrl: first.server.url, projectId: session.projectId, discovery }) : [];
      const usability = suite?.usability ? usabilityTest({ appUrl: first.server.url, projectId: session.projectId }) : null;
      for (const explore of [...explorations].reverse()) { planned.unshift(explore); kinds.set(explore.id, 'exploratory'); }
      if (!explorations.length && suite?.exploratory) session.dropped.push({ name: 'Explore the app', reason: 'The page scan found no control that is safe to click without a person watching.' });
      if (usability) { planned.push(usability); kinds.set(usability.id, 'usability'); }
    }
    const byId = new Map<string, AutoTest>(planned.map(test => [test.id, test]));
    await deps.validatePlanned?.(planned);
    session.tests = [
      ...(smokeEntry ? [smokeEntry] : []),
      ...planned.map((test): AutoTestEntry => {
        const kind = kinds.get(test.id);
        return {
          id: test.id, name: test.name, goal: test.goal, rationale: test.rationale, requirementRef: test.requirementRef,
          sourceRefs: test.sourceRefs, checks: test.mission.checks, startPath: test.startPath, state: 'queued',
          // Fixed tests are not saved for rerunning from the conversation; they run with every full check.
          ...(kind ? { kind } : { controls: test.controls }),
        };
      }),
    ];
    if (!planned.length && session.request && session.reply) {
      // A question or something the browser cannot test: answer in words, run nothing.
      session.summary = { passed: 0, failed: 0, uncertain: 0, blocked: 0, notTested: 0, limitations: [] };
      session.stage = 'completed';
      return session;
    }
    if (!session.tests.length) throw new LaunchError('unsupported', session.request ? 'The AI could not write a usable test for that request. Try describing the steps and what the page should show.' : 'The AI could not write any usable test for this app.');
    checkCancelled();

    // 5. Lanes: each gets its own app instance so tests never share in-memory state.
    await stage('testing');
    let laneCount = Math.min(session.laneLimit, Math.max(1, planned.length));
    if (laneCount > 1 && digest.persistenceHints.length) { laneCount = 1; session.laneNote = 'The app keeps data outside its own process (a database or file), so tests run one at a time to avoid sharing state.'; }
    else if (laneCount > 1 && !first.server.portHonored) { laneCount = 1; session.laneNote = 'The app always uses the same port, so only one copy can run at a time.'; }
    for (let index = 2; index <= laneCount; index++) {
      const lane: AutoTestLane = { id: `lane-${index}`, url: null, environmentId: null, state: 'starting', currentTestId: null };
      session.lanes.push(lane);
      try {
        await deps.beforeAction?.();
        const app = await deps.launch({ folder: session.folder, recipeId: first.recipe.id, signal, approveInstall });
        servers.set(lane.id, app);
        lane.url = app.server.url;
        lane.state = 'idle';
      } catch (error) {
        if (signal.aborted) throw error;
        lane.state = 'failed';
        session.laneNote = 'A second copy of the app could not start, so fewer tests run at once.';
      }
    }
    // The project's own unit tests run beside the browser lanes; dependencies were installed when the app started.
    let unitWork: Promise<void> = Promise.resolve();
    if (session.suite?.unit && deps.runUnitTests) {
      const unitEntry: AutoTestEntry = {
        id: randomUUID(), kind: 'unit', name: 'Project unit tests', state: 'running', startedAt: now(),
        goal: "Run the project's own unit tests with its Vitest script.", rationale: 'Unit tests: Vitest\'s own report decides pass and fail.',
        requirementRef: null, sourceRefs: [], checks: [], startPath: '/',
      };
      session.tests.push(unitEntry);
      unitWork = deps.runUnitTests({ folder: session.folder, signal }).then(summary => {
        unitEntry.unit = summary;
        unitEntry.state = signal.aborted ? 'cancelled' : unitState(summary);
        unitEntry.reason = summary.reason;
      }, error => {
        unitEntry.state = signal.aborted ? 'cancelled' : 'blocked';
        unitEntry.reason = error instanceof Error ? error.message.slice(0, 300) : 'The unit tests could not run.';
      }).then(async () => { unitEntry.finishedAt = now(); await persist(); });
    }
    await persist();

    const queue = session.tests.filter(entry => entry.state === 'queued');
    const finishedOnLane = new Map<string, number>();
    const runLane = async (lane: AutoTestLane) => {
      while (!signal.aborted && !persistenceError && !admissionError) {
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
          await deps.beforeAction?.();
          let app = servers.get(lane.id)!;
          if (finishedOnLane.get(lane.id)) {
            await app.server.stop();
            app = await deps.launch({ folder: session.folder, recipeId: first.recipe.id, port: app.server.port, signal, approveInstall });
            servers.set(lane.id, app);
          }
          const origin = new URL(app.server.url).origin;
          const mission: MissionInput = { ...test.mission, targetUrl: new URL(new URL(test.mission.targetUrl).pathname + new URL(test.mission.targetUrl).search, origin).href, checks: test.mission.checks.map(check => check.kind === 'url' ? { ...check, expected: new URL(new URL(check.expected).pathname + new URL(check.expected).search, origin).href } : check) };
          const environment = await deps.saveEnvironment({
            name: `Auto test – ${session.folder.split(/[\\/]/).filter(Boolean).pop() ?? 'app'} · ${lane.id.replace('lane-', 'lane ')}`,
            targetUrl: origin + '/', allowedOrigins: [origin], viewport: { width: 1280, height: 720 },
            accountRole: 'Visitor', requiredVariables: [], targetVersion: digest.fingerprint.slice(0, 12),
            startupInstructions: `Started automatically by ORIN Auto test with "${first.recipe.label}".`,
            actionPolicy: { schemaVersion: 1, interactions: test.controls.map(control => ({ selector: control.selector, actions: control.actions, ...(control.repeatable || autoRepeatable(control, controlLabels.get(control.selector)) ? { repeatable: true } : {}) })), allowCoordinates: false },
          }, lane.environmentId ?? undefined);
          lane.environmentId = environment.id;
          await deps.recordData(environment.id, 'preparation', 'ORIN started a fresh copy of the app for this test; its in-memory state is new.');
          const saved = await deps.saveMission(mission);
          entry.missionId = saved.missionId;
          entry.revisionId = saved.revisionId;
          await deps.beforeAction?.();
          const runId = await deps.startRun({ revisionId: saved.revisionId, environmentId: environment.id, idempotencyKey: `autotest:${session.id.slice(0, 8)}:${entry.id}${entry.firstAttempt ? ':retry' : ''}`, laneId: lane.id });
          entry.runId = runId;
          await persist();
          let run = await deps.getRun(runId);
          const deadline = Date.now() + RUN_WAIT_LIMIT_MS;
          let cancelRequested = false;
          let cancellationStarted = 0;
          while (!TERMINAL_RUN.has(run.state)) {
            if (!cancelRequested && (signal.aborted || persistenceError || admissionError || Date.now() > deadline)) {
              cancelRequested = true;
              cancellationStarted = Date.now();
              await deps.cancelRun(runId).catch(() => undefined);
            }
            if (cancelRequested && Date.now() - cancellationStarted > 30_000) {
              admissionError = new Error('The browser run could not confirm stopping. Inspect the saved run before starting another check.');
              throw admissionError;
            }
            await sleep(RUN_POLL_MS);
            run = await deps.getRun(runId);
          }
          entry.state = verdictState(run);
          entry.reason = run.reason;
          entry.checkResults = run.checks;
          if (entry.kind === 'exploratory') entry.exploration = explorationSummary(run.exploration, test.controls.map(control => control.selector));
          if (entry.kind === 'usability') {
            entry.usability = usabilitySummary(run.usability);
            // Rule failures are ORIN's own deterministic observations, so they fail the test.
            if (entry.state === 'passed' && entry.usability?.failures.length) entry.state = 'failed';
            if (entry.state === 'passed' && !entry.usability) entry.state = 'uncertain';
          }
          await deps.recordData(environment.id, 'cleanup', 'ORIN stopped this copy of the app after the test; nothing persists outside its process.').catch(() => undefined);
          if (entry.state === 'failed' && !entry.kind && deps.explainFailure && !signal.aborted) {
            try {
              entry.explanation = await deps.explainFailure({ test: entry, run, excerpts: excerptsFor(entry, digest), signal });
            } catch (error) {
              if (reviewProviderPause(error)) { admissionError = error; throw error; }
              entry.explanation = null;
            }
          }
        } catch (error) {
          if (persistenceError && entry.runId) await deps.cancelRun(entry.runId).catch(() => undefined);
          entry.state = signal.aborted ? 'cancelled' : 'blocked';
          entry.reason = error instanceof Error ? error.message.slice(0, 500) : 'The test could not run.';
        }
        entry.finishedAt = now();
        finishedOnLane.set(lane.id, (finishedOnLane.get(lane.id) ?? 0) + 1);
        // A second run on a fresh copy of the app (19 Nov 2026, user decision):
        // - a test that could not run (never an app failure) runs once more;
        // - a failed written test runs once more to confirm it, because the AI driving the browser can
        //   make a one-off mistake (an extra click). Fixed tests use deterministic checks and are not rerun.
        // Capacity stops, lost progress and cancellation never retry.
        const confirm = entry.state === 'failed' && !entry.kind;
        if ((entry.state === 'blocked' || confirm) && !entry.firstAttempt && !signal.aborted && !persistenceError && !admissionError) {
          entry.firstAttempt = { runId: entry.runId ?? null, reason: entry.reason ?? null, state: entry.state, checkResults: entry.checkResults, explanation: entry.explanation ?? null };
          Object.assign(entry, { state: 'queued' as const, runId: undefined, missionId: undefined, revisionId: undefined, reason: null, checkResults: undefined, explanation: undefined, finishedAt: undefined });
          queue.push(entry);
        } else if (entry.firstAttempt?.state === 'failed') {
          const first = entry.firstAttempt;
          if (entry.state === 'passed') {
            // Failed once, passed once: not a confirmed problem.
            entry.state = 'uncertain';
            entry.reason = 'It failed once and passed once on fresh copies of the app, so it is not counted as a problem.';
          } else if (entry.state !== 'failed') {
            // The confirming run could not run: keep the first run's failure as the result.
            Object.assign(entry, { state: 'failed' as const, runId: first.runId ?? undefined, checkResults: first.checkResults, explanation: first.explanation ?? null, reason: first.reason });
          }
        }
        lane.currentTestId = null;
        lane.state = 'idle';
        await persist();
      }
    };
    const laneResults = await Promise.allSettled(session.lanes.filter(lane => lane.state === 'idle').map(runLane));
    // The unit test process finishes (or stops on cancel) before any lane failure is reported.
    await unitWork;
    const failedLane = laneResults.find(result => result.status === 'rejected');
    if (failedLane?.status === 'rejected') throw failedLane.reason;
    if (admissionError) throw admissionError;
    for (const entry of session.tests) if (entry.state === 'queued') entry.state = signal.aborted ? 'cancelled' : 'not_tested';
    checkCancelled();

    // 6. Summarise. Counts come only from Run verdicts.
    await stage('summarizing');
    const count = (state: AutoTestState) => session.tests.filter(test => test.state === state).length;
    const limitations = [
      'Only the journeys listed were tested; this is not a complete test of the app.',
      'Pass and fail come from ORIN\'s own checks on the page, not from the AI\'s opinion.',
      ...(session.dropped.length ? [`${session.dropped.length} proposed test(s) were dropped because they could not be checked safely.`] : []),
      ...(digest.truncated ? ['The repository was larger than what the AI could read at once; some files were not considered.'] : []),
      ...(session.laneNote ? [session.laneNote] : []),
      ...(session.tests.some(test => test.kind === 'exploratory') ? ['Exploration is bounded to 25 steps and safe clicks; screens it did not reach were not tested.'] : []),
      ...(session.tests.some(test => test.kind === 'usability') ? ['Usability rules cover labels, keyboard reach and focus on the first page only; they are not a full accessibility audit or a study with real users.'] : []),
    ];
    session.summary = { passed: count('passed'), failed: count('failed'), uncertain: count('uncertain'), blocked: count('blocked'), notTested: count('not_tested'), limitations };
    session.stage = 'completed';
  } catch (error) {
    if (signal.aborted) {
      session.stage = 'cancelled';
      for (const entry of session.tests) if (entry.state === 'queued' || entry.state === 'running') entry.state = 'cancelled';
    } else {
      session.stage = 'failed';
      const pause = reviewProviderPause(error);
      session.error = pause ? { reason: 'provider_paused', message: pause.message } : error instanceof LaunchError
        ? { reason: error.reason, message: error.message, ...(error.logs ? { log: error.logs.slice(-4000) } : {}) }
        : { reason: 'internal', message: error instanceof Error ? error.message.slice(0, 500) : 'Auto test failed.' };
    }
  } finally {
    delete session.startupQuestion;
    const cleanup = await Promise.allSettled([...servers.values()].map(app => app.server.stop()));
    if (cleanup.some(result => result.status === 'rejected')) {
      if (session.stage !== 'cancelled') session.stage = 'failed';
      session.error = { reason: session.error?.reason ?? 'cleanup_failed',
        message: [session.error?.message, 'Some app processes could not confirm stopping. Inspect the saved execution before starting again.'].filter(Boolean).join(' ') };
    }
    for (const lane of session.lanes) { lane.state = lane.state === 'failed' ? 'failed' : 'stopped'; lane.currentTestId = null; }
    await persist();
  }
  return session;
}
