/**
 * Frontend-owned copies of the sidecar's public Dynamic DTOs. They mirror the declarations in
 * the sidecar's `dynamic` folder exactly, so the desktop no longer imports sidecar source files.
 * `contracts/sidecarParity.test.ts` fails the type check if a copy drifts from the sidecar.
 */
import type { UsabilityAssessment, UsabilityConfig, UsabilityObservation, UsabilitySuggestion } from './usability';

// sidecar dynamic/budgetLimits.ts
export type ExecutionBudget = {
  runtimeMs: number;
  maxSteps: number;
  maxModelCalls: number;
  maxObservationChars: number;
  maxConsoleBytes: number;
  maxAccountedTokens?: number;
};

// sidecar dynamic/browser/fileTypes.ts
export type UploadFixture = { id: string; sha256: string; bytes: number; mimeType: string };
export type UploadGrant = UploadFixture & { selector: string };
export type LocalUploadFixture = UploadFixture & {
  name: string;
  expiresAt: string;
  availability: 'available' | 'expired';
};
export type DownloadReceipt = {
  kind: 'download';
  id: string;
  permissionUrl: string;
  sha256: string;
  bytes: number;
  mimeType: string;
};
export type DownloadGrant = { selector: string; url: string; maxBytes: number; mimeType: string; publicTestData: true };

// sidecar dynamic/browser/privateInputs.ts
export type PrivateInputGrant = { selector: string; variable: string; origin: string };

// sidecar dynamic/browser/actionPolicy.ts
export type InteractionAction = 'click' | 'type' | 'select_option' | 'set_checked';
export type BrowserActionPolicy = {
  schemaVersion: 1;
  interactions: Array<{ selector: string; actions: InteractionAction[]; repeatable?: boolean }>;
  allowCoordinates: boolean;
  uploads?: UploadGrant[];
  downloads?: DownloadGrant[];
  privateInputs?: PrivateInputGrant[];
};

// sidecar dynamic/testing/staticContextStub.ts
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

// sidecar dynamic/environment/types.ts
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

// sidecar dynamic/types.ts
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
/**
 * Saved test (Mission). displayName overrides the current revision name without a new revision;
 * archivedAt marks an archived test that is hidden by default and cannot start new Runs.
 */
export type Mission = {
  id: string;
  projectId: string;
  currentRevisionId: string;
  createdBy: string;
  createdAt: string;
  displayName?: string;
  archivedAt?: string;
  archivedBy?: string;
  updatedAt?: string;
  updatedBy?: string;
};

// sidecar dynamic/browser/exploration.ts
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

// sidecar dynamic/regression.ts
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

// sidecar dynamic/types.ts
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

// sidecar dynamic/workspace/registry.ts
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

// sidecar dynamic/workspace/process.ts
export type ProcessResult = {
  outcome: 'passed' | 'failed' | 'cancelled' | 'timeout' | 'output_limit' | 'runner_error';
  exitCode: number | null;
  signal: string | null;
  output: string;
  truncated: boolean;
  durationMs: number;
};

// sidecar dynamic/workspace/operations.ts
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

// sidecar dynamic/environment/sessionBroker.ts
export type SessionCaptureStatus = {
  captureId: string;
  state: 'opening' | 'open' | 'closed';
  reference: string;
  reason?: string;
};

// sidecar environment/downloadVault.ts
export type LocalDownload = DownloadReceipt & { expiresAt: string; availability: 'available' | 'expired' };

// sidecar environment/controlDiscovery.ts
export type DiscoveredControl = {
  selector: string;
  label: string;
  actions: InteractionAction[];
  kind: string;
  page?: string;
};
export type DiscoveryPage = { url: string; finalUrl: string; controls: number; redirected: boolean };
export type DiscoveryResult = { controls: DiscoveredControl[]; pages: DiscoveryPage[] };

// sidecar riskPolicy.ts
export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low';
export type RiskPriority = 'high' | 'medium' | 'low';

// sidecar findings/types.ts
export type VerificationDecision = 'confirmed' | 'rejected' | 'needs_investigation';
export type DynamicFinding = {
  id: string;
  projectId: string;
  missionId: string;
  key: string;
  version: number;
  source: 'dynamic_checker' | 'dynamic_usability';
  title: string;
  category: 'functional' | 'usability';
  verification: 'unreviewed' | VerificationDecision;
  remediation: 'open' | 'in_progress' | 'resolved';
  severity: RiskSeverity | 'info' | null;
  priority: RiskPriority | null;
  confidence: 'low' | 'medium' | 'high' | null;
  confidenceBasis: string;
  observationCount: number;
  createdAt: string;
  updatedAt: string;
};
export type FindingObservation = {
  id: string;
  findingId: string;
  projectId: string;
  runId: string;
  revisionId: string;
  executorId: string;
  checkId: string;
  criterionId: string;
  definition: CheckDefinition;
  result: CheckResult;
  evidence: EvidenceReference[];
  targetUrl: string;
  targetVersion: string | null;
  goal: string;
  usability?: UsabilityObservation & {
    observationIndex: number;
    correlation: 'stable_control' | 'explicit_check' | 'run_only';
  };
  suggestions?: UsabilitySuggestion[];
  createdAt: string;
};
export type FindingEvent = {
  id: string;
  findingId: string;
  projectId: string;
  actorId: string;
  version: number;
  kind: 'verification' | 'remediation' | 'recurrence';
  automatic?: boolean;
  decision?: VerificationDecision;
  remediation?: DynamicFinding['remediation'];
  regressionRunId?: string | null;
  note: string;
  severity?: DynamicFinding['severity'];
  priority?: DynamicFinding['priority'];
  confidence?: DynamicFinding['confidence'];
  conditionChanges?: string[];
  createdAt: string;
};
export type FindingDetail = {
  finding: DynamicFinding;
  observations: FindingObservation[];
  events: FindingEvent[];
};
export type ReviewFindingInput = {
  version: number;
  decision: VerificationDecision;
  note: string;
  severity?: DynamicFinding['severity'];
  priority?: DynamicFinding['priority'];
  confidence?: DynamicFinding['confidence'];
};
export type RemediationInput = {
  version: number;
  status: DynamicFinding['remediation'];
  note: string;
  regressionRunId?: string;
};

