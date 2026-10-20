import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseReportSnapshotSource } from '../../src/report/supabaseSnapshot.js';
import { SupabaseStaticReviewRepository } from '../../src/review/supabaseRepository.js';
import { InMemoryStaticReviewRepository } from '../../src/review/repository.js';
import { findingSourceIdentityHash } from '../../src/review/correlation.js';

afterEach(() => vi.restoreAllMocks());

describe('current project risk after review reconciliation', () => {
  async function setup() {
    const projectId = 'project'; const filePath = 'src/account.ts';
    const memory = new InMemoryStaticReviewRepository();
    const reviews = await Promise.all(['old', 'new'].map(async (id, i) => {
      const review = await memory.createReview({ id, projectId, name: id, reviewType: 'code_review', status: 'completed', idempotencyKey: id,
        scope: { artifactIds: ['artifact'] }, config: {}, lineage: { parentReviewId: null, lineageRootId: id, reusedSourceManifest: false } });
      return { ...review, status: 'completed' as const, modelStatus: 'succeeded' as const, sourceManifestId: `manifest-${id}`, createdAt: `2026-10-${19 + i}T00:00:00Z` };
    }));
    vi.spyOn(SupabaseStaticReviewRepository.prototype, 'listReviews').mockResolvedValue(reviews);
    const correlation = { id: 'correlation', parentReviewId: 'old', childReviewId: 'new', parentFindingId: 'finding', childFindingId: null,
      classification: 'resolved' as const, method: 'unmatched' as const, score: 0, stableFingerprint: 'fingerprint', resolutionEligibility: {
        version: 1 as const, basis: 'not_reproduced_in_comparable_review' as const,
        parentSourceManifestId: 'manifest-old', sourceManifestId: 'manifest-new', reviewedArtifactId: 'artifact', parentArtifactId: 'artifact',
        sourceIdentityHash: findingSourceIdentityHash({ artifactId: 'artifact', sourceIdentity: filePath, filePath }), parentSourceVersion: 'old-hash', reviewedSourceVersion: 'new-hash',
      } };
    vi.spyOn(SupabaseStaticReviewRepository.prototype, 'getFindingCorrelationSnapshot').mockImplementation(async id => id === 'new' ? {
      parentReviewId: 'old', childReviewId: 'new', correlations: [correlation], ambiguities: [],
      counts: { new: 0, recurring: 0, regressed: 0, carriedOver: 0, resolved: 1 },
    } : null);
    const finding = { id: 'finding', project_id: projectId, review_session_id: 'old', source: 'static', status: 'new',
      artifact_id: 'artifact', title: 'Missing authorization', category: 'security', severity: 'high', priority: 'high',
      location: { filePath, sourceIdentity: filePath, sourceVersion: 'old-hash' }, created_at: '2026-10-19T00:00:00Z', updated_at: '2026-10-19T00:00:00Z' };
    const rows: Record<string, Array<Record<string, unknown>>> = { projects: [{ id: projectId }], findings: [finding],
      review_source_snapshots: ['old', 'new'].map(id => ({ id: `manifest-${id}`, project_id: projectId, review_session_id: id, status: 'available',
        snapshot: { artifacts: [{ id: 'artifact', path: filePath, metadata: { originalPath: filePath, contentHash: `${id}-hash` } }] } })),
    };
    const client = { from: (name: string) => {
      const filters: Array<[string, unknown]> = []; let range: [number, number] | null = null;
      const visible = () => { const all = (rows[name] ?? []).filter(row => filters.every(([field, value]) => row[field] === value)); return range ? all.slice(range[0], range[1] + 1) : all; };
      const query = { select: () => query, eq: (field: string, value: unknown) => { filters.push([field, value]); return query; }, order: () => query, limit: () => query,
        range: (start: number, end: number) => { range = [start, end]; return query; }, maybeSingle: async () => ({ data: visible()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: visible(), error: null })) };
      return query;
    } } as unknown as SupabaseClient;
    return { source: new SupabaseReportSnapshotSource(client, 'owner'), finding, rows };
  }

  it('removes a verified derived resolution from assessment/export risk without changing saved history', async () => {
    const { source, finding } = await setup();
    expect((await source.getProjectAssessment('project')).summary).toMatchObject({ high: 0, classified: 0 });
    expect(finding.status).toBe('new');
    expect((await source.listAllFindings('project'))[0].status).toBe('new');
  });
  it('keeps risk when changed-source evidence is unavailable', async () => {
    const { source, rows } = await setup(); rows.review_source_snapshots = [];
    expect((await source.getProjectAssessment('project')).summary).toMatchObject({ critical: 1, classified: 1 });
  });
  it('fails the assessment rather than returning a misleading current count if correlation loading fails', async () => {
    const { source } = await setup();
    vi.spyOn(SupabaseStaticReviewRepository.prototype, 'getFindingCorrelationSnapshot').mockRejectedValue(new Error('Unavailable'));
    await expect(source.getProjectAssessment('project')).rejects.toThrow('Unavailable');
  });
});
