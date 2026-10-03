import type { SupabaseClient, User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../src/auth/gateway.js';
import { AuthGatewayError } from '../../src/auth/gateway.js';
import {
  handleConnectedSourceRoute,
  type ConnectedSourceRouteImporter,
} from '../../src/integrations/routes.js';

function authenticatedRequest(): AuthenticatedRequest {
  return {
    userId: 'canonical-user',
    accessToken: 'signed-bearer-token',
    client: {} as SupabaseClient,
    user: { id: 'canonical-user' } as User,
    suppliedUserId: 'untrusted-renderer-user',
  };
}

function routeRequest(method: string, path: string, body: Record<string, unknown> = {}) {
  return {
    method,
    url: new URL(path, 'http://localhost'),
    auth: authenticatedRequest(),
    readBody: async () => body,
  };
}

describe('connected-source API routes', () => {
  it('lists project sources only after the bearer-authenticated member check', async () => {
    const sources = [{ id: 'source-1', projectId: 'project-7', provider: 'github' }];
    const importer = { listSources: vi.fn(async () => sources) } as unknown as ConnectedSourceRouteImporter;
    const createImporter = vi.fn(() => importer);
    const requireProjectMember = vi.fn(async () => undefined);

    const result = await handleConnectedSourceRoute(
      routeRequest('GET', '/projects/project-7/sources'),
      { createImporter, requireProjectMember },
    );

    expect(requireProjectMember).toHaveBeenCalledWith(expect.objectContaining({ userId: 'canonical-user' }), 'project-7');
    expect(createImporter).toHaveBeenCalledOnce();
    expect(importer.listSources).toHaveBeenCalledWith('project-7');
    expect(result).toEqual({ statusCode: 200, body: sources });
  });

  it('returns provider status for a member-scoped project and forwards browse filters', async () => {
    const status = { provider: 'github', connected: true, sources: [] };
    const browse = { items: [{ id: 'octo/centinel', name: 'centinel', kind: 'repository' }], nextCursor: 'page-2' };
    const importer = {
      status: vi.fn(async () => status),
      browse: vi.fn(async () => browse),
    } as unknown as ConnectedSourceRouteImporter;
    const requireProjectMember = vi.fn(async () => undefined);
    const dependencies = { createImporter: vi.fn(() => importer), requireProjectMember };

    const statusResult = await handleConnectedSourceRoute(
      routeRequest('GET', '/integrations/github/source-status?projectId=project-7'),
      dependencies,
    );
    const browseResult = await handleConnectedSourceRoute(
      routeRequest('GET', '/integrations/github/browse?remoteId=octo%2Fcentinel&cursor=page-1&pageSize=25&query=centinel'),
      dependencies,
    );

    expect(statusResult).toEqual({ statusCode: 200, body: status });
    expect(requireProjectMember).toHaveBeenCalledWith(expect.objectContaining({ userId: 'canonical-user' }), 'project-7');
    expect(importer.status).toHaveBeenCalledWith('canonical-user', 'github', 'project-7');
    expect(browseResult).toEqual({ statusCode: 200, body: browse });
    expect(importer.browse).toHaveBeenCalledWith('canonical-user', 'github', {
      remoteId: 'octo/centinel', cursor: 'page-1', pageSize: 25, query: 'centinel',
    });
  });

  it('imports a project source using the canonical bearer identity after membership is verified', async () => {
    const imported = { source: { id: 'source-1', projectId: 'project-7' }, syncResult: null };
    const importer = { importSource: vi.fn(async () => imported) } as unknown as ConnectedSourceRouteImporter;
    const dependencies = {
      createImporter: vi.fn(() => importer),
      requireProjectMember: vi.fn(async () => undefined),
    };

    const result = await handleConnectedSourceRoute(
      routeRequest('POST', '/projects/project-7/sources', {
        provider: 'github', kind: 'github_repository', remoteId: 'octo/centinel', name: 'centinel', sync: false,
      }),
      dependencies,
    );

    expect(result).toEqual({ statusCode: 201, body: imported });
    expect(importer.importSource).toHaveBeenCalledWith({
      ownerId: 'canonical-user', projectId: 'project-7', provider: 'github', kind: 'github_repository',
      remoteId: 'octo/centinel', name: 'centinel', remoteUrl: null, selectedScope: undefined, sync: false, idempotencyKey: undefined,
    });
  });

  it('exposes source sync, retry, history, source disconnect, and provider disconnect routes', async () => {
    const syncResult = { source: { id: 'source-1' }, run: { id: 'run-1' }, complete: true, imported: 1, updated: 0, unchanged: 0, removed: 0, inaccessible: 0 };
    const history = [{ id: 'run-1', status: 'success' }];
    const importer = {
      sync: vi.fn(async () => syncResult),
      resumeSync: vi.fn(async () => syncResult),
      syncHistory: vi.fn(async () => history),
      disconnectSource: vi.fn(async () => ({ id: 'source-1', status: 'disconnected' })),
      disconnect: vi.fn(async () => ({ disconnected: true, revokeAttempted: true, revoked: true })),
    } as unknown as ConnectedSourceRouteImporter;
    const dependencies = {
      createImporter: vi.fn(() => importer),
      requireProjectMember: vi.fn(async () => undefined),
    };

    const sync = await handleConnectedSourceRoute(routeRequest('POST', '/projects/project-7/sources/source-1/sync', {
      idempotencyKey: 'sync-1', force: true, maxPages: 12,
    }), dependencies);
    const resume = await handleConnectedSourceRoute(routeRequest('POST', '/projects/project-7/sources/source-1/sync-runs/run-1/resume', {
      maxPages: 5,
    }), dependencies);
    const runs = await handleConnectedSourceRoute(routeRequest('GET', '/projects/project-7/sources/source-1/sync-history'), dependencies);
    const sourceDisconnect = await handleConnectedSourceRoute(routeRequest('DELETE', '/projects/project-7/sources/source-1'), dependencies);
    const providerDisconnect = await handleConnectedSourceRoute(routeRequest('DELETE', '/integrations/slack'), dependencies);

    expect(sync).toEqual({ statusCode: 200, body: syncResult });
    expect(importer.sync).toHaveBeenCalledWith({
      ownerId: 'canonical-user', projectId: 'project-7', sourceId: 'source-1', idempotencyKey: 'sync-1', force: true, maxPages: 12,
    });
    expect(importer.resumeSync).toHaveBeenCalledWith({
      ownerId: 'canonical-user', projectId: 'project-7', sourceId: 'source-1', runId: 'run-1', force: undefined, maxPages: 5,
    });
    expect(runs).toEqual({ statusCode: 200, body: history });
    expect(sourceDisconnect).toEqual({ statusCode: 200, body: { id: 'source-1', status: 'disconnected' } });
    expect(providerDisconnect).toEqual({ statusCode: 200, body: { disconnected: true, revokeAttempted: true, revoked: true } });
    expect(importer.syncHistory).toHaveBeenCalledWith('project-7', 'source-1');
    expect(importer.disconnectSource).toHaveBeenCalledWith('project-7', 'source-1');
    expect(importer.disconnect).toHaveBeenCalledWith('canonical-user', 'slack');
  });

  it('does not create an importer when project membership is denied', async () => {
    const createImporter = vi.fn(() => ({} as ConnectedSourceRouteImporter));
    const denied = new AuthGatewayError('You do not have access to this project.', 403, 'forbidden');

    await expect(handleConnectedSourceRoute(routeRequest('GET', '/projects/private-project/sources'), {
      createImporter,
      requireProjectMember: async () => { throw denied; },
    })).rejects.toBe(denied);

    expect(createImporter).not.toHaveBeenCalled();
  });
});
