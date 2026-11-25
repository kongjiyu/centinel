import { createHash, randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { inspectLocalRepository, localRootHash, readLocalRepositoryFiles } from '../applicationApi.js';
import { detectArtifactType, type Artifact } from '../artifacts.js';
import { DynamicContractError } from '../dynamic/types.js';
import type { LocalWorkspace } from './localWorkspace.js';
import type { StoreProject, StoreProjectSource } from './types.js';

export async function resolveLocalWorkspaceFolder(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new DynamicContractError(400, 'Workspace path is required.');
  const folder = await realpath(value.trim()).catch(() => null);
  if (!folder || !(await stat(folder).catch(() => null))?.isDirectory()) {
    throw new DynamicContractError(400, 'Workspace path must be an accessible directory.');
  }
  return folder;
}

const rootKey = (folder: string) => process.platform === 'win32' ? folder.toLowerCase() : folder;

export async function createLocalProject(workspace: LocalWorkspace, owner: string, body: Record<string, unknown>, github: {
  requireConnection(): Promise<void>;
  queue(project: string, repository: string, url: string): Promise<void>;
}) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!name || name.length > 80) throw new DynamicContractError(400, 'Project name must be between 1 and 80 characters.');
  if (description.length > 500) throw new DynamicContractError(400, 'Description must be 500 characters or less.');
  const source = body.source as { type?: unknown } | undefined;
  const submitted = body.sources ?? [source?.type === 'github' ? source : { type: 'local-repository', path: body.workspacePath }];
  if (!Array.isArray(submitted)) throw new DynamicContractError(400, 'Expected a list of project sources.');
  const folders = new Map<string, string>();
  const repositories = new Map<string, string>();
  for (const item of submitted) {
    if (item?.type === 'github') {
      const value = typeof item.repoUrl === 'string' ? item.repoUrl.trim() : '';
      const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/?$/i.exec(value);
      const repository = match?.[1].replace(/\.git$/i, '');
      if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || repository.split('/').some(part => part === '.' || part === '..')) {
        throw new DynamicContractError(400, 'A valid GitHub repository URL is required.');
      }
      repositories.set(repository.toLowerCase(), `https://github.com/${repository}`);
      continue;
    }
    if (item?.type !== 'local-repository') throw new DynamicContractError(400, 'A supported project source is required.');
    const folder = await resolveLocalWorkspaceFolder(item.path);
    folders.set(rootKey(folder), folder);
  }
  if (repositories.size) await github.requireConnection();
  const project = workspace.createProject(owner, { name, description, workspacePath: folders.values().next().value ?? '' });
  const sourceImportWarnings: string[] = [];
  for (const folder of folders.values()) {
    try {
      const imported = await importLocalProjectRepository(workspace, owner, project, folder);
      if (!imported.complete) sourceImportWarnings.push(`Local folder ${basename(folder)} was only partially imported.`);
    } catch {
      sourceImportWarnings.push(`Local folder ${basename(folder)} could not be imported.`);
    }
  }
  for (const [repository, url] of repositories) {
    try { await github.queue(project.id, repository, url); }
    catch { sourceImportWarnings.push(`GitHub repository ${repository} could not be queued.`); }
  }
  return sourceImportWarnings.length ? { ...project, sourceImportWarnings } : project;
}

const activeImports = new WeakMap<LocalWorkspace, Set<string>>();

export function isLocalRepositoryImportActive(workspace: LocalWorkspace, owner: string, project: string, root: string): boolean {
  return activeImports.get(workspace)?.has(JSON.stringify([owner, project, root])) ?? false;
}

export async function importLocalProjectRepository(workspace: LocalWorkspace, owner: string, project: StoreProject, directory: unknown) {
  const folder = await resolveLocalWorkspaceFolder(directory);
  const root = rootKey(folder);
  const sourceKey = JSON.stringify([owner, project.id, root]);
  const imports = activeImports.get(workspace) ?? new Set<string>();
  activeImports.set(workspace, imports);
  if (imports.has(sourceKey)) throw new DynamicContractError(409, 'This repository is already being imported.');
  const now = new Date().toISOString();
  const primary = root === rootKey(project.workspacePath);
  const prior = workspace.localRepositorySource(owner, project.id, root);
  const source: StoreProjectSource = prior ?? { id: randomUUID(), projectId: project.id, name: basename(folder),
    kind: 'local_repository', integrationId: null, remoteId: primary ? null : localRootHash(folder), remoteUrl: null,
    syncStatus: 'idle', lastSyncedAt: null, createdAt: now, updatedAt: now };
  imports.add(sourceKey);
  try {
    workspace.saveLocalRepositorySource(owner, root, { ...source, syncStatus: 'syncing', updatedAt: now });
    const inventory = await inspectLocalRepository(folder);
    const previous = new Map(workspace.artifacts(owner, project.id).filter(item => item.source === 'repository')
      .map(item => [item.filePath, item]));
    const imported: Artifact[] = [];
    const skipped: string[] = [];
    const failures: Array<{ filePath: string; reason: string }> = [];
    for await (const file of readLocalRepositoryFiles(folder)) {
      if (file.kind !== 'file') {
        skipped.push(file.relativePath);
        if (file.kind === 'failed') failures.push({ filePath: file.relativePath, reason: file.reason });
        continue;
      }
      const filePath = primary ? file.relativePath : `local-repositories/${source.id}/${file.relativePath}`;
      const existing = previous.get(filePath);
      const contentHash = createHash('sha256').update(file.content).digest('hex');
      const artifact: Artifact & { versionId: string } = { id: existing?.id ?? randomUUID(), versionId: randomUUID(),
        projectId: project.id, type: detectArtifactType(file.name), source: 'repository', fileName: file.name, filePath,
        originalPath: file.fullPath, contentHash, createdAt: existing?.createdAt ?? now, updatedAt: now,
        ...(existing?.currency ? { currency: existing.currency } : {}),
        ...(file.git ? { git: file.git } : {}), ...(!primary ? { sourceId: source.id, localRepositoryName: source.name } : {}) };
      try {
        if (existing?.versionId && existing.contentHash === contentHash && existing.git?.commit === file.git?.commit
          && workspace.sourceBytes(owner, project.id, existing.id, existing.versionId)) {
          imported.push(existing);
          continue;
        }
        workspace.importSnapshot(owner, project, [{ artifact, mimeType: 'application/octet-stream', bytes: file.content }]);
        imported.push(artifact);
      } catch {
        skipped.push(file.relativePath);
        failures.push({ filePath: file.relativePath, reason: 'artifact_save_failed' });
      }
    }
    const complete = Boolean(inventory?.complete && inventory.inventoryFingerprint && !failures.length);
    workspace.saveLocalRepositorySource(owner, root, { ...source, syncStatus: complete ? 'ready' : 'error',
      lastSyncedAt: complete ? now : source.lastSyncedAt, updatedAt: new Date().toISOString() });
    return { imported, skipped, complete, failures };
  } catch (error) {
    workspace.saveLocalRepositorySource(owner, root, { ...source, syncStatus: 'error', updatedAt: new Date().toISOString() });
    throw error;
  } finally {
    imports.delete(sourceKey);
  }
}
