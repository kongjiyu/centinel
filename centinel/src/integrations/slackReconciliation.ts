import type { ConnectedSource } from '../types';

export const SLACK_RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;
const MAX_PROJECTS_PER_PASS = 10;
const MAX_PAGES_PER_SYNC = 5;

export type SlackReconciliationApi = {
  listConnectedSources(projectId: string): Promise<ConnectedSource[]>;
  getConnectedSourceSyncHistory(projectId: string, sourceId: string): Promise<Array<{ id: string; status: string }>>;
  resumeConnectedSourceSync(projectId: string, sourceId: string, runId: string, options: { maxPages: number }): Promise<unknown>;
  syncConnectedSource(projectId: string, sourceId: string, options: { maxPages: number; idempotencyKey: string }): Promise<unknown>;
};

function due(source: ConnectedSource, now: number): boolean {
  if (source.provider !== 'slack' || source.status !== 'active' || source.syncStatus === 'syncing') return false;
  const lastAttempt = source.lastSyncedAt ? Date.parse(source.lastSyncedAt) : NaN;
  return !Number.isFinite(lastAttempt) || now - lastAttempt >= SLACK_RECONCILIATION_INTERVAL_MS;
}

/** One bounded authenticated pass. A failed provider call is recorded by the
 * sidecar's sync run and retried on a later pass, never in a tight loop. */
export async function reconcileOneDueSlackSource(
  projectIds: string[],
  startIndex: number,
  api: SlackReconciliationApi,
  now: number,
  isActive: () => boolean = () => true,
): Promise<{ nextIndex: number; attempted: boolean }> {
  if (!projectIds.length) return { nextIndex: 0, attempted: false };
  let nextIndex = ((startIndex % projectIds.length) + projectIds.length) % projectIds.length;
  const checks = Math.min(projectIds.length, MAX_PROJECTS_PER_PASS);
  for (let checked = 0; checked < checks && isActive(); checked += 1) {
    const projectId = projectIds[nextIndex];
    nextIndex = (nextIndex + 1) % projectIds.length;
    let sources: ConnectedSource[];
    try {
      sources = await api.listConnectedSources(projectId);
    } catch {
      // One inaccessible project must not starve later projects.
      continue;
    }
    if (!isActive()) break;
    const source = sources.find(item => due(item, now));
    if (!source) continue;
    try {
      const hasPartialCursor = typeof source.syncCursor?.pageToken === 'string' && source.syncCursor.pageToken.length > 0;
      const latestRun = hasPartialCursor ? (await api.getConnectedSourceSyncHistory(projectId, source.id))[0] : null;
      if (latestRun?.status === 'partial') {
        await api.resumeConnectedSourceSync(projectId, source.id, latestRun.id, { maxPages: MAX_PAGES_PER_SYNC });
      } else {
        await api.syncConnectedSource(projectId, source.id, {
          maxPages: MAX_PAGES_PER_SYNC,
          idempotencyKey: `slack-periodic:${source.id}:${Math.floor(now / SLACK_RECONCILIATION_INTERVAL_MS)}`,
        });
      }
    } catch {
      // The importer persists the failed run and source error for the UI.
    }
    return { nextIndex, attempted: true };
  }
  return { nextIndex, attempted: false };
}
