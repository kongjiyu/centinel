import { createHash, randomUUID } from 'node:crypto';
import { withManagedProjectWorkspace } from '../managedProjectWorkspace.js';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Artifact, SourceCurrency } from '../artifacts.js';
import { sourceCurrency } from '../applicationApi.js';
import { DynamicContractError } from '../dynamic/types.js';
import type { StoreModelUsage, StoreProject, StoreProjectSource } from './types.js';
import { LocalRequirements, localRequirementSchema, type RequirementSnapshot } from './localRequirements.js';
import { LocalReviewRecords, localReviewSchema, type ReviewHistorySnapshot } from '../review/localReviewRecords.js';
import { LocalReviewLeases, localReviewLeaseSchema } from '../review/localReviewLeases.js';
import { LocalModelConfigurations, localModelConfigurationSchema } from '../review/localModelConfigurations.js';
import type { ModelConfigurationRecord } from '../review/modelProviderResolver.js';
import type { ModelRow } from '../modelSettings.js';
import { portableUsage } from '../model/archivedUsage.js';
import { LocalLegacyDynamicHistory, localLegacyDynamicSchema, type LegacyDynamicSnapshot } from '../dynamic/localLegacyHistory.js';
import type { ModelAttemptRecord, StaticReviewRecord } from '../review/types.js';
import type { ReviewSourceManifest, ReviewSourceManifestItem } from '../review/evidenceTypes.js';
import { MAX_DECISION_ATTACHMENT_BYTES } from '../review/decisionService.js';
import { toModelUsageRecord, type ModelUsageRecord } from '../review/usageAudit.js';
import type { ReportHistoryEntry } from '../report/history.js';
import { reportFormats, verifyArchivedReport, type ArchivedReport, type ReportFormat } from '../report/localArchive.js';
import type { ProjectReportRenderings, ProjectReportSnapshot, ReportChecksums } from '../report/types.js';
import { LocalReadinessStore, localReadinessSchema } from '../readiness/localRepository.js';
import type { ReadinessJob } from '../readiness/service.js';
import { LocalConnectedSourceRepository, localConnectedSourceSchema, type ConnectedSourceSnapshot } from '../integrations/localRepository.js';
import { LocalSourceIndexJobStore, localSourceIndexSchema } from '../review/localSourceIndexJobs.js';
import { LocalIndexRetention, localIndexRetentionSchema } from '../review/localIndexRetention.js';
import { LocalIndexArchives, localIndexArchiveSchema, type VerifiedIndexArchive } from '../review/localIndexArchive.js';
import { LocalBatchCache, localBatchCacheSchema } from '../review/localBatchCache.js';
import type { ValidatedBatchCacheRecord } from '../review/batchCheckpoint.js';
import { LocalDynamicHistory, localDynamicHistorySchema, type DynamicHistorySnapshot } from '../dynamic/localHistory.js';
import { LocalEvidenceCopies, localEvidenceCopySchema } from '../dynamic/sharedEvidence/localRepository.js';
import { LocalDynamicRunRepository } from '../dynamic/localRunRepository.js';
import { LocalDynamicFindings, localDynamicFindingSchema } from '../dynamic/findings/localRepository.js';
import { LocalDynamicReports, localDynamicReportSchema } from '../dynamic/reports/localRepository.js';
import { LocalEnvironmentRepository, localEnvironmentSchema, type EnvironmentHistorySnapshot } from '../dynamic/environment/localRepository.js';
import { LocalUnitRuns, localUnitSchema } from '../dynamic/unit/localRepository.js';
import { LocalUnitReports, localUnitReportSchema } from '../dynamic/unit/localReports.js';
import { LocalHooks, localHookSchema } from '../dynamic/workspace/localHooks.js';
import { LocalSessionCaptures, localCaptureSchema } from '../dynamic/environment/localCaptureRepository.js';

export type WorkspaceSource = {
  artifact: Artifact & { versionId: string };
  mimeType: string | null;
  bytes: Buffer;
};

type StagedWorkspaceImport = { fingerprint: string; currentVersionIds: readonly string[]; dynamicHistory?: DynamicHistorySnapshot;
  environments?: EnvironmentHistorySnapshot; reviewHistory?: ReviewHistorySnapshot; reports?: ArchivedReport[]; ownerModelSettings?: ModelRow[];
  modelUsage?: StoreModelUsage[]; legacyDynamic?: LegacyDynamicSnapshot; repositoryIndexes?: VerifiedIndexArchive[];
  reviewBatchCache?: ValidatedBatchCacheRecord[] };

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;

/** Owner-only workspace snapshots for the first local Review migration cohort. */
export class LocalWorkspace {
  private connection?: DatabaseSync;
  private readonly objects: string;

  constructor(private readonly directory: string) {
    this.objects = join(directory, 'objects');
  }

