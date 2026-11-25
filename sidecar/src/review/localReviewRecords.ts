import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Artifact } from '../artifacts.js';
import { canonicalJson } from '../report/canonical.js';
import { toModelUsageRecord, type ModelUsageRecord } from './usageAudit.js';
import { RECOVERY_JOURNAL_EVENTS } from './batchCacheValidation.js';
import { analysisMapFromEvents } from './assessmentBatches.js';
import { mergeEvidenceSufficiencyAssessments, type EvidenceSufficiencyAssessment } from './evidenceSufficiency.js';
import type { FindingCorrelationSnapshot } from './correlation.js';
import { buildFrozenTraceability } from './frozenTraceability.js';
import type { ReviewTraceabilitySnapshot } from './evidenceTypes.js';
import type { ReconciliationManifest } from './findingReconciliation.js';
import { LocalRequirements } from '../store/localRequirements.js';
import type { StoreFinding, StoreFindingStateChange } from '../store/types.js';
import type { ReviewDecisionRecord } from '../staticDomainTypes.js';
import { toClientLocalReviewFinding } from './sessionPresentation.js';
import type {
  CaptureReviewTraceabilityInput, ModelAttemptRecord, NewStaticReview, PersistedReviewFinding, ReviewAuditEvent, ReviewOperationKind,
  ReviewOperationRecord, ReviewProgressState, ReviewSourceManifestMode,
  StaticReviewPatch, StaticReviewRecord, StaticReviewRepository, StaticReviewStatus,
} from './types.js';

export const localReviewSchema = `
  CREATE TABLE IF NOT EXISTS local_review (
    owner TEXT NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL, dedup_key TEXT NOT NULL,
    created TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, id), UNIQUE (owner, id), UNIQUE (owner, project, dedup_key),
    FOREIGN KEY (owner, project) REFERENCES project(owner, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_review_recent ON local_review (owner, project, created DESC, id DESC);
  CREATE TABLE IF NOT EXISTS local_review_operation (
    owner TEXT NOT NULL, project TEXT NOT NULL, operation TEXT NOT NULL, dedup_key TEXT NOT NULL,
    review TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (owner, project, operation, dedup_key),
    FOREIGN KEY (owner, project, review) REFERENCES local_review(owner, project, id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS local_review_manifest (
    owner TEXT NOT NULL, project TEXT NOT NULL, review TEXT NOT NULL, id TEXT NOT NULL,
    mode TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (owner, id), UNIQUE (owner, project, review),
    FOREIGN KEY (owner, project, review) REFERENCES local_review(owner, project, id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS local_review_finding (
    owner TEXT NOT NULL, project TEXT NOT NULL, review TEXT NOT NULL, id TEXT NOT NULL,
    observation TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, review, id), UNIQUE (owner, project, review, observation),
    FOREIGN KEY (owner, project, review) REFERENCES local_review(owner, project, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_review_findings_by_id ON local_review_finding (owner, project, id);
  CREATE TABLE IF NOT EXISTS local_finding_state_change (
    sequence INTEGER PRIMARY KEY,
    owner TEXT NOT NULL, project TEXT NOT NULL, review TEXT NOT NULL, finding TEXT NOT NULL,
    status TEXT NOT NULL, payload TEXT NOT NULL,
    FOREIGN KEY (owner, project, review, finding) REFERENCES local_review_finding(owner, project, review, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_finding_state_by_id ON local_finding_state_change (owner, project, review, finding, sequence DESC);
  CREATE TABLE IF NOT EXISTS local_review_attempt (
    owner TEXT NOT NULL, project TEXT NOT NULL, review TEXT NOT NULL, id TEXT NOT NULL,
    stage TEXT NOT NULL, attempt INTEGER NOT NULL, outcome TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, review, id),
    FOREIGN KEY (owner, project, review) REFERENCES local_review(owner, project, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_review_attempt_stage ON local_review_attempt (owner, review, stage, attempt DESC);
  CREATE TABLE IF NOT EXISTS local_review_audit (
    owner TEXT NOT NULL, project TEXT NOT NULL, review TEXT NOT NULL, id TEXT NOT NULL,
    event TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, review, id),
    FOREIGN KEY (owner, project, review) REFERENCES local_review(owner, project, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_review_audit_order ON local_review_audit (owner, project, review, created, id);
  CREATE TABLE IF NOT EXISTS local_review_snapshot (
    owner TEXT NOT NULL, project TEXT NOT NULL, review TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, review, kind), UNIQUE (owner, review, kind),
    FOREIGN KEY (owner, project, review) REFERENCES local_review(owner, project, id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS local_review_decision_file (
    owner TEXT NOT NULL, project TEXT NOT NULL, review TEXT NOT NULL, decision TEXT NOT NULL, id TEXT NOT NULL,
    hash TEXT NOT NULL, length INTEGER NOT NULL CHECK (length > 0),
    PRIMARY KEY (owner, project, review, decision, id),
    FOREIGN KEY (owner, project, review) REFERENCES local_review(owner, project, id)
  ) STRICT;
`;

