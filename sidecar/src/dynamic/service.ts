import {validateUsabilityResult} from './usability/resultValidation.js';
import type {UsabilityAssessment} from './usability/types.js';
import {validateUsability} from './usability/validation.js';
import {resolveExplorationObjectives} from './browser/exploration.js';
import type {ExplorationSnapshot} from './browser/exploration.js';
import {validateIncomingContext,validateCriterionExclusions,contextNeedsAcknowledgment} from './context.js';
import type { EnvironmentSnapshot } from './environment/types.js';
import crypto from 'node:crypto';
import { dynamicWorkerId } from './recovery.js';
import { aggregateChecks } from './checker.js';
import {publicDownloadUrl} from './browser/fileTypes.js';
import { DynamicContractError, type CheckResult, type DynamicRepository, type DynamicRun, type EvidenceReference, type MissionInput, type RunPatch } from './types.js';

export function validateMission(value: unknown, projectId: string): MissionInput {
  const fail = (message: string): never => { throw new DynamicContractError(400, message); };
  if (!value || typeof value !== 'object') fail('Mission body is required.');
  const input = value as MissionInput;
  if(input.mode!==undefined&&!['guided','exploratory'].includes(input.mode))fail('Choose guided or exploratory mode.');
  if(input.contextAcknowledged!==undefined&&typeof input.contextAcknowledged!=='boolean')fail('Context acknowledgment must be explicit.');
  for (const key of ['name', 'goal', 'targetUrl'] as const) if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 4000) fail(`${key} is required and must be bounded.`);
  try { if (!['http:', 'https:'].includes(new URL(input.targetUrl).protocol) || new URL(input.targetUrl).username || new URL(input.targetUrl).password) fail('Target URL must be HTTP(S) without credentials.'); }
  catch { fail('Target URL must be HTTP(S) without credentials.'); }
  if (!Number.isInteger(input.maxSteps) || input.maxSteps < 1 || input.maxSteps > 25) fail('maxSteps must be an integer from 1 to 25.');
  if (!Array.isArray(input.checks) || input.checks.length < 1 || input.checks.length > 20 || !input.checks.some(check => check?.required === true)) fail('At least one required check is necessary (maximum 20 checks).');
  const ids = new Set<string>();
  for (const check of input.checks) {
    if (!check || typeof check.id !== 'string' || !check.id || ids.has(check.id) || typeof check.criterionId !== 'string' || !check.criterionId || typeof check.description !== 'string' || !check.description || typeof check.required !== 'boolean') fail('Checks require unique IDs, criterion IDs, descriptions and required flags.');
    if(check.id.length>200||check.criterionId.length>200||check.description.length>4000)fail('Check identities and descriptions must be bounded.');
    ids.add(check.id);
    if (!['url','visible_text','element_visible','field_value','field_checked','field_enabled','field_valid','selected_values','download_sha256'].includes(check.kind)) fail('Unsupported check kind.');
    const selector='selector' in check?check.selector:undefined;
    if(!['url','visible_text','download_sha256'].includes(check.kind)&&(typeof selector!=='string'||!selector.trim()||selector.length>1000))fail('Check selector must be non-empty and bounded.');
    if(check.kind==='download_sha256'){if(!publicDownloadUrl(check.url)||typeof check.expected!=='string'||!/^[a-f0-9]{64}$/.test(check.expected))fail('Download check needs an HTTP(S) URL without private parameters and an expected SHA-256.');}
    else if(check.kind==='url'||check.kind==='visible_text'){
      if(typeof check.expected!=='string'||!check.expected.trim()||check.expected.length>1000)fail('Check expectation must be non-empty and bounded.');
    }else if(check.kind==='field_value'){
      if(typeof check.expected!=='string'||check.expected.length>1000)fail('Expected field value must be a bounded string, including an empty value.');
    }else if(['field_checked','field_enabled','field_valid'].includes(check.kind)){
      if(typeof (check as {expected:unknown}).expected!=='boolean')fail('Expected form state must be an explicit boolean.');
    }else if(check.kind==='selected_values'){
      if(!Array.isArray(check.expected)||check.expected.length>30||check.expected.some(value=>typeof value!=='string'||value.length>1000)||new Set(check.expected).size!==check.expected.length)fail('Selected values must be a bounded unique string list.');
    }
    if (check.kind === 'url') {
      try { if (new URL(check.expected).origin !== new URL(input.targetUrl).origin) fail('URL check must belong to the target origin.'); }
      catch { fail('URL check must belong to the target origin.'); }
    }
  }
  const context=validateIncomingContext(input.context,projectId);
  if(context){const criteria=new Set(context.requirements.flatMap(requirement=>requirement.criteria.map(criterion=>criterion.id)));
    if(input.checks.some(check=>!criteria.has(check.criterionId)))fail('Check references a criterion absent from the incoming snapshot.');
    if(contextNeedsAcknowledgment(context)&&input.contextAcknowledged!==true)fail('Acknowledge stale, conflicting, pending or incomplete mock context before use.');
  }
  const criterionExclusions=validateCriterionExclusions(input.criterionExclusions,context,input.checks);
  // Construct only the supported fields so arbitrary caller metadata is not persisted.
  return structuredClone({...(input.usability!==undefined?{usability:validateUsability(input.usability,input.checks)}:{}),mode:input.mode??'guided', name: input.name.trim(), goal: input.goal.trim(), targetUrl: input.targetUrl.trim(), maxSteps: input.maxSteps, checks: input.checks.map(check => ({id:check.id,criterionId:check.criterionId,description:check.description,required:check.required,kind:check.kind,...(!['url','visible_text'].includes(check.kind)&&'selector' in check?{selector:check.selector}:{}),...(check.kind==='download_sha256'?{url:check.url}:{}),...(check.kind!=='element_visible'&&'expected' in check?{expected:check.expected}:{})} as import('./types.js').CheckDefinition)), context,criterionExclusions, contextAcknowledged: input.contextAcknowledged === true });
}

