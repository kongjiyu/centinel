import type { DatabaseSync } from 'node:sqlite';
import { decryptLocalWorkspaceSecret, encryptLocalWorkspaceSecret } from '../tokenVault.js';
import { throwIfAborted } from './abort.js';
import { MAX_CACHE_JSON_BYTES, sanitizeBatchCacheRecord, canonicalBatchCacheJson, ValidatedBatchCacheError,
  type ValidatedBatchCache, type ValidatedBatchCacheRecord } from './batchCheckpoint.js';

export const localBatchCacheSchema = `
  CREATE TABLE IF NOT EXISTS local_review_batch_cache (
    owner TEXT NOT NULL, project TEXT NOT NULL, request TEXT NOT NULL, review TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, request), FOREIGN KEY (owner, project, review) REFERENCES local_review(owner, project, id)
  ) STRICT;
`;

const sealedLimit = Math.ceil(MAX_CACHE_JSON_BYTES / 3) * 4 + 128;

export class LocalBatchCache implements ValidatedBatchCache {
  constructor(private readonly db: DatabaseSync, private readonly ownerId: string) {}

  private scope(project: string, request: string): string {
    return JSON.stringify(['review-batch-cache', this.ownerId, project, request]);
  }

  async load(projectId: string, requestHash: string, signal?: AbortSignal): Promise<ValidatedBatchCacheRecord | null> {
    throwIfAborted(signal);
    let row;
    try {
      row = this.db.prepare(`SELECT review, CASE WHEN length(payload) <= ? THEN payload ELSE NULL END AS payload
        FROM local_review_batch_cache WHERE owner = ? AND project = ? AND request = ?`)
        .get(sealedLimit, this.ownerId, projectId, requestHash);
    } catch { throw new ValidatedBatchCacheError('Local Review cache is unavailable.', 'persistence'); }
    if (!row) return null;
    try {
      if (typeof row.payload !== 'string') throw new Error('Invalid envelope.');
      const plaintext = decryptLocalWorkspaceSecret(this.scope(projectId, requestHash), row.payload);
      if (Buffer.byteLength(plaintext) > MAX_CACHE_JSON_BYTES) throw new Error('Oversized record.');
      const record = sanitizeBatchCacheRecord(JSON.parse(plaintext), { ownerId: this.ownerId, projectId, requestHash });
      if (record.originReviewId !== row.review || canonicalBatchCacheJson(record) !== plaintext) throw new Error('Changed identity.');
      return record;
    } catch { throw new ValidatedBatchCacheError('The local Review cache record could not be verified.', 'invalid_archive'); }
  }

  async save(record: ValidatedBatchCacheRecord, signal?: AbortSignal) {
    throwIfAborted(signal);
    if (this.write(record) === 0) await this.load(record.projectId, record.requestHash, signal);
  }

  // The importer owns the transaction, including the origin Review rows.
  seed(project: string, records: ValidatedBatchCacheRecord[]): void {
    for (const record of records) {
      if (record?.projectId !== project || this.write(record) !== 1) {
        throw new ValidatedBatchCacheError('The archived Review cache contains a duplicate or out-of-scope record.', 'invalid_record');
      }
    }
  }

  private write(value: ValidatedBatchCacheRecord) {
    const record = sanitizeBatchCacheRecord(value);
    if (record.ownerId !== this.ownerId) throw new ValidatedBatchCacheError('Review cache owner mismatch.', 'owner_mismatch');
    const plaintext = canonicalBatchCacheJson(record);
    if (Buffer.byteLength(plaintext) > MAX_CACHE_JSON_BYTES) throw new ValidatedBatchCacheError('Review cache record is oversized.', 'invalid_record');
    try {
      const payload = encryptLocalWorkspaceSecret(this.scope(record.projectId, record.requestHash), plaintext);
      return this.db.prepare(`INSERT INTO local_review_batch_cache VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (owner, project, request) DO NOTHING`)
        .run(this.ownerId, record.projectId, record.requestHash, record.originReviewId, payload).changes;
    } catch { throw new ValidatedBatchCacheError('The encrypted local Review cache could not be saved.', 'persistence'); }
  }
}