const decode = <T>(row: Record<string, unknown>): T => JSON.parse(String(row.payload)) as T;
const auditId = (event: ReviewAuditEvent) => createHash('sha256').update(canonicalJson(event)).digest('hex');
const reviewStatuses = new Set<StaticReviewStatus>(['queued', 'prepared', 'running', 'blocked', 'failed', 'cancelled',
  'pending_approval', 'completed', 'approved', 'changes_requested']);
const findingStatuses = new Set(['new', 'accepted', 'dismissed', 'fixed', 'carryover']);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export type ReviewHistorySnapshot = {
  reviews: StaticReviewRecord[];
  manifests: Array<{ id: string; reviewId: string; mode: ReviewSourceManifestMode; artifacts: Artifact[]; capturedAt?: string }>;
  operations?: ReviewOperationRecord[];
  findings?: Array<{ finding: PersistedReviewFinding; stateChanges: StoreFindingStateChange[];
    disposition?: { status: StoreFinding['status']; updatedAt: string } }>;
  attempts?: ModelAttemptRecord[];
  audit?: ReviewAuditEvent[];
  traceability?: ReviewTraceabilitySnapshot[];
  sufficiency?: EvidenceSufficiencyAssessment[];
  correlations?: FindingCorrelationSnapshot[];
  decisions?: ReviewDecisionRecord[];
  decisionFiles?: { reviewId: string; decisionId: string; attachmentId: string; contentHash: string; contentBase64: string }[];
  missingSourceVersionIds?: string[];
};

function invalidHistory(message: string): never {
  throw new Error(`Invalid Review history snapshot. ${message}`);
}

export class LocalReviewRecords implements StaticReviewRepository {
  constructor(private readonly db: DatabaseSync, private readonly owner: string) {}

