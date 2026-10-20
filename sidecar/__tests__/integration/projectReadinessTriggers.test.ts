import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthGateway as AuthGatewayType, AuthenticatedRequest } from '../../src/auth/gateway.js';
import { createSidecarServer } from '../../src/index.js';
import type { ProjectReadinessCoordinator } from '../../src/readiness/service.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
const artifactId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';

const appMocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  saveSource: vi.fn(),
  deleteArtifact: vi.fn(),
  importLocalRepositoryArtifacts: vi.fn(),
  uploadClientArtifact: vi.fn(),
  sourceStatus: vi.fn(),
  importSource: vi.fn(),
  syncSource: vi.fn(),
  removeSource: vi.fn(),
  queueGitHubProjectImport: vi.fn(),
}));

vi.mock('../../src/applicationRepository.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/applicationRepository.js')>();
  return {
    ...actual,
    CentinelApplicationRepository: class {
      createProject(input: unknown) { return appMocks.createProject(input); }
      saveSource(input: unknown) { return appMocks.saveSource(input); }
      deleteArtifact(project: string, artifact: string) { return appMocks.deleteArtifact(project, artifact); }
    },
  };
});

vi.mock('../../src/applicationApi.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/applicationApi.js')>();
  return {
    ...actual,
    importLocalRepositoryArtifacts: (...args: unknown[]) => appMocks.importLocalRepositoryArtifacts(...args),
    uploadClientArtifact: (...args: unknown[]) => appMocks.uploadClientArtifact(...args),
  };
});

vi.mock('../../src/integrations/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/integrations/index.js')>();
  return {
    ...actual,
    SupabaseConnectedSourceRepository: class {},
    ConnectedSourceImporter: class {
      status(...args: unknown[]) { return appMocks.sourceStatus(...args); }
      importSource(...args: unknown[]) { return appMocks.importSource(...args); }
      sync(...args: unknown[]) { return appMocks.syncSource(...args); }
      disconnectSource(...args: unknown[]) { return appMocks.removeSource(...args); }
    },
  };
});

vi.mock('../../src/integrations/projectImport.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/integrations/projectImport.js')>();
  return { ...actual, queueGitHubProjectImport: (...args: unknown[]) => appMocks.queueGitHubProjectImport(...args) };
});

vi.mock('../../src/integrations/sourceWorker.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/integrations/sourceWorker.js')>();
  return {
    ...actual,
    ConnectedSourceWorkerCoordinator: class {
      adoptSession() {}
      enqueue() {}
      recoverProject() {}
      close() {}
    },
  };
});

