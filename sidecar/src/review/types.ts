import type { Artifact } from '../artifacts.js';
import type { TokenUsage } from '../aiClient.js';
import type { AiApiFormat, AiProvider } from '../settings.js';
import type { EvidenceSufficiencyAssessment, EvidenceContradictionDisposition } from './evidenceSufficiency.js';
import type { FindingCorrelationSnapshot } from './correlation.js';

/** Lifecycle states owned by the review orchestrator.
 *
 * `pending_approval` is deliberately distinct from `approved`: analysis is
 * complete, but no human decision has been recorded yet. `completed` is kept
 * as a compatibility alias for repositories that use that vocabulary.
 */
export type StaticReviewStatus =
  | 'queued'
  | 'prepared'
  | 'running'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'pending_approval'
  | 'completed'
  | 'approved'
  | 'changes_requested';

export type StaticReviewType =
  | 'requirement_review'
  | 'code_review'
  | 'requirement_to_code_traceability'
  | 'cross_artifact_consistency'
  | (string & {});

export type ReviewSourceManifestMode = 'capture' | 'reuse';

export type StaticReviewScope = {
  artifactIds?: string[];
  requirementIds?: string[];
  standardIds?: string[];
  sourceIds?: string[];
  /** Optional human-readable scope label preserved in the immutable review. */
  label?: string;
};

export type ReviewProgressState = {
  stage: string;
  completedStages: string[];
  message?: string;
  updatedAt: string;
};

export type ReviewLineage = {
  parentReviewId: string | null;
  lineageRootId: string;
  /** True when the child intentionally reused its parent's source manifest. */
  reusedSourceManifest: boolean;
};

export type ReviewIterationSourceChoice = 'reuse' | 'refresh';

/** Immutable request context attached to a prepared child Review. */
export type StaticReviewIteration = {
  parentReviewId: string;
  decisionId: string;
  feedback: string;
  reviewer: string;
  createdBy: string;
  sourceChoice: ReviewIterationSourceChoice;
  sourceManifestId: string | null;
  preparedAt: string;
};

