import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import type { AuthenticatedRequest } from '../../src/auth/gateway.js';

const fixtures = vi.hoisted(() => ({
  project: null as any,
  artifacts: [] as any[],
  requirements: [] as any[],
  standards: [] as any[],
  sources: [] as any[],
  sourceItems: {} as Record<string, any[]>,
  localImports: [] as any[],
  localImportError: null as any,
  localImportFilters: [] as Array<[string, unknown]>,
}));

vi.mock('../../src/applicationRepository.js', () => ({
  CentinelApplicationRepository: class {
    async getProject() { return fixtures.project; }
    async listRequirements() { return fixtures.requirements; }
    async listStandards() { return fixtures.standards; }
  },
}));

vi.mock('../../src/applicationApi.js', () => ({
  listClientArtifacts: async () => fixtures.artifacts,
  readClientArtifactContent: vi.fn(),
}));

vi.mock('../../src/integrations/supabaseRepository.js', () => ({
  SupabaseConnectedSourceRepository: class {
    async listSources() { return fixtures.sources; }
    async listSourceItems(sourceId: string) { return fixtures.sourceItems[sourceId] ?? []; }
  },
}));

vi.mock('../../src/review/groundingProvider.js', () => ({ createGroundingModelProvider: vi.fn() }));
vi.mock('../../src/readiness/repository.js', () => ({ SupabaseReadinessStore: class {} }));

import { inspectReadinessSources } from '../../src/readiness/runtime.js';

const projectId = 'project-1';

function sourceArtifact() {
  return {
    id: 'artifact-1', projectId, type: 'source_code', source: 'repository', fileName: 'auth.ts',
    filePath: 'src/auth.ts', originalPath: null, contentHash: 'source-hash', versionId: 'artifact-version-1',
    createdAt: '2026-10-19T00:00:00.000Z',
  };
}

function auth() {
  return {
    userId: 'member-1',
    client: {
      from: (table: string) => {
        if (table !== 'audit_events') throw new Error(`Unexpected readiness inventory table: ${table}`);
        const query: any = {
          select() { return query; },
          eq(column: string, value: unknown) { fixtures.localImportFilters.push([column, value]); return query; },
          order() { return query; },
          then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
            return Promise.resolve({ data: fixtures.localImports, error: fixtures.localImportError }).then(resolve, reject);
          },
        };
        return query;
      },
    },
  } as unknown as AuthenticatedRequest;
}

function connectedSource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'source-1', projectId, integrationId: 'integration-1', provider: 'github', kind: 'github_repository',
    remoteId: 'repo-1', remoteUrl: null, name: 'repository', selectedScope: {}, remoteRevision: 'revision-1',
    syncCursor: null, status: 'active', syncStatus: 'ready', lastSyncedAt: null, lastSuccessfulSyncAt: null,
    lastError: null, createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z',
    latestSyncRun: { id: 'run-1', status: 'success', errorCode: null, retryable: false },
    ...overrides,
  };
}

function sourceItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1', projectId, sourceId: 'source-1', remoteId: 'remote-1', path: 'src/auth.ts', name: 'auth.ts',
    mimeType: 'text/typescript', contentHash: 'source-hash', storagePath: null, artifactId: 'artifact-1',
    artifactVersionId: 'artifact-version-1', revision: 'revision-1', status: 'available', metadata: {},
    lastSeenAt: null, unavailableAt: null, error: null, createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z', ...overrides,
  };
}

beforeEach(() => {
  fixtures.project = { id: projectId, description: 'Test project.', updatedAt: '2026-10-19T00:00:00.000Z' };
  fixtures.artifacts = [sourceArtifact()];
  fixtures.requirements = [{ id: 'req-1', projectId, title: 'Validate ownership', description: 'Every private read checks its owner.', category: 'security', priority: 'high', createdAt: '2026-10-18T00:00:00.000Z', updatedAt: 'requirement-v1' }];
  fixtures.standards = [{ id: 'standard-1', projectId, code: 'SEC-01', title: 'Authorize private reads', description: 'Check ownership before reading.', source: 'manual', version: '1', metadata: {}, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: 'standard-v1' }];
  fixtures.sources = [];
  fixtures.sourceItems = {};
  fixtures.localImports = [];
  fixtures.localImportError = null;
  fixtures.localImportFilters = [];
});

