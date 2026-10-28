import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync, gzipSync } from 'node:zlib';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({ requireProjectMember: vi.fn() }));
vi.mock('../../src/applicationRepository.js', () => ({
  CentinelApplicationRepository: class {
    constructor(_client: unknown, _userId: string) {}
    requireProjectMember = mocks.requireProjectMember;
  },
}));

import { SupabaseValidatedBatchCache, optionalValidatedBatchCache, type ValidatedBatchCacheRecord } from '../../src/review/batchCheckpoint.js';

const owner = '11111111-1111-4111-8111-111111111111';
const otherOwner = '22222222-2222-4222-8222-222222222222';
const project = '33333333-3333-4333-8333-333333333333';
const originReviewId = '44444444-4444-4444-8444-444444444444';
const requestHash = 'a'.repeat(64);
const sourceVersion = 'b'.repeat(64);

function record(overrides: Partial<ValidatedBatchCacheRecord> = {}): ValidatedBatchCacheRecord {
  return {
    version: 1,
    projectId: project,
    ownerId: owner,
    originReviewId,
    requestHash,
    policyVersion: 'review-policy-test-v1',
    validationVersion: 'assessment-validation-test-v1',
    providerFingerprint: 'c'.repeat(64),
    generation: {
      findings: [{
        title: 'Authorization guard can be skipped', description: 'The request can reach the handler without the expected guard.',
        category: 'authorization', severity: 'high', filePath: 'src/route.ts', lineNumber: 8,
        evidence: 'if (authenticated) {', recommendation: 'Require the authenticated state before dispatch.', confidence: 'high',
        domain: 'security', issueType: 'authorization_bypass', logicFlow: ['The request reaches the handler.'],
        relatedLocations: [], artifactId: 'artifact-one', requirementId: null, standardId: null, standardRuleId: null,
        ruleId: null, sourceIdentity: 'src/route.ts', sourceVersion,
        sourceLocator: { analysis: { featureId: 'feature-one', pathId: 'path-one', domain: 'security' } },
      }],
      featureAssessments: [{ featureId: 'feature-one', assessments: [
        { domain: 'security', status: 'assessed', outcome: 'potential_gap', summary: 'A security gap is evidenced.', evidence: [{ artifactId: 'artifact-one', filePath: 'src/route.ts', lineNumber: 8, sourceVersion }] },
        { domain: 'business', status: 'assessed', outcome: 'no_issue_identified', summary: 'No business issue was identified.', evidence: [] },
        { domain: 'technical', status: 'assessed', outcome: 'no_issue_identified', summary: 'No technical issue was identified.', evidence: [] },
        { domain: 'personnel', status: 'assessed', outcome: 'no_issue_identified', summary: 'No personnel issue was identified.', evidence: [] },
      ] }],
    },
    supportRecords: [{
      candidateId: 'd'.repeat(64), claimBoundary: 'local_source', disposition: 'supported',
      trigger: 'The request is accepted before the guard runs.', consequence: 'An unauthenticated caller can reach the operation.',
      references: [{ role: 'entry', artifactId: 'artifact-one', filePath: 'src/route.ts', sourceVersion, lineNumber: 8, evidence: 'if (authenticated) {' }],
      authorityReferences: [], limitation: null,
    }],
    ...overrides,
  };
}

