import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artifact } from '../../src/artifacts.js';
import { SupabaseStaticReviewRepository } from '../../src/review/supabaseRepository.js';
import type { NewStaticReview, PersistedReviewFinding } from '../../src/review/types.js';
import type { EvidenceSufficiencyAssessment } from '../../src/review/evidenceSufficiency.js';
import { withEvidenceSufficiencyGap } from '../../src/review/evidenceSufficiency.js';
import type { FindingCorrelationSnapshot } from '../../src/review/correlation.js';
import { candidateSemanticKey } from '../../src/review/assessmentValidation.js';

type Row = Record<string, any>;

class FakeQuery implements PromiseLike<any> {
  private filters: Array<[string, string, any]> = [];
  private orderBy: string[] = [];
  private maxRows: number | undefined;
  private offsetRange: [number, number] | null = null;
  private conflictFields: string[] = [];
  private ignoreDuplicates = false;
  private signal?: AbortSignal;
  constructor(private readonly db: FakeDb, private readonly table: string, private readonly operation: 'select' | 'insert' | 'update' | 'upsert' = 'select', private readonly payload?: any) {}
  insert(payload: any) { return new FakeQuery(this.db, this.table, 'insert', payload); }
  update(payload: any) { return new FakeQuery(this.db, this.table, 'update', payload); }
  upsert(payload: any, options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    const query = new FakeQuery(this.db, this.table, 'upsert', payload);
    query.conflictFields = options?.onConflict?.split(',') ?? [];
    query.ignoreDuplicates = options?.ignoreDuplicates === true;
    return query;
  }
  select(_columns?: string) { return this; }
  eq(key: string, value: any) { this.filters.push(['eq', key, value]); return this; }
  neq(key: string, value: any) { this.filters.push(['neq', key, value]); return this; }
  not(key: string, operator: string, value: any) { this.filters.push([`not_${operator}`, key, value]); return this; }
  is(key: string, value: any) { this.filters.push(['is', key, value]); return this; }
  in(key: string, values: any[]) { this.filters.push(['in', key, values]); return this; }
  order(key: string) { this.orderBy.push(key); return this; }
  limit(value: number) { this.maxRows = value; return this; }
  range(start: number, end: number) { this.offsetRange = [start, end]; return this; }
  abortSignal(signal: AbortSignal) { this.signal = signal; this.db.abortSignalCount++; return this; }
  single() { return this.execute(true); }
  maybeSingle() { return this.execute(true, true); }
  then<TResult1 = any, TResult2 = never>(resolve?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null, reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null) {
    return this.execute(false).then(resolve ?? undefined, reject ?? undefined);
  }
  private async execute(single: boolean, maybe = false): Promise<any> {
    this.signal?.throwIfAborted();
    const rows = this.db.rows.get(this.table) ?? [];
    const matches = rows.filter(row => this.filters.every(([kind, key, value]) => {
      if (kind === 'eq') return row[key] === value;
      if (kind === 'neq') return row[key] !== value;
      if (kind === 'is') return row[key] === value;
      if (kind === 'not_is') return row[key] !== value && row[key] !== undefined;
      return (value as any[]).includes(row[key]);
    }));
    if (this.operation === 'insert' || this.operation === 'upsert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
      if (this.table === 'review_sessions' && incoming.some(item => item.iteration == null)) {
        return { data: null, error: { code: '23502', message: 'null value in column "iteration" of relation "review_sessions" violates not-null constraint' } };
      }
    }
    if (this.operation === 'insert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = incoming.map((item, index) => ({ ...item, id: item.id ?? `${this.table}-${rows.length + index + 1}` }));
      rows.push(...inserted);
      this.db.rows.set(this.table, rows);
      return { data: single ? inserted[0] : inserted, error: null };
    }
    if (this.operation === 'upsert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const item of incoming) {
        const existing = rows.find(row => (row.id && item.id && row.id === item.id)
          || (this.conflictFields.length > 0 && this.conflictFields.every(field => row[field] === item[field])));
        if (existing) {
          if (!this.ignoreDuplicates) Object.assign(existing, item);
          if (!item.id) item.id = existing.id;
        } else {
          if (!item.id) item.id = `${this.table}-${rows.length + 1}`;
          rows.push({ ...item });
        }
      }
      this.db.rows.set(this.table, rows);
      return { data: single ? incoming[0] : incoming, error: null };
    }
    if (this.operation === 'update') {
      for (const row of matches) Object.assign(row, this.payload);
      return { data: single ? (matches[0] ?? null) : matches, error: null };
    }
    if (this.operation === 'select') {
      const error = this.db.consumeReadFailure(this.table);
      if (error) return { data: null, error };
    }
    const sorted = this.orderBy.length ? [...matches].sort((a, b) => String(a[this.orderBy[0]])?.localeCompare(String(b[this.orderBy[0]]))) : matches;
    const limited = this.maxRows === undefined ? sorted : sorted.slice(0, this.maxRows);
    const ranged = this.offsetRange ? limited.slice(this.offsetRange[0], this.offsetRange[1] + 1) : limited;
    const capped = ranged.slice(0, this.db.rowCap);
    if (single) return { data: capped[0] ?? (maybe ? null : null), error: null };
    return { data: capped, error: null };
  }
}

