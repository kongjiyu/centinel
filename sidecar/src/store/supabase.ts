import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CentinelStore,
  StoreArtifact,
  StoreArtifactVersion,
  StoreAssessment,
  StoreDecision,
  StoreDynamicSession,
  StoreEmbeddingChunk,
  StoreFinding,
  StoreFindingStateChange,
  StoreIntegration,
  StoreModelConfiguration,
  StoreModelUsage,
  StoreProject,
  StoreProjectMember,
  StoreProjectSource,
  StoreRequirement,
  StoreRequirementMapping,
  StoreReviewEvidence,
  StoreReviewSession,
  StoreStandard,
} from './types.js';

type Row = Record<string, unknown>;

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Supabase ${label} query returned no data.`);
  return value;
}

function asRow(value: unknown): Row {
  return (value ?? {}) as Row;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(row: Row, key: string, fallback = ''): string {
  return row[key] == null ? fallback : String(row[key]);
}

function optionalText(row: Row, key: string): string | null {
  return row[key] == null || row[key] === '' ? null : String(row[key]);
}

function numberOrNull(row: Row, key: string): number | null {
  return row[key] == null ? null : Number(row[key]);
}

function bool(row: Row, key: string, fallback = false): boolean {
  return row[key] == null ? fallback : Boolean(row[key]);
}

function mapProject(row: Row): StoreProject {
  return {
    id: text(row, 'id'), ownerId: text(row, 'owner_id'), name: text(row, 'name'),
    description: text(row, 'description'), workspacePath: text(row, 'workspace_path'),
    createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  };
}

function mapMember(row: Row): StoreProjectMember {
  return { projectId: text(row, 'project_id'), userId: text(row, 'user_id'), role: text(row, 'role', 'member') as StoreProjectMember['role'], createdAt: text(row, 'created_at') };
}

function mapSource(row: Row): StoreProjectSource {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), integrationId: optionalText(row, 'integration_id'),
    kind: text(row, 'kind', 'upload') as StoreProjectSource['kind'], name: text(row, 'name'),
    remoteId: optionalText(row, 'remote_id'), remoteUrl: optionalText(row, 'remote_url'),
    syncStatus: text(row, 'sync_status', 'idle') as StoreProjectSource['syncStatus'],
    lastSyncedAt: optionalText(row, 'last_synced_at'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  };
}

function mapArtifact(row: Row): StoreArtifact {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), sourceId: optionalText(row, 'source_id'),
    path: text(row, 'path'), name: text(row, 'name'), kind: text(row, 'kind', 'file'), mimeType: optionalText(row, 'mime_type'),
    metadata: asRecord(row.metadata), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  };
}

function mapArtifactVersion(row: Row): StoreArtifactVersion {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), artifactId: text(row, 'artifact_id'),
    versionNumber: Number(row.version_number ?? 1), contentHash: text(row, 'content_hash'), byteSize: numberOrNull(row, 'byte_size'),
    storagePath: optionalText(row, 'storage_path'), sourceRevision: optionalText(row, 'source_revision'), contentType: optionalText(row, 'content_type'),
    metadata: asRecord(row.metadata), createdAt: text(row, 'created_at'),
  };
}

function mapRequirement(row: Row): StoreRequirement {
  return { id: text(row, 'id'), projectId: text(row, 'project_id'), title: text(row, 'title'), description: text(row, 'description'), category: text(row, 'category'), priority: text(row, 'priority', 'medium'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at', text(row, 'created_at')) };
}

function mapStandard(row: Row): StoreStandard {
  return { id: text(row, 'id'), projectId: text(row, 'project_id'), code: text(row, 'code'), title: text(row, 'title'), description: text(row, 'description'), source: text(row, 'source', 'manual'), version: optionalText(row, 'version'), metadata: asRecord(row.metadata), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at', text(row, 'created_at')) };
}

function mapMapping(row: Row): StoreRequirementMapping {
  return { id: text(row, 'id'), projectId: text(row, 'project_id'), requirementId: text(row, 'requirement_id'), standardId: optionalText(row, 'standard_id'), artifactId: optionalText(row, 'artifact_id'), fileId: optionalText(row, 'file_id'), symbolId: optionalText(row, 'symbol_id'), coverageStatus: text(row, 'coverage_status', 'unknown'), confidence: Number(row.confidence ?? 0), createdAt: text(row, 'created_at') };
}

function mapReview(row: Row): StoreReviewSession {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), name: text(row, 'name'), reviewType: text(row, 'review_type'),
    status: text(row, 'status', 'queued'), config: asRecord(row.config), progress: asRecord(row.progress),
    parentReviewId: optionalText(row, 'parent_review_id'), idempotencyKey: optionalText(row, 'idempotency_key'), sourceManifestHash: optionalText(row, 'source_manifest_hash'),
    finalSummary: text(row, 'final_summary'), failureReason: text(row, 'failure_reason'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
    cancelledAt: optionalText(row, 'cancelled_at'), completedAt: optionalText(row, 'completed_at'),
  };
}

function mapEvidence(row: Row): StoreReviewEvidence {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), reviewSessionId: text(row, 'review_session_id'), artifactVersionId: optionalText(row, 'artifact_version_id'),
    kind: text(row, 'kind', 'text'), locator: asRecord(row.locator), content: row.content == null ? null : String(row.content), storagePath: optionalText(row, 'storage_path'), contentHash: optionalText(row, 'content_hash'), metadata: asRecord(row.metadata), immutable: bool(row, 'immutable', true), createdAt: text(row, 'created_at'),
  };
}

function mapFinding(row: Row): StoreFinding {
  return {
    id: text(row, 'id'), projectId: text(row, 'project_id'), reviewSessionId: optionalText(row, 'review_session_id'), dynamicSessionId: optionalText(row, 'dynamic_session_id'),
    source: text(row, 'source', 'static') === 'dynamic' ? 'dynamic' : 'static', severity: text(row, 'severity'), priority: optionalText(row, 'priority'),
    title: text(row, 'title'), description: text(row, 'description'), status: text(row, 'status', 'new') as StoreFinding['status'], category: text(row, 'category'), evidenceText: text(row, 'evidence_text'), recommendation: text(row, 'recommendation'), confidence: text(row, 'confidence'),
    artifactId: optionalText(row, 'artifact_id'), artifactVersionId: optionalText(row, 'artifact_version_id'), evidenceId: optionalText(row, 'evidence_id'), requirementId: optionalText(row, 'requirement_id'), standardId: optionalText(row, 'standard_id'), verifier: optionalText(row, 'verifier'), location: asRecord(row.location), correlationFingerprint: optionalText(row, 'correlation_fingerprint'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at', text(row, 'created_at')),
  };
}

function mapHistory(row: Row): StoreFindingStateChange {
  return { id: text(row, 'id'), projectId: text(row, 'project_id'), findingId: text(row, 'finding_id'), fromStatus: optionalText(row, 'from_status') as StoreFindingStateChange['fromStatus'], toStatus: text(row, 'to_status') as StoreFindingStateChange['toStatus'], actorId: optionalText(row, 'actor_id'), comment: text(row, 'comment'), createdAt: text(row, 'created_at') };
}

function mapDecision(row: Row): StoreDecision {
  return { id: text(row, 'id'), projectId: text(row, 'project_id'), reviewSessionId: text(row, 'review_session_id'), decision: text(row, 'decision') as StoreDecision['decision'], comment: text(row, 'comment'), reviewer: text(row, 'reviewer'), createdAt: text(row, 'created_at') };
}

function mapAssessment(row: Row): StoreAssessment {
  return { id: text(row, 'id'), projectId: text(row, 'project_id'), reviewSessionId: text(row, 'review_session_id'), riskLevel: text(row, 'risk_level'), score: numberOrNull(row, 'score'), policyVersion: text(row, 'policy_version'), summary: text(row, 'summary'), details: asRecord(row.details), createdAt: text(row, 'created_at') };
}

function mapModelConfiguration(row: Row): StoreModelConfiguration {
  return { id: text(row, 'id'), ownerId: text(row, 'owner_id'), projectId: optionalText(row, 'project_id'), purpose: text(row, 'purpose', 'static_review'), provider: text(row, 'provider'), model: text(row, 'model'), baseUrl: optionalText(row, 'base_url'), secretCiphertext: optionalText(row, 'secret_ciphertext'), fallbackProvider: optionalText(row, 'fallback_provider'), fallbackModel: optionalText(row, 'fallback_model'), enabled: bool(row, 'enabled', true), metadata: asRecord(row.metadata), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at', text(row, 'created_at')) };
}

function mapModelUsage(row: Row): StoreModelUsage {
  return { id: text(row, 'id'), projectId: optionalText(row, 'project_id'), reviewSessionId: optionalText(row, 'review_session_id'), ownerId: optionalText(row, 'owner_id'), stage: text(row, 'stage'), attempt: Number(row.attempt ?? 1), provider: text(row, 'provider'), model: text(row, 'model'), outcome: text(row, 'outcome'), inputTokens: numberOrNull(row, 'input_tokens'), outputTokens: numberOrNull(row, 'output_tokens'), cacheReadTokens: numberOrNull(row, 'cache_read_tokens'), cacheCreationTokens: numberOrNull(row, 'cache_creation_tokens'), durationMs: numberOrNull(row, 'duration_ms'), errorCode: optionalText(row, 'error_code'), cost: numberOrNull(row, 'cost'), metadata: asRecord(row.metadata), createdAt: text(row, 'created_at') };
}

function mapIntegration(row: Row): StoreIntegration {
  return { id: text(row, 'id'), ownerId: text(row, 'owner_id'), provider: text(row, 'provider'), accountLabel: text(row, 'account_label'), accountId: text(row, 'account_id'), scopes: text(row, 'scopes'), tokenReference: optionalText(row, 'token_reference'), expiresAt: optionalText(row, 'expires_at'), status: text(row, 'status', 'connected'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') };
}

function mapEmbedding(row: Row, parentType: StoreEmbeddingChunk['parentType']): StoreEmbeddingChunk {
  const parentColumn = parentType === 'artifact_version' ? 'artifact_version_id' : `${parentType}_id`;
  const rawEmbedding = Array.isArray(row.embedding) ? row.embedding.map(Number) : null;
  return { id: text(row, 'id'), projectId: text(row, 'project_id'), parentId: text(row, parentColumn), parentType, ordinal: Number(row.ordinal ?? 0), content: text(row, 'content'), contentHash: text(row, 'content_hash'), embedding: rawEmbedding, embeddingModel: optionalText(row, 'embedding_model'), metadata: asRecord(row.metadata), createdAt: text(row, 'created_at') };
}

function mapDynamic(row: Row): StoreDynamicSession {
  return { id: text(row, 'id'), projectId: text(row, 'project_id'), name: text(row, 'name'), targetUrl: text(row, 'target_url'), goal: text(row, 'goal'), missionType: text(row, 'mission_type'), status: text(row, 'status'), finalSummary: text(row, 'final_summary'), failureReason: text(row, 'failure_reason'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') };
}

async function single<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string, map: (row: Row) => T): Promise<T> {
  const result = await query;
  if (result.error) throw new Error(`Supabase ${label} query failed: ${result.error.message}`);
  return map(asRow(required(result.data, label)));
}

async function allRows<T>(
  page: (start: number, end: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  label: string,
  map: (row: Row) => T,
): Promise<T[]> {
  const results: T[] = [];
  const pageSize = 500;
  for (let start = 0; ;) {
    const { data, error } = await page(start, start + pageSize - 1);
    if (error) throw new Error(`Supabase ${label} query failed: ${error.message}`);
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) return results;
    results.push(...rows.map(row => map(asRow(row))));
    start += rows.length;
  }
}

/** Supabase adapter. All queries rely on the client user's access token/RLS. */
export class SupabaseCentinelStore implements CentinelStore {
  constructor(private readonly client: SupabaseClient) {}

  async listProjects(ownerId?: string): Promise<StoreProject[]> {
    return allRows((start, end) => {
      let query = this.client.from('projects').select('*')
        .order('created_at', { ascending: false }).order('id');
      if (ownerId) query = query.eq('owner_id', ownerId);
      return query.range(start, end);
    }, 'projects', mapProject);
  }

  async getProject(projectId: string): Promise<StoreProject | null> {
    const { data, error } = await this.client.from('projects').select('*').eq('id', projectId).maybeSingle();
    if (error) throw new Error(`Supabase project query failed: ${error.message}`);
    return data ? mapProject(asRow(data)) : null;
  }

  async createProject(input: Omit<StoreProject, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreProject> {
    const { data, error } = await this.client.from('projects').insert({ owner_id: input.ownerId, name: input.name, description: input.description, workspace_path: input.workspacePath }).select('*').single();
    if (error) throw new Error(`Supabase project creation failed: ${error.message}`);
    const project = mapProject(asRow(required(data, 'project')));
    await this.upsertProjectMember({ projectId: project.id, userId: project.ownerId, role: 'owner' });
    return project;
  }

  async listProjectMembers(projectId: string): Promise<StoreProjectMember[]> {
    return allRows((start, end) => this.client.from('project_members').select('*')
      .eq('project_id', projectId).order('created_at').order('user_id').range(start, end), 'project members', mapMember);
  }

  async upsertProjectMember(input: Omit<StoreProjectMember, 'createdAt'>): Promise<StoreProjectMember> {
    return single(this.client.from('project_members').upsert({ project_id: input.projectId, user_id: input.userId, role: input.role }, { onConflict: 'project_id,user_id' }).select('*').single(), 'project member', mapMember);
  }

  async listSources(projectId: string): Promise<StoreProjectSource[]> {
    return allRows((start, end) => this.client.from('project_sources').select('*')
      .eq('project_id', projectId).order('created_at').order('id').range(start, end), 'sources', mapSource);
  }

  async saveSource(input: Omit<StoreProjectSource, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreProjectSource> {
    return single(this.client.from('project_sources').insert({ project_id: input.projectId, integration_id: input.integrationId, kind: input.kind, name: input.name, remote_id: input.remoteId, remote_url: input.remoteUrl, sync_status: input.syncStatus, last_synced_at: input.lastSyncedAt }).select('*').single(), 'source', mapSource);
  }

  async listArtifacts(projectId: string, signal?: AbortSignal): Promise<StoreArtifact[]> {
    return allRows((start, end) => {
      let query = this.client.from('artifacts').select('*')
        .eq('project_id', projectId).order('path').order('id');
      if (signal) query = query.abortSignal(signal);
      return query.range(start, end);
    }, 'artifacts', mapArtifact);
  }

  async saveArtifact(input: Omit<StoreArtifact, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreArtifact> {
    return single(this.client.from('artifacts').upsert({ project_id: input.projectId, source_id: input.sourceId, path: input.path, name: input.name, kind: input.kind, mime_type: input.mimeType, metadata: input.metadata }, { onConflict: 'project_id,path' }).select('*').single(), 'artifact', mapArtifact);
  }

  async listArtifactVersions(artifactId: string, signal?: AbortSignal): Promise<StoreArtifactVersion[]> {
    return allRows((start, end) => {
      let query = this.client.from('artifact_versions').select('*')
        .eq('artifact_id', artifactId).order('version_number').order('id');
      if (signal) query = query.abortSignal(signal);
      return query.range(start, end);
    }, 'artifact versions', mapArtifactVersion);
  }

  async saveArtifactVersion(input: Omit<StoreArtifactVersion, 'id' | 'createdAt'>): Promise<StoreArtifactVersion> {
    return single(this.client.from('artifact_versions').upsert({ project_id: input.projectId, artifact_id: input.artifactId, version_number: input.versionNumber, content_hash: input.contentHash, byte_size: input.byteSize, storage_path: input.storagePath, source_revision: input.sourceRevision, content_type: input.contentType, metadata: input.metadata }, { onConflict: 'artifact_id,content_hash' }).select('*').single(), 'artifact version', mapArtifactVersion);
  }

  async listRequirements(projectId: string): Promise<StoreRequirement[]> {
    return allRows((start, end) => this.client.from('requirements').select('*')
      .eq('project_id', projectId).order('created_at').order('id').range(start, end), 'requirements', mapRequirement);
  }

  async saveRequirement(input: Omit<StoreRequirement, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreRequirement> {
    const payload = { project_id: input.projectId, title: input.title, description: input.description, category: input.category, priority: input.priority };
    const { data: existing } = await this.client.from('requirements').select('id').eq('project_id', input.projectId).eq('title', input.title).maybeSingle();
    return single(this.client.from('requirements').upsert((existing ? { ...payload, id: String((existing as Row).id) } : payload) as never).select('*').single(), 'requirement', mapRequirement);
  }

  async listStandards(projectId: string): Promise<StoreStandard[]> {
    return allRows((start, end) => this.client.from('project_standards').select('*')
      .eq('project_id', projectId).order('code').order('id').range(start, end), 'standards', mapStandard);
  }

  async saveStandard(input: Omit<StoreStandard, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreStandard> {
    return single(this.client.from('project_standards').upsert({ project_id: input.projectId, code: input.code, title: input.title, description: input.description, source: input.source, version: input.version, metadata: input.metadata }, { onConflict: 'project_id,code' }).select('*').single(), 'standard', mapStandard);
  }

  async listRequirementMappings(requirementId: string): Promise<StoreRequirementMapping[]> {
    return allRows((start, end) => this.client.from('requirement_mappings').select('*')
      .eq('requirement_id', requirementId).order('created_at').order('id').range(start, end), 'requirement mappings', mapMapping);
  }

  async saveRequirementMapping(input: Omit<StoreRequirementMapping, 'id' | 'createdAt'>): Promise<StoreRequirementMapping> {
    return single(this.client.from('requirement_mappings').insert({ project_id: input.projectId, requirement_id: input.requirementId, standard_id: input.standardId, artifact_id: input.artifactId, file_id: input.fileId, symbol_id: input.symbolId, coverage_status: input.coverageStatus, confidence: input.confidence }).select('*').single(), 'requirement mapping', mapMapping);
  }

  async listFindings(projectId: string, reviewSessionId?: string): Promise<StoreFinding[]> {
    return allRows((start, end) => {
      let query = this.client.from('findings').select('*').eq('project_id', projectId)
        .order('created_at', { ascending: false }).order('id');
      if (reviewSessionId) query = query.eq('review_session_id', reviewSessionId);
      return query.range(start, end);
    }, 'findings', mapFinding);
  }

  async saveFinding(input: Omit<StoreFinding, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreFinding> {
    const idempotent = input.correlationFingerprint && input.reviewSessionId
      ? await this.client.from('findings').select('id').eq('review_session_id', input.reviewSessionId).eq('correlation_fingerprint', input.correlationFingerprint).maybeSingle()
      : { data: null };
    const row = { ...(idempotent.data ? { id: String((idempotent.data as Row).id) } : {}), project_id: input.projectId, review_session_id: input.reviewSessionId, dynamic_session_id: input.dynamicSessionId, source: input.source, severity: input.severity, priority: input.priority, title: input.title, description: input.description, status: input.status, category: input.category, evidence_text: input.evidenceText, recommendation: input.recommendation, confidence: input.confidence, artifact_id: input.artifactId, artifact_version_id: input.artifactVersionId, evidence_id: input.evidenceId, requirement_id: input.requirementId, standard_id: input.standardId, verifier: input.verifier, location: input.location, correlation_fingerprint: input.correlationFingerprint };
    return single(this.client.from('findings').upsert(row).select('*').single(), 'finding', mapFinding);
  }

  async updateFindingStatus(findingId: string, status: StoreFinding['status'], actorId: string | null = null, comment = ''): Promise<StoreFinding> {
    const current = await this.client.from('findings').select('*').eq('id', findingId).single();
    if (current.error) throw new Error(`Supabase finding query failed: ${current.error.message}`);
    const currentRow = asRow(current.data);
    const oldStatus = text(currentRow, 'status', 'new');
    if (oldStatus !== status) {
      const history = await this.client.from('finding_state_history').insert({ project_id: text(currentRow, 'project_id'), finding_id: findingId, from_status: oldStatus, to_status: status, actor_id: actorId, comment }).select('*').single();
      if (history.error) throw new Error(`Supabase finding history failed: ${history.error.message}`);
    }
    return single(this.client.from('findings').update({ status, updated_at: new Date().toISOString() }).eq('id', findingId).select('*').single(), 'finding update', mapFinding);
  }

  async listFindingStateHistory(findingId: string): Promise<StoreFindingStateChange[]> {
    return allRows((start, end) => this.client.from('finding_state_history').select('*')
      .eq('finding_id', findingId).order('created_at').order('id').range(start, end), 'finding history', mapHistory);
  }

  async listReviewSessions(projectId: string): Promise<StoreReviewSession[]> {
    return allRows((start, end) => this.client.from('review_sessions').select('*')
      .eq('project_id', projectId).order('created_at', { ascending: false }).order('id').range(start, end), 'reviews', mapReview);
  }

  async getReviewSession(reviewSessionId: string): Promise<StoreReviewSession | null> {
    const { data, error } = await this.client.from('review_sessions').select('*').eq('id', reviewSessionId).maybeSingle();
    if (error) throw new Error(`Supabase review query failed: ${error.message}`);
    return data ? mapReview(asRow(data)) : null;
  }

  async saveReviewSession(input: Omit<StoreReviewSession, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<StoreReviewSession> {
    const row = { ...(input.id ? { id: input.id } : { id: crypto.randomUUID() }), project_id: input.projectId, name: input.name, review_type: input.reviewType, status: input.status, config: input.config, progress: input.progress, parent_review_id: input.parentReviewId, idempotency_key: input.idempotencyKey, source_manifest_hash: input.sourceManifestHash, final_summary: input.finalSummary, failure_reason: input.failureReason, cancelled_at: input.cancelledAt, completed_at: input.completedAt };
    const query = input.idempotencyKey
      ? this.client.from('review_sessions').upsert(row, { onConflict: 'project_id,idempotency_key' }).select('*').single()
      : this.client.from('review_sessions').upsert(row).select('*').single();
    return single(query, 'review session', mapReview);
  }

  async updateReviewSession(reviewSessionId: string, patch: Partial<Pick<StoreReviewSession, 'status' | 'progress' | 'finalSummary' | 'failureReason' | 'cancelledAt' | 'completedAt'>>): Promise<StoreReviewSession> {
    const row: Row = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.progress !== undefined) row.progress = patch.progress;
    if (patch.finalSummary !== undefined) row.final_summary = patch.finalSummary;
    if (patch.failureReason !== undefined) row.failure_reason = patch.failureReason;
    if (patch.cancelledAt !== undefined) row.cancelled_at = patch.cancelledAt;
    if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
    return single(this.client.from('review_sessions').update(row).eq('id', reviewSessionId).select('*').single(), 'review session update', mapReview);
  }

  async listReviewEvidence(reviewSessionId: string): Promise<StoreReviewEvidence[]> {
    return allRows((start, end) => this.client.from('review_evidence').select('*')
      .eq('review_session_id', reviewSessionId).order('created_at').order('id').range(start, end), 'review evidence', mapEvidence);
  }

  async saveReviewEvidence(input: Omit<StoreReviewEvidence, 'id' | 'createdAt'>): Promise<StoreReviewEvidence> {
    return single(this.client.from('review_evidence').insert({ project_id: input.projectId, review_session_id: input.reviewSessionId, artifact_version_id: input.artifactVersionId, kind: input.kind, locator: input.locator, content: input.content, storage_path: input.storagePath, content_hash: input.contentHash, metadata: input.metadata, immutable: input.immutable }).select('*').single(), 'review evidence', mapEvidence);
  }

  async listDecisions(reviewSessionId: string): Promise<StoreDecision[]> {
    return allRows((start, end) => this.client.from('review_decisions').select('*')
      .eq('review_session_id', reviewSessionId).order('created_at').order('id').range(start, end), 'decisions', mapDecision);
  }

  async saveDecision(input: Omit<StoreDecision, 'id' | 'createdAt'>): Promise<StoreDecision> {
    return single(this.client.from('review_decisions').insert({ project_id: input.projectId, review_session_id: input.reviewSessionId, decision: input.decision, comment: input.comment, reviewer: input.reviewer }).select('*').single(), 'decision', mapDecision);
  }

  async saveAssessment(input: Omit<StoreAssessment, 'id' | 'createdAt'>): Promise<StoreAssessment> {
    return single(this.client.from('review_assessments').upsert({ project_id: input.projectId, review_session_id: input.reviewSessionId, risk_level: input.riskLevel, score: input.score, policy_version: input.policyVersion, summary: input.summary, details: input.details }, { onConflict: 'review_session_id' }).select('*').single(), 'assessment', mapAssessment);
  }

  async listModelConfigurations(ownerId: string, projectId?: string | null): Promise<StoreModelConfiguration[]> {
    return allRows((start, end) => {
      let query = this.client.from('model_configurations').select('*').eq('owner_id', ownerId);
      if (projectId !== undefined) query = projectId === null ? query.is('project_id', null) : query.eq('project_id', projectId);
      return query.order('purpose').order('id').range(start, end);
    }, 'model configuration', mapModelConfiguration);
  }

  async saveModelConfiguration(input: Omit<StoreModelConfiguration, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreModelConfiguration> {
    return single(this.client.from('model_configurations').upsert({ owner_id: input.ownerId, project_id: input.projectId, purpose: input.purpose, provider: input.provider, model: input.model, base_url: input.baseUrl, secret_ciphertext: input.secretCiphertext, fallback_provider: input.fallbackProvider, fallback_model: input.fallbackModel, enabled: input.enabled, metadata: input.metadata }, { onConflict: 'owner_id,project_id,purpose' }).select('*').single(), 'model configuration', mapModelConfiguration);
  }

  async listModelUsage(reviewSessionId: string): Promise<StoreModelUsage[]> {
    return allRows((start, end) => this.client.from('model_usage_records').select('*')
      .eq('review_session_id', reviewSessionId).order('created_at').order('id').range(start, end), 'model usage', mapModelUsage);
  }

  async saveModelUsage(input: Omit<StoreModelUsage, 'id' | 'createdAt'>): Promise<StoreModelUsage> {
    return single(this.client.from('model_usage_records').insert({ project_id: input.projectId, review_session_id: input.reviewSessionId, owner_id: input.ownerId, stage: input.stage, attempt: input.attempt, provider: input.provider, model: input.model, outcome: input.outcome, input_tokens: input.inputTokens, output_tokens: input.outputTokens, cache_read_tokens: input.cacheReadTokens, cache_creation_tokens: input.cacheCreationTokens, duration_ms: input.durationMs, error_code: input.errorCode, cost: input.cost, metadata: input.metadata }).select('*').single(), 'model usage', mapModelUsage);
  }

  async listIntegrations(ownerId: string): Promise<StoreIntegration[]> {
    return allRows((start, end) => this.client.from('integrations').select('*')
      .eq('owner_id', ownerId).order('provider').order('id').range(start, end), 'integrations', mapIntegration);
  }

  async saveIntegration(input: Omit<StoreIntegration, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreIntegration> {
    return single(this.client.from('integrations').upsert({ owner_id: input.ownerId, provider: input.provider, account_label: input.accountLabel, account_id: input.accountId, scopes: input.scopes, token_reference: input.tokenReference, expires_at: input.expiresAt, status: input.status }, { onConflict: 'owner_id,provider' }).select('*').single(), 'integration', mapIntegration);
  }

  async saveEmbeddingChunk(input: Omit<StoreEmbeddingChunk, 'id' | 'createdAt'>, signal?: AbortSignal): Promise<StoreEmbeddingChunk> {
    const table = input.parentType === 'artifact_version' ? 'artifact_chunks' : input.parentType === 'requirement' ? 'requirement_chunks' : 'standard_chunks';
    const parentColumn = input.parentType === 'artifact_version' ? 'artifact_version_id' : `${input.parentType}_id`;
    const row = { project_id: input.projectId, [parentColumn]: input.parentId, ordinal: input.ordinal, content: input.content, content_hash: input.contentHash, embedding: input.embedding ? `[${input.embedding.join(',')}]` : null, embedding_model: input.embeddingModel, metadata: input.metadata };
    let existingQuery = this.client.from(table).select('id').eq(parentColumn, input.parentId).eq('content_hash', input.contentHash);
    if (signal) existingQuery = existingQuery.abortSignal(signal);
    const existing = await existingQuery.maybeSingle();
    if (existing.error) throw new Error(`Supabase embedding query failed: ${existing.error.message}`);
    if (existing.data) (row as Row).id = String((existing.data as Row).id);
    let saveQuery = this.client.from(table).upsert(row, { onConflict: `${parentColumn},content_hash` }).select('*');
    if (signal) saveQuery = saveQuery.abortSignal(signal);
    return single(saveQuery.single(), 'embedding chunk', value => mapEmbedding(value, input.parentType));
  }

  async listDynamicSessions(projectId: string): Promise<StoreDynamicSession[]> {
    const { data, error } = await this.client.from('dynamic_sessions').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
    if (error) throw new Error(`Supabase dynamic sessions query failed: ${error.message}`);
    return (data ?? []).map(row => mapDynamic(asRow(row)));
  }

}
