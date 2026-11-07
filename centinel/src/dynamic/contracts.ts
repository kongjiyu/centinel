/**
 * Frontend-owned copies of the sidecar's public Dynamic DTOs. They mirror the declarations in
 * `sidecar/src/dynamic/**` exactly, so the desktop no longer imports sidecar source files.
 * `contracts/sidecarParity.test.ts` fails the type check if a copy drifts from the sidecar.
 */
import type { UsabilityAssessment, UsabilityConfig } from './usability';

// sidecar/src/dynamic/budgetLimits.ts
export type ExecutionBudget = {
  runtimeMs: number;
  maxSteps: number;
  maxModelCalls: number;
  maxObservationChars: number;
  maxConsoleBytes: number;
  maxAccountedTokens?: number;
};

// sidecar/src/dynamic/browser/fileTypes.ts
export type UploadFixture = { id: string; sha256: string; bytes: number; mimeType: string };
export type UploadGrant = UploadFixture & { selector: string };
export type DownloadGrant = { selector: string; url: string; maxBytes: number; mimeType: string; publicTestData: true };

// sidecar/src/dynamic/browser/privateInputs.ts
export type PrivateInputGrant = { selector: string; variable: string; origin: string };

// sidecar/src/dynamic/browser/actionPolicy.ts
export type InteractionAction = 'click' | 'type' | 'select_option' | 'set_checked';
export type BrowserActionPolicy = {
  schemaVersion: 1;
  interactions: Array<{ selector: string; actions: InteractionAction[]; repeatable?: boolean }>;
  allowCoordinates: boolean;
  uploads?: UploadGrant[];
  downloads?: DownloadGrant[];
  privateInputs?: PrivateInputGrant[];
};

// sidecar/src/dynamic/testing/staticContextStub.ts
export interface StaticContextFixture {
  schemaVersion: 1;
  /** mock-static: synthetic development input; review-snapshot: exported from a frozen Static Review. */
  provenance: 'mock-static' | 'review-snapshot';
  projectId: string;
  reviewId: string;
  snapshotId: string;
  approvalState: 'approved' | 'pending';
  sources: Array<{
    id: string;
    version: string;
    currency: 'current' | 'stale' | 'unknown';
    uri: string;
  }>;
  /** A Review snapshot may not know its repository or commit; unknown stays null. */
  target: { repository: string | null; commit: string | null; deploymentVersion: null };
  requirements: Array<{
    id: string;
    revision: number;
    description: string;
    sourceId: string;
    criteria: Array<{ id: string; description: string }>;
  }>;
  risks: Array<{ id: string; requirementId: string; priority: 'high' | 'medium'; rationale: string }>;
  conflicts: Array<{ requirementId: string; description: string }>;
  limitations: string[];
}

// sidecar/src/dynamic/environment/types.ts
export type EnvironmentInput = {
  budgets?: ExecutionBudget;
  actionPolicy?: BrowserActionPolicy;
  dataResourceKey?: string;
  sessionReference?: string;
  sessionReadySelector?: string;
  name: string;
  targetUrl: string;
  allowedOrigins: string[];
  viewport: { width: number; height: number };
  accountRole: string;
  requiredVariables: string[];
  startupInstructions: string;
  targetVersion: string;
};
export type EnvironmentProfile = EnvironmentInput & {
  id: string;
  projectId: string;
  version: number;
  updatedBy: string;
  updatedAt: string;
};
export type PreflightCheck = { name: string; ready: boolean; reason: string };
export type EnvironmentSnapshot = EnvironmentProfile & {
  variableNames: string[];
  preflight: PreflightCheck[];
  checkedAt: string;
  resourceKey?: string;
  sessionSnapshot?: { reference: string; version: string; expiresAt: string };
  preparation?: EnvironmentData['preparation'];
};
export type DataEvent = {
  id: string;
  runId: string | null;
  kind: 'preparation' | 'cleanup';
  outcome: 'completed' | 'failed';
  note: string;
  actorId: string;
  createdAt: string;
};
export type DataResourceState = {
  key: string;
  reserved: boolean;
  available: boolean;
  ownerProfileId: string | null;
  ownerName: string | null;
  ownerState: string | null;
};
export type EnvironmentData = {
  unitRunId?: string | null;
  resource?: DataResourceState;
  profileId: string;
  state: 'unprepared' | 'ready' | 'in_use' | 'cleanup_required' | 'preparing' | 'cleaning';
  operationId?: string | null;
  preparedVersion: number | null;
  preparation: { note: string; actorId: string; at: string; profileVersion: number } | null;
  runId: string | null;
  events: DataEvent[];
};

