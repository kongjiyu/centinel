import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DynamicContractError, type DynamicRun, type EvidenceReference, type Mission, type MissionRevision, type MissionUpdate } from './types.js';
import { MAX_SHARED_EVIDENCE_BYTES } from './sharedEvidence/types.js';
import { verifyIndependentEvidence } from './sharedEvidence/files.js';
import type { EvidenceCopyArchive } from './sharedEvidence/archive.js';
import { validateMission, validateMissionDisplayName } from './service.js';
import type { FindingDetail } from './findings/types.js';
import type { DynamicReportSnapshot } from './reports/types.js';
import type { UnitHistorySnapshot } from './unit/localRepository.js';
import type { HookOperation } from './workspace/operations.js';

export type DynamicHistorySnapshot = {
  missions: Mission[];
  revisions: MissionRevision[];
  runs: DynamicRun[];
  evidence?: { runId: string; evidenceId: string; contentBase64: string }[];
  evidenceCopies?: EvidenceCopyArchive;
  findings?: FindingDetail[];
  reports?: DynamicReportSnapshot[];
  units?: UnitHistorySnapshot;
  hooks?: HookOperation[];
};

export const localDynamicHistorySchema = `
  CREATE TABLE IF NOT EXISTS local_dynamic_mission (
    owner TEXT NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, id), FOREIGN KEY (owner, project) REFERENCES project(owner, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_dynamic_mission_recent ON local_dynamic_mission (owner, project, created DESC, id);
  CREATE TABLE IF NOT EXISTS local_dynamic_revision (
    owner TEXT NOT NULL, project TEXT NOT NULL, mission TEXT NOT NULL, id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0), payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, id), UNIQUE (owner, project, mission, revision),
    UNIQUE (owner, project, mission, id),
    FOREIGN KEY (owner, project, mission) REFERENCES local_dynamic_mission(owner, project, id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS local_dynamic_run (
    owner TEXT NOT NULL, project TEXT NOT NULL, mission TEXT NOT NULL, revision TEXT NOT NULL, id TEXT NOT NULL,
    operation TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, id), UNIQUE (owner, project, operation),
    FOREIGN KEY (owner, project, mission, revision) REFERENCES local_dynamic_revision(owner, project, mission, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_dynamic_run_recent ON local_dynamic_run (owner, project, created DESC, id);
  CREATE INDEX IF NOT EXISTS local_dynamic_run_active ON local_dynamic_run (owner, project)
    WHERE json_extract(payload, '$.state') IN ('queued', 'running');
  CREATE TABLE IF NOT EXISTS local_dynamic_run_claim (
    owner TEXT NOT NULL, project TEXT NOT NULL, run TEXT NOT NULL, token TEXT NOT NULL,
    PRIMARY KEY (owner, project, run),
    FOREIGN KEY (owner, project, run) REFERENCES local_dynamic_run(owner, project, id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS local_dynamic_evidence (
    owner TEXT NOT NULL, project TEXT NOT NULL, run TEXT NOT NULL, id TEXT NOT NULL,
    hash TEXT NOT NULL, length INTEGER NOT NULL CHECK (length > 0), PRIMARY KEY (owner, project, run, id),
    FOREIGN KEY (owner, project, run) REFERENCES local_dynamic_run(owner, project, id)
  ) STRICT;
`;

const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const decode = <T>(row: { payload?: unknown }): T => JSON.parse(String(row.payload)) as T;
function fail(message: string): never { throw new Error(`Invalid Dynamic history snapshot. ${message}`); }

export class LocalDynamicHistory {
  constructor(private readonly db: DatabaseSync, private readonly owner: string,
    private readonly objects: { save(hash: string, bytes: Buffer): void; read(hash: string, length: number): Buffer }) {}

  listMissions(project: string): Mission[] {
    return this.db.prepare('SELECT payload FROM local_dynamic_mission WHERE owner = ? AND project = ? ORDER BY created DESC, id')
      .all(this.owner, project).map(decode<Mission>);
  }