export type StaticReviewRecord = {
  id: string;
  projectId: string;
  name: string;
  reviewType: StaticReviewType;
  status: StaticReviewStatus;
  idempotencyKey: string;
  scope: StaticReviewScope;
  config: Record<string, unknown>;
  lineage: ReviewLineage;
  iteration?: StaticReviewIteration | null;
  sourceManifestId: string | null;
  deterministicFindingCount: number;
  modelFindingCount: number;
  modelStatus: 'not_requested' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
  summary: string;
  failureReason: string;
  progress: ReviewProgressState | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type NewStaticReview = Omit<StaticReviewRecord,
  'id' | 'sourceManifestId' | 'deterministicFindingCount' | 'modelFindingCount' |
  'modelStatus' | 'summary' | 'failureReason' | 'progress' | 'revision' |
  'createdAt' | 'updatedAt'
> & {
  id?: string;
  sourceManifestId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type StaticReviewPatch = Partial<Pick<StaticReviewRecord,
  'status' | 'sourceManifestId' | 'deterministicFindingCount' | 'modelFindingCount' |
  'modelStatus' | 'summary' | 'failureReason' | 'progress' | 'scope'
>> & { updatedAt?: string };

export type ReviewOperationKind =
  | 'start'
  | 'cancel'
  | 'retry'
  | 'prepare_iteration'
  | 'start_iteration'
  /** Atomic human decision command. */
  | 'record_decision'
  /** Atomic Request Changes + prepared-child command. */
  | 'request_changes';

export type ReviewOperationRecord = {
  operation: ReviewOperationKind;
  idempotencyKey: string;
  projectId?: string;
  reviewId: string;
  createdAt: string;
};

export type StaticFindingInput = {
  source: 'deterministic' | 'model';
  title: string;
  description: string;
  severity: string;
  priority?: string | null;
  category: string;
  filePath: string;
  lineNumber: number | null;
  artifactId?: string | null;
  evidence: string;
  recommendation: string;
  confidence: string;
  fingerprint?: string;
  riskLevel?: string | null;
  ruleId?: string | null;
  requirementId?: string | null;
  standardId?: string | null;
  standardRuleId?: string | null;
  sourceIdentity?: string | null;
  sourceVersion?: string | null;
  sourceLocator?: Record<string, unknown> | null;
  stableFindingId?: string | null;
};

export type PersistedReviewFinding = StaticFindingInput & {
  id: string;
  reviewId: string;
  projectId: string;
  createdAt: string;
};

export type ModelProviderSettings = {
  provider: AiProvider;
  apiFormat: AiApiFormat;
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type StaticModelRequest = {
  reviewId: string;
  projectId: string;
  stage: string;
  systemPrompt: string;
  prompt: string;
  repair?: boolean;
  signal?: AbortSignal;
};

export type StaticModelResult = {
  /** Structured result returned by the provider after JSON validation. */
  result: unknown;
  usage?: TokenUsage;
  settings: Pick<ModelProviderSettings, 'provider' | 'apiFormat' | 'model'>;
  raw?: unknown;
};

export interface StaticAnalysisModelProvider {
  analyze(request: StaticModelRequest): Promise<StaticModelResult>;
}

export type ModelAttemptOutcome =
  | 'success'
  | 'retryable_error'
  | 'permanent_error'
  | 'malformed_response'
  | 'cancelled';

export type ModelAttemptRecord = {
  id?: string;
  reviewId: string;
  projectId: string;
  stage: string;
  attempt: number;
  provider: AiProvider | string;
  apiFormat: AiApiFormat | string;
  model: string;
  outcome: ModelAttemptOutcome;
  durationMs: number;
  statusCode?: number;
  retryAfterMs?: number;
  errorCode?: string;
  errorMessage?: string;
  usage?: TokenUsage;
  createdAt: string;
};

export type ReviewAuditEvent = {
  id?: string;
  reviewId: string;
  projectId: string;
  event: string;
  stage?: string;
  detail?: Record<string, unknown>;
  createdAt: string;
};

export type StaticReviewDecision = {
  id: string;
  reviewId: string;
  projectId: string;
  decision: 'approved' | 'changes_requested' | 'commented';
  comment: string;
  reviewer: string;
  createdAt: string;
};

export type StaticReviewRepository = {
  /** Core lifecycle methods. `transitionReview` must be compare-and-set. */
  createReview(input: NewStaticReview): Promise<StaticReviewRecord>;
  getReview(reviewId: string): Promise<StaticReviewRecord | null>;
  transitionReview(
    reviewId: string,
    expectedStatuses: StaticReviewStatus[],
    patch: StaticReviewPatch,
  ): Promise<StaticReviewRecord | null>;

  /** Durable idempotency and immutable retry lineage. */
  findOperation(operation: ReviewOperationKind, idempotencyKey: string, projectId?: string): Promise<ReviewOperationRecord | null>;
  saveOperation(record: ReviewOperationRecord): Promise<void>;
  findReviewByIdempotencyKey(projectId: string, idempotencyKey: string): Promise<StaticReviewRecord | null>;
  createRetryReview(input: NewStaticReview): Promise<StaticReviewRecord>;

  /** Immutable source/evidence persistence is required; execution must never
   * fall back to the old local Review database. */
  saveSourceManifest(reviewId: string, projectId: string, artifacts: Artifact[], mode: ReviewSourceManifestMode): Promise<{ id: string }>;
  loadSourceManifestArtifacts(sourceManifestId: string): Promise<Artifact[] | null>;
  saveTraceabilitySnapshot(reviewId: string, projectId: string): Promise<void>;
  getLatestDecision?(reviewId: string): Promise<StaticReviewDecision | null>;
  getTraceabilityReadiness?(projectId: string, requirementIds?: string[], signal?: AbortSignal): Promise<Array<{ requirementId: string; state: 'complete' | 'incomplete' | 'missing' }>>;
  saveReviewIteration?(childReviewId: string, projectId: string, iteration: StaticReviewIteration): Promise<void>;
  saveEvidenceSufficiency(assessment: EvidenceSufficiencyAssessment): Promise<void>;
  getEvidenceSufficiency(reviewId: string): Promise<EvidenceSufficiencyAssessment | null>;
  listContradictionDispositions?(projectId: string, signal?: AbortSignal): Promise<EvidenceContradictionDisposition[]>;
  saveFindingCorrelations(snapshot: FindingCorrelationSnapshot): Promise<void>;
  getFindingCorrelationSnapshot?(childReviewId: string): Promise<FindingCorrelationSnapshot | null>;
  listReviewFindings(reviewId: string): Promise<PersistedReviewFinding[]>;

  /** Finding, progress, usage, and audit persistence must fail closed. */
  saveFinding(finding: PersistedReviewFinding): Promise<void>;
  updateProgress(reviewId: string, progress: ReviewProgressState): Promise<void>;
  recordModelAttempt(attempt: ModelAttemptRecord): Promise<void>;
  /** Highest persisted attempt for a Review stage, used to resume the shared
   * provider-call budget after process recovery. */
  getModelAttemptCount(reviewId: string, stage: string): Promise<number>;
  recordAudit(event: ReviewAuditEvent): Promise<void>;
};

export type StaticReviewStartInput = {
  projectId: string;
  name?: string;
  reviewType: StaticReviewType;
  scope?: StaticReviewScope;
  idempotencyKey?: string;
  /** Validate a new Review's selected source IDs after idempotency lookup and before persistence. */
  validateScopeBeforeCreate?: () => Promise<void>;
  /** Tests and route adapters can provide the already-frozen artifact list. */
  artifacts?: Artifact[];
  sourceManifestMode?: ReviewSourceManifestMode;
  config?: Record<string, unknown>;
  remarks?: string;
};

export type StaticReviewRetryInput = {
  reviewId: string;
  idempotencyKey?: string;
  refreshSourceManifest?: boolean;
  artifacts?: Artifact[];
};

export type StaticReviewCancelInput = {
  reviewId: string;
  idempotencyKey?: string;
  reason?: string;
};

export type StaticReviewStartResult = {
  review: StaticReviewRecord;
  /** Resolves when background execution reaches a terminal state. */
  completion: Promise<StaticReviewRecord>;
  /** True when the request returned a previously-created idempotent Review. */
  reused: boolean;
};

export interface StaticReviewOrchestrator {
  start(input: StaticReviewStartInput): Promise<StaticReviewStartResult>;
  cancel(input: StaticReviewCancelInput): Promise<StaticReviewRecord>;
  retry(input: StaticReviewRetryInput): Promise<StaticReviewStartResult>;
  resumeQueuedReview(reviewId: string): Promise<StaticReviewStartResult>;
  prepareReviewIteration(input: import('./iteration.js').PrepareReviewIterationInput): Promise<StaticReviewRecord>;
  startPreparedIteration(input: import('./iteration.js').StartPreparedIterationInput): Promise<StaticReviewStartResult>;
}
