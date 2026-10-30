import crypto from 'node:crypto';
import { analysisMapFromEvents } from './assessmentBatches.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artifact } from '../artifacts.js';
import type {
  FrozenReviewGrounding,
  ReviewTraceabilityMapping,
  ReviewTraceabilityMetadata,
  ReviewTraceabilityRecord,
  ReviewTraceabilitySnapshot,
  TraceabilityEvidenceStatus,
} from './evidenceTypes.js';
import { summarizeTraceability } from './traceabilitySummary.js';
import { mergeEvidenceSufficiencyAssessments, type EvidenceSufficiencyAssessment, type EvidenceContradictionDisposition } from './evidenceSufficiency.js';
import type { FindingCorrelation, FindingCorrelationSnapshot, CorrelationAmbiguity, FindingResolutionEligibility } from './correlation.js';
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
  CaptureReviewTraceabilityInput,
  StaticReviewPatch,
  StaticReviewRecord,
  StaticReviewRepository,
  StaticReviewScope,
  StaticReviewStatus,
  StaticReviewDecision,
  StaticReviewIteration,
} from './types.js';
import { toModelUsageRecord } from './usageAudit.js';
import { runExternalOperation, type ExternalRetryScheduledEvent } from './retry.js';

type Row = Record<string, unknown>;
type Query = any;
type ReviewRetryContext = { reviewId: string; projectId: string };

function stableUuid(value: string): string {
  const hex = crypto.createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const formatted = hex.join('');
  return `${formatted.slice(0, 8)}-${formatted.slice(8, 12)}-${formatted.slice(12, 16)}-${formatted.slice(16, 20)}-${formatted.slice(20)}`;
}

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

function mapTraceabilitySnapshot(row: Row, reviewId = text(row, 'review_session_id'), projectId = text(row, 'project_id')): ReviewTraceabilitySnapshot {
  const rawSummary = objectValue(row.summary);
  const snapshotVersion = Number(rawSummary.snapshotVersion);
  const inclusionBasis = rawSummary.inclusionBasis && typeof rawSummary.inclusionBasis === 'object'
    ? structuredClone(rawSummary.inclusionBasis) as ReviewTraceabilityMetadata['inclusionBasis']
    : null;
  const grounding = rawSummary.grounding && typeof rawSummary.grounding === 'object'
    ? structuredClone(rawSummary.grounding) as FrozenReviewGrounding
    : null;
  const metadata: ReviewTraceabilityMetadata | null = snapshotVersion === 2
    ? {
      snapshotVersion: 2,
      sourceManifestId: nullableText(rawSummary, 'sourceManifestId'),
      inclusionBasis,
      grounding,
      unavailableReason: nullableText(rawSummary, 'unavailableReason'),
    }
    : null;
  const records = Array.isArray(row.records) ? structuredClone(row.records) as ReviewTraceabilityRecord[] : [];
  const summaryValues = { ...rawSummary };
  for (const key of ['snapshotVersion', 'sourceManifestId', 'inclusionBasis', 'grounding', 'unavailableReason']) delete summaryValues[key];
  const summary = row.summary && typeof row.summary === 'object' && !Array.isArray(row.summary)
    ? summaryValues as unknown as ReviewTraceabilitySnapshot['summary']
    : null;
  return {
    sessionId: reviewId,
    projectId,
    status: text(row, 'status', 'unavailable') as ReviewTraceabilitySnapshot['status'],
    records,
    summary,
    capturedAt: text(row, 'created_at'),
    updatedAt: text(row, 'created_at'),
    metadata,
  };
}

function normalizedHash(value: string | null): string | null {
  if (!value) return null;
  return value.trim().replace(/^sha256:/i, '').toLowerCase();
}

