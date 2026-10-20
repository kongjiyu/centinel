import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../src/auth/gateway.js';
import { handleProjectReadinessRoute } from '../../src/readiness/routes.js';
import type { ProjectReadinessCoordinator } from '../../src/readiness/service.js';
import type { ReadinessStatus } from '../../src/readiness/types.js';

const auth = { userId: 'member-1', accessToken: 'signed-session' } as AuthenticatedRequest;

function status(projectId = 'project-1'): ReadinessStatus {
  return {
    projectId,
    requestId: null,
    status: 'idle',
    trigger: null,
    requestedAt: null,
    startedAt: null,
    completedAt: null,
    error: null,
    snapshot: null,
    stale: false,
  };
}

function request(method: string, pathname = '/projects/project-1/readiness') {
  return { method, pathname, auth };
}

describe('project readiness routes', () => {
  it('checks project membership before reading or queuing readiness', async () => {
    const order: string[] = [];
    const coordinator = {
      status: vi.fn(async () => { order.push('status'); return status(); }),
      request: vi.fn(async () => { order.push('request'); return status(); }),
    } as unknown as ProjectReadinessCoordinator;
    const requireMember = vi.fn(async (_requestAuth: AuthenticatedRequest, _projectId: string) => { order.push('member'); });
    const recoverSources = vi.fn(async (_requestAuth: AuthenticatedRequest, _projectId: string) => { order.push('recover'); });

    const get = await handleProjectReadinessRoute(request('GET'), { coordinator, requireMember, recoverSources });
    const post = await handleProjectReadinessRoute(request('POST'), { coordinator, requireMember, recoverSources });

    expect(get).toEqual({ status: 200, body: status() });
    expect(post).toEqual({ status: 202, body: status() });
    expect(order).toEqual(['member', 'recover', 'status', 'member', 'recover', 'request']);
    expect(requireMember).toHaveBeenCalledWith(auth, 'project-1');
    expect(recoverSources).toHaveBeenCalledTimes(2);
    expect(coordinator.request).toHaveBeenCalledWith(auth, 'project-1', 'manual', true);
  });

  it('returns 405 after membership verification for unsupported methods', async () => {
    const coordinator = { status: vi.fn(), request: vi.fn() } as unknown as ProjectReadinessCoordinator;
    const requireMember = vi.fn(async () => undefined);
    const recoverSources = vi.fn(async () => undefined);

    const result = await handleProjectReadinessRoute(request('PATCH'), { coordinator, requireMember, recoverSources });

    expect(result).toEqual({ status: 405, body: { error: 'Use GET or POST for project readiness.' } });
    expect(requireMember).toHaveBeenCalledOnce();
    expect(recoverSources).not.toHaveBeenCalled();
    expect(coordinator.status).not.toHaveBeenCalled();
    expect(coordinator.request).not.toHaveBeenCalled();
  });

  it('never recovers source syncs when membership is denied', async () => {
    const denied = new Error('member access denied');
    const coordinator = { status: vi.fn(), request: vi.fn() } as unknown as ProjectReadinessCoordinator;
    const requireMember = vi.fn(async () => { throw denied; });
    const recoverSources = vi.fn(async () => undefined);

    await expect(handleProjectReadinessRoute(request('GET'), { coordinator, requireMember, recoverSources })).rejects.toBe(denied);

    expect(recoverSources).not.toHaveBeenCalled();
    expect(coordinator.status).not.toHaveBeenCalled();
    expect(coordinator.request).not.toHaveBeenCalled();
  });

  it('returns a safe 503 when coordinator or model work fails', async () => {
    const coordinator = {
      status: vi.fn(async () => { throw new Error('secret prompt and provider details'); }),
      request: vi.fn(async () => { throw new Error('raw storage failure details'); }),
    } as unknown as ProjectReadinessCoordinator;
    const requireMember = vi.fn(async () => undefined);

    const get = await handleProjectReadinessRoute(request('GET'), { coordinator, requireMember });
    const post = await handleProjectReadinessRoute(request('POST'), { coordinator, requireMember });
    const safeBody = { error: 'Readiness is unavailable. Check your connection and source access, then try again.' };

    expect(get).toEqual({ status: 503, body: safeBody });
    expect(post).toEqual({ status: 503, body: safeBody });
    expect(JSON.stringify([get, post])).not.toContain('secret prompt');
    expect(JSON.stringify([get, post])).not.toContain('raw storage failure');
  });

  it('returns null for paths outside the readiness endpoint', async () => {
    const coordinator = { status: vi.fn(), request: vi.fn() } as unknown as ProjectReadinessCoordinator;
    const requireMember = vi.fn(async () => undefined);

    const result = await handleProjectReadinessRoute(request('GET', '/projects/project-1/readiness/extra'), { coordinator, requireMember });

    expect(result).toBeNull();
    expect(requireMember).not.toHaveBeenCalled();
    expect(coordinator.status).not.toHaveBeenCalled();
  });
});
