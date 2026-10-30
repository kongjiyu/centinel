import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { inspectLocalRepository, type LocalImportCoverage } from '../../src/applicationApi.js';
import type { AuthenticatedRequest } from '../../src/auth/gateway.js';
import { LocalRepositoryReconciliationCoordinator } from '../../src/integrations/localRepositoryReconciliation.js';
import type { StoreProject, StoreProjectSource } from '../../src/store/types.js';

const owner = '11111111-1111-4111-8111-111111111111';
const root = '33333333-3333-4333-8333-333333333333';
const roots: string[] = [];
const auth = { userId: owner, accessToken: 'verified' } as AuthenticatedRequest;

async function tempRepo(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'centinel-local-watch-'));
  roots.push(directory);
  await fs.mkdir(path.join(directory, 'src'));
  await fs.writeFile(path.join(directory, 'src', 'index.ts'), 'export const value = 1;\n');
  return directory;
}

afterEach(async () => { for (const directory of roots.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });

function project(workspacePath: string): StoreProject {
  return { id: root, ownerId: owner, name: 'Local', description: '', workspacePath, createdAt: '', updatedAt: '' };
}

function source(kind: StoreProjectSource['kind']): StoreProjectSource {
  return { id: 'source-1', projectId: root, integrationId: null, kind, name: 'Source', remoteId: null,
    remoteUrl: null, syncStatus: 'ready', lastSyncedAt: null, createdAt: '', updatedAt: '' };
}

function coverage(inventory: NonNullable<Awaited<ReturnType<typeof inspectLocalRepository>>>, artifactIds = ['artifact-1']): LocalImportCoverage {
  return { rootHash: inventory.rootHash, imported: artifactIds.length, skipped: 0, artifactIds,
    inventoryFingerprint: inventory.inventoryFingerprint, contentFingerprint: inventory.contentFingerprint };
}

function localArtifact(repo: string, content: string, filePath = 'src/index.ts'): Artifact {
  return { id: 'artifact-1', projectId: root, versionId: 'version-1',
    contentHash: crypto.createHash('sha256').update(content).digest('hex'), filePath, fileName: path.basename(filePath),
    originalPath: path.join(repo, filePath), source: 'repository', type: 'source_code', createdAt: '' };
}

function setup(options: {
  repo: string;
  prior?: LocalImportCoverage | null;
  sourceKind?: StoreProjectSource['kind'];
  artifacts?: Artifact[];
  now?: () => number;
}) {
  let savedCoverage = options.prior ?? null;
  const importRepository = vi.fn(async () => ({ complete: true }));
  const recordBaseline = vi.fn(async (_auth: AuthenticatedRequest, _projectId: string, previous: LocalImportCoverage,
    inventory: NonNullable<Awaited<ReturnType<typeof inspectLocalRepository>>>) => {
    savedCoverage = { ...previous, inventoryFingerprint: inventory.inventoryFingerprint, contentFingerprint: inventory.contentFingerprint };
  });
  const onChanged = vi.fn(async () => undefined);
  const inspect = vi.fn(inspectLocalRepository);
  const coordinator = new LocalRepositoryReconciliationCoordinator({
    sources: async () => [source(options.sourceKind ?? 'local_repository')],
    project: async () => project(options.repo),
    artifacts: async () => options.artifacts ?? [],
    inspect,
    coverage: async () => savedCoverage,
    recordBaseline,
    importRepository,
    onChanged,
    now: options.now,
  });
  return { coordinator, inspect, importRepository, recordBaseline, onChanged, getCoverage: () => savedCoverage };
}

describe('local repository source polling', () => {
  it('uses metadata as a change gate, then reimports and queues only after exact source content changes', async () => {
    const repo = await tempRepo();
    const content = 'export const value = 1;\n';
    const initial = await inspectLocalRepository(repo, true);
    let now = 1_000;
    const coordinator = setup({ repo, prior: coverage(initial!), artifacts: [localArtifact(repo, content)], now: () => now });

    coordinator.coordinator.observe(auth, [project(repo)]);
    await coordinator.coordinator.waitForIdle();
    expect(coordinator.importRepository).not.toHaveBeenCalled();
    expect(coordinator.inspect).toHaveBeenCalledWith(repo, false);
    expect(coordinator.inspect).not.toHaveBeenCalledWith(repo, true);

    await fs.writeFile(path.join(repo, 'src', 'index.ts'), 'export const value = 2;\n');
    now += 60_000;
    coordinator.coordinator.observe(auth, [project(repo)]);
    await coordinator.coordinator.waitForIdle();
    expect(coordinator.importRepository).toHaveBeenCalledOnce();
    expect(coordinator.importRepository.mock.calls[0]![3]).toMatchObject({ complete: true, root: repo });
    expect(coordinator.onChanged).toHaveBeenCalledOnce();
    coordinator.coordinator.close();
  });

  it('never scans a remote project workspace path or an empty local path', async () => {
    const repo = await tempRepo();
    const remote = setup({ repo, sourceKind: 'github_repository' });
    remote.coordinator.observe(auth, [project(repo)]);
    await remote.coordinator.waitForIdle();
    expect(remote.inspect).not.toHaveBeenCalled();
    expect(remote.importRepository).not.toHaveBeenCalled();

    const empty = setup({ repo });
    empty.coordinator.observe(auth, [project('')]);
    await empty.coordinator.waitForIdle();
    expect(empty.inspect).not.toHaveBeenCalled();
    expect(empty.importRepository).not.toHaveBeenCalled();
    remote.coordinator.close(); empty.coordinator.close();
  });

  it('records a legacy content baseline without reimporting unchanged files', async () => {
    const repo = await tempRepo();
    const content = 'export const value = 1;\n';
    const observed = await inspectLocalRepository(repo, true);
    const legacy = { rootHash: observed!.rootHash, imported: 1, skipped: 0, artifactIds: ['artifact-1'] } as LocalImportCoverage;
    const state = setup({ repo, prior: legacy, artifacts: [localArtifact(repo, content)] });
    state.coordinator.observe(auth, [project(repo)]);
    await state.coordinator.waitForIdle();
    expect(state.recordBaseline).toHaveBeenCalledOnce();
    expect(state.importRepository).not.toHaveBeenCalled();
    expect(state.onChanged).not.toHaveBeenCalled();
    state.coordinator.close();
  });

  it('prunes only previously tracked repository imports and preserves separate documents under the root', async () => {
    const repo = await tempRepo();
    const oldContent = 'export const value = 1;\n';
    const priorInventory = await inspectLocalRepository(repo, true);
    await fs.rm(path.join(repo, 'src', 'index.ts'));
    const separateDocument: Artifact = { ...localArtifact(repo, 'uploaded document', 'docs/overview.md'),
      id: 'artifact-2', type: 'requirement', fileName: 'overview.md' };
    const state = setup({ repo, prior: coverage(priorInventory!), artifacts: [localArtifact(repo, oldContent), separateDocument] });
    state.coordinator.observe(auth, [project(repo)]);
    await state.coordinator.waitForIdle();
    expect(state.importRepository).toHaveBeenCalledOnce();
    expect(state.importRepository.mock.calls[0]![5]).toEqual(['artifact-1']);
    state.coordinator.close();
  });

  it('does not queue a partial import and retries the same changed inventory on the next pass', async () => {
    const repo = await tempRepo();
    const original = 'export const value = 1;\n';
    const priorInventory = await inspectLocalRepository(repo, true);
    await fs.writeFile(path.join(repo, 'src', 'index.ts'), 'export const value = 2;\n');
    let now = 1_000;
    const coordinator = setup({ repo, prior: coverage(priorInventory!), artifacts: [localArtifact(repo, original)], now: () => now });
    coordinator.importRepository.mockResolvedValueOnce({ complete: false }).mockResolvedValueOnce({ complete: true });

    coordinator.coordinator.observe(auth, [project(repo)]);
    await coordinator.coordinator.waitForIdle();
    expect(coordinator.importRepository).toHaveBeenCalledOnce();
    expect(coordinator.onChanged).not.toHaveBeenCalled();

    now += 60_000;
    coordinator.coordinator.observe(auth, [project(repo)]);
    await coordinator.coordinator.waitForIdle();
    expect(coordinator.importRepository).toHaveBeenCalledTimes(2);
    expect(coordinator.onChanged).toHaveBeenCalledOnce();
    coordinator.coordinator.close();
  });

  it('repairs persisted partial content when the filesystem returns to the last complete hash', async () => {
    const repo = await tempRepo();
    const contentA = 'export const value = 1;\n';
    const contentB = 'export const value = 2;\n';
    const priorInventory = await inspectLocalRepository(repo, true);
    await fs.writeFile(path.join(repo, 'src', 'index.ts'), contentB);
    await fs.writeFile(path.join(repo, 'src', 'index.ts'), contentA);
    const state = setup({ repo, prior: coverage(priorInventory!), artifacts: [localArtifact(repo, contentB)] });
    state.coordinator.observe(auth, [project(repo)]);
    await state.coordinator.waitForIdle();
    expect(state.importRepository).toHaveBeenCalledOnce();
    expect(state.recordBaseline).not.toHaveBeenCalled();
    expect(state.onChanged).toHaveBeenCalledOnce();
    state.coordinator.close();
  });

  it('fails closed when the inventory exceeds safe bounds', async () => {
    const repo = await tempRepo();
    const state = setup({ repo });
    state.inspect.mockResolvedValue({ root: repo, rootHash: 'a'.repeat(64), complete: false });
    state.coordinator.observe(auth, [project(repo)]);
    await state.coordinator.waitForIdle();
    expect(state.importRepository).not.toHaveBeenCalled();
    expect(state.onChanged).not.toHaveBeenCalled();
    state.coordinator.close();
  });

  it('advances past an incomplete local inventory so another project is checked on the next pass', async () => {
    const firstPath = await tempRepo();
    const secondPath = await tempRepo();
    const first = project(firstPath);
    const second = { ...project(secondPath), id: 'project-two' };
    let now = 1_000;
    const inspect = vi.fn(async (repoPath: string, includeContent = false) => {
      const rootHash = repoPath === firstPath ? 'a'.repeat(64) : 'b'.repeat(64);
      const inventoryFingerprint = `current-${repoPath}`;
      if (!includeContent) return { root: repoPath, rootHash, inventoryFingerprint, complete: true };
      if (repoPath === firstPath) return { root: repoPath, rootHash, inventoryFingerprint, complete: false };
      return { root: repoPath, rootHash, inventoryFingerprint, contentFingerprint: 'c'.repeat(64), sourceFiles: [], complete: true };
    });
    const importRepository = vi.fn(async () => ({ complete: true }));
    const onChanged = vi.fn(async () => undefined);
    const coordinator = new LocalRepositoryReconciliationCoordinator({
      sources: async (_auth, projectId) => [{ ...source('local_repository'), projectId }],
      project: async (_auth, projectId) => [first, second].find(item => item.id === projectId) ?? null,
      artifacts: async () => [], inspect,
      coverage: async (_auth, _projectId, rootHash) => ({ rootHash, imported: 0, skipped: 0, artifactIds: [],
        inventoryFingerprint: 'prior', contentFingerprint: 'd'.repeat(64) }),
      recordBaseline: async () => undefined,
      importRepository,
      onChanged,
      now: () => now,
    });

    coordinator.observe(auth, [first, second]);
    await coordinator.waitForIdle();
    expect(importRepository).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledWith(firstPath, true);

    now += 60_000;
    coordinator.observe(auth, [first, second]);
    await coordinator.waitForIdle();
    expect(inspect).toHaveBeenCalledWith(secondPath, true);
    expect(importRepository).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledWith(auth, second.id);
    coordinator.close();
  });
});
