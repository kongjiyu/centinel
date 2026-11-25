import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { compactCanonicalJson } from '../../report/canonical.js';
import type { LocalEnvironmentRepository } from '../environment/localRepository.js';
import { requireNoLocalCapture } from '../environment/localCaptureRepository.js';
import { DYNAMIC_QUEUE_GRACE_MS } from '../recovery.js';
import { DynamicContractError } from '../types.js';
import type { UnitStore } from './repository.js';
import type { UnitReportSnapshot } from './reports.js';
import type { DynamicUnitRun, UnitCommand, UnitDataEvent, UnitExecutionResult } from './types.js';

export const localUnitSchema = `
  CREATE TABLE IF NOT EXISTS local_dynamic_unit_run (
    owner TEXT NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL, profile TEXT NOT NULL, operation TEXT NOT NULL,
    state TEXT NOT NULL, created TEXT NOT NULL, token TEXT, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, id), UNIQUE (owner, project, operation),
    FOREIGN KEY (owner, project, profile) REFERENCES local_dynamic_environment(owner, project, id)
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS local_dynamic_unit_active ON local_dynamic_unit_run(owner, project) WHERE state IN ('queued', 'running');
  CREATE INDEX IF NOT EXISTS local_dynamic_unit_recent ON local_dynamic_unit_run(owner, project, profile, created DESC, id);
  CREATE TABLE IF NOT EXISTS local_dynamic_unit_event (
    owner TEXT NOT NULL, project TEXT NOT NULL, run TEXT NOT NULL, id TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, id), FOREIGN KEY (owner, project, run) REFERENCES local_dynamic_unit_run(owner, project, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_dynamic_unit_event_run ON local_dynamic_unit_event(owner, project, run, created, id);
`;

export type UnitHistorySnapshot = { runs: DynamicUnitRun[]; events: Array<{ id: string; runId: string; event: UnitDataEvent }>; reports?: UnitReportSnapshot[] };
const leaseMs = 90_000;
const decode = <T>(row: { payload?: unknown }) => JSON.parse(String(row.payload)) as T;
const missing = () => new DynamicContractError(404, 'Unit Run not available in this project.');
const active = (run: DynamicUnitRun) => run.state === 'queued' || run.state === 'running';
const digest = /^[a-f0-9]{64}$/;
const outcomes = ['passed', 'failed', 'not_tested', 'no_tests', 'configuration_error', 'missing_dependencies',
  'parser_error', 'cancelled', 'timeout', 'output_limit', 'runner_error'];

export function requireNoLocalUnitWork(db: DatabaseSync, owner: string, project: string): void {
  if (db.prepare(`SELECT 1 FROM local_dynamic_unit_run WHERE owner = ? AND project = ? AND state IN ('queued', 'running')`).get(owner, project)) {
    throw new DynamicContractError(409, 'Unit execution is active. Stop it and confirm cleanup before reuse.');
  }
}

function validateRequest(key: string, timeout: number): void {
  if (!key.trim() || key.length > 128 || !Number.isInteger(timeout) || timeout < 100 || timeout > 300_000) {
    throw new DynamicContractError(400, 'Select a bounded Unit Run request and timeout.');
  }
}

function validateCommand(command: UnitCommand): void {
  if (command.program !== 'node' || !command.script || !/^[A-Za-z0-9][A-Za-z0-9_:.-]{0,100}$/.test(command.script)
    || ![command.fingerprint, command.authorizationId, command.cliSha256].every(value => value && digest.test(value))
    || !command.frameworkVersion || !/^[34]\.\d+\.\d+(?:[-+].*)?$/.test(command.frameworkVersion)
    || !command.nodeVersion || !/^v\d+\.\d+\.\d+$/.test(command.nodeVersion) || Buffer.byteLength(JSON.stringify(command)) > 2000) {
    throw new DynamicContractError(400, 'A verified installed Vitest command is required.');
  }
}

