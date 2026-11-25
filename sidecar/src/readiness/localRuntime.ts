import { createHash } from 'node:crypto';
import type { Artifact } from '../artifacts.js';
import { isAssessmentHeld } from '../review/assessmentHold.js';
import { runGroundingWithProvider } from '../review/groundingProvider.js';
import { resolveModelProviderChain } from '../review/modelProviderResolver.js';
import type { StaticAnalysisModelProvider } from '../review/types.js';
import { isLocalRepositoryImportActive } from '../store/localProjectSources.js';
import type { LocalWorkspace } from '../store/localWorkspace.js';
import { READINESS_POLICY_VERSION } from './policy.js';
import { readinessConfigurationDigest } from './runtime.js';
import { ProjectReadinessCoordinator, type ReadinessIndex } from './service.js';
import type { ReadinessArtifact } from './types.js';
import { sourceSyncIssue } from './sourceIssues.js';

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');

function inspectLocalReadinessSources(workspace: LocalWorkspace, owner: string, projectId: string): ReadinessIndex {
  const project = workspace.project(owner, projectId);
  if (!project) throw new Error('Project is unavailable');
  const connected = workspace.connectedSources(owner);
  const excluded = new Set<string>();
  const connectedStates: unknown[] = [];
  const requirements = workspace.requirements(owner, projectId);
  requirements.requireImported();
  const sources = workspace.listLocalRepositorySources(owner, projectId);
  const records = [
    ...requirements.list().map(value => ({ value, kind: 'requirement' as const, content: `${value.title}\n${value.description}` })),
    ...requirements.rules().filter(value => value.enabled).map(value => ({ value, kind: 'coding_standard' as const,
      content: `${value.stableKey}: ${value.title}\n${value.statement}` })),
  ];
  const preloaded: ReadinessArtifact[] = records.map(({ value, kind, content }) => ({ artifact: {
    id: `${kind}:${value.id}`, projectId, type: kind, source: 'documents', fileName: value.title,
    filePath: `${kind}/${value.id}`, originalPath: null, versionId: value.updatedAt, contentHash: sha256(content), createdAt: value.createdAt,
  }, content }));
  const unavailable: ReadinessArtifact[] = [];
  let importing = false;
  for (const source of connected.listProjectSources(projectId)) {
    const run = source.latestSyncRun;
    const items = connected.listItems(source.id);
    const disconnected = source.status === 'disconnected' || source.status === 'removed';
    const terminal = source.status === 'inaccessible' || source.syncStatus === 'error'
      || run?.status === 'failure' || run?.status === 'partial' && Boolean(run.errorCode || run.retryable);
    const issue = terminal ? sourceSyncIssue(run?.errorCode, run?.status === 'partial') : null;
    for (const item of items) if (item.artifactId && (disconnected || item.status !== 'available')) excluded.add(item.artifactId);
    connectedStates.push([source.id, source.status, source.remoteRevision, issue,
      items.map(item => [item.id, item.status, item.artifactVersionId]).sort()]);
    if (disconnected) continue;
    importing ||= source.syncStatus === 'syncing' || run?.status === 'queued' || run?.status === 'running'
      || run?.status === 'partial' && !run.errorCode && !run.retryable;
    if (issue || items.some(item => item.status === 'inaccessible' || item.status === 'unsupported')) {
      unavailable.push({ artifact: { id: `source:${source.id}`, projectId, type: 'other', source: 'repository', fileName: source.name,
        filePath: `source:${source.id}`, originalPath: null, contentHash: '', createdAt: source.createdAt }, content: null,
      unavailableReason: issue ?? 'partial_import', error: 'The connected source has incomplete or unavailable content.' });
    }
  }
  const artifacts = workspace.artifacts(owner, projectId).filter(artifact => !artifact.currency?.deprecated && !excluded.has(artifact.id));
  for (const { root, source } of sources) {
    const active = isLocalRepositoryImportActive(workspace, owner, projectId, root);
    importing ||= active;
    if (source.syncStatus === 'error' || source.syncStatus === 'syncing' && !active) {
      unavailable.push({ artifact: { id: `source:${source.id}`, projectId, type: 'other', source: 'repository',
        fileName: source.name, filePath: `source:${source.id}`, originalPath: null, contentHash: '', createdAt: source.createdAt },
      content: null, unavailableReason: 'partial_import', error: 'A local repository import did not finish. Refresh the folder before relying on full coverage.' });
    }
  }
  const fingerprint = sha256(JSON.stringify({ policyVersion: READINESS_POLICY_VERSION, description: project.description,
    artifacts: artifacts.map(artifact => [artifact.id, artifact.versionId, artifact.contentHash, artifact.type, artifact.filePath]).sort(),
    records: preloaded.map(item => [item.artifact.id, item.artifact.versionId, item.artifact.contentHash]).sort(),
    unavailable: unavailable.map(item => item.artifact.id).sort(),
    connectedStates,
  }));
  return { description: project.description, fingerprint, artifacts, unavailable, preloaded, importing };
}

export function createLocalReadinessCoordinator(workspace: LocalWorkspace, owner: string, fixtureProvider?: StaticAnalysisModelProvider) {
  const configuration = workspace.modelConfigurations(owner);
  const provider = runGroundingWithProvider(async (projectId, signal) => fixtureProvider ? {
    primaryProvider: fixtureProvider,
    primaryMetadata: { provider: 'custom', apiFormat: 'openai-compatible', model: 'fixture' },
    fallbackProvider: null,
    fallbackMetadata: null,
  } : resolveModelProviderChain(configuration, { ownerId: owner, projectId, purpose: 'static_review' }, { signal }),
  async attempt => workspace.recordGroundingModelAttempt(owner, attempt));
  const assertOwner = (userId: string) => {
    if (userId !== owner) throw new Error('Readiness owner changed');
  };
  return new ProjectReadinessCoordinator({
    store: auth => { assertOwner(auth.userId); return workspace.readiness(owner); },
    inspect: async (auth, projectId) => { assertOwner(auth.userId); return inspectLocalReadinessSources(workspace, owner, projectId); },
    read: async (auth, artifact: Artifact, signal) => {
      assertOwner(auth.userId);
      signal.throwIfAborted();
      const bytes = artifact.versionId ? workspace.sourceBytes(owner, artifact.projectId, artifact.id, artifact.versionId) : null;
      if (!bytes || bytes.contentHash !== artifact.contentHash) throw new Error('Frozen Readiness source is unavailable.');
      return bytes.content.toString('utf8');
    },
    provider: auth => { assertOwner(auth.userId); return provider; },
    assessmentHeld: isAssessmentHeld,
    configurationRevision: (auth, projectId) => { assertOwner(auth.userId); return readinessConfigurationDigest(configuration, owner, projectId); },
    interruptRunningOnRecovery: true,
  });
}
