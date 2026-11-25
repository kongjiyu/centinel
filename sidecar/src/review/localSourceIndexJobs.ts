import type { DatabaseSync } from 'node:sqlite';
import type { SourceIndexHold, SourceIndexJob, SourceIndexJobStore } from './sourceIndexJobs.js';

export const localSourceIndexSchema = `
  CREATE TABLE IF NOT EXISTS local_source_index_job (
    owner TEXT NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL,
    state TEXT NOT NULL, revision INTEGER NOT NULL, updated TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, id), FOREIGN KEY (owner, project) REFERENCES project(owner, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_source_index_job_project ON local_source_index_job (owner, project, updated DESC, id);
  CREATE TABLE IF NOT EXISTS local_source_index_hold (
    owner TEXT NOT NULL, project TEXT NOT NULL, revision INTEGER NOT NULL, code TEXT,
    PRIMARY KEY (owner, project), FOREIGN KEY (owner, project) REFERENCES project(owner, id)
  ) STRICT;
`;

export class LocalSourceIndexJobStore implements SourceIndexJobStore {
  constructor(private readonly db: DatabaseSync, private readonly owner: string) {}

  async get(id: string) {
    const row = this.db.prepare('SELECT payload FROM local_source_index_job WHERE owner = ? AND id = ?').get(this.owner, id);
    return row ? JSON.parse(String(row.payload)) as SourceIndexJob : null;
  }

  async latest(project: string, owner: string) {
    if (owner !== this.owner) return null;
    const row = this.db.prepare(`SELECT payload FROM local_source_index_job WHERE owner = ? AND project = ?
      ORDER BY updated DESC, id LIMIT 1`).get(this.owner, project);
    return row ? JSON.parse(String(row.payload)) as SourceIndexJob : null;
  }

  async paused(project: string, owner: string) {
    if (owner !== this.owner) return [];
    return this.db.prepare("SELECT payload FROM local_source_index_job WHERE owner = ? AND project = ? AND state = 'paused'")
      .all(this.owner, project).map(row => JSON.parse(String(row.payload)) as SourceIndexJob);
  }

  async insert(job: SourceIndexJob) {
    if (job.ownerId !== this.owner || job.revision !== 0) return false;
    return this.db.prepare('INSERT INTO local_source_index_job VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .run(this.owner, job.projectId, job.id, job.state, job.revision, job.updatedAt, JSON.stringify(job)).changes === 1;
  }

  async compareAndSet(previous: SourceIndexJob, next: SourceIndexJob) {
    if (previous.ownerId !== this.owner || next.ownerId !== this.owner || previous.projectId !== next.projectId
      || previous.id !== next.id || previous.fingerprint !== next.fingerprint || next.revision !== previous.revision + 1) return false;
    return this.db.prepare(`UPDATE local_source_index_job SET state = ?, revision = ?, updated = ?, payload = ?
      WHERE owner = ? AND project = ? AND id = ? AND revision = ?`)
      .run(next.state, next.revision, next.updatedAt, JSON.stringify(next), this.owner, previous.projectId, previous.id, previous.revision).changes === 1;
  }

  async hold(project: string, owner: string) {
    if (owner !== this.owner) return null;
    const row = this.db.prepare('SELECT revision, code FROM local_source_index_hold WHERE owner = ? AND project = ?').get(this.owner, project);
    return row ? { revision: Number(row.revision), code: row.code as string | null } : null;
  }

  async compareHold(project: string, owner: string, previous: SourceIndexHold | null, next: SourceIndexHold) {
    if (owner !== this.owner || next.revision !== (previous?.revision ?? -1) + 1) return false;
    const result = previous
      ? this.db.prepare('UPDATE local_source_index_hold SET revision = ?, code = ? WHERE owner = ? AND project = ? AND revision = ?')
        .run(next.revision, next.code, this.owner, project, previous.revision)
      : this.db.prepare('INSERT INTO local_source_index_hold VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
        .run(this.owner, project, next.revision, next.code);
    return result.changes === 1;
  }
}