  /** Called inside the workspace staging transaction. */
  seed(project: string, snapshot: ReviewHistorySnapshot, verifySource: (artifact: Artifact) => void): void {
    const { reviews, manifests, operations = [], findings = [], attempts = [], audit = [],
      traceability = [], sufficiency = [], correlations = [], decisions = [] } = snapshot;
    if (![reviews, manifests, operations, findings, attempts, audit, traceability, sufficiency, correlations, decisions].every(Array.isArray)) {
      invalidHistory('Record groups must be arrays.');
    }
    const reviewIds = new Set<string>();
    const parent = (record: { projectId?: string; reviewId: string }) => {
      if (!record || record.projectId !== project || !reviewIds.has(record.reviewId)) invalidHistory('A record refers to another project or an unavailable Review.');
    };
    const insertReview = this.db.prepare('INSERT INTO local_review VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const review of reviews) {
      if (!review || review.projectId !== project || !validId(review.id) || reviewIds.has(review.id) || !reviewStatuses.has(review.status)
        || !validId(review.idempotencyKey) || typeof review.name !== 'string' || typeof review.reviewType !== 'string'
        || !validId(review.lineage?.lineageRootId) || !review.config || !review.scope || !Number.isSafeInteger(review.revision) || review.revision < 0
        || !timestamp(review.createdAt) || !timestamp(review.updatedAt)) invalidHistory('Invalid Review identity or state.');
      reviewIds.add(review.id);
      const active = review.status === 'queued' || review.status === 'running';
      const saved = active ? { ...review, status: 'blocked', failureReason: 'Execution was interrupted during migration. Saved evidence remains available.',
        modelStatus: review.modelStatus === 'not_requested' ? 'not_requested' : 'partial' } : review;
      insertReview.run(this.owner, project, review.id, review.idempotencyKey, review.createdAt, review.revision, JSON.stringify(saved));
    }
    for (const review of reviews) {
      if (review.lineage.parentReviewId && !reviewIds.has(review.lineage.parentReviewId)
        || review.iteration && !reviewIds.has(review.iteration.parentReviewId)) invalidHistory('A Review lineage link is unavailable.');
    }
    const insertManifest = this.db.prepare('INSERT INTO local_review_manifest VALUES (?, ?, ?, ?, ?, ?)');
    const manifestIds = new Set<string>();
    for (const manifest of manifests) {
      if (!manifest || !reviewIds.has(manifest.reviewId) || !validId(manifest.id) || manifestIds.has(manifest.id)
        || !['capture', 'reuse'].includes(manifest.mode) || !Array.isArray(manifest.artifacts)
        || manifest.capturedAt !== undefined && !timestamp(manifest.capturedAt)) invalidHistory('Invalid frozen source manifest.');
      for (const artifact of manifest.artifacts) {
        if (!artifact || artifact.projectId !== project || !validId(artifact.id)) invalidHistory('Frozen source belongs to another project.');
        verifySource(artifact);
      }
      manifestIds.add(manifest.id);
      insertManifest.run(this.owner, project, manifest.reviewId, manifest.id, manifest.mode, JSON.stringify(manifest.artifacts));
      if (manifest.capturedAt) this.saveSnapshot(project, manifest.reviewId, 'manifest_capture', { capturedAt: manifest.capturedAt });
    }
    if (reviews.some(review => review.sourceManifestId && !manifestIds.has(review.sourceManifestId)
      || review.iteration?.sourceManifestId && !manifestIds.has(review.iteration.sourceManifestId))) invalidHistory('A frozen source manifest is missing.');
    const insertOperation = this.db.prepare('INSERT INTO local_review_operation VALUES (?, ?, ?, ?, ?, ?)');
    for (const record of operations) {
      parent(record);
      if (!validId(record.idempotencyKey) || !timestamp(record.createdAt)
        || !['start', 'cancel', 'retry', 'prepare_iteration', 'start_iteration', 'record_decision', 'request_changes'].includes(record.operation)) {
        invalidHistory('Invalid Review operation.');
      }
      insertOperation.run(this.owner, project, record.operation, record.idempotencyKey, record.reviewId, JSON.stringify(record));
    }
    const insertFinding = this.db.prepare('INSERT INTO local_review_finding VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertChange = this.db.prepare(`INSERT INTO local_finding_state_change (owner, project, review, finding, status, payload)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const { finding, stateChanges, disposition } of findings) {
      parent(finding);
      if (!validId(finding.id) || !timestamp(finding.createdAt) || !['deterministic', 'model'].includes(finding.source)
        || typeof finding.title !== 'string' || typeof finding.description !== 'string' || !Array.isArray(stateChanges)
        || disposition !== undefined && (!disposition || !findingStatuses.has(disposition.status) || !timestamp(disposition.updatedAt))) {
        invalidHistory('Invalid saved finding.');
      }
      // Distinct historical occurrences keep their original IDs even if an older policy recorded duplicates.
      insertFinding.run(this.owner, project, finding.reviewId, finding.id, JSON.stringify(['historical', finding.id]), finding.createdAt,
        JSON.stringify({ ...finding, ...(disposition ? { importedDisposition: disposition } : {}) }));
      for (const change of stateChanges) {
        if (!change || change.projectId !== project || change.findingId !== finding.id || !validId(change.id)
          || !findingStatuses.has(change.toStatus) || !timestamp(change.createdAt)) invalidHistory('Invalid finding state history.');
      }
      for (const change of [...stateChanges].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
        insertChange.run(this.owner, project, finding.reviewId, finding.id, change.toStatus, JSON.stringify(change));
      }
      if (disposition) {
        const boundary = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM local_finding_state_change WHERE owner = ? AND project = ? AND review = ? AND finding = ?')
          .get(this.owner, project, finding.reviewId, finding.id);
        this.db.prepare(`UPDATE local_review_finding SET payload = json_set(payload, '$.importedThrough', ?) WHERE owner = ? AND project = ? AND review = ? AND id = ?`)
          .run(Number(boundary?.sequence ?? 0), this.owner, project, finding.reviewId, finding.id);
      }
    }
    for (const record of attempts) {
      parent(record);
      if (!validId(record.id) || !validId(record.stage) || !Number.isSafeInteger(record.attempt) || record.attempt < 1
        || !timestamp(record.createdAt)) invalidHistory('Invalid model-attempt identity.');
      this.writeModelAttempt(record);
    }
    for (const event of audit) {
      parent(event);
      if (!validId(event.event) || !timestamp(event.createdAt)) invalidHistory('Invalid Review audit event.');
      this.writeAudit(event);
    }
    for (const record of traceability) {
      parent({ projectId: record.projectId, reviewId: record.sessionId });
      this.saveSnapshot(project, record.sessionId, 'traceability', record);
    }
    for (const record of sufficiency) {
      parent(record);
      this.saveSnapshot(project, record.reviewId, 'sufficiency', record);
    }
    for (const record of correlations) {
      if (!reviewIds.has(record.childReviewId) || !reviewIds.has(record.parentReviewId) || !Array.isArray(record.correlations)
        || record.correlations.some(item => !item || !reviewIds.has(item.parentReviewId) || item.childReviewId !== record.childReviewId)) {
        invalidHistory('A finding correlation refers to an unavailable Review.');
      }
      this.saveSnapshot(project, record.childReviewId, 'correlation', record);
    }
    const decisionGroups = new Map<string, ReviewDecisionRecord[]>();
    for (const decision of decisions) {
      parent({ projectId: decision.projectId, reviewId: decision.sessionId });
      if (!validId(decision.id) || !timestamp(decision.createdAt) || !Array.isArray(decision.attachments)
        || decision.attachments.some(attachment => !attachment || !validId(attachment.id)
          || typeof attachment.fileName !== 'string' || !attachment.fileName.trim() || attachment.fileName.length > 255
          || typeof attachment.mimeType !== 'string' || !timestamp(attachment.createdAt))
        || new Set(decision.attachments.map(attachment => attachment.id)).size !== decision.attachments.length
        || !['approved', 'changes_requested', 'commented'].includes(decision.decision)) invalidHistory('Invalid Review decision.');
      const group = decisionGroups.get(decision.sessionId) ?? [];
      if (group.some(item => item.id === decision.id)) invalidHistory('Duplicate Review decision.');
      group.push(decision);
      decisionGroups.set(decision.sessionId, group);
    }
    for (const [id, group] of decisionGroups) {
      group.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
      this.saveSnapshot(project, id, 'decisions', group);
    }
  }

