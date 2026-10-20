import type { ConnectedSource } from '../types';

export const GITHUB_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000;
export const GITHUB_RECONCILIATION_TICK_MS = 30_000;
const MAX_PROJECTS_PER_PASS = 10;

type GitHubReconciliationApi = {
  listConnectedSources(projectId: string): Promise<ConnectedSource[]>;
  syncConnectedSource(projectId: string, sourceId: string, options: { maxPages: number; idempotencyKey: string }): Promise<unknown>;
};

export function startGitHubReconciliation(api: GitHubReconciliationApi & { projects(): Promise<Array<{ id: string }>> }): () => void {
  let active = true;
  let inFlight = false;
  let nextProjectIndex = 0;
  const attempts = new Map<string, number>();
  const reconcile = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      const projectIds = (await api.projects()).map(project => project.id);
      if (!active) return;
      const result = await reconcileOneDueGitHubSource(projectIds, nextProjectIndex, api, Date.now(), attempts, () => active);
      nextProjectIndex = result.nextIndex;
    } catch { /* A later tick can recover an expired session or transport. */ }
    finally { inFlight = false; }
  };
  const firstPass = window.setTimeout(() => { void reconcile(); }, 5_000);
  const timer = window.setInterval(() => { void reconcile(); }, GITHUB_RECONCILIATION_TICK_MS);
  window.addEventListener('focus', reconcile);
  return () => {
    active = false;
    window.clearTimeout(firstPass);
    window.clearInterval(timer);
    window.removeEventListener('focus', reconcile);
  };
}

/** Authenticated workspace polling; the importer compares remote commits before
 * reading content. Local files and repositories never enter this path. */
export async function reconcileOneDueGitHubSource(
  projectIds: string[],
  startIndex: number,
  api: GitHubReconciliationApi,
  now: number,
  attempts: Map<string, number>,
  isActive: () => boolean = () => true,
): Promise<{ nextIndex: number; attempted: boolean }> {
  if (!projectIds.length) return { nextIndex: 0, attempted: false };
  let nextIndex = ((startIndex % projectIds.length) + projectIds.length) % projectIds.length;
  for (let checked = 0; checked < Math.min(projectIds.length, MAX_PROJECTS_PER_PASS) && isActive(); checked++) {
    const projectId = projectIds[nextIndex];
    nextIndex = (nextIndex + 1) % projectIds.length;
    let sources: ConnectedSource[];
    try { sources = await api.listConnectedSources(projectId); } catch { continue; }
    if (!isActive()) break;
    const lastAttemptAt = (item: ConnectedSource) => {
      const synced = Date.parse(item.lastSyncedAt ?? '');
      return Math.max(attempts.get(`${projectId}:${item.id}`) ?? -Infinity, Number.isFinite(synced) ? synced : -Infinity);
    };
    const source = sources.filter(item => {
      if (item.provider !== 'github' || item.kind !== 'github_repository' || item.status !== 'active' || item.syncStatus === 'syncing') return false;
      // Listing sources lets the sidecar recover its durable worker first.
      const run = item.latestSyncRun;
      if (run && (['queued', 'running'].includes(run.status) || run.status === 'partial' && !run.errorCode && !run.retryable)) return false;
      if (run?.nextAttemptAt && Date.parse(run.nextAttemptAt) > now) return false;
      return now - lastAttemptAt(item) >= GITHUB_RECONCILIATION_INTERVAL_MS;
    }).sort((left, right) => lastAttemptAt(left) - lastAttemptAt(right))[0];
    if (!source) continue;
    // Include failed attempts so a denied request cannot starve other sources.
    attempts.set(`${projectId}:${source.id}`, now);
    try {
      await api.syncConnectedSource(projectId, source.id, {
        maxPages: 1,
        idempotencyKey: `github-periodic:${source.id}:${Math.floor(now / GITHUB_RECONCILIATION_INTERVAL_MS)}`,
      });
    } catch { /* Persisted source errors remain available in Sources. */ }
    return { nextIndex, attempted: true };
  }
  return { nextIndex, attempted: false };
}
