import { describe, expect, it, vi } from 'vitest';
import { handleRepositoryIndexSyncRoute } from '../../src/review/repositoryIndexSyncRoutes.js';
import type { AuthenticatedRequest } from '../../src/auth/index.js';
import type { RepositoryIndexIdentity } from '../../src/review/repositoryIndexSnapshot.js';

const auth = { userId: 'owner' } as AuthenticatedRequest;
const identity = { fingerprint: 'current-hash' } as RepositoryIndexIdentity;
function dependencies() {
  return { requireMember: vi.fn(async () => undefined), listArtifacts: vi.fn(async () => [{ id: 'doc' }] as any),
    describe: vi.fn(async () => identity), inspect: vi.fn(async () => ({ state: 'available' as const })),
    sync: vi.fn(async () => ({ state: 'prefetched' as const, fingerprint: identity.fingerprint })) };
}
describe('repository index sync HTTP contract', () => {
  it('returns promptly on cancellation even when a metadata dependency ignores abort', async () => {
    const deps = dependencies(); const controller = new AbortController();
    let release!: () => void;
    deps.requireMember.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const pending = handleRepositoryIndexSyncRoute({ auth, method: 'POST', pathname: '/projects/p/repository-index/sync', signal: controller.signal }, deps);
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
    release(); await Promise.resolve();
    expect(deps.listArtifacts).not.toHaveBeenCalled();
    expect(deps.sync).not.toHaveBeenCalled();
  });
  it('authorizes before metadata reads and never downloads on GET', async () => {
    const deps = dependencies();
    expect(await handleRepositoryIndexSyncRoute({ auth, method: 'GET', pathname: '/projects/p/repository-index/sync' }, deps))
      .toEqual({ status: 200, body: { state: 'available' } });
    expect(deps.requireMember).toHaveBeenCalledWith(auth, 'p');
    expect(deps.requireMember.mock.invocationCallOrder[0]).toBeLessThan(deps.listArtifacts.mock.invocationCallOrder[0]);
    expect(deps.inspect).toHaveBeenCalledWith(auth, 'p', identity, expect.any(AbortSignal));
    expect(deps.sync).not.toHaveBeenCalled();
  });
  it('prefetches only the identity derived from current metadata on POST', async () => {
    const deps = dependencies();
    await handleRepositoryIndexSyncRoute({ auth, method: 'POST', pathname: '/projects/p/repository-index/sync' }, deps);
    expect(deps.describe).toHaveBeenCalledWith(auth, 'p', [{ id: 'doc' }], expect.any(AbortSignal));
    expect(deps.sync).toHaveBeenCalledWith(auth, 'p', identity, expect.any(AbortSignal));
    expect(deps.inspect).not.toHaveBeenCalled();
  });
  it('does not read another project after membership denial', async () => {
    const deps = dependencies();
    deps.requireMember.mockRejectedValue(new Error('forbidden'));
    await expect(handleRepositoryIndexSyncRoute({ auth, method: 'POST', pathname: '/projects/other/repository-index/sync' }, deps)).rejects.toThrow('forbidden');
    expect(deps.listArtifacts).not.toHaveBeenCalled();
    expect(deps.sync).not.toHaveBeenCalled();
  });
  it('does no configuration or archive work for empty projects or unrelated routes', async () => {
    const deps = dependencies(); deps.listArtifacts.mockResolvedValue([]);
    expect(await handleRepositoryIndexSyncRoute({ auth, method: 'POST', pathname: '/projects/p/repository-index/sync' }, deps)).toMatchObject({ body: { state: 'none' } });
    expect(deps.describe).not.toHaveBeenCalled();
    expect(await handleRepositoryIndexSyncRoute({ auth, method: 'DELETE', pathname: '/projects/p/repository-index/sync' }, deps)).toBeNull();
    expect(await handleRepositoryIndexSyncRoute({ auth, method: 'GET', pathname: '/projects/p' }, deps)).toBeNull();
  });
});
