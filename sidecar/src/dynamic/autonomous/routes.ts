import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DynamicContractError } from '../types.js';
import { newAutoTestSession, presetFromEntry, runAutoTest, MAX_LANES, type AutoTestDeps, type AutoTestSession } from './orchestrator.js';
import { MAX_REQUEST_CHARS, type AutoTestPreset, type AutoTestRequest } from './planner.js';
import type { AutoTestStore } from './store.js';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** Auto test sessions running in this sidecar process. */
export class AutoTestRuntime {
  private readonly active = new Map<string, { controller: AbortController; done: Promise<AutoTestSession>; projectId: string }>();
  private readonly installDecisions = new Map<string, { id: string; finish(approved: boolean): void }>();
  isActive(id: string) { return this.active.has(id); }
  activeFor(projectId: string) { return [...this.active.entries()].find(([, entry]) => entry.projectId === projectId)?.[0] ?? null; }
  start(session: AutoTestSession, deps: AutoTestDeps) {
    if (this.activeFor(session.projectId)) throw new DynamicContractError(409, 'An Auto test is already running for this project. Wait for it or cancel it first.');
    const controller = new AbortController();
    const waitForInstallDecision: NonNullable<AutoTestDeps['waitForInstallDecision']> = (question, signal) => new Promise(resolve => {
      const finish = (approved: boolean) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        this.installDecisions.delete(session.id);
        resolve(approved);
      };
      const cancel = () => finish(false);
      const timer = setTimeout(cancel, 15 * 60_000);
      this.installDecisions.set(session.id, { id: question.id, finish });
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
    const done = runAutoTest(session, { ...deps, waitForInstallDecision }, controller.signal).finally(() => {
      this.installDecisions.get(session.id)?.finish(false);
      this.active.delete(session.id);
    });
    this.active.set(session.id, { controller, done, projectId: session.projectId });
    return done;
  }
  cancel(id: string) { this.active.get(id)?.controller.abort(); return this.active.get(id)?.done; }
  answerInstall(id: string, questionId: string, approved: boolean) {
    const question = this.installDecisions.get(id);
    if (question?.id !== questionId) return false;
    question.finish(approved);
    return true;
  }
  async stopAll() { const all = [...this.active.values()]; all.forEach(entry => entry.controller.abort()); await Promise.allSettled(all.map(entry => entry.done)); }
}
export const autoTestRuntime = new AutoTestRuntime();

export type AutoTestRouteDeps = {
  ownerId: string;
  store: AutoTestStore;
  runtime?: AutoTestRuntime;
  requireMember(projectId: string): Promise<void>;
  /** The project's saved local repository folder, if any. */
  defaultFolder(projectId: string): Promise<string | null>;
  /** Builds the side effects for one session (auth-bound clients, model provider, run starter). */
  createDeps(projectId: string, session: AutoTestSession): Promise<AutoTestDeps>;
};

const HISTORY_SESSIONS = 30;
const HISTORY_REQUESTS = 10;
const MAX_RERUN = 10;

type TestRef = { sessionId: string; testId: string };
function testRefs(value: unknown, field: string): TestRef[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  if (list.length > MAX_RERUN) throw new DynamicContractError(400, `Choose at most ${MAX_RERUN} saved tests.`);
  return list.map(item => {
    const ref = item as Partial<TestRef> | null;
    if (!ref || typeof ref.sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(ref.sessionId) || typeof ref.testId !== 'string' || !/^[a-f0-9-]{36}$/.test(ref.testId)) throw new DynamicContractError(400, `${field} must name a saved test.`);
    return { sessionId: ref.sessionId, testId: ref.testId };
  });
}

export type AutoTestRouteResult = { status: number; body: unknown } | { live: { projectId: string; sessionId: string } };

function validFolder(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || !path.isAbsolute(value.trim())) throw new DynamicContractError(400, 'Choose the app folder to test.');
  try {
    const real = fs.realpathSync(value.trim());
    if (!fs.statSync(real).isDirectory()) throw new Error('not a folder');
    return real;
  } catch {
    throw new DynamicContractError(400, 'That folder could not be opened on this computer.');
  }
}

/**
 * /projects/:p/dynamic/autonomous[/:id[/cancel|/live]]
 * Starting is fully automatic by the user's decision (12 Nov 2026): the app is started from a
 * fixed recipe table and generated tests run without a review step.
 */
