import crypto from 'node:crypto';
import type { Artifact } from '../artifacts.js';
import type { RetrievedContext } from './contextTypes.js';
import type { Finding as DeterministicFinding } from '../staticEngine.js';
import type { ConfiguredTextModelProvider } from './modelProvider.js';
import { ModelProviderError, ReviewCancelledError, runModelOperation } from './retry.js';
import { ModelConfigurationError, type ResolvedModelProviderChain } from './modelProviderResolver.js';
import { ReviewLeaseLostError, type ReviewLeaseCoordinator, type ReviewLeaseHandle } from './lease.js';
import { findingFingerprint, normalizeAndDeduplicateFindings, normalizeDeterministicFinding, normalizeModelFindings } from './findings.js';
import { assertPreparedIteration, prepareReviewIteration } from './iteration.js';
import { assessEvidenceSufficiency, withEvidenceSufficiencyGap, type EvidenceArtifact, type EvidenceSourceState, type EvidenceSufficiencyAssessment } from './evidenceSufficiency.js';
import { correlateReviewFindings } from './correlation.js';
import type { GroundingRepository, ConfirmedRequirement, StandardRule, RequirementCandidate } from './grounding.js';
import type {
  ModelAttemptRecord,
  ReviewAuditEvent,
  ReviewProgressState,
  StaticAnalysisModelProvider,
  StaticFindingInput,
  StaticReviewCancelInput,
  StaticReviewOrchestrator,
  StaticReviewRecord,
  StaticReviewRepository,
  StaticReviewRetryInput,
  StaticReviewScope,
  StaticReviewStartInput,
  StaticReviewStartResult,
  StaticModelRequest,
  NewStaticReview,
  StaticReviewStatus,
  ReviewIterationSourceChoice,
} from './types.js';

const TERMINAL_STATUSES = new Set<StaticReviewStatus>([
  'blocked', 'failed', 'cancelled', 'pending_approval', 'completed', 'approved', 'changes_requested',
]);
const RETRYABLE_REVIEW_STATUSES = new Set<StaticReviewStatus>(['failed', 'blocked', 'cancelled']);

export class EvidenceInsufficientError extends Error {
  readonly assessment?: EvidenceSufficiencyAssessment;

  constructor(message = 'No review artifacts are available for the selected scope', assessment?: EvidenceSufficiencyAssessment) {
    super(message);
    this.name = 'EvidenceInsufficientError';
    this.assessment = assessment;
  }
}

export class ReviewLifecycleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewLifecycleConflictError';
  }
}

export type DeterministicAnalysisResult = {
  findings: DeterministicFinding[];
  /** Whether the injected analyzer already persisted these findings. */
  persisted?: boolean;
};

export type StaticReviewOrchestratorDependencies = {
  repository: StaticReviewRepository;
  groundingRepository?: GroundingRepository;
  artifacts?: (projectId: string, signal?: AbortSignal) => Promise<Artifact[]>;
  readArtifactContent?: (artifact: Artifact, signal?: AbortSignal) => Promise<string>;
  evidenceSourceState?: (artifact: Artifact, signal?: AbortSignal) => Promise<{ state: EvidenceSourceState; detail?: string } | undefined> | { state: EvidenceSourceState; detail?: string } | undefined;
  index?: (projectId: string, artifacts: Artifact[], signal?: AbortSignal, reviewId?: string) => Promise<void>;
  context?: (projectId: string, reviewType: string, maxTokens: number, signal?: AbortSignal, artifacts?: Artifact[], reviewId?: string, queryText?: string) => Promise<RetrievedContext>;
  deterministic?: (projectId: string, artifacts: Artifact[], reviewId: string, signal?: AbortSignal) => Promise<DeterministicAnalysisResult | DeterministicFinding[]>;
  modelProvider?: StaticAnalysisModelProvider;
  fallbackModelProvider?: StaticAnalysisModelProvider;
  /** Resolve the authenticated, encrypted provider chain once for this Review. */
  modelProviderResolver?: (review: StaticReviewRecord, signal?: AbortSignal) => Promise<Pick<ResolvedModelProviderChain,
    'primaryProvider' | 'fallbackProvider' | 'primaryMetadata' | 'fallbackMetadata' | 'configurationId'>>;
  modelMetadata?: () => Promise<{ provider: string; apiFormat: string; model: string }>;
  fallbackModelMetadata?: () => Promise<{ provider: string; apiFormat: string; model: string }>;
  /** When supplied, every execution must own a durable lease and checkpoints. */
  leaseCoordinator?: ReviewLeaseCoordinator;
  /** Optional configured context for maximum attempt budget/backoff. */
  retry?: {
    maxAttempts?: number;
    maxTotalAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitterRatio?: number;
    random?: () => number;
    sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  };
  now?: () => Date;
  idGenerator?: () => string;
  onAudit?: (event: ReviewAuditEvent) => void | Promise<void>;
  onModelAttempt?: (attempt: ModelAttemptRecord) => void | Promise<void>;
  /** When false, a provider failure fails the Review instead of retaining
   * deterministic findings as a pending-approval partial result. */
  allowDeterministicOnly?: boolean;
};

type ActiveExecution = {
  controller: AbortController;
  completion: Promise<StaticReviewRecord>;
};

type StartState = {
  result: StaticReviewStartResult;
};

function stableKey(input: unknown): string {
  const json = JSON.stringify(input, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
  });
  return crypto.createHash('sha256').update(json).digest('hex');
}

