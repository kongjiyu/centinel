import type { ConnectedSource, ConnectedSourceSyncRun } from './types.js';

export type GitHubProjectImportInput = {
  name: string;
  description: string;
  workspacePath: string;
  repoUrl: string;
};

export type GitHubProjectImportHandoff<TProject extends { id: string }> = {
  project: TProject;
  source: ConnectedSource;
  run: ConnectedSourceSyncRun;
};

type GitHubProjectImporter = {
  queueSource(input: {
    ownerId: string;
    projectId: string;
    provider: 'github';
    kind: 'github_repository';
    remoteId: string;
    remoteUrl: string;
    name: string;
  }): Promise<ConnectedSource>;
  queueSync(input: {
    ownerId: string;
    projectId: string;
    sourceId: string;
    idempotencyKey: string;
  }): Promise<ConnectedSourceSyncRun>;
};

/**
 * Persist a GitHub project's source and initial run before handing work to the
 * sidecar's background coordinator. This function deliberately performs no
 * provider network calls; callers can safely send the project response before
 * starting the worker.
 */
export async function queueGitHubProjectImport<TProject extends { id: string }>(options: {
  project: GitHubProjectImportInput;
  ownerId: string;
  createProject: (project: Omit<GitHubProjectImportInput, 'repoUrl'>) => Promise<TProject>;
  importer: GitHubProjectImporter;
}): Promise<GitHubProjectImportHandoff<TProject>> {
  const project = await options.createProject({
    name: options.project.name,
    description: options.project.description,
    workspacePath: options.project.workspacePath,
  });
  const handoff = await queueGitHubRepositoryImport(options.importer, options.ownerId, project.id, options.project.repoUrl,
    `project-bootstrap:${project.id}`);
  return { project, ...handoff };
}

export async function queueGitHubRepositoryImport(importer: GitHubProjectImporter, ownerId: string, projectId: string, url: string, idempotencyKey: string) {
  const repoUrl = new URL(url);
  const remoteId = repoUrl.pathname.replace(/^\//, '').replace(/\/$/, '').replace(/\.git$/i, '');
  const source = await importer.queueSource({
    ownerId,
    projectId,
    provider: 'github',
    kind: 'github_repository',
    remoteId,
    remoteUrl: repoUrl.toString().replace(/\/$/, ''),
    name: remoteId.split('/')[1] || remoteId,
  });
  const run = await importer.queueSync({
    ownerId,
    projectId,
    sourceId: source.id,
    idempotencyKey,
  });
  return { source, run };
}
