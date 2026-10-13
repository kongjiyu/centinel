import type { EnvironmentSnapshot } from './environment/types.js';
import crypto from 'node:crypto';
import { dynamicWorkerId } from './recovery.js';
import { aggregateChecks } from './checker.js';
import { DynamicContractError, type CheckResult, type DynamicRepository, type DynamicRun, type EvidenceReference, type MissionInput, type RunPatch } from './types.js';

export function validateMission(value: unknown, projectId: string): MissionInput {
  const fail = (message: string): never => { throw new DynamicContractError(400, message); };
  if (!value || typeof value !== 'object') fail('Mission body is required.');
  const input = value as MissionInput;
  for (const key of ['name', 'goal', 'targetUrl'] as const) if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 4000) fail(`${key} is required and must be bounded.`);
  try { if (!['http:', 'https:'].includes(new URL(input.targetUrl).protocol) || new URL(input.targetUrl).username || new URL(input.targetUrl).password) fail('Target URL must be HTTP(S) without credentials.'); }
  catch { fail('Target URL must be HTTP(S) without credentials.'); }
  if (!Number.isInteger(input.maxSteps) || input.maxSteps < 1 || input.maxSteps > 25) fail('maxSteps must be an integer from 1 to 25.');
  if (!Array.isArray(input.checks) || input.checks.length < 1 || input.checks.length > 20 || !input.checks.some(check => check?.required === true)) fail('At least one required check is necessary (maximum 20 checks).');
  const ids = new Set<string>();
  for (const check of input.checks) {
    if (!check || typeof check.id !== 'string' || !check.id || ids.has(check.id) || typeof check.criterionId !== 'string' || !check.criterionId || typeof check.description !== 'string' || !check.description || typeof check.required !== 'boolean') fail('Checks require unique IDs, criterion IDs, descriptions and required flags.');
    ids.add(check.id);
    if (!['url', 'visible_text', 'element_visible'].includes(check.kind)) fail('Unsupported check kind.');
    const expectation = check.kind === 'element_visible' ? check.selector : check.expected;
    if (typeof expectation !== 'string' || !expectation.trim() || expectation.length > 1000) fail('Check expectation must be non-empty and bounded.');
    if (check.kind === 'url') {
      try { if (new URL(check.expected).origin !== new URL(input.targetUrl).origin) fail('URL check must belong to the target origin.'); }
      catch { fail('URL check must belong to the target origin.'); }
    }
  }
  if (input.context != null) {
    const context = input.context;
    if (['reviewId', 'snapshotId'].some(key => typeof context[key as 'reviewId' | 'snapshotId'] !== 'string' || !context[key as 'reviewId' | 'snapshotId'])) fail('Incoming snapshot identifiers are required.');
    if (typeof context !== 'object' || Array.isArray(context) || context.schemaVersion !== 1 || context.provenance !== 'mock-static' || context.projectId !== projectId || !Array.isArray(context.requirements) || !Array.isArray(context.sources) || !Array.isArray(context.conflicts)) fail('Invalid or cross-project incoming context.');
    if (!['approved', 'pending'].includes(context.approvalState) || context.sources.some(source => !source || typeof source.id !== 'string' || !source.id || typeof source.version !== 'string' || !source.version || !['current', 'stale', 'unknown'].includes(source.currency))) fail('Invalid incoming context metadata.');
    const sources = new Set(context.sources.map(source => source.id));
    if (sources.size !== context.sources.length) fail('Duplicate incoming source IDs.');
    if (context.requirements.some(requirement => !requirement || typeof requirement.id !== 'string' || !requirement.id || !Number.isInteger(requirement.revision) || requirement.revision < 1 || !sources.has(requirement.sourceId) || !Array.isArray(requirement.criteria) || requirement.criteria.some(criterion => !criterion || typeof criterion.id !== 'string' || !criterion.id))) fail('Incoming context contains dangling sources or missing criteria.');
    const criteria = new Set(context.requirements.flatMap(requirement => requirement.criteria.map(criterion => criterion.id)));
    if (input.checks.some(check => !criteria.has(check.criterionId))) fail('Check references a criterion absent from the incoming snapshot.');
    const warnings = context.approvalState !== 'approved' || context.conflicts.length > 0 || context.sources.some(source => source.currency !== 'current');
    if (warnings && input.contextAcknowledged !== true) fail('Acknowledge stale, conflicting or unapproved mock context before use.');
  }
  // Construct only the supported fields so arbitrary caller metadata is not persisted.
  return structuredClone({ name: input.name.trim(), goal: input.goal.trim(), targetUrl: input.targetUrl.trim(), maxSteps: input.maxSteps, checks: input.checks.map(check => ({ id: check.id, criterionId: check.criterionId, description: check.description, required: check.required, ...(check.kind === 'element_visible' ? { kind: check.kind, selector: check.selector } : { kind: check.kind, expected: check.expected }) })), context: input.context ?? null, contextAcknowledged: input.contextAcknowledged === true });
}

