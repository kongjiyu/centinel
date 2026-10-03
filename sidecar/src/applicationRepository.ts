import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseCentinelStore } from './store/supabase.js';
import type {
  CentinelStore,
  StoreArtifact,
  StoreArtifactVersion,
  StoreAssessment,
  StoreModelConfiguration,
  StoreModelUsage,
  StoreProject,
  StoreProjectSource,
  StoreRequirement,
  StoreRequirementMapping,
  StoreStandard,
} from './store/types.js';
import {
  getProjectReportHistoryEntry as queryProjectReportHistoryEntry,
  listProjectReportHistory as queryProjectReportHistory,
  renewProjectReportLinks as renewProjectReportLinksWithClient,
  type ReportDownloadLinks,
  type ReportHistoryEntry,
} from './report/history.js';

/**
 * The only durable repository boundary used by request-scoped application
 * code. The client is supplied by the authenticated request and therefore
 * carries that request's bearer token/RLS context. This class intentionally
 * has no service-role or anonymous fallback.
 */
export type ApplicationRepositoryOptions = {
  client: SupabaseClient;
  userId: string;
};

export class ApplicationRepositoryAuthorizationError extends Error {
  readonly statusCode = 403;
  readonly code: string;

  constructor(projectId: string, code = 'project_access_denied') {
    super(code === 'project_owner_required'
      ? `You must own project ${projectId} to perform this operation.`
      : `You do not have access to project ${projectId}.`);
    this.name = 'ApplicationRepositoryAuthorizationError';
    this.code = code;
  }
}

export class ApplicationRepositoryError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, code = 'repository_error', statusCode = 500) {
    super(message);
    this.name = 'ApplicationRepositoryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

type Row = Record<string, unknown>;

type StorageBucket = {
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
};

function row(value: unknown): Row {
  return value && typeof value === 'object' ? value as Row : {};
}

function safeFileName(value: string): string {
  const base = value.trim().replace(/[\\/\0]/g, '_').replace(/\.\.+/g, '.');
  return base.slice(0, 180) || 'attachment';
}

function bytes(value: Buffer | Uint8Array | string): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function hash(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message ?? '');
  return String(error ?? '');
}

async function removeStorageObjects(bucket: StorageBucket, paths: string[], label: string): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += 100) {
    const result = await bucket.remove(paths.slice(offset, offset + 100));
    if (result.error) throw new ApplicationRepositoryError(`${label}: ${result.error.message}`, 'storage_cleanup_failed', 502);
  }
}

function mapRequirement(value: unknown): StoreRequirement {
  const source = row(value);
  return {
    id: String(source.id ?? ''), projectId: String(source.project_id ?? ''), title: String(source.title ?? ''),
    description: String(source.description ?? ''), category: String(source.category ?? ''), priority: String(source.priority ?? 'medium'),
    createdAt: String(source.created_at ?? ''), updatedAt: String(source.updated_at ?? source.created_at ?? ''),
  };
}

function mapProject(value: unknown): StoreProject {
  const source = row(value);
  return {
    id: String(source.id ?? ''), ownerId: String(source.owner_id ?? ''), name: String(source.name ?? ''),
    description: String(source.description ?? ''), workspacePath: String(source.workspace_path ?? ''),
    createdAt: String(source.created_at ?? ''), updatedAt: String(source.updated_at ?? ''),
  };
}

/**
 * Request-scoped application repository. Every project-scoped method performs
 * an RLS-backed membership check before delegating to the domain store. The
 * same client is used for row and Storage operations, so a caller cannot
 * accidentally combine a member's rows with an unscoped Storage request.
 */
export class CentinelApplicationRepository {
  readonly store: CentinelStore;
  readonly client: SupabaseClient;
  readonly userId: string;

  constructor(options: ApplicationRepositoryOptions);
  constructor(client: SupabaseClient, userId: string);
  constructor(optionsOrClient: ApplicationRepositoryOptions | SupabaseClient, legacyUserId?: string) {
    const options: ApplicationRepositoryOptions = legacyUserId
      ? { client: optionsOrClient as SupabaseClient, userId: legacyUserId }
      : optionsOrClient as ApplicationRepositoryOptions;
    if (!options.client) throw new ApplicationRepositoryError('An authenticated Supabase client is required.', 'missing_client', 503);
    if (!options.userId?.trim()) throw new ApplicationRepositoryError('An authenticated user id is required.', 'missing_user', 401);
    this.client = options.client;
    this.userId = options.userId;
    this.store = new SupabaseCentinelStore(options.client);
  }