  listDecisions(review: string): ReviewDecisionRecord[] {
    return this.snapshot<ReviewDecisionRecord[]>(review, 'decisions') ?? [];
  }

  decisionFiles(project: string, review: string, decision: string) {
    const entry = this.listDecisions(review).find(item => item.projectId === project && item.id === decision);
    if (!entry) return null;
    const rows = this.db.prepare('SELECT id, hash, length FROM local_review_decision_file WHERE owner = ? AND project = ? AND review = ? AND decision = ?')
      .all(this.owner, project, review, decision);
    const stored = new Map(rows.map(row => [String(row.id), row]));
    return entry.attachments.map(attachment => {
      const file = stored.get(attachment.id);
      return { ...attachment, projectId: project, reviewId: review, decisionId: decision,
        contentHash: file ? String(file.hash) : null, byteSize: file ? Number(file.length) : null };
    });
  }

  async createReview(input: NewStaticReview): Promise<StaticReviewRecord> {
    this.assertManifestProject(input.projectId, input.sourceManifestId);
    const now = input.createdAt ?? new Date().toISOString();
    const record: StaticReviewRecord = {
      ...input, id: input.id ?? randomUUID(), sourceManifestId: input.sourceManifestId ?? null,
      deterministicFindingCount: 0, modelFindingCount: 0, modelStatus: 'not_requested',
      summary: '', failureReason: '', progress: null, revision: 0, createdAt: now, updatedAt: input.updatedAt ?? now,
    };
    this.db.prepare('INSERT INTO local_review VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(this.owner, record.projectId, record.id, record.idempotencyKey, record.createdAt, record.revision, JSON.stringify(record));
    return record;
  }

  async createRetryReview(input: NewStaticReview) {
    return this.createReview(input);
  }

  async getReview(id: string) {
    const row = this.db.prepare('SELECT payload FROM local_review WHERE owner = ? AND id = ?').get(this.owner, id);
    return row ? decode<StaticReviewRecord>(row) : null;
  }

  async listReviews(project: string) {
    return this.db.prepare('SELECT payload FROM local_review WHERE owner = ? AND project = ? ORDER BY created DESC, id DESC')
      .all(this.owner, project).map(decode<StaticReviewRecord>);
  }

  async listActiveReviews() {
    return this.db.prepare(`SELECT payload FROM local_review WHERE owner = ?
      AND json_extract(payload, '$.status') IN ('queued', 'running') ORDER BY created DESC, id DESC`)
      .all(this.owner).map(decode<StaticReviewRecord>);
  }

  async transitionReview(id: string, expected: StaticReviewStatus[], patch: StaticReviewPatch) {
    const current = await this.getReview(id);
    if (!current || !expected.includes(current.status)) return null;
    this.assertManifestProject(current.projectId, patch.sourceManifestId);
    const next = { ...current, ...patch, revision: current.revision + 1, updatedAt: patch.updatedAt ?? new Date().toISOString() };
    const result = this.db.prepare('UPDATE local_review SET revision = ?, payload = ? WHERE owner = ? AND id = ? AND revision = ?')
      .run(next.revision, JSON.stringify(next), this.owner, id, current.revision);
    return result.changes === 1 ? next : null;
  }

  async findReviewByIdempotencyKey(project: string, key: string) {
    const row = this.db.prepare('SELECT payload FROM local_review WHERE owner = ? AND project = ? AND dedup_key = ?')
      .get(this.owner, project, key);
    return row ? decode<StaticReviewRecord>(row) : null;
  }

  async findOperation(operation: ReviewOperationKind, key: string, project?: string) {
    const row = this.db.prepare('SELECT payload FROM local_review_operation WHERE owner = ? AND project = ? AND operation = ? AND dedup_key = ?')
      .get(this.owner, project ?? '', operation, key);
    return row ? decode<ReviewOperationRecord>(row) : null;
  }

  async saveOperation(record: ReviewOperationRecord) {
    if (!record.projectId) throw new Error('A local Review operation requires a project.');
    const result = this.db.prepare('INSERT INTO local_review_operation VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .run(this.owner, record.projectId, record.operation, record.idempotencyKey, record.reviewId, JSON.stringify(record));
    if (!result.changes && (await this.findOperation(record.operation, record.idempotencyKey, record.projectId))?.reviewId !== record.reviewId) {
      throw new Error('The Review operation already refers to a different Review.');
    }
  }

  async saveSourceManifest(reviewId: string, project: string, artifacts: Artifact[], mode: ReviewSourceManifestMode) {
    const payload = canonicalJson(artifacts);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const saved = this.db.prepare('SELECT id, mode, payload FROM local_review_manifest WHERE owner = ? AND project = ? AND review = ?')
        .get(this.owner, project, reviewId);
      if (saved && (saved.mode !== mode || saved.payload !== payload)) throw new Error('The frozen source manifest cannot be changed.');
      const version = this.db.prepare('SELECT hash FROM source_version WHERE owner = ? AND project = ? AND artifact = ? AND version = ?');
      for (const artifact of artifacts) {
        if (artifact.projectId !== project || !artifact.versionId
          || version.get(this.owner, project, artifact.id, artifact.versionId)?.hash !== artifact.contentHash) {
          throw new Error('The Review source does not match a local frozen version.');
        }
      }
      const id = saved ? String(saved.id) : randomUUID();
      if (!saved) {
        this.db.prepare('INSERT INTO local_review_manifest VALUES (?, ?, ?, ?, ?, ?)').run(this.owner, project, reviewId, id, mode, payload);
        this.db.prepare(`UPDATE local_review SET revision = revision + 1, payload = json_patch(payload,
          json_object('sourceManifestId', ?, 'updatedAt', ?, 'revision', revision + 1))
          WHERE owner = ? AND project = ? AND id = ?`).run(id, new Date().toISOString(), this.owner, project, reviewId);
      }
      this.db.exec('COMMIT');
      return { id };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async loadSourceManifestArtifacts(id: string) {
    const row = this.db.prepare('SELECT payload FROM local_review_manifest WHERE owner = ? AND id = ?').get(this.owner, id);
    return row ? decode<Artifact[]>(row) : null;
  }

  manifestCapture(project: string, manifest: string): string | null {
    const origin = this.db.prepare('SELECT review FROM local_review_manifest WHERE owner = ? AND project = ? AND id = ?')
      .get(this.owner, project, manifest);
    if (!origin) return null;
    const review = String(origin.review);
    const captured = this.snapshot<{ capturedAt: string }>(review, 'manifest_capture');
    if (captured) return captured.capturedAt;
    const first = this.db.prepare(`SELECT created FROM local_review_audit WHERE owner = ? AND project = ? AND review = ? AND event = 'source_manifest_captured'
      ORDER BY created, id LIMIT 1`).get(this.owner, project, review);
    return typeof first?.created === 'string' ? first.created : null;
  }

  async getReconciliationManifest(project: string, review: string, manifest: string): Promise<ReconciliationManifest | null> {
    const row = this.db.prepare(`SELECT m.payload FROM local_review_manifest AS m JOIN local_review AS r
      ON (m.owner, m.project) = (r.owner, r.project) AND m.id = json_extract(r.payload, '$.sourceManifestId')
      WHERE r.owner = ? AND r.project = ? AND r.id = ? AND m.id = ?`).get(this.owner, project, review, manifest);
    if (!row) return null;
    return { id: manifest, reviewId: review, status: 'available', artifacts: decode<Artifact[]>(row).map(artifact => ({
      id: artifact.id, filePath: artifact.filePath, originalPath: artifact.originalPath, contentHash: artifact.contentHash,
    })) };
  }

  async saveFinding(finding: PersistedReviewFinding) {
    const locator = finding.sourceLocator?.citationEvidence as { verification?: unknown } | undefined;
    const observation = JSON.stringify(finding.fingerprint
      ? [finding.fingerprint, finding.source, locator?.verification === 'needs_verification']
      : [finding.id]);
    this.db.prepare(`INSERT INTO local_review_finding VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, project, review, observation) DO UPDATE SET
      payload = json_set(excluded.payload, '$.id', local_review_finding.id, '$.createdAt', local_review_finding.created)`)
      .run(this.owner, finding.projectId, finding.reviewId, finding.id, observation, finding.createdAt, JSON.stringify(finding));
  }

  async listReviewFindings(reviewId: string) {
    return this.db.prepare('SELECT payload FROM local_review_finding WHERE owner = ? AND review = ? ORDER BY created, id')
      .all(this.owner, reviewId).map(decode<PersistedReviewFinding>);
  }

  listFindingRows(project: string, review?: string) {
    const rows = this.db.prepare(`SELECT f.payload, (
      SELECT s.payload FROM local_finding_state_change AS s
      WHERE (s.owner, s.project, s.review, s.finding) = (f.owner, f.project, f.review, f.id)
      AND s.sequence > COALESCE(json_extract(f.payload, '$.importedThrough'), 0)
      ORDER BY s.sequence DESC LIMIT 1
    ) AS disposition FROM local_review_finding AS f WHERE f.owner = ? AND f.project = ?
      ${review === undefined ? '' : 'AND f.review = ?'} ORDER BY f.created, f.id`)
      .all(this.owner, project, ...(review === undefined ? [] : [review]));
    return rows.map(row => {
      const disposition = typeof row.disposition === 'string' ? JSON.parse(row.disposition) as StoreFindingStateChange : null;
      const finding = decode<PersistedReviewFinding & { importedDisposition?: { status: StoreFinding['status']; updatedAt: string } }>(row);
      return toClientLocalReviewFinding(finding, disposition
        ? { status: disposition.toStatus, updatedAt: disposition.createdAt } : finding.importedDisposition);
    });
  }

  updateFindingStatus(project: string, finding: string, status: StoreFinding['status']): boolean {
    return this.transaction(() => {
      const matches = this.db.prepare(`SELECT review, json_extract(payload, '$.importedDisposition.status') AS imported_status,
        COALESCE(json_extract(payload, '$.importedThrough'), 0) AS imported_through
        FROM local_review_finding WHERE owner = ? AND project = ? AND id = ? LIMIT 2`)
        .all(this.owner, project, finding);
      if (matches.length !== 1) return false;
      const review = String(matches[0].review);
      const previous = this.db.prepare(`SELECT status FROM local_finding_state_change
        WHERE owner = ? AND project = ? AND review = ? AND finding = ? AND sequence > ? ORDER BY sequence DESC LIMIT 1`)
        .get(this.owner, project, review, finding, Number(matches[0].imported_through));
      const fromStatus = (previous?.status ?? matches[0].imported_status ?? 'new') as StoreFinding['status'];
      if (fromStatus === status) return true;
      const change: StoreFindingStateChange = { id: randomUUID(), projectId: project, findingId: finding, fromStatus,
        toStatus: status, actorId: this.owner, comment: '', createdAt: new Date().toISOString() };
      this.db.prepare('INSERT INTO local_finding_state_change (owner, project, review, finding, status, payload) VALUES (?, ?, ?, ?, ?, ?)')
        .run(this.owner, project, review, finding, status, JSON.stringify(change));
      return true;
    });
  }

  async updateProgress(id: string, progress: ReviewProgressState) {
    this.transaction(() => {
      const row = this.db.prepare('SELECT project FROM local_review WHERE owner = ? AND id = ?').get(this.owner, id);
      if (!row) throw new Error('The local Review is unavailable.');
      this.writeAudit({ reviewId: id, projectId: String(row.project), event: 'review_progress', stage: progress.stage,
        detail: progress, createdAt: progress.updatedAt });
      this.db.prepare(`UPDATE local_review SET revision = revision + 1, payload = json_set(payload,
        '$.progress', json(?), '$.updatedAt', ?, '$.revision', revision + 1)
        WHERE owner = ? AND id = ? AND COALESCE(json_extract(payload, '$.progress.updatedAt'), '') <= ?`)
        .run(JSON.stringify(progress), progress.updatedAt, this.owner, id, progress.updatedAt);
    });
  }

  async recordModelAttempt(attempt: ModelAttemptRecord) {
    this.writeModelAttempt(attempt);
  }

  private writeModelAttempt(attempt: ModelAttemptRecord) {
    const record = toModelUsageRecord(attempt);
    if (!record.id) throw new Error('The model attempt has no durable ID.');
    const result = this.db.prepare(`INSERT INTO local_review_attempt VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, project, review, id) DO UPDATE SET outcome = excluded.outcome, payload = excluded.payload
      WHERE local_review_attempt.stage = excluded.stage AND local_review_attempt.attempt = excluded.attempt
      AND (local_review_attempt.outcome = 'in_progress' OR excluded.outcome <> 'in_progress')`)
      .run(this.owner, record.projectId, record.reviewId, record.id, record.stage, record.attempt, record.outcome, JSON.stringify(record));
    if (!result.changes) {
      const saved = this.db.prepare('SELECT stage, attempt FROM local_review_attempt WHERE owner = ? AND project = ? AND review = ? AND id = ?')
        .get(this.owner, record.projectId, record.reviewId, record.id);
      if (saved?.stage !== record.stage || saved?.attempt !== record.attempt) throw new Error('The model attempt ID already belongs to another attempt.');
    }
  }

  async getModelAttemptCount(reviewId: string, stage: string) {
    const row = this.db.prepare('SELECT MAX(attempt) AS attempt FROM local_review_attempt WHERE owner = ? AND review = ? AND stage = ?')
      .get(this.owner, reviewId, stage);
    return Number(row?.attempt ?? 0);
  }

  listModelAttempts(project: string, review?: string): ModelUsageRecord[] {
    return this.db.prepare(`SELECT payload FROM local_review_attempt WHERE owner = ? AND project = ?
      ${review === undefined ? '' : 'AND review = ?'} ORDER BY id`)
      .all(this.owner, project, ...(review === undefined ? [] : [review])).map(decode<ModelUsageRecord>);
  }

  async recordAudit(event: ReviewAuditEvent) {
    this.writeAudit(event);
  }

  async recordAudits(events: ReviewAuditEvent[]) {
    if (events.length > 256) throw new Error('Review audit write exceeds its bounded batch.');
    if (events.length) this.transaction(() => { for (const event of events) this.writeAudit(event); });
  }

  async listAudit(project: string, review: string) {
    return this.db.prepare('SELECT payload FROM local_review_audit WHERE owner = ? AND project = ? AND review = ? ORDER BY created, id')
      .all(this.owner, project, review).map(decode<ReviewAuditEvent>);
  }

  async getRecoveryJournal(review: string, project: string) {
    const events = new Set<string>(RECOVERY_JOURNAL_EVENTS);
    return (await this.listAudit(project, review)).filter(item => events.has(item.event));
  }

  async getBatchCacheBasis(reviewId: string) {
    const review = await this.getReview(reviewId);
    if (!review || !['blocked', 'failed', 'cancelled', 'pending_approval', 'completed', 'approved', 'changes_requested'].includes(review.status)) return null;
    const analysisMap = analysisMapFromEvents(await this.listAudit(review.projectId, reviewId));
    return analysisMap ? { reviewId, projectId: review.projectId, analysisMap, findings: await this.listReviewFindings(reviewId) } : null;
  }

  async saveEvidenceSufficiency(assessment: EvidenceSufficiencyAssessment) {
    this.saveSnapshot(assessment.projectId, assessment.reviewId, 'sufficiency', assessment);
  }

  async appendEvidenceSufficiency(assessment: EvidenceSufficiencyAssessment) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT payload FROM local_review WHERE owner = ? AND project = ? AND id = ?')
        .get(this.owner, assessment.projectId, assessment.reviewId);
      if (!row || decode<StaticReviewRecord>(row).status !== 'running') throw new Error('Evidence sufficiency is immutable after Review execution ends.');
      const frozen = this.snapshot<EvidenceSufficiencyAssessment>(assessment.reviewId, 'sufficiency');
      if (!frozen) throw new Error('The frozen evidence sufficiency assessment is unavailable.');
      const merged = mergeEvidenceSufficiencyAssessments(frozen, assessment);
      this.db.prepare('UPDATE local_review_snapshot SET payload = ? WHERE owner = ? AND review = ? AND kind = ?')
        .run(JSON.stringify(merged), this.owner, assessment.reviewId, 'sufficiency');
      return merged;
    });
  }

