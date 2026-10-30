import type { ConnectedSource, IntegrationProvider } from '../types';

export const CONNECTED_SOURCE_RECONCILIATION_INTERVAL_MS = 60_000;
export const CONNECTED_SOURCE_RECONCILIATION_START_DELAY_MS = 5_000;
const MAX_PROJECTS_PER_PASS = 10;
const MAX_SOURCES_PER_PASS = 10;
const MAX_PAGES: Record<IntegrationProvider, number> = {
  github: 1,
  google_drive: 5,
  slack: 5,
};

export type ConnectedSourceReconciliationApi = {
  projects(): Promise<Array<{ id: string }>>;
  listConnectedSources(projectId: string): Promise<ConnectedSource[]>;
  syncConnectedSource(projectId: string, sourceId: string, options: { maxPages: number; idempotencyKey: string }): Promise<unknown>;
  getConnectedSourceSyncHistory?(projectId: string, sourceId: string): Promise<Array<{ id: string; status: string }>>;
  resumeConnectedSourceSync?(projectId: string, sourceId: string, runId: string, options: { maxPages: number }): Promise<unknown>;
};

type ReconciliationResult = { nextProjectIndex: number; attempted: boolean };

function hasProviderCursor(source: ConnectedSource): boolean {
  return typeof source.syncCursor?.pageToken === 'string' && source.syncCursor.pageToken.length > 0;
}

function lastAttemptAt(projectId: string, source: ConnectedSource, attempts: Map<string, number>): number {
  const saved = Date.parse(source.lastSyncedAt ?? '');
  return Math.max(attempts.get(`${projectId}:${source.id}`) ?? Number.NEGATIVE_INFINITY,
    Number.isFinite(saved) ? saved : Number.NEGATIVE_INFINITY);
}

function eligible(source: ConnectedSource, projectId: string, now: number, attempts: Map<string, number>): boolean {
  if (!['github', 'google_drive', 'slack'].includes(source.provider)
    || source.status !== 'active' || source.syncStatus === 'syncing') return false;
  const run = source.latestSyncRun;
  if (run && (run.status === 'queued' || run.status === 'running')) return false;
  // A clean partial run is already handed to the durable source worker. Slack
  // keeps its historical explicit continuation path for a saved page cursor.
  if (run?.status === 'partial' && !run.errorCode && !run.retryable
    && !(source.provider === 'slack' && hasProviderCursor(source))) return false;
  if (run?.nextAttemptAt && Date.parse(run.nextAttemptAt) > now) return false;
  return now - lastAttemptAt(projectId, source, attempts) >= CONNECTED_SOURCE_RECONCILIATION_INTERVAL_MS;
}

/**
 * Run an authenticated, bounded batch of incremental checks. Projects rotate
 * between passes and candidates rotate by oldest attempt, so large workspaces
 * keep making progress without one project monopolizing the scheduler. Local
 * imports never enter this provider path.
 */
export async function reconcileOneDueConnectedSource(
  projectIds: string[],
  startProjectIndex: number,
  api: Omit<ConnectedSourceReconciliationApi, 'projects'>,
  now: number,
  attempts: Map<string, number>,
  isActive: () => boolean = () => true,
): Promise<ReconciliationResult> {
  if (!projectIds.length) return { nextProjectIndex: 0, attempted: false };
  let nextProjectIndex = ((startProjectIndex % projectIds.length) + projectIds.length) % projectIds.length;
  const projectBudget = Math.min(projectIds.length, MAX_PROJECTS_PER_PASS);
  const candidates: Array<{ projectId: string; source: ConnectedSource }> = [];

  for (let checked = 0; checked < projectBudget && isActive(); checked += 1) {
    const projectId = projectIds[nextProjectIndex];
    nextProjectIndex = (nextProjectIndex + 1) % projectIds.length;
    let sources: ConnectedSource[];
    try {
      // Authenticated source listing also lets the sidecar recover durable
      // jobs before this scheduler considers starting another run.
      sources = await api.listConnectedSources(projectId);
    } catch {
      continue;
    }
    if (!isActive()) break;
    candidates.push(...sources.filter(item => eligible(item, projectId, now, attempts)).map(source => ({ projectId, source })));
  }

  candidates.sort((left, right) => lastAttemptAt(left.projectId, left.source, attempts) - lastAttemptAt(right.projectId, right.source, attempts)
    || left.projectId.localeCompare(right.projectId) || left.source.id.localeCompare(right.source.id));
  let attempted = false;
  for (const candidate of candidates.slice(0, MAX_SOURCES_PER_PASS)) {
    if (!isActive()) break;
    const { projectId, source } = candidate;
    attempts.set(`${projectId}:${source.id}`, now);
    attempted = true;
    const maxPages = MAX_PAGES[source.provider];
    const run = source.latestSyncRun;
    const slackPartial = source.provider === 'slack' && hasProviderCursor(source) && run?.status === 'partial';
    try {
      const latestRuns = slackPartial && run && api.getConnectedSourceSyncHistory
        ? await api.getConnectedSourceSyncHistory(projectId, source.id)
        : [];
      if (!isActive()) break;
      if (slackPartial && run && latestRuns[0]?.id === run.id && api.resumeConnectedSourceSync) {
        await api.resumeConnectedSourceSync(projectId, source.id, run.id, { maxPages });
      } else {
        await api.syncConnectedSource(projectId, source.id, {
          maxPages,
          idempotencyKey: `source-periodic:${source.provider}:${source.id}:${Math.floor(now / CONNECTED_SOURCE_RECONCILIATION_INTERVAL_MS)}`,
        });
      }
    } catch {
      // The authenticated importer records retry timing and safe source errors.
    }
    // Continue serially. Each source is independently throttled, and durable
    // provider failures do not prevent later connected sources from a turn.
  }
  return { nextProjectIndex, attempted };
}

/** Starts only while the signed-in workspace is mounted. Focus requests a pass
 * for prompt recovery, while the per-source 60-second floor still applies. */
export function startConnectedSourceReconciliation(api: ConnectedSourceReconciliationApi): () => void {
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
      const result = await reconcileOneDueConnectedSource(projectIds, nextProjectIndex, api, Date.now(), attempts, () => active);
      nextProjectIndex = result.nextProjectIndex;
    } catch {
      // Auth and transport recovery remain visible through the workspace.
    } finally {
      inFlight = false;
    }
  };
  const firstPass = window.setTimeout(() => { void reconcile(); }, CONNECTED_SOURCE_RECONCILIATION_START_DELAY_MS);
  const timer = window.setInterval(() => { void reconcile(); }, CONNECTED_SOURCE_RECONCILIATION_INTERVAL_MS);
  window.addEventListener('focus', reconcile);
  return () => {
    active = false;
    window.clearTimeout(firstPass);
    window.clearInterval(timer);
    window.removeEventListener('focus', reconcile);
  };
}
