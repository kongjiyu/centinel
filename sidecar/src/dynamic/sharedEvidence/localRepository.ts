import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DynamicContractError, type DynamicRun } from '../types.js';
import type { LocalArtifact, RunArtifact } from './artifacts.js';
import { verifyArchivedArtifact, verifyArchivedCopy, verifyArchivedCopyBytes, type EvidenceCopyArchive } from './archive.js';
import { MAX_SHARED_EVIDENCE_BYTES, type EvidenceCopy } from './types.js';

export const localEvidenceCopySchema = `
  CREATE TABLE IF NOT EXISTS local_dynamic_evidence_copy (
    owner TEXT NOT NULL, project TEXT NOT NULL, run TEXT NOT NULL, slot TEXT NOT NULL, id TEXT NOT NULL,
    payload TEXT NOT NULL, artifact TEXT, content BLOB,
    PRIMARY KEY (owner, project, run, id), UNIQUE (owner, project, run, slot),
    FOREIGN KEY (owner, project, run) REFERENCES local_dynamic_run(owner, project, id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS local_dynamic_artifact (
    owner TEXT NOT NULL, project TEXT NOT NULL, run TEXT NOT NULL, slot TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, run, id), UNIQUE (owner, project, run, slot),
    FOREIGN KEY (owner, project, run) REFERENCES local_dynamic_run(owner, project, id)
  ) STRICT;
  INSERT OR IGNORE INTO local_dynamic_artifact (owner, project, run, slot, id, payload)
    SELECT owner, project, run, json_extract(artifact, '$.slot'), json_extract(artifact, '$.id'), artifact
    FROM local_dynamic_evidence_copy WHERE artifact IS NOT NULL;
`;

type Capture = Pick<EvidenceCopy, 'evidenceId' | 'kind' | 'sha256' | 'mimeType'> & {
  slot: string;
  bytes: Buffer;
  artifact?: LocalArtifact['input'];
};

function verify(bytes: Buffer, length: number, hash: string): void {
  if (bytes.length !== length || length < 0 || length > MAX_SHARED_EVIDENCE_BYTES
      || createHash('sha256').update(bytes).digest('hex') !== hash) {
    throw new DynamicContractError(409, 'Evidence does not match its recorded size or checksum.');
  }
}

export class LocalEvidenceCopies {
  constructor(private readonly db: DatabaseSync, private readonly owner: string) {}

  list(project: string, run: string): EvidenceCopy[] {
    return this.db.prepare(`SELECT payload FROM local_dynamic_evidence_copy
      WHERE owner = ? AND project = ? AND run = ? ORDER BY slot`).all(this.owner, project, run)
      .map(row => JSON.parse(String(row.payload)) as EvidenceCopy);
  }

  artifacts(project: string, run: string): RunArtifact[] {
    return this.db.prepare(`SELECT payload FROM local_dynamic_artifact
      WHERE owner = ? AND project = ? AND run = ? ORDER BY slot`).all(this.owner, project, run)
      .map(row => JSON.parse(String(row.payload)) as RunArtifact);
  }

  /** The workspace import owns the surrounding transaction and inserts Runs first. */
  seed(project: string, archive: EvidenceCopyArchive, readRun: (runId: string) => DynamicRun | null): void {
    if (!Array.isArray(archive?.artifacts) || !Array.isArray(archive.copies)) throw new Error('Invalid evidence copy archive.');
    const registry = new Map<string, RunArtifact>();
    for (const artifact of archive.artifacts) {
      const run = typeof artifact?.runId === 'string' ? readRun(artifact.runId) : null;
      if (!run || run.projectId !== project || registry.has(artifact.id)) throw new Error('An archived artifact has no unique scoped Run.');
      verifyArchivedArtifact(run, artifact);
      this.register(artifact);
      registry.set(artifact.id, artifact);
    }
    for (const item of archive.copies) {
      const copy = item?.copy;
      const run = typeof copy?.runId === 'string' ? readRun(copy.runId) : null;
      if (!run || run.projectId !== project) throw new Error('An archived evidence copy has no scoped Run.');
      const artifact = registry.get(copy.evidenceId);
      if (artifact && artifact.runId !== run.id) throw new Error('An archived diagnostic copy points to a different Run.');
      const slot = verifyArchivedCopy(run, copy, artifact);
      let bytes: Buffer | null = null;
      if (copy.availability === 'available') {
        if (typeof item.contentBase64 !== 'string' || item.contentBase64.length !== Math.ceil(copy.bytes / 3) * 4) {
          throw new Error('An available evidence copy is missing its archived bytes.');
        }
        bytes = Buffer.from(item.contentBase64, 'base64');
        if (bytes.toString('base64') !== item.contentBase64) throw new Error('Invalid evidence copy encoding.');
        verifyArchivedCopyBytes(run, copy, bytes);
      } else if (item.contentBase64 !== undefined) throw new Error('An unavailable evidence copy contains bytes.');
      this.insert(slot, copy, bytes);
    }
  }

