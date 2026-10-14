import type {ExplorationSnapshot} from './browser/exploration.js';
import {normalizeBudget} from './budgets.js';
import type { EnvironmentSnapshot } from './environment/types.js';
import { DYNAMIC_LEASE_MS, DYNAMIC_QUEUE_GRACE_MS, DYNAMIC_LEGACY_GRACE_MS } from './recovery.js';
import crypto from 'node:crypto';
import { DynamicContractError, type DynamicRepository, type DynamicRun, type Mission, type MissionInput, type MissionRevision, type RunPatch, type RunState } from './types.js';

/** Explicit test/development injection only; never a production persistence fallback. */
export class InMemoryDynamicRepository implements DynamicRepository {
  private readonly leaseTokens = new Map<string, string>();
  constructor(private readonly now: () => number = Date.now) {}
  private missions = new Map<string, Mission>();
  private revisions = new Map<string, MissionRevision>();
  private runs = new Map<string, DynamicRun>();
  async saveRevision(projectId: string, actorId: string, input: MissionInput, missionId?: string) {
    const now = new Date(this.now()).toISOString();
    let mission = missionId ? this.missions.get(missionId) : undefined;
    if (missionId && (!mission || mission.projectId !== projectId)) throw new DynamicContractError(404, 'Mission not found.');
    mission ??= { id: crypto.randomUUID(), projectId, currentRevisionId: '', createdBy: actorId, createdAt: now };
    const revision = { ...structuredClone(input), id: crypto.randomUUID(), missionId: mission.id, projectId, revision: [...this.revisions.values()].filter(row => row.missionId === mission!.id).length + 1, createdBy: actorId, createdAt: now };
    mission.currentRevisionId = revision.id;
    this.missions.set(mission.id, mission);
    this.revisions.set(revision.id, revision);
    return structuredClone(revision);
  }
  async listMissions(projectId: string) { return structuredClone([...this.missions.values()].filter(row => row.projectId === projectId)); }
  async getRevision(projectId: string, id: string) { const row = this.revisions.get(id); return row?.projectId === projectId ? structuredClone(row) : null; }
  async getRun(projectId: string, id: string) { const row = this.runs.get(id); return row?.projectId === projectId ? structuredClone(row) : null; }
  async listRuns(projectId: string, missionId?: string) { return structuredClone([...this.runs.values()].filter(row => row.projectId === projectId && (!missionId || row.missionId === missionId))); }
  async getRunByKey(projectId: string, key: string) { const row = [...this.runs.values()].find(run => run.projectId === projectId && run.idempotencyKey === key); return row ? structuredClone(row) : null; }
  async createRun(projectId: string, actorId: string, revision: MissionRevision, key: string, environment?: EnvironmentSnapshot) {
    const existing = [...this.runs.values()].find(run => run.projectId === projectId && run.idempotencyKey === key);
    if (existing) {
      if (existing.revision.id !== revision.id || existing.createdBy !== actorId || existing.environment?.id !== environment?.id) throw new DynamicContractError(409, 'Idempotency key belongs to a different request.');
      return { run: structuredClone(existing), reused: true };
    }
    if ([...this.runs.values()].some(run => run.projectId === projectId && ['queued', 'running'].includes(run.state))) throw new DynamicContractError(409, 'A Run is already active in this project.');
    const now = new Date(this.now()).toISOString();
    const limits=normalizeBudget(environment?.budgets);limits.maxSteps=Math.min(limits.maxSteps,revision.maxSteps);
    const run: DynamicRun = { executionBudget:limits, ...(environment ? {environment:structuredClone(environment)} : {}), id: crypto.randomUUID(), projectId, missionId: revision.missionId, revision: structuredClone(revision), idempotencyKey: key, createdBy: actorId, createdAt: now, updatedAt: now, state: 'queued', verdict: 'not_tested', checks: [], evidence: [], reason: null, legacySessionId: null };
    this.runs.set(run.id, run);
    return { run: structuredClone(run), reused: false };
  }
  async claimRun(projectId: string, runId: string, workerId: string, leaseToken: string, sessionId: string | null) {
    const row = this.runs.get(runId);
    if (!row || row.projectId !== projectId || row.state !== 'queued' || Date.parse(row.createdAt) + DYNAMIC_QUEUE_GRACE_MS <= this.now()) return null;
    row.state = 'running'; row.legacySessionId = sessionId;
    row.lease = { workerId, heartbeatAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now() + DYNAMIC_LEASE_MS).toISOString() };
    row.updatedAt = new Date(this.now()).toISOString();
    this.leaseTokens.set(runId, leaseToken);
    return structuredClone(row);
  }
  async heartbeatRun(projectId: string, runId: string, workerId: string, leaseToken: string) {
    const row = this.runs.get(runId);
    if (!row || row.projectId !== projectId || row.state !== 'running' || row.lease?.workerId !== workerId || this.leaseTokens.get(runId) !== leaseToken || Date.parse(row.lease.expiresAt) <= this.now()) return false;
    row.lease.heartbeatAt = new Date(this.now()).toISOString();
    row.lease.expiresAt = new Date(this.now() + DYNAMIC_LEASE_MS).toISOString();
    return true;
  }
  async recoverRuns(projectId: string) {
    const changed: DynamicRun[] = [];
    for (const row of this.runs.values()) {
      if (row.projectId !== projectId) continue;
      const stale = row.state === 'queued' ? Date.parse(row.createdAt) + DYNAMIC_QUEUE_GRACE_MS <= this.now()
        : row.state === 'running' && (row.lease ? Date.parse(row.lease.expiresAt) <= this.now() : Date.parse(row.updatedAt) + DYNAMIC_LEGACY_GRACE_MS <= this.now());
      if (!stale) continue;
      row.state = 'interrupted'; row.verdict = 'not_tested'; row.reason = 'Execution stopped responding. Inspect partial evidence and start a new run when the test environment is ready.';
      row.updatedAt = new Date(this.now()).toISOString(); this.leaseTokens.delete(row.id);
      changed.push(structuredClone(row));
    }
    return changed;
  }
  async checkpointExploration(projectId:string,id:string,workerId:string,token:string,snapshot:ExplorationSnapshot){const row=this.runs.get(id);if(!row||row.projectId!==projectId||row.state!=='running'||row.revision.mode!=='exploratory'||row.lease?.workerId!==workerId||token!==this.leaseTokens.get(id)||Date.parse(row.lease.expiresAt)<=this.now())return false;row.exploration=structuredClone(snapshot);return true;}
  async compareAndSetRun(projectId: string, id: string, expected: RunState, patch: RunPatch) {
    const row = this.runs.get(id);
    if (!row || row.projectId !== projectId || row.state !== expected || !['queued', 'running'].includes(expected)) return null;
    if (!(['blocked', 'cancelled', 'interrupted'].includes(patch.state) || (expected === 'queued' && patch.state === 'running') || (expected === 'running' && patch.state === 'completed'))) throw new DynamicContractError(409, 'Invalid Run transition.');
    if (expected === 'running' && row.lease && patch.state !== 'cancelled' && (patch.leaseToken !== this.leaseTokens.get(id) || Date.parse(row.lease.expiresAt) <= this.now())) return null;
    const { leaseToken: _token, ...publicPatch } = patch;
    Object.assign(row, structuredClone(publicPatch));
    if (!['queued', 'running'].includes(row.state)) this.leaseTokens.delete(id);
    return structuredClone(row);
  }
}