// sidecar/src/dynamic/types.ts
export type CheckDefinition = {
  id: string;
  criterionId: string;
  description: string;
  required: boolean;
} & (
  | { kind: 'url'; expected: string }
  | { kind: 'visible_text'; expected: string }
  | { kind: 'element_visible'; selector: string }
  | { kind: 'field_value'; selector: string; expected: string }
  | { kind: 'field_checked' | 'field_enabled' | 'field_valid'; selector: string; expected: boolean }
  | { kind: 'selected_values'; selector: string; expected: string[] }
  | { kind: 'download_sha256'; url: string; expected: string }
);
export type CheckVerdict = 'passed' | 'failed' | 'uncertain' | 'not_tested';
export type RunState = 'queued' | 'running' | 'completed' | 'blocked' | 'cancelled' | 'interrupted';
export type EvidenceReference = {
  id: string;
  kind: 'screenshot' | 'checks' | 'file_manifest' | 'usability';
  sha256: string;
  availability: 'local';
  capturedAt: string;
};
export type CheckResult = {
  checkId: string;
  criterionId: string;
  verdict: CheckVerdict;
  observed: string | null;
  reason: string;
  evidenceIds: string[];
  checkedAt: string;
};
export type CriterionExclusion = { criterionId: string; reason: string };
export type MissionInput = {
  usability?: UsabilityConfig;
  mode?: 'guided' | 'exploratory';
  criterionExclusions?: CriterionExclusion[];
  name: string;
  goal: string;
  targetUrl: string;
  maxSteps: number;
  checks: CheckDefinition[];
  context: StaticContextFixture | null;
  contextAcknowledged: boolean;
};
export type MissionRevision = MissionInput & {
  id: string;
  missionId: string;
  projectId: string;
  revision: number;
  createdBy: string;
  createdAt: string;
};
export type Mission = { id: string; projectId: string; currentRevisionId: string; createdBy: string; createdAt: string };

// sidecar/src/dynamic/browser/exploration.ts
export type ExplorationSnapshot = {
  schemaVersion: 1;
  mode: 'exploratory';
  objectives: Array<{ criterionId: string; checkIds: string[]; verdict: CheckVerdict }>;
  states: Array<{
    id: string;
    url: string;
    title: string;
    visits: number;
    omittedControls: boolean;
    controls: Array<{ ref: string; role: string; name: string; selector?: string }>;
  }>;
  actions: Array<{
    step: number;
    action: string;
    beforeStateId: string;
    afterStateId?: string;
    targetRef?: string;
    status: 'dispatched' | 'skipped' | 'blocked' | 'unavailable' | 'uncertain';
  }>;
  unvisitedControls: Array<{ stateId: string; ref: string }>;
  unresolvedControls: Array<{ stateId: string; ref: string }>;
  unresolvedTargetActions: number;
  limits: { maxStates: 51; maxActions: 25 };
  truncated: boolean;
  exhaustive: false;
  limitations: string[];
};

// sidecar/src/dynamic/regression.ts
export type RegressionBaseline = {
  schemaVersion: 1;
  runId: string;
  revisionId: string;
  createdAt: string;
  createdBy: string;
  verdict: CheckVerdict;
  executionVersions?: DynamicRun['executionVersions'];
  actionPolicy?: DynamicRun['actionPolicy'];
  executionBudget?: DynamicRun['executionBudget'];
  targetUrl: string;
  environment: EnvironmentSnapshot | null;
  checks: CheckResult[];
  evidence: EvidenceReference[];
};

// sidecar/src/dynamic/types.ts
export type DynamicRun = {
  id: string;
  projectId: string;
  missionId: string;
  revision: MissionRevision;
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  environment?: EnvironmentSnapshot;
  executionBudget?: ExecutionBudget;
  actionPolicy?: BrowserActionPolicy;
  executionVersions?: {
    usability?: 1 | 2;
    privateInputs?: 1;
    visual?: 1;
    files?: 1 | 2;
    explorer?: 1;
    observer: 1 | 2;
    planner: 1 | 2;
    policy: 1 | 2;
    executor: 1 | 2;
    checker: 1 | 2 | 3;
  };
  lease?: { workerId: string; heartbeatAt: string; expiresAt: string } | null;
  regression?: RegressionBaseline;
  exploration?: ExplorationSnapshot;
  usability?: UsabilityAssessment;
  state: RunState;
  verdict: CheckVerdict;
  reason: string | null;
  checks: CheckResult[];
  evidence: EvidenceReference[];
  legacySessionId: string | null;
};

// sidecar/src/dynamic/workspace/registry.ts
export type WorkspaceAuthorization = {
  directory: string;
  packageManager: 'pnpm' | 'yarn';
  runtimeBinDirectory: string;
  scripts: { setup?: string; cleanup?: string; unit?: string };
  fingerprint: string;
  authorizedAt: string;
  automaticCleanup?: boolean;
};
export type WorkspaceInspection = {
  directory: string;
  scriptNames: string[];
  scriptDefinitions: Record<string, string>;
  requiredVariables: string[];
  packageManagerHint: string | null;
  nodeVersionHint: string | null;
  fingerprint: string;
  gitCommit: string | null;
};

// sidecar/src/dynamic/workspace/process.ts
export type ProcessResult = {
  outcome: 'passed' | 'failed' | 'cancelled' | 'timeout' | 'output_limit' | 'runner_error';
  exitCode: number | null;
  signal: string | null;
  output: string;
  truncated: boolean;
  durationMs: number;
};

// sidecar/src/dynamic/workspace/operations.ts
export type HookKind = 'setup' | 'cleanup';
export type HookOperation = {
  id: string;
  projectId: string;
  environmentId: string;
  kind: HookKind;
  state: RunState;
  verdict: CheckVerdict;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  idempotencyKey: string;
  environment: EnvironmentProfile;
  command: { program: string; script: string; fingerprint: string; authorizationId: string; gitCommit: string | null };
  result: ProcessResult | null;
  reason: string | null;
  cancelRequested?: boolean;
  lease?: { workerId: string; heartbeatAt: string; expiresAt: string };
};

// sidecar/src/dynamic/environment/sessionBroker.ts
export type SessionCaptureStatus = {
  captureId: string;
  state: 'opening' | 'open' | 'closed';
  reference: string;
  reason?: string;
};