export class DynamicService {
  private readonly leaseTokens = new Map<string, string>();
  constructor(readonly repository: DynamicRepository, readonly workerId = dynamicWorkerId) {}
  saveMission(projectId: string, actorId: string, input: unknown, missionId?: string) {
    return this.repository.saveRevision(projectId, actorId, validateMission(input, projectId), missionId);
  }
  async start(projectId: string, actorId: string, revisionId: string, idempotencyKey: string, environment?: EnvironmentSnapshot, baselineRunId?:string) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 128) throw new DynamicContractError(400, 'A bounded idempotencyKey is required.');
    const revision = await this.repository.getRevision(projectId, revisionId);
    if (!revision) throw new DynamicContractError(404, 'Mission revision not found.');
    if(baselineRunId!==undefined){if(typeof baselineRunId!=='string'||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(baselineRunId))throw new DynamicContractError(400,'Choose a valid regression baseline.');baselineRunId=baselineRunId.toLowerCase();const baseline=await this.repository.getRun(projectId,baselineRunId);if(!baseline)throw new DynamicContractError(404,'Regression baseline not found in this project.');if(baseline.state!=='completed'||baseline.revision.id!==revision.id||!baseline.checks.length||!baseline.evidence.length)throw new DynamicContractError(409,'Regression must use the baseline’s frozen revision and retained completed observations.');}
    return this.repository.createRun(projectId, actorId, revision, idempotencyKey.trim(), environment,baselineRunId);
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
  async finish(projectId: string, runId: string, results: CheckResult[], evidence: EvidenceReference[], usability?:UsabilityAssessment) {
    const run = await this.requireRun(projectId, runId);
    if (run.state !== 'running') throw new DynamicContractError(409, 'Only a running Run can be verified.');
    const evidenceIds = new Set(evidence.map(item => item.id));
    const checks = run.revision.checks;
    for (const result of results) {
      if (!checks.some(check => check.id === result.checkId && check.criterionId === result.criterionId) || !['passed', 'failed', 'uncertain', 'not_tested'].includes(result.verdict)) throw new DynamicContractError(400, 'Unknown check result.');
      if (result.evidenceIds.some(id => !evidenceIds.has(id))) throw new DynamicContractError(400, 'Dangling evidence reference.');
    }
    if (evidence.some(item => !/^[a-f0-9]{64}$/.test(item.sha256)) || evidenceIds.size !== evidence.length) throw new DynamicContractError(400, 'Evidence requires unique IDs and SHA-256 hashes.');
    const assessment=usability===undefined?undefined:validateUsabilityResult(usability,run.revision,evidence);
    if(run.revision.usability&&!assessment)throw new DynamicContractError(400,'Selected usability rules require retained results before completion.');
    const verified = results.map(result => result.verdict === 'passed' || result.verdict === 'failed'
      ? result.evidenceIds.length ? result : { ...result, verdict: 'uncertain' as const, reason: 'No retained evidence supports this observation.' }
      : result);
    const verdict = aggregateChecks(checks, verified);
    const updated = await this.repository.compareAndSetRun(projectId, runId, 'running', this.patch(run, { state: 'completed', verdict, checks: verified, evidence, reason: null,...(assessment?{usability:assessment}:{}),...(run.exploration?{exploration:resolveExplorationObjectives(run.exploration,checks,verified)}:{}) }));
    if (!updated) throw new DynamicContractError(409, 'Run was stopped while verification completed.');
    return updated;
  }
  async stop(projectId: string, runId: string, state: 'blocked' | 'cancelled' | 'interrupted', reason: string) {
    const run = await this.requireRun(projectId, runId);
    if (!['queued', 'running'].includes(run.state)) return run;
    const result = await this.repository.compareAndSetRun(projectId, runId, run.state, this.patch(run, { state, verdict: 'not_tested', reason }));
    return result ?? this.requireRun(projectId, runId);
  }
  async checkpointExploration(projectId:string,runId:string,snapshot:ExplorationSnapshot){const token=this.leaseTokens.get(runId);if(!token||!this.repository.checkpointExploration||!await this.repository.checkpointExploration(projectId,runId,this.workerId,token,snapshot))throw new DynamicContractError(409,'Exploration checkpoint unavailable or worker fenced; no further browser action is allowed.');}
  async requireRun(projectId: string, runId: string) {
    const run = await this.repository.getRun(projectId, runId);
    if (!run) throw new DynamicContractError(404, 'Run not found.');
    return run;
  }
  private patch(run: DynamicRun, changes: Partial<RunPatch>): RunPatch {
    return { state: run.state, verdict: run.verdict, reason: run.reason, checks: run.checks, evidence: run.evidence, legacySessionId: run.legacySessionId, ...(this.leaseTokens.has(run.id) ? { leaseToken: this.leaseTokens.get(run.id) } : {}), updatedAt: new Date().toISOString(), ...changes };
  }
}
