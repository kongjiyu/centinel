import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseReportSnapshotSource } from '../../src/report/supabaseSnapshot.js';

describe('Supabase report risk assessment', () => {
  it('exports traceability counts while retaining per-record evidence status', async () => {
    const projectId = 'project-1';
    const reviewId = 'review-1';
    const rows: Record<string, Array<Record<string, unknown>>> = {
      projects: [{ id: projectId }],
      review_traceability_snapshots: [{
        project_id: projectId,
        review_session_id: reviewId,
        status: 'available',
        created_at: '2026-10-21T00:00:00Z',
        summary: {
          complete: 2, incomplete: 1, missing: 3, attention: 4, unavailable: 5,
          grounding: { confirmedRequirements: [{ id: 'private-requirement' }] },
          context: 'must not appear in a report',
        },
        records: [{ requirementId: 'requirement-1', state: 'complete', evidenceStatus: 'verified' }],
      }],
    };
    const client = {
      from: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        const visible = () => (rows[table] ?? []).filter(row => filters.every(([field, value]) => row[field] === value));
        const query = {
          select: () => query,
          eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
          maybeSingle: async () => ({ data: visible()[0] ?? null, error: null }),
        };
        return query;
      },
    } as unknown as SupabaseClient;
    const source = new SupabaseReportSnapshotSource(client, 'owner-1');

    const snapshot = await source.getReviewTraceabilitySnapshot(projectId, reviewId);

    expect(snapshot?.summary).toEqual({ complete: 2, incomplete: 1, missing: 3, attention: 4, unavailable: 5 });
    expect(snapshot?.records[0]).toMatchObject({ requirementId: 'requirement-1', evidenceStatus: 'verified' });
    expect(snapshot).not.toHaveProperty('metadata');
    expect(snapshot?.summary).not.toHaveProperty('grounding');
    expect(snapshot?.summary).not.toHaveProperty('context');
  });

  it('loads the frozen manifest referenced by a child Review attempt', async () => {
    const projectId = 'project-1';
    const reviewId = 'review-child';
    const manifestId = 'manifest-parent';
    const rows: Record<string, Array<Record<string, unknown>>> = {
      projects: [{ id: projectId }],
      review_sessions: [{ id: reviewId, project_id: projectId, source_manifest_id: manifestId }],
      review_source_snapshots: [{
        id: manifestId,
        project_id: projectId,
        review_session_id: 'review-parent',
        status: 'available',
        created_at: '2026-10-20T00:00:00Z',
        snapshot: { artifactCount: 1, sources: [{ id: 'source-1', artifactIds: ['artifact-1'] }] },
      }],
    };
    const client = {
      from: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        const visible = () => (rows[table] ?? []).filter(row => filters.every(([field, value]) => row[field] === value));
        const query = {
          select: () => query,
          eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
          maybeSingle: async () => ({ data: visible()[0] ?? null, error: null }),
        };
        return query;
      },
    } as unknown as SupabaseClient;
    const source = new SupabaseReportSnapshotSource(client, 'owner-1');

    const manifest = await source.getReviewSourceManifest(projectId, reviewId);

    expect(manifest).toMatchObject({ sessionId: reviewId, status: 'available', artifactCount: 1 });
    expect(manifest?.sources).toEqual([{ id: 'source-1', artifactIds: ['artifact-1'] }]);
  });

  it('uses current finding states rather than stale persisted risk counts', async () => {
    const projectId = 'project-1';
    const finding = {
      id: 'finding-1', project_id: projectId, review_session_id: 'review-1', source: 'static',
      severity: 'critical', priority: 'high', title: 'Credential exposure', description: '',
      status: 'accepted', category: 'security', location: { filePath: 'src/auth.ts', lineNumber: 12 },
      created_at: '2026-09-23T00:00:00Z',
    };
    const storedTraceability = { status: 'available', reviewId: 'review-1', summary: { complete: 1 } };
    const rows: Record<string, Array<Record<string, unknown>>> = {
      projects: [{ id: projectId }],
      findings: [finding],
      project_assessments: [{ project_id: projectId, snapshot: {
        projectId, status: 'available', policyVersion: 'old-policy',
        summary: { critical: 9, high: 0, medium: 0, low: 0, classified: 9, unclassified: 0 },
        riskItems: [], traceability: storedTraceability,
      } }],
    };
    const client = {
      from: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        let selectedRange: [number, number] | null = null;
        const visible = () => {
          const filtered = (rows[table] ?? []).filter(row => filters.every(([field, value]) => row[field] === value));
          return selectedRange ? filtered.slice(selectedRange[0], selectedRange[1] + 1) : filtered;
        };
        const query = {
          select: () => query,
          eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
          order: () => query,
          limit: () => query,
          range: (start: number, end: number) => { selectedRange = [start, end]; return query; },
          maybeSingle: async () => ({ data: visible()[0] ?? null, error: null }),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: visible(), error: null })),
        };
        return query;
      },
    } as unknown as SupabaseClient;
    const source = new SupabaseReportSnapshotSource(client, 'owner-1');

    const current = await source.getProjectAssessment(projectId);
    expect(current.summary).toMatchObject({ critical: 1, classified: 1 });
    expect(current.riskItems).toHaveLength(1);
    expect(current.traceability).toEqual(storedTraceability);

    finding.status = 'fixed';
    const afterDisposition = await source.getProjectAssessment(projectId);
    expect(afterDisposition.summary).toMatchObject({ critical: 0, classified: 0 });
    expect(afterDisposition.riskItems).toEqual([]);
    expect(afterDisposition.traceability).toEqual(storedTraceability);
  });

  it('loads every finding and every Review finding beyond one Supabase page', async () => {
    const projectId = 'project-1';
    const findings = Array.from({ length: 502 }, (_, index) => ({
      id: `finding-${String(index).padStart(4, '0')}`,
      project_id: projectId,
      review_session_id: index === 501 ? 'review-2' : 'review-1',
      source: 'static', severity: 'medium', priority: 'medium',
      title: `Finding ${index}`, status: index % 2 ? 'fixed' : 'new',
      created_at: '2026-09-23T00:00:00Z',
    }));
    const ranges: Array<[number, number]> = [];
    const client = {
      from: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        let selectedRange: [number, number] | null = null;
        const visible = () => {
          const rows = table === 'projects' ? [{ id: projectId }] : table === 'findings' ? findings : [];
          const filtered = rows.filter(row => filters.every(([field, value]) => (row as Record<string, unknown>)[field] === value));
          return selectedRange ? filtered.slice(selectedRange[0], selectedRange[1] + 1) : filtered;
        };
        const query = {
          select: () => query,
          eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
          order: () => query,
          range: (start: number, end: number) => { selectedRange = [start, end]; ranges.push([start, end]); return query; },
          maybeSingle: async () => ({ data: visible()[0] ?? null, error: null }),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: visible(), error: null })),
        };
        return query;
      },
    } as unknown as SupabaseClient;
    const source = new SupabaseReportSnapshotSource(client, 'owner-1');

    const inventory = await source.listAllFindings(projectId);
    expect(inventory).toHaveLength(502);
    expect(inventory.at(-1)).toMatchObject({ id: 'finding-0501', status: 'fixed' });
    const review = await source.listStaticFindings(projectId, 'review-1');
    expect(review).toHaveLength(501);
    expect(review.some(item => item.id === 'finding-0501')).toBe(false);
    expect(ranges).toEqual([[0, 499], [500, 999], [502, 1001], [0, 499], [500, 999], [501, 1000]]);
  });

  it('does not truncate artifacts, requirements, mappings, standards, or usage under a lower server row cap', async () => {
    const projectId = 'project-1';
    const count = 503;
    const rows: Record<string, Array<Record<string, unknown>>> = {
      projects: [{ id: projectId }],
      artifacts: Array.from({ length: count }, (_, index) => ({
        id: `artifact-${index}`, project_id: projectId, name: `file-${index}.ts`, path: `src/file-${index}.ts`, kind: 'source_code', created_at: '2026-09-23T00:00:00Z',
      })),
      artifact_versions: Array.from({ length: count }, (_, index) => ({
        id: `version-${index}`, project_id: projectId, artifact_id: `artifact-${index}`, version_number: 1, content_hash: `hash-${index}`,
      })),
      requirements: Array.from({ length: count }, (_, index) => ({
        id: `requirement-${index}`, project_id: projectId, title: `Requirement ${index}`, created_at: '2026-09-23T00:00:00Z',
      })),
      requirement_mappings: Array.from({ length: count }, (_, index) => ({
        id: `mapping-${index}`, project_id: projectId, requirement_id: 'requirement-0', coverage_status: 'complete', confidence: 1,
      })),
      project_standards: Array.from({ length: count }, (_, index) => ({
        id: `standard-${index}`, project_id: projectId, code: `SEC-${index}`, title: `Standard ${index}`, version: '1', metadata: {},
      })),
      project_standard_rules: Array.from({ length: count }, (_, index) => ({
        id: `rule-${index}`, project_id: projectId, standard_id: `standard-${index}`, stable_key: `stable-${index}`, title: `Rule ${index}`,
      })),
      model_usage_records: Array.from({ length: count }, (_, index) => ({
        id: `usage-${index}`, project_id: projectId, review_session_id: 'review-1', provider: 'custom', model: 'model-1',
        input_tokens: 1, output_tokens: 2, metadata: { scope: 'text' }, created_at: '2026-09-23T00:00:00Z',
      })),
    };
    const client = {
      from: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        let selectedRange: [number, number] | null = null;
        const visible = () => {
          const filtered = (rows[table] ?? []).filter(row => filters.every(([field, value]) => row[field] === value));
          return selectedRange ? filtered.slice(selectedRange[0], selectedRange[1] + 1).slice(0, 120) : filtered;
        };
        const query = {
          select: () => query,
          eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
          order: () => query,
          range: (start: number, end: number) => { selectedRange = [start, end]; return query; },
          maybeSingle: async () => ({ data: visible()[0] ?? null, error: null }),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: visible(), error: null })),
        };
        return query;
      },
    } as unknown as SupabaseClient;
    const source = new SupabaseReportSnapshotSource(client, 'owner-1');

    expect(await source.listArtifacts(projectId)).toHaveLength(count);
    expect(await source.listRequirements(projectId)).toHaveLength(count);
    expect(await source.getRequirementMappings('requirement-0')).toHaveLength(count);
    const standards = await source.listStandards(projectId);
    expect(standards).toHaveLength(count);
    expect(standards[0].rules).toHaveLength(1);
    expect((await source.getTokenUsageSummary(projectId, 'review-1')).totals).toMatchObject({ calls: count, input: count, output: count * 2 });
  });
});
