import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { DynamicEvidence, DynamicSession } from '../dynamicSessions.js';
import type { ReportActionTrace } from '../report/types.js';
import { DynamicContractError } from './types.js';

export type LegacyDynamicSnapshot = {
  sessions: DynamicSession[];
  actions: Array<ReportActionTrace & { id: string; sessionId: string; createdAt: string }>;
  evidence: Array<Omit<DynamicEvidence, 'filePath'> & { sessionId: string; file?: { sha256: string; contentBase64: string; imageType?: string } }>;
};

export const localLegacyDynamicSchema = `
  CREATE TABLE IF NOT EXISTS local_legacy_dynamic_session (
    owner TEXT NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, id), FOREIGN KEY (owner, project) REFERENCES project(owner, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_legacy_dynamic_recent ON local_legacy_dynamic_session (owner, project, created DESC, id);
  CREATE TABLE IF NOT EXISTS local_legacy_dynamic_action (
    owner TEXT NOT NULL, project TEXT NOT NULL, session TEXT NOT NULL, id TEXT NOT NULL, step INTEGER NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, session, id),
    FOREIGN KEY (owner, project, session) REFERENCES local_legacy_dynamic_session(owner, project, id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS local_legacy_dynamic_evidence (
    owner TEXT NOT NULL, project TEXT NOT NULL, session TEXT NOT NULL, id TEXT NOT NULL, created TEXT NOT NULL,
    payload TEXT NOT NULL, hash TEXT, length INTEGER, image_type TEXT,
    PRIMARY KEY (owner, project, session, id),
    FOREIGN KEY (owner, project, session) REFERENCES local_legacy_dynamic_session(owner, project, id)
  ) STRICT;
`;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const decode = <T>(row: { payload?: unknown }): T => JSON.parse(String(row.payload)) as T;
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
export const legacyEvidenceMaxBytes = 32 * 1024 * 1024;
const imageHeader: Record<string, (bytes: Buffer) => boolean> = {
  'image/png': bytes => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': bytes => bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
  'image/gif': bytes => ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)),
  'image/webp': bytes => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
};

export function legacyEvidenceImageType(bytes: Buffer): string | undefined {
  return Object.keys(imageHeader).find(type => imageHeader[type](bytes));
}

export class LocalLegacyDynamicHistory {
  constructor(private readonly db: DatabaseSync, private readonly owner: string,
    private readonly objects: { save(hash: string, data: Buffer): void; read(hash: string, length: number): Buffer }) {}

