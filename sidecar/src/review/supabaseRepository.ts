import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artifact } from '../artifacts.js';
import type { ReviewTraceabilityRecord } from './evidenceTypes.js';
import { summarizeTraceability } from './traceabilitySummary.js';
import type { EvidenceSufficiencyAssessment, EvidenceContradictionDisposition } from './evidenceSufficiency.js';
import type { FindingCorrelation, FindingCorrelationSnapshot, CorrelationAmbiguity } from './correlation.js';
import type {
  ConfirmedRequirement,
  GroundingRepository,
  GroundingCandidateStatus,
  RequirementCandidate,
  RequirementCandidateDraft,
  StandardRule,
  StandardRuleDraft,
} from './grounding.js';
import type {
  ModelAttemptRecord,
  NewStaticReview,
  PersistedReviewFinding,
  ReviewAuditEvent,
  ReviewOperationKind,
  ReviewOperationRecord,
  ReviewProgressState,
  ReviewSourceManifestMode,
  StaticReviewPatch,
  StaticReviewRecord,
  StaticReviewRepository,
  StaticReviewScope,
  StaticReviewStatus,
  StaticReviewDecision,
  StaticReviewIteration,
} from './types.js';
import { toModelUsageRecord } from './usageAudit.js';

type Row = Record<string, unknown>;
type Query = any;

function asRow(value: unknown): Row {
  return value && typeof value === 'object' ? value as Row : {};
}

function text(row: Row, key: string, fallback = ''): string {
  return row[key] == null ? fallback : String(row[key]);
}

function nullableText(row: Row, key: string): string | null {
  return row[key] == null || row[key] === '' ? null : String(row[key]);
}

function objectValue(value: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value as Record<string, unknown>) : fallback;
}

function nullableProgress(value: unknown): ReviewProgressState | null {
  const progress = objectValue(value);
  return Object.keys(progress).length ? progress as unknown as ReviewProgressState : null;
}

function normalizeStatus(value: unknown): StaticReviewStatus {
  if (value === 'failure') return 'failed';
  if (value === 'success') return 'completed';
  const statuses: StaticReviewStatus[] = ['prepared', 'queued', 'running', 'blocked', 'failed', 'cancelled', 'pending_approval', 'completed', 'approved', 'changes_requested'];
  return statuses.includes(value as StaticReviewStatus) ? value as StaticReviewStatus : 'queued';
}

function normalizeModelStatus(value: unknown): StaticReviewRecord['modelStatus'] {
  return ['not_requested', 'succeeded', 'partial', 'failed', 'cancelled'].includes(String(value))
    ? value as StaticReviewRecord['modelStatus']
    : 'not_requested';
}

function mapReview(row: Row): StaticReviewRecord {
  const lineage = objectValue(row.lineage) as Partial<StaticReviewRecord['lineage']>;
  const rawIteration = objectValue(row.iteration);
  const iteration = rawIteration.parentReviewId && rawIteration.decisionId
    ? rawIteration as unknown as StaticReviewIteration
    : null;
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    name: text(row, 'name'),
    reviewType: text(row, 'review_type'),
    status: normalizeStatus(row.status),
    idempotencyKey: text(row, 'idempotency_key'),
    scope: objectValue(row.scope) as StaticReviewScope,
    config: objectValue(row.config),
    lineage: {
      parentReviewId: lineage.parentReviewId ?? nullableText(row, 'parent_review_id'),
      lineageRootId: String(lineage.lineageRootId ?? row.id),
      reusedSourceManifest: Boolean(lineage.reusedSourceManifest ?? false),
    },
    iteration,
    sourceManifestId: nullableText(row, 'source_manifest_id'),
    deterministicFindingCount: Number(row.deterministic_finding_count ?? 0),
    modelFindingCount: Number(row.model_finding_count ?? 0),
    modelStatus: normalizeModelStatus(row.model_status),
    summary: text(row, 'summary', text(row, 'final_summary')),
    failureReason: text(row, 'failure_reason'),
    progress: nullableProgress(row.progress),
    revision: Number(row.revision ?? 0),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function errorFor(label: string, error: unknown): Error {
  const message = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error);
  return new Error(`Supabase ${label} failed: ${message}`);
}

function isMissingRevisionError(error: unknown): boolean {
  const message = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error);
  return /revision|scope|lineage|model_status|deterministic_finding_count|model_finding_count|summary/.test(message);
}

function mapArtifact(artifact: Artifact): Record<string, unknown> {
  return {
    id: artifact.id,
    version_id: artifact.versionId ?? null,
    project_id: artifact.projectId,
    path: artifact.filePath,
    name: artifact.fileName,
    kind: artifact.type,
    metadata: { source: artifact.source, originalPath: artifact.originalPath, contentHash: artifact.contentHash },
    created_at: artifact.createdAt,
  };
}

function mapSnapshotArtifact(value: unknown): Artifact {
  const row = asRow(value);
  const metadata = objectValue(row.metadata);
  const type = text(row, 'kind', 'other');
  const source = text(metadata, 'source', 'documents');
  const artifactTypes: Artifact['type'][] = ['requirement', 'design', 'source_code', 'coding_standard', 'other'];
  const artifactSources: Artifact['source'][] = ['documents', 'repository', 'directory', 'drive'];
  return {
    versionId: text(row, 'version_id') || undefined,
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    type: artifactTypes.includes(type as Artifact['type']) ? type as Artifact['type'] : 'other',
    source: artifactSources.includes(source as Artifact['source']) ? source as Artifact['source'] : 'documents',
    fileName: text(row, 'name'),
    filePath: text(row, 'path'),
    originalPath: nullableText(metadata, 'originalPath'),
    contentHash: text(metadata, 'contentHash'),
    createdAt: text(row, 'created_at'),
  };
}