class FakeDb {
  readonly rows = new Map<string, Row[]>();
  abortSignalCount = 0;
  readonly transientReadFailures = new Map<string, number>();
  constructor(readonly rowCap = Infinity) {}
  from(table: string) { return new FakeQuery(this, table); }
  seed(table: string, rows: Row[]) { this.rows.set(table, rows.map(row => ({ ...row }))); }
  failNextReads(table: string, count: number) { this.transientReadFailures.set(table, count); }
  consumeReadFailure(table: string): Row | null {
    const remaining = this.transientReadFailures.get(table) ?? 0;
    if (remaining <= 0) return null;
    this.transientReadFailures.set(table, remaining - 1);
    return { status: 503, message: 'temporary upstream failure' };
  }
}

function repository(db: FakeDb, retryRuntime?: { sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>; now?: () => Date }): SupabaseStaticReviewRepository {
  return new SupabaseStaticReviewRepository(db as unknown as SupabaseClient, undefined, retryRuntime);
}

const input: NewStaticReview = {
  projectId: 'project-1', name: 'Review', reviewType: 'code_review', status: 'queued', idempotencyKey: 'start-1',
  scope: { artifactIds: ['artifact-1'] }, config: {}, lineage: { parentReviewId: null, lineageRootId: 'root-1', reusedSourceManifest: false },
};

const artifact: Artifact = { id: 'artifact-1', projectId: 'project-1', type: 'source_code', source: 'repository', fileName: 'auth.ts', filePath: 'src/auth.ts', originalPath: null, contentHash: 'hash', createdAt: '2026-09-21T00:00:00.000Z' };