  seed(project: string, snapshot: LegacyDynamicSnapshot): void {
    if (!snapshot || ![snapshot.sessions, snapshot.actions, snapshot.evidence].every(Array.isArray)) throw new Error('Invalid legacy Dynamic history.');
    const sessionIds = new Set<string>();
    const insertSession = this.db.prepare('INSERT INTO local_legacy_dynamic_session VALUES (?, ?, ?, ?, ?)');
    for (const session of snapshot.sessions) {
      if (!session || session.projectId !== project || !uuid.test(session.id) || session.type !== 'dynamic'
        || typeof session.goal !== 'string' || typeof session.name !== 'string' || typeof session.targetUrl !== 'string'
        || !time(session.createdAt) || !time(session.updatedAt) || !['queued', 'running', 'success', 'failure', 'blocked', 'cancelled'].includes(session.status)) {
        throw new Error('Invalid legacy Dynamic session.');
      }
      const active = session.status === 'queued' || session.status === 'running';
      const saved = active ? { ...session, status: 'blocked', failureReason: 'Execution was interrupted during migration.' } : session;
      insertSession.run(this.owner, project, session.id, session.createdAt, JSON.stringify(saved));
      sessionIds.add(session.id);
    }
    const insertAction = this.db.prepare('INSERT INTO local_legacy_dynamic_action VALUES (?, ?, ?, ?, ?, ?)');
    for (const entry of snapshot.actions) {
      if (!entry || !sessionIds.has(entry.sessionId) || !uuid.test(entry.id) || !Number.isSafeInteger(entry.step) || !time(entry.createdAt)
        || [entry.action, entry.target, entry.result].some(value => typeof value !== 'string')) throw new Error('Invalid legacy Dynamic action.');
      const { id, sessionId, step, action, target, result, createdAt } = entry;
      insertAction.run(this.owner, project, sessionId, id, step, JSON.stringify({ id, step, action, target, result, createdAt }));
    }
    const insertEvidence = this.db.prepare('INSERT INTO local_legacy_dynamic_evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const entry of snapshot.evidence) {
      if (!entry || !sessionIds.has(entry.sessionId) || !uuid.test(entry.id) || !time(entry.createdAt) || typeof entry.summary !== 'string'
        || typeof entry.type !== 'string' || !entry.type || entry.type.length > 100) throw new Error('Invalid legacy Dynamic evidence.');
      const { id, sessionId, type, summary, createdAt, file } = entry;
      let size: number | null = null;
      if (file) {
        if (typeof file.contentBase64 !== 'string' || file.contentBase64.length > 4 * Math.ceil(legacyEvidenceMaxBytes / 3)) {
          throw new Error('A legacy evidence file exceeds the supported size.');
        }
        const bytes = Buffer.from(file.contentBase64, 'base64');
        if (!bytes.length || bytes.length > legacyEvidenceMaxBytes || bytes.toString('base64') !== file.contentBase64 || sha256(bytes) !== file.sha256
          || file.imageType !== undefined && (type !== 'screenshot' || legacyEvidenceImageType(bytes) !== file.imageType)) {
          throw new Error('A legacy evidence file failed verification.');
        }
        size = bytes.length;
        this.objects.save(file.sha256, bytes);
      }
      const filePath = file?.imageType ? `local-legacy/${project}/${sessionId}/${id}` : '';
      insertEvidence.run(this.owner, project, sessionId, id, createdAt, JSON.stringify({ id, type, summary, createdAt, filePath }),
        file?.sha256 ?? null, size, file?.imageType ?? null);
    }
  }

  list(project: string): DynamicSession[] {
    return this.db.prepare('SELECT payload FROM local_legacy_dynamic_session WHERE owner = ? AND project = ? ORDER BY created DESC, id')
      .all(this.owner, project).map(decode<DynamicSession>);
  }

  get(project: string, id: string): DynamicSession | null {
    const row = this.db.prepare('SELECT payload FROM local_legacy_dynamic_session WHERE owner = ? AND project = ? AND id = ?').get(this.owner, project, id);
    return row ? decode<DynamicSession>(row) : null;
  }

  listActions(project: string, session: string): ReportActionTrace[] {
    return this.db.prepare('SELECT payload FROM local_legacy_dynamic_action WHERE owner = ? AND project = ? AND session = ? ORDER BY step, id')
      .all(this.owner, project, session).map(row => {
        const { step, action, target, result } = decode<ReportActionTrace>(row);
        return { step, action, target, result };
      });
  }

  listEvidence(project: string, session: string): DynamicEvidence[] {
    return this.db.prepare('SELECT payload FROM local_legacy_dynamic_evidence WHERE owner = ? AND project = ? AND session = ? ORDER BY created, id')
      .all(this.owner, project, session).map(decode<DynamicEvidence>);
  }

  image(project: string, session: string, id: string) {
    const file = this.db.prepare(`SELECT hash, length, image_type FROM local_legacy_dynamic_evidence
      WHERE owner = ? AND project = ? AND session = ? AND id = ? AND image_type IS NOT NULL`).get(this.owner, project, session, id);
    if (!file) return null;
    try {
      const bytes = this.objects.read(String(file.hash), Number(file.length));
      const type = legacyEvidenceImageType(bytes);
      if (!type || type !== file.image_type) throw new Error('Unexpected image type.');
      return { bytes, type };
    } catch { throw new DynamicContractError(503, 'The local evidence image is missing or failed verification.'); }
  }
}
