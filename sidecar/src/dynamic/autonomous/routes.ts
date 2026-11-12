import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DynamicContractError } from '../types.js';
import { newAutoTestSession, runAutoTest, MAX_LANES, type AutoTestDeps, type AutoTestSession } from './orchestrator.js';
import type { AutoTestStore } from './store.js';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** Auto test sessions running in this sidecar process. */
export class AutoTestRuntime {
  private readonly active = new Map<string, { controller: AbortController; done: Promise<AutoTestSession>; projectId: string }>();
  isActive(id: string) { return this.active.has(id); }
  activeFor(projectId: string) { return [...this.active.entries()].find(([, entry]) => entry.projectId === projectId)?.[0] ?? null; }
  start(session: AutoTestSession, deps: AutoTestDeps) {
    const controller = new AbortController();
    const done = runAutoTest(session, deps, controller.signal).finally(() => this.active.delete(session.id));
    this.active.set(session.id, { controller, done, projectId: session.projectId });
    return done;
  }
  cancel(id: string) { this.active.get(id)?.controller.abort(); return this.active.get(id)?.done; }
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
  const match = request.pathname.match(/^\/projects\/([a-f0-9-]+)\/dynamic\/autonomous(?:\/([a-f0-9-]{36}))?(?:\/(cancel|live))?$/);
  if (!match) return null;
  const [, projectId, id, action] = match;
  await deps.requireMember(projectId);
  const runtime = deps.runtime ?? autoTestRuntime;
  /** A session left running by a sidecar that has since restarted cannot continue. */
  const reconcile = async (session: AutoTestSession) => {
    if (TERMINAL.has(session.stage) || runtime.isActive(session.id) || session.ownerId !== deps.ownerId) return session;
    const stopped: AutoTestSession = { ...session, stage: 'failed', updatedAt: new Date().toISOString(), error: { reason: 'interrupted', message: 'Centinel restarted while this Auto test was running. Start it again.' },
      tests: session.tests.map(test => test.state === 'queued' || test.state === 'running' ? { ...test, state: 'not_tested' as const } : test),
      lanes: session.lanes.map(lane => ({ ...lane, state: 'stopped' as const, currentTestId: null })) };
    await deps.store.save(stopped);
    return stopped;
  };
  try {
    if (!id && !action && request.method === 'GET') {
      const sessions = await deps.store.list(projectId, 10);
      return { status: 200, body: await Promise.all(sessions.map(reconcile)) };
    }
    if (!id && !action && request.method === 'POST') {
      const body = await request.readBody();
      const folder = validFolder(body.folder ?? await deps.defaultFolder(projectId));
      const lanes = body.lanes === undefined ? undefined : Number(body.lanes);
      if (lanes !== undefined && (!Number.isInteger(lanes) || lanes < 1 || lanes > MAX_LANES)) throw new DynamicContractError(400, `Run between 1 and ${MAX_LANES} tests at once.`);
      if (runtime.activeFor(projectId)) throw new DynamicContractError(409, 'An Auto test is already running for this project. Wait for it or cancel it first.');
      const session = newAutoTestSession({ id: crypto.randomUUID(), projectId, ownerId: deps.ownerId, folder, lanes });
      await deps.store.save(session);
      const sideEffects = await deps.createDeps(projectId, session);
      void runtime.start(session, sideEffects).catch(() => undefined);
      return { status: 202, body: session };
    }
    if (!id) return { status: 405, body: { error: 'Unsupported Auto test operation.' } };
    const stored = await deps.store.get(projectId, id);
    if (!stored) throw new DynamicContractError(404, 'Auto test not found.');
    if (!action && request.method === 'GET') return { status: 200, body: await reconcile(stored) };
    if (action === 'cancel' && request.method === 'POST') {
      if (stored.ownerId !== deps.ownerId) throw new DynamicContractError(409, 'Only the person who started this Auto test can cancel it.');
      const finished = await runtime.cancel(id);
      return { status: 200, body: finished ?? await reconcile(stored) };
    }
    if (action === 'live' && request.method === 'GET') return { live: { projectId, sessionId: id } };
    return { status: 405, body: { error: 'Unsupported Auto test operation.' } };
  } catch (error) {
    if (error instanceof DynamicContractError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}
