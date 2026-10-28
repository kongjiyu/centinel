import type { Artifact } from '../artifacts.js';
import type { AuthenticatedRequest } from '../auth/index.js';
import type { RepositoryIndexIdentity } from './repositoryIndexSnapshot.js';
import type { RepositoryIndexSyncResult } from './repositoryIndexSync.js';

type Dependencies = {
  requireMember(auth: AuthenticatedRequest, projectId: string): Promise<unknown>;
  listArtifacts(auth: AuthenticatedRequest, projectId: string, signal: AbortSignal): Promise<Artifact[]>;
  describe(auth: AuthenticatedRequest, projectId: string, artifacts: Artifact[], signal: AbortSignal): Promise<RepositoryIndexIdentity>;
  inspect(auth: AuthenticatedRequest, projectId: string, identity: RepositoryIndexIdentity, signal: AbortSignal): Promise<RepositoryIndexSyncResult>;
  sync(auth: AuthenticatedRequest, projectId: string, identity: RepositoryIndexIdentity, signal: AbortSignal): Promise<RepositoryIndexSyncResult>;
};

/** Background sync only transfers compatible completed indexes. This route has
 * no indexing/provider seam: a missing index waits for an explicit Review. */
export async function handleRepositoryIndexSyncRoute(request: { method: string; pathname: string; auth: AuthenticatedRequest; signal?: AbortSignal },
  deps: Dependencies): Promise<{ status: number; body: unknown } | null> {
  const match = request.pathname.match(/^\/projects\/([^/]+)\/repository-index\/sync$/);
  if (!match || !['GET', 'POST'].includes(request.method)) return null;
  const projectId = match[1];
  const deadline = AbortSignal.timeout(request.method === 'GET' ? 30_000 : 60_000);
  const signal = request.signal ? AbortSignal.any([request.signal, deadline]) : deadline;
  signal.throwIfAborted();
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const operation = async () => {
    await deps.requireMember(request.auth, projectId);
    signal.throwIfAborted();
    const artifacts = await deps.listArtifacts(request.auth, projectId, signal);
    signal.throwIfAborted();
    if (!artifacts.length) return { status: 200, body: { state: 'none' } };
    const identity = await deps.describe(request.auth, projectId, artifacts, signal);
    signal.throwIfAborted();
    const body = await (request.method === 'GET' ? deps.inspect : deps.sync)(request.auth, projectId, identity, signal);
    signal.throwIfAborted();
    return { status: 200, body };
  };
  // Bound the response even if a dependency does not honor AbortSignal. Late
  // completion cannot start the next operation or activate an expired result.
  try { return await Promise.race([operation(), aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}