  async getEvidenceSufficiency(reviewId: string) {
    return this.snapshot<EvidenceSufficiencyAssessment>(reviewId, 'sufficiency');
  }

  async saveFindingCorrelations(snapshot: FindingCorrelationSnapshot) {
    const child = await this.getReview(snapshot.childReviewId);
    const parent = await this.getReview(snapshot.parentReviewId);
    if (!child || !parent || child.projectId !== parent.projectId) throw new Error('The local correlation does not match the Review project.');
    this.saveSnapshot(child.projectId, child.id, 'correlation', snapshot);
  }

  async getFindingCorrelationSnapshot(reviewId: string) {
    return this.snapshot<FindingCorrelationSnapshot>(reviewId, 'correlation');
  }

  async captureTraceabilitySnapshot(reviewId: string, project: string, input: CaptureReviewTraceabilityInput) {
    input.signal?.throwIfAborted();
    const review = await this.getReview(reviewId);
    if (!review || review.projectId !== project || !input.sourceManifestId || review.sourceManifestId !== input.sourceManifestId) {
      throw new Error('Traceability does not match the local Review source manifest.');
    }
    const existing = await this.getTraceabilitySnapshot(reviewId);
    if (existing) return existing;
    const now = new Date().toISOString();
    let snapshot: ReviewTraceabilitySnapshot;
    if (input.reuseFromReviewId) {
      const parent = await this.getTraceabilitySnapshot(input.reuseFromReviewId);
      if (parent && parent.projectId !== project) throw new Error('The parent traceability belongs to another project.');
      snapshot = parent?.metadata?.snapshotVersion === 2 && parent.metadata.sourceManifestId === input.sourceManifestId
        ? { ...parent, sessionId: reviewId }
        : this.unavailableTraceability(reviewId, project, input.sourceManifestId, 'frozen_parent_context_unavailable', now);
    } else {
      const { grounding } = input;
      if (!grounding || grounding.confirmedRequirements.some(item => item.projectId !== project)
        || grounding.enabledStandardRules.some(item => item.projectId !== project)) {
        throw new Error('Local traceability requires frozen grounding from the same project.');
      }
      const sources = await this.loadSourceManifestArtifacts(input.sourceManifestId);
      if (!sources || canonicalJson(sources) !== canonicalJson(input.artifacts)) throw new Error('Traceability sources differ from the frozen local manifest.');
      const store = new LocalRequirements(this.db, this.owner, project);
      store.requireImported();
      const mappings = this.transaction(() => new Map(grounding.confirmedRequirements.map(requirement =>
        [requirement.id, store.mappings(requirement.id).map(item => ({ ...item, mappingVersionId: item.mappingVersionId ?? null,
          mappingContentHash: item.mappingContentHash ?? null }))])));
      snapshot = await buildFrozenTraceability(reviewId, project, input, grounding.confirmedRequirements, grounding.enabledStandardRules,
        async id => mappings.get(id) ?? [], now);
    }
    input.signal?.throwIfAborted();
    this.saveSnapshot(project, reviewId, 'traceability', snapshot);
    const saved = this.snapshot<ReviewTraceabilitySnapshot>(reviewId, 'traceability');
    if (!saved) throw new Error('Local traceability could not be saved.');
    return saved;
  }

