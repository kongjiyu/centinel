import crypto from 'node:crypto';
import { analysisMapFromEvents } from './assessmentBatches.js';
import type { Artifact } from '../artifacts.js';
import type {
  ModelAttemptRecord,
  NewStaticReview,
  PersistedReviewFinding,
  ReviewAuditEvent,
  ReviewOperationKind,
  ReviewOperationRecord,
  ReviewProgressState,
  ReviewSourceManifestMode,
  CaptureReviewTraceabilityInput,
  StaticReviewDecision,
  StaticReviewIteration,
  StaticReviewPatch,
  StaticReviewRecord,
  StaticReviewRepository,
} from './types.js';
import type { ReviewTraceabilitySnapshot } from './evidenceTypes.js';
import { mergeEvidenceSufficiencyAssessments, type EvidenceSufficiencyAssessment } from './evidenceSufficiency.js';
import type { FindingCorrelationSnapshot } from './correlation.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Small repository used by orchestrator tests and local adapters. It models
 * the compare-and-set and idempotency semantics a Supabase implementation
 * must provide, while keeping SQL/Supabase details outside the runner.
 */
export class InMemoryStaticReviewRepository implements StaticReviewRepository {
  readonly reviews = new Map<string, StaticReviewRecord>();
  readonly operations = new Map<string, ReviewOperationRecord>();
  readonly findings: PersistedReviewFinding[] = [];
  readonly attempts: ModelAttemptRecord[] = [];
  readonly audits: ReviewAuditEvent[] = [];
  readonly manifests = new Map<string, { id: string; projectId: string; artifacts: Artifact[]; mode: ReviewSourceManifestMode }>();
  readonly progress = new Map<string, ReviewProgressState>();
  readonly traceability = new Set<string>();
  readonly traceabilitySnapshots = new Map<string, ReviewTraceabilitySnapshot>();
  readonly decisions: StaticReviewDecision[] = [];
  readonly iterations = new Map<string, StaticReviewIteration>();
  readonly evidenceAssessments = new Map<string, EvidenceSufficiencyAssessment>();
  readonly findingCorrelations = new Map<string, FindingCorrelationSnapshot>();
  async getBatchCacheBasis(reviewId: string) {
    const review = await this.getReview(reviewId);
    if (!review || !['blocked', 'failed', 'cancelled', 'pending_approval', 'completed', 'approved', 'changes_requested'].includes(review.status)) return null;
    const analysisMap = analysisMapFromEvents(this.audits.filter(event => event.reviewId === reviewId));
    return analysisMap ? { reviewId, projectId: review.projectId, analysisMap, findings: await this.listReviewFindings(reviewId) } : null;
  }

  async createReview(input: NewStaticReview): Promise<StaticReviewRecord> {
    const now = input.createdAt ?? new Date().toISOString();
    const record: StaticReviewRecord = {
      id: input.id ?? crypto.randomUUID(),
      projectId: input.projectId,
      name: input.name,
      reviewType: input.reviewType,
      status: input.status,
      idempotencyKey: input.idempotencyKey,
      scope: clone(input.scope),
      config: clone(input.config),
      lineage: clone(input.lineage),
      iteration: input.iteration ? clone(input.iteration) : null,
      sourceManifestId: input.sourceManifestId ?? null,
      deterministicFindingCount: 0,
      modelFindingCount: 0,
      modelStatus: 'not_requested',
      summary: '',
      failureReason: '',
      progress: null,
      revision: 0,
      createdAt: now,
      updatedAt: input.updatedAt ?? now,
    };
    this.reviews.set(record.id, clone(record));
    return clone(record);
  }

  async getReview(reviewId: string): Promise<StaticReviewRecord | null> {
    const record = this.reviews.get(reviewId);
    return record ? clone(record) : null;
  }

  async listReviews(projectId: string): Promise<StaticReviewRecord[]> {
    return [...this.reviews.values()].filter(review => review.projectId === projectId).map(clone);
  }

  async transitionReview(reviewId: string, expectedStatuses: StaticReviewRecord['status'][], patch: StaticReviewPatch): Promise<StaticReviewRecord | null> {
    const current = this.reviews.get(reviewId);
    if (!current || !expectedStatuses.includes(current.status)) return null;
    const next: StaticReviewRecord = {
      ...current,
      ...clone(patch),
      revision: current.revision + 1,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    };
    this.reviews.set(reviewId, next);
    return clone(next);
  }

