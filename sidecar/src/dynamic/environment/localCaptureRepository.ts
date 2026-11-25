import type { DatabaseSync } from 'node:sqlite';
import { DynamicContractError } from '../types.js';
import type { SessionCaptureStore } from './captureRepository.js';
import type { LocalEnvironmentRepository } from './localRepository.js';

export const localCaptureSchema = `
  CREATE TABLE IF NOT EXISTS local_dynamic_capture (
    owner TEXT NOT NULL, project TEXT NOT NULL, profile TEXT NOT NULL, id TEXT NOT NULL,
    state TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, token TEXT,
    PRIMARY KEY (owner, project, id),
    FOREIGN KEY (owner, project, profile) REFERENCES local_dynamic_environment(owner, project, id)
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS local_capture_active ON local_dynamic_capture(owner, project) WHERE state = 'open';
`;

export function requireNoLocalCapture(db: DatabaseSync, owner: string, project: string): void {
  if (db.prepare("SELECT 1 FROM local_dynamic_capture WHERE owner = ? AND project = ? AND state = 'open'").get(owner, project)) {
    throw new DynamicContractError(409, 'Save or close the sign-in browser before starting project work.');
  }
}

const windowMs = 60_000;
const maxCaptureMs = 320_000;
export class LocalSessionCaptures implements SessionCaptureStore {
  constructor(private readonly db: DatabaseSync, private readonly owner: string, private readonly environments: LocalEnvironmentRepository,
    private readonly recoverProjectWork: (project: string) => Promise<void>, private readonly now = Date.now) {}

  async acquire(project: string, profile: string, id: string, token: string, worker: string, version?: number) {
    if (!id || !token || !worker) return false;
    await this.recoverProjectWork(project);
    await this.recover(project);
    return this.transaction(() => {
      const now = this.now();
      this.checkIdle(project);
      this.environments.reserveCapture(project, profile, id, version);
      this.db.prepare("INSERT INTO local_dynamic_capture VALUES (?, ?, ?, ?, 'open', ?, ?, ?)")
        .run(this.owner, project, profile, id, now, now + windowMs, token);
      return true;
    });
  }

  async heartbeat(project: string, id: string, token: string) {
    const now = this.now();
    return this.db.prepare(`UPDATE local_dynamic_capture SET expires = min(?, created + ?)
      WHERE owner = ? AND project = ? AND id = ? AND token = ? AND state = 'open' AND expires > ? AND created + ? > ?`)
      .run(now + windowMs, maxCaptureMs, this.owner, project, id, token, now, maxCaptureMs, now).changes === 1;
  }

  async finish(project: string, id: string, token: string, success: boolean) {
    return this.transaction(() => {
      const capture = this.db.prepare(`SELECT profile FROM local_dynamic_capture
        WHERE owner = ? AND project = ? AND id = ? AND token = ? AND state = 'open' AND expires > ?`)
        .get(this.owner, project, id, token, this.now());
      if (!capture) return null;
      const state = success ? 'completed' : 'cancelled';
      this.close(project, String(capture.profile), id, state);
      return { state } as const;
    });
  }

  async recover(project: string) {
    this.transaction(() => this.recoverExpired(project, this.now()));
  }

  async requireIdle(project: string) {
    await this.recoverProjectWork(project);
    await this.recover(project);
    this.checkIdle(project);
  }

  async mutateSession<T>(project: string, profile: string, version: number, mutation: () => T): Promise<T> {
    await this.requireIdle(project);
    return this.transaction(() => {
      this.checkIdle(project);
      this.environments.requireCaptureProfile(project, profile, version);
      return mutation();
    });
  }

  private checkIdle(project: string) {
    requireNoLocalCapture(this.db, this.owner, project);
    const active = this.db.prepare(`SELECT 1 FROM local_dynamic_run WHERE owner = ? AND project = ?
      AND json_extract(payload, '$.state') IN ('queued', 'running')
      UNION ALL SELECT 1 FROM local_dynamic_unit_run WHERE owner = ? AND project = ? AND state IN ('queued', 'running')
      UNION ALL SELECT 1 FROM local_dynamic_hook WHERE owner = ? AND project = ? AND state IN ('queued', 'running') LIMIT 1`)
      .get(this.owner, project, this.owner, project, this.owner, project);
    if (active) throw new DynamicContractError(409, 'Stop project work before changing the sign-in session.');
  }

  private recoverExpired(project: string, now: number) {
    const expired = this.db.prepare("SELECT id, profile FROM local_dynamic_capture WHERE owner = ? AND project = ? AND state = 'open' AND expires <= ?")
      .all(this.owner, project, now);
    for (const row of expired) this.close(project, String(row.profile), String(row.id), 'interrupted');
  }

  private close(project: string, profile: string, id: string, state: 'completed' | 'cancelled' | 'interrupted') {
    this.environments.finishCapture(project, profile, id, state === 'completed');
    this.db.prepare('UPDATE local_dynamic_capture SET state = ?, token = NULL WHERE owner = ? AND project = ? AND id = ?')
      .run(state, this.owner, project, id);
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
}
