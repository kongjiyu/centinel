import type { AuthenticatedRequest } from '../auth/gateway.js';
import type { ProjectReadinessCoordinator } from './service.js';

export async function handleProjectReadinessRoute(request: { method: string; pathname: string; auth: AuthenticatedRequest }, deps: {
  requireMember(auth: AuthenticatedRequest, projectId: string): Promise<void>; coordinator: ProjectReadinessCoordinator;
  recoverSources?(auth: AuthenticatedRequest, projectId: string): Promise<void>;
}): Promise<{ status: number; body: unknown } | null> {
  const match = request.pathname.match(/^\/projects\/([^/]+)\/readiness$/);
  if (!match) return null;
  const projectId = match[1];
  await deps.requireMember(request.auth, projectId);
  if (request.method !== 'GET' && request.method !== 'POST') return { status: 405, body: { error: 'Use GET or POST for project readiness.' } };
  try {
    await deps.recoverSources?.(request.auth, projectId);
    const body = request.method === 'POST'
      ? await deps.coordinator.request(request.auth, projectId, 'manual', true)
      : await deps.coordinator.status(request.auth, projectId);
    return { status: request.method === 'POST' ? 202 : 200, body };
  } catch {
    return { status: 503, body: { error: 'Readiness is unavailable. Check your connection and source access, then try again.' } };
  }
}
