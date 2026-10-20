import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthHeaders, AuthGateway as AuthGatewayType, AuthenticatedRequest } from '../../src/auth/gateway.js';
import { AuthGatewayError } from '../../src/auth/gateway.js';
import { createSidecarServer } from '../../src/index.js';
import { emptyReadiness, type ProjectReadinessCoordinator } from '../../src/readiness/service.js';
import type { ReadinessAssessment, ReadinessStatus } from '../../src/readiness/types.js';

const projectA = 'project-a';
const projectB = 'project-b';
const privateProject = 'private-project';
const failureProject = 'failure-project';

function savedStatus(projectId: string, snapshotId: string): ReadinessStatus {
  const snapshot: ReadinessAssessment = {
    id: snapshotId,
    projectId,
    sourceFingerprint: `fingerprint-${projectId}`,
    assessedAt: '2026-10-19T00:00:00.000Z',
    categories: [],
    findings: [],
  };
  return {
    ...emptyReadiness(projectId),
    requestId: `saved-${projectId}`,
    status: 'completed',
    trigger: 'manual',
    requestedAt: '2026-10-19T00:00:00.000Z',
    startedAt: '2026-10-19T00:00:01.000Z',
    completedAt: '2026-10-19T00:00:02.000Z',
    snapshot,
    stale: false,
  };
}

