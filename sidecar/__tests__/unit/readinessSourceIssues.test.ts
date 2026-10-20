import { describe, expect, it } from 'vitest';
import { ApplicationRepositoryError } from '../../src/applicationRepository.js';
import { sourceReadIssue, sourceSyncIssue } from '../../src/readiness/sourceIssues.js';

describe('safe source availability causes', () => {
  it('classifies only known sync codes and never arbitrary provider messages', () => {
    expect(sourceSyncIssue('http_401')).toBe('authorization_required');
    expect(sourceSyncIssue('token_expired')).toBe('authorization_required');
    expect(sourceSyncIssue('http_403')).toBe('sync_failed');
    expect(sourceSyncIssue('http_503', true)).toBe('partial_import');
    expect(sourceSyncIssue('private provider error')).toBe('sync_failed');
  });
  it('classifies saved storage/version failures without copying error text', () => {
    expect(sourceReadIssue(new ApplicationRepositoryError('private', 'artifact_storage_missing'))).toBe('version_missing');
    expect(sourceReadIssue(new ApplicationRepositoryError('private', 'artifact_hash_mismatch'))).toBe('content_changed');
    expect(sourceReadIssue(new Error('private token details'))).toBe('content_unavailable');
    expect(sourceReadIssue({ code: 'artifact_hash_mismatch' })).toBe('content_unavailable');
  });
});