  async saveMission(project: string, actor: string, value: unknown, id?: string): Promise<MissionRevision> {
    this.requireAuthor(project, actor);
    const input = validateMission(value, project);
    return this.transaction(() => {
      const now = new Date().toISOString();
      const revisionId = randomUUID();
      const mission: Mission = id ? this.requireMission(project, id) : {
        id: randomUUID(), projectId: project, currentRevisionId: revisionId, createdBy: actor, createdAt: now,
      };
      if (mission.archivedAt) throw new DynamicContractError(409, 'Unarchive this saved test before editing it.');
      const previous = this.db.prepare(`SELECT MAX(revision) AS revision FROM local_dynamic_revision
        WHERE owner = ? AND project = ? AND mission = ?`).get(this.owner, project, mission.id);
      const revision = { ...input, id: revisionId, projectId: project, missionId: mission.id,
        revision: Number(previous?.revision ?? 0) + 1, createdBy: actor, createdAt: now };
      mission.currentRevisionId = revisionId;
      // Clearing a rename and advancing the saved test share the revision transaction.
      if (mission.displayName !== undefined) {
        delete mission.displayName;
        mission.updatedAt = now;
        mission.updatedBy = actor;
      }
      this.db.prepare(`INSERT INTO local_dynamic_mission VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (owner, project, id) DO UPDATE SET payload = excluded.payload`)
        .run(this.owner, project, mission.id, mission.createdAt, JSON.stringify(mission));
      this.db.prepare('INSERT INTO local_dynamic_revision VALUES (?, ?, ?, ?, ?, ?)')
        .run(this.owner, project, mission.id, revision.id, revision.revision, JSON.stringify(revision));
      return revision;
    });
  }

  async renameMission(project: string, actor: string, id: string, name: unknown): Promise<Mission> {
    const displayName = validateMissionDisplayName(name);
    return this.updateMission(project, actor, id, { displayName });
  }

  async setMissionArchived(project: string, actor: string, id: string, archived: boolean): Promise<Mission> {
    return this.updateMission(project, actor, id, { archived });
  }

  private requireMission(project: string, id: string): Mission {
    if (!validId(id)) throw new DynamicContractError(400, 'Choose a valid saved test.');
    const mission = this.mission(project, id);
    if (!mission) throw new DynamicContractError(404, 'Saved test not found.');
    return mission;
  }

  mission(project: string, id: string): Mission | null {
    const row = this.db.prepare('SELECT payload FROM local_dynamic_mission WHERE owner = ? AND project = ? AND id = ?')
      .get(this.owner, project, id);
    return row ? decode<Mission>(row) : null;
  }

  updateMission(project: string, actor: string, id: string, update: MissionUpdate): Mission {
    this.requireAuthor(project, actor);
    return this.transaction(() => {
      const mission = this.requireMission(project, id);
      const now = new Date().toISOString();
      if (update.displayName === null) delete mission.displayName;
      if (update.displayName !== undefined && update.displayName !== null) mission.displayName = update.displayName;
      if (update.archived === true) {
        mission.archivedAt ??= now;
        mission.archivedBy ??= actor;
      }
      if (update.archived === false) {
        delete mission.archivedAt;
        delete mission.archivedBy;
      }
      mission.updatedAt = now;
      mission.updatedBy = actor;
      this.db.prepare('UPDATE local_dynamic_mission SET payload = ? WHERE owner = ? AND project = ? AND id = ?')
        .run(JSON.stringify(mission), this.owner, project, id);
      return mission;
    });
  }

