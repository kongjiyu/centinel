import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ExplorationSnapshot } from './browser/exploration.js';
import { normalizeBudget } from './budgets.js';
import type { LocalEnvironmentRepository } from './environment/localRepository.js';
import type { EnvironmentSnapshot } from './environment/types.js';
import { requireNoLocalUnitWork } from './unit/localRepository.js';
import { requireNoLocalHookWork } from './workspace/localHooks.js';
import { requireNoLocalCapture } from './environment/localCaptureRepository.js';
import type { LocalDynamicHistory } from './localHistory.js';
import { DYNAMIC_LEASE_MS, DYNAMIC_LEGACY_GRACE_MS, DYNAMIC_QUEUE_GRACE_MS } from './recovery.js';
import { freezeRegressionBaseline } from './regression.js';
import {
  DynamicContractError, type DynamicRepository, type DynamicRun, type MissionInput, type MissionRevision,
  type MissionUpdate, type RunEvidenceReader, type RunPatch, type RunState,
} from './types.js';

export class LocalDynamicRunRepository implements DynamicRepository {
  constructor(private readonly db: DatabaseSync, private readonly owner: string,
    private readonly history: LocalDynamicHistory, private readonly environments: LocalEnvironmentRepository,
    private readonly now = Date.now) {}

  async saveRevision(project: string, actor: string, input: MissionInput, mission?: string) {
    return this.history.saveMission(project, actor, input, mission);
  }

  async listMissions(project: string) { return this.history.listMissions(project); }
  async getMission(project: string, id: string) { return this.history.mission(project, id); }
  async updateMission(project: string, actor: string, id: string, update: MissionUpdate) {
    return this.history.updateMission(project, actor, id, update);
  }
  async getRevision(project: string, id: string) { return this.history.revision(project, id); }
  async getRun(project: string, id: string) { return this.history.run(project, id); }
  async listRuns(project: string, mission?: string) {
    const runs = this.history.listRuns(project);
    return mission === undefined ? runs : runs.filter(run => run.missionId === mission);
  }

  async getRunByKey(project: string, key: string) { return this.findOperation(project, key); }

