import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export const localIndexRetentionSchema = `
  CREATE TABLE IF NOT EXISTS local_repository_index_cache (
    owner TEXT NOT NULL, project TEXT NOT NULL, fingerprint TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'ready')), used INTEGER NOT NULL,
    PRIMARY KEY (owner, project, fingerprint), FOREIGN KEY (owner, project) REFERENCES project(owner, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_repository_index_age ON local_repository_index_cache
    (owner, project, state, used DESC, fingerprint);
`;

const fingerprintPattern = /^[a-f0-9]{64}$/;
const stagePattern = /^stage-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const retainedReadyCount = 3;
const pendingLifetime = 7 * 24 * 60 * 60_000;

export function localIndexKey(owner: string, project: string, fingerprint: string): string {
  return createHash('sha256').update(`${owner}:${project}:${fingerprint}`).digest('hex');
}

export class LocalIndexRetention {
  constructor(private readonly db: DatabaseSync, private readonly owner: string, private readonly project: string) {}

  touch(fingerprint: string, state: 'pending' | 'ready', now = Date.now()): void {
    this.db.prepare(`INSERT INTO local_repository_index_cache VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (owner, project, fingerprint) DO UPDATE SET state = excluded.state, used = excluded.used`)
      .run(this.owner, this.project, fingerprint, state, now);
  }

  candidates(protectedFingerprint: string, now = Date.now()): string[] {
    // Pin queued and paused work, live leases and the newest whole-project index.
    // A Review's frozen source remains durable even when a derived index is evicted.
    const rows = this.db.prepare(`WITH jobs AS (
      SELECT state, updated, id, json_extract(payload, '$.fingerprint') fingerprint,
        json_extract(payload, '$.leaseUntil') lease, json_extract(payload, '$.trigger') job_trigger
      FROM local_source_index_job WHERE owner = ? AND project = ?
    ), pinned AS (
      SELECT fingerprint FROM jobs WHERE state IN ('queued', 'paused') OR (state = 'running' AND lease > ?)
      UNION SELECT fingerprint FROM (
        SELECT fingerprint FROM jobs WHERE state = 'ready' AND job_trigger IN ('source_changed', 'manual')
        ORDER BY updated DESC, id LIMIT 1
      )
    ), recent AS (
      SELECT fingerprint FROM local_repository_index_cache WHERE owner = ? AND project = ? AND state = 'ready'
      ORDER BY used DESC, fingerprint LIMIT ?
    )
    SELECT fingerprint FROM local_repository_index_cache AS entry
    WHERE owner = ? AND project = ? AND fingerprint <> ?
      AND NOT EXISTS (SELECT 1 FROM pinned WHERE pinned.fingerprint = entry.fingerprint)
      AND NOT EXISTS (SELECT 1 FROM recent WHERE recent.fingerprint = entry.fingerprint)
      AND (state = 'ready' OR used < ?)
    ORDER BY used, fingerprint LIMIT 8`).all(this.owner, this.project, now, this.owner, this.project,
      retainedReadyCount, this.owner, this.project, protectedFingerprint, now - pendingLifetime);
    return rows.map(row => String(row.fingerprint)).filter(fingerprint => fingerprintPattern.test(fingerprint));
  }

  forget(fingerprint: string): void {
    this.db.prepare('DELETE FROM local_repository_index_cache WHERE owner = ? AND project = ? AND fingerprint = ?')
      .run(this.owner, this.project, fingerprint);
  }
}

/** Only remove an owned, journaled hash directory. Skip redirected or unknown layouts. */
export async function removeLocalIndexDirectory(root: string, key: string): Promise<boolean> {
  if (!fingerprintPattern.test(key)) return false;
  try {
    const cache = await fs.lstat(root);
    if (!cache.isDirectory() || cache.isSymbolicLink()) return false;
    const directory = path.join(root, key);
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    if (entries.some(entry => entry.isSymbolicLink() || (entry.isDirectory() ? !stagePattern.test(entry.name)
      : !entry.isFile() || !/^(?:pending\.json|location\.json|stage-[a-f0-9-]{36}\.receipt\.json|location-[a-f0-9-]{36}\.partial)$/.test(entry.name)))) return false;
    await fs.rm(directory, { recursive: true, force: true });
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
  }
}

export async function removeSupersededIndexStages(directory: string, current: string): Promise<void> {
  if (!stagePattern.test(current)) return;
  const stat = await fs.lstat(directory).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return;
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === current || !stagePattern.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const stage = path.join(directory, entry.name);
    try {
      await fs.rm(stage, { recursive: true, force: true });
      await fs.rm(`${stage}.receipt.json`, { force: true });
    } catch { /* Retry cleanup at a later build. */ }
  }
}