  save(run: DynamicRun, files: Capture[]): EvidenceCopy[] {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const copies = files.map(file => this.saveOne(run, file));
      this.db.exec('COMMIT');
      return copies;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private saveOne(run: DynamicRun, file: Capture): EvidenceCopy {
    const { artifact, bytes, kind, mimeType, sha256 } = file;
    verify(bytes, artifact?.bytes ?? bytes.length, sha256);
    const scope = [this.owner, run.projectId, run.id] as const;
    const registered = artifact ? this.registerCapture(run, artifact) : null;
    const previous = this.db.prepare(`SELECT payload FROM local_dynamic_evidence_copy
      WHERE owner = ? AND project = ? AND run = ? AND slot = ?`).get(...scope, file.slot);
    if (previous) {
      const copy = JSON.parse(String(previous.payload)) as EvidenceCopy;
      if (copy.kind !== kind || copy.sha256 !== sha256 || copy.mimeType !== mimeType
          || copy.bytes !== bytes.length || copy.evidenceId !== (registered?.id ?? file.evidenceId)) {
        throw new DynamicContractError(409, 'The original evidence copy is frozen.');
      }
      if (['available', 'deleting', 'deleted'].includes(copy.availability)) return copy;
      const recovered: EvidenceCopy = { ...copy, availability: 'available', expiresAt: null, syncedBy: this.owner,
        updatedAt: new Date().toISOString() };
      this.db.prepare(`UPDATE local_dynamic_evidence_copy SET payload = ?, content = ?
        WHERE owner = ? AND project = ? AND run = ? AND id = ?`).run(JSON.stringify(recovered), bytes, ...scope, copy.id);
      return recovered;
    }
    const timestamp = new Date().toISOString();
    const id = randomUUID();
    const copy: EvidenceCopy = {
      id, projectId: run.projectId, runId: run.id, evidenceId: registered?.id ?? file.evidenceId,
      kind, mimeType, sha256, bytes: bytes.length, availability: 'available', expiresAt: null,
      executorId: run.createdBy, syncedBy: this.owner, createdAt: timestamp, updatedAt: timestamp,
      ...(artifact && { criterionProof: false, privacyVersion: 1, sourceSha256: artifact.sourceSha256 }),
    };
    this.insert(file.slot, copy, bytes);
    return copy;
  }

  private insert(slot: string, copy: EvidenceCopy, bytes: Buffer | null): void {
    this.db.prepare(`INSERT INTO local_dynamic_evidence_copy (owner, project, run, slot, id, payload, content)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(this.owner, copy.projectId, copy.runId, slot, copy.id, JSON.stringify(copy), bytes);
  }

  private register(artifact: RunArtifact): void {
    this.db.prepare('INSERT INTO local_dynamic_artifact VALUES (?, ?, ?, ?, ?, ?)')
      .run(this.owner, artifact.projectId, artifact.runId, artifact.slot, artifact.id, JSON.stringify(artifact));
  }

  private registerCapture(run: DynamicRun, input: LocalArtifact['input']): RunArtifact {
    const row = this.db.prepare(`SELECT payload FROM local_dynamic_artifact
      WHERE owner = ? AND project = ? AND run = ? AND slot = ?`).get(this.owner, run.projectId, run.id, input.slot);
    if (row) {
      const saved = JSON.parse(String(row.payload)) as RunArtifact;
      if (Object.entries(input).some(([key, value]) => saved[key as keyof RunArtifact] !== value)) {
        throw new DynamicContractError(409, 'The original diagnostic artifact is frozen.');
      }
      return saved;
    }
    const artifact: RunArtifact = { ...input, id: randomUUID(), projectId: run.projectId, runId: run.id, registeredBy: this.owner,
      capturedAt: run.updatedAt, createdAt: new Date().toISOString() };
    try { verifyArchivedArtifact(run, artifact); }
    catch { throw new DynamicContractError(409, 'The diagnostic file does not match the saved Run or permission.'); }
    this.register(artifact);
    return artifact;
  }

  content(project: string, run: string, id: string): { copy: EvidenceCopy; bytes: Buffer } {
    const row = this.db.prepare(`SELECT payload, content FROM local_dynamic_evidence_copy
      WHERE owner = ? AND project = ? AND run = ? AND id = ?`).get(this.owner, project, run, id);
    if (!row) throw new DynamicContractError(404, 'Evidence copy not found in this Run.');
    const copy = JSON.parse(String(row.payload)) as EvidenceCopy;
    if (copy.availability !== 'available' || !(row.content instanceof Uint8Array)) {
      throw new DynamicContractError(409, 'Recorded evidence is unavailable.');
    }
    const bytes = Buffer.from(row.content);
    verify(bytes, copy.bytes, copy.sha256);
    return { copy, bytes };
  }

  remove(project: string, run: string, id: string): EvidenceCopy {
    const row = this.db.prepare(`UPDATE local_dynamic_evidence_copy SET content = NULL,
      payload = CASE WHEN json_extract(payload, '$.availability') = 'deleted' THEN payload ELSE
        json_set(payload, '$.availability', 'deleted', '$.deletedBy', ?, '$.updatedAt', ?) END
      WHERE owner = ? AND project = ? AND run = ? AND id = ? RETURNING payload`)
      .get(this.owner, new Date().toISOString(), this.owner, project, run, id);
    if (!row) throw new DynamicContractError(404, 'Evidence copy not found in this Run.');
    return JSON.parse(String(row.payload)) as EvidenceCopy;
  }
}