  async createRun(project: string, actor: string, revision: MissionRevision, key: string,
    environment?: EnvironmentSnapshot, baselineRunId?: string) {
    return this.transaction(() => {
      const savedRevision = this.history.revision(project, revision.id);
      const mission = savedRevision && this.history.mission(project, savedRevision.missionId);
      if (actor !== this.owner || !savedRevision || !mission) throw new DynamicContractError(404, 'Saved test not found.');
      const existing = this.findOperation(project, key);
      if (existing) {
        if (existing.revision.id !== revision.id || existing.createdBy !== actor || existing.environment?.id !== environment?.id
          || existing.regression?.runId !== baselineRunId) {
          throw new DynamicContractError(409, 'Idempotency key belongs to a different request.');
        }
        return { run: existing, reused: true };
      }
      if (mission.archivedAt) throw new DynamicContractError(409, 'Unarchive this saved test before running it.');
      requireNoLocalUnitWork(this.db, this.owner, project);
      requireNoLocalHookWork(this.db, this.owner, project);
      requireNoLocalCapture(this.db, this.owner, project);
      const active = this.db.prepare(`SELECT 1 FROM local_dynamic_run WHERE owner = ? AND project = ?
        AND json_extract(payload, '$.environment.id') IS ? AND json_extract(payload, '$.state') IN ('queued', 'running') LIMIT 1`)
        .get(this.owner, project, environment?.id ?? null);
      if (active) throw new DynamicContractError(409, 'A Run is already active for this environment.');
      if (!environment) this.environments.requireUnreservedOrigin(project, savedRevision.targetUrl);
      const now = this.now();
      const timestamp = new Date(now).toISOString();
      const id = randomUUID();
      const frozenEnvironment = environment && this.environments.reserveForRun(project, id, savedRevision.targetUrl, environment, now);
      const executionBudget = normalizeBudget(frozenEnvironment?.budgets);
      executionBudget.maxSteps = Math.min(executionBudget.maxSteps, savedRevision.maxSteps);
      const run: DynamicRun = {
        id, projectId: project, missionId: mission.id, revision: savedRevision, idempotencyKey: key,
        ...(frozenEnvironment ? { environment: frozenEnvironment, actionPolicy: frozenEnvironment.actionPolicy } : {}),
        createdBy: actor, createdAt: timestamp, updatedAt: timestamp, executionBudget, state: 'queued',
        verdict: 'not_tested', checks: [], evidence: [], reason: null, legacySessionId: null,
      };
      if (savedRevision.usability) {
        run.executionVersions = {
          observer: 2, planner: 2, policy: 2, executor: 2, checker: 3, usability: savedRevision.usability.includeSuggestions ? 2 : 1,
        };
      }
      if (baselineRunId) {
        const baseline = this.history.run(project, baselineRunId);
        if (!baseline || baseline.state !== 'completed' || baseline.revision.id !== savedRevision.id
          || !baseline.checks.length || !baseline.evidence.length) {
          throw new DynamicContractError(409, 'Invalid regression baseline.');
        }
        run.regression = freezeRegressionBaseline(baseline);
      }
      this.db.prepare('INSERT INTO local_dynamic_run VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(this.owner, project, mission.id, savedRevision.id, run.id, key, timestamp, JSON.stringify(run));
      return { run, reused: false };
    });
  }

  async claimRun(project: string, id: string, workerId: string, token: string, sessionId: string | null) {
    return this.transaction(() => {
      const run = this.history.run(project, id);
      const now = this.now();
      if (!run || run.state !== 'queued' || Date.parse(run.createdAt) + DYNAMIC_QUEUE_GRACE_MS <= now) return null;
      if (run.environment && (!run.environment.preflight.length || run.environment.preflight.some(check => !check.ready)
        || (run.environment.sessionReference && (!run.environment.sessionSnapshot
          || Date.parse(run.environment.sessionSnapshot.expiresAt) <= now)))) return null;
      run.state = 'running';
      run.legacySessionId = sessionId;
      run.lease = this.lease(workerId, now);
      run.updatedAt = run.lease.heartbeatAt;
      this.db.prepare('INSERT INTO local_dynamic_run_claim VALUES (?, ?, ?, ?)').run(this.owner, project, id, token);
      this.write(run);
      return run;
    });
  }

  async heartbeatRun(project: string, id: string, workerId: string, token: string) {
    return this.transaction(() => {
      const run = this.history.run(project, id);
      const now = this.now();
      if (!run || run.lease?.workerId !== workerId || !this.claimMatches(run, token, now)) return false;
      run.lease = this.lease(workerId, now);
      run.updatedAt = run.lease.heartbeatAt;
      this.write(run);
      return true;
    });
  }

  async recoverRuns(project: string) {
    return this.transaction(() => {
      const now = this.now();
      const rows = this.db.prepare(`SELECT payload FROM local_dynamic_run WHERE owner = ? AND project = ?
        AND json_extract(payload, '$.state') IN ('queued', 'running')`).all(this.owner, project);
      const recovered: DynamicRun[] = [];
      for (const row of rows) {
        const run = JSON.parse(String(row.payload)) as DynamicRun;
        const deadline = run.state === 'queued' ? Date.parse(run.createdAt) + DYNAMIC_QUEUE_GRACE_MS
          : run.lease ? Date.parse(run.lease.expiresAt) : Date.parse(run.updatedAt) + DYNAMIC_LEGACY_GRACE_MS;
        if (deadline > now) continue;
        run.state = 'interrupted';
        run.lease = null;
        run.verdict = 'not_tested';
        run.reason = 'Execution stopped responding. Inspect partial evidence and start a new run when ready.';
        run.updatedAt = new Date(now).toISOString();
        this.finish(run);
        recovered.push(run);
      }
      return recovered;
    });
  }

  async checkpointExploration(project: string, id: string, workerId: string, token: string, snapshot: ExplorationSnapshot) {
    return this.transaction(() => {
      const run = this.history.run(project, id);
      if (!run || run.revision.mode !== 'exploratory' || run.lease?.workerId !== workerId
        || !this.claimMatches(run, token, this.now())) return false;
      run.exploration = snapshot;
      this.write(run);
      return true;
    });
  }

  async compareAndSetRun(project: string, id: string, expected: RunState, patch: RunPatch, readEvidence?: RunEvidenceReader) {
    return this.transaction(() => {
      const run = this.history.run(project, id);
      if (!run || run.state !== expected || (expected !== 'queued' && expected !== 'running')) return null;
      if (!['blocked', 'cancelled', 'interrupted'].includes(patch.state) && !(expected === 'running' && patch.state === 'completed')) {
        throw new DynamicContractError(409, 'Invalid Run transition.');
      }
      if (expected === 'running' && patch.state !== 'cancelled' && !this.claimMatches(run, patch.leaseToken, this.now())) {
        return null;
      }
      if (patch.state === 'completed' && patch.evidence.length) {
        if (!readEvidence) throw new DynamicContractError(409, 'Independent evidence bytes must be retained before completion.');
        for (const ref of patch.evidence) this.history.retainEvidence(project, id, ref, readEvidence(ref));
      }
      const { leaseToken: _token, ...publicPatch } = patch;
      Object.assign(run, publicPatch, { lease: null });
      this.finish(run);
      return run;
    });
  }

  private findOperation(project: string, key: string): DynamicRun | null {
    const row = this.db.prepare('SELECT payload FROM local_dynamic_run WHERE owner = ? AND project = ? AND operation = ?')
      .get(this.owner, project, key);
    return row ? JSON.parse(String(row.payload)) as DynamicRun : null;
  }

  private lease(workerId: string, now: number) {
    return { workerId, heartbeatAt: new Date(now).toISOString(), expiresAt: new Date(now + DYNAMIC_LEASE_MS).toISOString() };
  }

  private claimMatches(run: DynamicRun, token: string | undefined, now: number) {
    if (!token || run.state !== 'running' || !run.lease || Date.parse(run.lease.expiresAt) <= now) return false;
    return this.db.prepare('SELECT token FROM local_dynamic_run_claim WHERE owner = ? AND project = ? AND run = ?')
      .get(this.owner, run.projectId, run.id)?.token === token;
  }

  private finish(run: DynamicRun) {
    if (run.environment) this.environments.finishRun(run.projectId, run.environment.id, run.id);
    this.db.prepare('DELETE FROM local_dynamic_run_claim WHERE owner = ? AND project = ? AND run = ?')
      .run(this.owner, run.projectId, run.id);
    this.write(run);
  }

  private write(run: DynamicRun) {
    this.db.prepare('UPDATE local_dynamic_run SET payload = ? WHERE owner = ? AND project = ? AND id = ?')
      .run(JSON.stringify(run), this.owner, run.projectId, run.id);
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
