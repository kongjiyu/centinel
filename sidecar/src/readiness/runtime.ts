import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthenticatedRequest } from '../auth/gateway.js';
import { CentinelApplicationRepository } from '../applicationRepository.js';
import { listClientArtifacts, readClientArtifactContent } from '../applicationApi.js';
import { SupabaseConnectedSourceRepository } from '../integrations/supabaseRepository.js';
import { createGroundingModelProvider } from '../review/groundingProvider.js';
import { SupabaseReadinessStore } from './repository.js';
import { ProjectReadinessCoordinator, type ReadinessIndex } from './service.js';
import type { ReadinessArtifact } from './types.js';
import { READINESS_POLICY_VERSION } from './policy.js';
import { sourceSyncIssue } from './sourceIssues.js';

export function readFrozenReadinessArtifact(auth: AuthenticatedRequest, artifact: ReadinessArtifact['artifact'], signal: AbortSignal): Promise<string> {
  return readClientArtifactContent(auth.client, auth.userId, artifact.id, artifact.versionId, signal, artifact.projectId, artifact.contentHash);
}

export function createReadinessModelProvider(auth: AuthenticatedRequest, currentAuth?: () => AuthenticatedRequest) {
  const currentClient = (): SupabaseClient => {
    const current = currentAuth?.() ?? auth;
    if (current.userId !== auth.userId) throw new Error('Readiness provider session owner changed.');
    return current.client;
  };
  return createGroundingModelProvider(currentClient, auth.userId);
}

export async function inspectReadinessSources(auth: AuthenticatedRequest, projectId: string): Promise<ReadinessIndex> {
  const repository = new CentinelApplicationRepository(auth.client, auth.userId);
  const project = await repository.getProject(projectId);
  if (!project) throw new Error('Project is unavailable');
  const [allArtifacts, sources, requirements, standards, localImports] = await Promise.all([
    listClientArtifacts(repository, projectId), new SupabaseConnectedSourceRepository(auth.client).listSources(projectId),
    repository.listRequirements(projectId), repository.listStandards(projectId),
    auth.client.from('audit_events').select('payload').eq('project_id', projectId).eq('event_type', 'local_import_coverage').order('created_at', { ascending: false }),
  ]);
  if (localImports.error) throw new Error('Local source coverage is unavailable');
  const unavailable: ReadinessArtifact[] = [];
  const preloaded: ReadinessArtifact[] = [
    ...requirements.map(value => ({ value, kind: 'requirement' as const, content: `${value.title}\n${value.description}` })),
    ...standards.map(value => ({ value, kind: 'coding_standard' as const, content: `${value.code}: ${value.title}\n${value.description}` })),
  ].map(({ value, kind, content }) => ({ artifact: {
    id: `${kind}:${value.id}`, projectId, type: kind, source: 'documents', fileName: value.title,
    filePath: `${kind}/${value.id}`, originalPath: null, versionId: value.updatedAt,
    contentHash: crypto.createHash('sha256').update(content).digest('hex'), createdAt: value.createdAt,
  }, content }));
  const excluded = new Set<string>();
  let importing = false;
  const sourceStates: unknown[] = [];
  const localRoots = new Set<string>();
  const selectedIds = new Set(allArtifacts.map(artifact => artifact.id));
  for (const event of localImports.data ?? []) {
    const coverage = event.payload as { rootHash?: string; skipped?: number; imported?: number; artifactIds?: string[] } | null;
    if (!coverage?.rootHash || localRoots.has(coverage.rootHash)) continue;
    localRoots.add(coverage.rootHash);
    if (coverage.artifactIds?.length && !coverage.artifactIds.some(id => selectedIds.has(id))) continue;
    sourceStates.push(coverage);
    if (!coverage.skipped) continue;
    unavailable.push({ artifact: { id: `local-coverage:${coverage.rootHash}`, projectId, type: 'other', source: 'repository',
      fileName: 'Local import coverage', filePath: 'local import coverage', originalPath: null, contentHash: '', createdAt: project.updatedAt },
      content: null, unavailableReason: 'partial_import', error: 'The local import skipped files because of access, file type or size limits. Supply the omitted material or complete the import before relying on full coverage.' });
  }
  const sourceRepository = new SupabaseConnectedSourceRepository(auth.client);
  for (const source of sources) {
    const items = await sourceRepository.listSourceItems(source.id);
    sourceStates.push({ id: source.id, status: source.status, revision: source.remoteRevision, sync: source.syncStatus,
      outcome: source.latestSyncRun?.status, errorCode: source.latestSyncRun?.errorCode,
      retryable: source.latestSyncRun?.retryable, items: items.map(item => [item.id, item.status, item.artifactVersionId]).sort() });
    const removed = source.status === 'removed' || source.status === 'disconnected';
    for (const item of items) if ((removed || item.status !== 'available') && item.artifactId) excluded.add(item.artifactId);
    if (removed) continue;
    const run = source.latestSyncRun;
    if (source.syncStatus === 'syncing' || run && ['queued', 'running'].includes(run.status)
      || run?.status === 'partial' && !run.errorCode && !run.retryable) importing = true;
    if (source.status === 'inaccessible' || source.syncStatus === 'error'
      || run && ['failure', 'cancelled'].includes(run.status) || run?.status === 'partial' && (run.errorCode || run.retryable)
      || items.some(item => item.status === 'inaccessible' || item.status === 'unsupported')) {
      unavailable.push({ artifact: { id: `source:${source.id}`, projectId, type: 'other',
        source: source.provider === 'github' ? 'repository' : source.provider === 'google_drive' ? 'drive' : 'documents',
        fileName: source.name, filePath: `source:${source.id}`, originalPath: null, contentHash: '', createdAt: source.createdAt },
        content: null, unavailableReason: sourceSyncIssue(run?.errorCode, run?.status === 'partial'), error: 'This connected source has an incomplete import or unavailable content. Complete the sync or restore access before relying on complete coverage.' });
    }
  }
  const artifacts = allArtifacts.filter(artifact => !excluded.has(artifact.id));
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ policyVersion: READINESS_POLICY_VERSION, description: project.description,
    artifacts: artifacts.map(artifact => [artifact.id, artifact.versionId, artifact.contentHash, artifact.type, artifact.filePath]).sort(),
    records: preloaded.map(item => [item.artifact.id, item.artifact.versionId, item.artifact.contentHash]).sort(),
    sources: sourceStates.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) })).digest('hex');
  return { description: project.description, fingerprint, artifacts, unavailable, preloaded, importing };
}

export function createProjectReadinessCoordinator(options: { jobTimeoutMs?: number } = {}) {
  return new ProjectReadinessCoordinator({
    store: auth => new SupabaseReadinessStore(auth.client, auth.userId),
    inspect: inspectReadinessSources,
    read: readFrozenReadinessArtifact,
    provider: createReadinessModelProvider,
    jobTimeoutMs: options.jobTimeoutMs,
  });
}