describe('project readiness automatic trigger HTTP wiring', () => {
  let server: Server;
  let baseUrl: string;
  let notify: ReturnType<typeof vi.fn>;
  let authGateway: AuthGatewayType;

  beforeEach(async () => {
    vi.clearAllMocks();
    notify = vi.fn();
    const coordinator = {
      adoptSession: vi.fn(),
      notify,
      close: vi.fn(),
    } as unknown as ProjectReadinessCoordinator;
    authGateway = {
      authenticate: vi.fn(async () => ({
        userId: 'owner-1',
        accessToken: 'validated-token',
        client: {} as AuthenticatedRequest['client'],
        user: { id: 'owner-1' } as AuthenticatedRequest['user'],
        suppliedUserId: null,
      })),
      requireProjectMember: vi.fn(async () => undefined),
    } as unknown as AuthGatewayType;

    appMocks.createProject.mockResolvedValue({ id: projectId, name: 'Example', description: '', workspacePath: 'C:\\fixture\\repo' });
    appMocks.saveSource.mockResolvedValue(undefined);
    appMocks.deleteArtifact.mockResolvedValue(true);
    appMocks.importLocalRepositoryArtifacts.mockResolvedValue({ imported: 1 });
    appMocks.uploadClientArtifact.mockResolvedValue({ id: artifactId, fileName: 'requirements.md' });
    appMocks.sourceStatus.mockResolvedValue({ connected: true });
    appMocks.importSource.mockResolvedValue({ source: { id: sourceId }, run: { id: runId, status: 'complete' } });
    appMocks.syncSource.mockResolvedValue({ source: { id: sourceId }, run: { id: runId, status: 'complete' } });
    appMocks.removeSource.mockResolvedValue({ removed: true });
    appMocks.queueGitHubProjectImport.mockResolvedValue({
      project: { id: projectId, name: 'Example', description: '', workspacePath: '', repoUrl: 'https://github.com/acme/example' },
      source: { id: sourceId },
      run: { id: runId },
    });

    vi.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as ReturnType<typeof fs.statSync>);
    server = createSidecarServer(authGateway, { readinessCoordinator: coordinator });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    vi.restoreAllMocks();
  });

  async function request(path: string, method: string, body?: Record<string, unknown>) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer validated-token',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  function expectTrigger(trigger: string) {
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner-1' }), projectId, trigger);
  }

  it('triggers project creation after successful local and GitHub project setup', async () => {
    const local = await request('/projects', 'POST', {
      name: 'Example', description: '', workspacePath: 'C:\\fixture\\repo', source: { type: 'local-repository' },
    });
    expect(local.status).toBe(201);
    expectTrigger('project_created');
    expect(fs.statSync).toHaveBeenCalledWith('C:\\fixture\\repo');

    notify.mockClear();
    const github = await request('/projects', 'POST', {
      name: 'Example', description: '', source: { type: 'github', repoUrl: 'https://github.com/acme/example' },
    });
    expect(github.status).toBe(201);
    expectTrigger('project_created');
    expect(appMocks.queueGitHubProjectImport).toHaveBeenCalledTimes(1);
  });

  it('does not trigger project creation when source preparation fails', async () => {
    appMocks.importLocalRepositoryArtifacts.mockRejectedValueOnce(new Error('local import failed'));
    const local = await request('/projects', 'POST', {
      name: 'Example', description: '', workspacePath: 'C:\\fixture\\repo', source: { type: 'local-repository' },
    });
    expect(local.status).toBe(400);
    expect(notify).not.toHaveBeenCalled();

    appMocks.sourceStatus.mockResolvedValueOnce({ connected: false });
    const github = await request('/projects', 'POST', {
      name: 'Example', description: '', source: { type: 'github', repoUrl: 'https://github.com/acme/example' },
    });
    expect(github.status).toBe(409);
    expect(notify).not.toHaveBeenCalled();
  });

  it('triggers repository import and document upload only after successful writes', async () => {
    const imported = await request(`/projects/${projectId}/artifacts/import-repo`, 'POST', { repoPath: 'C:\\fixture\\repo' });
    expect(imported.status).toBe(200);
    expectTrigger('repository_imported');

    notify.mockClear();
    appMocks.importLocalRepositoryArtifacts.mockRejectedValueOnce(new Error('repository import failed'));
    const failedImport = await request(`/projects/${projectId}/artifacts/import-repo`, 'POST', { repoPath: 'C:\\fixture\\repo' });
    expect(failedImport.status).toBe(400);
    expect(notify).not.toHaveBeenCalled();

    const uploaded = await request(`/projects/${projectId}/artifacts`, 'POST', {
      fileName: 'requirements.md', type: 'requirements', content: Buffer.from('Requirement text').toString('base64'),
    });
    expect(uploaded.status).toBe(201);
    expectTrigger('document_uploaded');

    notify.mockClear();
    appMocks.uploadClientArtifact.mockRejectedValueOnce(new Error('storage write failed'));
    const failedUpload = await request(`/projects/${projectId}/artifacts`, 'POST', {
      fileName: 'requirements.md', type: 'requirements', content: Buffer.from('Requirement text').toString('base64'),
    });
    expect(failedUpload.status).toBe(500);
    expect(notify).not.toHaveBeenCalled();
  });

  it('triggers artifact removal only when the artifact was deleted', async () => {
    const deleted = await request(`/projects/${projectId}/artifacts/${artifactId}`, 'DELETE');
    expect(deleted.status).toBe(200);
    expectTrigger('source_removed');

    notify.mockClear();
    appMocks.deleteArtifact.mockResolvedValueOnce(false);
    const missing = await request(`/projects/${projectId}/artifacts/${artifactId}`, 'DELETE');
    expect(missing.status).toBe(404);
    expect(notify).not.toHaveBeenCalled();
  });

  it('triggers connected-source add, sync, and removal only for successful route results', async () => {
    const added = await request(`/projects/${projectId}/sources`, 'POST', {
      provider: 'github', kind: 'github_repository', remoteId: 'acme/example', name: 'Example',
    });
    expect(added.status).toBe(201);
    expectTrigger('source_changed');

    notify.mockClear();
    const synced = await request(`/projects/${projectId}/sources/${sourceId}/sync`, 'POST', {});
    expect(synced.status).toBe(200);
    expectTrigger('source_changed');

    notify.mockClear();
    const removed = await request(`/projects/${projectId}/sources/${sourceId}`, 'DELETE');
    expect(removed.status).toBe(200);
    expectTrigger('source_changed');

    notify.mockClear();
    appMocks.importSource.mockRejectedValueOnce(new Error('source import failed'));
    const failedAdd = await request(`/projects/${projectId}/sources`, 'POST', {
      provider: 'github', kind: 'github_repository', remoteId: 'acme/example', name: 'Example',
    });
    expect(failedAdd.status).toBe(500);
    expect(notify).not.toHaveBeenCalled();

    appMocks.syncSource.mockRejectedValueOnce(new Error('source sync failed'));
    const failedSync = await request(`/projects/${projectId}/sources/${sourceId}/sync`, 'POST', {});
    expect(failedSync.status).toBe(500);
    expect(notify).not.toHaveBeenCalled();

    appMocks.removeSource.mockRejectedValueOnce(new Error('source removal failed'));
    const failedRemove = await request(`/projects/${projectId}/sources/${sourceId}`, 'DELETE');
    expect(failedRemove.status).toBe(500);
    expect(notify).not.toHaveBeenCalled();
  });
});