  async getTraceabilitySnapshot(reviewId: string) {
    return this.snapshot<ReviewTraceabilitySnapshot>(reviewId, 'traceability');
  }

  async saveTraceabilitySnapshot(reviewId: string, project: string) {
    this.saveSnapshot(project, reviewId, 'traceability',
      this.unavailableTraceability(reviewId, project, null, 'frozen_context_not_provided', new Date().toISOString()));
  }

  private unavailableTraceability(reviewId: string, projectId: string, sourceManifestId: string | null, unavailableReason: string, now: string): ReviewTraceabilitySnapshot {
    return { sessionId: reviewId, projectId, status: 'unavailable', records: [],
      summary: { complete: 0, incomplete: 0, missing: 0, attention: 0, unavailable: 0 }, capturedAt: now, updatedAt: now,
      metadata: { snapshotVersion: 2, sourceManifestId, inclusionBasis: null, grounding: null, unavailableReason } };
  }

  private writeAudit(event: ReviewAuditEvent) {
    const id = event.id ?? auditId(event);
    this.db.prepare(`INSERT INTO local_review_audit VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, project, review, id) DO UPDATE SET payload = excluded.payload
      WHERE local_review_audit.event = excluded.event AND local_review_audit.created = excluded.created`)
      .run(this.owner, event.projectId, event.reviewId, id, event.event, event.createdAt, JSON.stringify({ ...event, id }));
  }

  private saveSnapshot(project: string, review: string, kind: string, value: unknown) {
    this.db.prepare('INSERT INTO local_review_snapshot VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .run(this.owner, project, review, kind, JSON.stringify(value));
  }

  private snapshot<T>(review: string, kind: string): T | null {
    const row = this.db.prepare('SELECT payload FROM local_review_snapshot WHERE owner = ? AND review = ? AND kind = ?')
      .get(this.owner, review, kind);
    return row ? decode<T>(row) : null;
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private assertManifestProject(project: string, id?: string | null) {
    if (id && !this.db.prepare('SELECT 1 FROM local_review_manifest WHERE owner = ? AND project = ? AND id = ?')
      .get(this.owner, project, id)) throw new Error('The source manifest does not belong to this project.');
  }
}
