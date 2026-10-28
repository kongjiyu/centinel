export const REPOSITORY_INDEX_SYNC_INTERVAL_MS = 5 * 60_000;
const MAX_PROJECTS_PER_PASS = 20;
type SyncApi = { syncRepositoryIndex(projectId: string, signal?: AbortSignal): Promise<unknown> };

/** Runs after projects are available, without delaying their initial render.
 * The server compares current versions/settings and only prefetches archives. */
export function startRepositoryIndexSync(api: SyncApi, getProjectIds: () => string[]): () => void {
  const controller = new AbortController();
  let running = false;
  let nextIndex = 0;
  let lastPassAt = -Infinity;
  const reconcile = async () => {
    if (controller.signal.aborted || running || Date.now() - lastPassAt < REPOSITORY_INDEX_SYNC_INTERVAL_MS) return;
    const projectIds = [...new Set(getProjectIds())];
    if (!projectIds.length) return;
    lastPassAt = Date.now();
    running = true;
    const selected: string[] = [];
    for (let count = 0; count < Math.min(projectIds.length, MAX_PROJECTS_PER_PASS); count++) {
      selected.push(projectIds[nextIndex % projectIds.length]);
      nextIndex++;
    }
    let cursor = 0;
    const worker = async () => {
      while (!controller.signal.aborted && cursor < selected.length) {
        const projectId = selected[cursor++];
        // A POST download can outlast the ordinary 30-second GET deadline, but
        // is bounded and cancelled on signout/account switch on this device.
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(65_000)]);
        try { await api.syncRepositoryIndex(projectId, signal); }
        catch { /* Explicit Review reports indexing errors; later passes retry sync. */ }
      }
    };
    try { await Promise.all([worker(), worker()]); }
    finally { running = false; }
  };
  const first = window.setTimeout(() => { void reconcile(); }, 5_000);
  const timer = window.setInterval(() => { void reconcile(); }, 30_000);
  window.addEventListener('focus', reconcile);
  return () => {
    controller.abort();
    window.clearTimeout(first);
    window.clearInterval(timer);
    window.removeEventListener('focus', reconcile);
  };
}
