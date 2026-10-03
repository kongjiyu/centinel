import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildProjectReportSnapshot } from '../../src/report/snapshot.js';
import { createSupabaseReportSnapshotSource } from '../../src/report/supabaseSnapshot.js';
import { CentinelApplicationRepository } from '../../src/applicationRepository.js';

type AnyRow = Record<string, unknown>;

function fakeClient(initial: Record<string, AnyRow[]> = {}) {
  const tables: Record<string, AnyRow[]> = Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, value.map(item => ({ ...item }))]));
  const uploads: string[] = [];
  const removed: string[] = [];
  const storageRemovals: Array<{ bucket: string; paths: string[] }> = [];
  const storageObjects = new Set<string>((initial.artifact_versions ?? [])
    .map(item => item.storage_path).filter((value): value is string => typeof value === 'string')
    .map(path => `project-artifacts:${path}`));
  let storageRemoveFailure = false;
  let deletionCommitFailure = false;
  const signed = vi.fn(async (objectPath: string) => ({ data: { signedUrl: `https://signed.test/${objectPath}` }, error: null }));
  const download = vi.fn(async () => ({ data: new Blob([Buffer.from('artifact')]), error: null }));

  function builder(name: string, operation: 'read' | 'insert' | 'upsert' | 'update' | 'delete' = 'read') {
    let mode = operation;
    const filters: Array<[string, unknown]> = [];
    let orderKey: string | null = null;
    let ascending = true;
    let limitValue: number | null = null;
    let rangeValue: [number, number] | null = null;
    let payload: AnyRow | null = null;
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn((key: string, value: unknown) => { filters.push([key, value]); return chain; }),
      neq: vi.fn((key: string, value: unknown) => { filters.push([`!${key}`, value]); return chain; }),
      order: vi.fn((key: string, options?: { ascending?: boolean }) => { orderKey = key; ascending = options?.ascending ?? true; return chain; }),
      limit: vi.fn((value: number) => { limitValue = value; return chain; }),
      range: vi.fn((start: number, end: number) => { rangeValue = [start, end]; return chain; }),
      abortSignal: vi.fn(() => chain),
      insert: vi.fn((value: AnyRow) => { payload = value; mode = 'insert'; return chain; }),
      upsert: vi.fn((value: AnyRow) => { payload = value; mode = 'upsert'; return chain; }),
      update: vi.fn((value: AnyRow) => { payload = value; mode = 'update'; return chain; }),
      delete: vi.fn(() => { mode = 'delete'; return chain; }),
      maybeSingle: vi.fn(async () => {
        const rows = await execute();
        return { data: rows[0] ?? null, error: null };
      }),
      single: vi.fn(async () => {
        const rows = await execute();
        return { data: rows[0] ?? payload ?? null, error: null };
      }),
      then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => execute().then(rows => resolve({ data: rows, error: null }), reject),
    };
    async function execute(): Promise<AnyRow[]> {
      if (mode === 'delete') {
        const rows = tables[name] ?? [];
        const deleted = rows.filter(item => filters.every(([key, value]) => key.startsWith('!') ? item[key.slice(1)] !== value : item[key] === value));
        tables[name] = rows.filter(item => !deleted.includes(item));
        return deleted;
      }
      if (mode === 'update') {
        const rows = (tables[name] ?? []).filter(item => filters.every(([key, value]) => key.startsWith('!') ? item[key.slice(1)] !== value : item[key] === value));
        rows.forEach(item => Object.assign(item, payload ?? {}));
        return rows;
      }
      if (mode === 'insert' || mode === 'upsert') {
        const value = { ...(payload ?? {}), id: (payload?.id as string | undefined) ?? `${name}-generated`, created_at: payload?.created_at ?? '2026-09-22T00:00:00.000Z' };
        tables[name] ??= [];
        tables[name].push(value);
        return [value];
      }
      let rows = [...(tables[name] ?? [])].filter(item => filters.every(([key, value]) => key.startsWith('!') ? item[key.slice(1)] !== value : item[key] === value));
      if (orderKey) rows.sort((a, b) => String(a[orderKey!] ?? '').localeCompare(String(b[orderKey!] ?? '')) * (ascending ? 1 : -1));
      const limited = limitValue == null ? rows : rows.slice(0, limitValue);
      return rangeValue ? limited.slice(rangeValue[0], rangeValue[1] + 1) : limited;
    }
    return chain;
  }

  const client = {
    from: vi.fn((name: string) => builder(name)),
    rpc: vi.fn(async (name: string, args: { p_scope: string; p_target_id: string; p_project_id?: string }) => {
      const { p_scope: scope, p_target_id: targetId } = args;
      if (name === 'queue_storage_deletion') {
        if (deletionCommitFailure) return { data: null, error: { message: 'commit failed' } };
        const targetTable = scope === 'project' ? 'projects' : 'artifacts';
        const target = tables[targetTable]?.find(item => item.id === targetId);
        if (!target) return { data: false, error: null };
        const projectId = scope === 'project' ? targetId : String(target.project_id);
        if (args.p_project_id !== projectId) return { data: null, error: { message: 'Deletion target is outside the requested project' } };
        tables.storage_deletion_jobs ??= [];
        tables.storage_deletion_objects ??= [];
        tables.storage_deletion_jobs.push({ scope, target_id: targetId, project_id: projectId, owner_id: 'user-1', created_at: '2026-09-25' });
        for (const object of storageObjects) {
          const [bucket, path] = object.split(':', 2);
          if (!path.startsWith(`${projectId}/`)) continue;
          if (scope === 'artifact' && (bucket !== 'project-artifacts' || !path.startsWith(`${projectId}/${targetId}/`))) continue;
          tables.storage_deletion_objects.push({ scope, target_id: targetId, bucket_id: bucket, path });
        }
        tables[targetTable] = tables[targetTable].filter(item => item !== target);
        return { data: true, error: null };
      }
      if (name === 'complete_storage_deletion') {
        const objects = tables.storage_deletion_objects?.filter(item => item.scope === scope && item.target_id === targetId) ?? [];
        if (objects.some(item => storageObjects.has(`${item.bucket_id}:${item.path}`))) return { data: false, error: null };
        tables.storage_deletion_jobs = (tables.storage_deletion_jobs ?? []).filter(item => item.scope !== scope || item.target_id !== targetId);
        tables.storage_deletion_objects = (tables.storage_deletion_objects ?? []).filter(item => item.scope !== scope || item.target_id !== targetId);
        return { data: true, error: null };
      }
      return { data: null, error: { message: 'Unknown RPC' } };
    }),
      storage: {
      from: vi.fn((bucket: string) => ({
        upload: vi.fn(async (objectPath: string) => { uploads.push(objectPath); return { data: { path: objectPath }, error: null }; }),
        remove: vi.fn(async (paths: string[]) => {
          if (storageRemoveFailure) return { data: null, error: { message: 'temporarily unavailable' } };
          removed.push(...paths);
          storageRemovals.push({ bucket, paths });
          paths.forEach(path => storageObjects.delete(`${bucket}:${path}`));
          return { data: null, error: null };
        }),
        list: vi.fn(async () => ({ data: [], error: null })),
        createSignedUrl: signed,
        download,
      })),
    },
  } as unknown as SupabaseClient;
  return { client, tables, uploads, removed, storageRemovals, storageObjects, signed, download,
    setStorageRemoveFailure: (value: boolean) => { storageRemoveFailure = value; },
    setDeletionCommitFailure: (value: boolean) => { deletionCommitFailure = value; } };
}