  async findOperation(operation: ReviewOperationKind, idempotencyKey: string, projectId?: string): Promise<ReviewOperationRecord | null> {
    const item = this.operations.get(`${operation}:${projectId ?? ''}:${idempotencyKey}`);
    return item ? clone(item) : null;
  }

  async saveOperation(record: ReviewOperationRecord): Promise<void> {
    this.operations.set(`${record.operation}:${record.projectId ?? ''}:${record.idempotencyKey}`, clone(record));
  }

  async findReviewByIdempotencyKey(projectId: string, idempotencyKey: string): Promise<StaticReviewRecord | null> {
    const found = Array.from(this.reviews.values()).find(item => item.projectId === projectId && item.idempotencyKey === idempotencyKey);
    return found ? clone(found) : null;
  }

  async createRetryReview(input: NewStaticReview): Promise<StaticReviewRecord> {
    return this.createReview(input);
  }

  async saveSourceManifest(reviewId: string, projectId: string, artifacts: Artifact[], mode: ReviewSourceManifestMode): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    this.manifests.set(reviewId, { id, projectId, artifacts: clone(artifacts), mode });
    return { id };
  }

  async loadSourceManifestArtifacts(sourceManifestId: string): Promise<Artifact[] | null> {
    const manifest = [...this.manifests.values()].find(item => item.id === sourceManifestId);
    return manifest ? clone(manifest.artifacts) : null;
  }

  async getLatestDecision(reviewId: string): Promise<StaticReviewDecision | null> {
    const found = this.decisions.filter(item => item.reviewId === reviewId && item.decision !== 'commented')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0];
    return found ? clone(found) : null;
  }

  async addDecision(decision: StaticReviewDecision): Promise<void> {
    this.decisions.push(clone(decision));
  }

  async saveReviewIteration(childReviewId: string, _projectId: string, iteration: StaticReviewIteration): Promise<void> {
    this.iterations.set(childReviewId, clone(iteration));
  }

  async saveEvidenceSufficiency(assessment: EvidenceSufficiencyAssessment): Promise<void> {
    if (!this.evidenceAssessments.has(assessment.reviewId)) this.evidenceAssessments.set(assessment.reviewId, clone(assessment));
  }

  async appendEvidenceSufficiency(assessment: EvidenceSufficiencyAssessment): Promise<EvidenceSufficiencyAssessment> {
    const review = this.reviews.get(assessment.reviewId);
    if (review?.status !== 'running') throw new Error('Evidence sufficiency is immutable after Review execution ends.');
    const frozen = this.evidenceAssessments.get(assessment.reviewId);
    if (!frozen) throw new Error('The frozen evidence sufficiency assessment is unavailable.');
    const merged = mergeEvidenceSufficiencyAssessments(frozen, assessment);
    this.evidenceAssessments.set(assessment.reviewId, clone(merged));
    return clone(merged);
  }

  async getEvidenceSufficiency(reviewId: string): Promise<EvidenceSufficiencyAssessment | null> {
    const assessment = this.evidenceAssessments.get(reviewId);
    return assessment ? clone(assessment) : null;
  }

  async saveFindingCorrelations(snapshot: FindingCorrelationSnapshot): Promise<void> {
    if (!this.findingCorrelations.has(snapshot.childReviewId)) this.findingCorrelations.set(snapshot.childReviewId, clone(snapshot));
  }

  async getFindingCorrelationSnapshot(childReviewId: string): Promise<FindingCorrelationSnapshot | null> {
    const snapshot = this.findingCorrelations.get(childReviewId);
    return snapshot ? clone(snapshot) : null;
  }

  async listReviewFindings(reviewId: string): Promise<PersistedReviewFinding[]> {
    return this.findings.filter(item => item.reviewId === reviewId).map(clone);
  }

  async captureTraceabilitySnapshot(reviewId: string, projectId: string, input: CaptureReviewTraceabilityInput): Promise<ReviewTraceabilitySnapshot> {
    const existing = this.traceabilitySnapshots.get(reviewId);
    if (existing) return clone(existing);
    const inherited = input.reuseFromReviewId ? this.traceabilitySnapshots.get(input.reuseFromReviewId) : undefined;
    if (inherited?.metadata?.snapshotVersion === 2) {
      const snapshot = clone({ ...inherited, sessionId: reviewId, projectId });
      this.traceabilitySnapshots.set(reviewId, snapshot);
      this.traceability.add(reviewId);
      return clone(snapshot);
    }
    const capturedAt = new Date().toISOString();
    const selectedRequirementIds = input.scope.requirementIds?.length
      ? [...input.scope.requirementIds]
      : (input.grounding?.confirmedRequirements ?? []).map(item => item.id);
    const selectedArtifactIds = input.scope.artifactIds?.length
      ? [...input.scope.artifactIds]
      : input.artifacts.map(item => item.id);
    const snapshot: ReviewTraceabilitySnapshot = {
      sessionId: reviewId,
      projectId,
      status: 'unavailable',
      records: [],
      summary: { complete: 0, incomplete: 0, missing: 0, attention: 0, unavailable: 0 },
      capturedAt,
      updatedAt: capturedAt,
      metadata: {
        snapshotVersion: 2,
        sourceManifestId: input.sourceManifestId,
        inclusionBasis: input.reuseFromReviewId ? null : {
          requirementSelection: input.scope.requirementIds?.length ? 'explicit' : 'project',
          artifactSelection: input.scope.artifactIds?.length ? 'explicit' : 'full_manifest',
          selectedRequirementIds,
          selectedArtifactIds,
          sourceManifestId: input.sourceManifestId,
        },
        grounding: input.grounding ? clone(input.grounding) : null,
        unavailableReason: input.reuseFromReviewId ? 'frozen_parent_context_unavailable' : 'in_memory_traceability_adapter_unavailable',
      },
    };
    this.traceabilitySnapshots.set(reviewId, snapshot);
    this.traceability.add(reviewId);
    return clone(snapshot);
  }

  async getTraceabilitySnapshot(reviewId: string): Promise<ReviewTraceabilitySnapshot | null> {
    const snapshot = this.traceabilitySnapshots.get(reviewId);
    return snapshot ? clone(snapshot) : null;
  }

  async saveTraceabilitySnapshot(reviewId: string, projectId: string): Promise<void> {
    if (this.traceabilitySnapshots.has(reviewId)) return;
    const now = new Date().toISOString();
    this.traceabilitySnapshots.set(reviewId, {
      sessionId: reviewId, projectId, status: 'unavailable', records: [],
      summary: { complete: 0, incomplete: 0, missing: 0, attention: 0, unavailable: 0 },
      capturedAt: now, updatedAt: now,
      metadata: { snapshotVersion: 2, sourceManifestId: null, inclusionBasis: null, grounding: null, unavailableReason: 'frozen_context_not_provided' },
    });
    this.traceability.add(reviewId);
  }

  async saveFinding(finding: PersistedReviewFinding): Promise<void> {
    this.findings.push(clone(finding));
  }

  async updateProgress(reviewId: string, progress: ReviewProgressState): Promise<void> {
    this.progress.set(reviewId, clone(progress));
  }

  async recordModelAttempt(attempt: ModelAttemptRecord): Promise<void> {
    const existingIndex = this.attempts.findIndex(item => item.reviewId === attempt.reviewId
      && item.stage === attempt.stage && item.attempt === attempt.attempt);
    if (existingIndex >= 0) this.attempts[existingIndex] = clone(attempt);
    else this.attempts.push(clone(attempt));
  }

  async getModelAttemptCount(reviewId: string, stage: string): Promise<number> {
    return this.attempts
      .filter(attempt => attempt.reviewId === reviewId && attempt.stage === stage)
      .reduce((maximum, attempt) => Math.max(maximum, attempt.attempt), 0);
  }

  async recordAudit(event: ReviewAuditEvent): Promise<void> {
    const existingIndex = event.id ? this.audits.findIndex(item => item.id === event.id) : -1;
    if (existingIndex >= 0) this.audits[existingIndex] = clone(event);
    else this.audits.push(clone(event));
  }
}
