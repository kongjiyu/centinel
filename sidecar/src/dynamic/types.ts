import type {UsabilityConfig,UsabilityAssessment} from './usability/types.js';
import type {RegressionBaseline} from './regression.js';
import type {ExplorationSnapshot} from './browser/exploration.js';
import type {BrowserActionPolicy} from './browser/actionPolicy.js';
import type { EnvironmentSnapshot } from './environment/types.js';
import type { StaticContextFixture } from './testing/staticContextStub.js';
import type { ExecutionBudget } from './budgetLimits.js';

export type CheckDefinition = {
  id: string;
  criterionId: string;
  description: string;
  required: boolean;
} & ({ kind: 'url'; expected: string } | { kind: 'visible_text'; expected: string } | { kind: 'element_visible'; selector: string }
 | {kind:'field_value';selector:string;expected:string}
 | {kind:'field_checked'|'field_enabled'|'field_valid';selector:string;expected:boolean}
 | {kind:'selected_values';selector:string;expected:string[]}|{kind:'download_sha256';url:string;expected:string});
export type CheckVerdict = 'passed' | 'failed' | 'uncertain' | 'not_tested';
export type RunState = 'queued' | 'running' | 'completed' | 'blocked' | 'cancelled' | 'interrupted';
export type EvidenceReference = { id: string; kind: 'screenshot' | 'checks' | 'file_manifest' | 'usability'; sha256: string; availability: 'local'; capturedAt: string };
export type CheckResult = { checkId: string; criterionId: string; verdict: CheckVerdict; observed: string | null; reason: string; evidenceIds: string[]; checkedAt: string };
export type CriterionExclusion = {criterionId:string;reason:string};
export type MissionInput = {usability?:UsabilityConfig;mode?:'guided'|'exploratory'; criterionExclusions?:CriterionExclusion[]; name: string; goal: string; targetUrl: string; maxSteps: number; checks: CheckDefinition[]; context: StaticContextFixture | null; contextAcknowledged: boolean };
export type MissionRevision = MissionInput & { id: string; missionId: string; projectId: string; revision: number; createdBy: string; createdAt: string };
export type Mission = { id: string; projectId: string; currentRevisionId: string; createdBy: string; createdAt: string };
export type DynamicRun = {
  id: string; projectId: string; missionId: string; revision: MissionRevision;
  idempotencyKey: string; createdBy: string; createdAt: string; updatedAt: string;
  environment?: EnvironmentSnapshot;
  executionBudget?: ExecutionBudget;actionPolicy?:BrowserActionPolicy;executionVersions?:{usability?:1|2;privateInputs?:1;visual?:1;files?:1|2;explorer?:1;observer:1|2;planner:1|2;policy:1|2;executor:1|2;checker:1|2|3};
  lease?: { workerId: string; heartbeatAt: string; expiresAt: string } | null;
  regression?:RegressionBaseline;
  exploration?:ExplorationSnapshot;
  usability?:UsabilityAssessment;
  state: RunState; verdict: CheckVerdict; reason: string | null;
  checks: CheckResult[]; evidence: EvidenceReference[]; legacySessionId: string | null;
};
export type RunPatch = Pick<DynamicRun, 'state' | 'verdict' | 'reason' | 'checks' | 'evidence' | 'updatedAt' | 'legacySessionId'> & { leaseToken?: string;exploration?:ExplorationSnapshot;usability?:UsabilityAssessment };
export interface DynamicRepository {
  saveRevision(projectId: string, actorId: string, input: MissionInput, missionId?: string): Promise<MissionRevision>;
  listMissions(projectId: string): Promise<Mission[]>;
  getRevision(projectId: string, revisionId: string): Promise<MissionRevision | null>;
  getRun(projectId: string, runId: string): Promise<DynamicRun | null>;
  listRuns(projectId: string, missionId?: string): Promise<DynamicRun[]>;
  getRunByKey(projectId: string, key: string): Promise<DynamicRun | null>;
  createRun(projectId: string, actorId: string, revision: MissionRevision, key: string, environment?: EnvironmentSnapshot, baselineRunId?:string): Promise<{ run: DynamicRun; reused: boolean }>;
  claimRun(projectId: string, runId: string, workerId: string, leaseToken: string, sessionId: string | null): Promise<DynamicRun | null>;
  heartbeatRun(projectId: string, runId: string, workerId: string, leaseToken: string): Promise<boolean>;
  recoverRuns(projectId: string): Promise<DynamicRun[]>;
  checkpointExploration?(projectId:string,runId:string,workerId:string,token:string,snapshot:ExplorationSnapshot):Promise<boolean>;
  compareAndSetRun(projectId: string, runId: string, expected: RunState, patch: RunPatch): Promise<DynamicRun | null>;
}
export class DynamicContractError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 503, message: string) { super(message); }
}
