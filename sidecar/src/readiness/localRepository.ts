import type { DatabaseSync } from 'node:sqlite';
import type { ReadinessJob, ReadinessStore } from './service.js';

export const localReadinessSchema = `
  CREATE TABLE IF NOT EXISTS local_readiness_job (
    owner TEXT NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL, requested TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, id), FOREIGN KEY (owner, project) REFERENCES project(owner, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_readiness_latest ON local_readiness_job (owner, project, requested DESC, id DESC);
`;

export class LocalReadinessStore implements ReadinessStore {
  constructor(private readonly db: DatabaseSync, private readonly owner: string) {}

  async latest(projectId: string): Promise<ReadinessJob | null> {
    const row = this.db.prepare(`SELECT payload FROM local_readiness_job WHERE owner = ? AND project = ?
      ORDER BY requested DESC, id DESC LIMIT 1`).get(this.owner, projectId);
    return row ? JSON.parse(String(row.payload)) as ReadinessJob : null;
  }

  async save(job: ReadinessJob) {
    if (!job.requestId || !job.requestedAt) throw new Error('Readiness job identity is required.');
    if (job.snapshot && job.snapshot.projectId !== job.projectId) throw new Error('Readiness snapshot belongs to another project.');
    const result = this.db.prepare(`INSERT INTO local_readiness_job VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (owner, project, id) DO UPDATE SET payload = excluded.payload WHERE requested = excluded.requested`)
      .run(this.owner, job.projectId, job.requestId, job.requestedAt, JSON.stringify(job));
    if (!result.changes) throw new Error('Readiness request time cannot be changed.');
  }

  /** Called inside the workspace snapshot transaction, before this project runs locally. */
  seed(project: string, jobs: ReadinessJob[]) {
    const ids = new Set<string>();
    for (const job of jobs) {
      if (!job || job.projectId !== project || typeof job.requestId !== 'string' || !job.requestId
        || !job.requestedAt || !Number.isFinite(Date.parse(job.requestedAt))
        || typeof job.sourceFingerprint !== 'string' || !job.sourceFingerprint
        || !['queued', 'running', 'completed', 'failed', 'paused'].includes(job.status)
        || (job.snapshot && job.snapshot.projectId !== project) || ids.has(job.requestId)) {
        throw new Error('Readiness history is invalid or belongs to another project.');
      }
      ids.add(job.requestId);
    }
    if (this.db.prepare('SELECT 1 FROM local_readiness_job WHERE owner = ? AND project = ? LIMIT 1').get(this.owner, project)) return;
    const insert = this.db.prepare('INSERT INTO local_readiness_job VALUES (?, ?, ?, ?, ?)');
    for (const job of jobs) insert.run(this.owner, project, job.requestId!, job.requestedAt!, JSON.stringify(job));
  }
}
