import path from 'node:path';
import type { Artifact } from '../artifacts.js';
import type { AuthenticatedRequest } from '../auth/gateway.js';
import { localRepositoryContentFingerprint, type LocalImportCoverage, type LocalRepositoryInventory } from '../applicationApi.js';
import type { StoreProject, StoreProjectSource } from '../store/types.js';

const MIN_POLL_INTERVAL_MS = 60_000;
const MAX_PROJECTS_PER_PASS = 8;
const MAX_CONTENT_SCANS_PER_PASS = 1;

type Dependencies = {
  sources(auth: AuthenticatedRequest, projectId: string): Promise<StoreProjectSource[]>;
  project(auth: AuthenticatedRequest, projectId: string): Promise<StoreProject | null>;
  artifacts(auth: AuthenticatedRequest, projectId: string): Promise<Artifact[]>;
  inspect(repoPath: string, includeContent?: boolean): Promise<LocalRepositoryInventory | null>;
  coverage(auth: AuthenticatedRequest, projectId: string, rootHash: string): Promise<LocalImportCoverage | null>;
  recordBaseline(auth: AuthenticatedRequest, projectId: string, coverage: LocalImportCoverage, inventory: LocalRepositoryInventory): Promise<void>;
  importRepository(auth: AuthenticatedRequest, projectId: string, repoPath: string, inventory: LocalRepositoryInventory,
    priorCoverage: LocalImportCoverage | null, pruneArtifactIds: string[]): Promise<{ complete: boolean }>;
  onChanged(auth: AuthenticatedRequest, projectId: string): Promise<void>;
  now?: () => number;
  onError?: (code: string) => void;
};