function validateResult(run: DynamicUnitRun, result: UnitExecutionResult): void {
  const invalid = () => new DynamicContractError(409, 'The installed framework result did not match the frozen Unit Run.');
  if (result.schemaVersion !== 1 || !outcomes.includes(result.outcome) || Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw invalid();
  if (!['passed', 'failed', 'not_tested', 'no_tests'].includes(result.outcome)) return;
  const assessment = result.assessment;
  if (result.framework.name !== 'vitest' || result.framework.version !== run.command.frameworkVersion || !assessment
    || result.workspace.fingerprint !== run.command.fingerprint || result.workspace.authorizationId !== run.command.authorizationId
    || result.workspace.cliSha256 !== run.command.cliSha256 || result.framework.nodeVersion !== run.command.nodeVersion) throw invalid();
  const { counts, tests } = assessment;
  if (!Array.isArray(tests) || tests.length > 5000 || tests.length !== counts.total
    || !Object.values(counts).every(value => Number.isSafeInteger(value) && value >= 0 && value <= 10_000)
    || counts.failedSuites > counts.totalSuites
    || counts.total !== counts.passed + counts.failed + counts.pending + counts.todo) throw invalid();
  const observed = { passed: 0, failed: 0, pending: 0, todo: 0 };
  for (const test of tests) {
    const status = test.status === 'skipped' ? 'pending' : test.status;
    if (!Object.hasOwn(observed, status)) throw invalid();
    observed[status]++;
  }
  if (observed.passed !== counts.passed || observed.failed !== counts.failed || observed.pending !== counts.pending
    || observed.todo !== counts.todo || (result.outcome === 'no_tests' && counts.total)
    || (result.outcome === 'not_tested' && (counts.passed || counts.failed))) throw invalid();
  if (result.outcome === 'passed' && (!counts.passed || counts.failed || counts.failedSuites || assessment.success !== true
    || result.process?.exitCode !== 0 || result.process?.outcome !== 'passed' || result.process.signal !== null)) throw invalid();
}

export class LocalUnitRuns implements UnitStore {
  constructor(private readonly db: DatabaseSync, private readonly owner: string,
    private readonly environments: LocalEnvironmentRepository, private readonly now = Date.now) {}

  async get(project: string, id: string) { return this.read(project, id); }
  async byKey(project: string, key: string) { return this.operation(project, key); }
  async list(project: string, profile: string) {
    await this.recover(project);
    return this.db.prepare(`SELECT payload FROM local_dynamic_unit_run WHERE owner = ? AND project = ? AND profile = ?
      ORDER BY created DESC, id LIMIT 100`).all(this.owner, project, profile).map(decode<DynamicUnitRun>);
  }

  async preflight(project: string, profile: string, key: string, timeout: number, outcome: string, reason: string) {
    validateRequest(key, timeout);
    if ((outcome !== 'configuration_error' && outcome !== 'missing_dependencies') || !reason.trim() || reason.length > 500) {
      throw new DynamicContractError(400, 'A bounded prerequisite failure is required.');
    }
    return this.transaction(() => {
      const existing = this.replay(project, profile, key, timeout);
      if (existing) return existing;
      const command: UnitCommand = { program: 'node', script: null, fingerprint: null, authorizationId: null,
        gitCommit: null, frameworkVersion: null, cliSha256: null, nodeVersion: null };
      const run = this.newRun(project, profile, key, timeout, command, false);
      run.state = 'blocked';
      run.reason = reason;
      run.result = { schemaVersion: 1, framework: { name: 'vitest', version: null },
        command: { program: 'node', script: null, args: [] }, workspace: { fingerprint: null, gitCommit: null, authorizationId: null },
        outcome, process: null, assessment: null, reason, startedAt: run.createdAt, finishedAt: run.createdAt,
        limitations: ['This prerequisite attempt acquired no data reservation.'] };
      this.insert(run);
      return run;
    });
  }

  async start(project: string, profile: string, key: string, command: UnitCommand, timeout: number) {
    validateRequest(key, timeout);
    validateCommand(command);
    await this.recover(project);
    return this.transaction(() => {
      const existing = this.replay(project, profile, key, timeout);
      if (existing) {
        if (compactCanonicalJson(existing.command) !== compactCanonicalJson(command)) throw new DynamicContractError(409, 'Unit request identity conflicts with its recorded Run.');
        return { run: existing, reused: true };
      }
      requireNoLocalUnitWork(this.db, this.owner, project);
      requireNoLocalCapture(this.db, this.owner, project);
      if (this.db.prepare("SELECT 1 FROM local_dynamic_hook WHERE owner = ? AND project = ? AND state IN ('queued','running')").get(this.owner, project)) {
        throw new DynamicContractError(409, 'A setup or cleanup script is already active in this project.');
      }
      if (this.db.prepare(`SELECT 1 FROM local_dynamic_run WHERE owner = ? AND project = ?
        AND json_extract(payload, '$.state') IN ('queued', 'running') LIMIT 1`).get(this.owner, project)) {
        throw new DynamicContractError(409, 'A Browser Run is already active in this project.');
      }
      const run = this.newRun(project, profile, key, timeout, command, true);
      this.insert(run);
      return { run, reused: false };
    });
  }

  async claim(project: string, id: string, worker: string, token: string) {
    return this.transaction(() => {
      const run = this.read(project, id);
      const time = this.now();
      if (run.state !== 'queued' || Date.parse(run.createdAt) + DYNAMIC_QUEUE_GRACE_MS <= time) return null;
      run.state = 'running';
      run.lease = this.lease(worker, time);
      run.updatedAt = run.lease.heartbeatAt;
      this.write(run, token);
      return run;
    });
  }

  async heartbeat(project: string, id: string, worker: string, token: string): Promise<boolean> {
    return this.transaction(() => {
      const run = this.read(project, id);
      const time = this.now();
      if (run.cancelRequested || run.lease?.workerId !== worker || !this.matchesClaim(run, token, time)) return false;
      run.lease = this.lease(worker, time);
      run.updatedAt = run.lease.heartbeatAt;
      this.write(run, token);
      return true;
    });
  }

  async finish(project: string, id: string, token: string, value: UnitExecutionResult) {
    return this.transaction(() => {
      const run = this.read(project, id);
      if (!this.matchesClaim(run, token, this.now())) return null;
      const result = structuredClone(value);
      if (result.process) {
        result.process.truncated ||= result.process.output.length > 8192;
        result.process.output = result.process.output.slice(0, 8192);
      }
      validateResult(run, result);
      if (run.cancelRequested) {
        result.outcome = 'cancelled';
        result.reason = 'Stop requested. Retained framework data is diagnostic only.';
      }
      run.result = result;
      const verdict = result.outcome === 'passed' || result.outcome === 'failed' ? result.outcome : 'not_tested';
      return this.stop(run, result.outcome === 'cancelled' ? 'cancelled' : verdict === 'not_tested' ? 'blocked' : 'completed', result.reason, verdict);
    });
  }

  async cancel(project: string, id: string) {
    return this.transaction(() => {
      const run = this.read(project, id);
      if (!active(run)) return run;
      if (run.state === 'queued') return this.stop(run, 'cancelled', 'Unit Run cancelled before execution.');
      run.cancelRequested = true;
      run.reason = 'Stop requested. Waiting for unit worker termination.';
      run.updatedAt = new Date(this.now()).toISOString();
      this.db.prepare('UPDATE local_dynamic_unit_run SET payload = ? WHERE owner = ? AND project = ? AND id = ?')
        .run(JSON.stringify(run), this.owner, project, id);
      return run;
    });
  }

  async recover(project: string) {
    return this.transaction(() => {
      const now = this.now();
      return this.db.prepare(`SELECT payload FROM local_dynamic_unit_run WHERE owner = ? AND project = ? AND state IN ('queued','running')`)
        .all(this.owner, project).map(decode<DynamicUnitRun>)
        .filter(run => (run.state === 'queued' ? Date.parse(run.createdAt) + DYNAMIC_QUEUE_GRACE_MS : Date.parse(run.lease?.expiresAt ?? '')) <= now)
        .map(run => this.stop(run, 'interrupted', 'Unit worker stopped responding. Inspect the workspace and confirm cleanup before reuse.'));
    });
  }

  eventsForRun(project: string, id: string): UnitDataEvent[] {
    return this.db.prepare('SELECT payload FROM local_dynamic_unit_event WHERE owner = ? AND project = ? AND run = ? ORDER BY created, id')
      .all(this.owner, project, id).map(decode<UnitDataEvent>);
  }

  async events(project: string, id: string) { return this.eventsForRun(project, id); }

  /** Preserve stopped receipts and mark imported live processes interrupted. */
  seed(project: string, snapshot: UnitHistorySnapshot): void {
    const invalid = () => new Error('Invalid Unit Run or cleanup history.');
    if (!snapshot || !Array.isArray(snapshot.runs) || !Array.isArray(snapshot.events)) throw invalid();
    const runs = new Set<string>();
    for (const run of snapshot.runs) {
      if (!run || run.projectId !== project || run.environment?.projectId !== project || run.environment.id !== run.environmentId
        || !run.id || !run.createdBy || runs.has(run.id) || run.kind !== 'unit' || !run.idempotencyKey
        || !Number.isFinite(Date.parse(run.createdAt)) || !Number.isFinite(Date.parse(run.updatedAt))
        || !['queued', 'running', 'completed', 'blocked', 'cancelled', 'interrupted'].includes(run.state)
        || !['passed', 'failed', 'not_tested'].includes(run.verdict) || !run.command
        || Buffer.byteLength(JSON.stringify(run)) > 4 * 1024 * 1024) throw invalid();
      runs.add(run.id);
      const saved = { ...run };
      if (active(saved)) {
        saved.state = 'interrupted';
        saved.verdict = 'not_tested';
        saved.reason = 'Unit execution was interrupted during migration. Confirm cleanup before reuse.';
      }
      delete saved.lease;
      this.insert(saved);
    }
    for (const row of snapshot.events) {
      const event = row?.event;
      if (!event || !row.id || !runs.has(row.runId) || event.kind !== 'cleanup' || !['completed', 'failed'].includes(event.outcome)
        || typeof event.note !== 'string' || !event.actorId || !Number.isFinite(Date.parse(event.createdAt))) throw invalid();
      this.db.prepare('INSERT INTO local_dynamic_unit_event VALUES (?, ?, ?, ?, ?, ?)')
        .run(this.owner, project, row.runId, row.id, event.createdAt, JSON.stringify(event));
    }
  }

  read(project: string, id: string): DynamicUnitRun {
    const row = this.db.prepare('SELECT payload FROM local_dynamic_unit_run WHERE owner = ? AND project = ? AND id = ?').get(this.owner, project, id);
    if (!row) throw missing();
    return decode<DynamicUnitRun>(row);
  }

  private stop(run: DynamicUnitRun, state: DynamicUnitRun['state'], reason: string, verdict: DynamicUnitRun['verdict'] = 'not_tested') {
    Object.assign(run, { state, reason, verdict, updatedAt: new Date(this.now()).toISOString() });
    delete run.lease;
    this.environments.finishUnitRun(run.projectId, run.environmentId, run.id);
    this.write(run, null);
    return run;
  }

  private lease(workerId: string, time: number) {
    return { workerId, heartbeatAt: new Date(time).toISOString(), expiresAt: new Date(time + leaseMs).toISOString() };
  }

  private matchesClaim(run: DynamicUnitRun, token: string, time: number): boolean {
    if (!token || run.state !== 'running' || !run.lease || Date.parse(run.lease.expiresAt) <= time) return false;
    return this.db.prepare('SELECT token FROM local_dynamic_unit_run WHERE owner = ? AND project = ? AND id = ?')
      .get(this.owner, run.projectId, run.id)?.token === token;
  }

  private operation(project: string, key: string): DynamicUnitRun | null {
    const row = this.db.prepare('SELECT payload FROM local_dynamic_unit_run WHERE owner = ? AND project = ? AND operation = ?')
      .get(this.owner, project, key);
    return row ? decode<DynamicUnitRun>(row) : null;
  }

  private replay(project: string, profile: string, key: string, timeout: number): DynamicUnitRun | null {
    const run = this.operation(project, key);
    if (run && (run.environmentId !== profile || run.createdBy !== this.owner || run.timeoutMs !== timeout)) {
      throw new DynamicContractError(409, 'Unit request identity conflicts with its recorded Run.');
    }
    return run;
  }

  private newRun(projectId: string, environmentId: string, idempotencyKey: string, timeoutMs: number, command: UnitCommand, reserve: boolean): DynamicUnitRun {
    const id = randomUUID(), timestamp = new Date(this.now()).toISOString();
    return { id, projectId, environmentId, kind: 'unit', state: 'queued', verdict: 'not_tested', createdBy: this.owner,
      createdAt: timestamp, updatedAt: timestamp, idempotencyKey, command, timeoutMs,
      environment: this.environments.unitEnvironment(projectId, environmentId, reserve ? id : undefined), result: null, reason: null };
  }

  private insert(run: DynamicUnitRun) {
    this.db.prepare('INSERT INTO local_dynamic_unit_run VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)')
      .run(this.owner, run.projectId, run.id, run.environmentId, run.idempotencyKey, run.state, run.createdAt, JSON.stringify(run));
  }

  private write(run: DynamicUnitRun, token: string | null) {
    this.db.prepare('UPDATE local_dynamic_unit_run SET state = ?, token = ?, payload = ? WHERE owner = ? AND project = ? AND id = ?')
      .run(run.state, token, JSON.stringify(run), this.owner, run.projectId, run.id);
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
