import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseModelUsageSummary } from '../../src/modelUsageSummary.js';

describe('Supabase Model Provider usage summary', () => {
  it('keeps source preparation cost attributable outside a Review without arbitrary metadata', async () => {
    const rows = ['source_changed', 'PRIVATE_TRIGGER'].map((indexTrigger, index) => ({ id: `index-${index}`, project_id: 'project', review_session_id: null,
      stage: 'source_indexing', attempt: 1, provider: 'custom', model: 'voyage-4-lite', input_tokens: 5, output_tokens: 0,
      metadata: { scope: 'embedding', callKind: 'review', indexTrigger, indexFingerprint: index ? 'PRIVATE_HASH' : 'a'.repeat(64) } }));
    const query: any = { select: () => query, eq: () => query, order: () => query, range: () => query,
      then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }) };
    const result = await getSupabaseModelUsageSummary({ from: () => query } as unknown as SupabaseClient, 'owner', { projectId: 'project' });
    expect(result.recent[0]).toMatchObject({ sessionId: null, scope: 'embedding', stage: 'source_indexing', indexTrigger: 'source_changed', indexFingerprint: 'a'.repeat(64) });
    expect(result.recent[1]).toMatchObject({ indexTrigger: null, indexFingerprint: null });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  });
  it('exposes safe attempt outcomes and durations without arbitrary error text or metadata', async () => {
    const rows = [
      { id: 'failed', outcome: 'permanent_error', error_code: 'codex_turn_failed', duration_ms: 1200 },
      { id: 'capacity', outcome: 'permanent_error', error_code: 'quota_exhausted', duration_ms: 42 },
      { id: 'provider-paused', outcome: 'retryable_error', error_code: 'provider_unavailable', duration_ms: 15000 },
      { id: 'index-pause', outcome: 'retryable_error', error_code: 'provider_unavailable', duration_ms: 20 },
      { id: 'http', outcome: 'retryable_error', error_code: 'http_503', duration_ms: 11 },
      { id: 'unknown', outcome: 'PRIVATE_RESPONSE_BODY', error_code: 'PRIVATE_PROVIDER_SECRET', duration_ms: -1 },
      { id: 'legacy' },
    ].map(row => ({ project_id: 'project', review_session_id: null, attempt: 1,
      provider: 'codex', model: 'model', input_tokens: 0, output_tokens: 0,
      metadata: { errorMessage: 'PRIVATE_METADATA', ...(row.id === 'provider-paused' ? { callKind: 'review', scope: 'text' }
        : row.id === 'index-pause' ? { callKind: 'review', scope: 'embedding' } : {}) },
      ...row, stage: row.id === 'provider-paused' ? 'model_analysis' : row.id === 'index-pause' ? 'source_indexing' : 'project_readiness_assessment' }));
    const query: any = { select: () => query, eq: () => query, order: () => query, range: () => query,
      then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }) };
    const result = await getSupabaseModelUsageSummary({ from: () => query } as unknown as SupabaseClient, 'owner', { projectId: 'project' });
    expect(result.recent[0]).toMatchObject({ outcome: 'permanent_error', errorCode: 'codex_turn_failed', durationMs: 1200 });
    expect(result.recent[1]).toMatchObject({ errorCode: 'quota_exhausted' });
    expect(result.recent[2]).toMatchObject({ errorCode: 'provider_unavailable', durationMs: 15000 });
    expect(result.recent[3]).toMatchObject({ errorCode: null, durationMs: 20 });
    expect(result.recent[4]).toMatchObject({ errorCode: 'http_503' });
    expect(result.recent[5]).toMatchObject({ outcome: null, errorCode: null, durationMs: null });
    expect(result.recent[6]).toMatchObject({ outcome: null, errorCode: null, durationMs: null });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  });

  it('filters Dynamic session metadata without using Review foreign keys', async () => {
    const filters: unknown[][] = [];
    const query: any = { select: () => query, eq: (...args: unknown[]) => { filters.push(args); return query; }, order: () => query,
      range: () => query, then: (resolve: (value: unknown) => void) => resolve({ data: [{ id: 'usage-1', project_id: 'project-1', review_session_id: null, stage: 'step_0', attempt: 1, provider: 'codex', model: 'account-model', input_tokens: 10, output_tokens: 2, metadata: { callKind: 'dynamic', scope: 'vision', apiFormat: 'codex-app-server', dynamicSessionId: 'dynamic-1' } }], error: null }),
    };
    const result = await getSupabaseModelUsageSummary({ from: () => query } as unknown as SupabaseClient, 'verified-user', { sessionId: 'dynamic-1', callKind: 'dynamic' });
    expect(filters).toContainEqual(['owner_id', 'verified-user']);
    expect(filters).toContainEqual(['metadata->>dynamicSessionId', 'dynamic-1']);
    expect(result.recent[0]).toMatchObject({ provider: 'codex', scope: 'vision', sessionId: 'dynamic-1', inputTokens: 10 });
  });

  it('aggregates all pages and filters review versus provider-test calls', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      id: String(index), project_id: index === 500 ? null : 'project-1',
      review_session_id: index === 500 ? null : 'review-1',
      stage: index === 500 ? 'provider-test' : 'static-analysis', attempt: 1,
      provider: 'custom', model: 'text-model', input_tokens: 2, output_tokens: 3,
      cache_read_tokens: 0, cache_creation_tokens: 0,
      metadata: { apiFormat: 'openai-compatible', callKind: index === 500 ? 'test' : 'review', scope: 'text' },
      created_at: '2026-09-23T00:00:00Z',
    }));
    const orderedFields: string[] = [];
    const client = {
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          order: (field: string) => { orderedFields.push(field); return query; },
          range: (start: number, end: number) => Promise.resolve({ data: start === 0
            ? rows.slice(start, end + 1) : [rows[499], rows[500]], error: null }),
        };
        return query;
      },
    } as unknown as SupabaseClient;

    const all = await getSupabaseModelUsageSummary(client, 'user-1');
    expect(orderedFields.slice(0, 2)).toEqual(['created_at', 'id']);
    expect(all.totals).toMatchObject({ input: 1002, output: 1503, cacheRead: 0, cacheCreation: 0, calls: 501,
      totalTokens: 2505, providerReportedTotalTokens: 0, providerReportedCalls: 0, unknownTotalCalls: 0 });
    expect(all.recent).toHaveLength(50);
    const tests = await getSupabaseModelUsageSummary(client, 'user-1', { callKind: 'test' });
    expect(tests.totals.calls).toBe(1);
    expect(tests.recent[0].sessionId).toBeNull();
  });

  it('keeps cache breakdown counts while using provider-aware, non-double-counted totals', async () => {
    const rows = [
      { id: 'codex', provider: 'codex', model: 'codex-model', stage: 'model_analysis', attempt: 1,
        input_tokens: 5, output_tokens: 2, cache_read_tokens: 3, cache_creation_tokens: 0,
        metadata: { callKind: 'review', scope: 'text', apiFormat: 'codex-app-server', providerReportedTotalTokens: 7 } },
      { id: 'anthropic', provider: 'mimo', model: 'mimo-model', stage: 'model_analysis', attempt: 1,
        input_tokens: 5, output_tokens: 2, cache_read_tokens: 3, cache_creation_tokens: 1,
        metadata: { callKind: 'review', scope: 'text', apiFormat: 'anthropic-compatible', providerReportedTotalTokens: 11 } },
      { id: 'legacy-anthropic', provider: 'mimo', model: 'mimo-model', stage: 'model_analysis', attempt: 1,
        input_tokens: 5, output_tokens: 2, cache_read_tokens: null, cache_creation_tokens: null,
        metadata: { callKind: 'review', scope: 'text', apiFormat: 'anthropic-compatible' } },
    ].map(row => ({ project_id: 'project', review_session_id: 'review', owner_id: 'owner', outcome: 'success', created_at: '2026-10-25T00:00:00Z', ...row }));
    const query: any = { select: () => query, eq: () => query, order: () => query, range: () => query,
      then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }) };
    const result = await getSupabaseModelUsageSummary({ from: () => query } as unknown as SupabaseClient, 'owner');

    expect(result.totals).toMatchObject({ input: 15, output: 6, cacheRead: 6, cacheCreation: 1,
      totalTokens: 18, providerReportedTotalTokens: 18, providerReportedCalls: 2, unknownTotalCalls: 1 });
    expect(result.byGroup.find(group => group.provider === 'codex')).toMatchObject({ totalTokens: 7, totalCacheRead: 3 });
    expect(result.byGroup.find(group => group.provider === 'mimo')).toMatchObject({ totalTokens: 11, unknownTotalCalls: 1 });
    expect(result.recent.find(row => row.id === 'legacy-anthropic')).toMatchObject({ canonicalTotalTokens: null, totalTokensStatus: 'unavailable' });
  });

  it('keeps assumed no-response zero separate from unknown and partial actual usage', async () => {
    const rows = [
      { id: 'no-response', outcome: 'retryable_error', responseReceived: false,
        usageAccounting: { basis: 'assumed_zero_no_response', accountedTokens: 0 } },
      { id: 'http-empty', outcome: 'permanent_error', responseReceived: true },
      { id: 'partial', outcome: 'retryable_error', responseReceived: false,
        usageAccounting: { basis: 'assumed_zero_no_response', accountedTokens: 0 },
        usageObservation: { source: 'codex_turn_last', completeness: 'partial', missingCounters: ['outputTokens'] } },
      { id: 'reservation', outcome: 'in_progress', responseReceived: false,
        usageAccounting: { basis: 'assumed_zero_no_response', accountedTokens: 0 } },
      { id: 'contradictory-success', outcome: 'success', responseReceived: false,
        usageAccounting: { basis: 'assumed_zero_no_response', accountedTokens: 0 } },
    ].map(({ id, outcome, ...diagnostics }) => ({ id, project_id: 'project', review_session_id: 'review', stage: 'model_analysis', attempt: 1,
      provider: 'custom', model: 'fixture', input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null,
      outcome, metadata: { apiFormat: 'openai-compatible', callKind: 'review', scope: 'text', ...diagnostics }, created_at: '2026-10-27T00:00:00Z' }));
    const query: any = { select: () => query, eq: () => query, order: () => query, range: () => query,
      then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }) };
    const result = await getSupabaseModelUsageSummary({ from: () => query } as unknown as SupabaseClient, 'owner');

    expect(result.totals).toMatchObject({ calls: 5, unknownTotalCalls: 5, unknownInputCalls: 5,
      assumedZeroNoResponseCalls: 1, assumedZeroNoResponseTokens: 0, accountedTokens: 0 });
    expect(result.recent.find(row => row.id === 'no-response')).toMatchObject({
      responseReceived: false, accountingBasis: 'assumed_zero_no_response', accountedTokens: 0, canonicalTotalTokens: null, totalTokens: null,
    });
    expect(result.recent.find(row => row.id === 'http-empty')).toMatchObject({
      responseReceived: true, accountingBasis: null, canonicalTotalTokens: null, totalTokens: null,
    });
    expect(result.recent.find(row => row.id === 'partial')).toMatchObject({
      accountingBasis: null, usageObservation: { completeness: 'partial', missingCounters: ['outputTokens'] },
    });
    expect(result.recent.find(row => row.id === 'reservation')).toMatchObject({ outcome: 'in_progress', accountingBasis: null });
    expect(result.recent.find(row => row.id === 'contradictory-success')).toMatchObject({ outcome: 'success', accountingBasis: null });
  });

  it.each([
    ['failed', 'failed', 'permanent_error'],
    ['cancelled', 'cancelled', 'cancelled'],
  ] as const)('marks observed model work stopped when review is %s', async (status, terminalStage, outcome) => {
    const usageRows = [{ id: 'attempt', owner_id: 'owner', project_id: 'project', review_session_id: 'review',
      stage: 'model_analysis:batch-a', attempt: 1, provider: 'custom', model: 'model', outcome,
      input_tokens: 10, output_tokens: 2, cache_read_tokens: null, cache_creation_tokens: null,
      metadata: { apiFormat: 'openai-compatible', callKind: 'review', scope: 'text',
        usageContext: { phase: 'initial_analysis', sources: [] } }, created_at: '2026-10-25T00:00:00Z' }];
    const client = {
      from: (table: string) => {
        const query: any = {
          select: () => query, eq: () => query, in: () => query, order: () => query, range: () => query,
          maybeSingle: async () => table === 'review_sessions'
            ? { data: { status, progress: { stage: terminalStage, completedStages: ['freezing_sources'] } }, error: null }
            : table === 'review_source_snapshots' ? { data: { snapshot: { artifacts: [] } }, error: null }
              : { data: null, error: null },
          then: (resolve: (value: unknown) => void) => resolve({ data: table === 'model_usage_records' ? usageRows : [], error: null }),
        };
        return query;
      },
    } as unknown as SupabaseClient;
    const result = await getSupabaseModelUsageSummary(client, 'owner', {
      projectId: 'project', sessionId: 'review', callKind: 'review',
    });

    expect(result.reviewUsage?.byStage.find(stage => stage.stage === 'model_analysis')).toMatchObject({
      state: 'stopped', calls: 1,
    });
    expect(result.reviewUsage?.byStage.find(stage => stage.stage === 'indexing_context')?.state).toBe('not_reached');
  });

  it('marks the observed indexing stage stopped on a provider pause without stopping model analysis', async () => {
    const usageRows = [{ id: 'embedding-attempt', owner_id: 'owner', project_id: 'project', review_session_id: 'review',
      stage: 'source_indexing', attempt: 1, provider: 'custom', model: 'embedding-model', outcome: 'permanent_error',
      input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null,
      metadata: { apiFormat: 'openai-compatible', callKind: 'review', scope: 'embedding', errorCode: 'quota_exhausted',
        usageContext: { phase: 'source_indexing', sources: [] } }, created_at: '2026-10-25T00:00:00Z' }];
    const client = {
      from: (table: string) => {
        const query: any = {
          select: () => query, eq: () => query, in: () => query, order: () => query, range: () => query,
          maybeSingle: async () => table === 'review_sessions'
            ? { data: { status: 'blocked', progress: { stage: 'provider_paused', pauseCode: 'quota_exhausted', completedStages: ['freezing_sources'] } }, error: null }
            : table === 'review_source_snapshots' ? { data: { snapshot: { artifacts: [] } }, error: null }
              : { data: null, error: null },
          then: (resolve: (value: unknown) => void) => resolve({ data: table === 'model_usage_records' ? usageRows : [], error: null }),
        };
        return query;
      },
    } as unknown as SupabaseClient;
    const result = await getSupabaseModelUsageSummary(client, 'owner', {
      projectId: 'project', sessionId: 'review', callKind: 'review',
    });

    expect(result.reviewUsage?.byStage.find(stage => stage.stage === 'indexing_context')).toMatchObject({
      state: 'stopped', calls: 1,
    });
    expect(result.reviewUsage?.byStage.find(stage => stage.stage === 'model_analysis')?.state).toBe('not_reached');
  });

  it.each([false, true])('returns scoped stage/physical inventory for reused snapshot=%s without exposing source bodies', async (reused) => {
    const usageRows = [
      { id: 'attempt-1', project_id: 'project-1', review_session_id: 'review-1', owner_id: 'owner-1',
        stage: 'model_analysis:batch-a', attempt: 1, provider: 'codex', model: 'codex-model', outcome: 'success',
        input_tokens: 500, output_tokens: 50, cache_read_tokens: 300, cache_creation_tokens: 0, duration_ms: 10,
        error_code: null, created_at: '2026-10-25T00:00:00Z', metadata: {
          apiFormat: 'codex-app-server', callKind: 'review', scope: 'text', providerReportedTotalTokens: 550,
          prompt: 'PRIVATE_PROMPT', sourceBody: 'PRIVATE_SOURCE_BODY',
          usageContext: { phase: 'initial_analysis', sources: [{ artifactId: 'artifact-1', artifactVersionId: 'version-1',
            contentHash: 'hash-1', filePath: 'src/auth.ts', lineStart: 1, lineEnd: 9, sourceBody: 'PRIVATE_PACKET' }] },
        } },
      { id: 'attempt-2', project_id: 'project-1', review_session_id: 'review-1', owner_id: 'owner-1',
        stage: 'model_analysis:batch-b', attempt: 1, provider: 'codex', model: 'codex-model', outcome: 'success',
        input_tokens: 100, output_tokens: 10, cache_read_tokens: 50, cache_creation_tokens: 0, duration_ms: 10,
        error_code: null, created_at: '2026-10-25T00:00:02Z', metadata: {
          apiFormat: 'codex-app-server', callKind: 'review', scope: 'text', providerReportedTotalTokens: 110,
          usageContext: { phase: 'semantic_support', sources: [{ artifactId: 'foreign-artifact', artifactVersionId: 'version-foreign',
            contentHash: 'foreign-hash', filePath: 'src/foreign-secret.ts', lineStart: 1, lineEnd: 2, sourceBody: 'PRIVATE_FOREIGN_SOURCE' }] },
        } },
      { id: 'embedding-attempt', project_id: 'project-1', review_session_id: 'review-1', owner_id: 'owner-1',
        stage: 'source_indexing', attempt: 1, provider: 'custom', model: 'embedding-model', outcome: 'success',
        input_tokens: 100, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, duration_ms: 5,
        error_code: null, created_at: '2026-10-25T00:00:03Z', metadata: {
          apiFormat: 'openai-compatible', callKind: 'review', scope: 'embedding', providerReportedTotalTokens: 100,
          usageContext: { phase: 'source_indexing', sources: [{ artifactId: 'artifact-1', artifactVersionId: 'version-1',
            contentHash: 'hash-1', filePath: 'src/auth.ts', lineStart: null, lineEnd: null }] },
        } },
      { id: 'foreign-attempt', project_id: 'project-1', review_session_id: 'review-foreign', owner_id: 'owner-1',
        stage: 'model_analysis:batch-a', attempt: 1, provider: 'codex', model: 'codex-model', outcome: 'success',
        input_tokens: 999, output_tokens: 999, cache_read_tokens: 0, cache_creation_tokens: 0,
        metadata: { apiFormat: 'codex-app-server', callKind: 'review', scope: 'text' } },
    ];
    const auditRows = [
      { id: 'read-start', project_id: 'project-1', entity_type: 'review', entity_id: 'review-1', event_type: 'harness_step_started', created_at: '2026-10-25T00:00:00Z', payload: {
        stage: 'freezing_sources', detail: { executionId: 'read-1', step: 'read_source', input: { artifactId: 'artifact-1', fileName: 'auth.ts' } },
      } },
      { id: 'read-complete', project_id: 'project-1', entity_type: 'review', entity_id: 'review-1', event_type: 'harness_step_completed', created_at: '2026-10-25T00:00:01Z', payload: {
        stage: 'freezing_sources', detail: { executionId: 'read-1', step: 'read_source', output: { characters: 300, lines: 9, hashChecked: true } },
      } },
    ];
    const filters = new Map<string, unknown[][]>();
    const tables: Record<string, unknown[]> = {
      model_usage_records: usageRows,
      audit_events: auditRows,
    };
    const client = {
      from: (table: string) => {
        const applied = filters.get(table) ?? [];
        filters.set(table, applied);
        let range: [number, number] = [0, 499];
        const query: any = {
          select: () => query,
          eq: (field: string, value: unknown) => { applied.push([field, value]); return query; },
          in: (field: string, values: unknown[]) => { applied.push([field, values]); return query; },
          order: () => query,
          range: (start: number, end: number) => { range = [start, end]; return query; },
          maybeSingle: async () => {
            if (table === 'review_sessions') return { data: { status: 'pending_approval', ...(reused ? { source_manifest_id: 'parent-owned-snapshot' } : {}), progress: { stage: 'complete', completedStages: WORKFLOW_STAGES_FOR_TEST } }, error: null };
            if (table === 'review_source_snapshots') return { data: { snapshot: { artifacts: [{ id: 'artifact-1', version_id: 'version-1', path: 'src/auth.ts', name: 'auth.ts', metadata: { originalPath: 'C:/private/src/auth.ts', contentHash: 'hash-1' }, content: 'PRIVATE_MANIFEST_BODY' }] } }, error: null };
            return { data: null, error: null };
          },
          then: (resolve: (value: unknown) => void) => {
            const matches = (tables[table] ?? []).filter(row => applied.every(([field, value]) => {
              const raw = row as Record<string, unknown>;
              if (Array.isArray(value)) return value.includes(raw[field]);
              return raw[field] === value;
            }));
            resolve({ data: matches.slice(range[0], range[1] + 1), error: null });
          },
        };
        return query;
      },
    } as unknown as SupabaseClient;
    const result = await getSupabaseModelUsageSummary(client, 'owner-1', { projectId: 'project-1', sessionId: 'review-1', callKind: 'review', scope: 'text' });

    expect(result.totals.calls).toBe(2);
    expect(result.reviewUsage?.byStage.find(stage => stage.stage === 'model_analysis')).toMatchObject({
      calls: 2, inputTokens: 600, outputTokens: 60, cacheReadTokens: 350, providerReportedTotalTokens: 660, aiFileCount: null,
    });
    expect(result.reviewUsage?.sourceInventory).toMatchObject({ status: 'partial', totalUniqueFiles: null, knownUniqueFiles: 1, aiFileAppearances: null,
      unknownAiFileAttempts: 1,
      physical: { status: 'available', readAttempts: 1, uniqueFiles: 1 } });
    expect(result.reviewUsage?.sourceInventory.files.map(file => file.artifactId)).toEqual(['artifact-1']);
    expect(result.reviewUsage?.byStage.find(stage => stage.stage === 'indexing_context')).toMatchObject({
      calls: 1, operations: ['source_indexing'], inputTokens: 100, phases: [{ phase: 'source_indexing', calls: 1 }], aiFileCount: 1,
    });
    expect(result.reviewUsage?.sourceInventory).toMatchObject({ totalUniqueFiles: null, knownUniqueFiles: 1, aiFileAppearances: null });
    expect(result.reviewUsage?.sourceInventory.physical.byStage[0].files[0]).toMatchObject({
      artifactId: 'artifact-1', artifactVersionId: 'version-1', filePath: 'src/auth.ts', successfulReads: 1, characters: 300,
    });
    expect(filters.get('model_usage_records')).toContainEqual(['owner_id', 'owner-1']);
    expect(filters.get('model_usage_records')).toContainEqual(['project_id', 'project-1']);
    expect(filters.get('model_usage_records')).toContainEqual(['review_session_id', 'review-1']);
    expect(filters.get('audit_events')).toContainEqual(['project_id', 'project-1']);
    expect(filters.get('audit_events')).toContainEqual(['entity_id', 'review-1']);
    if (reused) {
      expect(filters.get('review_source_snapshots')).toContainEqual(['id', 'parent-owned-snapshot']);
      expect(filters.get('review_source_snapshots')).not.toContainEqual(['review_session_id', 'review-1']);
    } else expect(filters.get('review_source_snapshots')).toContainEqual(['review_session_id', 'review-1']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(JSON.stringify(result)).not.toContain('foreign-artifact');
  });
});

const WORKFLOW_STAGES_FOR_TEST = ['freezing_sources', 'indexing_context', 'deterministic_analysis', 'model_analysis', 'persisting_evidence'];