function pathKey(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function localArtifactPaths(artifacts: Artifact[], root: string, trackedArtifactIds: ReadonlySet<string>): Artifact[] {
  return artifacts.filter(artifact => {
    if (!trackedArtifactIds.has(artifact.id) || artifact.source !== 'repository' || artifact.sourceId || typeof artifact.originalPath !== 'string'
      || !path.isAbsolute(artifact.originalPath) && !path.win32.isAbsolute(artifact.originalPath)) return false;
    const relative = path.relative(root, path.resolve(artifact.originalPath));
    return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  });
}

function expectedContentFingerprint(artifacts: Artifact[], root: string, trackedArtifactIds: ReadonlySet<string>): string | null {
  const local = localArtifactPaths(artifacts, root, trackedArtifactIds);
  return localRepositoryContentFingerprint(local.map(artifact => ({ filePath: artifact.filePath, contentHash: artifact.contentHash })));
}

/**
 * Authenticated, bounded local-worktree reconciliation. It only considers
 * owner-owned projects with an explicit local_repository source row; remote
 * repository workspacePath values are never interpreted as local paths.
 */
export class LocalRepositoryReconciliationCoordinator {
  private sessions = new Map<string, AuthenticatedRequest>();
  private active = new Map<string, Promise<void>>();
  private lastPass = new Map<string, number>();
  private cursors = new Map<string, number>();
  private closed = false;
  private now: () => number;

  constructor(private readonly deps: Dependencies) { this.now = deps.now ?? Date.now; }

  observe(auth: AuthenticatedRequest, projects: StoreProject[]): void {
    if (this.closed) return;
    this.sessions.set(auth.userId, auth);
    const now = this.now();
    if (now - (this.lastPass.get(auth.userId) ?? Number.NEGATIVE_INFINITY) < MIN_POLL_INTERVAL_MS || this.active.has(auth.userId)) return;
    this.lastPass.set(auth.userId, now);
    const task = new Promise<void>(resolve => {
      setImmediate(() => {
        void this.run(auth.userId, projects).catch(() => {
          try { this.deps.onError?.('local_repository_poll_failed'); } catch { /* Keep the request lifecycle isolated. */ }
        }).finally(() => { this.active.delete(auth.userId); resolve(); });
      });
    });
    this.active.set(auth.userId, task);
  }

  private auth(ownerId: string): AuthenticatedRequest {
    const auth = this.sessions.get(ownerId);
    if (!auth || this.closed || auth.userId !== ownerId) throw new Error('Local repository session is unavailable.');
    return auth;
  }

  private async run(ownerId: string, projects: StoreProject[]): Promise<void> {
    const candidates = projects.filter(project => project.ownerId === ownerId && typeof project.workspacePath === 'string'
      && project.workspacePath.trim() && (path.isAbsolute(project.workspacePath.trim()) || path.win32.isAbsolute(project.workspacePath.trim())));
    if (!candidates.length) return;
    const start = (this.cursors.get(ownerId) ?? 0) % candidates.length;
    let contentScans = 0;
    for (let offset = 0; offset < Math.min(MAX_PROJECTS_PER_PASS, candidates.length); offset++) {
      const project = candidates[(start + offset) % candidates.length]!;
      // Persist progress before I/O so a dirty, unreadable, or oversized local
      // repository cannot starve later projects on every bounded pass. Once a
      // candidate consumes the content-scan budget, keep its successor cursor.
      if (contentScans === 0) this.cursors.set(ownerId, (start + offset + 1) % candidates.length);
      const auth = this.auth(ownerId);
      const sources = await this.deps.sources(auth, project.id);
      if (!sources.some(source => source.projectId === project.id && source.kind === 'local_repository')) continue;
      const workspacePath = project.workspacePath.trim();
      const metadata = await this.deps.inspect(workspacePath, false);
      if (!metadata?.complete || !metadata.inventoryFingerprint) continue;
      const previous = await this.deps.coverage(auth, project.id, metadata.rootHash);
      if (previous?.inventoryFingerprint === metadata.inventoryFingerprint) continue;
      if (contentScans >= MAX_CONTENT_SCANS_PER_PASS) continue;
      contentScans++;
      this.cursors.set(ownerId, (start + offset + 1) % candidates.length);
      const observed = await this.deps.inspect(workspacePath, true);
      if (!observed?.complete || observed.rootHash !== metadata.rootHash || !observed.inventoryFingerprint || !observed.contentFingerprint || !observed.sourceFiles) continue;

      const currentProject = await this.deps.project(this.auth(ownerId), project.id);
      if (!currentProject || currentProject.ownerId !== ownerId || currentProject.workspacePath.trim() !== workspacePath) continue;
      const currentSources = await this.deps.sources(this.auth(ownerId), project.id);
      if (!currentSources.some(source => source.projectId === project.id && source.kind === 'local_repository')) continue;

      const artifacts = await this.deps.artifacts(this.auth(ownerId), project.id);
      // Coverage artifact IDs are the durable ownership record for artifacts
      // created by this local importer. A separately uploaded artifact may
      // also carry a repository path under the root, so path membership alone
      // is not enough to authorize treating it as importer-owned or pruning it.
      const trackedArtifactIds = new Set(previous?.artifactIds ?? []);
      const localArtifacts = localArtifactPaths(artifacts, observed.root, trackedArtifactIds);
      const expectedByArtifacts = expectedContentFingerprint(artifacts, observed.root, trackedArtifactIds);
      const expectedFromFilesystem = localRepositoryContentFingerprint(observed.sourceFiles);
      const artifactsMatch = expectedByArtifacts === expectedFromFilesystem;
      if (previous?.contentFingerprint === observed.contentFingerprint && artifactsMatch || !previous && !localArtifacts.length && observed.sourceFiles.length === 0
        || previous && !previous.contentFingerprint && artifactsMatch) {
        if (previous) await this.deps.recordBaseline(this.auth(ownerId), project.id, previous, observed);
        continue;
      }

      const sourcePaths = new Set(observed.sourceFiles.map(file => pathKey(file.filePath)));
      const pruneArtifactIds = localArtifacts.filter(artifact => !sourcePaths.has(pathKey(artifact.filePath))).map(artifact => artifact.id);
      const imported = await this.deps.importRepository(this.auth(ownerId), project.id, workspacePath, observed, previous, pruneArtifactIds);
      if (!imported.complete) continue;
      await this.deps.onChanged(this.auth(ownerId), project.id);
      return;
    }
  }

  async waitForIdle(): Promise<void> { await Promise.all([...this.active.values()]); }
  close(): void { this.closed = true; this.sessions.clear(); }
}
