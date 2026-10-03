import type { AuthenticatedRequest } from '../auth/gateway.js';
import { normalizeProvider } from '../integrations.js';
import { AuthGatewayError } from '../auth/gateway.js';
import { ConnectedSourceHttpError } from './http.js';
import { ConnectedSourceImporterError, type ConnectedSourceImporter } from './connectedSourceImporter.js';

export type ConnectedSourceRouteImporter = Pick<ConnectedSourceImporter,
  'status' | 'browse' | 'listSources' | 'importSource' | 'sync' | 'resumeSync' | 'syncHistory' | 'disconnect' | 'disconnectSource'
>;

export type ConnectedSourceRouteRequest = {
  method: string;
  url: URL;
  auth: AuthenticatedRequest;
  readBody: () => Promise<Record<string, unknown>>;
};

export type ConnectedSourceRouteResponse = { statusCode: number; body: unknown };

type ParsedBody = { ok: true; body: Record<string, unknown> } | { ok: false; response: ConnectedSourceRouteResponse };

export type ConnectedSourceRouteDependencies = {
  createImporter: (auth: AuthenticatedRequest) => ConnectedSourceRouteImporter;
  requireProjectMember: (auth: AuthenticatedRequest, projectId: string) => Promise<void>;
};

const sourceKinds = new Set(['github_repository', 'google_drive', 'slack_channel']);

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parsePositiveInteger(value: string | null, maximum: number): number | undefined | null {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

function errorResponse(cause: ConnectedSourceImporterError | ConnectedSourceHttpError): ConnectedSourceRouteResponse {
  const code = cause.code;
  const statusCode = cause.statusCode && cause.statusCode >= 400 && cause.statusCode <= 599
    ? cause.statusCode
    : code === 'source_not_found' || code === 'sync_run_not_found'
      ? 404
      : code === 'invalid_provider' || code === 'provider_not_supported' || code === 'invalid_source' || code === 'invalid_source_kind'
        ? 400
        : code === 'integration_disconnected' || code === 'source_disconnected' || code === 'token_expired' || code === 'invalid_credentials'
          ? 409
          : 502;
  return { statusCode, body: { error: cause.message, code, retryable: cause.retryable } };
}

function badRequest(message: string, code = 'invalid_request'): ConnectedSourceRouteResponse {
  return { statusCode: 400, body: { error: message, code } };
}

async function readRequestBody(request: ConnectedSourceRouteRequest): Promise<ParsedBody> {
  try {
    const body = await request.readBody();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, response: badRequest('A JSON object body is required.', 'invalid_json') };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, response: badRequest('The request body must contain valid JSON.', 'invalid_json') };
  }
}

function isRouteError(cause: unknown): cause is ConnectedSourceImporterError | ConnectedSourceHttpError {
  return cause instanceof ConnectedSourceImporterError || cause instanceof ConnectedSourceHttpError;
}

/**
 * Dispatch the connected-source HTTP surface after the global bearer gateway
 * has authenticated the request. Project-scoped routes check membership
 * before accessing the importer; the importer receives the same RLS client
 * through the route dependency factory.
 */