function backend() {
  const objects = new Map<string, Buffer>();
  const events = new Map<string, Record<string, unknown>>();
  const counters = { upload: 0, download: 0, remove: 0, insert: 0 };
  let uploadError: unknown = null;
  let insertError: unknown = null;
  const makeClient = (userId = owner) => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })) },
    storage: { from: () => ({
      upload: vi.fn(async (path: string, bytes: Buffer) => {
        counters.upload++;
        if (uploadError) return { data: null, error: uploadError };
        if (objects.has(path)) return { data: null, error: { statusCode: '409', message: 'already exists' } };
        objects.set(path, Buffer.from(bytes));
        return { data: { path }, error: null };
      }),
      download: vi.fn(async (path: string) => {
        counters.download++;
        const bytes = objects.get(path);
        return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { statusCode: '404', message: 'Object not found' } };
      }),
      remove: vi.fn(async (paths: string[]) => {
        counters.remove++;
        for (const path of paths) objects.delete(path);
        return { data: [], error: null };
      }),
    }) },
    from: (table: string) => {
      if (table !== 'audit_events') throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => {
          const filters = new Map<string, unknown>();
          const query = {
            eq(column: string, value: unknown) { filters.set(column, value); return query; },
            abortSignal() { return query; },
            async maybeSingle() {
              const row = events.get(String(filters.get('id')));
              if (!row || [...filters].some(([key, value]) => row[key] !== value)) return { data: null, error: null };
              return { data: row, error: null };
            },
          };
          return query;
        },
        async insert(row: Record<string, unknown>) {
          counters.insert++;
          if (insertError) return { data: null, error: insertError };
          const id = String(row.id);
          const idempotency = String(row.idempotency_key);
          if (events.has(id) || [...events.values()].some(item => item.actor_id === row.actor_id && item.idempotency_key === idempotency)) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          events.set(id, row);
          return { data: row, error: null };
        },
      };
    },
  } as unknown as SupabaseClient);
  return { makeClient, objects, events, counters, setUploadError: (value: unknown) => { uploadError = value; }, setInsertError: (value: unknown) => { insertError = value; } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CENTINEL_TOKEN_ENCRYPTION_KEY', 'offline-cache-test-only-not-a-secret');
  mocks.requireProjectMember.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe('Supabase validated batch cache', () => {
  it('requires server encryption before a runtime can perform paid work', () => {
    vi.stubEnv('CENTINEL_TOKEN_ENCRYPTION_KEY', '');
    expect(() => new SupabaseValidatedBatchCache(backend().makeClient(), owner)).toThrow('encryption is unavailable');
    expect(optionalValidatedBatchCache(backend().makeClient(), owner)).toBeUndefined();
  });
  it('stores an immutable compressed result and requires its matching audit receipt on load', async () => {
    const backendState = backend();
    const cache = new SupabaseValidatedBatchCache(backendState.makeClient(), owner);

    await cache.save(record());
    const loaded = await cache.load(project, requestHash);

    expect(loaded).toEqual(record());
    expect(backendState.counters).toEqual({ upload: 1, download: 1, remove: 0, insert: 1 });
    const [path] = backendState.objects.keys();
    const [receipt] = backendState.events.values();
    expect(receipt).toMatchObject({ event_type: 'review_batch_cache_saved', entity_type: 'static_review', entity_id: originReviewId, actor_id: owner });
    expect(receipt?.payload).toMatchObject({ version: 1, ownerId: owner, projectId: project, requestHash, archivePath: path,
      archiveSha256: expect.any(String), archiveBytes: expect.any(Number), recordSha256: expect.any(String) });
    expect(path).toMatch(new RegExp(`^${project}/_review-batch-cache/v1/${owner}/${project}/${requestHash}/[a-f0-9]{64}\\.json\\.gz$`));
    expect(JSON.stringify(receipt?.payload)).not.toContain('Authorization guard can be skipped');
    expect(gunzipSync(backendState.objects.get(path!)!).toString('utf8')).not.toContain('Authorization guard can be skipped');
  });

  it('rejects a forged encrypted envelope even when a member rewrites all public receipt hashes', async () => {
    const state = backend();
    const cache = new SupabaseValidatedBatchCache(state.makeClient(), owner);
    await cache.save(record());
    const receipt = [...state.events.values()][0]!;
    const payload = receipt.payload as Record<string, any>;
    const oldPath = payload.archivePath as string;
    const envelope = gunzipSync(state.objects.get(oldPath)!).toString('utf8');
    const parts = envelope.split('.');
    parts[2] = (parts[2]![0] === 'A' ? 'B' : 'A') + parts[2]!.slice(1);
    const changed = Buffer.from(parts.join('.'));
    const archive = gzipSync(changed);
    const hash = (value: Buffer) => crypto.createHash('sha256').update(value).digest('hex');
    payload.archiveSha256 = hash(archive);
    payload.archivePath = oldPath.replace(/[a-f0-9]{64}\.json\.gz$/, `${payload.archiveSha256}.json.gz`);
    payload.archiveBytes = archive.length;
    payload.recordSha256 = hash(changed);
    state.objects.set(payload.archivePath, archive);
    await expect(cache.load(project, requestHash)).rejects.toMatchObject({ code: 'invalid_archive' });
  });

  it('does not expose records after server encryption-key rotation', async () => {
    const state = backend();
    const cache = new SupabaseValidatedBatchCache(state.makeClient(), owner);
    await cache.save(record());
    vi.stubEnv('CENTINEL_TOKEN_ENCRYPTION_KEY', 'different-offline-test-key');
    await expect(cache.load(project, requestHash)).rejects.toMatchObject({ code: 'invalid_archive' });
  });

  it('treats a storage object without a receipt as a miss and never downloads it', async () => {
    const backendState = backend();
    backendState.objects.set(`${project}/_review-batch-cache/v1/${owner}/${project}/${requestHash}/orphan.json.gz`, Buffer.from('orphan'));
    const cache = new SupabaseValidatedBatchCache(backendState.makeClient(), owner);

    await expect(cache.load(project, requestHash)).resolves.toBeNull();
    expect(backendState.counters.download).toBe(0);
  });

  it('keeps the first valid immutable result when a later save uses the same request key', async () => {
    const backendState = backend();
    const cache = new SupabaseValidatedBatchCache(backendState.makeClient(), owner);
    await cache.save(record());
    await cache.save(record({ originReviewId: '55555555-5555-4555-8555-555555555555' }));

    expect(await cache.load(project, requestHash)).toMatchObject({ originReviewId });
    expect(backendState.counters.upload).toBe(1);
    expect(backendState.counters.insert).toBe(1);
  });

  it('rejects tampered archives and receipt-backed missing objects', async () => {
    const backendState = backend();
    const cache = new SupabaseValidatedBatchCache(backendState.makeClient(), owner);
    await cache.save(record());
    const path = [...backendState.objects.keys()][0]!;
    backendState.objects.set(path, Buffer.from('tampered'));
    await expect(cache.load(project, requestHash)).rejects.toMatchObject({ code: 'invalid_archive' });
    backendState.objects.delete(path);
    await expect(cache.load(project, requestHash)).rejects.toMatchObject({ code: 'invalid_archive' });
  });

  it('refuses non-supported or ambiguous payloads before any persistence call', async () => {
    const backendState = backend();
    const cache = new SupabaseValidatedBatchCache(backendState.makeClient(), owner);

    await expect(cache.save(record({ supportRecords: [{ ...record().supportRecords[0]!, disposition: 'contradicted' }] })))
      .rejects.toMatchObject({ code: 'invalid_record' });
    await expect(cache.save(record({ generation: { ...(record().generation as object), privateReason: 'hidden' } })))
      .rejects.toMatchObject({ code: 'invalid_record' });
    await expect(cache.save(record({ supportRecords: [] }))).rejects.toMatchObject({ code: 'invalid_record' });
    expect(backendState.counters.upload).toBe(0);
    expect(backendState.counters.insert).toBe(0);
  });

  it('rejects a record for another owner and a client whose verified user differs', async () => {
    const backendState = backend();
    const cache = new SupabaseValidatedBatchCache(backendState.makeClient(), owner);
    await expect(cache.save(record({ ownerId: otherOwner }))).rejects.toMatchObject({ code: 'owner_mismatch' });

    const otherClient = new SupabaseValidatedBatchCache(backendState.makeClient(otherOwner), owner);
    await expect(otherClient.load(project, requestHash)).rejects.toMatchObject({ code: 'owner_mismatch' });
    expect(backendState.counters.upload).toBe(0);
  });

  it('obtains a refreshed client and rechecks membership for each storage and receipt operation', async () => {
    const backendState = backend();
    const source = vi.fn(() => backendState.makeClient());
    const cache = new SupabaseValidatedBatchCache(source, owner);

    await cache.save(record());
    expect(source.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(mocks.requireProjectMember).toHaveBeenCalledTimes(source.mock.calls.length);
  });

  it('stops on persistence failure and publishes a fresh authenticated envelope on a later save', async () => {
    const uploadFailure = backend();
    uploadFailure.setUploadError({ statusCode: '503', message: 'storage unavailable' });
    const failedUploadCache = new SupabaseValidatedBatchCache(uploadFailure.makeClient(), owner);
    await expect(failedUploadCache.save(record())).rejects.toMatchObject({ code: 'persistence' });
    expect(uploadFailure.counters.insert).toBe(0);

    const receiptFailure = backend();
    receiptFailure.setInsertError({ code: 'XX000', message: 'journal unavailable' });
    const failedReceiptCache = new SupabaseValidatedBatchCache(receiptFailure.makeClient(), owner);
    await expect(failedReceiptCache.save(record())).rejects.toMatchObject({ code: 'persistence' });
    expect(receiptFailure.objects.size).toBe(1);
    expect(await failedReceiptCache.load(project, requestHash)).toBeNull();
    receiptFailure.setInsertError(null);
    await failedReceiptCache.save(record());
    expect(await failedReceiptCache.load(project, requestHash)).toEqual(record());
    expect(receiptFailure.counters.upload).toBe(2);
    expect(receiptFailure.counters.insert).toBe(2);
  });

  it('enforces the public JSON and archive size limits', async () => {
    const backendState = backend();
    const cache = new SupabaseValidatedBatchCache(backendState.makeClient(), owner);
    const base = record();
    const firstFinding = (base.generation as { findings: Array<Record<string, unknown>> }).findings[0]!;
    const findings = Array.from({ length: 32 }, (_, index) => ({ ...firstFinding,
      title: `Finding ${index}`, description: 'd'.repeat(65_536), evidence: 'e'.repeat(65_536), recommendation: 'r'.repeat(16_384),
    }));
    const supportRecords = findings.map((_, index) => ({ ...base.supportRecords[0]!, candidateId: index.toString(16).padStart(64, '0') }));
    const oversized = record({ generation: { findings, featureAssessments: [] }, supportRecords });
    await expect(cache.save(oversized)).rejects.toMatchObject({ code: 'invalid_record' });
    expect(backendState.counters.upload).toBe(0);
  });
});
