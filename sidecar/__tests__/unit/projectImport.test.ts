import { describe, expect, it, vi } from 'vitest';
import { queueGitHubProjectImport } from '../../src/integrations/projectImport.js';
import type { ConnectedSource, ConnectedSourceSyncRun } from '../../src/integrations/types.js';

const source: ConnectedSource = {
  id: 'source-1', projectId: 'project-1', integrationId: 'integration-1', provider: 'github', kind: 'github_repository',
  remoteId: 'acme/quality', remoteUrl: 'https://github.com/acme/quality', name: 'quality', selectedScope: { branch: 'main' },
  remoteRevision: null, syncCursor: null, status: 'active', syncStatus: 'idle', lastSyncedAt: null,
  lastSuccessfulSyncAt: null, lastError: null, createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z',
};

const run: ConnectedSourceSyncRun = {
  id: 'run-1', projectId: 'project-1', sourceId: 'source-1', status: 'queued', idempotencyKey: 'project-bootstrap:project-1',
  remoteRevision: null, cursorStart: null, cursorEnd: null, attemptCount: 0, importedCount: 0, updatedCount: 0,
  unchangedCount: 0, removedCount: 0, inaccessibleCount: 0, errorCode: null, errorMessage: null, retryable: false,
  startedAt: null, completedAt: null, createdAt: '2026-10-13T00:00:00.000Z',
};

describe('GitHub project creation import handoff (T-SRC-01)', () => {
  it('returns only after project, source, and queued run are durable without awaiting provider work', async () => {
    const createProject = vi.fn(async () => ({ id: 'project-1', name: 'Quality' }));
    const queueSource = vi.fn(async () => source);
    const queueSync = vi.fn(async () => run);
    const neverCompletes = new Promise<never>(() => {});
    const importer = { queueSource, queueSync, sync: vi.fn(() => neverCompletes) };

    const queued = await queueGitHubProjectImport({
      project: { name: 'Quality', description: 'Repo', workspacePath: '', repoUrl: 'https://github.com/acme/quality' },
      ownerId: 'owner-1',
      createProject,
      importer,
    });

    expect(createProject).toHaveBeenCalledWith({ name: 'Quality', description: 'Repo', workspacePath: '' });
    expect(queueSource).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner-1', projectId: 'project-1', provider: 'github', kind: 'github_repository',
      remoteId: 'acme/quality', remoteUrl: 'https://github.com/acme/quality',
    }));
    expect(queueSync).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner-1', projectId: 'project-1', sourceId: 'source-1',
      idempotencyKey: 'project-bootstrap:project-1',
    }));
    expect(queued).toMatchObject({ project: { id: 'project-1' }, source, run });
    expect(importer.sync).not.toHaveBeenCalled();
  });
});