export async function handleAutoTestRoute(request: { method: string; pathname: string; readBody(): Promise<Record<string, unknown>> }, deps: AutoTestRouteDeps): Promise<AutoTestRouteResult | null> {
  const match = request.pathname.match(/^\/projects\/([a-f0-9-]+)\/dynamic\/autonomous(?:\/([a-f0-9-]{36}))?(?:\/(cancel|live|startup-answer))?$/);
  if (!match) return null;
  const [, projectId, id, action] = match;
  await deps.requireMember(projectId);
  const runtime = deps.runtime ?? autoTestRuntime;
  const visible = (session: AutoTestSession) => {
    if (session.ownerId === deps.ownerId || !session.startupQuestion) return session;
    const { startupQuestion: _question, ...rest } = session;
    return rest;
  };
  /** A session left running by a sidecar that has since restarted cannot continue. */
  const reconcile = async (session: AutoTestSession) => {
    if (TERMINAL.has(session.stage) || runtime.isActive(session.id) || session.ownerId !== deps.ownerId) return session;
    const stopped: AutoTestSession = { ...session, stage: 'failed', updatedAt: new Date().toISOString(), error: { reason: 'interrupted', message: 'ORIN restarted while this Auto test was running. Start it again.' },
      tests: session.tests.map(test => test.state === 'queued' || test.state === 'running' ? { ...test, state: 'not_tested' as const } : test),
      lanes: session.lanes.map(lane => ({ ...lane, state: 'stopped' as const, currentTestId: null })) };
    delete stopped.startupQuestion;
    await deps.store.save(stopped);
    return stopped;
  };
  try {
    if (!id && !action && request.method === 'GET') {
      const sessions = await deps.store.list(projectId, HISTORY_SESSIONS);
      return { status: 200, body: (await Promise.all(sessions.map(reconcile))).map(visible) };
    }
    if (!id && !action && request.method === 'POST') {
      const body = await request.readBody();
      const permission = body.startupPermission;
      if (permission !== undefined && permission !== 'ask' && permission !== 'auto' && permission !== 'bypass') throw new DynamicContractError(400, 'Choose a valid startup permission mode.');
      const folder = validFolder(body.folder ?? await deps.defaultFolder(projectId));
      const lanes = body.lanes === undefined ? undefined : Number(body.lanes);
      if (lanes !== undefined && (!Number.isInteger(lanes) || lanes < 1 || lanes > MAX_LANES)) throw new DynamicContractError(400, `Run between 1 and ${MAX_LANES} tests at once.`);
      if (runtime.activeFor(projectId)) throw new DynamicContractError(409, 'An Auto test is already running for this project. Wait for it or cancel it first.');
      // Project conversation (13 Nov 2026): a typed request, an existing test to change, or saved tests to run again.
      const text = body.request === undefined || body.request === null ? null : typeof body.request === 'string' ? body.request.trim() : '';
      if (text !== null && (!text || text.length > MAX_REQUEST_CHARS)) throw new DynamicContractError(400, `Write a request of up to ${MAX_REQUEST_CHARS} characters.`);
      const [baseRef] = testRefs(body.base, 'base');
      const rerun = testRefs(body.rerun, 'rerun');
      const pinned = testRefs(body.pinned, 'pinned');
      if (baseRef && text === null) throw new DynamicContractError(400, 'Say how the test should change.');
      if (rerun.length && text !== null) throw new DynamicContractError(400, 'Run saved tests or send a request, not both.');
      const loadPreset = async (ref: TestRef): Promise<AutoTestPreset> => {
        const source = await deps.store.get(projectId, ref.sessionId);
        const entry = source?.tests.find(test => test.id === ref.testId);
        const preset = entry ? presetFromEntry(entry) : null;
        if (!preset) throw new DynamicContractError(404, 'That saved test is no longer available. Ask for it again.');
        return preset;
      };
      let typed: AutoTestRequest | null = null;
      if (text !== null) {
        const earlier = await deps.store.list(projectId, HISTORY_SESSIONS).catch(() => [] as AutoTestSession[]);
        const history = earlier.map(item => item.request?.text).filter((value): value is string => !!value).slice(0, HISTORY_REQUESTS).reverse();
        typed = { text, base: baseRef ? await loadPreset(baseRef) : null, history };
      }
      const presets = await Promise.all([...rerun, ...pinned].map(loadPreset));
      const conversational = typed !== null || rerun.length > 0;
      const session = newAutoTestSession({ id: crypto.randomUUID(), projectId, ownerId: deps.ownerId, folder, lanes: lanes ?? (conversational ? 1 : undefined), request: typed, presets, planning: rerun.length ? false : undefined, startupPermission: permission });
      const sideEffects = await deps.createDeps(projectId, session);
      await deps.store.save(session);
      void runtime.start(session, sideEffects).catch(() => undefined);
      return { status: 202, body: session };
    }
    if (!id) return { status: 405, body: { error: 'Unsupported Auto test operation.' } };
    const stored = await deps.store.get(projectId, id);
    if (!stored) throw new DynamicContractError(404, 'Auto test not found.');
    if (!action && request.method === 'GET') return { status: 200, body: visible(await reconcile(stored)) };
    if (action === 'cancel' && request.method === 'POST') {
      if (stored.ownerId !== deps.ownerId) throw new DynamicContractError(409, 'Only the person who started this Auto test can cancel it.');
      const finished = await runtime.cancel(id);
      return { status: 200, body: finished ?? await reconcile(stored) };
    }
    if (action === 'startup-answer' && request.method === 'POST') {
      if (stored.ownerId !== deps.ownerId) return { status: 403, body: { error: 'Only the person who started this browser check can approve startup.' } };
      const { questionId, choice } = await request.readBody();
      if (typeof questionId !== 'string' || (choice !== 'install' && choice !== 'retry' && choice !== 'skip' && choice !== 'custom')) throw new DynamicContractError(400, 'Choose a startup answer.');
      const question = stored.startupQuestion;
      if (question?.id !== questionId || choice === 'install' && question.manualSetup || choice === 'retry' && !question.manualSetup
        || !runtime.answerInstall(id, questionId, choice === 'install' || choice === 'retry')) throw new DynamicContractError(409, 'This startup question or answer is no longer active.');
      return { status: 202, body: { accepted: true } };
    }
    if (action === 'live' && request.method === 'GET') return { live: { projectId, sessionId: id } };
    return { status: 405, body: { error: 'Unsupported Auto test operation.' } };
  } catch (error) {
    if (error instanceof DynamicContractError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}