  /** The client is intentionally exposed read-only for narrow adapters. */
  get rlsClient(): SupabaseClient {
    return this.client;
  }

  async requireProjectMember(projectId: string, signal?: AbortSignal): Promise<void> {
    let query = this.client.from('projects').select('id').eq('id', projectId);
    if (signal) query = query.abortSignal(signal);
    const result = await query.maybeSingle();
    if (result.error) throw new ApplicationRepositoryError(`Project authorization failed: ${result.error.message}`, 'authorization_unavailable', 503);
    if (!result.data) throw new ApplicationRepositoryAuthorizationError(projectId);
  }

  private async requireProjectOwner(projectId: string): Promise<void> {
    const result = await this.client.from('projects').select('owner_id').eq('id', projectId).maybeSingle();
    if (result.error) throw new ApplicationRepositoryError(`Project authorization failed: ${result.error.message}`, 'authorization_unavailable', 503);
    if (!result.data) throw new ApplicationRepositoryAuthorizationError(projectId);
    if (String(row(result.data).owner_id ?? '') !== this.userId) {
      throw new ApplicationRepositoryAuthorizationError(projectId, 'project_owner_required');
    }
  }

  private async requireScopedRecord(tableName: string, projectId: string, recordId: string, label: string): Promise<void> {
    const result = await this.client.from(tableName).select('id').eq('id', recordId).eq('project_id', projectId).maybeSingle();
    if (result.error) throw new ApplicationRepositoryError(`${label} lookup failed: ${result.error.message}`, 'related_record_lookup_failed', 503);
    if (!result.data) throw new ApplicationRepositoryError(`${label} not found in this project.`, `${tableName.replace(/s$/, '')}_not_found`, 404);
  }

  private async resolveProjectId(tableName: string, recordId: string, label: string): Promise<string | null> {
    const result = await this.client.from(tableName).select('project_id').eq('id', recordId).maybeSingle();
    if (result.error) throw new ApplicationRepositoryError(`${label} lookup failed: ${result.error.message}`, 'related_record_lookup_failed', 503);
    if (!result.data) return null;
    const projectId = String(row(result.data).project_id ?? '');
    if (!projectId) throw new ApplicationRepositoryError(`${label} is missing its project association.`, 'project_scope_missing', 409);
    await this.requireProjectMember(projectId);
    return projectId;
  }

  async listProjects(): Promise<StoreProject[]> {
    // A prior request may have committed metadata deletion before the app
    // closed or Storage became available. Retry its durable manifest now.
    await this.drainPendingStorageCleanup();
    const projects = await this.store.listProjects();
    return projects;
  }

  private async cleanupStorageDeletionJob(scope: 'project' | 'artifact', targetId: string): Promise<void> {
    const objects: Array<{ bucket: string; path: string }> = [];
    for (let start = 0; ;) {
      const result = await this.client.from('storage_deletion_objects').select('bucket_id,path')
        .eq('scope', scope).eq('target_id', targetId).order('path').order('bucket_id').range(start, start + 499);
      if (result.error) throw new ApplicationRepositoryError(`Storage cleanup manifest lookup failed: ${result.error.message}`, 'storage_cleanup_manifest_failed', 502);
      const page = Array.isArray(result.data) ? result.data : [];
      if (!page.length) break;
      objects.push(...page.map(item => ({ bucket: String(row(item).bucket_id), path: String(row(item).path) })));
      start += page.length;
    }
    const byBucket = new Map<string, string[]>();
    for (const object of objects) byBucket.set(object.bucket, [...(byBucket.get(object.bucket) ?? []), object.path]);
    for (const [bucketName, paths] of byBucket) {
      await removeStorageObjects(this.client.storage.from(bucketName) as unknown as StorageBucket, paths, `Storage cleanup failed for ${bucketName}`);
    }
    const complete = await this.client.rpc('complete_storage_deletion', { p_scope: scope, p_target_id: targetId });
    if (complete.error || complete.data !== true) {
      throw new ApplicationRepositoryError(`Storage cleanup completion failed: ${complete.error?.message ?? 'objects remain'}`, 'storage_cleanup_incomplete', 502);
    }
  }