describe('Phase 3A Supabase authority seams', () => {
  it('builds a report from an authenticated Supabase snapshot source, including version hashes, rules, and correlations', async () => {
    const fake = fakeClient({
      projects: [{ id: 'project-1', name: 'Supabase project', description: 'Authoritative', workspace_path: 'C:/workspace', created_at: '2026-09-20', updated_at: '2026-09-22' }],
      review_sessions: [{ id: 'review-1', project_id: 'project-1', name: 'Review', review_type: 'code_review', status: 'success', config: {}, progress: {}, final_summary: 'Done', failure_reason: '', created_at: '2026-09-21', updated_at: '2026-09-22' }],
      artifacts: [{ id: 'artifact-1', project_id: 'project-1', path: 'standards.md', name: 'standards.md', kind: 'coding_standard', source: 'documents', created_at: '2026-09-20' }],
      artifact_versions: [{ id: 'version-1', project_id: 'project-1', artifact_id: 'artifact-1', version_number: 1, content_hash: 'version-hash', storage_path: 'project-1/artifact-1/version-hash', created_at: '2026-09-20' }],
      requirements: [{ id: 'requirement-1', project_id: 'project-1', title: 'Must be safe', description: 'Safety requirement', category: 'security', priority: 'high', created_at: '2026-09-20' }],
      requirement_mappings: [{ id: 'mapping-1', project_id: 'project-1', requirement_id: 'requirement-1', artifact_id: 'artifact-1', coverage_status: 'complete', confidence: 0.9, created_at: '2026-09-20' }],
      project_standards: [{ id: 'standard-1', project_id: 'project-1', code: 'SEC-1', title: 'Security standard', source: 'manual', version: '1', metadata: {}, created_at: '2026-09-20' }],
      project_standard_rules: [{ id: 'rule-1', project_id: 'project-1', standard_id: 'standard-1', stable_key: 'no-secrets', title: 'No secrets', statement: 'Never commit secrets.', category: 'security', severity: 'critical', recommendation: 'Use a vault.', source_artifact_id: 'artifact-1', source_locator: {}, source_version: 'version-hash', standard_version: '1', enabled: true, created_at: '2026-09-20' }],
      findings: [{ id: 'finding-1', project_id: 'project-1', review_session_id: 'review-1', source: 'static', severity: 'high', priority: 'high', title: 'Secret', description: 'Secret found', status: 'new', category: 'security', evidence_text: 'token', recommendation: 'Remove it', confidence: 'high', location: { filePath: 'src/auth.ts', lineNumber: 4 }, created_at: '2026-09-21' }],
      review_source_snapshots: [{ project_id: 'project-1', review_session_id: 'review-1', status: 'available', snapshot: { artifactCount: 1, sources: [] }, created_at: '2026-09-22' }],
      review_traceability_snapshots: [{ project_id: 'project-1', review_session_id: 'review-1', status: 'available', records: [], summary: { complete: 1, incomplete: 0, missing: 0, attention: 0 }, created_at: '2026-09-22' }],
      review_decisions: [{ id: 'decision-1', project_id: 'project-1', review_session_id: 'review-1', decision: 'approved', comment: 'Approved', reviewer: 'reviewer', created_at: '2026-09-22' }],
      review_decision_attachments: [],
      review_finding_correlations: [{ id: 'correlation-1', project_id: 'project-1', parent_review_id: 'review-0', child_review_id: 'review-1', parent_finding_id: 'finding-0', child_finding_id: 'finding-1', classification: 'recurring', method: 'fingerprint', score: 0.97, stable_fingerprint: 'fp', detail: {}, created_at: '2026-09-22' }],
      model_usage_records: [{ id: 'usage-1', project_id: 'project-1', review_session_id: 'review-1', stage: 'review', attempt: 1, provider: 'mimo', model: 'mimo', outcome: 'success', input_tokens: 2, output_tokens: 3, created_at: '2026-09-22', metadata: { api_format: 'openai-compatible' } }],
      dynamic_sessions: [{ id: 'dynamic-1', project_id: 'project-1', name: 'Dynamic', status: 'success', target_url: 'https://example.test', goal: 'Check', mission_type: 'smoke', browser_mode: 'headed', max_steps: 4, final_summary: 'Summary only', failure_reason: '', created_at: '2026-09-21', updated_at: '2026-09-22' }],
      dynamic_evidence: [
        { id: 'evidence-1', project_id: 'project-1', dynamic_session_id: 'dynamic-1', type: 'screenshot', summary: 'Login screenshot', storage_path: 'project-1/dynamic-1/login.png', created_at: '2026-09-22' },
        { id: 'evidence-2', project_id: 'project-1', dynamic_session_id: 'dynamic-1', type: 'ai_response', summary: 'Hidden model response', storage_path: 'project-1/dynamic-1/private.json', created_at: '2026-09-22' },
      ],
      dynamic_actions: [{ id: 'action-1', project_id: 'project-1', dynamic_session_id: 'dynamic-1', step: 1, action: 'navigate', target: 'https://example.test/login?token=private-token', result: 'Opened login', reasoning: 'PRIVATE_REASONING' }],
      project_assessments: [],
    });
    const source = createSupabaseReportSnapshotSource(fake.client, 'user-1');
    const snapshot = await buildProjectReportSnapshot('project-1', { source, reportId: 'report-1', generatedAt: '2026-09-22' });
    expect(snapshot.sourceInventory.artifacts[0].contentHash).toBe('version-hash');
    expect(snapshot.standards.items[0].structuredRulesStatus).toBe('available');
    expect(snapshot.standards.items[0].rules?.[0].stableKey).toBe('no-secrets');
    expect(snapshot.latestReview?.findingClassificationStatus).toBe('available');
    expect(snapshot.latestReview?.recurringFindings).toHaveLength(1);
    expect(snapshot.latestDynamicTest?.summary).toBe('Summary only');
    expect(snapshot.latestDynamicTest?.evidence).toMatchObject([{ id: 'evidence-1', type: 'screenshot', path: 'project-1/dynamic-1/login.png' }]);
    expect(snapshot.latestDynamicTest?.actionTrace).toMatchObject([{ step: 1, action: 'navigate', target: 'https://example.test/login?token=[redacted]', result: 'Opened login' }]);
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_REASONING');
    expect(JSON.stringify(snapshot)).not.toContain('private-token');
  });

  it('lists report history and renews links through the repository RLS client', async () => {
    const fake = fakeClient({
      projects: [{ id: 'project-1' }],
      report_exports: [{ id: 'report-1', project_id: 'project-1', actor_id: 'user-1', policy_version: 'risk', generator_version: 'v1', snapshot: { metadata: { outputFiles: { json: 'snapshot.json', markdown: 'report.md', pdf: 'report.pdf' } } }, json_storage_path: 'project-1/report-1/snapshot.json', markdown_storage_path: 'project-1/report-1/report.md', pdf_storage_path: 'project-1/report-1/report.pdf', created_at: '2026-09-22' }],
    });
    const repository = new CentinelApplicationRepository({ client: fake.client, userId: 'user-1' });
    const history = await repository.listProjectReportHistory('project-1');
    expect(history[0].id).toBe('report-1');
    expect((await repository.getProjectReportHistoryEntry('project-1', 'report-1'))?.id).toBe('report-1');
    const links = await repository.renewProjectReportLinks('project-1', 'report-1');
    expect(links.downloads.pdf).toContain('project-1/report-1/report.pdf');
    expect(fake.signed).toHaveBeenCalledTimes(3);
  });

  it('uploads artifact bytes privately and commits only the verified hash/version', async () => {
    const fake = fakeClient({ projects: [{ id: 'project-1' }], artifacts: [{ id: 'artifact-1', project_id: 'project-1' }], artifact_versions: [] });
    const repository = new CentinelApplicationRepository({ client: fake.client, userId: 'user-1' });
    const version = await repository.uploadArtifactVersion({ projectId: 'project-1', artifactId: 'artifact-1', content: Buffer.from('artifact'), contentType: 'text/plain' });
    expect(fake.uploads).toEqual(['project-1/artifact-1/c7c5c1d70c5dec4416ab6158afd0b223ef40c29b1dc1f97ed9428b94d4cadb1c']);
    expect(version.storagePath).toBe(fake.uploads[0]);
    expect(version.contentHash).toHaveLength(64);
    expect((await repository.getArtifactVersion('project-1', version.id))?.contentHash).toBe(version.contentHash);
  });

  it('forwards Review cancellation into the private Storage download', async () => {
    const contentHash = 'c7c5c1d70c5dec4416ab6158afd0b223ef40c29b1dc1f97ed9428b94d4cadb1c';
    const fake = fakeClient({
      projects: [{ id: 'project-1' }],
      artifact_versions: [{ id: 'version-1', project_id: 'project-1', artifact_id: 'artifact-1', content_hash: contentHash, storage_path: `project-1/artifact-1/${contentHash}` }],
    });
    let downloadStarted!: () => void;
    const started = new Promise<void>(resolve => { downloadStarted = resolve; });
    fake.download.mockImplementationOnce((_path: unknown, _options: unknown, options: { signal: AbortSignal }) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')), { once: true });
      downloadStarted();
    }) as never);
    const controller = new AbortController();
    const repository = new CentinelApplicationRepository({ client: fake.client, userId: 'user-1' });
    const pending = repository.downloadArtifactVersion('project-1', 'version-1', controller.signal);
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.download).toHaveBeenCalledWith(`project-1/artifact-1/${contentHash}`, {}, { signal: controller.signal });
  });

  it('routes project CRUD through Supabase and enforces owner-only writes', async () => {
    const fake = fakeClient({
      projects: [{ id: 'project-1', owner_id: 'user-1', name: 'Before', description: '', workspace_path: 'C:/before', created_at: 'created', updated_at: 'created' }],
      project_members: [],
    });
    const repository = new CentinelApplicationRepository({ client: fake.client, userId: 'user-1' });
    expect((await repository.listProjects())[0].name).toBe('Before');
    expect((await repository.getProject('project-1'))?.workspacePath).toBe('C:/before');
    const updated = await repository.updateProject('project-1', { name: 'After' });
    expect(updated?.name).toBe('After');

    const otherMember = new CentinelApplicationRepository({ client: fake.client, userId: 'user-2' });
    await expect(otherMember.updateProject('project-1', { name: 'Rejected' }))
      .rejects.toMatchObject({ code: 'project_owner_required', statusCode: 403 });
    expect(fake.tables.projects?.[0].name).toBe('After');
  });

  it('creates a project owned by the request user and deletes its Supabase record', async () => {
    const fake = fakeClient({ projects: [], project_members: [] });
    const repository = new CentinelApplicationRepository({ client: fake.client, userId: 'user-1' });
    const project = await repository.createProject({ name: 'Created', description: '', workspacePath: 'C:/created' });
    expect(project.ownerId).toBe('user-1');
    expect(fake.tables.project_members?.[0]).toMatchObject({ project_id: project.id, user_id: 'user-1', role: 'owner' });
    expect(await repository.deleteProject(project.id)).toBe(true);
    expect(fake.tables.projects).toHaveLength(0);
  });

  it('rejects cross-project artifact sources and deletes private version objects with an artifact', async () => {
    const fake = fakeClient({
      projects: [{ id: 'project-1' }],
      project_sources: [{ id: 'source-other', project_id: 'project-2' }],
      artifacts: [{ id: 'artifact-1', project_id: 'project-1' }],
      artifact_versions: [{ id: 'version-1', project_id: 'project-1', artifact_id: 'artifact-1', storage_path: 'project-1/artifact-1/hash' }],
    });
    const repository = new CentinelApplicationRepository({ client: fake.client, userId: 'user-1' });
    await expect(repository.saveArtifact({
      projectId: 'project-1', sourceId: 'source-other', path: 'a.ts', name: 'a.ts', kind: 'file', mimeType: null, metadata: {},
    })).rejects.toMatchObject({ statusCode: 404 });
    expect(await repository.deleteArtifactById('artifact-1')).toBe(true);
    expect(fake.tables.artifacts).toHaveLength(0);
    expect(fake.storageRemovals).toContainEqual({ bucket: 'project-artifacts', paths: ['project-1/artifact-1/hash'] });
  });

  it('keeps project metadata and bytes intact when the deletion transaction fails', async () => {
    const fake = fakeClient({
      projects: [{ id: 'project-1', owner_id: 'user-1' }],
      artifact_versions: [{ id: 'version-1', project_id: 'project-1', storage_path: 'project-1/artifact-1/hash' }],
    });
    fake.setDeletionCommitFailure(true);
    const repository = new CentinelApplicationRepository({ client: fake.client, userId: 'user-1' });
    await expect(repository.deleteProject('project-1')).rejects.toMatchObject({ code: 'project_delete_commit_failed' });
    expect(fake.tables.projects).toHaveLength(1);
    expect(fake.storageObjects.has('project-artifacts:project-1/artifact-1/hash')).toBe(true);
    expect(fake.tables.storage_deletion_jobs).toBeUndefined();
  });

  it('retries a committed project deletion manifest after a Storage failure', async () => {
    const fake = fakeClient({
      projects: [{ id: 'project-1', owner_id: 'user-1' }],
      artifact_versions: [{ id: 'version-1', project_id: 'project-1', storage_path: 'project-1/artifact-1/hash' }],
    });
    const repository = new CentinelApplicationRepository({ client: fake.client, userId: 'user-1' });
    fake.setStorageRemoveFailure(true);
    expect(await repository.deleteProject('project-1')).toBe(true);
    expect(fake.tables.projects).toHaveLength(0);
    expect(fake.tables.storage_deletion_jobs).toHaveLength(1);
    expect(fake.storageObjects.has('project-artifacts:project-1/artifact-1/hash')).toBe(true);
    fake.setStorageRemoveFailure(false);
    await repository.listProjects();
    expect(fake.storageObjects.size).toBe(0);
    expect(fake.tables.storage_deletion_jobs).toHaveLength(0);
  });

  it('cleans a large project manifest in bounded Storage batches', async () => {
    const fake = fakeClient({
      projects: [{ id: 'project-1', owner_id: 'user-1' }],
      artifact_versions: Array.from({ length: 131 }, (_, index) => ({
        id: `version-${index}`, project_id: 'project-1', storage_path: `project-1/artifact-1/hash-${String(index).padStart(3, '0')}`,
      })),
    });
    const repository = new CentinelApplicationRepository({ client: fake.client, userId: 'user-1' });
    expect(await repository.deleteProject('project-1')).toBe(true);
    expect(fake.storageRemovals.map(item => item.paths.length)).toEqual([100, 31]);
    expect(fake.storageObjects.size).toBe(0);
    expect(fake.tables.storage_deletion_jobs).toHaveLength(0);
  });

  it('retries private artifact cleanup after its metadata deletion commits', async () => {
    const fake = fakeClient({
      projects: [{ id: 'project-1', owner_id: 'user-1' }],
      artifacts: [{ id: 'artifact-1', project_id: 'project-1' }],
      artifact_versions: [{ id: 'version-1', project_id: 'project-1', artifact_id: 'artifact-1', storage_path: 'project-1/artifact-1/hash' }],
    });
    const repository = new CentinelApplicationRepository({ client: fake.client, userId: 'user-1' });
    fake.setStorageRemoveFailure(true);
    expect(await repository.deleteArtifact('project-1', 'artifact-1')).toBe(true);
    expect(fake.tables.artifacts).toHaveLength(0);
    expect(fake.tables.storage_deletion_jobs).toHaveLength(1);
    fake.setStorageRemoveFailure(false);
    await repository.listProjects();
    expect(fake.storageObjects.size).toBe(0);
    expect(fake.tables.storage_deletion_jobs).toHaveLength(0);
  });

  it('cannot delete another owned project’s artifact through the requested project scope', async () => {
    const fake = fakeClient({
      projects: [{ id: 'project-1', owner_id: 'user-1' }, { id: 'project-2', owner_id: 'user-1' }],
      artifacts: [{ id: 'artifact-2', project_id: 'project-2' }],
      artifact_versions: [{ id: 'version-2', project_id: 'project-2', artifact_id: 'artifact-2', storage_path: 'project-2/artifact-2/hash' }],
    });
    const repository = new CentinelApplicationRepository({ client: fake.client, userId: 'user-1' });
    expect(await repository.deleteArtifact('project-1', 'artifact-2')).toBe(false);
    expect(fake.tables.artifacts).toHaveLength(1);
    expect(fake.storageObjects.has('project-artifacts:project-2/artifact-2/hash')).toBe(true);
    expect(fake.tables.storage_deletion_jobs).toBeUndefined();
  });

  it('supports project-scoped requirement CRUD and rejects mappings with foreign requirement IDs', async () => {
    const fake = fakeClient({
      projects: [{ id: 'project-1' }],
      requirements: [{ id: 'requirement-1', project_id: 'project-1', title: 'Before', description: '', category: '', priority: 'medium', created_at: 'created', updated_at: 'created' }],
      requirement_mappings: [],
    });
    const repository = new CentinelApplicationRepository({ client: fake.client, userId: 'user-1' });
    expect((await repository.getRequirementById('requirement-1'))?.title).toBe('Before');
    expect((await repository.updateRequirementById('requirement-1', { title: 'After' }))?.title).toBe('After');
    await expect(repository.saveRequirementMapping({
      projectId: 'project-1', requirementId: 'requirement-other', standardId: null, artifactId: null, fileId: null, symbolId: null, coverageStatus: 'unknown', confidence: 0,
    })).rejects.toMatchObject({ statusCode: 404 });
    const mapping = await repository.saveRequirementMappingForRequirement({
      requirementId: 'requirement-1', standardId: null, artifactId: null, fileId: 'file-1', symbolId: 'symbol-1', coverageStatus: 'covered', confidence: 0.9,
    });
    expect((await repository.listRequirementMappingsForRequirement('requirement-1')).map(item => item.id)).toEqual([mapping.id]);
    expect(await repository.deleteRequirementById('requirement-1')).toBe(true);
  });

  it('builds project assessment from durable findings and verifies assessment review ownership', async () => {
    const fake = fakeClient({
      projects: [{ id: 'project-1' }],
      findings: [{ id: 'finding-1', project_id: 'project-1', source: 'static', severity: 'high', priority: 'high', status: 'new', title: 'Risk', created_at: '2026-09-22' }],
      review_sessions: [{ id: 'review-other', project_id: 'project-2' }],
    });
    const repository = new CentinelApplicationRepository({ client: fake.client, userId: 'user-1' });
    const assessment = await repository.getProjectAssessment('project-1');
    expect(assessment.projectId).toBe('project-1');
    expect(assessment.summary.critical).toBe(1);
    await expect(repository.saveAssessment({
      projectId: 'project-1', reviewSessionId: 'review-other', riskLevel: 'high', score: 10, policyVersion: 'v1', summary: 'Risk', details: {},
    })).rejects.toMatchObject({ statusCode: 404 });
  });
});