describe('project readiness HTTP routes', () => {
  let server: Server;
  let baseUrl: string;
  let authGateway: AuthGatewayType;
  let coordinator: ProjectReadinessCoordinator;
  let coordinatorMocks: {
    adoptSession: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let events: string[];
  let sessions: Map<string, AuthenticatedRequest>;
  let statuses: Map<string, ReadinessStatus>;
  let failingProject: string | null;

  beforeEach(async () => {
    events = [];
    sessions = new Map();
    statuses = new Map([
      [projectA, savedStatus(projectA, 'snapshot-a')],
      [projectB, savedStatus(projectB, 'snapshot-b')],
      [failureProject, savedStatus(failureProject, 'snapshot-before-error')],
    ]);
    failingProject = null;

    const identities = new Map<string, string>([
      ['owner-token', 'owner-1'],
      ['owner-refreshed-token', 'owner-1'],
      ['outsider-token', 'outsider-1'],
    ]);
    const memberships = new Map<string, Set<string>>([
      ['owner-1', new Set([projectA, projectB, failureProject])],
      ['outsider-1', new Set()],
    ]);
    const gatewayDouble = {
      authenticate: vi.fn(async (headers: AuthHeaders) => {
        const authorization = headers.authorization;
        const match = typeof authorization === 'string' ? authorization.match(/^Bearer\s+([^\s]+)$/i) : null;
        const token = match?.[1] ?? '';
        const userId = identities.get(token);
        if (!userId) throw new AuthGatewayError('Your session is missing or expired. Sign in again.', 401, 'unauthenticated');
        return {
          userId,
          accessToken: token,
          client: {} as AuthenticatedRequest['client'],
          user: { id: userId } as AuthenticatedRequest['user'],
          suppliedUserId: null,
        } satisfies AuthenticatedRequest;
      }),
      requireProjectMember: vi.fn(async (auth: AuthenticatedRequest, projectId: string) => {
        events.push(`member:${auth.userId}:${projectId}`);
        if (!memberships.get(auth.userId)?.has(projectId)) {
          throw new AuthGatewayError('You do not have access to this project.', 403, 'forbidden');
        }
      }),
    };
    authGateway = gatewayDouble as unknown as AuthGatewayType;

    coordinatorMocks = {
      adoptSession: vi.fn((auth: AuthenticatedRequest) => {
        sessions.set(auth.userId, auth);
        events.push(`adopt:${auth.userId}:${auth.accessToken}`);
      }),
      status: vi.fn(async (auth: AuthenticatedRequest, projectId: string) => {
        events.push(`status:${auth.userId}:${auth.accessToken}:${projectId}`);
        if (failingProject === projectId) throw new Error('Private provider prompt and storage details.');
        return statuses.get(projectId) ?? emptyReadiness(projectId);
      }),
      request: vi.fn(async (auth: AuthenticatedRequest, projectId: string, trigger: string, force: boolean) => {
        events.push(`request:${auth.userId}:${auth.accessToken}:${projectId}`);
        if (failingProject === projectId) throw new Error('Raw provider exception with a secret.');
        const queued: ReadinessStatus = {
          ...emptyReadiness(projectId),
          requestId: `queued-${projectId}`,
          status: 'queued',
          trigger,
          requestedAt: '2026-10-19T01:00:00.000Z',
          snapshot: statuses.get(projectId)?.snapshot ?? null,
          stale: force,
        };
        statuses.set(projectId, queued);
        return queued;
      }),
      close: vi.fn(),
    };
    coordinator = coordinatorMocks as unknown as ProjectReadinessCoordinator;
    server = createSidecarServer(authGateway, { readinessCoordinator: coordinator });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  async function call(path: string, options: { method?: string; token?: string } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  it('returns 401 without a validated bearer identity', async () => {
    expect(await call(`/projects/${projectA}/readiness`)).toMatchObject({ status: 401, body: { code: 'unauthenticated' } });
    expect(coordinatorMocks.status).not.toHaveBeenCalled();
    expect(coordinatorMocks.request).not.toHaveBeenCalled();
  });

  it('returns 403 for a nonmember before reading or starting readiness', async () => {
    const result = await call(`/projects/${privateProject}/readiness`, { token: 'outsider-token' });

    expect(result).toMatchObject({ status: 403, body: { code: 'forbidden' } });
    expect(events).toEqual(['adopt:outsider-1:outsider-token', `member:outsider-1:${privateProject}`]);
    expect(coordinatorMocks.status).not.toHaveBeenCalled();
    expect(coordinatorMocks.request).not.toHaveBeenCalled();
  });

  it('serves owner GET state and queues owner POST with manual force', async () => {
    const get = await call(`/projects/${projectA}/readiness`, { token: 'owner-token' });
    const post = await call(`/projects/${projectA}/readiness`, { method: 'POST', token: 'owner-token' });

    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({ status: 'completed', projectId: projectA, snapshot: { id: 'snapshot-a', projectId: projectA } });
    expect(post.status).toBe(202);
    expect(post.body).toMatchObject({ status: 'queued', projectId: projectA, requestId: `queued-${projectA}`, trigger: 'manual' });
    expect(coordinatorMocks.status).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner-1' }), projectA);
    expect(coordinatorMocks.request).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner-1' }), projectA, 'manual', true);
  });

  it('keeps two project snapshots isolated and adopts each newly validated bearer session', async () => {
    const first = await call(`/projects/${projectA}/readiness`, { token: 'owner-token' });
    const second = await call(`/projects/${projectB}/readiness`, { token: 'owner-refreshed-token' });

    expect(first.body).toMatchObject({ projectId: projectA, snapshot: { id: 'snapshot-a', projectId: projectA } });
    expect(second.body).toMatchObject({ projectId: projectB, snapshot: { id: 'snapshot-b', projectId: projectB } });
    expect(coordinatorMocks.adoptSession.mock.calls.map(call => call[0].accessToken)).toEqual(['owner-token', 'owner-refreshed-token']);
    expect(coordinatorMocks.status.mock.calls.map(call => [call[0].accessToken, call[1]])).toEqual([
      ['owner-token', projectA],
      ['owner-refreshed-token', projectB],
    ]);
    expect(sessions.get('owner-1')?.accessToken).toBe('owner-refreshed-token');
  });

  it('returns a safe 503 for coordinator failures without exposing provider or storage details', async () => {
    failingProject = failureProject;
    const get = await call(`/projects/${failureProject}/readiness`, { token: 'owner-token' });
    const post = await call(`/projects/${failureProject}/readiness`, { method: 'POST', token: 'owner-token' });
    const expectedBody = { error: 'Readiness is unavailable. Check your connection and source access, then try again.' };

    expect(get).toEqual({ status: 503, body: expectedBody });
    expect(post).toEqual({ status: 503, body: expectedBody });
    expect(JSON.stringify([get, post])).not.toContain('provider prompt');
    expect(JSON.stringify([get, post])).not.toContain('secret');
  });
});