  private async drainPendingStorageCleanup(): Promise<void> {
    const jobs: Row[] = [];
    for (let start = 0; ;) {
      const result = await this.client.from('storage_deletion_jobs').select('scope,target_id')
        .eq('owner_id', this.userId).order('created_at').order('target_id').range(start, start + 499);
      if (result.error) {
        // Existing installations can still read projects before the additive
        // deletion migration is applied; delete actions require that migration.
        if (result.error.code === '42P01' || result.error.code === 'PGRST205') return;
        throw new ApplicationRepositoryError(`Pending Storage cleanup lookup failed: ${result.error.message}`, 'storage_cleanup_lookup_failed', 502);
      }
      const page = Array.isArray(result.data) ? result.data : [];
      if (!page.length) break;
      jobs.push(...page.map(row));
      start += page.length;
    }
    for (const value of jobs) {
      const job = row(value);
      const scope = job.scope === 'project' ? 'project' : 'artifact';
      try { await this.cleanupStorageDeletionJob(scope, String(job.target_id)); }
      catch { /* Keep the durable manifest for the next authenticated retry. */ }
    }
  }

  async getProject(projectId: string): Promise<StoreProject | null> {
    await this.requireProjectMember(projectId);
    return this.store.getProject(projectId);
  }

  async createProject(input: Omit<StoreProject, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>): Promise<StoreProject> {
    return this.store.createProject({ ...input, ownerId: this.userId });
  }

