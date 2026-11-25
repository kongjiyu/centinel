import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { LocalEnvironmentRepository } from '../environment/localRepository.js';
import { requireNoLocalCapture } from '../environment/localCaptureRepository.js';
import { DYNAMIC_QUEUE_GRACE_MS } from '../recovery.js';
import { DynamicContractError } from '../types.js';
import { requireNoLocalUnitWork } from '../unit/localRepository.js';
import type { HookStore } from './hookRepository.js';
import type { CleanupSource, HookKind, HookOperation } from './operations.js';
import type { ProcessResult } from './process.js';

export const localHookSchema = `
  CREATE TABLE IF NOT EXISTS local_dynamic_hook (
    owner TEXT NOT NULL, project TEXT NOT NULL, profile TEXT NOT NULL, id TEXT NOT NULL, operation TEXT NOT NULL,
    state TEXT NOT NULL, created TEXT NOT NULL, token TEXT, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, id), UNIQUE (owner, project, operation),
    FOREIGN KEY (owner, project, profile) REFERENCES local_dynamic_environment(owner, project, id)
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS local_dynamic_hook_active ON local_dynamic_hook(owner, project) WHERE state IN ('queued','running');
  CREATE INDEX IF NOT EXISTS local_dynamic_hook_recent ON local_dynamic_hook(owner, project, profile, created DESC,id);
`;

const decode = (row: { payload?: unknown }): HookOperation => JSON.parse(String(row.payload));
const active = (operation: HookOperation) => operation.state === 'queued' || operation.state === 'running';
const leaseMs = 90_000;

export function requireNoLocalHookWork(db: DatabaseSync, owner: string, project: string): void {
  if (db.prepare("SELECT 1 FROM local_dynamic_hook WHERE owner = ? AND project = ? AND state IN ('queued','running')").get(owner, project)) {
    throw new DynamicContractError(409, 'A setup or cleanup script is already active in this project.');
  }
}

export class LocalHooks implements HookStore {
  constructor(private readonly db: DatabaseSync, private readonly owner: string, private readonly environments: LocalEnvironmentRepository,
    private readonly now = Date.now) {}

  async get(project: string, id: string) { return this.read(project, id); }
  async byKey(project: string, key: string) { return this.operation(project, key); }
  async list(project: string, profile: string) {
    await this.recover(project);
    return this.db.prepare(`SELECT payload FROM local_dynamic_hook WHERE owner = ? AND project = ? AND profile = ?
      ORDER BY created DESC,id LIMIT 100`).all(this.owner, project, profile).map(decode);
  }

  async start(project: string, profile: string, kind: HookKind, key: string, command: HookOperation['command'], source?: CleanupSource) {
    if (!['setup', 'cleanup'].includes(kind) || !key.trim() || key.length > 128
      || !['pnpm', 'yarn'].includes(command.program) || !/^[A-Za-z0-9][\w:.-]{0,100}$/.test(command.script)
      || ![command.fingerprint, command.authorizationId].every(value => /^[a-f0-9]{64}$/.test(value))) {
      throw new DynamicContractError(400, 'Select an authorized setup or cleanup script.');
    }
    await this.recover(project);
    return this.transaction(() => {
      const prior = this.operation(project, key);
      if (prior) {
        if (prior.createdBy !== this.owner || prior.environmentId !== profile || prior.kind !== kind) throw new DynamicContractError(409, 'Hook idempotency conflict.');
        return { operation: prior, reused: true };
      }
      requireNoLocalHookWork(this.db, this.owner, project);
      requireNoLocalCapture(this.db, this.owner, project);
      requireNoLocalUnitWork(this.db, this.owner, project);
      if (this.db.prepare(`SELECT 1 FROM local_dynamic_run WHERE owner = ? AND project = ?
        AND json_extract(payload, '$.state') IN ('queued', 'running')`).get(this.owner, project)) {
        throw new DynamicContractError(409, 'A Browser Run is already active in this project.');
      }
      const id = randomUUID(), stamp = new Date(this.now()).toISOString();
      const operation: HookOperation = { id, projectId: project, environmentId: profile, kind,
        state: 'queued', verdict: 'not_tested', createdBy: this.owner, createdAt: stamp, updatedAt: stamp,
        idempotencyKey: key, command, environment: this.environments.reserveHook(project, profile, kind, id, source),
        result: null, reason: null };
      this.insert(operation);
      return { operation, reused: false };
    });
  }

  async claim(project: string, id: string, worker: string, token: string) {
    return this.transaction(() => {
      const operation = this.read(project, id), time = this.now();
      if (operation.state !== 'queued' || Date.parse(operation.createdAt) + DYNAMIC_QUEUE_GRACE_MS <= time) return null;
      operation.state = 'running';
      this.renew(operation, worker, token, time);
      return operation;
    });
  }

  async heartbeat(project: string, id: string, worker: string, token: string) {
    return this.transaction(() => {
      const operation = this.read(project, id), time = this.now();
      if (operation.cancelRequested || operation.lease?.workerId !== worker || !this.matches(operation, token, time)) return false;
      this.renew(operation, worker, token, time);
      return true;
    });
  }