  private requireAuthor(project: string, actor: string): void {
    if (actor !== this.owner || !this.db.prepare('SELECT 1 FROM project WHERE owner = ? AND id = ?').get(this.owner, project)) {
      throw new DynamicContractError(404, 'Project not found on this device.');
    }
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  revision(project: string, id: string): MissionRevision | null {
    const row = this.db.prepare('SELECT payload FROM local_dynamic_revision WHERE owner = ? AND project = ? AND id = ?')
      .get(this.owner, project, id);
    return row ? decode<MissionRevision>(row) : null;
  }

  listRuns(project: string): DynamicRun[] {
    return this.db.prepare('SELECT payload FROM local_dynamic_run WHERE owner = ? AND project = ? ORDER BY created DESC, id')
      .all(this.owner, project).map(decode<DynamicRun>);
  }

  run(project: string, id: string): DynamicRun | null {
    const row = this.db.prepare('SELECT payload FROM local_dynamic_run WHERE owner = ? AND project = ? AND id = ?')
      .get(this.owner, project, id);
    return row ? decode<DynamicRun>(row) : null;
  }

  evidence(project: string, runId: string, evidenceId: string) {
    const ref = this.run(project, runId)?.evidence.find(item => item.id === evidenceId);
    if (!ref) return null;
    const item = this.db.prepare('SELECT hash, length FROM local_dynamic_evidence WHERE owner = ? AND project = ? AND run = ? AND id = ?')
      .get(this.owner, project, runId, evidenceId);
    if (!item) return null;
    let bytes: Buffer;
    try { bytes = this.objects.read(String(item.hash), Number(item.length)); }
    catch { throw new DynamicContractError(503, 'The saved test evidence is missing or failed verification.'); }
    verifyIndependentEvidence(bytes, ref);
    return { ref, bytes, mimeType: ref.kind === 'screenshot' ? 'image/png' : 'application/json' };
  }

  /** The caller commits this reference with the Run verdict after checking its lease. */
  retainEvidence(project: string, runId: string, ref: EvidenceReference, bytes: Buffer): void {
    if (!validId(ref.id) || !digest(ref.sha256) || !timestamp(ref.capturedAt) || ref.availability !== 'local'
      || !['screenshot', 'checks', 'file_manifest', 'usability'].includes(ref.kind)
      || !Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_SHARED_EVIDENCE_BYTES) {
      throw new DynamicContractError(409, 'Recorded evidence is invalid or exceeds the storage limit.');
    }
    verifyIndependentEvidence(bytes, ref);
    this.objects.save(ref.sha256, bytes);
    this.db.prepare('INSERT INTO local_dynamic_evidence VALUES (?, ?, ?, ?, ?, ?)')
      .run(this.owner, project, runId, ref.id, ref.sha256, bytes.length);
  }

  /** Called inside the workspace staging transaction. */
  seed(project: string, snapshot: DynamicHistorySnapshot): void {
    const { missions, revisions, runs, evidence = [] } = snapshot;
    if (![missions, revisions, runs, evidence].every(Array.isArray)) fail('Record groups must be arrays.');
    const revisionIndex = new Map<string, MissionRevision>();
    const missionIds = new Set<string>();
    const runIndex = new Map<string, DynamicRun>();
    const insertMission = this.db.prepare('INSERT INTO local_dynamic_mission VALUES (?, ?, ?, ?, ?)');
    for (const mission of missions) {
      if (!mission || mission.projectId !== project || !validId(mission.id) || !validId(mission.currentRevisionId)
        || !validId(mission.createdBy) || !timestamp(mission.createdAt) || missionIds.has(mission.id)) fail('Invalid mission identity.');
      missionIds.add(mission.id);
      insertMission.run(this.owner, project, mission.id, mission.createdAt, JSON.stringify(mission));
    }
    const insertRevision = this.db.prepare('INSERT INTO local_dynamic_revision VALUES (?, ?, ?, ?, ?, ?)');
    for (const revision of revisions) {
      if (!revision || revision.projectId !== project || !missionIds.has(revision.missionId) || !validId(revision.id)
        || !Number.isSafeInteger(revision.revision) || revision.revision < 1 || !validId(revision.createdBy)
        || !timestamp(revision.createdAt) || !validRevisionContent(revision) || revisionIndex.has(revision.id)) fail('Invalid revision identity or content.');
      revisionIndex.set(revision.id, revision);
      insertRevision.run(this.owner, project, revision.missionId, revision.id, revision.revision, JSON.stringify(revision));
    }
    if (missions.some(mission => revisionIndex.get(mission.currentRevisionId)?.missionId !== mission.id)) fail('Missing current mission revision.');
    const insertRun = this.db.prepare('INSERT INTO local_dynamic_run VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const run of runs) {
      const revision = run?.revision && revisionIndex.get(run.revision.id);
      if (!run || run.projectId !== project || !validId(run.id) || !validId(run.createdBy) || !revision
        || run.missionId !== revision.missionId || run.revision.missionId !== revision.missionId || run.revision.projectId !== project
        || run.revision.revision !== revision.revision || !validRevisionContent(run.revision)
        || !validId(run.idempotencyKey) || run.idempotencyKey.length > 128 || !timestamp(run.createdAt) || !timestamp(run.updatedAt)
        || !['queued', 'running', 'completed', 'blocked', 'cancelled', 'interrupted'].includes(run.state)
        || !['passed', 'failed', 'uncertain', 'not_tested'].includes(run.verdict)
        || !Array.isArray(run.checks) || run.checks.some(check => !check || !validId(check.checkId)
          || !Array.isArray(check.evidenceIds) || !['passed', 'failed', 'uncertain', 'not_tested'].includes(check.verdict))
        || !Array.isArray(run.evidence) || run.evidence.some(ref => !ref || !validId(ref.id) || !digest(ref.sha256)
          || !timestamp(ref.capturedAt) || !['screenshot', 'checks', 'file_manifest', 'usability'].includes(ref.kind))
        || new Set(run.evidence.map(ref => ref.id)).size !== run.evidence.length || runIndex.has(run.id)) fail('Invalid run identity or evidence references.');
      runIndex.set(run.id, run);
      const saved = run.state === 'queued' || run.state === 'running' ? {
        ...run, state: 'interrupted', verdict: 'not_tested', lease: null,
        reason: 'Execution was interrupted during migration. Saved observations remain available.',
      } : run;
      insertRun.run(this.owner, project, run.missionId, revision.id, run.id, run.idempotencyKey, run.createdAt, JSON.stringify(saved));
    }
    const insertEvidence = this.db.prepare('INSERT INTO local_dynamic_evidence VALUES (?, ?, ?, ?, ?, ?)');
    for (const item of evidence) {
      const ref = item && runIndex.get(item.runId)?.evidence.find(saved => saved.id === item.evidenceId);
      if (!ref || typeof item.contentBase64 !== 'string' || item.contentBase64.length > Math.ceil(MAX_SHARED_EVIDENCE_BYTES / 3) * 4) {
        fail('Evidence bytes have no matching run reference or exceed the import limit.');
      }
      const bytes = Buffer.from(item.contentBase64, 'base64');
      if (!bytes.length || bytes.length > MAX_SHARED_EVIDENCE_BYTES || bytes.toString('base64') !== item.contentBase64) fail('Invalid evidence encoding.');
      verifyIndependentEvidence(bytes, ref);
      this.objects.save(ref.sha256, bytes);
      insertEvidence.run(this.owner, project, item.runId, item.evidenceId, ref.sha256, bytes.length);
    }
  }
}

function validRevisionContent(revision: MissionRevision): boolean {
  return typeof revision.name === 'string' && typeof revision.goal === 'string' && typeof revision.targetUrl === 'string'
    && Number.isSafeInteger(revision.maxSteps) && revision.maxSteps > 0 && Array.isArray(revision.checks)
    && revision.checks.every(check => check && validId(check.id) && typeof check.description === 'string');
}