describe('SupabaseStaticReviewRepository', () => {
  it('exposes unverified harness deltas only for the requested project and Review', async () => {
    const db = new FakeDb();
    const partialDetail = { batchId: 'batch-1', features: [{ id: 'feature-1', assessments: [
      { domain: 'technical', status: 'unverified', outcome: 'unverified', summary: 'Selected local evidence is insufficient.', evidence: [] },
    ] }] };
    const event = (id: string, overrides: Row = {}): Row => ({
      id, project_id: 'project-1', entity_type: 'review', entity_id: 'review-1',
      event_type: 'review_analysis_batch_unverified', payload: { stage: 'model_analysis', detail: partialDetail },
      created_at: '2026-10-24T10:00:00.000Z', ...overrides,
    });
    db.seed('audit_events', [
      event('visible-prepared', { event_type: 'review_analysis_map_saved', payload: { detail: { phase: 'prepared' } } }),
      event('visible-unverified'),
      event('visible-validated', { event_type: 'review_assessment_validated', payload: { stage: 'model_analysis', detail: { validationVersion: 'static-assessment-2026-10-25-semantic-support.1', assessedArtifactIds: ['artifact-1'] } } }),
      event('visible-support-conflict', { event_type: 'review_candidate_support_conflict', payload: { stage: 'model_analysis', detail: { candidateKeyHash: 'safe-hash', priorDisposition: 'supported', disposition: 'contradicted' } } }),
      event('other-project', { project_id: 'project-2', payload: { detail: { marker: 'PRIVATE_OTHER_PROJECT' } } }),
      event('other-review', { entity_id: 'review-2', payload: { detail: { marker: 'PRIVATE_OTHER_REVIEW' } } }),
      event('other-entity', { entity_type: 'project', payload: { detail: { marker: 'PRIVATE_OTHER_ENTITY' } } }),
      event('private-event', { event_type: 'internal_provider_payload', payload: { detail: { marker: 'PRIVATE_PROVIDER_PAYLOAD' } } }),
    ]);

    const events = await repository(db).getHarnessEvents('project-1', 'review-1');

    expect(events.map(row => row.id)).toEqual(['visible-prepared', 'visible-unverified', 'visible-validated', 'visible-support-conflict']);
    expect(events.find(row => row.event === 'review_analysis_batch_unverified')).toMatchObject({
      projectId: 'project-1', reviewId: 'review-1', stage: 'model_analysis', detail: partialDetail,
    });
    expect(events.find(row => row.event === 'review_assessment_validated')?.detail).toMatchObject({ validationVersion: 'static-assessment-2026-10-25-semantic-support.1' });
    expect(events.every(row => row.projectId === 'project-1' && row.reviewId === 'review-1')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_');
  });

  it('writes the schema non-null empty iteration object for a root Review', async () => {
    const db = new FakeDb();
    const repo = repository(db);

    const created = await repo.createReview(input);

    expect(db.rows.get('review_sessions')?.[0].iteration).toEqual({});
    expect(created.iteration).toBeNull();
  });

  it('retries an individual bearer-scoped Review read and records safe retry timing in the harness audit', async () => {
    const db = new FakeDb();
    db.seed('review_sessions', [{ id: 'review-1', project_id: 'project-1', name: 'Review', review_type: 'code_review', status: 'running', iteration: {}, scope: {}, config: {}, lineage: {}, created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z' }]);
    db.failNextReads('review_sessions', 2);
    const waits: number[] = [];
    const repo = repository(db, {
      sleep: async delayMs => { waits.push(delayMs); },
      now: () => new Date('2026-10-13T00:00:00.000Z'),
    });

    const result = await repo.withReviewRetryContext({ reviewId: 'review-1', projectId: 'project-1' }, () => repo.getReview('review-1'));

    expect(result?.status).toBe('running');
    expect(waits).toEqual([1_000, 3_000]);
    expect(db.rows.get('audit_events')).toHaveLength(2);
    expect(db.rows.get('audit_events')?.map(row => row.event_type)).toEqual(['review_retry_scheduled', 'review_retry_scheduled']);
    expect(db.rows.get('audit_events')?.[0].payload.detail).toMatchObject({ kind: 'external', service: 'Supabase', operation: 'review lookup', attempt: 2, maxAttempts: 3, delayMs: 1_000, errorCode: 'http_503' });
    expect(JSON.stringify(db.rows.get('audit_events'))).not.toMatch(/temporary upstream failure/);
  });

  it('persists reviews and rejects a stale compare-and-set transition', async () => {
    const db = new FakeDb();
    const repo = repository(db);
    const created = await repo.createReview(input);
    expect(created.status).toBe('queued');
    const running = await repo.transitionReview(created.id, ['queued'], { status: 'running', updatedAt: '2026-09-21T00:00:01.000Z' });
    expect(running?.status).toBe('running');
    const stale = await repo.transitionReview(created.id, ['queued'], { status: 'running' });
    expect(stale).toBeNull();
    expect((await repo.getReview(created.id))?.revision).toBe(1);
  });

  it('stores immutable source manifests, findings, model attempts, progress, and audits', async () => {
    const db = new FakeDb();
    const repo = repository(db);
    const created = await repo.createReview(input);
    const manifest = await repo.saveSourceManifest(created.id, created.projectId, [artifact], 'capture');
    expect(manifest.id).toBeTruthy();
    await repo.saveFinding({ id: 'finding-1', reviewId: created.id, projectId: created.projectId, source: 'deterministic', title: 'Issue', description: 'Issue', severity: 'high', category: 'security', filePath: artifact.filePath, lineNumber: 3, evidence: 'eval(input)', recommendation: 'Remove eval', confidence: 'high', fingerprint: 'fingerprint-1',
      domain: 'security', issueType: 'unsafe_evaluation', logicFlow: ['Untrusted input reaches evaluation.'], relatedLocations: [{ filePath: 'src/input.ts', lineNumber: 2, evidence: 'readInput();', artifactId: 'input', sourceVersion: 'hash-2' }] });
    expect(db.rows.get('findings')?.[0].location).toMatchObject({ domain: 'security', issueType: 'unsafe_evaluation', logicFlow: ['Untrusted input reaches evaluation.'], relatedLocations: [{ filePath: 'src/input.ts', lineNumber: 2, evidence: 'readInput();', artifactId: 'input', sourceVersion: 'hash-2' }] });
    expect((await repo.listReviewFindings(created.id))[0]).toMatchObject({ domain: 'security', issueType: 'unsafe_evaluation',
      logicFlow: ['Untrusted input reaches evaluation.'], relatedLocations: [{ filePath: 'src/input.ts', lineNumber: 2,
        evidence: 'readInput();', artifactId: 'input', sourceVersion: 'hash-2' }] });
    await repo.updateProgress(created.id, { stage: 'deterministic_analysis', completedStages: [], updatedAt: '2026-09-21T00:00:02.000Z' });
    const attempt = { reviewId: created.id, projectId: created.projectId, stage: 'model_analysis', attempt: 1, provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo-v2.5', outcome: 'success' as const, durationMs: 42, responseReceived: true, createdAt: '2026-09-21T00:00:03.000Z', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, providerReportedTotalTokens: 15, totalTokensSource: 'provider_reported' as const, usageObservation: { source: 'provider_response' as const, completeness: 'complete' as const } } };
    await repo.recordModelAttempt(attempt);
    await repo.recordModelAttempt(attempt);
    await repo.recordAudit({ reviewId: created.id, projectId: created.projectId, event: 'review_stage_started', stage: 'model_analysis', createdAt: '2026-09-21T00:00:03.000Z' });
    expect(db.rows.get('review_source_snapshots')).toHaveLength(1);
    expect(db.rows.get('findings')?.[0].source).toBe('static');
    expect(db.rows.get('model_usage_records')?.[0].input_tokens).toBe(10);
    expect(db.rows.get('model_usage_records')?.[0].metadata).toMatchObject({
      providerReportedTotalTokens: 15, normalizedTotalTokens: 15, normalizedTotalTokensSource: 'provider_reported',
      responseReceived: true, usageObservation: { source: 'provider_response', completeness: 'complete' },
    });
    expect(db.rows.get('model_usage_records')).toHaveLength(1);
    db.rows.get('model_usage_records')?.push({ ...db.rows.get('model_usage_records')![0], id: 'later-attempt', attempt: 3 });
    expect(await repo.getModelAttemptCount(created.id, 'model_analysis')).toBe(3);
    expect(db.rows.get('review_progress_events')?.[0].stage).toBe('deterministic_analysis');
    expect(db.rows.get('audit_events')?.[0].event_type).toBe('review_stage_started');
  });
  it('preserves model semantic identity through saved finding read-back for cache comparison', async () => {
    const db = new FakeDb(); const repo = repository(db);
    const finding: PersistedReviewFinding = { id: 'model-roundtrip', reviewId: input.id!, projectId: input.projectId,
      source: 'model', title: 'Concrete issue', description: 'A condition causes a consequence.', category: 'behavior', severity: 'high',
      filePath: artifact.filePath, lineNumber: 3, artifactId: artifact.id, evidence: 'eval(input)', recommendation: 'Validate input.', confidence: 'high',
      sourceVersion: 'frozen-hash', domain: 'security', issueType: 'unsafe_evaluation', logicFlow: ['Input reaches evaluation.'],
      relatedLocations: [{ filePath: 'caller.ts', lineNumber: 2, evidence: 'run(input)', artifactId: null, sourceVersion: null }],
      createdAt: '2026-10-28T00:00:00.000Z' };
    await repo.saveFinding(finding);
    const loaded = (await repo.listReviewFindings(finding.reviewId))[0]!;
    expect(candidateSemanticKey(loaded)).toBe(candidateSemanticKey(finding));
    db.rows.get('findings')![0]!.location.logicFlow = [23];
    db.rows.get('findings')![0]!.location.relatedLocations = [{ filePath: '../unexpected', lineNumber: -1, evidence: 'x' }];
    const invalid = (await repo.listReviewFindings(finding.reviewId))[0]!;
    expect(invalid.logicFlow).toBeUndefined();
    expect(invalid.relatedLocations).toBeUndefined();
    expect(candidateSemanticKey(invalid)).not.toBe(candidateSemanticKey(finding));
  });

  it.each([false, true])('keeps uncertain and proven observations separately idempotent (uncertain first: %s)', async uncertainFirst => {
    const db = new FakeDb(1); const repo = repository(db);
    const base: PersistedReviewFinding = { id: 'verified', reviewId: 'review', projectId: 'project', source: 'model',
      title: 'Ownership check', description: 'Verified description', severity: 'high', category: 'security', filePath: 'auth.ts',
      lineNumber: 1, evidence: 'return user;', recommendation: 'Verify ownership.', confidence: 'high',
      fingerprint: 'stable-correlation-fingerprint', createdAt: '2026-10-27T00:00:00Z',
      sourceLocator: { citationEvidence: { verification: 'verified' } } };
    const uncertain: PersistedReviewFinding = { ...base, id: 'uncertain', description: 'Uncertain description',
      sourceLocator: { citationEvidence: { verification: 'needs_verification' } } };
    const deterministic: PersistedReviewFinding = { ...base, id: 'rule', source: 'deterministic', description: 'Rule description', sourceLocator: null };
    await repo.saveFinding(deterministic);
    for (const row of uncertainFirst ? [uncertain, base] : [base, uncertain]) await repo.saveFinding(row);
    await repo.saveFinding({ ...uncertain, id: 'retry-uncertain' });
    await repo.saveFinding({ ...base, id: 'retry-verified' });
    const stored = db.rows.get('findings')!;
    expect(stored).toHaveLength(3);
    expect(stored.map(row => row.id).sort()).toEqual(['rule', 'uncertain', 'verified']);
    expect(stored.find(row => row.id === 'rule')).toMatchObject({ verifier: 'deterministic', description: 'Rule description' });
    expect(stored.find(row => row.id === 'verified')).toMatchObject({ description: 'Verified description', source_locator: { citationEvidence: { verification: 'verified' } } });
    expect(stored.every(row => row.correlation_fingerprint === base.fingerprint)).toBe(true);
  });

  it('loads frozen source snapshots and persists grounding candidates only on explicit confirmation', async () => {
    const db = new FakeDb();
    const repo = repository(db);
    const review = await repo.createReview(input);
    const manifest = await repo.saveSourceManifest(review.id, review.projectId, [artifact], 'capture');
    const frozen = await repo.loadSourceManifestArtifacts(manifest.id);
    expect(frozen).toEqual([artifact]);

    const [candidate] = await repo.saveRequirementCandidates([{
      projectId: review.projectId,
      kind: 'requirement',
      title: 'User authentication',
      statement: 'Private routes require an authenticated user.',
      sourceLocator: { artifactId: artifact.id, filePath: artifact.filePath, lineStart: 3 },
      sourceVersion: artifact.contentHash,
      confidence: 0.9,
      fingerprint: 'candidate-fingerprint',
    }]);
    expect(candidate.status).toBe('pending_confirmation');
    expect(db.rows.get('requirements')).toBeUndefined();
    const confirmed = await repo.confirmRequirementCandidate(candidate.id, 'actor-1');
    expect(confirmed).toMatchObject({ sourceCandidateId: candidate.id, sourceVersion: artifact.contentHash, confidence: 0.9 });
    expect((await repo.listConfirmedRequirements(review.projectId)).map(item => item.id)).toContain(confirmed.id);
    expect(db.rows.get('requirement_candidates')?.[0]).toMatchObject({ status: 'confirmed', confirmed_by: 'actor-1', confirmed_requirement_id: confirmed.id });
  });

  it('captures the whole frozen traceability scope despite a lower Supabase row cap and never refreshes it', async () => {
    const db = new FakeDb(40);
    const requirementCount = 131;
    db.seed('requirements', Array.from({ length: requirementCount }, (_, index) => ({
      id: `requirement-${String(index).padStart(3, '0')}`, project_id: 'project-1',
      title: `Requirement ${index}`, description: '', category: 'security', created_at: '2026-09-23T00:00:00Z',
    })));
    db.seed('requirement_mappings', Array.from({ length: requirementCount }, (_, index) => ({
      id: `mapping-${String(index).padStart(3, '0')}`, requirement_id: 'requirement-000',
      file_id: 'artifact-1', symbol_id: null, coverage_status: 'complete', confidence: 1,
    })));
    const repo = repository(db);
    const captured = await repo.captureTraceabilitySnapshot('review-1', 'project-1', {
      scope: {}, sourceManifestId: 'manifest-1', artifacts: [artifact],
    });
    expect(captured.records).toHaveLength(requirementCount);
    expect(captured.records[0]).toMatchObject({ state: 'incomplete', evidenceStatus: 'unavailable' });
    expect(captured.records[0].mappingIds).toHaveLength(requirementCount);
    expect(captured.records[0].mappings?.[0]).toMatchObject({ evidenceStatus: 'unavailable', evidenceReason: 'mapping_version_proof_missing' });
    expect(captured.summary).toMatchObject({ incomplete: 1, missing: requirementCount - 1, attention: requirementCount, unavailable: 1 });
    expect(captured.metadata).toMatchObject({ snapshotVersion: 2, sourceManifestId: 'manifest-1', inclusionBasis: { artifactSelection: 'full_manifest', requirementSelection: 'project' } });

    db.rows.get('requirement_mappings')![requirementCount - 1].coverage_status = 'incomplete';
    const reused = await repo.captureTraceabilitySnapshot('review-1', 'project-1', {
      scope: { requirementIds: ['requirement-130'] }, sourceManifestId: 'new-manifest', artifacts: [],
    });
    expect(reused).toEqual(captured);
    expect(await repo.getTraceabilitySnapshot('review-1')).toEqual(captured);
    const readiness = await repo.getTraceabilityReadiness('project-1');
    expect(readiness).toHaveLength(requirementCount);
    expect(readiness[0]).toEqual({ requirementId: 'requirement-000', state: 'incomplete' });
    expect(readiness.at(-1)).toEqual({ requirementId: 'requirement-130', state: 'missing' });
  });

  it('limits traceability to selected requirements and artifacts and requires matching mapping version proof', async () => {
    const db = new FakeDb();
    db.seed('requirements', [
      { id: 'req-selected', project_id: 'project-1', title: 'Selected', description: 'A selected requirement', category: 'security' },
      { id: 'req-no-proof', project_id: 'project-1', title: 'No proof', description: '', category: 'quality' },
      { id: 'req-stale', project_id: 'project-1', title: 'Stale', description: '', category: 'quality' },
      { id: 'req-unselected', project_id: 'project-1', title: 'Unselected', description: '', category: 'quality' },
    ]);
    db.seed('requirement_mappings', [
      { id: 'map-verified', requirement_id: 'req-selected', artifact_id: 'artifact-1', file_id: 'artifact-1', symbol_id: 'verify', coverage_status: 'complete', confidence: 0.9, artifact_version_id: 'version-1' },
      { id: 'map-outside-scope', requirement_id: 'req-selected', artifact_id: 'artifact-2', file_id: 'artifact-2', coverage_status: 'complete', confidence: 1, artifact_version_id: 'version-2' },
      { id: 'map-no-proof', requirement_id: 'req-no-proof', artifact_id: 'artifact-1', file_id: 'artifact-1', coverage_status: 'complete', confidence: 0.8 },
      { id: 'map-stale', requirement_id: 'req-stale', artifact_id: 'artifact-1', file_id: 'artifact-1', coverage_status: 'complete', confidence: 0.7, artifact_version_id: 'old-version' },
      { id: 'map-unselected', requirement_id: 'req-unselected', artifact_id: 'artifact-1', file_id: 'artifact-1', coverage_status: 'complete', confidence: 1, artifact_version_id: 'version-1' },
    ]);
    const repo = repository(db);
    const captured = await repo.captureTraceabilitySnapshot('review-scope', 'project-1', {
      scope: { requirementIds: ['req-selected', 'req-no-proof', 'req-stale', 'req-deleted'], artifactIds: ['artifact-1'] },
      sourceManifestId: 'manifest-1',
      artifacts: [{ ...artifact, versionId: 'version-1', contentHash: 'reviewed-hash' }],
    });

    expect(captured.records.map(item => item.requirementId)).toEqual(['req-selected', 'req-no-proof', 'req-stale', 'req-deleted']);
    expect(captured.records[0]).toMatchObject({ state: 'complete', mappingIds: ['map-verified'], evidenceStatus: 'verified' });
    expect(captured.records[1]).toMatchObject({ state: 'incomplete', evidenceStatus: 'unavailable', evidenceReason: 'mapping_version_proof_missing' });
    expect(captured.records[2]?.mappings?.[0]).toMatchObject({ evidenceStatus: 'stale', evidenceReason: 'mapping_version_does_not_match_reviewed_source' });
    expect(captured.records[3]).toMatchObject({ state: 'incomplete', evidenceStatus: 'unavailable', evidenceReason: 'selected_requirement_unavailable_at_capture' });
    expect(captured.summary).toMatchObject({ complete: 1, incomplete: 3, missing: 0, attention: 3, unavailable: 3 });
    expect(captured.metadata?.inclusionBasis).toMatchObject({
      requirementSelection: 'explicit', artifactSelection: 'explicit',
      selectedRequirementIds: ['req-selected', 'req-no-proof', 'req-stale', 'req-deleted'], selectedArtifactIds: ['artifact-1'],
    });
  });

  it('reuses versioned requirement and mapping context without reading mutable project tables', async () => {
    const db = new FakeDb();
    db.seed('requirements', [{ id: 'req-1', project_id: 'project-1', title: 'Frozen title', description: 'Frozen text', category: 'security' }]);
    db.seed('requirement_mappings', [{ id: 'map-1', requirement_id: 'req-1', artifact_id: 'artifact-1', file_id: 'artifact-1', coverage_status: 'complete', confidence: 1, artifact_version_id: 'version-1' }]);
    const repo = repository(db);
    const parent = await repo.captureTraceabilitySnapshot('parent-review', 'project-1', {
      scope: { requirementIds: ['req-1'] }, sourceManifestId: 'manifest-1',
      artifacts: [{ ...artifact, versionId: 'version-1' }],
      grounding: {
        confirmedRequirements: [{ id: 'req-1', projectId: 'project-1', title: 'Frozen title', description: 'Frozen text', category: 'security', priority: 'high', sourceCandidateId: null, sourceLocator: null, sourceVersion: null, confidence: null, createdAt: '2026-10-20T00:00:00.000Z' }],
        enabledStandardRules: [],
      },
    });
    db.rows.get('requirements')![0].title = 'Edited after capture';
    db.rows.get('requirement_mappings')![0].coverage_status = 'incomplete';
    db.failNextReads('requirements', 1);
    db.failNextReads('requirement_mappings', 1);
    const child = await repo.captureTraceabilitySnapshot('child-review', 'project-1', {
      scope: { requirementIds: ['req-1'] }, sourceManifestId: 'manifest-1', artifacts: [], reuseFromReviewId: 'parent-review',
    });

    expect(child.records).toEqual(parent.records);
    expect(child.metadata?.grounding?.confirmedRequirements[0]?.title).toBe('Frozen title');
    expect(child.metadata?.sourceManifestId).toBe('manifest-1');
    expect(db.rows.get('requirement_mappings')![0].coverage_status).toBe('incomplete');
  });

  it('keeps missing or legacy retry context explicitly unavailable instead of rebuilding it', async () => {
    const db = new FakeDb();
    db.seed('requirements', [{ id: 'current', project_id: 'project-1', title: 'Current', description: '', category: 'quality' }]);
    const repo = repository(db);
    await repo.saveTraceabilitySnapshot('legacy-review', 'project-1');
    expect(await repo.getTraceabilitySnapshot('legacy-review')).toMatchObject({ status: 'unavailable', records: [], metadata: { unavailableReason: 'frozen_context_not_provided' } });
    db.seed('review_traceability_snapshots', [
      ...(db.rows.get('review_traceability_snapshots') ?? []),
      { id: 'legacy-parent-row', project_id: 'project-1', review_session_id: 'legacy-parent', status: 'available', records: [{ requirementId: 'current', state: 'complete', mappingIds: ['old-map'] }], summary: { complete: 1, incomplete: 0, missing: 0, attention: 0 }, created_at: '2026-09-01T00:00:00.000Z' },
    ]);
    const child = await repo.captureTraceabilitySnapshot('child-review', 'project-1', {
      scope: {}, sourceManifestId: 'manifest-1', artifacts: [], reuseFromReviewId: 'legacy-parent',
    });
    expect(child).toMatchObject({ status: 'unavailable', records: [], metadata: { unavailableReason: 'legacy_parent_context_unavailable' } });
    expect(db.rows.get('requirements')).toHaveLength(1);
  });

  it('lists every project Review and active Review beyond one Supabase page', async () => {
    const db = new FakeDb(40);
    db.seed('review_sessions', Array.from({ length: 131 }, (_, index) => ({
      id: `review-${String(index).padStart(3, '0')}`, project_id: 'project-1',
      name: `Review ${index}`, review_type: 'code_review',
      status: index % 3 === 0 ? 'failed' : index % 3 === 1 ? 'queued' : 'running',
      scope: {}, config: {}, created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z',
    })));
    const repo = repository(db);
    expect(await repo.listReviews('project-1')).toHaveLength(131);
    const active = await repo.listActiveReviews();
    expect(active).toHaveLength(87);
    expect(active.at(-1)?.id).toBe('review-130');
  });

  it('loads all Review findings for correlation despite a lower Supabase row cap', async () => {
    const db = new FakeDb(40);
    db.seed('findings', Array.from({ length: 131 }, (_, index) => ({
      id: `finding-${String(index).padStart(3, '0')}`, project_id: 'project-1', review_session_id: 'review-1',
      source: 'static', verifier: 'deterministic', status: index % 2 ? 'fixed' : 'new',
      title: `Finding ${index}`, description: '', severity: 'medium', priority: 'medium', category: 'quality',
      location: {}, created_at: '2026-09-23T00:00:00Z',
    })));
    const loaded = await repository(db).listReviewFindings('review-1');
    expect(loaded).toHaveLength(131);
    expect(loaded.at(-1)).toMatchObject({ id: 'finding-130' });
  });

  it('freezes every grounding record and disposition beyond the Supabase row cap', async () => {
    const db = new FakeDb(40);
    const count = 131;
    const ids = Array.from({ length: count }, (_, index) => String(index).padStart(3, '0'));
    db.seed('requirements', ids.map(id => ({ id: `requirement-${id}`, project_id: 'project-1', created_at: id })));
    db.seed('requirement_candidates', ids.map(id => ({ id: `candidate-${id}`, project_id: 'project-1', status: 'pending_confirmation', created_at: id })));
    db.seed('project_standards', ids.map(id => ({ id: `standard-${id}`, project_id: 'project-1', version: '1', metadata: { sourceVersion: 'source-1' } })));
    db.seed('project_standard_rules', ids.map(id => ({ id: `rule-${id}`, project_id: 'project-1', standard_id: `standard-${id}`, standard_version: '1', source_version: 'source-1', created_at: id })));
    db.seed('evidence_contradiction_dispositions', ids.map(id => ({ id: `disposition-${id}`, project_id: 'project-1', contradiction_id: `contradiction-${id}`, decision: 'accepted', rationale: 'Reviewed', actor_id: 'actor-1', updated_at: id })));
    const repo = repository(db);
    const signal = new AbortController().signal;
    expect(await repo.listConfirmedRequirements('project-1', undefined, signal)).toHaveLength(count);
    expect(await repo.listRequirementCandidates('project-1', 'pending_confirmation', signal)).toHaveLength(count);
    expect(await repo.listStandardRules('project-1', undefined, signal)).toHaveLength(count);
    expect(await repo.listContradictionDispositions('project-1', signal)).toHaveLength(count);
    expect(await repo.getTraceabilityReadiness('project-1', undefined, signal)).toHaveLength(count);
    expect(db.abortSignalCount).toBeGreaterThan(5);
    const controller = new AbortController();
    controller.abort();
    await expect(repo.listConfirmedRequirements('project-1', undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('persists current versioned standards rules and retains enable state on idempotent re-ingest', async () => {
    const db = new FakeDb();
    const repo = repository(db);
    const rule = {
      stableKey: 'stable-rule', title: 'Validate ownership', statement: 'Handlers must validate ownership.',
      category: 'security', severity: 'high' as const, recommendation: 'Check the tenant.',
      sourceArtifactId: artifact.id, sourceLocator: { artifactId: artifact.id, filePath: artifact.filePath, lineStart: 4 },
      sourceVersion: 'content-v2', standardVersion: '2.0', enabled: true,
    };
    const inputRules = { projectId: artifact.projectId, artifact, label: 'API rules', sourceVersion: 'content-v2', standardVersion: '2.0', rules: [rule] };
    const [stored] = await repo.saveStandardRules(inputRules);
    expect(stored).toMatchObject({ standardVersion: '2.0', sourceVersion: 'content-v2', enabled: true });
    await repo.setStandardRuleEnabled(stored.id, false);
    const [again] = await repo.saveStandardRules(inputRules);
    expect(again).toMatchObject({ id: stored.id, enabled: false });
    expect(await repo.listStandardRules(artifact.projectId, [stored.standardId])).toEqual([again]);
  });

  it('stores immutable iteration, evidence, and correlation records', async () => {
    const db = new FakeDb();
    const repo = repository(db);
    const parent = await repo.createReview(input);
    const child = await repo.createReview({ ...input, id: 'child-review', status: 'prepared', lineage: { parentReviewId: parent.id, lineageRootId: parent.lineage.lineageRootId, reusedSourceManifest: false } });
    const iteration = { parentReviewId: parent.id, decisionId: 'decision-1', feedback: 'Recheck ownership.', reviewer: 'Reviewer', createdBy: 'actor-1', sourceChoice: 'refresh' as const, sourceManifestId: null, preparedAt: '2026-09-21T00:00:00.000Z' };
    await repo.saveReviewIteration(child.id, child.projectId, iteration);
    const assessment: EvidenceSufficiencyAssessment = {
      id: 'assessment-hash', reviewId: child.id, projectId: child.projectId, reviewType: child.reviewType,
      readiness: 'ready_with_warnings', gaps: [], contradictions: [], artifactCount: 1, availableArtifactCount: 1,
      staleArtifactCount: 0, confirmedRequirementCount: 0, enabledStandardRuleCount: 0, assessedAt: iteration.preparedAt,
    };
    await repo.saveEvidenceSufficiency(assessment);
    await repo.transitionReview(child.id, ['prepared'], { status: 'running' });
    const withInvalidAssessmentGap = withEvidenceSufficiencyGap(assessment, {
      code: 'model_assessment_invalid', severity: 'blocking', title: 'Assessment incomplete',
      detail: 'The model response did not validate.', remediation: 'Run a new assessment after reviewing the evidence.',
      affectedStages: ['model_analysis'],
    });
    const appendedAssessment = await repo.appendEvidenceSufficiency(withInvalidAssessmentGap);
    expect(appendedAssessment).toMatchObject({ readiness: 'blocked', artifactCount: 1, assessedAt: assessment.assessedAt });
    expect(appendedAssessment.gaps.map(item => item.code)).toEqual(['model_assessment_invalid']);
    const correlations: FindingCorrelationSnapshot = {
      parentReviewId: parent.id, childReviewId: child.id,
      correlations: [{ id: 'correlation-1', parentReviewId: parent.id, childReviewId: child.id, parentFindingId: null, childFindingId: null, classification: 'new', method: 'unmatched', score: 0, stableFingerprint: 'fingerprint' }],
      ambiguities: [], counts: { new: 1, recurring: 0, carried_over: 0, resolved: 0, regressed: 0 }, createdAt: iteration.preparedAt,
    };
    await repo.saveFindingCorrelations(correlations);
    expect(await repo.getEvidenceSufficiency(child.id)).toMatchObject({ readiness: 'blocked', reviewId: child.id, artifactCount: 1 });
    expect(await repo.getFindingCorrelationSnapshot(child.id)).toMatchObject({ parentReviewId: parent.id, counts: { new: 1 }, correlations: [{ classification: 'new' }] });
    expect(db.rows.get('review_iterations')?.[0]).toMatchObject({ child_review_id: child.id, source_choice: 'refresh', feedback: 'Recheck ownership.' });
    expect(db.rows.get('review_evidence_assessments')?.[0]).toMatchObject({ review_session_id: child.id, readiness: 'blocked' });
    expect(db.rows.get('review_finding_correlations')?.[0]).toMatchObject({ child_review_id: child.id, classification: 'new' });
    expect(db.rows.get('review_correlation_snapshots')?.[0].ambiguities).toEqual([]);
    await repo.transitionReview(child.id, ['running'], { status: 'pending_approval' });
    await expect(repo.appendEvidenceSufficiency(withInvalidAssessmentGap)).rejects.toThrow('immutable after Review execution ends');
  });

  it('preserves multiple project comparison baselines in one immutable end-of-review snapshot', async () => {
    const db = new FakeDb();
    const repo = repository(db);
    const first = await repo.createReview(input);
    const second = await repo.createReview({ ...input, idempotencyKey: 'second-baseline' });
    const child = await repo.createReview({ ...input, idempotencyKey: 'independent-review' });
    const snapshot: FindingCorrelationSnapshot = {
      parentReviewId: second.id, childReviewId: child.id, createdAt: '2026-10-20T00:00:00Z',
      counts: { new: 0, recurring: 0, regressed: 0, resolved: 0, carried_over: 2 }, ambiguities: [],
      correlations: [first, second].map((parent, i) => ({ id: `multi-${i}`, parentReviewId: parent.id, childReviewId: child.id,
        parentFindingId: null, childFindingId: null, classification: 'carried_over', method: 'unmatched', score: 0, stableFingerprint: `fp-${i}` })),
    };
    await repo.saveFindingCorrelations(snapshot);
    const loaded = await repo.getFindingCorrelationSnapshot(child.id);
    expect(loaded?.correlations.map(item => item.parentReviewId)).toEqual([first.id, second.id]);
    expect(loaded?.counts.carried_over).toBe(2);
  });

  it('round trips versioned finding resolution eligibility without inventing validation provenance', async () => {
    const db = new FakeDb();
    const repo = repository(db);
    const parent = await repo.createReview(input);
    const child = await repo.createReview({ ...input, id: 'resolved-child', idempotencyKey: 'resolved-child' });
    const eligibility = {
      version: 2 as const,
      assessmentValidationVersion: 'static-assessment-2026-10-21.1',
      basis: 'not_reproduced_in_comparable_review' as const,
      parentSourceManifestId: 'parent-manifest',
      sourceManifestId: 'child-manifest',
      reviewedArtifactId: 'artifact-1',
      parentArtifactId: 'artifact-1',
      sourceIdentityHash: 'source-hash',
      parentSourceVersion: 'parent-v1',
      reviewedSourceVersion: 'child-v2',
    };
    await repo.saveFindingCorrelations({
      parentReviewId: parent.id,
      childReviewId: child.id,
      correlations: [{ id: 'resolved-v2', parentReviewId: parent.id, childReviewId: child.id, parentFindingId: 'finding-1', childFindingId: null,
        classification: 'resolved', method: 'fingerprint', score: 1, stableFingerprint: 'fingerprint', resolutionEligibility: eligibility }],
      ambiguities: [],
      counts: { new: 0, recurring: 0, carried_over: 0, resolved: 1, regressed: 0 },
      createdAt: '2026-10-21T00:00:00Z',
    });

    expect((await repo.getFindingCorrelationSnapshot(child.id))?.correlations[0].resolutionEligibility).toEqual(eligibility);

    const legacy = { ...eligibility, version: 1 as const, assessmentValidationVersion: undefined };
    db.rows.get('review_finding_correlations')?.push({
      id: 'resolved-v1',
      parent_review_id: parent.id,
      child_review_id: child.id,
      parent_finding_id: 'finding-legacy',
      child_finding_id: null,
      classification: 'resolved',
      method: 'fingerprint',
      score: 1,
      stable_fingerprint: 'legacy-fingerprint',
      detail: { resolutionEligibility: { ...legacy, assessmentValidationVersion: 'must-not-be-inferred' } },
      created_at: '2026-10-21T00:00:00Z',
    });
    const loaded = await repo.getFindingCorrelationSnapshot(child.id);
    expect(loaded?.correlations.find(item => item.id === 'resolved-v1')?.resolutionEligibility).toEqual(legacy);
  });
});
