import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { centinelHome } from '../paths.js';
import { LocalWorkspace, type WorkspaceSource } from '../store/localWorkspace.js';
import type { RequirementSnapshot } from '../store/localRequirements.js';
import type { StoreModelUsage, StoreProject } from '../store/types.js';
import type { ModelConfigurationRecord } from '../review/modelProviderResolver.js';
import type { ReadinessJob } from '../readiness/service.js';
import type { ConnectedSourceSnapshot } from '../integrations/localRepository.js';
import type { DynamicHistorySnapshot } from '../dynamic/localHistory.js';
import type { EnvironmentHistorySnapshot } from '../dynamic/environment/localRepository.js';
import type { ReviewHistorySnapshot } from '../review/localReviewRecords.js';
import type { ArchivedReport } from '../report/localArchive.js';
import type { ModelRow } from '../modelSettings.js';
import type { LegacyDynamicSnapshot } from '../dynamic/localLegacyHistory.js';
import { mergeLegacyDynamic, readLegacyDynamic } from './readLegacyDynamic.js';
import { verifyPortableIndexArchives, type PortableIndexArchive } from '../review/localIndexArchive.js';
import { verifyPortableBatchCacheArchive, type PortableBatchCacheArchive, type ValidatedBatchCacheRecord } from '../review/batchCheckpoint.js';
import { initializePackagedModelKey } from '../tokenVault.js';

const [owner, filename, stagingDirectory, legacyFlag, legacyDatabase, ...extra] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
if (!owner || !uuid.test(owner) || !filename || !isAbsolute(filename)
  || stagingDirectory !== undefined && !isAbsolute(stagingDirectory) || extra.length
  || legacyFlag !== undefined && (legacyFlag !== '--legacy-db' || !legacyDatabase || !isAbsolute(legacyDatabase))) {
  throw new Error('Usage: pnpm --filter @centinel/sidecar migrate:workspace <owner UUID> <absolute snapshot JSON path> [absolute staging directory [--legacy-db <absolute SQLite path>]]');
}

const snapshotBytes = readFileSync(filename);
const snapshot = JSON.parse(snapshotBytes.toString('utf8').replace(/^\uFEFF/, '')) as {
  project?: StoreProject;
  sources?: Array<Omit<WorkspaceSource, 'bytes'> & { contentBase64: string }>;
  traceability?: RequirementSnapshot;
  modelConfigurations?: ModelConfigurationRecord[];
  readinessJobs?: ReadinessJob[];
  connectedSources?: ConnectedSourceSnapshot;
  currentVersionIds?: string[];
  dynamicHistory?: DynamicHistorySnapshot;
  environments?: EnvironmentHistorySnapshot;
  reviewHistory?: ReviewHistorySnapshot;
  reports?: ArchivedReport[];
  ownerModelSettings?: ModelRow[];
  modelUsage?: StoreModelUsage[];
  legacyDynamic?: LegacyDynamicSnapshot;
  repositoryIndexes?: PortableIndexArchive[];
  reviewBatchCache?: PortableBatchCacheArchive[];
} | null;
const project = snapshot?.project;
const sources = snapshot?.sources;
const traceability = snapshot?.traceability;
const modelConfigurations = snapshot?.modelConfigurations;
const readinessJobs = snapshot?.readinessJobs;
const connectedSources = snapshot?.connectedSources;
if (!project || typeof project.id !== 'string' || !uuid.test(project.id) || project.ownerId !== owner
  || typeof project.name !== 'string' || !project.name.trim()
  || typeof project.description !== 'string' || typeof project.workspacePath !== 'string'
  || !Number.isFinite(Date.parse(project.createdAt)) || !Number.isFinite(Date.parse(project.updatedAt))
  || !Array.isArray(sources) || sources.some(source => !source?.artifact
    || typeof source.artifact.id !== 'string' || !uuid.test(source.artifact.id)
    || typeof source.artifact.versionId !== 'string' || !uuid.test(source.artifact.versionId)
    || typeof source.artifact.fileName !== 'string' || typeof source.artifact.filePath !== 'string'
    || (source.mimeType !== null && typeof source.mimeType !== 'string')
    || typeof source.contentBase64 !== 'string' || Buffer.from(source.contentBase64, 'base64').toString('base64') !== source.contentBase64)) {
  throw new Error('The workspace snapshot has invalid metadata or source encoding.');
}
if (traceability !== undefined && (!Array.isArray(traceability?.requirements) || !Array.isArray(traceability.mappings)
  || traceability.candidates !== undefined && (!Array.isArray(traceability.candidates)
    || traceability.candidates.some(item => !item || item.projectId !== project.id || typeof item.statement !== 'string' || !item.sourceLocator))
  || traceability.standardRules !== undefined && (!Array.isArray(traceability.standardRules)
    || traceability.standardRules.some(item => !item || item.projectId !== project.id || typeof item.statement !== 'string'
      || typeof item.enabled !== 'boolean' || !item.sourceLocator))
  || traceability.requirements.some(item => !item || item.projectId !== project.id || typeof item.id !== 'string'
    || typeof item.title !== 'string' || typeof item.description !== 'string' || typeof item.category !== 'string'
    || typeof item.priority !== 'string' || !Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.updatedAt)))
  || traceability.mappings.some(item => !item || item.projectId !== project.id || typeof item.id !== 'string'
    || typeof item.requirementId !== 'string' || typeof item.coverageStatus !== 'string'
    || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1
    || !Number.isFinite(Date.parse(item.createdAt))))) {
  throw new Error('The workspace snapshot has invalid traceability records.');
}
if (modelConfigurations !== undefined && (!Array.isArray(modelConfigurations) || modelConfigurations.some(record => !record))) {
  throw new Error('The workspace snapshot has invalid Model Provider configuration.');
}
if (readinessJobs !== undefined && !Array.isArray(readinessJobs)) throw new Error('The workspace snapshot has invalid Readiness history.');
if (connectedSources !== undefined && (!Array.isArray(connectedSources?.sources) || !Array.isArray(connectedSources.items)
  || !Array.isArray(connectedSources.runs))) throw new Error('The workspace snapshot has invalid connected-source history.');
