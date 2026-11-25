import type { DatabaseSync } from 'node:sqlite';
import { ReviewLeaseLostError, type ReviewCheckpoint, type ReviewLease, type ReviewLeaseRepository } from './lease.js';

export const localReviewLeaseSchema = `
  CREATE TABLE IF NOT EXISTS local_review_lease (
    owner TEXT NOT NULL, project TEXT NOT NULL, review TEXT NOT NULL,
    worker TEXT NOT NULL, token TEXT NOT NULL, attempt INTEGER NOT NULL,
    acquired TEXT NOT NULL, heartbeat TEXT NOT NULL, expires TEXT NOT NULL,
    PRIMARY KEY (owner, review), FOREIGN KEY (owner, project, review) REFERENCES local_review(owner, project, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_review_lease_expiry ON local_review_lease (owner, expires, review);
  CREATE TABLE IF NOT EXISTS local_review_checkpoint (
    owner TEXT NOT NULL, project TEXT NOT NULL, review TEXT NOT NULL, updated TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, review), FOREIGN KEY (owner, project, review) REFERENCES local_review(owner, project, id)
  ) STRICT;
`;

function leaseFrom(row: Record<string, unknown>): ReviewLease {
  return { projectId: String(row.project), reviewId: String(row.review), workerId: String(row.worker), leaseToken: String(row.token),
    attempt: Number(row.attempt), acquiredAt: String(row.acquired), heartbeatAt: String(row.heartbeat), expiresAt: String(row.expires) };
}

export class LocalReviewLeases implements ReviewLeaseRepository {
  constructor(private readonly db: DatabaseSync, private readonly owner: string) {}

  async acquireLease(input: Parameters<ReviewLeaseRepository['acquireLease']>[0]) {
    const { projectId, reviewId, workerId, leaseToken, now, expiresAt } = input;
    const row = this.db.prepare(`INSERT INTO local_review_lease
      SELECT owner, project, id, ?, ?, 1, ?, ?, ? FROM local_review
      WHERE owner = ? AND project = ? AND id = ? AND json_extract(payload, '$.status') IN ('queued', 'running')
      ON CONFLICT (owner, review) DO UPDATE SET
        worker = excluded.worker, token = excluded.token, attempt = local_review_lease.attempt + 1,
        heartbeat = excluded.heartbeat, expires = excluded.expires
      WHERE local_review_lease.expires <= excluded.heartbeat
        OR (local_review_lease.worker = excluded.worker AND local_review_lease.token = excluded.token)
      RETURNING *`).get(workerId, leaseToken, now, now, expiresAt, this.owner, projectId, reviewId);
    return row ? leaseFrom(row) : null;
  }

  async renewLease(input: Parameters<ReviewLeaseRepository['renewLease']>[0]) {
    const { reviewId, workerId, leaseToken, now, expiresAt } = input;
    const row = this.db.prepare(`UPDATE local_review_lease SET heartbeat = ?, expires = ?
      WHERE owner = ? AND review = ? AND worker = ? AND token = ? AND expires > ? AND heartbeat <= ? RETURNING *`)
      .get(now, expiresAt, this.owner, reviewId, workerId, leaseToken, now, now);
    return row ? leaseFrom(row) : null;
  }

  async releaseLease(input: Parameters<ReviewLeaseRepository['releaseLease']>[0]) {
    return this.db.prepare('DELETE FROM local_review_lease WHERE owner = ? AND review = ? AND worker = ? AND token = ?')
      .run(this.owner, input.reviewId, input.workerId, input.leaseToken).changes === 1;
  }

  async listExpiredLeases(now: string) {
    return this.db.prepare('SELECT * FROM local_review_lease WHERE owner = ? AND expires <= ? ORDER BY expires, review')
      .all(this.owner, now).map(leaseFrom);
  }

  async saveCheckpoint(checkpoint: ReviewCheckpoint) {
    const result = this.db.prepare(`INSERT INTO local_review_checkpoint
      SELECT owner, project, review, ?, ? FROM local_review_lease
      WHERE owner = ? AND project = ? AND review = ? AND worker = ? AND token = ?
      ON CONFLICT (owner, review) DO UPDATE SET updated = excluded.updated, payload = excluded.payload
      WHERE local_review_checkpoint.updated <= excluded.updated`)
      .run(checkpoint.updatedAt, JSON.stringify(checkpoint), this.owner, checkpoint.projectId, checkpoint.reviewId,
        checkpoint.workerId, checkpoint.leaseToken);
    if (!result.changes) throw new ReviewLeaseLostError(checkpoint.reviewId);
  }

  async getCheckpoint(reviewId: string) {
    const row = this.db.prepare('SELECT payload FROM local_review_checkpoint WHERE owner = ? AND review = ?')
      .get(this.owner, reviewId);
    return row ? JSON.parse(String(row.payload)) as ReviewCheckpoint : null;
  }
}