  private get db() {
    if (this.connection) return this.connection;
    mkdirSync(this.objects, { recursive: true });
    const database = new DatabaseSync(join(this.directory, 'workspace.sqlite'));
    try {
      database.exec(`
        PRAGMA busy_timeout = 2000;
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS project (
          owner TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (owner, id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS local_workspace_import (
          owner TEXT NOT NULL, project TEXT NOT NULL, fingerprint TEXT NOT NULL,
          PRIMARY KEY (owner, project), FOREIGN KEY (owner, project) REFERENCES project(owner, id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS source_version (
          owner TEXT NOT NULL, project TEXT NOT NULL, artifact TEXT NOT NULL, version TEXT NOT NULL,
          hash TEXT NOT NULL, mime TEXT, bytes INTEGER NOT NULL, metadata TEXT NOT NULL,
          PRIMARY KEY (owner, project, version),
          FOREIGN KEY (owner, project) REFERENCES project(owner, id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS current_source (
          owner TEXT NOT NULL, project TEXT NOT NULL, artifact TEXT NOT NULL, version TEXT NOT NULL,
          PRIMARY KEY (owner, project, artifact),
          FOREIGN KEY (owner, project, version) REFERENCES source_version(owner, project, version)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS local_source_currency (
          owner TEXT NOT NULL, project TEXT NOT NULL, artifact TEXT NOT NULL, payload TEXT NOT NULL,
          PRIMARY KEY (owner, project, artifact),
          FOREIGN KEY (owner, project, artifact) REFERENCES current_source(owner, project, artifact) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE IF NOT EXISTS local_repository_source (
          owner TEXT NOT NULL, project TEXT NOT NULL, root TEXT NOT NULL, payload TEXT NOT NULL,
          PRIMARY KEY (owner, project, root), FOREIGN KEY (owner, project) REFERENCES project(owner, id)
        ) STRICT;
        ${localRequirementSchema}
        ${localReviewSchema}
        ${localReviewLeaseSchema}
        ${localModelConfigurationSchema}
        ${localReadinessSchema}
        ${localConnectedSourceSchema}
        ${localSourceIndexSchema}
        ${localIndexRetentionSchema}
        ${localIndexArchiveSchema}
        ${localBatchCacheSchema}
        ${localDynamicHistorySchema}
        ${localEvidenceCopySchema}
        ${localDynamicFindingSchema}
        ${localDynamicReportSchema}
        ${localLegacyDynamicSchema}
        ${localEnvironmentSchema}
        ${localUnitSchema}
        ${localUnitReportSchema}
        ${localHookSchema}
        ${localCaptureSchema}
        CREATE TABLE IF NOT EXISTS conversation_model_attempt (
          owner TEXT NOT NULL, project TEXT NOT NULL, request TEXT NOT NULL, id TEXT NOT NULL,
          outcome TEXT NOT NULL, payload TEXT NOT NULL,
          PRIMARY KEY (owner, project, request, id),
          FOREIGN KEY (owner, project) REFERENCES project(owner, id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS local_grounding_attempt (
          owner TEXT NOT NULL, project TEXT NOT NULL, request TEXT NOT NULL, id TEXT NOT NULL,
          outcome TEXT NOT NULL, payload TEXT NOT NULL,
          PRIMARY KEY (owner, project, request, id),
          FOREIGN KEY (owner, project) REFERENCES project(owner, id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS local_project_report (
          owner TEXT NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL,
          PRIMARY KEY (owner, project, id), FOREIGN KEY (owner, project) REFERENCES project(owner, id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS local_project_report_history ON local_project_report (owner, project, created DESC, id);
        CREATE TABLE IF NOT EXISTS local_provider_test_usage (
          owner TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (owner, id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS local_index_usage (
          owner TEXT NOT NULL, project TEXT NOT NULL, review TEXT, id TEXT NOT NULL,
          outcome TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (owner, id),
          FOREIGN KEY (owner, project) REFERENCES project(owner, id),
          FOREIGN KEY (owner, project, review) REFERENCES local_review(owner, project, id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS local_index_usage_scope ON local_index_usage (owner, project, review);
        CREATE TABLE IF NOT EXISTS local_archived_model_usage (
          owner TEXT NOT NULL, project TEXT, review TEXT, dynamic_session TEXT, id TEXT NOT NULL, payload TEXT NOT NULL,
          PRIMARY KEY (owner, id), FOREIGN KEY (owner, project) REFERENCES project(owner, id),
          FOREIGN KEY (owner, project, review) REFERENCES local_review(owner, project, id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS local_archived_model_usage_scope ON local_archived_model_usage (owner, project, review, dynamic_session);
      `);
      this.connection = database;
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close() {
    this.connection?.close();
    this.connection = undefined;
  }

  importSnapshot(owner: string, project: StoreProject, sources: readonly WorkspaceSource[], requirements?: RequirementSnapshot,
    modelConfigurations?: ModelConfigurationRecord[], readinessJobs?: ReadinessJob[], connectedSources?: ConnectedSourceSnapshot,
    staging?: StagedWorkspaceImport) {
    if (!owner || project.ownerId !== owner || sources.some(({ artifact, bytes }) =>
      artifact.projectId !== project.id || !artifact.versionId || artifact.contentHash !== sha256(bytes))) {
      throw new Error('The workspace snapshot does not match its owner, project, or source hashes.');
    }
    const currentVersions = staging ? new Set(staging.currentVersionIds) : null;
    if (staging && currentVersions) {
      const versions = new Map(sources.map(({ artifact }) => [artifact.versionId, artifact.id]));
      const currentArtifacts = staging.currentVersionIds.map(version => versions.get(version));
      if (!digestPattern.test(staging.fingerprint) || versions.size !== sources.length
        || currentArtifacts.some(artifact => artifact === undefined) || new Set(currentArtifacts).size !== currentArtifacts.length) {
        throw new Error('The staged workspace has an invalid current-source manifest.');
      }
    }
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (staging) {
        const receipt = db.prepare('SELECT fingerprint FROM local_workspace_import WHERE owner = ? AND project = ?').get(owner, project.id);
        if (receipt?.fingerprint === staging.fingerprint) {
          db.exec('COMMIT');
          return;
        }
        if (receipt || this.project(owner, project.id)) throw new Error('The staging directory already contains a different copy of this project.');
      }
      db.prepare('INSERT INTO project VALUES (?, ?, ?) ON CONFLICT (owner, id) DO NOTHING')
        .run(owner, project.id, JSON.stringify(project));
      if (requirements) this.requirements(owner, project.id).seed(requirements);
      if (modelConfigurations) this.modelConfigurations(owner).seed(project.id, modelConfigurations);
      if (staging?.ownerModelSettings !== undefined) this.modelConfigurations(owner).seedOwner(staging.ownerModelSettings);
      if (readinessJobs) this.readiness(owner).seed(project.id, readinessJobs);
      const existing = db.prepare('SELECT artifact, hash, mime FROM source_version WHERE owner = ? AND project = ? AND version = ?');
      const insert = db.prepare('INSERT INTO source_version VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING');
      const selectVersion = db.prepare(`INSERT INTO current_source VALUES (?, ?, ?, ?)
        ON CONFLICT (owner, project, artifact) DO UPDATE SET version = excluded.version`);
      for (const { artifact, bytes, mimeType } of sources) {
        const saved = existing.get(owner, project.id, artifact.versionId);
        if (saved && (saved.artifact !== artifact.id || saved.hash !== artifact.contentHash || saved.mime !== mimeType)) {
          throw new Error('A frozen version ID already refers to different source evidence.');
        }
        this.saveObject(artifact.contentHash, bytes);
        insert.run(owner, project.id, artifact.id, artifact.versionId, artifact.contentHash, mimeType, bytes.length, JSON.stringify(artifact));
        if (!currentVersions || currentVersions.has(artifact.versionId)) {
          selectVersion.run(owner, project.id, artifact.id, artifact.versionId);
        }
      }
      if (staging?.repositoryIndexes) this.repositoryIndexArchives(owner).seed(project.id, staging.repositoryIndexes);
      if (connectedSources) this.connectedSources(owner).seed(project.id, connectedSources);
      if (staging?.dynamicHistory) {
        const history = this.dynamicHistory(owner);
        history.seed(project.id, staging.dynamicHistory);
        if (staging.dynamicHistory.evidenceCopies !== undefined) {
          this.evidenceCopies(owner).seed(project.id, staging.dynamicHistory.evidenceCopies, id => history.run(project.id, id));
        }
        if (staging.dynamicHistory.findings !== undefined) this.dynamicFindings(owner).seed(project.id, staging.dynamicHistory.findings);
        if (staging.dynamicHistory.reports !== undefined) this.dynamicReports(owner).seed(project.id, staging.dynamicHistory.reports);
      }
      if (staging?.environments) this.environments(owner).seed(project.id, staging.environments);
      if (staging?.dynamicHistory?.hooks !== undefined) this.hooks(owner).seed(project.id, staging.dynamicHistory.hooks);
      if (staging?.dynamicHistory?.units !== undefined) {
        const units = staging.dynamicHistory.units;
        this.unitRuns(owner).seed(project.id, units);
        if (units.reports !== undefined) this.unitReports(owner).seed(project.id, units.reports);
      }
      if (staging?.reviewHistory) {
        const history = staging.reviewHistory;
        const unavailable = history.missingSourceVersionIds ?? [];
        if (!Array.isArray(unavailable) || unavailable.some(value => typeof value !== 'string' || !value)) {
          throw new Error('Invalid list of missing frozen source versions.');
        }
        const missing = new Set(unavailable);
        const used = new Set<string>();
        const verified = new Set<string>();
        this.reviews(owner).seed(project.id, history, artifact => {
          if (!artifact.versionId) return;
          const identity = JSON.stringify([artifact.id, artifact.versionId, artifact.contentHash]);
          if (verified.has(identity)) return;
          const saved = this.sourceBytes(owner, project.id, artifact.id, artifact.versionId);
          if (!saved && missing.has(artifact.versionId)) {
            const versionExists = db.prepare('SELECT 1 FROM source_version WHERE owner = ? AND project = ? AND version = ?')
              .get(owner, project.id, artifact.versionId);
            if (versionExists) throw new Error('A frozen Review version refers to a different source.');
            used.add(artifact.versionId);
            return;
          }
          if (!saved || saved.contentHash !== artifact.contentHash) throw new Error('The archive is missing a verified frozen Review source version.');
          verified.add(identity);
        });
        if (used.size !== missing.size) throw new Error('Missing source versions must refer to unavailable frozen Review evidence.');
        if (history.decisionFiles !== undefined) this.seedDecisionFiles(owner, project.id, history.decisionFiles);
      }
      if (staging?.reviewBatchCache) this.reviewBatchCache(owner).seed(project.id, staging.reviewBatchCache);
      if (staging?.reports !== undefined) this.seedReports(owner, project.id, staging.reports);
      if (staging?.modelUsage !== undefined) this.seedModelUsage(owner, project.id, staging.modelUsage);
      if (staging?.legacyDynamic !== undefined) this.legacyDynamic(owner).seed(project.id, staging.legacyDynamic);
      if (staging) db.prepare('INSERT INTO local_workspace_import VALUES (?, ?, ?)').run(owner, project.id, staging.fingerprint);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  requirements(owner: string, project: string): LocalRequirements {
    return new LocalRequirements(this.db, owner, project);
  }

  reviews(owner: string): LocalReviewRecords {
    return new LocalReviewRecords(this.db, owner);
  }

  async reviewManifest(owner: string, review: StaticReviewRecord) {
    const { id, projectId, sourceManifestId } = review;
    const records = this.reviews(owner);
    const artifacts = sourceManifestId ? await records.loadSourceManifestArtifacts(sourceManifestId) : null;
    const capturedAt = (sourceManifestId && records.manifestCapture(projectId, sourceManifestId)) || review.createdAt;
    const base = { sessionId: id, projectId, capturedAt, updatedAt: capturedAt };
    if (!artifacts || artifacts.some(item => item.projectId !== projectId)) {
      return { ...base, status: 'unavailable', artifactCount: null, sources: [] } satisfies ReviewSourceManifest;
    }
    const version = this.db.prepare('SELECT 1 FROM source_version WHERE owner = ? AND project = ? AND artifact = ? AND version = ? AND hash = ?');
    const incomplete = artifacts.some(item => !item.versionId || !version.get(owner, projectId, item.id, item.versionId, item.contentHash));
    const withGit = artifacts.flatMap(item => item.git && /^[a-f\d]{40}(?:[a-f\d]{24})?$/i.test(item.git.commit) ? [item.git] : []);
    const sources = artifacts.map((artifact): ReviewSourceManifestItem => ({
      id: artifact.id, sessionId: id, sourceId: artifact.sourceId ?? artifact.id,
      sourceKind: artifact.source === 'documents' ? 'document' : artifact.source,
      label: artifact.filePath, artifactIds: [artifact.id], filesReviewed: 1, contentHashes: [artifact.contentHash], capturedAt,
    }));
    return { ...base, status: incomplete ? 'incomplete' : 'available', snapshotId: sourceManifestId,
      gitRefs: Array.from(new Map(withGit.map(ref => [JSON.stringify([ref.repository, ref.commit, ref.branch]), ref])).values()),
      snapshotOnlyFileCount: artifacts.length - withGit.length,
      artifacts: artifacts.map(item => ({ id: item.id, fileName: item.fileName, filePath: item.filePath,
        artifactVersionId: item.versionId ?? null, contentHash: item.contentHash })),
      sources, artifactCount: artifacts.length } as const;
  }

  private seedDecisionFiles(owner: string, project: string, files: NonNullable<ReviewHistorySnapshot['decisionFiles']>) {
    if (!Array.isArray(files)) throw new Error('Invalid Review decision files.');
    const records = this.reviews(owner);
    const insert = this.db.prepare('INSERT INTO local_review_decision_file VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const file of files) {
      if (!file || typeof file.contentBase64 !== 'string' || file.contentBase64.length > 4 * Math.ceil(MAX_DECISION_ATTACHMENT_BYTES / 3)
        || typeof file.contentHash !== 'string' || !digestPattern.test(file.contentHash)
        || !records.decisionFiles(project, file.reviewId, file.decisionId)?.some(item => item.id === file.attachmentId)) {
        throw new Error('A Review decision file is unlinked or exceeds its import limit.');
      }
      const bytes = Buffer.from(file.contentBase64, 'base64');
      if (!bytes.length || bytes.length > MAX_DECISION_ATTACHMENT_BYTES || bytes.toString('base64') !== file.contentBase64 || sha256(bytes) !== file.contentHash) {
        throw new Error('A Review decision file failed checksum or encoding verification.');
      }
      this.saveObject(file.contentHash, bytes);
      insert.run(owner, project, file.reviewId, file.decisionId, file.attachmentId, file.contentHash, bytes.length);
    }
  }

  decisionFileBytes(owner: string, project: string, review: string, decision: string, id: string): Buffer | null {
    const file = this.db.prepare(`SELECT hash, length FROM local_review_decision_file
      WHERE owner = ? AND project = ? AND review = ? AND decision = ? AND id = ?`).get(owner, project, review, decision, id);
    if (!file) return null;
    try { return this.readObject(String(file.hash), Number(file.length)); }
    catch { throw new DynamicContractError(503, 'The saved decision file is missing or failed verification.'); }
  }

  reviewLeases(owner: string): LocalReviewLeases {
    return new LocalReviewLeases(this.db, owner);
  }

  modelConfigurations(owner: string): LocalModelConfigurations {
    return new LocalModelConfigurations(this.db, owner);
  }

  get repositoryIndexRoot(): string {
    return join(this.directory, 'index');
  }

  sourceIndexJobs(owner: string): LocalSourceIndexJobStore {
    return new LocalSourceIndexJobStore(this.db, owner);
  }

  repositoryIndexRetention(owner: string, project: string): LocalIndexRetention {
    return new LocalIndexRetention(this.db, owner, project);
  }

  repositoryIndexArchives(owner: string): LocalIndexArchives {
    return new LocalIndexArchives(this.db, owner);
  }

  reviewBatchCache(owner: string): LocalBatchCache {
    return new LocalBatchCache(this.db, owner);
  }

  dynamicHistory(owner: string): LocalDynamicHistory {
    return new LocalDynamicHistory(this.db, owner, {
      save: (hash, bytes) => this.saveObject(hash, bytes),
      read: (hash, length) => this.readObject(hash, length),
    });
  }

  dynamicRuns(owner: string): LocalDynamicRunRepository {
    return new LocalDynamicRunRepository(this.db, owner, this.dynamicHistory(owner), this.environments(owner));
  }

  evidenceCopies(owner: string): LocalEvidenceCopies {
    return new LocalEvidenceCopies(this.db, owner);
  }

  dynamicFindings(owner: string): LocalDynamicFindings {
    return new LocalDynamicFindings(this.db, owner, this.dynamicHistory(owner));
  }

  dynamicReports(owner: string, secrets?: (project: string) => Promise<string[]>): LocalDynamicReports {
    return new LocalDynamicReports(this.db, owner, {
      runs: this.dynamicHistory(owner), findings: this.dynamicFindings(owner), environments: this.environments(owner),
      evidence: this.evidenceCopies(owner),
      usage: (project, run) => this.modelUsageRecords(owner, project, run, true).archived,
      secrets,
    });
  }

  dynamicRunFiles(owner: string, project: string): string {
    if (!this.project(owner, project)) throw new DynamicContractError(404, 'Project not found on this device.');
    return join(this.directory, 'browser-runs', createHash('sha256').update(JSON.stringify([owner, project])).digest('hex'));
  }

  saveDynamicUsage(owner: string, project: string, run: string,
    usage: Omit<StoreModelUsage, 'id' | 'createdAt' | 'ownerId' | 'projectId' | 'reviewSessionId'> & { id?: string }): void {
    const record = portableUsage({ ...usage, id: usage.id ?? randomUUID(), ownerId: owner, projectId: project,
      reviewSessionId: null, createdAt: new Date().toISOString(),
      metadata: { ...usage.metadata, callKind: 'dynamic', dynamicSessionId: run } });
    const updated = this.db.prepare(`INSERT INTO local_archived_model_usage VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, id) DO UPDATE SET payload = json_set(excluded.payload,
        '$.createdAt', json_extract(local_archived_model_usage.payload, '$.createdAt'))
      WHERE local_archived_model_usage.project = excluded.project AND local_archived_model_usage.review IS NULL
        AND local_archived_model_usage.dynamic_session = excluded.dynamic_session
        AND json_extract(local_archived_model_usage.payload, '$.outcome') = 'in_progress'`)
      .run(owner, project, null, run, record.id, JSON.stringify(record));
    if (!updated.changes) throw new Error('Dynamic model usage is already recorded or belongs to another session.');
  }

  legacyDynamic(owner: string): LocalLegacyDynamicHistory {
    return new LocalLegacyDynamicHistory(this.db, owner, {
      save: (hash, bytes) => this.saveObject(hash, bytes),
      read: (hash, length) => this.readObject(hash, length),
    });
  }

  environments(owner: string): LocalEnvironmentRepository {
    return new LocalEnvironmentRepository(this.db, owner);
  }

  unitRuns(owner: string): LocalUnitRuns {
    return new LocalUnitRuns(this.db, owner, this.environments(owner));
  }

  unitReports(owner: string, secrets?: (project: string) => Promise<string[]>): LocalUnitReports {
    return new LocalUnitReports(this.db, owner, this.unitRuns(owner), secrets);
  }

  get executionAuthorizationRoot() { return join(this.directory, 'workspace-authorizations'); }
  get unitReceiptsRoot() { return join(this.directory, 'unit-receipts'); }
  get hookReceiptsRoot() { return join(this.directory, 'hook-receipts'); }
  get browserSessionsRoot() { return join(this.directory, 'browser-sessions'); }
  get browserUploadsRoot() { return join(this.directory, 'browser-uploads'); }
  get browserDownloadsRoot() { return join(this.directory, 'browser-downloads'); }

  projectWorkspace<T extends Pick<StoreProject, 'id' | 'workspacePath'>>(owner: string, project: T) {
    return withManagedProjectWorkspace(project, owner, join(this.directory, 'managed-apps'));
  }

  sessionCaptures(owner: string): LocalSessionCaptures {
    const browser = this.dynamicRuns(owner), units = this.unitRuns(owner), hooks = this.hooks(owner);
    return new LocalSessionCaptures(this.db, owner, this.environments(owner), async project => {
      await browser.recoverRuns(project);
      await units.recover(project);
      await hooks.recover(project);
    });
  }

  hooks(owner: string): LocalHooks {
    return new LocalHooks(this.db, owner, this.environments(owner));
  }

  get environmentValuesRoot(): string {
    return join(this.directory, 'environment-values');
  }

  readiness(owner: string): LocalReadinessStore {
    return new LocalReadinessStore(this.db, owner);
  }

  connectedSources(owner: string, accounts?: ConstructorParameters<typeof LocalConnectedSourceRepository>[3]) {
    return new LocalConnectedSourceRepository(this.db, this, owner, accounts);
  }

  recordConversationModelAttempt(owner: string, attempt: ModelAttemptRecord): void {
    this.recordProjectModelAttempt('conversation_model_attempt', owner, attempt);
  }

  recordGroundingModelAttempt(owner: string, attempt: ModelAttemptRecord): void {
    this.recordProjectModelAttempt('local_grounding_attempt', owner, attempt);
  }

  async saveProviderTestUsage(owner: string, usage: Omit<StoreModelUsage, 'id' | 'createdAt'>): Promise<void> {
    if (usage.ownerId !== owner || usage.projectId !== null || usage.reviewSessionId !== null) throw new Error('Provider test usage scope mismatch.');
    const id = randomUUID();
    this.db.prepare('INSERT INTO local_provider_test_usage VALUES (?, ?, ?)')
      .run(owner, id, JSON.stringify({ ...usage, id, createdAt: new Date().toISOString() }));
  }

  async saveIndexUsage(owner: string, usage: Omit<StoreModelUsage, 'id' | 'createdAt'> & { id?: string }): Promise<void> {
    if (usage.ownerId !== owner || !usage.projectId || !usage.id) throw new Error('Index usage scope mismatch.');
    const createdAt = new Date().toISOString();
    const result = this.db.prepare(`INSERT INTO local_index_usage VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, id) DO UPDATE SET outcome = excluded.outcome,
        payload = json_set(excluded.payload, '$.createdAt', local_index_usage.created)
      WHERE local_index_usage.project = excluded.project AND local_index_usage.review IS excluded.review
        AND local_index_usage.outcome = 'in_progress'`)
      .run(owner, usage.projectId, usage.reviewSessionId, usage.id, usage.outcome, createdAt, JSON.stringify({ ...usage, createdAt }));
    if (!result.changes) throw new Error('Index usage is already recorded or belongs to another scope.');
  }

  private seedModelUsage(owner: string, project: string, rows: StoreModelUsage[]) {
    if (!Array.isArray(rows)) throw new Error('Invalid model usage archive.');
    const insert = this.db.prepare('INSERT INTO local_archived_model_usage VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING');
    const lookup = this.db.prepare('SELECT project, review, dynamic_session FROM local_archived_model_usage WHERE owner = ? AND id = ?');
    const ids = new Set<string>();
    for (const input of rows) {
      const usage = portableUsage(input);
      if (usage.ownerId !== owner || usage.projectId !== null && usage.projectId !== project || ids.has(usage.id)) {
        throw new Error('An archived usage record is duplicated or outside the workspace scope.');
      }
      ids.add(usage.id);
      const dynamic = typeof usage.metadata.dynamicSessionId === 'string' ? usage.metadata.dynamicSessionId : null;
      const saved = lookup.get(owner, usage.id);
      if (saved && (saved.project !== usage.projectId || saved.review !== usage.reviewSessionId || saved.dynamic_session !== dynamic)) {
        throw new Error('An archived model usage ID already belongs to a different session.');
      }
      insert.run(owner, usage.projectId, usage.reviewSessionId, dynamic, usage.id, JSON.stringify(usage));
    }
  }

  modelUsageRecords(owner: string, project?: string, session?: string, dynamic?: boolean) {
    const read = (table: 'local_review_attempt' | 'conversation_model_attempt' | 'local_grounding_attempt', review?: string) => this.db.prepare(
      `SELECT payload FROM ${table} WHERE owner = ?${project ? ' AND project = ?' : ''}${review ? ' AND review = ?' : ''}`)
      .all(owner, ...(project ? [project] : []), ...(review ? [review] : []))
      .map(row => JSON.parse(String(row.payload)) as ModelUsageRecord);
    const direct = project || session ? [] : this.db.prepare('SELECT payload FROM local_provider_test_usage WHERE owner = ?').all(owner)
      .map(row => JSON.parse(String(row.payload)) as StoreModelUsage);
    const index = this.db.prepare(`SELECT payload FROM local_index_usage WHERE owner = ?${project ? ' AND project = ?' : ''}${session ? ' AND review = ?' : ''}`)
      .all(owner, ...(project ? [project] : []), ...(session ? [session] : []))
      .map(row => JSON.parse(String(row.payload)) as StoreModelUsage);
    const archived = this.db.prepare(`SELECT payload FROM local_archived_model_usage WHERE owner = ?${project ? ' AND project = ?' : ''}
      ${session ? dynamic ? 'AND dynamic_session = ?' : 'AND review = ?' : ''}`)
      .all(owner, ...(project ? [project] : []), ...(session ? [session] : []))
      .map(row => JSON.parse(String(row.payload)) as StoreModelUsage);
    return { reviews: dynamic && session ? [] : read('local_review_attempt', session), conversation: session ? [] : read('conversation_model_attempt'),
      grounding: session ? [] : read('local_grounding_attempt'), direct, index, archived };
  }

  hasArchivedDynamicUsage(owner: string, project: string, session: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM local_archived_model_usage WHERE owner = ? AND project = ? AND dynamic_session = ? LIMIT 1')
      .get(owner, project, session));
  }

  private recordProjectModelAttempt(table: 'conversation_model_attempt' | 'local_grounding_attempt', owner: string, attempt: ModelAttemptRecord): void {
    const record = toModelUsageRecord(attempt);
    if (!record.id) throw new Error('The model attempt has no durable ID.');
    this.db.prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, project, request, id) DO UPDATE SET outcome = excluded.outcome, payload = excluded.payload
      WHERE ${table}.outcome = 'in_progress' OR excluded.outcome <> 'in_progress'`)
      .run(owner, record.projectId, record.reviewId, record.id, record.outcome, JSON.stringify(record));
  }

  projects(owner: string): StoreProject[] {
    return this.db.prepare('SELECT payload FROM project WHERE owner = ? ORDER BY id')
      .all(owner).map(row => JSON.parse(String(row.payload)) as StoreProject);
  }

  project(owner: string, project: string): StoreProject | null {
    const row = this.db.prepare('SELECT payload FROM project WHERE owner = ? AND id = ?').get(owner, project);
    return row ? JSON.parse(String(row.payload)) as StoreProject : null;
  }

  createProject(owner: string, input: Pick<StoreProject, 'name' | 'description' | 'workspacePath'>): StoreProject {
    const now = new Date().toISOString();
    const project = { ...input, id: randomUUID(), ownerId: owner, createdAt: now, updatedAt: now };
    this.importSnapshot(owner, project, [], { requirements: [], mappings: [], candidates: [], standardRules: [] });
    return project;
  }

  localRepositorySource(owner: string, project: string, root: string): StoreProjectSource | null {
    const row = this.db.prepare('SELECT payload FROM local_repository_source WHERE owner = ? AND project = ? AND root = ?')
      .get(owner, project, root);
    return row ? JSON.parse(String(row.payload)) as StoreProjectSource : null;
  }

  listLocalRepositorySources(owner: string, project: string): Array<{ root: string; source: StoreProjectSource }> {
    return this.db.prepare('SELECT root, payload FROM local_repository_source WHERE owner = ? AND project = ? ORDER BY root')
      .all(owner, project).map(row => ({ root: String(row.root), source: JSON.parse(String(row.payload)) as StoreProjectSource }));
  }

  saveLocalRepositorySource(owner: string, root: string, source: StoreProjectSource): void {
    this.db.prepare(`INSERT INTO local_repository_source VALUES (?, ?, ?, ?)
      ON CONFLICT (owner, project, root) DO UPDATE SET payload = excluded.payload`)
      .run(owner, source.projectId, root, JSON.stringify(source));
  }

  updateProject(owner: string, project: string, fields: Partial<Pick<StoreProject, 'name' | 'description' | 'workspacePath'>>): StoreProject | null {
    const row = this.db.prepare(`UPDATE project SET payload = json_patch(payload, ?)
      WHERE owner = ? AND id = ? RETURNING payload`)
      .get(JSON.stringify({ ...fields, updatedAt: new Date().toISOString() }), owner, project);
    return row ? JSON.parse(String(row.payload)) as StoreProject : null;
  }

  artifacts(owner: string, project: string): Artifact[] {
    return this.db.prepare(`SELECT v.metadata, currency.payload AS currency FROM current_source AS c JOIN source_version AS v
      ON (v.owner, v.project, v.artifact, v.version) = (c.owner, c.project, c.artifact, c.version)
      LEFT JOIN local_source_currency AS currency ON (c.owner, c.project, c.artifact) = (currency.owner, currency.project, currency.artifact)
      WHERE c.owner = ? AND c.project = ? AND NOT EXISTS (
        SELECT 1 FROM local_connected_item AS item WHERE item.owner = c.owner AND item.source = json_extract(v.metadata, '$.sourceId')
        AND json_extract(item.payload, '$.artifactId') = c.artifact AND json_extract(item.payload, '$.status') = 'removed'
      ) ORDER BY c.artifact`).all(owner, project)
      .map(row => {
        const artifact = JSON.parse(String(row.metadata)) as Artifact;
        return typeof row.currency === 'string' ? { ...artifact, currency: sourceCurrency(JSON.parse(row.currency)) } : artifact;
      });
  }

  connectedArtifact(owner: string, project: string, source: string, path: string): Artifact | null {
    const row = this.db.prepare(`SELECT v.metadata FROM current_source AS c JOIN source_version AS v
      ON (v.owner, v.project, v.artifact, v.version) = (c.owner, c.project, c.artifact, c.version)
      WHERE c.owner = ? AND c.project = ? AND json_extract(v.metadata, '$.sourceId') = ? AND json_extract(v.metadata, '$.filePath') = ?`)
      .get(owner, project, source, path);
    return row ? JSON.parse(String(row.metadata)) as Artifact : null;
  }

  matchSourceVersion(owner: string, project: string, id: string, hash: string, mime: string): (Artifact & { versionId: string }) | null {
    const row = this.db.prepare(`SELECT metadata FROM source_version WHERE owner = ? AND project = ? AND artifact = ? AND hash = ? AND mime = ?
      ORDER BY version LIMIT 1`).get(owner, project, id, hash, mime);
    return row ? JSON.parse(String(row.metadata)) as Artifact & { versionId: string } : null;
  }

  setArtifactCurrency(owner: string, project: string, artifact: string, action: 'confirm' | 'deprecate' | 'restore'): SourceCurrency | null {
    const now = new Date().toISOString();
    const patch = action === 'confirm' ? { confirmedAt: now, confirmedBy: owner }
      : action === 'deprecate' ? { deprecated: true, deprecatedAt: now, deprecatedBy: owner }
      : { deprecated: false, deprecatedAt: null, deprecatedBy: null };
    const patchJson = JSON.stringify(patch);
    const row = this.db.prepare(`INSERT INTO local_source_currency (owner, project, artifact, payload)
      SELECT c.owner, c.project, c.artifact, json_patch(COALESCE(v.metadata -> '$.currency', '{}'), ?)
      FROM current_source AS c JOIN source_version AS v
      ON (v.owner, v.project, v.artifact, v.version) = (c.owner, c.project, c.artifact, c.version)
      WHERE c.owner = ? AND c.project = ? AND c.artifact = ?
      ON CONFLICT (owner, project, artifact) DO UPDATE SET payload = json_patch(local_source_currency.payload, ?)
      RETURNING payload`).get(patchJson, owner, project, artifact, patchJson);
    return row ? sourceCurrency(JSON.parse(String(row.payload))) : null;
  }

  removeCurrentArtifact(owner: string, project: string, artifact: string): boolean {
    return this.db.prepare('DELETE FROM current_source WHERE owner = ? AND project = ? AND artifact = ?')
      .run(owner, project, artifact).changes === 1;
  }

  content(owner: string, project: string, artifact: string, version?: string) {
    const stored = this.sourceBytes(owner, project, artifact, version);
    return stored ? { ...stored, content: stored.content.toString('base64') } : null;
  }

  sourceBytes(owner: string, project: string, artifact: string, version?: string) {
    const selected = version ?? this.db.prepare('SELECT version FROM current_source WHERE owner = ? AND project = ? AND artifact = ?')
      .get(owner, project, artifact)?.version;
    if (typeof selected !== 'string') return null;
    const row = this.db.prepare(`SELECT hash, mime, bytes FROM source_version WHERE owner = ? AND project = ?
      AND artifact = ? AND version = ?`).get(owner, project, artifact, selected);
    if (!row) return null;
    try {
      const hash = String(row.hash);
      return { versionId: selected, content: this.readObject(hash, Number(row.bytes)), contentHash: hash,
        mimeType: row.mime === null ? null : String(row.mime) };
    } catch {
      throw new DynamicContractError(503, 'The local source version is missing or failed verification.');
    }
  }

  private readObject(hash: string, length: number): Buffer {
    if (!digestPattern.test(hash)) throw new Error('Invalid source digest.');
    const bytes = readFileSync(join(this.objects, hash));
    if (bytes.length !== length || sha256(bytes) !== hash) throw new Error('Source verification failed.');
    return bytes;
  }

  private saveObject(hash: string, bytes: Buffer) {
    try {
      this.readObject(hash, bytes.length);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const staging = join(this.objects, randomUUID() + '.partial');
      try {
        writeFileSync(staging, bytes, { flag: 'wx', flush: true });
        renameSync(staging, join(this.objects, hash));
      } finally {
        rmSync(staging, { force: true });
      }
    }
  }

  saveReport(owner: string, snapshot: ProjectReportSnapshot, rendered: ProjectReportRenderings, checksums: ReportChecksums) {
    const { reportId, generatedAt, actorId, riskPolicyVersion, generatorVersion } = snapshot.metadata;
    const project = snapshot.project.id;
    if (owner !== actorId || !this.project(owner, project)) throw new Error('The report does not belong to this local project.');
    const files = { json: Buffer.from(rendered.json), markdown: Buffer.from(rendered.markdown), pdf: rendered.pdf };
    this.saveReportPackage(owner, { id: reportId, projectId: project, actorId, generatorVersion, policyVersion: riskPolicyVersion,
      snapshot: JSON.parse(rendered.json), checksum: checksums.package, createdAt: generatedAt }, files, checksums);
  }

  private seedReports(owner: string, project: string, reports: readonly ArchivedReport[]) {
    if (!Array.isArray(reports)) throw new Error('Invalid report history archive.');
    for (const item of reports) {
      const history = item?.history;
      if (!history || history.projectId !== project || typeof history.id !== 'string' || !history.id
        || typeof history.generatorVersion !== 'string' || typeof history.policyVersion !== 'string'
        || history.actorId !== null && typeof history.actorId !== 'string' || !Number.isFinite(Date.parse(history.createdAt))) {
        throw new Error('An archived report has invalid project metadata.');
      }
      if (item.files === null) {
        const saved = { ...history, storage: { json: null, markdown: null, pdf: null } };
        this.writeReport(owner, saved, null);
        continue;
      }
      const values = item.files;
      if (!values || reportFormats.some(format => typeof values[format] !== 'string')) throw new Error('Invalid archived report file encoding.');
      const files = { json: Buffer.from(values.json, 'base64'), markdown: Buffer.from(values.markdown, 'base64'), pdf: Buffer.from(values.pdf, 'base64') };
      if (reportFormats.some(format => files[format].toString('base64') !== values[format])) throw new Error('Invalid archived report file encoding.');
      const { snapshot, checksums } = verifyArchivedReport(history, files);
      this.saveReportPackage(owner, { ...history, snapshot }, files, checksums);
    }
  }

  private saveReportPackage(owner: string, history: ArchivedReport['history'], files: Record<ReportFormat, Buffer>, checksums: ReportChecksums) {
    const hashes = { json: checksums.snapshot, markdown: checksums.markdown, pdf: checksums.pdf };
    for (const format of reportFormats) {
      if (sha256(files[format]) !== hashes[format]) throw new Error('The report checksums do not match.');
      this.saveObject(hashes[format], files[format]);
    }
    this.writeReport(owner, { ...history, storage: hashes }, { json: files.json.length, markdown: files.markdown.length, pdf: files.pdf.length });
  }

  private writeReport(owner: string, history: ReportHistoryEntry, lengths: Record<ReportFormat, number> | null) {
    this.db.prepare('INSERT INTO local_project_report VALUES (?, ?, ?, ?, ?)')
      .run(owner, history.projectId, history.id, history.createdAt, JSON.stringify({ history, lengths }));
  }

  listReports(owner: string, project: string): ReportHistoryEntry[] {
    return this.db.prepare('SELECT payload FROM local_project_report WHERE owner = ? AND project = ? ORDER BY created DESC, id LIMIT 50')
      .all(owner, project).map(row => (JSON.parse(String(row.payload)) as { history: ReportHistoryEntry }).history);
  }

  reportAvailability(owner: string, project: string, id: string): 'missing' | 'unavailable' | 'available' {
    const row = this.db.prepare(`SELECT json_type(payload, '$.lengths') AS file_type FROM local_project_report
      WHERE owner = ? AND project = ? AND id = ?`).get(owner, project, id);
    return !row ? 'missing' : row.file_type === 'object' ? 'available' : 'unavailable';
  }

  reportBytes(owner: string, project: string, id: string, format: 'json' | 'markdown' | 'pdf'): Buffer | null {
    const row = this.db.prepare('SELECT payload FROM local_project_report WHERE owner = ? AND project = ? AND id = ?').get(owner, project, id);
    if (!row) return null;
    const { history, lengths } = JSON.parse(String(row.payload)) as { history: ReportHistoryEntry; lengths: Record<ReportFormat, number> | null };
    const hash = history.storage[format];
    if (!hash || !lengths) return null;
    return this.readObject(hash, lengths[format]);
  }
}