const currentVersionIds = snapshot?.currentVersionIds;
const dynamicHistory = snapshot?.dynamicHistory;
const environments = snapshot?.environments;
const reviewHistory = snapshot?.reviewHistory;
const reports = snapshot?.reports;
const ownerModelSettings = snapshot?.ownerModelSettings;
const modelUsage = snapshot?.modelUsage;
const repositoryIndexes = snapshot?.repositoryIndexes === undefined ? undefined
  : await verifyPortableIndexArchives(snapshot.repositoryIndexes, project.id, sources.map(source => source.artifact));
const deviceLegacy = legacyDatabase ? readLegacyDynamic(legacyDatabase, project.id) : undefined;
const legacyDynamic = deviceLegacy ? mergeLegacyDynamic(snapshot?.legacyDynamic, deviceLegacy) : snapshot?.legacyDynamic;
if (dynamicHistory !== undefined && (!dynamicHistory || !Array.isArray(dynamicHistory.missions)
  || !Array.isArray(dynamicHistory.revisions) || !Array.isArray(dynamicHistory.runs))) {
  throw new Error('The workspace snapshot has invalid Dynamic history.');
}
if (environments !== undefined && (!environments || !Array.isArray(environments.profiles) || !Array.isArray(environments.data))) {
  throw new Error('The workspace snapshot has invalid Dynamic environments.');
}
if (reviewHistory !== undefined && (!reviewHistory || !Array.isArray(reviewHistory.reviews) || !Array.isArray(reviewHistory.manifests))) {
  throw new Error('The workspace snapshot has invalid Review history.');
}
let reviewBatchCache: ValidatedBatchCacheRecord[] | undefined;
if (snapshot?.reviewBatchCache !== undefined) {
  if (!Array.isArray(snapshot.reviewBatchCache)) throw new Error('Invalid Review batch cache inventory.');
  loadEnv({ path: join(centinelHome(), '.env'), quiet: true });
  reviewBatchCache = [];
  const originIds = new Set(reviewHistory?.reviews.map(review => review.id));
  for (const item of snapshot.reviewBatchCache) {
    const record = await verifyPortableBatchCacheArchive(item, owner, project.id);
    if (!originIds.has(record.originReviewId)) throw new Error('An archived Review cache record has no staged origin Review.');
    reviewBatchCache.push(record);
  }
}
if (reports !== undefined && !Array.isArray(reports)) throw new Error('The workspace snapshot has invalid report history.');
if (ownerModelSettings !== undefined && !Array.isArray(ownerModelSettings)) throw new Error('The workspace snapshot has invalid owner Model Provider settings.');
if (modelUsage !== undefined && !Array.isArray(modelUsage)) throw new Error('The workspace snapshot has invalid model usage history.');
if ((stagingDirectory || currentVersionIds !== undefined || dynamicHistory !== undefined || environments !== undefined || reviewHistory !== undefined
  || reports !== undefined || ownerModelSettings !== undefined || modelUsage !== undefined || legacyDynamic !== undefined
  || repositoryIndexes !== undefined || reviewBatchCache !== undefined) && (!Array.isArray(currentVersionIds)
  || currentVersionIds.some(id => typeof id !== 'string' || !uuid.test(id)))) {
  throw new Error('Staging requires a currentVersionIds array containing the currently selected source version IDs.');
}

const workspace = new LocalWorkspace(stagingDirectory ?? join(centinelHome(), 'data', 'local-workspace'));
initializePackagedModelKey();
const fingerprint = createHash('sha256').update(snapshotBytes);
if (deviceLegacy) fingerprint.update('\0legacy-dynamic\0').update(JSON.stringify(deviceLegacy));
try {
  workspace.importSnapshot(owner, project, sources.map(({ artifact, mimeType, contentBase64 }) =>
    ({ artifact, mimeType, bytes: Buffer.from(contentBase64, 'base64') })), traceability, modelConfigurations, readinessJobs, connectedSources,
    currentVersionIds ? { currentVersionIds, dynamicHistory, environments, reviewHistory, reports, ownerModelSettings, modelUsage, legacyDynamic, repositoryIndexes, reviewBatchCache,
      fingerprint: fingerprint.digest('hex') } : undefined);
  console.log(JSON.stringify({ project: project.id, versions: sources.length }));
} finally {
  workspace.close();
}