// sidecar sharedEvidence/artifacts.ts
export type ArtifactKind =
  | 'partial_trace'
  | 'partial_network'
  | 'partial_console'
  | 'partial_budget'
  | 'partial_observation'
  | 'partial_manifest'
  | 'partial_usability'
  | 'download';
export type RunArtifact = {
  id: string;
  projectId: string;
  runId: string;
  slot: string;
  kind: ArtifactKind;
  sha256: string;
  sourceSha256: string;
  bytes: number;
  mimeType: string;
  sourceManifestId: string | null;
  permissionUrl: string | null;
  capturedAt: string;
  registeredBy: string;
  createdAt: string;
  privacyVersion: 1;
  criterionProof: false;
};

// sidecar sharedEvidence/types.ts
export type EvidenceCopy = {
  id: string;
  projectId: string;
  runId: string;
  evidenceId: string;
  kind: 'screenshot' | 'checks' | 'file_manifest' | 'usability' | ArtifactKind;
  sha256: string;
  bytes: number;
  mimeType: string;
  criterionProof?: false;
  sourceSha256?: string;
  privacyVersion?: 1;
  availability: 'pending' | 'available' | 'failed' | 'expired' | 'deleting' | 'deleted';
  expiresAt: string;
  executorId: string;
  syncedBy: string | null;
  deletedBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

// sidecar reports/types.ts
export type DynamicReportSnapshot = {
  metadata: {
    schemaVersion: 'centinel-dynamic-report-v1';
    generatorVersion: 'dynamic-report-1';
    reportId: string;
    projectId: string;
    runId: string;
    actorId: string;
    generatedAt: string;
  };
  run: Omit<DynamicRun, 'lease' | 'idempotencyKey' | 'legacySessionId' | 'actionPolicy'>;
  findings: FindingDetail[];
  evidenceCopies: EvidenceCopy[];
  artifacts: RunArtifact[];
  dataEvents: DataEvent[];
  modelUsage: {
    status: 'available' | 'unavailable';
    calls: Array<{
      id: string;
      stage: string;
      provider: string;
      model: string;
      outcome: string;
      input: number | null;
      output: number | null;
      cacheRead: number | null;
      cacheCreation: number | null;
      durationMs: number | null;
      createdAt: string;
    }>;
  };
  limitations: string[];
};
export type DynamicReportSummary = DynamicReportSnapshot['metadata'];

// sidecar unit/types.ts
export type UnitOutcome =
  | 'passed'
  | 'failed'
  | 'not_tested'
  | 'no_tests'
  | 'configuration_error'
  | 'missing_dependencies'
  | 'parser_error'
  | 'cancelled'
  | 'timeout'
  | 'output_limit'
  | 'runner_error';
export type UnitCounts = {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  todo: number;
  totalSuites: number;
  failedSuites: number;
};
export type UnitTestCase = {
  file: string;
  name: string;
  status: 'passed' | 'failed' | 'pending' | 'skipped' | 'todo';
  durationMs: number | null;
  failureMessages: string[];
};
export type UnitAssessment = {
  counts: UnitCounts;
  tests: UnitTestCase[];
  suiteErrors: Array<{ file: string; message: string }>;
  success: boolean;
  detailsTruncated: boolean;
};
export type UnitExecutionResult = {
  schemaVersion: 1;
  framework: { name: 'vitest'; version: string | null; nodeVersion?: string };
  command: { program: 'node'; script: string | null; args: string[] };
  workspace: {
    fingerprint: string | null;
    gitCommit: string | null;
    authorizationId: string | null;
    cliSha256?: string;
  };
  outcome: UnitOutcome;
  process: ProcessResult | null;
  assessment: UnitAssessment | null;
  reason: string;
  startedAt: string;
  finishedAt: string;
  limitations: string[];
};
export type UnitCommand = {
  program: 'node';
  script: string | null;
  fingerprint: string | null;
  authorizationId: string | null;
  gitCommit: string | null;
  frameworkVersion: string | null;
  cliSha256: string | null;
  nodeVersion: string | null;
};
export type DynamicUnitRun = {
  id: string;
  projectId: string;
  environmentId: string;
  kind: 'unit';
  state: RunState;
  verdict: CheckVerdict;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  idempotencyKey: string;
  command: UnitCommand;
  timeoutMs: number;
  environment: EnvironmentProfile & { preparation: EnvironmentData['preparation']; resourceKey: string };
  result: UnitExecutionResult | null;
  reason: string | null;
  cancelRequested?: boolean;
  lease?: { workerId: string; heartbeatAt: string; expiresAt: string };
};

// sidecar unit/reports.ts
export type UnitReportSnapshot = {
  metadata: {
    schemaVersion: 'centinel-unit-report-v1';
    generatorVersion: 'unit-report-1';
    reportId: string;
    projectId: string;
    runId: string;
    actorId: string;
    generatedAt: string;
  };
  run: Omit<DynamicUnitRun, 'lease' | 'idempotencyKey'>;
  cleanupEvents: Array<{ kind: string; outcome: string; note: string; actorId: string; createdAt: string }>;
  limitations: string[];
};