function isTerminal(status: StaticReviewStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

function isAbortLike(error: unknown): boolean {
  return error instanceof ReviewCancelledError
    || (error instanceof Error && error.name === 'AbortError');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ReviewCancelledError();
}

function normalizeScope(scope: StaticReviewScope | undefined): StaticReviewScope {
  return {
    artifactIds: scope?.artifactIds ? Array.from(new Set(scope.artifactIds.filter(Boolean))).sort() : undefined,
    requirementIds: scope?.requirementIds ? Array.from(new Set(scope.requirementIds.filter(Boolean))).sort() : undefined,
    standardIds: scope?.standardIds ? Array.from(new Set(scope.standardIds.filter(Boolean))).sort() : undefined,
    sourceIds: scope?.sourceIds ? Array.from(new Set(scope.sourceIds.filter(Boolean))).sort() : undefined,
    label: scope?.label?.trim() || undefined,
  };
}

function stageProgress(stage: string, completedStages: string[], now: () => Date, message?: string): ReviewProgressState {
  return { stage, completedStages: [...completedStages], message, updatedAt: now().toISOString() };
}

export class StaticReviewOrchestratorService implements StaticReviewOrchestrator {
  private readonly active = new Map<string, ActiveExecution>();
  private readonly starts = new Map<string, Promise<StartState>>();
  private readonly operationResults = new Map<string, StaticReviewRecord>();
  private readonly deps: Required<Pick<StaticReviewOrchestratorDependencies, 'repository'>> & StaticReviewOrchestratorDependencies;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;

  constructor(deps: StaticReviewOrchestratorDependencies) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
    this.idGenerator = deps.idGenerator ?? (() => crypto.randomUUID());
  }

  async start(input: StaticReviewStartInput): Promise<StaticReviewStartResult> {
    const idempotencyKey = input.idempotencyKey?.trim() || stableKey({
      operation: 'start', projectId: input.projectId, name: input.name ?? '', reviewType: input.reviewType,
      scope: normalizeScope(input.scope), config: input.config ?? {}, remarks: input.remarks ?? '',
    });
    const operationKey = `start:${input.projectId}:${idempotencyKey}`;
    const pending = this.starts.get(operationKey);
    if (pending) return (await pending).result;
    const promise = this.startOnce(input, idempotencyKey);
    this.starts.set(operationKey, promise);
    try {
      return (await promise).result;
    } finally {
      this.starts.delete(operationKey);
    }
  }

  private async startOnce(input: StaticReviewStartInput, idempotencyKey: string): Promise<StartState> {
    const existingOperation = await this.deps.repository.findOperation('start', idempotencyKey, input.projectId);
    if (existingOperation) {
      const existing = await this.deps.repository.getReview(existingOperation.reviewId);
      if (existing) return { result: this.resultForExisting(existing) };
    }
    const existingReview = await this.deps.repository.findReviewByIdempotencyKey(input.projectId, idempotencyKey);
    if (existingReview) {
      await this.rememberOperation('start', idempotencyKey, existingReview.id, input.projectId);
      return { result: this.resultForExisting(existingReview) };
    }

    await input.validateScopeBeforeCreate?.();
    const scope = normalizeScope(input.scope);
    const lineageRootId = this.idGenerator();
    const record = await this.deps.repository.createReview(this.newReview({
      projectId: input.projectId,
      name: input.name?.trim() || 'Static Review',
      reviewType: input.reviewType,
      scope,
      config: input.config ?? {},
      idempotencyKey,
      lineage: { parentReviewId: null, lineageRootId, reusedSourceManifest: false },
      status: 'queued',
    }));
    await this.rememberOperation('start', idempotencyKey, record.id, input.projectId);
    const result = this.launch(record, input.artifacts, input.sourceManifestMode ?? 'capture');
    return { result: { ...result, reused: false } };
  }

  async retry(input: StaticReviewRetryInput): Promise<StaticReviewStartResult> {
    const parent = await this.deps.repository.getReview(input.reviewId);
    if (!parent) throw new Error('Review not found');
    if (!RETRYABLE_REVIEW_STATUSES.has(parent.status)) {
      throw new ReviewLifecycleConflictError(`Review cannot be retried from status ${parent.status}`);
    }
    const idempotencyKey = input.idempotencyKey?.trim() || stableKey({
      operation: 'retry', parentReviewId: parent.id, refreshSourceManifest: input.refreshSourceManifest === true,
    });
    const existingOperation = await this.deps.repository.findOperation('retry', idempotencyKey, parent.projectId);
    if (existingOperation) {
      const existing = await this.deps.repository.getReview(existingOperation.reviewId);
      if (existing) return this.resultForExisting(existing);
    }
    const existingReview = await this.deps.repository.findReviewByIdempotencyKey(parent.projectId, idempotencyKey);
    if (existingReview) {
      await this.rememberOperation('retry', idempotencyKey, existingReview.id, parent.projectId);
      return this.resultForExisting(existingReview);
    }
    const childInput = this.newReview({
      projectId: parent.projectId,
      name: `${parent.name} (Retry)`,
      reviewType: parent.reviewType,
      scope: parent.scope,
      config: parent.config,
      idempotencyKey,
      status: 'queued',
      sourceManifestId: input.refreshSourceManifest ? null : parent.sourceManifestId,
      lineage: {
        parentReviewId: parent.id,
        lineageRootId: parent.lineage.lineageRootId,
        reusedSourceManifest: input.refreshSourceManifest !== true,
      },
    });
    const child = await this.deps.repository.createRetryReview(childInput);
    await this.rememberOperation('retry', idempotencyKey, child.id, parent.projectId);
    const result = this.launch(child, input.artifacts, input.refreshSourceManifest ? 'capture' : 'reuse');
    return { ...result, reused: false };
  }

  /** Relaunch an RLS-loaded queued Review after startup lease reconciliation. */
  async resumeQueuedReview(reviewId: string): Promise<StaticReviewStartResult> {
    const review = await this.deps.repository.getReview(reviewId);
    if (!review) throw new Error('Review not found');
    if (review.status !== 'queued') throw new Error(`Review cannot resume from status ${review.status}`);
    return this.launch(review, undefined, review.sourceManifestId ? 'reuse' : 'capture');
  }

  async prepareReviewIteration(input: import('./iteration.js').PrepareReviewIterationInput): Promise<StaticReviewRecord> {
    const prepared = await prepareReviewIteration(this.deps.repository, input, {
      now: this.now,
      idGenerator: this.idGenerator,
    });
    await this.audit({
      reviewId: prepared.id,
      projectId: prepared.projectId,
      event: 'review_iteration_prepared',
      detail: {
        parentReviewId: prepared.iteration?.parentReviewId,
        decisionId: prepared.iteration?.decisionId,
        sourceChoice: prepared.iteration?.sourceChoice,
        sourceManifestId: prepared.iteration?.sourceManifestId,
      },
    });
    return prepared;
  }

  async startPreparedIteration(input: import('./iteration.js').StartPreparedIterationInput): Promise<StaticReviewStartResult> {
    const review = await this.deps.repository.getReview(input.reviewId);
    if (!review) throw new Error('Review not found');
    if (!review.iteration || !review.lineage.parentReviewId) throw new Error('Prepared Review is missing its immutable iteration lineage');
    const sourceChoice = review.iteration?.sourceChoice as ReviewIterationSourceChoice;
    const idempotencyKey = input.idempotencyKey?.trim() || stableKey({
      operation: 'start_iteration', reviewId: review.id, decisionId: review.iteration?.decisionId,
      sourceChoice,
    });
    const stored = await this.deps.repository.findOperation('start_iteration', idempotencyKey, review.projectId);
    if (stored) {
      const existing = await this.deps.repository.getReview(stored.reviewId);
      if (existing && (existing.status === 'queued' || existing.status === 'running')) {
        const result = this.launch(existing, sourceChoice === 'refresh' ? input.artifacts : undefined, sourceChoice === 'reuse' ? 'reuse' : 'capture');
        return { ...result, reused: true };
      }
      if (existing) return this.resultForExisting(existing);
    }

    if (review.status === 'queued' || review.status === 'running') {
      await this.deps.repository.saveOperation({
        operation: 'start_iteration', idempotencyKey, projectId: review.projectId, reviewId: review.id,
        createdAt: this.now().toISOString(),
      });
      const result = this.launch(review, sourceChoice === 'refresh' ? input.artifacts : undefined, sourceChoice === 'reuse' ? 'reuse' : 'capture');
      return { ...result, reused: true };
    }
    assertPreparedIteration(review);

    const queued = await this.deps.repository.transitionReview(review.id, ['prepared'], {
      status: 'queued',
      progress: stageProgress('queued', [], this.now, 'Prepared Review explicitly started.'),
      updatedAt: this.now().toISOString(),
    });
    const startRecord = queued ?? await this.deps.repository.getReview(review.id);
    if (!startRecord) throw new Error('Prepared Review could not be loaded after start');
    if (startRecord.status !== 'queued' && startRecord.status !== 'running') {
      return this.resultForExisting(startRecord);
    }
    await this.deps.repository.saveOperation({
      operation: 'start_iteration', idempotencyKey, projectId: review.projectId, reviewId: review.id,
      createdAt: this.now().toISOString(),
    });
    await this.audit({
      reviewId: review.id, projectId: review.projectId, event: 'review_iteration_started',
      detail: { parentReviewId: review.iteration?.parentReviewId, sourceChoice },
    });
    const result = this.launch(startRecord, sourceChoice === 'refresh' ? input.artifacts : undefined, sourceChoice === 'reuse' ? 'reuse' : 'capture');
    return { ...result, reused: false };
  }

  async cancel(input: StaticReviewCancelInput): Promise<StaticReviewRecord> {
    const review = await this.deps.repository.getReview(input.reviewId);
    if (!review) throw new Error('Review not found');
    const idempotencyKey = input.idempotencyKey?.trim() || stableKey({ operation: 'cancel', reviewId: input.reviewId });
    const operationKey = `cancel:${input.reviewId}:${idempotencyKey}`;
    const already = this.operationResults.get(operationKey);
    if (already) return already;
    const stored = await this.deps.repository.findOperation('cancel', idempotencyKey, review.projectId);
    if (stored) {
      const existing = await this.deps.repository.getReview(stored.reviewId);
      if (existing) {
        this.operationResults.set(operationKey, existing);
        return existing;
      }
    }
    if (review.status === 'cancelled') return review;
    if (review.status !== 'prepared' && review.status !== 'queued' && review.status !== 'running') {
      throw new ReviewLifecycleConflictError(`Review cannot be cancelled from status ${review.status}`);
    }
    const execution = this.active.get(input.reviewId);
    execution?.controller.abort();
    const updated = await this.deps.repository.transitionReview(review.id, ['prepared', 'queued', 'running'], {
      status: 'cancelled',
      failureReason: input.reason?.trim() || 'Cancelled by user',
      summary: review.summary,
      updatedAt: this.now().toISOString(),
    });
    if (!updated) {
      const latest = await this.deps.repository.getReview(review.id);
      if (latest?.status === 'cancelled') return latest;
      throw new ReviewLifecycleConflictError(`Review cannot be cancelled from status ${latest?.status ?? 'missing'}`);
    }
    const cancelled = updated;
    await this.audit({
      reviewId: cancelled.id, projectId: cancelled.projectId, event: 'review_cancelled',
      detail: { reason: input.reason?.trim() || 'Cancelled by user' },
    });
    await this.rememberOperation('cancel', idempotencyKey, cancelled.id, review.projectId);
    this.operationResults.set(operationKey, cancelled);
    return cancelled;
  }

  private resultForExisting(review: StaticReviewRecord): StaticReviewStartResult {
    const active = this.active.get(review.id);
    return {
      review,
      completion: active?.completion ?? Promise.resolve(review),
      reused: true,
    };
  }

  private launch(record: StaticReviewRecord, artifacts: Artifact[] | undefined, sourceManifestMode: 'capture' | 'reuse'): StaticReviewStartResult {
    const existing = this.active.get(record.id);
    if (existing) return { review: record, completion: existing.completion, reused: true };
    const controller = new AbortController();
    const completion = this.execute(record, artifacts, sourceManifestMode, controller)
      .finally(() => this.active.delete(record.id));
    this.active.set(record.id, { controller, completion });
    return { review: record, completion, reused: false };
  }

  private async execute(
    initial: StaticReviewRecord,
    requestedArtifacts: Artifact[] | undefined,
    sourceManifestMode: 'capture' | 'reuse',
    controller: AbortController,
  ): Promise<StaticReviewRecord> {
    const signal = controller.signal;
    let lease: ReviewLeaseHandle | null = null;
    let leaseLost = false;
    let stopListeningForLeaseLoss: () => void = () => {};
    let review = initial;
    const completedStages: string[] = [];
    let deterministic: StaticFindingInput[] = [];
    let model: StaticFindingInput[] = [];
    let modelStatus: StaticReviewRecord['modelStatus'] = 'not_requested';
    let modelFailurePermanent = false;
    let context: RetrievedContext | null = null;
    let evidenceArtifacts: EvidenceArtifact[] = [];
    let confirmedRequirements: ConfirmedRequirement[] = [];
    let pendingRequirementCandidates: RequirementCandidate[] = [];
    let enabledStandardRules: StandardRule[] = [];
    let traceabilityReadiness: Array<{ requirementId: string; state: 'complete' | 'incomplete' | 'missing' }> = [];
    let evidenceAssessment: EvidenceSufficiencyAssessment | null = null;
    try {
      if (this.deps.leaseCoordinator) {
        lease = await this.deps.leaseCoordinator.acquire(review.id, review.projectId);
        if (!lease) return (await this.deps.repository.getReview(review.id)) ?? review;
        stopListeningForLeaseLoss = lease.onLost(() => {
          leaseLost = true;
          controller.abort();
        });
        await this.checkpoint(lease, 'starting', completedStages);
      }
      const running = await this.deps.repository.transitionReview(review.id, ['queued'], {
        status: 'running', progress: stageProgress('freezing_sources', completedStages, this.now),
        updatedAt: this.now().toISOString(),
      });
      if (!running) return (await this.deps.repository.getReview(review.id)) ?? review;
      review = running;
      await this.checkpoint(lease, 'freezing_sources', completedStages);
      await this.progress(review, 'freezing_sources', completedStages);
      checkCancelled(signal);

      let artifacts: Artifact[];
      if (sourceManifestMode === 'reuse' && review.sourceManifestId && !requestedArtifacts) {
        const frozen = await this.deps.repository.loadSourceManifestArtifacts(review.sourceManifestId);
        if (!frozen) {
          evidenceAssessment = withEvidenceSufficiencyGap(assessEvidenceSufficiency({
            reviewId: review.id, projectId: review.projectId, reviewType: review.reviewType, artifacts: [], now: this.now(),
          }), {
            code: 'source_manifest_unavailable', severity: 'blocking', title: 'Frozen source manifest is unavailable',
            detail: 'The child Review could not load its parent’s immutable source snapshot.',
            remediation: 'Restore the source snapshot or prepare a new child with the explicit refresh-source choice.',
            affectedStages: ['source_freeze', 'deterministic_analysis', 'model_analysis'],
          });
          await this.deps.repository.saveEvidenceSufficiency(evidenceAssessment);
          throw new EvidenceInsufficientError('The frozen source manifest is unavailable and cannot be safely reused.', evidenceAssessment);
        }
        artifacts = frozen;
      } else {
        if (requestedArtifacts) artifacts = [...requestedArtifacts];
        else if (this.deps.artifacts) artifacts = await this.deps.artifacts(review.projectId, signal);
        else throw new Error('An authenticated Review artifact source is required.');
      }
      if (review.scope.artifactIds?.length) {
        const selected = new Set(review.scope.artifactIds);
        artifacts = artifacts.filter(artifact => selected.has(artifact.id));
      }
      await this.saveManifest(review, artifacts, sourceManifestMode);
      const contentReader = this.deps.readArtifactContent;
      if (!contentReader) throw new Error('An authenticated frozen-artifact reader is required.');
      evidenceArtifacts = [];
      for (const artifact of artifacts) {
        checkCancelled(signal);
        const state = await this.deps.evidenceSourceState?.(artifact, signal);
        try {
          const content = await contentReader(artifact, signal);
          const expectedHash = artifact.contentHash.replace(/^sha256:/i, '');
          if (/^[a-f0-9]{64}$/i.test(expectedHash)) {
            const actualHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
            if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
              throw new Error('Readable artifact content does not match the frozen source-manifest hash.');
            }
          }
          evidenceArtifacts.push({ artifact, ...state, content });
        } catch (error) {
          if (isAbortLike(error) || signal.aborted) throw new ReviewCancelledError();
          evidenceArtifacts.push({
            artifact,
            ...(state?.state === 'deleted' || state?.state === 'inaccessible' || state?.state === 'stale'
              ? { state: state.state }
              : { state: 'inaccessible' as const }),
            detail: state?.detail ?? errorMessage(error),
          });
        }
      }

      if (this.deps.groundingRepository) {
        confirmedRequirements = await this.deps.groundingRepository.listConfirmedRequirements(review.projectId, review.scope.requirementIds, signal);
        checkCancelled(signal);
        pendingRequirementCandidates = await this.deps.groundingRepository.listRequirementCandidates(review.projectId, 'pending_confirmation', signal);
        checkCancelled(signal);
        const scopedRules = await this.deps.groundingRepository.listStandardRules(review.projectId, review.scope.standardIds, signal);
        checkCancelled(signal);
        enabledStandardRules = scopedRules.filter(rule => rule.enabled);
      }
      if (review.reviewType === 'requirement_to_code_traceability' && this.deps.repository.getTraceabilityReadiness) {
        traceabilityReadiness = await this.deps.repository.getTraceabilityReadiness(review.projectId, review.scope.requirementIds, signal);
        checkCancelled(signal);
      }
      const dispositions = await this.deps.repository.listContradictionDispositions?.(review.projectId, signal);
      checkCancelled(signal);
      const assessment = assessEvidenceSufficiency({
        reviewId: review.id,
        projectId: review.projectId,
        reviewType: review.reviewType,
        artifacts: evidenceArtifacts,
        confirmedRequirements,
        pendingRequirementCandidates,
        enabledStandardRules,
        standardIds: review.scope.standardIds,
        traceability: traceabilityReadiness,
        dispositions,
        requiredArtifactTypes: Array.isArray(review.config.requiredArtifactTypes)
          ? review.config.requiredArtifactTypes.filter((item): item is Artifact['type'] => typeof item === 'string')
          : undefined,
        now: this.now(),
      });
      evidenceAssessment = assessment;
      await this.deps.repository.saveEvidenceSufficiency(assessment);
      await this.audit({
        reviewId: review.id, projectId: review.projectId, event: 'evidence_sufficiency_assessed',
        detail: { readiness: assessment.readiness, gapCount: assessment.gaps.length, contradictionCount: assessment.contradictions.length },
      });
      if (assessment.readiness === 'blocked') {
        throw new EvidenceInsufficientError('Evidence sufficiency assessment blocked this Review.', assessment);
      }
      completedStages.push('freezing_sources');
      await this.checkpoint(lease, 'indexing_context', completedStages);
      await this.progress(review, 'indexing_context', completedStages);
      checkCancelled(signal);

      if (this.deps.index) await this.deps.index(review.projectId, artifacts, signal, review.id);
      if (this.deps.context) {
        const instructions = typeof review.config.instructions === 'string' ? review.config.instructions : '';
        const grounding = confirmedRequirements.map(item => `${item.title}: ${item.description}`)
          .concat(enabledStandardRules.map(item => item.statement)).join('\n');
        const queryText = [review.reviewType, instructions, review.iteration?.feedback ?? '', grounding].filter(Boolean).join('\n').slice(0, 8_000);
        context = await this.deps.context(review.projectId, review.reviewType, this.contextTokenBudget(review), signal, artifacts, review.id, queryText);
      }
      completedStages.push('indexing_context');

      await this.checkpoint(lease, 'deterministic_analysis', completedStages);
      await this.progress(review, 'deterministic_analysis', completedStages);
      checkCancelled(signal);
      if (!this.deps.deterministic) throw new Error('An authenticated deterministic Review analyzer is required.');
      const deterministicResult = await this.deps.deterministic(review.projectId, artifacts, review.id, signal);
      const deterministicItems = Array.isArray(deterministicResult) ? deterministicResult : deterministicResult.findings;
      const deterministicAlreadyPersisted = !Array.isArray(deterministicResult) && deterministicResult.persisted === true;
      deterministic = deterministicItems.map(item => {
        const artifact = artifacts.find(candidate => candidate.filePath === item.filePath);
        return {
          ...normalizeDeterministicFinding(item, artifact?.id),
          sourceIdentity: artifact?.originalPath ?? artifact?.filePath ?? null,
          sourceVersion: artifact?.contentHash ?? null,
        };
      });
      completedStages.push('deterministic_analysis');

      await this.checkpoint(lease, 'model_analysis', completedStages);
      await this.progress(review, 'model_analysis', completedStages);
      checkCancelled(signal);
      const modelRequest = await this.buildModelRequest(review, context, deterministic, signal, evidenceArtifacts, confirmedRequirements, enabledStandardRules, evidenceAssessment);
      try {
        let modelProvider = this.deps.modelProvider;
        let fallbackModelProvider = this.deps.fallbackModelProvider;
        let metadata: { provider: string; apiFormat: string; model: string };
        let fallbackMetadata: { provider: string; apiFormat: string; model: string } | undefined;
        let configurationId: string | null = null;
        if (this.deps.modelProviderResolver) {
          const chain = await this.deps.modelProviderResolver(review, signal);
          checkCancelled(signal);
          modelProvider = chain.primaryProvider;
          fallbackModelProvider = chain.fallbackProvider ?? undefined;
          metadata = chain.primaryMetadata;
          fallbackMetadata = chain.fallbackMetadata ?? undefined;
          configurationId = chain.configurationId;
        } else {
          if (!modelProvider) throw new ModelConfigurationError('No static-analysis Model Provider is configured.', 'not_configured');
          metadata = await this.providerMetadata(modelProvider, this.deps.modelMetadata);
          fallbackMetadata = fallbackModelProvider
            ? await this.providerMetadata(fallbackModelProvider, this.deps.fallbackModelMetadata)
            : undefined;
        }
        if (configurationId) {
          await this.audit({
            reviewId: review.id, projectId: review.projectId, event: 'model_configuration_resolved', stage: 'model_analysis',
            detail: { configurationId, provider: metadata.provider, model: metadata.model, fallbackConfigured: !!fallbackModelProvider },
          });
        }
        const attemptOffset = await this.deps.repository.getModelAttemptCount(review.id, 'model_analysis');
        if (!modelProvider) throw new ModelConfigurationError('No static-analysis Model Provider is configured.', 'not_configured');
        const modelResult = await runModelOperation(modelRequest, modelProvider, {
          ...this.deps.retry,
          attemptOffset,
          signal,
          reviewId: review.id,
          projectId: review.projectId,
          stage: 'model_analysis',
          provider: metadata.provider,
          apiFormat: metadata.apiFormat,
          model: metadata.model,
          fallback: fallbackModelProvider,
          fallbackContext: fallbackMetadata,
          now: this.now,
          onAttempt: async (attempt) => {
            await this.recordAttempt(attempt);
          },
        });
        const normalizedModelFindings = normalizeModelFindings(modelResult.result.result).map(finding => {
          const artifact = artifacts.find(candidate => candidate.id === finding.artifactId)
            ?? artifacts.find(candidate => candidate.filePath.replace(/\\/g, '/').toLowerCase() === finding.filePath.replace(/\\/g, '/').toLowerCase());
          return {
            ...finding,
            artifactId: artifact?.id ?? null,
            sourceIdentity: artifact?.originalPath ?? artifact?.filePath ?? null,
            sourceVersion: artifact?.contentHash ?? null,
          };
        });
        const grounding = this.sanitizeGroundingReferences(normalizedModelFindings, confirmedRequirements, enabledStandardRules);
        model = grounding.findings;
        if (grounding.rejectedRequirementReferences || grounding.rejectedStandardReferences) {
          await this.audit({
            reviewId: review.id,
            projectId: review.projectId,
            event: 'model_grounding_references_rejected',
            stage: 'model_analysis',
            detail: {
              requirementReferences: grounding.rejectedRequirementReferences,
              standardReferences: grounding.rejectedStandardReferences,
            },
          });
        }
        modelStatus = 'succeeded';
        await this.audit({
          reviewId: review.id, projectId: review.projectId, event: 'model_analysis_succeeded', stage: 'model_analysis',
          detail: { provider: modelResult.providerUsed, findingCount: model.length },
        });
      } catch (error) {
        if (isAbortLike(error) || signal.aborted) throw new ReviewCancelledError();
        modelStatus = 'failed';
        modelFailurePermanent = error instanceof ModelConfigurationError || (error instanceof ModelProviderError && error.retryable === false);
        await this.audit({
          reviewId: review.id, projectId: review.projectId, event: 'model_analysis_failed', stage: 'model_analysis',
          detail: { error: errorMessage(error), deterministicFindingCount: deterministic.length },
        });
        if (this.deps.allowDeterministicOnly === false) throw error;
      }
      completedStages.push('model_analysis');

      checkCancelled(signal);
      const normalized = normalizeAndDeduplicateFindings(deterministic, model);
      await this.checkpoint(lease, 'persisting_evidence', completedStages);
      await this.progress(review, 'persisting_evidence', completedStages);
      await this.saveTraceability(review);
      await this.persistFindings(review, normalized.all, deterministicAlreadyPersisted);
      await this.correlateIterationFindings(review, artifacts);
      completedStages.push('persisting_evidence');
      checkCancelled(signal);
      await this.checkpoint(lease, 'complete', completedStages);

      const latest = await this.deps.repository.getReview(review.id);
      if (!latest || latest.status === 'cancelled') return latest ?? review;
      const summary = modelStatus === 'failed'
        ? `Deterministic analysis retained ${normalized.all.length} finding${normalized.all.length === 1 ? '' : 's'}; Model Provider analysis was unavailable.`
        : `Static review completed with ${normalized.all.length} finding${normalized.all.length === 1 ? '' : 's'} (${normalized.deterministic.length} deterministic, ${normalized.model.length} model).`;
      const terminal = await this.deps.repository.transitionReview(review.id, ['running'], {
        status: modelFailurePermanent ? 'failed' : 'pending_approval',
        deterministicFindingCount: normalized.deterministic.length,
        modelFindingCount: normalized.model.length,
        modelStatus: modelStatus === 'failed' ? 'partial' : modelStatus,
        summary,
        failureReason: modelStatus === 'failed' ? 'Model Provider unavailable; deterministic results retained.' : '',
        progress: stageProgress('complete', completedStages, this.now, summary),
        updatedAt: this.now().toISOString(),
      });
      return terminal ?? ((await this.deps.repository.getReview(review.id)) ?? review);
    } catch (error) {
      const current = await this.deps.repository.getReview(review.id);
      if (leaseLost || error instanceof ReviewLeaseLostError) return current ?? review;
      if (isAbortLike(error) || signal.aborted || current?.status === 'cancelled') {
        const cancelled = await this.deps.repository.transitionReview(review.id, ['queued', 'running'], {
          status: 'cancelled', failureReason: 'Cancelled by user', progress: stageProgress('cancelled', completedStages, this.now),
          updatedAt: this.now().toISOString(),
        });
        return cancelled ?? ((await this.deps.repository.getReview(review.id)) ?? review);
      }
      const blocked = error instanceof EvidenceInsufficientError;
      if (blocked && error instanceof EvidenceInsufficientError && !error.assessment) {
        evidenceAssessment = withEvidenceSufficiencyGap(evidenceAssessment ?? assessEvidenceSufficiency({
          reviewId: review.id, projectId: review.projectId, reviewType: review.reviewType, artifacts: evidenceArtifacts, now: this.now(),
        }), {
          code: 'evidence_preflight_failed', severity: 'blocking', title: 'Evidence preflight could not complete',
          detail: errorMessage(error), remediation: 'Verify the selected sources and retry with a readable, frozen source set.',
          affectedStages: ['source_freeze', 'deterministic_analysis', 'model_analysis'],
        });
        await this.deps.repository.saveEvidenceSufficiency(evidenceAssessment);
      }
      const terminal = await this.deps.repository.transitionReview(review.id, ['queued', 'running'], {
        status: blocked ? 'blocked' : 'failed',
        failureReason: errorMessage(error),
        summary: blocked
          ? `Review blocked by evidence sufficiency (${evidenceAssessment?.gaps.length ?? (error instanceof EvidenceInsufficientError ? error.assessment?.gaps.length : 0) ?? 0} gap(s)).`
          : '',
        progress: stageProgress(blocked ? 'blocked' : 'failed', completedStages, this.now, errorMessage(error)),
        updatedAt: this.now().toISOString(),
      });
      await this.audit({
        reviewId: review.id, projectId: review.projectId, event: blocked ? 'review_blocked' : 'review_failed',
        detail: { error: errorMessage(error) },
      });
      return terminal ?? ((await this.deps.repository.getReview(review.id)) ?? review);
    } finally {
      stopListeningForLeaseLoss();
      if (lease) {
        try {
          await lease.release();
        } catch {
          // An expired lease is recovered on the next authenticated runtime
          // reconciliation; cleanup must not replace the Review result.
        }
      }
    }
  }

  private newReview(input: Pick<NewStaticReview, 'projectId' | 'name' | 'reviewType' | 'scope' | 'config' | 'idempotencyKey' | 'lineage' | 'status'> & Partial<Pick<NewStaticReview, 'sourceManifestId'>>): NewStaticReview {
    const now = this.now().toISOString();
    return {
      id: this.idGenerator(),
      projectId: input.projectId,
      name: input.name,
      reviewType: input.reviewType,
      status: input.status,
      idempotencyKey: input.idempotencyKey,
      scope: input.scope,
      config: input.config,
      lineage: input.lineage,
      sourceManifestId: input.sourceManifestId ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async rememberOperation(operation: 'start' | 'cancel' | 'retry', idempotencyKey: string, reviewId: string, projectId: string): Promise<void> {
    await this.deps.repository.saveOperation({ operation, idempotencyKey, projectId, reviewId, createdAt: this.now().toISOString() });
  }

  private async progress(review: StaticReviewRecord, stage: string, completedStages: string[], message?: string): Promise<void> {
    const progress = stageProgress(stage, completedStages, this.now, message);
    await this.deps.repository.updateProgress(review.id, progress);
    await this.deps.repository.transitionReview(review.id, ['queued', 'running'], { progress, updatedAt: progress.updatedAt });
    await this.audit({ reviewId: review.id, projectId: review.projectId, event: 'review_stage_started', stage, detail: { completedStages } });
  }

  private async checkpoint(lease: ReviewLeaseHandle | null, stage: string, completedStages: string[]): Promise<void> {
    if (!lease) return;
    await lease.checkpoint({
      stage,
      completedStages: [...completedStages],
      detail: { resumeStrategy: 'replay_frozen_inputs' },
    });
  }

  private async saveManifest(review: StaticReviewRecord, artifacts: Artifact[], mode: 'capture' | 'reuse'): Promise<void> {
    if (mode === 'reuse' && review.sourceManifestId) {
      await this.deps.repository.transitionReview(review.id, ['running'], { sourceManifestId: review.sourceManifestId, updatedAt: this.now().toISOString() });
      await this.audit({ reviewId: review.id, projectId: review.projectId, event: 'source_manifest_reused', detail: { sourceManifestId: review.sourceManifestId } });
      return;
    }
    const manifestId = (await this.deps.repository.saveSourceManifest(review.id, review.projectId, artifacts, mode)).id;
    await this.deps.repository.transitionReview(review.id, ['running'], { sourceManifestId: manifestId, updatedAt: this.now().toISOString() });
    await this.audit({ reviewId: review.id, projectId: review.projectId, event: 'source_manifest_captured', detail: { sourceManifestId: manifestId, artifactCount: artifacts.length, mode } });
  }

  private async saveTraceability(review: StaticReviewRecord): Promise<void> {
    await this.deps.repository.saveTraceabilitySnapshot(review.id, review.projectId);
  }

  private async persistFindings(review: StaticReviewRecord, findings: StaticFindingInput[], deterministicAlreadyPersisted: boolean): Promise<void> {
    for (const finding of findings) {
      // The legacy deterministic adapter already persisted its own rows. A
      // Supabase repository receives all normalized findings exactly once.
      if (deterministicAlreadyPersisted && finding.source === 'deterministic') continue;
      await this.deps.repository.saveFinding({
        ...finding,
        fingerprint: finding.fingerprint ?? findingFingerprint(finding),
        id: this.idGenerator(),
        reviewId: review.id,
        projectId: review.projectId,
        createdAt: this.now().toISOString(),
      });
    }
  }

  private sanitizeGroundingReferences(
    findings: StaticFindingInput[],
    requirements: ConfirmedRequirement[],
    standards: StandardRule[],
  ): { findings: StaticFindingInput[]; rejectedRequirementReferences: number; rejectedStandardReferences: number } {
    const requirementById = new Map(requirements.map(item => [item.id, item]));
    const standardByRuleId = new Map(standards.map(item => [item.id, item]));
    let rejectedRequirementReferences = 0;
    let rejectedStandardReferences = 0;
    const sanitized = findings.map(finding => {
      let requirement = finding.requirementId ? requirementById.get(finding.requirementId) : undefined;
      let standard = finding.standardRuleId ? standardByRuleId.get(finding.standardRuleId) : undefined;
      if (finding.requirementId && !requirement) rejectedRequirementReferences++;
      if ((finding.standardRuleId || finding.standardId) && !standard) rejectedStandardReferences++;
      if (standard && finding.standardId && finding.standardId !== standard.standardId) {
        rejectedStandardReferences++;
        standard = undefined;
      }
      const locator = standard
        ? { ...standard.sourceLocator, standardVersion: standard.standardVersion, sourceVersion: standard.sourceVersion, standardRuleId: standard.id, standardId: standard.standardId }
        : requirement?.sourceLocator ?? null;
      return {
        ...finding,
        requirementId: requirement?.id ?? null,
        standardId: standard?.standardId ?? null,
        standardRuleId: standard?.id ?? null,
        sourceIdentity: finding.sourceIdentity ?? null,
        sourceVersion: finding.sourceVersion ?? null,
        sourceLocator: locator,
      };
    });
    return { findings: sanitized, rejectedRequirementReferences, rejectedStandardReferences };
  }

  private async correlateIterationFindings(review: StaticReviewRecord, artifacts: Artifact[]): Promise<void> {
    const parentReviewId = review.iteration?.parentReviewId ?? review.lineage.parentReviewId;
    if (!parentReviewId) return;
    const { listReviewFindings, saveFindingCorrelations } = this.deps.repository;
    const [previous, current] = await Promise.all([
      listReviewFindings.call(this.deps.repository, parentReviewId),
      listReviewFindings.call(this.deps.repository, review.id),
    ]);
    const snapshot = correlateReviewFindings({
      parentReviewId,
      childReviewId: review.id,
      previous,
      current,
      evaluatedArtifactIds: artifacts.map(artifact => artifact.id),
      evaluatedSourceIdentities: artifacts.flatMap(artifact => [artifact.originalPath, artifact.filePath].filter((value): value is string => !!value)),
    });
    await saveFindingCorrelations.call(this.deps.repository, snapshot);
    await this.audit({
      reviewId: review.id, projectId: review.projectId, event: 'finding_correlation_saved',
      detail: { parentReviewId, counts: snapshot.counts, ambiguousCount: snapshot.ambiguities.length },
    });
  }

  private async recordAttempt(attempt: ModelAttemptRecord): Promise<void> {
    await this.deps.repository.recordModelAttempt(attempt);
    await this.deps.onModelAttempt?.(attempt);
    await this.audit({
      reviewId: attempt.reviewId, projectId: attempt.projectId, event: 'model_attempt', stage: attempt.stage,
      detail: {
        attempt: attempt.attempt, provider: attempt.provider, model: attempt.model,
        outcome: attempt.outcome, durationMs: attempt.durationMs, statusCode: attempt.statusCode,
        errorCode: attempt.errorCode, inputTokens: attempt.usage?.inputTokens, outputTokens: attempt.usage?.outputTokens,
      },
    });
  }

  private async audit(event: Omit<ReviewAuditEvent, 'createdAt'>): Promise<void> {
    const complete = { ...event, createdAt: this.now().toISOString() };
    await this.deps.repository.recordAudit(complete);
    await this.deps.onAudit?.(complete);
  }

  private async providerMetadata(provider: StaticAnalysisModelProvider, resolver?: StaticReviewOrchestratorDependencies['modelMetadata']): Promise<{ provider: string; apiFormat: string; model: string }> {
    if (resolver) return resolver();
    const settings = await (provider as ConfiguredTextModelProvider).getSettings?.();
    return settings
      ? { provider: settings.provider, apiFormat: settings.apiFormat, model: settings.model }
      : { provider: 'configured', apiFormat: 'unknown', model: 'unknown' };
  }

  private contextTokenBudget(review: StaticReviewRecord): number {
    const value = Number(review.config?.maxContextTokens);
    return Number.isFinite(value) && value > 0 ? value : 100_000;
  }

  private async buildModelRequest(
    review: StaticReviewRecord,
    context: RetrievedContext | null,
    deterministic: StaticFindingInput[],
    signal: AbortSignal,
    evidenceArtifacts: EvidenceArtifact[],
    requirements: ConfirmedRequirement[],
    standards: StandardRule[],
    evidenceAssessment: EvidenceSufficiencyAssessment | null,
  ): Promise<StaticModelRequest> {
    const sections: string[] = [];
    for (const item of evidenceArtifacts) {
      checkCancelled(signal);
      if (item.content !== undefined) sections.push(`--- Artifact: ${item.artifact.fileName} (${item.artifact.type}; ${item.artifact.id}) ---\n${item.content}`);
    }
    const contextSummary = context
      ? `Indexed context: ${context.files.length} files, ${context.totalSymbols} symbols, estimated ${context.estimatedTokens} tokens. ${context.reason}`
      : 'Indexed context was not available; analyze the frozen artifacts directly.';
    const contextExcerpts = context?.selectedChunks?.length
      ? context.selectedChunks.map(chunk => `--- Indexed excerpt: ${chunk.filePath} (version ${chunk.artifactVersionId}, chunk ${chunk.ordinal}) ---\n${chunk.content}`).join('\n\n')
      : '(no ranked excerpts available)';
    const deterministicSummary = deterministic.length
      ? deterministic.map(item => `- [${item.severity}] ${item.title} (${item.filePath}:${item.lineNumber ?? '?'}) — ${item.evidence}`).join('\n')
      : '(none)';
    const requirementSummary = requirements.length
      ? requirements.map(item => `- [requirementId=${item.id}] ${item.title}: ${item.description} (source=${item.sourceLocator ? `${item.sourceLocator.filePath}:${item.sourceLocator.lineStart ?? '?'}` : 'manual requirement'}, version=${item.sourceVersion ?? 'unspecified'}, confidence=${item.confidence ?? 'unspecified'})`).join('\n')
      : '(no confirmed requirements in grounding scope)';
    const standardSummary = standards.length
      ? standards.map(item => `- [standardId=${item.standardId}; standardRuleId=${item.id}; version=${item.standardVersion}; severity=${item.severity}] ${item.statement} (source=${item.sourceLocator.filePath}:${item.sourceLocator.lineStart ?? '?'})`).join('\n')
      : '(no enabled standard rules in grounding scope)';
    const contradictionSummary = evidenceAssessment?.contradictions.filter(item => item.disposition).map(item => {
      const disposition = item.disposition!;
      const authority = disposition.decision === 'authoritative_left' ? `left claim: ${item.left.text}`
        : disposition.decision === 'authoritative_right' ? `right claim: ${item.right.text}`
          : 'the reviewer determined these claims are not conflicting';
      return `- ${authority}. Reviewer rationale: ${disposition.rationale}`;
    }).join('\n') || '(none)';
    return {
      reviewId: review.id,
      projectId: review.projectId,
      stage: 'model_analysis',
      systemPrompt: `You are Centinel's static-analysis Model Provider. Analyze only the supplied frozen artifacts and context. Return JSON only with a findings array. Each finding must contain title, description, severity (critical/high/medium/low/info), category, filePath, lineNumber, evidence, recommendation, and confidence (high/medium/low). When a finding is grounded in a confirmed requirement, cite its exact requirementId. When grounded in a coding-standard rule, cite exact standardId and standardRuleId, and include sourceLocator with the supplied path and line. Never invent identifiers, source locations, or standards. Do not treat unconfirmed candidates as requirements. Do not invent files or line numbers. Keep thoughts private; provide concise evidence suitable for an audit record.`,
      prompt: `Review type: ${review.reviewType}\n${contextSummary}${review.iteration?.feedback ? `\n\nReviewer feedback from parent Review: ${review.iteration.feedback}` : ''}\n\nConfirmed requirements (authoritative):\n${requirementSummary}\n\nEnabled coding-standard rules (with provenance):\n${standardSummary}\n\nReviewer-dispositioned evidence conflicts:\n${contradictionSummary}\n\nDeterministic findings (avoid duplicates):\n${deterministicSummary}\n\nRelevant frozen-source excerpts (ranking aid; verify against full content below):\n${contextExcerpts}\n\nFrozen artifact content:\n${sections.join('\n\n')}`,
      signal,
    };
  }
}

export function createStaticReviewOrchestrator(deps: StaticReviewOrchestratorDependencies): StaticReviewOrchestratorService {
  return new StaticReviewOrchestratorService(deps);
}

export type { StaticReviewOrchestrator } from './types.js';
