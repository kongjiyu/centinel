import crypto from 'node:crypto';
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
  StaticReviewDecision,
  StaticReviewIteration,
  StaticReviewPatch,
  StaticReviewRecord,
  StaticReviewRepository,
} from './types.js';
import type { EvidenceSufficiencyAssessment } from './evidenceSufficiency.js';
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
  readonly decisions: StaticReviewDecision[] = [];
  readonly iterations = new Map<string, StaticReviewIteration>();
  readonly evidenceAssessments = new Map<string, EvidenceSufficiencyAssessment>();
  readonly findingCorrelations = new Map<string, FindingCorrelationSnapshot>();

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

  async saveTraceabilitySnapshot(reviewId: string): Promise<void> {
    this.traceability.add(reviewId);
  }

  async saveFinding(finding: PersistedReviewFinding): Promise<void> {
    this.findings.push(clone(finding));
  }

  async updateProgress(reviewId: string, progress: ReviewProgressState): Promise<void> {
    this.progress.set(reviewId, clone(progress));
  }

  async recordModelAttempt(attempt: ModelAttemptRecord): Promise<void> {
    this.attempts.push(clone(attempt));
  }

  async getModelAttemptCount(reviewId: string, stage: string): Promise<number> {
    return this.attempts
      .filter(attempt => attempt.reviewId === reviewId && attempt.stage === stage)
      .reduce((maximum, attempt) => Math.max(maximum, attempt.attempt), 0);
  }

  async recordAudit(event: ReviewAuditEvent): Promise<void> {
    this.audits.push(clone(event));
  }
}