  async finish(project: string, id: string, token: string, result: ProcessResult) {
    return this.transaction(() => {
      const operation = this.read(project, id);
      if (!this.matches(operation, token, this.now())) return null;
      const outcome = operation.cancelRequested ? 'cancelled' : result.outcome;
      operation.result = { ...result, outcome, output: result.output.slice(0, 8192), truncated: result.truncated || result.output.length > 8192 };
      operation.verdict = outcome === 'passed' || outcome === 'failed' ? outcome : 'not_tested';
      return this.stop(operation, outcome === 'cancelled' ? 'cancelled' : operation.verdict !== 'not_tested' ? 'completed' : 'blocked',
        outcome === 'passed' ? null : 'Approved script ended: ' + outcome + '. Inspect local output and confirm cleanup.');
    });
  }

  async cancel(project: string, id: string) {
    return this.transaction(() => {
      const operation = this.read(project, id);
      if (!active(operation)) return operation;
      if (operation.state === 'queued') return this.stop(operation, 'cancelled', 'Cancelled before execution. Confirm cleanup before reuse.');
      operation.cancelRequested = true;
      operation.updatedAt = new Date(this.now()).toISOString();
      operation.reason = 'Stop requested. Waiting for the executing worker to terminate.';
      this.db.prepare('UPDATE local_dynamic_hook SET payload = ? WHERE owner = ? AND project = ? AND id = ?')
        .run(JSON.stringify(operation), this.owner, project, id);
      return operation;
    });
  }

  async recover(project: string) {
    return this.transaction(() => {
      const now = this.now();
      return this.db.prepare("SELECT payload FROM local_dynamic_hook WHERE owner = ? AND project = ? AND state IN ('queued','running')")
        .all(this.owner, project).map(decode)
        .filter(operation => (operation.state === 'queued' ? Date.parse(operation.createdAt) + DYNAMIC_QUEUE_GRACE_MS
          : Date.parse(operation.lease?.expiresAt ?? '')) <= now)
        .map(operation => this.stop(operation, 'interrupted', 'Data operation stopped responding. Confirm cleanup before reuse.'));
    });
  }

  seed(project: string, operations: HookOperation[]) {
    if (!Array.isArray(operations)) throw new Error('Invalid setup and cleanup history.');
    for (const operation of operations) {
      if (!operation || operation.projectId !== project || operation.environment?.projectId !== project
        || operation.environment.id !== operation.environmentId || !operation.id || !operation.idempotencyKey
        || !['setup', 'cleanup'].includes(operation.kind) || !['queued', 'running', 'completed', 'cancelled', 'interrupted', 'blocked'].includes(operation.state)
        || !Number.isFinite(Date.parse(operation.createdAt)) || !Number.isFinite(Date.parse(operation.updatedAt))
        || Buffer.byteLength(JSON.stringify(operation)) > 4 * 1024 * 1024) throw new Error('Invalid setup or cleanup record.');
      const saved = active(operation) ? { ...operation, state: 'interrupted' as const, verdict: 'not_tested' as const,
        reason: 'Data operation interrupted during migration. Confirm cleanup before reuse.' } : { ...operation };
      delete saved.lease;
      this.insert(saved);
    }
  }

  private read(project: string, id: string) {
    const row = this.db.prepare('SELECT payload FROM local_dynamic_hook WHERE owner = ? AND project = ? AND id = ?').get(this.owner, project, id);
    if (!row) throw new DynamicContractError(404, 'Data operation not found.');
    return decode(row);
  }
  private operation(project: string, key: string) {
    const row = this.db.prepare('SELECT payload FROM local_dynamic_hook WHERE owner = ? AND project = ? AND operation = ?').get(this.owner, project, key);
    return row ? decode(row) : null;
  }
  private renew(operation: HookOperation, workerId: string, token: string, time: number) {
    const heartbeatAt = new Date(time).toISOString();
    operation.lease = { workerId, heartbeatAt, expiresAt: new Date(time + leaseMs).toISOString() };
    operation.updatedAt = heartbeatAt;
    this.write(operation, token);
  }
  private matches(operation: HookOperation, token: string, now: number) {
    return !!token && operation.state === 'running' && !!operation.lease && Date.parse(operation.lease.expiresAt) > now
      && this.db.prepare('SELECT token FROM local_dynamic_hook WHERE owner = ? AND project = ? AND id = ?')
        .get(this.owner, operation.projectId, operation.id)?.token === token;
  }
  private stop(operation: HookOperation, state: HookOperation['state'], reason: string | null) {
    Object.assign(operation, { state, reason, updatedAt: new Date(this.now()).toISOString() });
    delete operation.lease;
    this.environments.finishHook(operation);
    this.write(operation, null);
    return operation;
  }
  private insert(operation: HookOperation) {
    this.db.prepare('INSERT INTO local_dynamic_hook VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)').run(this.owner,
      operation.projectId, operation.environmentId, operation.id, operation.idempotencyKey, operation.state, operation.createdAt, JSON.stringify(operation));
  }
  private write(operation: HookOperation, token: string | null) {
    this.db.prepare('UPDATE local_dynamic_hook SET state = ?, token = ?, payload = ? WHERE owner = ? AND project = ? AND id = ?')
      .run(operation.state, token, JSON.stringify(operation), this.owner, operation.projectId, operation.id);
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
