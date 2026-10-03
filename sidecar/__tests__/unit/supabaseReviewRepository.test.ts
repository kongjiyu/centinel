import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artifact } from '../../src/artifacts.js';
import { SupabaseStaticReviewRepository } from '../../src/review/supabaseRepository.js';
import type { NewStaticReview } from '../../src/review/types.js';
import type { EvidenceSufficiencyAssessment } from '../../src/review/evidenceSufficiency.js';
import type { FindingCorrelationSnapshot } from '../../src/review/correlation.js';

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
  constructor(readonly rowCap = Infinity) {}
  from(table: string) { return new FakeQuery(this, table); }
  seed(table: string, rows: Row[]) { this.rows.set(table, rows.map(row => ({ ...row }))); }
}

function repository(db: FakeDb): SupabaseStaticReviewRepository {
  return new SupabaseStaticReviewRepository(db as unknown as SupabaseClient);
}

const input: NewStaticReview = {
  projectId: 'project-1', name: 'Review', reviewType: 'code_review', status: 'queued', idempotencyKey: 'start-1',
  scope: { artifactIds: ['artifact-1'] }, config: {}, lineage: { parentReviewId: null, lineageRootId: 'root-1', reusedSourceManifest: false },
};

const artifact: Artifact = { id: 'artifact-1', projectId: 'project-1', type: 'source_code', source: 'repository', fileName: 'auth.ts', filePath: 'src/auth.ts', originalPath: null, contentHash: 'hash', createdAt: '2026-09-21T00:00:00.000Z' };

describe('SupabaseStaticReviewRepository', () => {
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
    await repo.saveFinding({ id: 'finding-1', reviewId: created.id, projectId: created.projectId, source: 'deterministic', title: 'Issue', description: 'Issue', severity: 'high', category: 'security', filePath: artifact.filePath, lineNumber: 3, evidence: 'eval(input)', recommendation: 'Remove eval', confidence: 'high', fingerprint: 'fingerprint-1' });
    await repo.updateProgress(created.id, { stage: 'deterministic_analysis', completedStages: [], updatedAt: '2026-09-21T00:00:02.000Z' });
    const attempt = { reviewId: created.id, projectId: created.projectId, stage: 'model_analysis', attempt: 1, provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo-v2.5', outcome: 'success' as const, durationMs: 42, createdAt: '2026-09-21T00:00:03.000Z', usage: { inputTokens: 10, outputTokens: 5 } };
    await repo.recordModelAttempt(attempt);
    await repo.recordModelAttempt(attempt);
    await repo.recordAudit({ reviewId: created.id, projectId: created.projectId, event: 'review_stage_started', stage: 'model_analysis', createdAt: '2026-09-21T00:00:03.000Z' });
    expect(db.rows.get('review_source_snapshots')).toHaveLength(1);
    expect(db.rows.get('findings')?.[0].source).toBe('static');
    expect(db.rows.get('model_usage_records')?.[0].input_tokens).toBe(10);
    expect(db.rows.get('model_usage_records')).toHaveLength(1);
    db.rows.get('model_usage_records')?.push({ ...db.rows.get('model_usage_records')![0], id: 'later-attempt', attempt: 3 });
    expect(await repo.getModelAttemptCount(created.id, 'model_analysis')).toBe(3);
    expect(db.rows.get('review_progress_events')?.[0].stage).toBe('deterministic_analysis');
    expect(db.rows.get('audit_events')?.[0].event_type).toBe('review_stage_started');
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

  it('captures all requirements and mappings despite a lower Supabase row cap', async () => {
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
    await repo.saveTraceabilitySnapshot('review-1', 'project-1');
    const snapshot = db.rows.get('review_traceability_snapshots')?.[0];
    expect(snapshot?.records).toHaveLength(requirementCount);
    expect(snapshot?.records[0]).toMatchObject({ state: 'complete' });
    expect(snapshot?.records[0].mappingIds).toHaveLength(requirementCount);
    expect(snapshot?.summary).toMatchObject({ complete: 1, missing: requirementCount - 1 });

    db.rows.get('requirement_mappings')![requirementCount - 1].coverage_status = 'incomplete';
    const readiness = await repo.getTraceabilityReadiness('project-1');
    expect(readiness).toHaveLength(requirementCount);
    expect(readiness[0]).toEqual({ requirementId: 'requirement-000', state: 'incomplete' });
    expect(readiness.at(-1)).toEqual({ requirementId: 'requirement-130', state: 'missing' });
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
    const correlations: FindingCorrelationSnapshot = {
      parentReviewId: parent.id, childReviewId: child.id,
      correlations: [{ id: 'correlation-1', parentReviewId: parent.id, childReviewId: child.id, parentFindingId: null, childFindingId: null, classification: 'new', method: 'unmatched', score: 0, stableFingerprint: 'fingerprint' }],
      ambiguities: [], counts: { new: 1, recurring: 0, carried_over: 0, resolved: 0, regressed: 0 }, createdAt: iteration.preparedAt,
    };
    await repo.saveFindingCorrelations(correlations);
    expect(await repo.getEvidenceSufficiency(child.id)).toMatchObject({ readiness: 'ready_with_warnings', reviewId: child.id });
    expect(await repo.getFindingCorrelationSnapshot(child.id)).toMatchObject({ parentReviewId: parent.id, counts: { new: 1 }, correlations: [{ classification: 'new' }] });
    expect(db.rows.get('review_iterations')?.[0]).toMatchObject({ child_review_id: child.id, source_choice: 'refresh', feedback: 'Recheck ownership.' });
    expect(db.rows.get('review_evidence_assessments')?.[0]).toMatchObject({ review_session_id: child.id, readiness: 'ready_with_warnings' });
    expect(db.rows.get('review_finding_correlations')?.[0]).toMatchObject({ child_review_id: child.id, classification: 'new' });
    expect(db.rows.get('review_correlation_snapshots')?.[0].ambiguities).toEqual([]);
  });
});