export class DynamicService {
  private readonly leaseTokens = new Map<string, string>();
  constructor(readonly repository: DynamicRepository, readonly workerId = dynamicWorkerId) {}
  saveMission(projectId: string, actorId: string, input: unknown, missionId?: string) {
    return this.repository.saveRevision(projectId, actorId, validateMission(input, projectId), missionId);
  }
  async start(projectId: string, actorId: string, revisionId: string, idempotencyKey: string, environment?: EnvironmentSnapshot) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 128) throw new DynamicContractError(400, 'A bounded idempotencyKey is required.');
    const revision = await this.repository.getRevision(projectId, revisionId);
    if (!revision) throw new DynamicContractError(404, 'Mission revision not found.');
    return this.repository.createRun(projectId, actorId, revision, idempotencyKey.trim(), environment);
  }
  async claim(projectId: string, runId: string, legacySessionId: string | null = null) {
    const run = await this.requireRun(projectId, runId);
    const token = crypto.randomUUID();
    const claimed = await this.repository.claimRun(projectId, runId, this.workerId, token, legacySessionId);
    if (!claimed) throw new DynamicContractError(409, 'Run has already been claimed or stopped.');
    this.leaseTokens.set(runId, token);
    return claimed;
  }
  async heartbeat(projectId: string, runId: string) {
    const token = this.leaseTokens.get(runId);
    return token ? this.repository.heartbeatRun(projectId, runId, this.workerId, token) : false;
  }
  recover(projectId: string) { return this.repository.recoverRuns(projectId); }
  async finish(projectId: string, runId: string, results: CheckResult[], evidence: EvidenceReference[]) {
    const run = await this.requireRun(projectId, runId);
    if (run.state !== 'running') throw new DynamicContractError(409, 'Only a running Run can be verified.');
    const evidenceIds = new Set(evidence.map(item => item.id));
    const checks = run.revision.checks;
    for (const result of results) {
      if (!checks.some(check => check.id === result.checkId && check.criterionId === result.criterionId) || !['passed', 'failed', 'uncertain', 'not_tested'].includes(result.verdict)) throw new DynamicContractError(400, 'Unknown check result.');
      if (result.evidenceIds.some(id => !evidenceIds.has(id))) throw new DynamicContractError(400, 'Dangling evidence reference.');
    }
    if (evidence.some(item => !/^[a-f0-9]{64}$/.test(item.sha256)) || evidenceIds.size !== evidence.length) throw new DynamicContractError(400, 'Evidence requires unique IDs and SHA-256 hashes.');
    const verified = results.map(result => result.verdict === 'passed' || result.verdict === 'failed'
      ? result.evidenceIds.length ? result : { ...result, verdict: 'uncertain' as const, reason: 'No retained evidence supports this observation.' }
      : result);
    const verdict = aggregateChecks(checks, verified);
    const updated = await this.repository.compareAndSetRun(projectId, runId, 'running', this.patch(run, { state: 'completed', verdict, checks: verified, evidence, reason: null }));
    if (!updated) throw new DynamicContractError(409, 'Run was stopped while verification completed.');
    return updated;
  }
  async stop(projectId: string, runId: string, state: 'blocked' | 'cancelled' | 'interrupted', reason: string) {
    const run = await this.requireRun(projectId, runId);
    if (!['queued', 'running'].includes(run.state)) return run;
    const result = await this.repository.compareAndSetRun(projectId, runId, run.state, this.patch(run, { state, verdict: 'not_tested', reason }));
    return result ?? this.requireRun(projectId, runId);
  }
  async requireRun(projectId: string, runId: string) {
    const run = await this.repository.getRun(projectId, runId);
    if (!run) throw new DynamicContractError(404, 'Run not found.');
    return run;
  }
  private patch(run: DynamicRun, changes: Partial<RunPatch>): RunPatch {
    return { state: run.state, verdict: run.verdict, reason: run.reason, checks: run.checks, evidence: run.evidence, legacySessionId: run.legacySessionId, ...(this.leaseTokens.has(run.id) ? { leaseToken: this.leaseTokens.get(run.id) } : {}), updatedAt: new Date().toISOString(), ...changes };
  }
}