  async updateProject(projectId: string, updates: Partial<Pick<StoreProject, 'name' | 'description' | 'workspacePath'>>): Promise<StoreProject | null> {
    await this.requireProjectOwner(projectId);
    const patch: Row = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.workspacePath !== undefined) patch.workspace_path = updates.workspacePath;
    if (!Object.keys(patch).length) return this.store.getProject(projectId);
    patch.updated_at = new Date().toISOString();
    const result = await this.client.from('projects').update(patch).eq('id', projectId).eq('owner_id', this.userId).select('*').maybeSingle();
    if (result.error) throw new ApplicationRepositoryError(`Project update failed: ${result.error.message}`);
    return result.data ? mapProject(row(result.data)) : null;
  }

  /** Commits metadata deletion and a private-object manifest atomically. */
  async deleteProject(projectId: string): Promise<boolean> {
    await this.requireProjectOwner(projectId);
    const queued = await this.client.rpc('queue_storage_deletion', { p_scope: 'project', p_target_id: projectId, p_project_id: projectId });
    if (queued.error) throw new ApplicationRepositoryError(`Project deletion failed: ${queued.error.message}`, 'project_delete_commit_failed', 502);
    if (queued.data !== true) return false;
    try { await this.cleanupStorageDeletionJob('project', projectId); }
    catch { /* Metadata is already deleted; later project-list requests retry. */ }
    return true;
  }

  async listProjectMembers(projectId: string) {
    await this.requireProjectMember(projectId);
    return this.store.listProjectMembers(projectId);
  }

  async listSources(projectId: string): Promise<StoreProjectSource[]> {
    await this.requireProjectMember(projectId);
    return this.store.listSources(projectId);
  }

  async saveSource(input: Omit<StoreProjectSource, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreProjectSource> {
    await this.requireProjectMember(input.projectId);
    return this.store.saveSource(input);
  }

  async listArtifacts(projectId: string, signal?: AbortSignal) {
    await this.requireProjectMember(projectId, signal);
    return this.store.listArtifacts(projectId, signal);
  }

  /** Reject stale or foreign Review selections before creating a durable run. */
  async validateReviewScope(projectId: string, scope: {
    artifactIds: string[];
    requirementIds: string[];
    standardIds: string[];
  }): Promise<void> {
    await this.requireProjectMember(projectId);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const selections = [
      { table: 'artifacts', label: 'artifacts', ids: scope.artifactIds },
      { table: 'requirements', label: 'requirements', ids: scope.requirementIds },
      { table: 'project_standards', label: 'standards', ids: scope.standardIds },
    ];
    for (const { table, label, ids } of selections) {
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.some(id => !uuid.test(id))) {
        throw new ApplicationRepositoryError(`Selected ${label} are invalid.`, 'invalid_review_scope', 400);
      }
      // Stay below Supabase's default row cap so a large selection cannot be
      // mistaken for missing records after a truncated response.
      for (let offset = 0; offset < uniqueIds.length; offset += 100) {
        const batch = uniqueIds.slice(offset, offset + 100);
        const result = await this.client.from(table).select('id').eq('project_id', projectId).in('id', batch);
        if (result.error) throw new ApplicationRepositoryError(`Review scope lookup failed: ${result.error.message}`);
        const found = new Set((Array.isArray(result.data) ? result.data : []).map(value => String(row(value).id ?? '').toLowerCase()));
        if (batch.some(id => !found.has(id.toLowerCase()))) {
          throw new ApplicationRepositoryError(`Selected ${label} are unavailable in this project.`, 'invalid_review_scope', 400);
        }
      }
    }
  }

  /** Metadata-only artifact rows never contain authoritative bytes. */
  async saveArtifact(input: Parameters<CentinelStore['saveArtifact']>[0]) {
    await this.requireProjectMember(input.projectId);
    if (input.sourceId) await this.requireScopedRecord('project_sources', input.projectId, input.sourceId, 'Project source');
    return this.store.saveArtifact(input);
  }

  async deleteArtifact(projectId: string, artifactId: string): Promise<boolean> {
    await this.requireProjectMember(projectId);
    const artifact = await this.client.from('artifacts').select('id').eq('id', artifactId).eq('project_id', projectId).maybeSingle();
    if (artifact.error) throw new ApplicationRepositoryError(`Artifact lookup failed: ${artifact.error.message}`);
    if (!artifact.data) return false;
    const queued = await this.client.rpc('queue_storage_deletion', { p_scope: 'artifact', p_target_id: artifactId, p_project_id: projectId });
    if (queued.error) throw new ApplicationRepositoryError(`Artifact deletion failed: ${queued.error.message}`, 'artifact_delete_commit_failed', 502);
    if (queued.data !== true) return false;
    try { await this.cleanupStorageDeletionJob('artifact', artifactId); }
    catch { /* Keep the manifest for retry even if Storage is unavailable. */ }
    return true;
  }

  async deleteArtifactById(artifactId: string): Promise<boolean> {
    const projectId = await this.resolveProjectId('artifacts', artifactId, 'Artifact');
    return projectId ? this.deleteArtifact(projectId, artifactId) : false;
  }

  async listArtifactVersions(projectId: string, artifactId: string, signal?: AbortSignal): Promise<StoreArtifactVersion[]> {
    await this.requireProjectMember(projectId, signal);
    let query = this.client.from('artifacts').select('id').eq('id', artifactId).eq('project_id', projectId);
    if (signal) query = query.abortSignal(signal);
    const artifact = await query.maybeSingle();
    if (artifact.error) throw new ApplicationRepositoryError(`Artifact lookup failed: ${artifact.error.message}`);
    if (!artifact.data) throw new ApplicationRepositoryError('Artifact not found.', 'artifact_not_found', 404);
    return this.store.listArtifactVersions(artifactId, signal);
  }

  async getArtifactVersion(projectId: string, versionId: string, signal?: AbortSignal): Promise<StoreArtifactVersion | null> {
    await this.requireProjectMember(projectId, signal);
    let query = this.client.from('artifact_versions').select('*').eq('id', versionId).eq('project_id', projectId);
    if (signal) query = query.abortSignal(signal);
    const result = await query.maybeSingle();
    if (result.error) throw new ApplicationRepositoryError(`Artifact version lookup failed: ${result.error.message}`);
    return result.data ? mapArtifactVersion(row(result.data)) : null;
  }

  async listRequirements(projectId: string): Promise<StoreRequirement[]> {
    await this.requireProjectMember(projectId);
    return this.store.listRequirements(projectId);
  }

  async saveRequirement(input: Parameters<CentinelStore['saveRequirement']>[0]): Promise<StoreRequirement> {
    await this.requireProjectMember(input.projectId);
    return this.store.saveRequirement(input);
  }

  async getRequirement(projectId: string, requirementId: string): Promise<StoreRequirement | null> {
    await this.requireProjectMember(projectId);
    const result = await this.client.from('requirements').select('*').eq('id', requirementId).eq('project_id', projectId).maybeSingle();
    if (result.error) throw new ApplicationRepositoryError(`Requirement lookup failed: ${result.error.message}`);
    return result.data ? mapRequirement(result.data) : null;
  }

  async getRequirementById(requirementId: string): Promise<StoreRequirement | null> {
    const projectId = await this.resolveProjectId('requirements', requirementId, 'Requirement');
    return projectId ? this.getRequirement(projectId, requirementId) : null;
  }

  async updateRequirement(
    projectId: string,
    requirementId: string,
    updates: Partial<Pick<StoreRequirement, 'title' | 'description' | 'category' | 'priority'>>,
  ): Promise<StoreRequirement | null> {
    await this.requireProjectMember(projectId);
    const patch: Row = {};
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.category !== undefined) patch.category = updates.category;
    if (updates.priority !== undefined) patch.priority = updates.priority;
    if (!Object.keys(patch).length) return this.getRequirement(projectId, requirementId);
    patch.updated_at = new Date().toISOString();
    const result = await this.client.from('requirements').update(patch).eq('id', requirementId).eq('project_id', projectId).select('*').maybeSingle();
    if (result.error) throw new ApplicationRepositoryError(`Requirement update failed: ${result.error.message}`);
    return result.data ? mapRequirement(result.data) : null;
  }

  async updateRequirementById(
    requirementId: string,
    updates: Partial<Pick<StoreRequirement, 'title' | 'description' | 'category' | 'priority'>>,
  ): Promise<StoreRequirement | null> {
    const projectId = await this.resolveProjectId('requirements', requirementId, 'Requirement');
    return projectId ? this.updateRequirement(projectId, requirementId, updates) : null;
  }

  async deleteRequirement(projectId: string, requirementId: string): Promise<boolean> {
    await this.requireProjectMember(projectId);
    const result = await this.client.from('requirements').delete().eq('id', requirementId).eq('project_id', projectId).select('id');
    if (result.error) throw new ApplicationRepositoryError(`Requirement deletion failed: ${result.error.message}`);
    return Array.isArray(result.data) && result.data.length > 0;
  }

  async deleteRequirementById(requirementId: string): Promise<boolean> {
    const projectId = await this.resolveProjectId('requirements', requirementId, 'Requirement');
    return projectId ? this.deleteRequirement(projectId, requirementId) : false;
  }

  async listRequirementMappings(projectId: string, requirementId: string): Promise<StoreRequirementMapping[]> {
    await this.requireProjectMember(projectId);
    const requirement = await this.client.from('requirements').select('id').eq('id', requirementId).eq('project_id', projectId).maybeSingle();
    if (requirement.error) throw new ApplicationRepositoryError(`Requirement lookup failed: ${requirement.error.message}`);
    if (!requirement.data) throw new ApplicationRepositoryError('Requirement not found.', 'requirement_not_found', 404);
    return this.store.listRequirementMappings(requirementId);
  }

  async listRequirementMappingsForRequirement(requirementId: string): Promise<StoreRequirementMapping[]> {
    const projectId = await this.resolveProjectId('requirements', requirementId, 'Requirement');
    if (!projectId) throw new ApplicationRepositoryError('Requirement not found.', 'requirement_not_found', 404);
    return this.listRequirementMappings(projectId, requirementId);
  }

  async saveRequirementMapping(input: Parameters<CentinelStore['saveRequirementMapping']>[0]): Promise<StoreRequirementMapping> {
    await this.requireProjectMember(input.projectId);
    await this.requireScopedRecord('requirements', input.projectId, input.requirementId, 'Requirement');
    if (input.standardId) await this.requireScopedRecord('project_standards', input.projectId, input.standardId, 'Standard');
    if (input.artifactId) await this.requireScopedRecord('artifacts', input.projectId, input.artifactId, 'Artifact');
    return this.store.saveRequirementMapping(input);
  }

  async saveRequirementMappingForRequirement(input: Omit<Parameters<CentinelStore['saveRequirementMapping']>[0], 'projectId'>): Promise<StoreRequirementMapping> {
    const projectId = await this.resolveProjectId('requirements', input.requirementId, 'Requirement');
    if (!projectId) throw new ApplicationRepositoryError('Requirement not found.', 'requirement_not_found', 404);
    return this.saveRequirementMapping({ ...input, projectId });
  }

  async listStandards(projectId: string) {
    await this.requireProjectMember(projectId);
    return this.store.listStandards(projectId);
  }

  async saveStandard(input: Parameters<CentinelStore['saveStandard']>[0]): Promise<StoreStandard> {
    await this.requireProjectMember(input.projectId);
    return this.store.saveStandard(input);
  }

  async listReviewSessions(projectId: string) {
    await this.requireProjectMember(projectId);
    return this.store.listReviewSessions(projectId);
  }

  async getReviewSession(projectId: string, reviewSessionId: string) {
    await this.requireProjectMember(projectId);
    const review = await this.store.getReviewSession(reviewSessionId);
    return review?.projectId === projectId ? review : null;
  }

  async saveReviewSession(input: Parameters<CentinelStore['saveReviewSession']>[0]) {
    await this.requireProjectMember(input.projectId);
    return this.store.saveReviewSession(input);
  }

  async listFindings(projectId: string, reviewSessionId?: string) {
    await this.requireProjectMember(projectId);
    return this.store.listFindings(projectId, reviewSessionId);
  }

  async saveFinding(input: Parameters<CentinelStore['saveFinding']>[0]) {
    await this.requireProjectMember(input.projectId);
    return this.store.saveFinding(input);
  }

  async updateFindingStatus(projectId: string, findingId: string, status: Parameters<CentinelStore['updateFindingStatus']>[1], actorId: string | null = this.userId, comment = '') {
    await this.requireProjectMember(projectId);
    const finding = await this.store.listFindings(projectId);
    if (!finding.some(item => item.id === findingId)) throw new ApplicationRepositoryError('Finding not found.', 'finding_not_found', 404);
    return this.store.updateFindingStatus(findingId, status, actorId, comment);
  }

  async listReviewEvidence(projectId: string, reviewSessionId: string) {
    await this.requireProjectMember(projectId);
    return this.store.listReviewEvidence(reviewSessionId);
  }

  async saveReviewEvidence(input: Parameters<CentinelStore['saveReviewEvidence']>[0]) {
    await this.requireProjectMember(input.projectId);
    return this.store.saveReviewEvidence(input);
  }

  async listDecisions(projectId: string, reviewSessionId: string) {
    await this.requireProjectMember(projectId);
    return this.store.listDecisions(reviewSessionId);
  }

  async saveDecision(input: Parameters<CentinelStore['saveDecision']>[0]) {
    await this.requireProjectMember(input.projectId);
    return this.store.saveDecision(input);
  }

  async listDynamicSessions(projectId: string) {
    await this.requireProjectMember(projectId);
    return this.store.listDynamicSessions(projectId);
  }

  async listModelConfigurations(projectId: string | null = null) {
    if (projectId) await this.requireProjectMember(projectId);
    return this.store.listModelConfigurations(this.userId, projectId);
  }

  async saveModelConfiguration(input: Omit<StoreModelConfiguration, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreModelConfiguration> {
    if (input.ownerId !== this.userId) throw new ApplicationRepositoryAuthorizationError(input.projectId ?? 'model-configuration');
    if (input.projectId) await this.requireProjectMember(input.projectId);
    return this.store.saveModelConfiguration(input);
  }

  async listModelUsage(projectId: string, reviewSessionId: string) {
    await this.requireProjectMember(projectId);
    return this.store.listModelUsage(reviewSessionId);
  }

  async saveModelUsage(input: Omit<StoreModelUsage, 'id' | 'createdAt'>): Promise<StoreModelUsage> {
    if (input.ownerId && input.ownerId !== this.userId) throw new ApplicationRepositoryAuthorizationError(input.projectId ?? 'model-usage');
    if (input.projectId) await this.requireProjectMember(input.projectId);
    return this.store.saveModelUsage(input);
  }

  async listIntegrations() {
    return this.store.listIntegrations(this.userId);
  }

  async saveIntegration(input: Parameters<CentinelStore['saveIntegration']>[0]) {
    if (input.ownerId !== this.userId) throw new ApplicationRepositoryAuthorizationError('integration');
    return this.store.saveIntegration(input);
  }

  async saveAssessment(input: Omit<StoreAssessment, 'id' | 'createdAt'>): Promise<StoreAssessment> {
    await this.requireProjectMember(input.projectId);
    await this.requireScopedRecord('review_sessions', input.projectId, input.reviewSessionId, 'Review');
    return this.store.saveAssessment(input);
  }

  async getLatestReviewAssessment(projectId: string): Promise<StoreAssessment | null> {
    await this.requireProjectMember(projectId);
    const result = await this.client.from('review_assessments').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (result.error) throw new ApplicationRepositoryError(`Assessment query failed: ${result.error.message}`);
    if (!result.data) return null;
    const source = row(result.data);
    return {
      id: String(source.id ?? ''), projectId: String(source.project_id ?? projectId), reviewSessionId: String(source.review_session_id ?? ''), riskLevel: String(source.risk_level ?? ''),
      score: source.score == null ? null : Number(source.score), policyVersion: String(source.policy_version ?? ''), summary: String(source.summary ?? ''),
      details: source.details && typeof source.details === 'object' ? source.details as Record<string, unknown> : {}, createdAt: String(source.created_at ?? ''),
    };
  }

  /** Project assessment view built from durable Supabase findings and snapshots. */
  async getProjectAssessment(projectId: string) {
    await this.requireProjectMember(projectId);
    const { createSupabaseReportSnapshotSource } = await import('./report/supabaseSnapshot.js');
    return createSupabaseReportSnapshotSource(this.client, this.userId).getProjectAssessment(projectId);
  }

  async listProjectReportHistory(projectId: string, options: { limit?: number } = {}): Promise<ReportHistoryEntry[]> {
    return queryProjectReportHistory(this.client, projectId, options);
  }

  async getProjectReportHistoryEntry(projectId: string, reportId: string): Promise<ReportHistoryEntry | null> {
    return queryProjectReportHistoryEntry(this.client, projectId, reportId);
  }

  async renewProjectReportLinks(projectId: string, reportId: string): Promise<ReportDownloadLinks> {
    return renewProjectReportLinksWithClient(this.client, projectId, reportId);
  }

  /**
   * Upload bytes first and commit the immutable version row second. A version
   * is identified by the content hash and can never point at a local file.
   * If the row cannot be committed, only the object created by this request
   * is removed as compensation.
   */
  async uploadArtifactVersion(input: {
    projectId: string;
    artifactId: string;
    content: Buffer | Uint8Array | string;
    versionNumber?: number;
    sourceRevision?: string | null;
    contentType?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<StoreArtifactVersion> {
    await this.requireProjectMember(input.projectId);
    const artifact = await this.client.from('artifacts').select('id').eq('id', input.artifactId).eq('project_id', input.projectId).maybeSingle();
    if (artifact.error) throw new ApplicationRepositoryError(`Artifact lookup failed: ${artifact.error.message}`);
    if (!artifact.data) throw new ApplicationRepositoryError('Artifact not found.', 'artifact_not_found', 404);

    const content = bytes(input.content);
    const contentHash = hash(content);
    const existing = await this.client.from('artifact_versions').select('*')
      .eq('artifact_id', input.artifactId).eq('content_hash', contentHash).maybeSingle();
    if (existing.error) throw new ApplicationRepositoryError(`Artifact version lookup failed: ${existing.error.message}`);
    if (existing.data) {
      const existingVersion = mapArtifactVersion(row(existing.data));
      if (!existingVersion.storagePath) throw new ApplicationRepositoryError('Artifact version exists without a private Storage object.', 'artifact_storage_missing', 409);
      const expectedPath = `${input.projectId}/${input.artifactId}/${contentHash}`;
      if (existingVersion.storagePath !== expectedPath) throw new ApplicationRepositoryError('Artifact version Storage path is outside its project and artifact scope.', 'artifact_storage_scope_invalid', 409);
      return existingVersion;
    }

    const versions = await this.store.listArtifactVersions(input.artifactId);
    const versionNumber = input.versionNumber ?? (Math.max(0, ...versions.map(version => version.versionNumber)) + 1);
    const storagePath = `${input.projectId}/${input.artifactId}/${contentHash}`;
    const upload = await this.client.storage.from('project-artifacts').upload(storagePath, content, {
      contentType: input.contentType ?? 'application/octet-stream',
      cacheControl: '31536000',
      upsert: false,
    });
    if (upload.error) throw new ApplicationRepositoryError(`Artifact content upload failed: ${errorMessage(upload.error)}`, 'artifact_upload_failed', 502);

    try {
      return await this.store.saveArtifactVersion({
        projectId: input.projectId,
        artifactId: input.artifactId,
        versionNumber,
        contentHash,
        byteSize: content.byteLength,
        storagePath,
        sourceRevision: input.sourceRevision ?? null,
        contentType: input.contentType ?? null,
        metadata: input.metadata ?? {},
      });
    } catch (error) {
      try { await this.client.storage.from('project-artifacts').remove([storagePath]); } catch { /* preserve commit error */ }
      throw new ApplicationRepositoryError(`Artifact version commit failed: ${errorMessage(error)}`, 'artifact_version_commit_failed', 502);
    }
  }

  async downloadArtifactVersion(projectId: string, versionId: string, signal?: AbortSignal): Promise<Buffer> {
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    const version = await this.getArtifactVersion(projectId, versionId, signal);
    if (!version) throw new ApplicationRepositoryError('Artifact version not found.', 'artifact_version_not_found', 404);
    if (!version.storagePath) throw new ApplicationRepositoryError('Artifact version has no private Storage object.', 'artifact_storage_missing', 409);
    if (version.storagePath !== `${projectId}/${version.artifactId}/${version.contentHash}`) {
      throw new ApplicationRepositoryError('Artifact version Storage path is outside its project and artifact scope.', 'artifact_storage_scope_invalid', 409);
    }
    const downloaded = await this.client.storage.from('project-artifacts').download(version.storagePath, {}, { signal });
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    if (downloaded.error || !downloaded.data) throw new ApplicationRepositoryError(`Artifact content download failed: ${errorMessage(downloaded.error)}`, 'artifact_download_failed', 502);
    const content = Buffer.from(await downloaded.data.arrayBuffer());
    if (hash(content) !== version.contentHash) throw new ApplicationRepositoryError('Artifact content hash verification failed.', 'artifact_hash_mismatch', 409);
    return content;
  }

  /** Upload a private decision attachment and commit metadata only afterwards. */
  async uploadDecisionAttachment(input: {
    projectId: string;
    reviewSessionId: string;
    decisionId: string;
    fileName: string;
    mimeType: string;
    content: Buffer | Uint8Array | string;
  }): Promise<{ id: string; projectId: string; decisionId: string; reviewSessionId: string; fileName: string; mimeType: string; storagePath: string; createdAt: string }> {
    await this.requireProjectMember(input.projectId);
    const decision = await this.client.from('review_decisions').select('id').eq('id', input.decisionId).eq('project_id', input.projectId).eq('review_session_id', input.reviewSessionId).maybeSingle();
    if (decision.error) throw new ApplicationRepositoryError(`Decision lookup failed: ${decision.error.message}`);
    if (!decision.data) throw new ApplicationRepositoryError('Review decision not found.', 'decision_not_found', 404);
    const createdAt = new Date().toISOString();
    const content = bytes(input.content);
    const storagePath = `${input.projectId}/${input.reviewSessionId}/${input.decisionId}/${crypto.randomUUID()}-${safeFileName(input.fileName)}`;
    const upload = await this.client.storage.from('decision-attachments').upload(storagePath, content, {
      contentType: input.mimeType,
      cacheControl: '31536000',
      upsert: false,
    });
    if (upload.error) throw new ApplicationRepositoryError(`Decision attachment upload failed: ${errorMessage(upload.error)}`, 'decision_attachment_upload_failed', 502);
    try {
      const saved = await this.client.from('review_decision_attachments').insert({
        project_id: input.projectId,
        decision_id: input.decisionId,
        storage_path: storagePath,
        file_name: input.fileName.trim(),
        mime_type: input.mimeType,
        created_at: createdAt,
      }).select('*').single();
      if (saved.error || !saved.data) throw new Error(errorMessage(saved.error) || 'attachment metadata was not returned');
      const savedRow = row(saved.data);
      return {
        id: String(savedRow.id), projectId: input.projectId, decisionId: input.decisionId,
        reviewSessionId: input.reviewSessionId, fileName: String(savedRow.file_name ?? input.fileName),
        mimeType: String(savedRow.mime_type ?? input.mimeType), storagePath,
        createdAt: String(savedRow.created_at ?? createdAt),
      };
    } catch (error) {
      try { await this.client.storage.from('decision-attachments').remove([storagePath]); } catch { /* preserve metadata error */ }
      throw new ApplicationRepositoryError(`Decision attachment metadata commit failed: ${errorMessage(error)}`, 'decision_attachment_commit_failed', 502);
    }
  }

  async createReportSnapshotSource() {
    const { createSupabaseReportSnapshotSource } = await import('./report/supabaseSnapshot.js');
    return createSupabaseReportSnapshotSource(this.client, this.userId);
  }
}

function mapArtifactVersion(value: Row): StoreArtifactVersion {
  return {
    id: String(value.id ?? ''), projectId: String(value.project_id ?? ''), artifactId: String(value.artifact_id ?? ''),
    versionNumber: Number(value.version_number ?? 1), contentHash: String(value.content_hash ?? ''),
    byteSize: value.byte_size == null ? null : Number(value.byte_size), storagePath: value.storage_path == null ? null : String(value.storage_path),
    sourceRevision: value.source_revision == null ? null : String(value.source_revision), contentType: value.content_type == null ? null : String(value.content_type),
    metadata: value.metadata && typeof value.metadata === 'object' ? value.metadata as Record<string, unknown> : {}, createdAt: String(value.created_at ?? ''),
  };
}

export function createCentinelApplicationRepository(options: ApplicationRepositoryOptions): CentinelApplicationRepository;
export function createCentinelApplicationRepository(client: SupabaseClient, userId: string): CentinelApplicationRepository;
export function createCentinelApplicationRepository(optionsOrClient: ApplicationRepositoryOptions | SupabaseClient, legacyUserId?: string): CentinelApplicationRepository {
  return legacyUserId
    ? new CentinelApplicationRepository(optionsOrClient as SupabaseClient, legacyUserId)
    : new CentinelApplicationRepository(optionsOrClient as ApplicationRepositoryOptions);
}

export const createRequestScopedApplicationRepository = createCentinelApplicationRepository;
export { CentinelApplicationRepository as SupabaseApplicationRepository };