export async function handleConnectedSourceRoute(
  request: ConnectedSourceRouteRequest,
  dependencies: ConnectedSourceRouteDependencies,
): Promise<ConnectedSourceRouteResponse | null> {
  const { method, url, auth } = request;
  const pathname = url.pathname;

  try {
    const sourceStatusMatch = pathname.match(/^\/integrations\/([^/]+)\/source-status$/);
    if (sourceStatusMatch && method === 'GET') {
      const provider = normalizeProvider(sourceStatusMatch[1]);
      if (!provider) return { statusCode: 404, body: { error: 'Unsupported integration provider', code: 'provider_not_supported' } };
      const projectId = url.searchParams.get('projectId') || undefined;
      if (projectId) await dependencies.requireProjectMember(auth, projectId);
      return { statusCode: 200, body: await dependencies.createImporter(auth).status(auth.userId, provider, projectId) };
    }

    const browseMatch = pathname.match(/^\/integrations\/([^/]+)\/browse$/);
    if (browseMatch && method === 'GET') {
      const provider = normalizeProvider(browseMatch[1]);
      if (!provider) return { statusCode: 404, body: { error: 'Unsupported integration provider', code: 'provider_not_supported' } };
      const pageSize = parsePositiveInteger(url.searchParams.get('pageSize'), 100);
      if (pageSize === null) return badRequest('pageSize must be an integer from 1 to 100.');
      const remoteId = url.searchParams.get('remoteId') ?? undefined;
      const cursor = url.searchParams.has('cursor') ? url.searchParams.get('cursor') : undefined;
      const query = url.searchParams.get('query') ?? undefined;
      return {
        statusCode: 200,
        body: await dependencies.createImporter(auth).browse(auth.userId, provider, { remoteId, cursor, query, pageSize }),
      };
    }

    const integrationMatch = pathname.match(/^\/integrations\/([^/]+)$/);
    if (integrationMatch && method === 'DELETE') {
      const provider = normalizeProvider(integrationMatch[1]);
      if (!provider) return { statusCode: 404, body: { error: 'Unsupported integration provider', code: 'provider_not_supported' } };
      return { statusCode: 200, body: await dependencies.createImporter(auth).disconnect(auth.userId, provider) };
    }

    const projectSourcesMatch = pathname.match(/^\/projects\/([^/]+)\/sources$/);
    if (projectSourcesMatch && (method === 'GET' || method === 'POST')) {
      const projectId = projectSourcesMatch[1];
      await dependencies.requireProjectMember(auth, projectId);
      const importer = dependencies.createImporter(auth);
      if (method === 'GET') return { statusCode: 200, body: await importer.listSources(projectId) };

      const parsedBody = await readRequestBody(request);
      if (!parsedBody.ok) return parsedBody.response;
      const body = parsedBody.body;
      const provider = typeof body.provider === 'string' ? normalizeProvider(body.provider) : null;
      const kind = typeof body.kind === 'string' ? body.kind : '';
      const remoteId = typeof body.remoteId === 'string' ? body.remoteId.trim() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!provider) return badRequest('A supported provider is required.', 'invalid_provider');
      if (!sourceKinds.has(kind)) return badRequest('A supported source kind is required.', 'invalid_source_kind');
      if (!remoteId || !name) return badRequest('remoteId and name are required.', 'invalid_source');
      if (body.remoteUrl !== undefined && body.remoteUrl !== null && typeof body.remoteUrl !== 'string') return badRequest('remoteUrl must be a string or null.');
      if (body.sync !== undefined && typeof body.sync !== 'boolean') return badRequest('sync must be a boolean.');
      if (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== 'string') return badRequest('idempotencyKey must be a string.');
      if (body.selectedScope !== undefined && (body.selectedScope === null || typeof body.selectedScope !== 'object' || Array.isArray(body.selectedScope))) {
        return badRequest('selectedScope must be a JSON object.');
      }
      const result = await importer.importSource({
        ownerId: auth.userId,
        projectId,
        provider,
        kind: kind as 'github_repository' | 'google_drive' | 'slack_channel',
        remoteId,
        name,
        remoteUrl: typeof body.remoteUrl === 'string' ? body.remoteUrl : null,
        selectedScope: body.selectedScope === undefined ? undefined : asRecord(body.selectedScope),
        sync: typeof body.sync === 'boolean' ? body.sync : undefined,
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined,
      });
      return { statusCode: 201, body: result };
    }

    const sourceSyncMatch = pathname.match(/^\/projects\/([^/]+)\/sources\/([^/]+)\/sync$/);
    if (sourceSyncMatch && method === 'POST') {
      const [, projectId, sourceId] = sourceSyncMatch;
      await dependencies.requireProjectMember(auth, projectId);
      const parsedBody = await readRequestBody(request);
      if (!parsedBody.ok) return parsedBody.response;
      const body = parsedBody.body;
      if (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== 'string') return badRequest('idempotencyKey must be a string.');
      if (body.force !== undefined && typeof body.force !== 'boolean') return badRequest('force must be a boolean.');
      const maxPages = parsePositiveInteger(body.maxPages === undefined ? null : String(body.maxPages), 200);
      if (maxPages === null) return badRequest('maxPages must be an integer from 1 to 200.');
      return {
        statusCode: 200,
        body: await dependencies.createImporter(auth).sync({
          ownerId: auth.userId,
          projectId,
          sourceId,
          idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined,
          force: typeof body.force === 'boolean' ? body.force : undefined,
          maxPages,
        }),
      };
    }

    const sourceResumeMatch = pathname.match(/^\/projects\/([^/]+)\/sources\/([^/]+)\/sync-runs\/([^/]+)\/resume$/);
    if (sourceResumeMatch && method === 'POST') {
      const [, projectId, sourceId, runId] = sourceResumeMatch;
      await dependencies.requireProjectMember(auth, projectId);
      const parsedBody = await readRequestBody(request);
      if (!parsedBody.ok) return parsedBody.response;
      const body = parsedBody.body;
      if (body.force !== undefined && typeof body.force !== 'boolean') return badRequest('force must be a boolean.');
      const maxPages = parsePositiveInteger(body.maxPages === undefined ? null : String(body.maxPages), 200);
      if (maxPages === null) return badRequest('maxPages must be an integer from 1 to 200.');
      return {
        statusCode: 200,
        body: await dependencies.createImporter(auth).resumeSync({
          ownerId: auth.userId,
          projectId,
          sourceId,
          runId,
          force: typeof body.force === 'boolean' ? body.force : undefined,
          maxPages,
        }),
      };
    }

    const sourceHistoryMatch = pathname.match(/^\/projects\/([^/]+)\/sources\/([^/]+)\/sync-history$/);
    if (sourceHistoryMatch && method === 'GET') {
      const [, projectId, sourceId] = sourceHistoryMatch;
      await dependencies.requireProjectMember(auth, projectId);
      return { statusCode: 200, body: await dependencies.createImporter(auth).syncHistory(projectId, sourceId) };
    }

    const sourceMatch = pathname.match(/^\/projects\/([^/]+)\/sources\/([^/]+)$/);
    if (sourceMatch && method === 'DELETE') {
      const [, projectId, sourceId] = sourceMatch;
      await dependencies.requireProjectMember(auth, projectId);
      return { statusCode: 200, body: await dependencies.createImporter(auth).disconnectSource(projectId, sourceId) };
    }

    return null;
  } catch (cause) {
    if (cause instanceof AuthGatewayError) throw cause;
    if (isRouteError(cause)) return errorResponse(cause);
    throw cause;
  }
}