function mapRequirementCandidate(row: Row): RequirementCandidate {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    kind: text(row, 'kind') as RequirementCandidate['kind'],
    title: text(row, 'title'),
    statement: text(row, 'statement'),
    sourceLocator: objectValue(row.source_locator) as RequirementCandidate['sourceLocator'],
    sourceVersion: text(row, 'source_version'),
    confidence: Number(row.confidence ?? 0.5),
    fingerprint: text(row, 'fingerprint'),
    status: text(row, 'status', 'pending_confirmation') as RequirementCandidate['status'],
    confirmedRequirementId: nullableText(row, 'confirmed_requirement_id'),
    confirmedBy: nullableText(row, 'confirmed_by'),
    rejectedBy: nullableText(row, 'rejected_by'),
    confirmedAt: nullableText(row, 'confirmed_at'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function mapConfirmedRequirement(row: Row): ConfirmedRequirement {
  const locatorValue = objectValue(row.source_locator);
  const locator = text(locatorValue, 'artifactId') || text(locatorValue, 'filePath')
    ? locatorValue as ConfirmedRequirement['sourceLocator']
    : null;
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    title: text(row, 'title'),
    description: text(row, 'description'),
    category: text(row, 'category'),
    priority: text(row, 'priority', 'medium'),
    sourceCandidateId: nullableText(row, 'candidate_id'),
    sourceLocator: locator,
    sourceVersion: nullableText(row, 'source_version'),
    confidence: row.confidence == null ? null : Number(row.confidence),
    createdAt: text(row, 'created_at'),
  };
}

function mapStandardRule(row: Row): StandardRule {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    standardId: text(row, 'standard_id'),
    stableKey: text(row, 'stable_key'),
    title: text(row, 'title'),
    statement: text(row, 'statement'),
    category: text(row, 'category'),
    severity: text(row, 'severity', 'low') as StandardRule['severity'],
    recommendation: text(row, 'recommendation'),
    sourceArtifactId: text(row, 'source_artifact_id'),
    sourceLocator: objectValue(row.source_locator) as StandardRule['sourceLocator'],
    sourceVersion: text(row, 'source_version'),
    standardVersion: text(row, 'standard_version'),
    enabled: row.enabled !== false,
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function mapPersistedFinding(row: Row): PersistedReviewFinding {
  const location = objectValue(row.location);
  const source = text(row, 'verifier') === 'deterministic' ? 'deterministic' : 'model';
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    reviewId: text(row, 'review_session_id'),
    source,
    title: text(row, 'title'),
    description: text(row, 'description'),
    severity: text(row, 'severity'),
    priority: nullableText(row, 'priority'),
    category: text(row, 'category'),
    filePath: text(location, 'filePath'),
    lineNumber: row.location && typeof row.location === 'object' ? Number(location.lineNumber) || null : null,
    artifactId: nullableText(row, 'artifact_id'),
    evidence: text(row, 'evidence_text'),
    recommendation: text(row, 'recommendation'),
    confidence: text(row, 'confidence'),
    riskLevel: nullableText(row, 'risk_level'),
    fingerprint: nullableText(row, 'correlation_fingerprint') ?? undefined,
    ruleId: nullableText(row, 'rule_id') ?? nullableText(location, 'ruleId'),
    standardRuleId: nullableText(row, 'standard_rule_id'),
    standardId: nullableText(row, 'standard_id'),
    requirementId: nullableText(row, 'requirement_id'),
    sourceIdentity: nullableText(row, 'source_identity') ?? nullableText(location, 'sourceIdentity'),
    sourceVersion: nullableText(row, 'source_version') ?? nullableText(location, 'sourceVersion'),
    sourceLocator: objectValue(row.source_locator, objectValue(location.sourceLocator)),
    stableFindingId: nullableText(row, 'stable_finding_id'),
    createdAt: text(row, 'created_at'),
  };
}

/**
 * Supabase-backed implementation of the orchestrator repository seam.
 *
 * Every query uses the caller's RLS-scoped client. Lifecycle transitions use
 * revision + expected-status compare-and-set, while the fallback timestamp
 * branch keeps compatibility with a database that has not yet applied the
 * additive review metadata migration.
 */
export class SupabaseStaticReviewRepository implements StaticReviewRepository, GroundingRepository {
  constructor(private readonly client: SupabaseClient, private readonly actorId?: string) {}

  private from(table: string): Query {
    return this.client.from(table);
  }

  private async allRows(table: string, label: string, configure: (query: Query) => Query, signal?: AbortSignal): Promise<Row[]> {
    const rows: Row[] = [];
    const pageSize = 500;
    // Server-side row limits may be lower than requested; advance by the
    // number actually returned so frozen traceability cannot silently truncate.
    for (let start = 0; ;) {
      signal?.throwIfAborted();
      let query = configure(this.from(table)).range(start, start + pageSize - 1);
      if (signal) query = query.abortSignal(signal);
      const result = await query;
      signal?.throwIfAborted();
      if (result.error) throw errorFor(label, result.error);
      const page = Array.isArray(result.data) ? result.data.map(asRow) : [];
      if (!page.length) return rows;
      rows.push(...page);
      start += page.length;
    }
  }

  async createReview(input: NewStaticReview): Promise<StaticReviewRecord> {
    const id = input.id ?? crypto.randomUUID();
    const now = input.createdAt ?? new Date().toISOString();
    const row = {
      id,
      project_id: input.projectId,
      name: input.name,
      review_type: input.reviewType,
      status: input.status,
      idempotency_key: input.idempotencyKey,
      scope: input.scope,
      config: input.config,
      lineage: input.lineage,
      iteration: input.iteration ?? null,
      source_manifest_id: input.sourceManifestId,
      deterministic_finding_count: 0,
      model_finding_count: 0,
      model_status: 'not_requested',
      summary: '',
      final_summary: '',
      failure_reason: '',
      progress: {},
      revision: 0,
      created_at: now,
      updated_at: input.updatedAt ?? now,
    };
    const result = await this.from('review_sessions').insert(row).select('*').single();
    if (result.error) {
      // A concurrent duplicate Start is expected to lose the unique-key race
      // and return the already-created immutable Review.
      if (input.idempotencyKey) {
        const existing = await this.findReviewByIdempotencyKey(input.projectId, input.idempotencyKey);
        if (existing) return existing;
      }
      throw errorFor('review creation', result.error);
    }
    return mapReview(asRow(result.data));
  }

  async getReview(reviewId: string): Promise<StaticReviewRecord | null> {
    const result = await this.from('review_sessions').select('*').eq('id', reviewId).maybeSingle();
    if (result.error) throw errorFor('review lookup', result.error);
    return result.data ? mapReview(asRow(result.data)) : null;
  }

  async listReviews(projectId: string): Promise<StaticReviewRecord[]> {
    const rows = await this.allRows('review_sessions', 'review list', query => query.select('*')
      .eq('project_id', projectId).order('created_at', { ascending: false }).order('id'));
    return rows.map(mapReview);
  }

  async listActiveReviews(): Promise<StaticReviewRecord[]> {
    const rows = await this.allRows('review_sessions', 'active review list', query => query.select('*')
      .in('status', ['queued', 'running']).order('created_at', { ascending: false }).order('id'));
    return rows.map(mapReview);
  }

  async transitionReview(reviewId: string, expectedStatuses: StaticReviewStatus[], patch: StaticReviewPatch): Promise<StaticReviewRecord | null> {
    const current = await this.getReview(reviewId);
    if (!current || !expectedStatuses.includes(current.status)) return null;
    const updatedAt = patch.updatedAt ?? new Date().toISOString();
    const row: Row = { revision: current.revision + 1, updated_at: updatedAt };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.sourceManifestId !== undefined) row.source_manifest_id = patch.sourceManifestId;
    if (patch.deterministicFindingCount !== undefined) row.deterministic_finding_count = patch.deterministicFindingCount;
    if (patch.modelFindingCount !== undefined) row.model_finding_count = patch.modelFindingCount;
    if (patch.modelStatus !== undefined) row.model_status = patch.modelStatus;
    if (patch.summary !== undefined) {
      row.summary = patch.summary;
      row.final_summary = patch.summary;
    }
    if (patch.failureReason !== undefined) row.failure_reason = patch.failureReason;
    if (patch.progress !== undefined) row.progress = patch.progress;
    if (patch.scope !== undefined) row.scope = patch.scope;

    const result = await this.from('review_sessions').update(row)
      .eq('id', reviewId)
      .eq('revision', current.revision)
      .in('status', expectedStatuses)
      .select('*')
      .maybeSingle();
    if (result.error) {
      if (!isMissingRevisionError(result.error)) throw errorFor('review transition', result.error);
      return this.transitionByTimestamp(reviewId, current, expectedStatuses, row);
    }
    return result.data ? mapReview(asRow(result.data)) : null;
  }

  private async transitionByTimestamp(reviewId: string, current: StaticReviewRecord, expectedStatuses: StaticReviewStatus[], row: Row): Promise<StaticReviewRecord | null> {
    const { revision: _revision, ...timestampRow } = row;
    const result = await this.from('review_sessions').update(timestampRow)
      .eq('id', reviewId)
      .eq('updated_at', current.updatedAt)
      .in('status', expectedStatuses)
      .select('*')
      .maybeSingle();
    if (result.error) throw errorFor('review timestamp transition', result.error);
    return result.data ? mapReview(asRow(result.data)) : null;
  }

  async findOperation(operation: ReviewOperationKind, idempotencyKey: string, projectId?: string): Promise<ReviewOperationRecord | null> {
    let query = this.from('review_operations').select('*').eq('operation', operation).eq('idempotency_key', idempotencyKey);
    query = projectId ? query.eq('project_id', projectId) : query.is('project_id', null);
    const result = await query.maybeSingle();
    if (result.error) throw errorFor('review operation lookup', result.error);
    if (!result.data) return null;
    const row = asRow(result.data);
    return { operation: text(row, 'operation') as ReviewOperationKind, idempotencyKey: text(row, 'idempotency_key'), projectId: nullableText(row, 'project_id') ?? undefined, reviewId: text(row, 'review_id'), createdAt: text(row, 'created_at') };
  }

  async saveOperation(record: ReviewOperationRecord): Promise<void> {
    const result = await this.from('review_operations').upsert({ operation: record.operation, idempotency_key: record.idempotencyKey, project_id: record.projectId ?? null, review_id: record.reviewId, created_at: record.createdAt }, { onConflict: 'operation,project_id,idempotency_key' });
    if (result.error) throw errorFor('review operation save', result.error);
  }

  async findReviewByIdempotencyKey(projectId: string, idempotencyKey: string): Promise<StaticReviewRecord | null> {
    const result = await this.from('review_sessions').select('*').eq('project_id', projectId).eq('idempotency_key', idempotencyKey).maybeSingle();
    if (result.error) throw errorFor('review idempotency lookup', result.error);
    return result.data ? mapReview(asRow(result.data)) : null;
  }

  async createRetryReview(input: NewStaticReview): Promise<StaticReviewRecord> {
    return this.createReview(input);
  }

  async saveSourceManifest(reviewId: string, projectId: string, artifacts: Artifact[], mode: ReviewSourceManifestMode): Promise<{ id: string }> {
    const existing = await this.from('review_source_snapshots').select('id').eq('review_session_id', reviewId).maybeSingle();
    if (existing.error) throw errorFor('source manifest lookup', existing.error);
    if (existing.data) return { id: String((existing.data as Row).id) };
    const snapshot = {
      version: 1,
      mode,
      capturedAt: new Date().toISOString(),
      artifacts: artifacts.map(mapArtifact),
    };
    const result = await this.from('review_source_snapshots').insert({ project_id: projectId, review_session_id: reviewId, status: 'available', snapshot }).select('id').single();
    if (result.error || !result.data) throw errorFor('source manifest save', result.error ?? new Error('no manifest returned'));
    const id = String((result.data as Row).id);
    const update = await this.from('review_sessions').update({ source_manifest_id: id, source_manifest_hash: crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), updated_at: new Date().toISOString() }).eq('id', reviewId);
    if (update.error && !isMissingRevisionError(update.error)) throw errorFor('source manifest link', update.error);
    return { id };
  }

  async loadSourceManifestArtifacts(sourceManifestId: string): Promise<Artifact[] | null> {
    const result = await this.from('review_source_snapshots').select('snapshot').eq('id', sourceManifestId).maybeSingle();
    if (result.error) throw errorFor('source manifest load', result.error);
    if (!result.data) return null;
    const snapshot = objectValue(asRow(result.data).snapshot);
    const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts : null;
    return artifacts ? artifacts.map(mapSnapshotArtifact) : null;
  }

  async saveTraceabilitySnapshot(reviewId: string, projectId: string): Promise<void> {
    const existing = await this.from('review_traceability_snapshots').select('id').eq('review_session_id', reviewId).maybeSingle();
    if (existing.error) throw errorFor('traceability snapshot lookup', existing.error);
    if (existing.data) return;
    const requirements = await this.allRows('requirements', 'traceability requirements query', query =>
      query.select('id,title,description,category').eq('project_id', projectId).order('created_at').order('id'));
    const capturedAt = new Date().toISOString();
    const records: ReviewTraceabilityRecord[] = [];
    for (const req of requirements) {
      const rows = await this.allRows('requirement_mappings', 'traceability mappings query', query =>
        query.select('id,file_id,symbol_id,coverage_status,confidence').eq('requirement_id', req.id).order('id'));
      const normalized = rows.map(value => {
        const row = asRow(value);
        return { id: text(row, 'id'), fileId: nullableText(row, 'file_id'), symbolId: nullableText(row, 'symbol_id'), coverage: text(row, 'coverage_status').trim().toLowerCase(), confidence: Number(row.confidence) };
      });
      const complete = normalized.length > 0 && normalized.every(item => /^(complete|covered|verified|full|pass|passed|fully[_ -]?covered)$/.test(item.coverage));
      const state: ReviewTraceabilityRecord['state'] = normalized.length === 0 ? 'missing' : complete ? 'complete' : 'incomplete';
      const confidenceValues = normalized.map(item => item.confidence).filter(Number.isFinite);
      records.push({ requirementId: text(req, 'id'), title: text(req, 'title'), description: text(req, 'description'), category: text(req, 'category'), state, mappingIds: normalized.map(item => item.id), sourceArtifactIds: Array.from(new Set(normalized.flatMap(item => item.fileId ? [item.fileId] : []))), sourceSymbolIds: Array.from(new Set(normalized.flatMap(item => item.symbolId ? [item.symbolId] : []))), confidence: confidenceValues.length ? Math.min(...confidenceValues) : null, capturedAt });
    }
    const summary = summarizeTraceability(records);
    const result = await this.from('review_traceability_snapshots').insert({ project_id: projectId, review_session_id: reviewId, status: 'available', records, summary, created_at: capturedAt });
    if (result.error) throw errorFor('traceability snapshot save', result.error);
  }

  async getLatestDecision(reviewId: string): Promise<StaticReviewDecision | null> {
    const result = await this.from('review_decisions').select('id,project_id,review_session_id,decision,comment,reviewer,created_at')
      .eq('review_session_id', reviewId).neq('decision', 'commented')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
    if (result.error) throw errorFor('latest review decision lookup', result.error);
    if (!result.data) return null;
    const row = asRow(result.data);
    return {
      id: text(row, 'id'),
      projectId: text(row, 'project_id'),
      reviewId: text(row, 'review_session_id'),
      decision: text(row, 'decision') as StaticReviewDecision['decision'],
      comment: text(row, 'comment'),
      reviewer: text(row, 'reviewer'),
      createdAt: text(row, 'created_at'),
    };
  }

  async getTraceabilityReadiness(projectId: string, requirementIds?: string[], signal?: AbortSignal): Promise<Array<{ requirementId: string; state: 'complete' | 'incomplete' | 'missing' }>> {
    const requirements = await this.allRows('requirements', 'traceability readiness requirements lookup', query => {
      const scoped = query.select('id').eq('project_id', projectId).order('id');
      return requirementIds?.length ? scoped.in('id', requirementIds) : scoped;
    }, signal);
    const output: Array<{ requirementId: string; state: 'complete' | 'incomplete' | 'missing' }> = [];
    for (const requirement of requirements) {
      const rows = await this.allRows('requirement_mappings', 'traceability readiness mappings lookup', query =>
        query.select('coverage_status').eq('requirement_id', text(requirement, 'id')).order('id'), signal);
      const complete = rows.length > 0 && rows.every(item => /^(complete|covered|verified|full|pass|passed|fully[_ -]?covered)$/.test(text(asRow(item), 'coverage_status').trim().toLowerCase()));
      output.push({ requirementId: text(requirement, 'id'), state: rows.length === 0 ? 'missing' : complete ? 'complete' : 'incomplete' });
    }
    return output;
  }

  async saveReviewIteration(childReviewId: string, projectId: string, iteration: StaticReviewIteration): Promise<void> {
    const result = await this.from('review_iterations').upsert({
      child_review_id: childReviewId,
      project_id: projectId,
      parent_review_id: iteration.parentReviewId,
      decision_id: iteration.decisionId,
      feedback: iteration.feedback,
      reviewer: iteration.reviewer,
      created_by: iteration.createdBy,
      source_choice: iteration.sourceChoice,
      source_manifest_id: iteration.sourceManifestId,
      metadata: { preparedAt: iteration.preparedAt },
      created_at: iteration.preparedAt,
    }, { onConflict: 'child_review_id', ignoreDuplicates: true });
    if (result.error) throw errorFor('review iteration save', result.error);
  }

  async saveEvidenceSufficiency(assessment: EvidenceSufficiencyAssessment): Promise<void> {
    const result = await this.from('review_evidence_assessments').upsert({
      id: assessment.id,
      project_id: assessment.projectId,
      review_session_id: assessment.reviewId,
      readiness: assessment.readiness,
      assessment,
      created_at: assessment.assessedAt,
    }, { onConflict: 'review_session_id', ignoreDuplicates: true });
    if (result.error) throw errorFor('evidence sufficiency save', result.error);
  }

  async getEvidenceSufficiency(reviewId: string): Promise<EvidenceSufficiencyAssessment | null> {
    const result = await this.from('review_evidence_assessments').select('assessment').eq('review_session_id', reviewId).maybeSingle();
    if (result.error) throw errorFor('evidence sufficiency lookup', result.error);
    return result.data ? objectValue(asRow(result.data).assessment) as unknown as EvidenceSufficiencyAssessment : null;
  }

  async listContradictionDispositions(projectId: string, signal?: AbortSignal): Promise<EvidenceContradictionDisposition[]> {
    const rows = await this.allRows('evidence_contradiction_dispositions', 'contradiction dispositions lookup', query =>
      query.select('*').eq('project_id', projectId).order('id'), signal);
    return rows.map(value => {
      const item = asRow(value);
      return {
        contradictionId: String(item.contradiction_id),
        decision: item.decision as EvidenceContradictionDisposition['decision'],
        rationale: String(item.rationale),
        actorId: String(item.actor_id),
        updatedAt: String(item.updated_at),
      };
    });
  }

  async saveContradictionDisposition(input: {
    projectId: string;
    reviewId: string;
    contradictionId: string;
    decision: EvidenceContradictionDisposition['decision'];
    rationale: string;
    actorId: string;
  }): Promise<EvidenceContradictionDisposition> {
    const result = await this.from('evidence_contradiction_dispositions').upsert({
      project_id: input.projectId,
      review_session_id: input.reviewId,
      contradiction_id: input.contradictionId,
      decision: input.decision,
      rationale: input.rationale,
      actor_id: input.actorId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id,contradiction_id' }).select('*').single();
    if (result.error) throw errorFor('contradiction disposition save', result.error);
    const row = asRow(result.data);
    return {
      contradictionId: String(row.contradiction_id),
      decision: row.decision as EvidenceContradictionDisposition['decision'],
      rationale: String(row.rationale),
      actorId: String(row.actor_id),
      updatedAt: String(row.updated_at),
    };
  }

  async saveFindingCorrelations(snapshot: FindingCorrelationSnapshot): Promise<void> {
    const review = await this.getReview(snapshot.childReviewId);
    if (!review) throw new Error(`Child Review ${snapshot.childReviewId} was not found`);
    if (snapshot.correlations.length) {
      const rows = snapshot.correlations.map(item => ({
        id: item.id,
        project_id: review.projectId,
        parent_review_id: item.parentReviewId,
        child_review_id: item.childReviewId,
        parent_finding_id: item.parentFindingId,
        child_finding_id: item.childFindingId,
        classification: item.classification,
        method: item.method,
        score: item.score,
        stable_fingerprint: item.stableFingerprint,
        detail: { explanation: item.detail ?? null },
        created_at: snapshot.createdAt,
      }));
      const details = await this.from('review_finding_correlations').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
      if (details.error) throw errorFor('finding correlation records save', details.error);
    }
    const result = await this.from('review_correlation_snapshots').upsert({
      id: crypto.createHash('sha256').update(snapshot.childReviewId).digest('hex'),
      project_id: review.projectId,
      parent_review_id: snapshot.parentReviewId,
      child_review_id: snapshot.childReviewId,
      counts: snapshot.counts,
      ambiguities: snapshot.ambiguities,
      created_at: snapshot.createdAt,
    }, { onConflict: 'child_review_id', ignoreDuplicates: true });
    if (result.error) throw errorFor('finding correlation snapshot save', result.error);
  }

  async getFindingCorrelationSnapshot(childReviewId: string): Promise<FindingCorrelationSnapshot | null> {
    const snapshotResult = await this.from('review_correlation_snapshots').select('*').eq('child_review_id', childReviewId).maybeSingle();
    if (snapshotResult.error) throw errorFor('finding correlation snapshot lookup', snapshotResult.error);
    if (!snapshotResult.data) return null;
    const snapshotRow = asRow(snapshotResult.data);
    const rowsResult = await this.from('review_finding_correlations').select('*').eq('child_review_id', childReviewId).order('created_at').order('id');
    if (rowsResult.error) throw errorFor('finding correlations lookup', rowsResult.error);
    const correlations: FindingCorrelation[] = (rowsResult.data ?? []).map((value: unknown) => {
      const row = asRow(value);
      const detail = objectValue(row.detail);
      return {
        id: text(row, 'id'),
        parentReviewId: text(row, 'parent_review_id'),
        childReviewId: text(row, 'child_review_id'),
        parentFindingId: nullableText(row, 'parent_finding_id'),
        childFindingId: nullableText(row, 'child_finding_id'),
        classification: text(row, 'classification') as FindingCorrelation['classification'],
        method: text(row, 'method') as FindingCorrelation['method'],
        score: Number(row.score ?? 0),
        stableFingerprint: text(row, 'stable_fingerprint'),
        ...(text(detail, 'explanation') ? { detail: text(detail, 'explanation') } : {}),
      };
    });
    return {
      parentReviewId: text(snapshotRow, 'parent_review_id'),
      childReviewId: text(snapshotRow, 'child_review_id'),
      correlations,
      ambiguities: (Array.isArray(snapshotRow.ambiguities) ? structuredClone(snapshotRow.ambiguities) : []) as CorrelationAmbiguity[],
      counts: objectValue(snapshotRow.counts) as FindingCorrelationSnapshot['counts'],
      createdAt: text(snapshotRow, 'created_at'),
    };
  }

  async listReviewFindings(reviewId: string): Promise<PersistedReviewFinding[]> {
    const rows = await this.allRows('findings', 'review findings list', query => query.select('*')
      .eq('review_session_id', reviewId).order('created_at').order('id'));
    return rows.map(mapPersistedFinding);
  }

  async saveRequirementCandidates(drafts: RequirementCandidateDraft[]): Promise<RequirementCandidate[]> {
    if (!drafts.length) return [];
    if (drafts.some(draft => draft.projectId !== drafts[0].projectId)) throw new Error('Requirement candidates must be saved within a single project');
    const rows = drafts.map(draft => ({
      project_id: draft.projectId,
      kind: draft.kind,
      title: draft.title,
      statement: draft.statement,
      source_locator: draft.sourceLocator,
      source_version: draft.sourceVersion,
      confidence: draft.confidence,
      fingerprint: draft.fingerprint,
      status: 'pending_confirmation',
    }));
    const result = await this.from('requirement_candidates').upsert(rows, { onConflict: 'project_id,fingerprint', ignoreDuplicates: true }).select('*');
    if (result.error) throw errorFor('requirement candidate save', result.error);
    const saved = (result.data ?? []).map((row: unknown) => mapRequirementCandidate(asRow(row)));
    if (saved.length === drafts.length) return saved;
    // PostgREST may omit rows ignored by ON CONFLICT; fetch the idempotent set.
    const fingerprints = drafts.map(item => item.fingerprint);
    const loaded = await this.from('requirement_candidates').select('*').in('fingerprint', fingerprints).eq('project_id', drafts[0].projectId);
    if (loaded.error) throw errorFor('requirement candidate idempotency lookup', loaded.error);
    const byFingerprint = new Map((loaded.data ?? []).map((row: unknown) => {
      const candidate = mapRequirementCandidate(asRow(row));
      return [candidate.fingerprint, candidate] as const;
    }));
    return drafts.map(draft => byFingerprint.get(draft.fingerprint)).filter((item): item is RequirementCandidate => !!item);
  }

  async listRequirementCandidates(projectId: string, status?: GroundingCandidateStatus, signal?: AbortSignal): Promise<RequirementCandidate[]> {
    const rows = await this.allRows('requirement_candidates', 'requirement candidates list', query => {
      const scoped = query.select('*').eq('project_id', projectId).order('created_at').order('id');
      return status ? scoped.eq('status', status) : scoped;
    }, signal);
    return rows.map(row => mapRequirementCandidate(row));
  }

  async confirmRequirementCandidate(candidateId: string, actorId: string): Promise<ConfirmedRequirement> {
    const rpc = (this.client as unknown as { rpc?: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }).rpc;
    if (typeof rpc === 'function') {
      const result = await rpc.call(this.client, 'confirm_requirement_candidate', { p_candidate_id: candidateId, p_actor_id: actorId });
      if (result.error) throw errorFor('requirement candidate confirmation', result.error);
      const value = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!value) throw new Error('Requirement confirmation returned no row');
      return mapConfirmedRequirement(asRow(value));
    }
    const candidateResult = await this.from('requirement_candidates').select('*').eq('id', candidateId).maybeSingle();
    if (candidateResult.error) throw errorFor('requirement candidate lookup', candidateResult.error);
    if (!candidateResult.data) throw new Error('Requirement candidate not found');
    const candidate = mapRequirementCandidate(asRow(candidateResult.data));
    if (candidate.status === 'rejected') throw new Error('Rejected requirement candidate cannot be confirmed');
    if (candidate.status === 'confirmed' && candidate.confirmedRequirementId) {
      const existing = await this.from('requirements').select('*').eq('id', candidate.confirmedRequirementId).maybeSingle();
      if (existing.error) throw errorFor('confirmed requirement lookup', existing.error);
      if (existing.data) return mapConfirmedRequirement(asRow(existing.data));
    }
    const now = new Date().toISOString();
    const requirementResult = await this.from('requirements').upsert({
      project_id: candidate.projectId,
      candidate_id: candidate.id,
      title: candidate.title,
      description: candidate.statement,
      category: candidate.kind,
      priority: 'medium',
      source_locator: candidate.sourceLocator,
      source_version: candidate.sourceVersion,
      confidence: candidate.confidence,
      created_at: now,
      updated_at: now,
    }, { onConflict: 'candidate_id' }).select('*').single();
    if (requirementResult.error || !requirementResult.data) throw errorFor('confirmed requirement creation', requirementResult.error ?? new Error('no requirement returned'));
    const requirement = mapConfirmedRequirement(asRow(requirementResult.data));
    const candidateUpdate = await this.from('requirement_candidates').update({
      status: 'confirmed',
      confirmed_requirement_id: requirement.id,
      confirmed_by: actorId,
      confirmed_at: now,
      updated_at: now,
    }).eq('id', candidate.id).neq('status', 'rejected');
    if (candidateUpdate.error) throw errorFor('requirement candidate confirmation', candidateUpdate.error);
    return requirement;
  }

  async rejectRequirementCandidate(candidateId: string, actorId: string): Promise<RequirementCandidate> {
    const currentResult = await this.from('requirement_candidates').select('*').eq('id', candidateId).maybeSingle();
    if (currentResult.error) throw errorFor('requirement candidate lookup', currentResult.error);
    if (!currentResult.data) throw new Error('Requirement candidate not found');
    const current = mapRequirementCandidate(asRow(currentResult.data));
    if (current.status === 'confirmed') throw new Error('Confirmed requirement candidate cannot be rejected');
    if (current.status === 'rejected') return current;
    const result = await this.from('requirement_candidates').update({ status: 'rejected', rejected_by: actorId, updated_at: new Date().toISOString() })
      .eq('id', candidateId).eq('status', 'pending_confirmation').select('*').single();
    if (result.error || !result.data) throw errorFor('requirement candidate rejection', result.error ?? new Error('candidate changed concurrently'));
    return mapRequirementCandidate(asRow(result.data));
  }

  async saveStandardRules(input: {
    projectId: string;
    artifact: Artifact;
    label?: string;
    sourceVersion: string;
    standardVersion: string;
    rules: StandardRuleDraft[];
  }): Promise<StandardRule[]> {
    const code = `artifact:${input.artifact.id}`;
    const standardResult = await this.from('project_standards').upsert({
      project_id: input.projectId,
      code,
      title: input.label?.trim() || input.artifact.fileName,
      description: 'Structured rules parsed from a project coding-standard artifact.',
      source: 'artifact',
      version: input.standardVersion,
      metadata: { artifactId: input.artifact.id, sourceVersion: input.sourceVersion, contentHash: input.artifact.contentHash },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id,code' }).select('id').single();
    if (standardResult.error || !standardResult.data) throw errorFor('project standard save', standardResult.error ?? new Error('no standard returned'));
    const standardId = text(asRow(standardResult.data), 'id');
    if (!input.rules.length) return [];
    const stableKeys = input.rules.map(rule => rule.stableKey);
    const existingResult = await this.from('project_standard_rules').select('id,stable_key,standard_version,source_version,enabled,created_at')
      .eq('standard_id', standardId).in('stable_key', stableKeys).eq('standard_version', input.standardVersion).eq('source_version', input.sourceVersion);
    if (existingResult.error) throw errorFor('standard rule idempotency lookup', existingResult.error);
    const existing = new Map<string, Row>((existingResult.data ?? []).map((row: unknown) => {
      const item = asRow(row);
      return [`${text(item, 'stable_key')}|${text(item, 'standard_version')}|${text(item, 'source_version')}`, item] as const;
    }));
    const now = new Date().toISOString();
    const rows = input.rules.map(rule => {
      const previous = existing.get(`${rule.stableKey}|${input.standardVersion}|${input.sourceVersion}`);
      return {
        ...(previous ? { id: text(previous, 'id') } : {}),
        project_id: input.projectId,
        standard_id: standardId,
        stable_key: rule.stableKey,
        title: rule.title,
        statement: rule.statement,
        category: rule.category,
        severity: rule.severity,
        recommendation: rule.recommendation,
        source_artifact_id: rule.sourceArtifactId,
        source_locator: rule.sourceLocator,
        source_version: input.sourceVersion,
        standard_version: input.standardVersion,
        enabled: previous ? previous.enabled !== false : rule.enabled,
        created_at: previous ? text(previous, 'created_at') : now,
        updated_at: now,
      };
    });
    const result = await this.from('project_standard_rules').upsert(rows, { onConflict: 'standard_id,stable_key,standard_version,source_version' }).select('*');
    if (result.error) throw errorFor('standard rule save', result.error);
    return (result.data ?? []).map((row: unknown) => mapStandardRule(asRow(row)));
  }

  async listStandardRules(projectId: string, standardIds?: string[], signal?: AbortSignal): Promise<StandardRule[]> {
    const standards = await this.allRows('project_standards', 'project standards list', query => {
      const scoped = query.select('id,version,metadata').eq('project_id', projectId).order('id');
      return standardIds?.length ? scoped.in('id', standardIds) : scoped;
    }, signal);
    const currentVersion = new Map<string, { standardVersion: string; sourceVersion: string }>(standards.map((row: unknown) => {
      const item = asRow(row);
      const metadata = objectValue(item.metadata);
      return [text(item, 'id'), { standardVersion: text(item, 'version'), sourceVersion: text(metadata, 'sourceVersion') }] as const;
    }));
    if (!currentVersion.size) return [];
    const rules = await this.allRows('project_standard_rules', 'standard rules list', query =>
      query.select('*').eq('project_id', projectId).in('standard_id', [...currentVersion.keys()]).order('created_at').order('id'), signal);
    return rules.map((row: unknown) => mapStandardRule(asRow(row)))
      .filter((rule: StandardRule) => {
        const version = currentVersion.get(rule.standardId);
        return !!version && version.standardVersion === rule.standardVersion && version.sourceVersion === rule.sourceVersion;
      });
  }

  async setStandardRuleEnabled(ruleId: string, enabled: boolean): Promise<StandardRule> {
    const result = await this.from('project_standard_rules').update({ enabled, updated_at: new Date().toISOString() })
      .eq('id', ruleId).select('*').maybeSingle();
    if (result.error) throw errorFor('standard rule enabled-state update', result.error);
    if (!result.data) throw new Error('Standard rule not found');
    return mapStandardRule(asRow(result.data));
  }

  async listConfirmedRequirements(projectId: string, requirementIds?: string[], signal?: AbortSignal): Promise<ConfirmedRequirement[]> {
    const rows = await this.allRows('requirements', 'confirmed requirements list', query => {
      const scoped = query.select('*').eq('project_id', projectId).order('created_at').order('id');
      return requirementIds?.length ? scoped.in('id', requirementIds) : scoped;
    }, signal);
    return rows.map(row => mapConfirmedRequirement(row));
  }

  async saveFinding(finding: PersistedReviewFinding): Promise<void> {
    const existing = finding.fingerprint
      ? await this.from('findings').select('id').eq('review_session_id', finding.reviewId).eq('correlation_fingerprint', finding.fingerprint).maybeSingle()
      : { data: null, error: null };
    if (existing.error) throw errorFor('finding idempotency lookup', existing.error);
    const row: Row = {
      id: existing.data ? String((existing.data as Row).id) : finding.id,
      project_id: finding.projectId,
      review_session_id: finding.reviewId,
      source: 'static',
      severity: finding.severity,
      priority: finding.priority ?? null,
      title: finding.title,
      description: finding.description,
      status: 'new',
      category: finding.category,
      evidence_text: finding.evidence,
      recommendation: finding.recommendation,
      confidence: finding.confidence,
      artifact_id: finding.artifactId ?? null,
      requirement_id: finding.requirementId ?? null,
      standard_id: finding.standardId ?? null,
      standard_rule_id: finding.standardRuleId ?? null,
      verifier: finding.source,
      rule_id: finding.ruleId ?? null,
      stable_finding_id: finding.stableFindingId ?? null,
      source_identity: finding.sourceIdentity ?? null,
      source_version: finding.sourceVersion ?? null,
      source_locator: finding.sourceLocator ?? {},
      location: {
        filePath: finding.filePath,
        lineNumber: finding.lineNumber,
        ruleId: finding.ruleId ?? null,
        sourceIdentity: finding.sourceIdentity ?? null,
        sourceVersion: finding.sourceVersion ?? null,
        sourceLocator: finding.sourceLocator ?? null,
      },
      correlation_fingerprint: finding.fingerprint ?? null,
      created_at: finding.createdAt,
      updated_at: finding.createdAt,
    };
    const result = await this.from('findings').upsert(row).select('*').single();
    if (result.error) throw errorFor('finding save', result.error);
  }

  async updateProgress(reviewId: string, progress: ReviewProgressState): Promise<void> {
    const review = await this.getReview(reviewId);
    if (!review) throw new Error(`Review ${reviewId} was not found.`);
    const event = await this.from('review_progress_events').insert({ project_id: review.projectId, review_session_id: reviewId, stage: progress.stage, status: progress.stage === 'complete' ? 'completed' : 'running', message: progress.message ?? '', created_at: progress.updatedAt });
    if (event.error) throw errorFor('review progress event', event.error);
    const update = await this.from('review_sessions').update({ progress, updated_at: progress.updatedAt }).eq('id', reviewId);
    if (update.error && !isMissingRevisionError(update.error)) throw errorFor('review progress', update.error);
  }

  async recordModelAttempt(attempt: ModelAttemptRecord): Promise<void> {
    const record = toModelUsageRecord(attempt);
    const result = await this.from('model_usage_records').upsert({
      id: record.id,
      project_id: record.projectId,
      review_session_id: record.reviewId,
      owner_id: this.actorId ?? null,
      stage: record.stage,
      attempt: record.attempt,
      provider: record.provider,
      model: record.model,
      outcome: record.outcome,
      input_tokens: record.usage?.inputTokens ?? null,
      output_tokens: record.usage?.outputTokens ?? null,
      cache_read_tokens: record.usage?.cacheReadTokens ?? null,
      cache_creation_tokens: record.usage?.cacheCreationTokens ?? null,
      duration_ms: record.durationMs,
      error_code: record.errorCode ?? null,
      metadata: {
        apiFormat: record.apiFormat,
        callKind: 'review',
        scope: 'text',
        statusCode: record.statusCode ?? null,
        retryAfterMs: record.retryAfterMs ?? null,
      },
      created_at: record.createdAt,
    }, { onConflict: 'id' });
    if (result.error) throw errorFor('model attempt save', result.error);
  }

  async getModelAttemptCount(reviewId: string, stage: string): Promise<number> {
    const result = await this.from('model_usage_records').select('attempt')
      .eq('review_session_id', reviewId).eq('stage', stage);
    if (result.error) throw errorFor('model attempt high-water lookup', result.error);
    return (result.data ?? []).reduce((maximum: number, row: unknown) =>
      Math.max(maximum, Math.floor(Number(asRow(row).attempt ?? 0))), 0);
  }

  async recordAudit(event: ReviewAuditEvent): Promise<void> {
    const result = await this.from('audit_events').insert({ id: event.id, project_id: event.projectId, event_type: event.event, entity_type: 'review', entity_id: event.reviewId, payload: { stage: event.stage ?? null, detail: event.detail ?? {} }, created_at: event.createdAt });
    if (result.error) throw errorFor('review audit save', result.error);
  }
}

export default SupabaseStaticReviewRepository;