describe('inspectReadinessSources', () => {
  it('preserves an authorization cause for a failed zero-file import without exposing provider text', async () => {
    fixtures.artifacts = [];
    fixtures.sources = [connectedSource({ syncStatus: 'error', latestSyncRun: { id: 'run-auth', status: 'failure', errorCode: 'http_401', retryable: false, errorMessage: 'private credential detail' } })];
    const result = await inspectReadinessSources(auth(), projectId);
    expect(result.unavailable[0].unavailableReason).toBe('authorization_required');
    expect(JSON.stringify(result)).not.toContain('private credential detail');
  });

  it('preloads manual requirements and coding standards as versioned, hash-verified evidence', async () => {
    const first = await inspectReadinessSources(auth(), projectId);
    const requirement = first.preloaded?.find(item => item.artifact.id === 'requirement:req-1');
    const standard = first.preloaded?.find(item => item.artifact.id === 'coding_standard:standard-1');
    const requirementContent = 'Validate ownership\nEvery private read checks its owner.';
    const standardContent = 'SEC-01: Authorize private reads\nCheck ownership before reading.';

    expect(requirement).toMatchObject({
      content: requirementContent,
      artifact: {
        projectId,
        type: 'requirement',
        source: 'documents',
        filePath: 'requirement/req-1',
        versionId: 'requirement-v1',
        contentHash: crypto.createHash('sha256').update(requirementContent).digest('hex'),
      },
    });
    expect(standard).toMatchObject({
      content: standardContent,
      artifact: {
        projectId,
        type: 'coding_standard',
        source: 'documents',
        filePath: 'coding_standard/standard-1',
        versionId: 'standard-v1',
        contentHash: crypto.createHash('sha256').update(standardContent).digest('hex'),
      },
    });

    const fingerprint = first.fingerprint;
    fixtures.requirements = [{ ...fixtures.requirements[0], updatedAt: 'requirement-v2' }];
    const updated = await inspectReadinessSources(auth(), projectId);
    expect(updated.fingerprint).not.toBe(fingerprint);
    expect(updated.preloaded?.find(item => item.artifact.id === 'requirement:req-1')?.artifact.versionId).toBe('requirement-v2');
  });

  it('scopes and deduplicates local import coverage, adding an actionable unavailable sentinel for skipped files', async () => {
    fixtures.localImports = [
      { payload: { id: 'latest-import', rootHash: 'root-current', imported: 3, skipped: 2 } },
      { payload: { id: 'older-import', rootHash: 'root-current', imported: 5, skipped: 0 } },
      { payload: { id: 'complete-import', rootHash: 'root-complete', imported: 4, skipped: 0 } },
    ];

    const result = await inspectReadinessSources(auth(), projectId);

    expect(fixtures.localImportFilters).toEqual([['project_id', projectId], ['event_type', 'local_import_coverage']]);
    expect(result.unavailable).toHaveLength(1);
    expect(result.unavailable[0]).toMatchObject({
      artifact: { id: 'local-coverage:root-current', filePath: 'local import coverage' },
      error: expect.stringContaining('skipped files'),
    });
  });

  it.each([
    { label: 'complete', source: connectedSource(), item: sourceItem(), keepArtifact: true, unavailableCount: 0 },
    {
      label: 'partial',
      source: connectedSource({ latestSyncRun: { id: 'run-1', status: 'partial', errorCode: 'provider_timeout', retryable: true } }),
      item: sourceItem({ status: 'inaccessible' }), keepArtifact: false, unavailableCount: 1,
    },
    {
      label: 'disconnected',
      source: connectedSource({ status: 'disconnected', syncStatus: 'idle', latestSyncRun: null }),
      item: sourceItem(), keepArtifact: false, unavailableCount: 0,
    },
  ])('$label connected source inventory handles its previous artifact safely', async ({ source, item, keepArtifact, unavailableCount }) => {
    fixtures.sources = [source];
    fixtures.sourceItems = { 'source-1': [item] };

    const result = await inspectReadinessSources(auth(), projectId);

    expect(result.artifacts.some(artifact => artifact.id === 'artifact-1')).toBe(keepArtifact);
    expect(result.unavailable).toHaveLength(unavailableCount);
  });

  it('fails explicitly when persisted local source coverage cannot be loaded', async () => {
    fixtures.localImportError = { message: 'Database details must remain private.' };

    await expect(inspectReadinessSources(auth(), projectId)).rejects.toThrow('Local source coverage is unavailable');
    await expect(inspectReadinessSources(auth(), projectId)).rejects.not.toThrow('Database details');
  });

  it('removes obsolete local coverage when every artifact in that import was removed', async () => {
    fixtures.localImports = [{ payload: { rootHash: 'removed-root', imported: 1, skipped: 1, artifactIds: ['removed-artifact'] } }];
    const result = await inspectReadinessSources(auth(), projectId);
    expect(result.unavailable).toEqual([]);
  });
});