function nonEmptyText(row: Row, keys: string[]): string | null {
  for (const key of keys) {
    const value = nullableText(row, key);
    if (value) return value;
  }
  return null;
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
  const domain = ['security', 'business', 'technical', 'personnel'].includes(String(location.domain))
    ? location.domain as PersistedReviewFinding['domain'] : undefined;
  const issueType = typeof location.issueType === 'string' && /^[a-z][a-z0-9_]{1,79}$/.test(location.issueType) ? location.issueType : undefined;
  const logicFlow = Array.isArray(location.logicFlow) && location.logicFlow.length <= 10
    && location.logicFlow.every(item => typeof item === 'string' && item.trim() && item.length <= 500)
    ? [...location.logicFlow] as string[] : undefined;
  const relatedLocations = Array.isArray(location.relatedLocations) && location.relatedLocations.length <= 16
    && location.relatedLocations.every(item => item && typeof item === 'object' && !Array.isArray(item)
      && typeof item.filePath === 'string' && item.filePath.trim() && Number.isSafeInteger(item.lineNumber) && item.lineNumber > 0
      && typeof item.evidence === 'string' && item.evidence.trim()
      && (item.artifactId == null || typeof item.artifactId === 'string') && (item.sourceVersion == null || typeof item.sourceVersion === 'string'))
    ? location.relatedLocations.map(item => ({ filePath: item.filePath, lineNumber: item.lineNumber, evidence: item.evidence,
      ...(Object.hasOwn(item, 'artifactId') ? { artifactId: item.artifactId } : {}),
      ...(Object.hasOwn(item, 'sourceVersion') ? { sourceVersion: item.sourceVersion } : {}),
    })) as PersistedReviewFinding['relatedLocations'] : undefined;
  const source = text(row, 'verifier') === 'deterministic' ? 'deterministic' : 'model';
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    reviewId: text(row, 'review_session_id'),
    source,
    ...(domain ? { domain } : {}),
    ...(issueType ? { issueType } : {}),
    ...(logicFlow ? { logicFlow } : {}),
    ...(relatedLocations ? { relatedLocations } : {}),
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

function mapResolutionEligibility(value: unknown): FindingResolutionEligibility | undefined {
  const row = objectValue(value);
  if ((row.version !== 1 && row.version !== 2) || row.basis !== 'not_reproduced_in_comparable_review') return undefined;
  const parentSourceManifestId = typeof row.parentSourceManifestId === 'string' ? row.parentSourceManifestId : '';
  const sourceManifestId = typeof row.sourceManifestId === 'string' ? row.sourceManifestId : '';
  const reviewedArtifactId = typeof row.reviewedArtifactId === 'string' ? row.reviewedArtifactId : '';
  const parentArtifactId = typeof row.parentArtifactId === 'string' ? row.parentArtifactId : '';
  const sourceIdentityHash = typeof row.sourceIdentityHash === 'string' ? row.sourceIdentityHash : '';
  const parentSourceVersion = typeof row.parentSourceVersion === 'string' ? row.parentSourceVersion : '';
  const reviewedSourceVersion = typeof row.reviewedSourceVersion === 'string' ? row.reviewedSourceVersion : '';
  const location = objectValue(row.locationBasis);
  if (!parentSourceManifestId || !sourceManifestId || !reviewedArtifactId || !parentArtifactId || !sourceIdentityHash || !parentSourceVersion || !reviewedSourceVersion) return undefined;
  return {
    version: row.version,
    ...(row.version === 2 && typeof row.assessmentValidationVersion === 'string'
      ? { assessmentValidationVersion: row.assessmentValidationVersion }
      : {}),
    ...(row.version === 2 && location.kind === 'exact_assessed_reference' && typeof location.filePath === 'string' && typeof location.lineNumber === 'number'
      && Number.isInteger(location.lineNumber) && location.lineNumber > 0 && typeof location.sourceVersion === 'string' && typeof location.featureId === 'string' && typeof location.domain === 'string'
      ? { locationBasis: { kind: 'exact_assessed_reference' as const, filePath: location.filePath, lineNumber: location.lineNumber, sourceVersion: location.sourceVersion, featureId: location.featureId, domain: location.domain } } : {}),
    basis: 'not_reproduced_in_comparable_review',
    parentSourceManifestId,
    sourceManifestId,
    reviewedArtifactId,
    parentArtifactId,
    sourceIdentityHash,
    parentSourceVersion,
    reviewedSourceVersion,
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
  private readonly reviewRetryContext = new AsyncLocalStorage<ReviewRetryContext>();

  constructor(
    private readonly client: SupabaseClient,
    private readonly actorId?: string,
    private readonly retryRuntime: { sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>; now?: () => Date } = {},
  ) {}

  withReviewRetryContext<T>(context: ReviewRetryContext, operation: () => Promise<T>): Promise<T> {
    return this.reviewRetryContext.run(context, operation);
  }

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
      const result = await this.externalRequest(label, requestSignal => {
        let query = configure(this.from(table)).range(start, start + pageSize - 1);
        if (requestSignal) query = query.abortSignal(requestSignal);
        return query;
      }, signal);
      signal?.throwIfAborted();
      const page = Array.isArray(result.data) ? result.data.map(asRow) : [];
      if (!page.length) return rows;
      rows.push(...page);
      start += page.length;
    }
  }

  private async externalRequest<T>(
    operation: string,
    build: (signal?: AbortSignal) => PromiseLike<{ data?: unknown; error?: unknown }>,
    signal?: AbortSignal,
    explicitContext?: ReviewRetryContext,
  ): Promise<{ data?: unknown; error?: unknown }> {
    const context = explicitContext ?? this.reviewRetryContext.getStore();
    try {
      return await runExternalOperation(async (_attempt, requestSignal) => {
        const result = await build(requestSignal ?? signal);
        if (result?.error) throw result.error;
        return result;
      }, {
        service: 'Supabase',
        operation,
        signal,
        maxAttempts: 3,
        sleep: this.retryRuntime.sleep,
        now: this.retryRuntime.now,
        onRetry: context ? event => this.persistRetryEvent(context, event) : undefined,
      });
    } catch (error) {
      throw errorFor(operation, error);
    }
  }

  private async persistRetryEvent(context: ReviewRetryContext, retry: ExternalRetryScheduledEvent): Promise<void> {
    const detail = {
      kind: 'external',
      service: retry.service,
      operation: retry.operation,
      attempt: retry.attempt,
      maxAttempts: retry.maxAttempts,
      delayMs: retry.delayMs,
      nextAttemptAt: retry.nextAttemptAt,
      errorCode: retry.errorCode,
    };
    const row = {
      id: stableUuid(`${context.reviewId}\u0000review_retry_scheduled\u0000${retry.service}\u0000${retry.operation}\u0000${retry.attempt}`),
      project_id: context.projectId,
      actor_id: this.actorId ?? null,
      event_type: 'review_retry_scheduled',
      entity_type: 'review',
      entity_id: context.reviewId,
      idempotency_key: null,
      payload: { stage: retry.operation, detail },
      created_at: this.retryRuntime.now?.().toISOString() ?? new Date().toISOString(),
    };
    // This safe upsert is intentionally not wrapped by `externalRequest`: a
    // failed retry-status write must stop the underlying request retry, not
    // recursively emit another retry event.
    const result = await this.from('audit_events').upsert(row, { onConflict: 'id' });
    if (result.error) throw errorFor('retry schedule audit', result.error);
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
      // The schema stores absent root-review metadata as a non-null empty
      // JSON object; an explicit SQL NULL bypasses the column default.
      iteration: input.iteration ?? {},
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
    let result: { data?: unknown; error?: unknown };
    try {
      result = await this.externalRequest('review creation', () => this.from('review_sessions').upsert(row, { onConflict: 'id' }).select('*').single(), undefined, { reviewId: id, projectId: input.projectId });
    } catch (error) {
      // A concurrent duplicate Start is expected to lose the unique-key race
      // and return the already-created immutable Review.
      if (input.idempotencyKey) {
        const existing = await this.findReviewByIdempotencyKey(input.projectId, input.idempotencyKey);
        if (existing) return existing;
      }
      throw error;
    }
    return mapReview(asRow(result.data));
  }

  async getReview(reviewId: string): Promise<StaticReviewRecord | null> {
    const result = await this.externalRequest('review lookup', () => this.from('review_sessions').select('*').eq('id', reviewId).maybeSingle());
    return result.data ? mapReview(asRow(result.data)) : null;
  }

  /** Bearer/RLS scoped, paginated audit history. No prompt or provider secrets. */
  async getHarnessEvents(projectId: string, reviewId: string): Promise<ReviewAuditEvent[]> {
    const rows = await this.allRows('audit_events', 'review harness events', query => query
      .select('id, project_id, entity_id, event_type, payload, created_at')
      .eq('project_id', projectId).eq('entity_type', 'review').eq('entity_id', reviewId)
      .order('created_at', { ascending: true }).order('id', { ascending: true }));
    return rows.filter(row => text(row, 'event_type').startsWith('harness_step_')
      || text(row, 'event_type') === 'model_attempt'
      || text(row, 'event_type') === 'review_analysis_map_saved'
      || text(row, 'event_type') === 'review_analysis_batch_saved'
      || text(row, 'event_type') === 'review_analysis_batch_unverified'
      || text(row, 'event_type') === 'review_assessment_validated'
      || text(row, 'event_type') === 'review_retry_scheduled'
      || text(row, 'event_type') === 'review_assessment_rejected'
      || text(row, 'event_type') === 'review_assessment_repair_scheduled'
      || text(row, 'event_type') === 'review_candidate_support_scheduled'
      || text(row, 'event_type') === 'review_candidate_support_incomplete'
      || text(row, 'event_type') === 'review_candidate_support_saved'
      || text(row, 'event_type') === 'review_candidate_support_limited'
      || text(row, 'event_type') === 'review_candidate_support_conflict'
      || text(row, 'event_type') === 'review_batch_needs_verification'
      || text(row, 'event_type') === 'review_batch_cache_reused'
      || text(row, 'event_type') === 'review_batch_cache_rejected'
      || text(row, 'event_type') === 'review_source_batches_finished'
      || text(row, 'event_type') === 'review_batches_planned')
      .map(row => {
        const payload = objectValue(row.payload);
        return { id: text(row, 'id'), projectId, reviewId, event: text(row, 'event_type'), stage: typeof payload.stage === 'string' ? payload.stage : undefined, detail: objectValue(payload.detail), createdAt: text(row, 'created_at') };
      });
  }

  async listReviews(projectId: string): Promise<StaticReviewRecord[]> {
    const rows = await this.allRows('review_sessions', 'review list', query => query.select('*')
      .eq('project_id', projectId).order('created_at', { ascending: false }).order('id'));
    return rows.map(mapReview);
  }

  /** Directory rows need identity/lifecycle only; never fetch scope, prompts,
   * saved summaries, or the potentially large progress history for every Review. */
  async listReviewSummaries(projectId: string): Promise<StaticReviewRecord[]> {
    const rows = await this.allRows('review_sessions', 'review summary list', query => query
      .select('id,project_id,name,review_type,status,failure_reason,created_at,updated_at,model_status,parent_review_id,lineage_parent:lineage->>parentReviewId,progress_stage:progress->>stage')
      .eq('project_id', projectId).order('created_at', { ascending: false }).order('id'));
    // Lineage lets directories treat a failed Review as superseded by its retry.
    return rows.map(row => mapReview({
      id: row.id, project_id: row.project_id, name: row.name, review_type: row.review_type,
      status: row.status, failure_reason: row.failure_reason, created_at: row.created_at, updated_at: row.updated_at,
      model_status: row.model_status, parent_review_id: row.parent_review_id,
      lineage: row.lineage_parent ? { parentReviewId: row.lineage_parent } : {},
      progress: row.progress_stage ? { stage: row.progress_stage } : null,
    }));
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

  async captureTraceabilitySnapshot(reviewId: string, projectId: string, input: CaptureReviewTraceabilityInput): Promise<ReviewTraceabilitySnapshot> {
    const existing = await this.from('review_traceability_snapshots').select('*').eq('review_session_id', reviewId).maybeSingle();
    if (existing.error) throw errorFor('traceability snapshot lookup', existing.error);
    if (existing.data) return mapTraceabilitySnapshot(asRow(existing.data), reviewId, projectId);

    const capturedAt = new Date().toISOString();
    const signal = input.signal;
    let snapshot: ReviewTraceabilitySnapshot;
    if (input.reuseFromReviewId) {
      const inherited = await this.getTraceabilitySnapshot(input.reuseFromReviewId);
      if (inherited?.metadata?.snapshotVersion === 2) {
        snapshot = { ...structuredClone(inherited), sessionId: reviewId, projectId };
      } else {
        snapshot = {
          sessionId: reviewId, projectId, status: 'unavailable', records: [],
          summary: { complete: 0, incomplete: 0, missing: 0, attention: 0, unavailable: 0 },
          capturedAt, updatedAt: capturedAt,
          metadata: {
            snapshotVersion: 2,
            sourceManifestId: input.sourceManifestId,
            inclusionBasis: null,
            grounding: null,
            unavailableReason: inherited ? 'legacy_parent_context_unavailable' : 'frozen_parent_context_unavailable',
          },
        };
      }
      await this.insertTraceabilitySnapshot(snapshot);
      return structuredClone(snapshot);
    }

    const requirements = input.grounding?.confirmedRequirements
      ?? await this.listConfirmedRequirements(projectId, input.scope.requirementIds, signal);
    const enabledStandardRules = input.grounding?.enabledStandardRules
      ?? (await this.listStandardRules(projectId, input.scope.standardIds, signal)).filter(rule => rule.enabled);
    const selectedRequirementSet = input.scope.requirementIds?.length ? new Set(input.scope.requirementIds) : null;
    const selectedRequirements = requirements.filter(item => !selectedRequirementSet || selectedRequirementSet.has(item.id));
    const requirementsById = new Map(selectedRequirements.map(item => [item.id, item]));
    const explicitRequirementIds = input.scope.requirementIds?.length ? [...input.scope.requirementIds] : null;
    const selectedRequirementIds = explicitRequirementIds ?? selectedRequirements.map(item => item.id);
    const explicitArtifactIds = input.scope.artifactIds?.length ? [...input.scope.artifactIds] : null;
    const selectedArtifactIds = explicitArtifactIds ?? input.artifacts.map(item => item.id);
    const artifactsById = new Map(input.artifacts.map(item => [item.id, item]));
    const unavailableArtifactIds = new Set(input.unavailableArtifactIds ?? []);
    const records: ReviewTraceabilityRecord[] = [];

    for (const requirementId of selectedRequirementIds) {
      signal?.throwIfAborted();
      const requirement = requirementsById.get(requirementId);
      if (!requirement) {
        records.push({
          requirementId, title: '', description: '', category: '', state: 'incomplete',
          mappingIds: [], sourceArtifactIds: [], sourceSymbolIds: [], confidence: null,
          capturedAt, evidenceStatus: 'unavailable', evidenceReason: 'selected_requirement_unavailable_at_capture', mappings: [],
        });
        continue;
      }

      const rows = await this.allRows('requirement_mappings', 'traceability mappings query', query =>
        query.select('*').eq('requirement_id', requirement.id).order('id'), signal);
      const mappings: ReviewTraceabilityMapping[] = [];
      for (const row of rows) {
        const artifactId = nullableText(row, 'artifact_id');
        const fileId = nullableText(row, 'file_id');
        const targetArtifactId = artifactId ?? fileId;
        // An explicit artifact scope excludes known mappings to other files.
        if (explicitArtifactIds && targetArtifactId && !explicitArtifactIds.includes(targetArtifactId)) continue;
        const targetConflict = Boolean(artifactId && fileId && artifactId !== fileId);
        const target = targetArtifactId ? artifactsById.get(targetArtifactId) : undefined;
        const mappingVersionId = nonEmptyText(row, ['artifact_version_id', 'mapped_version_id']);
        const mappingContentHash = nonEmptyText(row, ['source_version', 'content_hash']);
        let evidenceStatus: TraceabilityEvidenceStatus = 'unavailable';
        let evidenceReason: string | null = null;
        if (targetConflict) evidenceReason = 'mapping_target_identity_conflict';
        else if (!targetArtifactId) evidenceReason = 'mapping_target_missing';
        else if (!target) evidenceReason = 'target_not_in_reviewed_scope';
        else if (unavailableArtifactIds.has(target.id)) evidenceReason = 'reviewed_target_unreadable';
        else if (!target.versionId && !target.contentHash) evidenceReason = 'reviewed_target_version_missing';
        else if (!mappingVersionId && !mappingContentHash) evidenceReason = 'mapping_version_proof_missing';
        else {
          const versionMatches = !mappingVersionId || (target.versionId != null && mappingVersionId === target.versionId);
          const hashMatches = !mappingContentHash || normalizedHash(mappingContentHash) === normalizedHash(target.contentHash);
          if (!versionMatches || !hashMatches) {
            evidenceStatus = 'stale';
            evidenceReason = 'mapping_version_does_not_match_reviewed_source';
          } else {
            evidenceStatus = 'verified';
          }
        }
        mappings.push({
          id: text(row, 'id'),
          targetArtifactId,
          targetSymbolId: nullableText(row, 'symbol_id'),
          coverageStatus: text(row, 'coverage_status', 'unknown').trim().toLowerCase(),
          confidence: row.confidence == null ? null : Number(row.confidence),
          mappingVersionId,
          mappingContentHash,
          reviewedVersionId: target?.versionId ?? null,
          reviewedContentHash: target?.contentHash ?? null,
          evidenceStatus,
          evidenceReason,
        });
      }
      const complete = mappings.length > 0 && mappings.every(item => item.evidenceStatus === 'verified'
        && /^(complete|covered|verified|full|pass|passed|fully[_ -]?covered)$/.test(item.coverageStatus));
      const state: ReviewTraceabilityRecord['state'] = mappings.length === 0 ? 'missing' : complete ? 'complete' : 'incomplete';
      const confidenceValues = mappings.map(item => item.confidence).filter((value): value is number => value !== null && Number.isFinite(value));
      const unavailable = mappings.find(item => item.evidenceStatus !== 'verified');
      records.push({
        requirementId: requirement.id,
        title: requirement.title,
        description: requirement.description,
        category: requirement.category,
        state,
        mappingIds: mappings.map(item => item.id),
        sourceArtifactIds: Array.from(new Set(mappings.flatMap(item => item.targetArtifactId ? [item.targetArtifactId] : []))),
        sourceSymbolIds: Array.from(new Set(mappings.flatMap(item => item.targetSymbolId ? [item.targetSymbolId] : []))),
        confidence: confidenceValues.length ? Math.min(...confidenceValues) : null,
        capturedAt,
        ...(unavailable ? { evidenceStatus: unavailable.evidenceStatus, evidenceReason: unavailable.evidenceReason } : { evidenceStatus: 'verified' as const }),
        mappings,
      });
    }

    const summary = summarizeTraceability(records);
    summary.unavailable = records.filter(item => item.evidenceStatus === 'stale' || item.evidenceStatus === 'unavailable').length;
    const metadata: ReviewTraceabilityMetadata = {
      snapshotVersion: 2,
      sourceManifestId: input.sourceManifestId,
      inclusionBasis: {
        requirementSelection: explicitRequirementIds ? 'explicit' : 'project',
        artifactSelection: explicitArtifactIds ? 'explicit' : 'full_manifest',
        selectedRequirementIds,
        selectedArtifactIds,
        sourceManifestId: input.sourceManifestId,
      },
      grounding: structuredClone({ confirmedRequirements: selectedRequirements, enabledStandardRules }),
      unavailableReason: null,
    };
    snapshot = { sessionId: reviewId, projectId, status: 'available', records, summary, capturedAt, updatedAt: capturedAt, metadata };
    await this.insertTraceabilitySnapshot(snapshot);
    return structuredClone(snapshot);
  }

  async getTraceabilitySnapshot(reviewId: string): Promise<ReviewTraceabilitySnapshot | null> {
    const result = await this.from('review_traceability_snapshots').select('*').eq('review_session_id', reviewId).maybeSingle();
    if (result.error) throw errorFor('traceability snapshot lookup', result.error);
    return result.data ? mapTraceabilitySnapshot(asRow(result.data), reviewId) : null;
  }

  private async insertTraceabilitySnapshot(snapshot: ReviewTraceabilitySnapshot): Promise<void> {
    const summary = {
      ...(snapshot.summary ?? { complete: 0, incomplete: 0, missing: 0, attention: 0 }),
      ...(snapshot.metadata ?? {}),
    };
    const result = await this.from('review_traceability_snapshots').insert({
      project_id: snapshot.projectId,
      review_session_id: snapshot.sessionId,
      status: snapshot.status,
      records: snapshot.records,
      summary,
      created_at: snapshot.capturedAt,
    });
    if (result.error) throw errorFor('traceability snapshot save', result.error);
  }

  async saveTraceabilitySnapshot(reviewId: string, projectId: string): Promise<void> {
    const existing = await this.from('review_traceability_snapshots').select('id').eq('review_session_id', reviewId).maybeSingle();
    if (existing.error) throw errorFor('traceability snapshot lookup', existing.error);
    if (existing.data) return;
    const capturedAt = new Date().toISOString();
    await this.insertTraceabilitySnapshot({
      sessionId: reviewId,
      projectId,
      status: 'unavailable',
      records: [],
      summary: { complete: 0, incomplete: 0, missing: 0, attention: 0, unavailable: 0 },
      capturedAt,
      updatedAt: capturedAt,
      metadata: { snapshotVersion: 2, sourceManifestId: null, inclusionBasis: null, grounding: null, unavailableReason: 'frozen_context_not_provided' },
    });
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

  async appendEvidenceSufficiency(assessment: EvidenceSufficiencyAssessment): Promise<EvidenceSufficiencyAssessment> {
    const review = await this.getReview(assessment.reviewId);
    if (review?.status !== 'running') throw new Error('Evidence sufficiency is immutable after Review execution ends.');
    const frozen = await this.getEvidenceSufficiency(assessment.reviewId);
    if (!frozen) throw new Error('The frozen evidence sufficiency assessment is unavailable.');
    const merged = mergeEvidenceSufficiencyAssessments(frozen, assessment);
    const result = await this.from('review_evidence_assessments').update({
      id: merged.id,
      readiness: merged.readiness,
      assessment: merged,
      created_at: merged.assessedAt,
    }).eq('review_session_id', assessment.reviewId).select('review_session_id').maybeSingle();
    if (result.error || !result.data) throw errorFor('evidence sufficiency append', result.error ?? new Error('assessment changed concurrently'));
    return merged;
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
        detail: { explanation: item.detail ?? null, resolutionEligibility: item.resolutionEligibility ?? null },
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
      const resolutionEligibility = mapResolutionEligibility(detail.resolutionEligibility);
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
        ...(resolutionEligibility ? { resolutionEligibility } : {}),
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
  async getBatchCacheBasis(reviewId: string) {
    const review = await this.getReview(reviewId);
    if (!review || !['blocked', 'failed', 'cancelled', 'pending_approval', 'completed', 'approved', 'changes_requested'].includes(review.status)) return null;
    const analysisMap = analysisMapFromEvents(await this.getHarnessEvents(review.projectId, reviewId));
    return analysisMap ? { reviewId, projectId: review.projectId, analysisMap, findings: await this.listReviewFindings(reviewId) } : null;
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
    const uncertain = (locator: unknown) => objectValue(objectValue(locator).citationEvidence).verification === 'needs_verification';
    const existing = finding.fingerprint
      ? await this.allRows('findings', 'finding idempotency lookup', query => query.select('id,verifier,source_locator')
        .eq('project_id', finding.projectId).eq('review_session_id', finding.reviewId)
        .eq('correlation_fingerprint', finding.fingerprint).eq('verifier', finding.source).order('id'))
      : [];
    // Preserve the stable correlation fingerprint, while keeping independent
    // verifier/uncertainty observations from overwriting each other's evidence.
    const existingObservations = existing.filter(row =>
      row.verifier === finding.source && uncertain(row.source_locator) === uncertain(finding.sourceLocator));
    if (existingObservations.length > 1) throw new Error('Finding observation identity is ambiguous; saved evidence was not overwritten.');
    const existingObservation = existingObservations[0];
    const row: Row = {
      id: existingObservation ? String(existingObservation.id) : finding.id,
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
        domain: finding.domain ?? null,
        issueType: finding.issueType ?? null,
        logicFlow: finding.logicFlow ?? [],
        relatedLocations: finding.relatedLocations ?? [],
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
    const eventId = stableUuid(`${reviewId}\u0000review_progress\u0000${progress.stage}\u0000${progress.updatedAt}`);
    await this.externalRequest('review progress event', () => this.from('review_progress_events').upsert({ id: eventId, project_id: review.projectId, review_session_id: reviewId, stage: progress.stage, status: progress.stage === 'complete' ? 'completed' : 'running', message: progress.message ?? '', created_at: progress.updatedAt }, { onConflict: 'id' }));
    try {
      await this.externalRequest('review progress', () => this.from('review_sessions').update({ progress, updated_at: progress.updatedAt }).eq('id', reviewId));
    } catch (error) {
      if (!isMissingRevisionError(error)) throw error;
    }
  }

  async recordModelAttempt(attempt: ModelAttemptRecord): Promise<void> {
    const record = toModelUsageRecord(attempt);
    await this.externalRequest('model attempt save', () => this.from('model_usage_records').upsert({
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
        providerReportedTotalTokens: record.usage?.providerReportedTotalTokens ?? null,
        normalizedTotalTokens: record.usage?.totalTokens ?? null,
        normalizedTotalTokensSource: record.usage?.totalTokensSource ?? null,
        responseReceived: record.responseReceived ?? null,
        usageObservation: record.usageObservation ?? record.usage?.usageObservation ?? null,
        usageAccounting: record.usageAccounting ?? null,
        usageContext: record.usageContext ?? null,
      },
      created_at: record.createdAt,
    }, { onConflict: 'id' }));
  }

  async getModelAttemptCount(reviewId: string, stage: string): Promise<number> {
    const result = await this.externalRequest('model attempt high-water lookup', () => this.from('model_usage_records').select('attempt')
      .eq('review_session_id', reviewId).eq('stage', stage));
    return (Array.isArray(result.data) ? result.data : []).reduce((maximum: number, row: unknown) =>
      Math.max(maximum, Math.floor(Number(asRow(row).attempt ?? 0))), 0);
  }

  async recordAudit(event: ReviewAuditEvent): Promise<void> {
    await this.recordAudits([event]);
  }

  async recordAudits(events: ReviewAuditEvent[]): Promise<void> {
    if (events.length > 256) throw new Error('Review audit write exceeds its bounded batch.');
    if (!events.length) return;
    const rows = events.map(event => ({ id: event.id ?? stableUuid(`${event.reviewId}\u0000${event.event}\u0000${event.stage ?? ''}\u0000${event.createdAt}\u0000${JSON.stringify(event.detail ?? {})}`), project_id: event.projectId, actor_id: this.actorId ?? null, event_type: event.event, entity_type: 'review', entity_id: event.reviewId, payload: { stage: event.stage ?? null, detail: event.detail ?? {} }, created_at: event.createdAt }));
    await this.externalRequest('review audit save', () => this.from('audit_events').upsert(rows, { onConflict: 'id' }));
  }
}

export default SupabaseStaticReviewRepository;
