#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config as readEnv } from 'dotenv';
import { getProject } from './projects';
import { CollaborationError } from './githubTypes.js';
import { SupabaseGithubCollaborationService } from './githubCollaboration.js';
import { testTextProvider, testVisionProvider } from './aiClient';
import {
  createDynamicSession,
  listDynamicSessions,
  getDynamicSession,
  getActiveSession,
  listDynamicEvidence,
  updateDynamicSessionStatus,
  isEvidenceFilePath,
} from './dynamicSessions';
import { runDynamicSession, cancelSession } from './dynamicRunner';
import { detectArtifactType } from './artifacts';
import { generateProjectReport } from './reportExport';
import { logRuntimeConfigStatus } from './config.js';
import { AuthGatewayError, createAuthGateway, type AuthGateway, type AuthenticatedRequest } from './auth/index.js';
import {
  createStaticReviewOrchestrator,
  ReviewLifecycleConflictError,
  SupabaseStaticReviewRepository,
  SupabaseReviewDecisionService,
  handleReviewDecisionRoute,
  isReviewDecisionRoutePath,
  type StaticReviewOrchestratorService,
  type StaticReviewRecord,
} from './review/index.js';
import { listModelProviderSettings, resolveSavedEmbeddingProvider, resolveSavedProviderForTest, saveModelProviderSetting, SupabaseMigrationRequiredError, type UpdateModelProviderSetting } from './modelSettings.js';
import { createEmbedding, EmbeddingProviderError } from './review/embeddingProvider.js';
import { getSupabaseModelUsageSummary } from './modelUsageSummary.js';
import { ApplicationRepositoryAuthorizationError, ApplicationRepositoryError, CentinelApplicationRepository } from './applicationRepository.js';
import { getClientArtifact, importLocalRepositoryArtifacts, listClientArtifacts, readClientArtifactContent, uploadClientArtifact } from './applicationApi.js';
import { accessTokenFingerprint, createRefreshableStaticReviewRuntime, RefreshableSupabaseRuntime, type RefreshableStaticReviewRuntime } from './runtime/index.js';
import { indexFrozenArtifacts, retrieveFrozenContext } from './review/knowledgeIndex.js';
import { createGroundingModelProvider } from './review/groundingProvider.js';
import { runStaticAnalysis } from './staticEngine.js';
import { handlePhase2ReviewRoute, isPhase2ReviewRoutePath } from './review/phase2Routes.js';
import { SupabaseCentinelStore } from './store/index.js';
import {
  completeIntegrationOAuth,
  getIntegration,
  listIntegrations,
  normalizeProvider,
  renderCallbackPage,
  startIntegrationOAuth,
} from './integrations.js';
import { ConnectedSourceImporter, SupabaseConnectedSourceRepository, handleConnectedSourceRoute } from './integrations/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
readEnv({ path: path.resolve(__dirname, '../../.env') });
logRuntimeConfigStatus();

const evidenceDir = path.resolve(__dirname, '../../evidence/phase-0');
const dataDir = path.resolve(__dirname, '../../data');

function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function html(res: http.ServerResponse, status: number, body: string) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

// Route matchers
function matchProjectId(url: string): string | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)$/);
  return m ? m[1] : null;
}

function matchCollaborationStatus(url: string): string | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/collaborators\/status$/);
  return m ? m[1] : null;
}

function matchCollaboratorSearch(url: string): string | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/collaborators\/search$/);
  return m ? m[1] : null;
}

function matchProjectCollaborators(url: string): string | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/collaborators$/);
  return m ? m[1] : null;
}

function matchCollaboratorSync(url: string): string | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/collaborators\/sync$/);
  return m ? m[1] : null;
}

function matchCollaboratorInvite(url: string): string | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/collaborators\/invite$/);
  return m ? m[1] : null;
}

function matchPullRequests(url: string): string | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/github\/pull-requests$/);
  return m ? m[1] : null;
}

function matchDynamicSessions(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/dynamic-sessions$/);
  return m ? { projectId: m[1] } : null;
}

function matchDynamicSession(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/dynamic-sessions\/([a-f0-9-]+)$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchDynamicEvidence(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/dynamic-sessions\/([a-f0-9-]+)\/evidence$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchDynamicCancel(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/dynamic-sessions\/([a-f0-9-]+)\/cancel$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchArtifacts(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/artifacts$/);
  return m ? { projectId: m[1] } : null;
}

function matchArtifact(url: string): { projectId: string; artifactId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/artifacts\/([a-f0-9-]+)$/);
  return m ? { projectId: m[1], artifactId: m[2] } : null;
}

function matchImportRepo(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/artifacts\/import-repo$/);
  return m ? { projectId: m[1] } : null;
}

function matchStaticSessions(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/static-sessions$/);
  return m ? { projectId: m[1] } : null;
}

function matchStaticSession(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/static-sessions\/([a-f0-9-]+)$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchStaticFindings(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/static-sessions\/([a-f0-9-]+)\/findings$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchStaticCancel(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/static-sessions\/([a-f0-9-]+)\/cancel$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchArtifactContent(url: string): { projectId: string; artifactId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/artifacts\/([a-f0-9-]+)\/content$/);
  return m ? { projectId: m[1], artifactId: m[2] } : null;
}

function matchStaticRetry(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/static-sessions\/([a-f0-9-]+)\/retry$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchStaticActive(url: string): boolean {
  return url === '/static-sessions/active';
}

function matchFindings(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/findings$/);
  return m ? { projectId: m[1] } : null;
}

function matchFinding(url: string): { projectId: string; findingId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/findings\/([a-f0-9-]+)$/);
  return m ? { projectId: m[1], findingId: m[2] } : null;
}

function matchReportExport(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/reports\/export$/);
  return m ? { projectId: m[1] } : null;
}

function matchReviewSourceManifest(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/source-manifest$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchReportHistory(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([^/]+)\/reports$/);
  return m ? { projectId: m[1] } : null;
}

function matchReportLinks(url: string): { projectId: string; reportId: string } | null {
  const m = url.match(/^\/projects\/([^/]+)\/reports\/([^/]+)\/links$/);
  return m ? { projectId: m[1], reportId: m[2] } : null;
}

function matchIntegration(url: string): { provider: string } | null {
  const m = url.match(/^\/integrations\/([^/]+)$/);
  return m ? { provider: m[1] } : null;
}

function matchIntegrationConnect(url: string): { provider: string } | null {
  const m = url.match(/^\/integrations\/([^/]+)\/connect$/);
  return m ? { provider: m[1] } : null;
}

function matchIntegrationCallback(url: string): { provider: string } | null {
  const m = url.match(/^\/integrations\/([^/]+)\/callback$/);
  return m ? { provider: m[1] } : null;
}

function matchReviewTraceability(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/traceability$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchStaticDecisions(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/decisions$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchStaticDecision(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/decision$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchRequirements(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/requirements$/);
  return m ? { projectId: m[1] } : null;
}

function matchRequirement(url: string): { projectId: string; reqId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/requirements\/([a-f0-9-]+)$/);
  return m ? { projectId: m[1], reqId: m[2] } : null;
}

function matchRequirementMap(url: string): { projectId: string; reqId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/requirements\/([a-f0-9-]+)\/map$/);
  return m ? { projectId: m[1], reqId: m[2] } : null;
}

function matchRequirementMappings(url: string): { projectId: string; reqId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/requirements\/([a-f0-9-]+)\/mappings$/);
  return m ? { projectId: m[1], reqId: m[2] } : null;
}

const PORT = 37701;
const HOST = 'localhost';
type CachedReviewRuntime = {
  authRuntime: RefreshableSupabaseRuntime;
  staticRuntime: RefreshableStaticReviewRuntime;
  orchestrator: StaticReviewOrchestratorService;
  recoveryPromise: Promise<void>;
};
const reviewRuntimes = new Map<string, CachedReviewRuntime>();

function reviewRepository(client: SupabaseClient): SupabaseStaticReviewRepository {
  return new SupabaseStaticReviewRepository(client);
}

async function reviewRuntime(auth: AuthenticatedRequest): Promise<StaticReviewOrchestratorService> {
  const existing = reviewRuntimes.get(auth.userId);
  if (existing) {
    if (existing.authRuntime.state().tokenFingerprint !== accessTokenFingerprint(auth.accessToken)) {
      existing.authRuntime.replaceAccessToken(auth.accessToken, auth.client);
    }
    await existing.recoveryPromise;
    return existing.orchestrator;
  }
  const authRuntime = new RefreshableSupabaseRuntime({ userId: auth.userId, accessToken: auth.accessToken, client: auth.client });
  const staticRuntime = createRefreshableStaticReviewRuntime(authRuntime);
  const orchestrator = createStaticReviewOrchestrator({
    ...staticRuntime.dependencies,
    artifacts: (projectId, signal) => authRuntime.withClient(async client => {
      if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
      return listClientArtifacts(new CentinelApplicationRepository(client, auth.userId), projectId, signal);
    }),
    readArtifactContent: (artifact, signal) => authRuntime.withClient(async client => {
      if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
      return readClientArtifactContent(client, auth.userId, artifact.id, artifact.versionId, signal);
    }),
    index: (projectId, artifacts, signal, reviewId) => authRuntime.withClient(client =>
      indexFrozenArtifacts(client, auth.userId, projectId, artifacts, signal, reviewId)),
    context: (projectId, _reviewType, maxTokens, signal, artifacts, reviewId, queryText) => authRuntime.withClient(client =>
      retrieveFrozenContext(client, auth.userId, projectId, artifacts ?? [], maxTokens, signal, reviewId, queryText)),
    deterministic: (projectId, artifacts, reviewId, signal) => authRuntime.withClient(async client => ({
      findings: await runStaticAnalysis(projectId, artifacts, reviewId, {
        signal,
        contentReader: (artifact, contentSignal) => readClientArtifactContent(client, auth.userId, artifact.id, artifact.versionId, contentSignal),
      }),
      persisted: false,
    })),
    retry: { maxAttempts: 3, maxTotalAttempts: 3 },
  });
  const cached: CachedReviewRuntime = { authRuntime, staticRuntime, orchestrator, recoveryPromise: Promise.resolve() };
  reviewRuntimes.set(auth.userId, cached);
  cached.recoveryPromise = staticRuntime.recoverExpiredReviews().then(result => {
    for (const reviewId of result.requeued) {
      void orchestrator.resumeQueuedReview(reviewId).then(resumed => {
        if (resumed) void resumed.completion.catch(error => console.error('[review] recovered execution failed:', error));
      }).catch(error => console.error('[review] recovery launch failed:', error));
    }
  }).catch(error => { console.error('[review] lease recovery failed:', error); });
  await cached.recoveryPromise;
  return orchestrator;
}

function connectedSourceImporter(auth: AuthenticatedRequest): ConnectedSourceImporter {
  return new ConnectedSourceImporter({ repository: new SupabaseConnectedSourceRepository(auth.client) });
}

function toClientStaticSession(review: StaticReviewRecord) {
  const config = review.config ?? {};
  const scope = review.scope ?? {};
  return {
    id: review.id,
    projectId: review.projectId,
    name: review.name,
    reviewType: review.reviewType,
    status: review.status,
    configJson: JSON.stringify(config),
    progressJson: JSON.stringify(review.progress ?? {}),
    remarks: typeof config.remarks === 'string' ? config.remarks : '',
    finalSummary: review.summary,
    failureReason: review.failureReason,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    baseRef: typeof config.baseRef === 'string' ? config.baseRef : '',
    headRef: typeof config.headRef === 'string' ? config.headRef : '',
    changedFilesJson: JSON.stringify([]),
    parentSessionId: review.lineage.parentReviewId ?? '',
    reviewDiffJson: '',
    scope,
  };
}

export function createSidecarServer(authGateway: AuthGateway = createAuthGateway()): http.Server {
  return http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Centinel-User-Id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestUrl = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const url = requestUrl.pathname;
  try {
    // Health
    if (req.method === 'GET' && url === '/health') {
      return json(res, 200, { status: 'ok' });
    }

    // Provider callbacks are authenticated by their short-lived OAuth state.
    // Every other sidecar route derives identity exclusively from the verified
    // Supabase bearer token. X-Centinel-User-Id remains a renderer diagnostic
    // and can never grant access.
    const oauthCallback = req.method === 'GET' && Boolean(matchIntegrationCallback(url));
    const auth = oauthCallback ? null : await authGateway.authenticate(req.headers);
    const accessToken = auth?.accessToken ?? null;
    const ownerId = auth?.userId ?? '';
    const applicationRepository = auth ? new CentinelApplicationRepository(auth.client, auth.userId) : null;

    if (auth && isPhase2ReviewRoutePath(url)) {
      const phase2ReviewRoute = await handlePhase2ReviewRoute({
        method: req.method ?? 'GET',
        pathname: url,
        searchParams: requestUrl.searchParams,
        readBody: () => parseJsonBody(req),
      }, {
        actorId: ownerId,
        repository: reviewRepository(auth.client),
        orchestrator: await reviewRuntime(auth),
        requireProjectMember: projectId => authGateway.requireProjectMember(auth, projectId),
        getArtifact: artifactId => getClientArtifact(auth.client, ownerId, artifactId),
        readArtifactContent: artifactId => readClientArtifactContent(auth.client, ownerId, artifactId),
        modelProvider: createGroundingModelProvider(auth.client, ownerId),
        presentReview: toClientStaticSession,
        onReviewCompletion: (completion, label) => {
          void completion.catch(error => console.error(`[review] ${label}:`, error));
        },
      });
      if (phase2ReviewRoute) return json(res, phase2ReviewRoute.status, phase2ReviewRoute.body);
    }

    const contradictionMatch = url.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/contradictions\/([a-f0-9]{64})$/i);
    if (auth && contradictionMatch && req.method === 'PUT') {
      const [, projectId, reviewId, contradictionId] = contradictionMatch;
      await authGateway.requireProjectMember(auth, projectId);
      const repository = reviewRepository(auth.client);
      const review = await repository.getReview(reviewId);
      if (!review || review.projectId !== projectId) return json(res, 404, { error: 'Review not found.' });
      if (review.status !== 'blocked') return json(res, 409, { error: 'Evidence conflicts can be dispositioned after a blocked Review. Existing completed results cannot be changed.' });
      const assessment = await repository.getEvidenceSufficiency(reviewId);
      if (!assessment?.contradictions.some(item => item.id === contradictionId)) return json(res, 404, { error: 'Evidence conflict not found in this Review.' });
      const body = await parseJsonBody(req);
      const decision = body.decision;
      const rationale = typeof body.rationale === 'string' ? body.rationale.trim() : '';
      if (decision !== 'authoritative_left' && decision !== 'authoritative_right' && decision !== 'not_conflict') {
        return json(res, 400, { error: 'Choose which claim is authoritative, or mark the claims as not conflicting.' });
      }
      if (rationale.length < 8 || rationale.length > 2_000) return json(res, 400, { error: 'Explain the decision in 8 to 2,000 characters.' });
      const saved = await repository.saveContradictionDisposition({
        projectId, reviewId, contradictionId, decision, rationale, actorId: auth.userId,
      });
      return json(res, 200, saved);
    }

    if (auth && isReviewDecisionRoutePath(url)) {
      const decisionRoute = await handleReviewDecisionRoute({
        method: req.method ?? 'GET',
        pathname: url,
        searchParams: requestUrl.searchParams,
        readBody: () => parseJsonBody(req),
      }, {
        actorId: auth.userId,
        service: new SupabaseReviewDecisionService(auth.client),
        requireProjectMember: projectId => authGateway.requireProjectMember(auth, projectId),
      });
      if (decisionRoute) return json(res, decisionRoute.status, decisionRoute.body);
    }

    if (req.method === 'GET' && url === '/github/status') {
      const integration = await getIntegration('github', ownerId, accessToken);
      if (integration?.status === 'connected') {
        return json(res, 200, { connected: true, login: integration.accountLabel.replace(/^@/, ''), message: `Connected to GitHub as ${integration.accountLabel}.` });
      }
      return json(res, 200, { connected: false, login: null, message: integration ? 'GitHub repository access expired. Reconnect it in Settings.' : 'GitHub repository access is not connected.' });
    }

    // External integrations. Tokens stay encrypted in the sidecar database;
    // these routes return metadata or an OAuth URL only.
    if (req.method === 'GET' && url === '/integrations') {
      return json(res, 200, await listIntegrations(ownerId, accessToken));
    }
    const integrationConnectMatch = matchIntegrationConnect(url);
    if (integrationConnectMatch && req.method === 'POST') {
      const provider = normalizeProvider(integrationConnectMatch.provider);
      if (!provider) return json(res, 404, { error: 'Unsupported integration provider' });
      try {
        return json(res, 200, startIntegrationOAuth(provider, ownerId, accessToken));
      } catch (cause) {
        return json(res, 503, { error: String(cause) });
      }
    }
    const integrationCallbackMatch = matchIntegrationCallback(url);
    if (integrationCallbackMatch && req.method === 'GET') {
      const provider = normalizeProvider(integrationCallbackMatch.provider);
      if (!provider) return json(res, 404, { error: 'Unsupported integration provider' });
      const code = requestUrl.searchParams.get('code') ?? '';
      const state = requestUrl.searchParams.get('state') ?? '';
      if (!code || !state) return html(res, 400, renderCallbackPage(provider, false, 'The provider did not return a valid authorization code.'));
      const result = await completeIntegrationOAuth(provider, code, state);
      return html(res, result.integration ? 200 : 400, result.html);
    }

    const connectedSourceResponse = await handleConnectedSourceRoute(
      {
        method: req.method ?? 'GET',
        url: requestUrl,
        auth: auth!,
        readBody: () => parseJsonBody(req),
      },
      {
        createImporter: connectedSourceImporter,
        requireProjectMember: (context, projectId) => authGateway.requireProjectMember(context, projectId),
      },
    );
    if (connectedSourceResponse) return json(res, connectedSourceResponse.statusCode, connectedSourceResponse.body);

    const integrationMatch = matchIntegration(url);
    if (integrationMatch) {
      const provider = normalizeProvider(integrationMatch.provider);
      if (!provider) return json(res, 404, { error: 'Unsupported integration provider' });
      if (req.method === 'GET') return json(res, 200, await getIntegration(provider, ownerId, accessToken));
    }

    // AI Settings
    if (req.method === 'GET' && url === '/settings/ai') {
      return json(res, 200, await listModelProviderSettings(auth!.client, ownerId));
    }

    if (req.method === 'PUT' && (url === '/settings/ai/text' || url === '/settings/ai/vision' || url === '/settings/ai/embedding')) {
      const id = url === '/settings/ai/text' ? 'text' : url === '/settings/ai/vision' ? 'vision' : 'embedding';
      const body = await parseJsonBody(req);
      try {
        return json(res, 200, await saveModelProviderSetting(auth!.client, ownerId, id, {
          provider: body.provider as UpdateModelProviderSetting['provider'],
          apiFormat: body.apiFormat as UpdateModelProviderSetting['apiFormat'],
          apiKey: typeof body.apiKey === 'string' ? body.apiKey : '',
          baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : '',
          model: typeof body.model === 'string' ? body.model : '',
          fallbackEnabled: body.fallbackEnabled === true,
          fallbackProvider: body.fallbackProvider as UpdateModelProviderSetting['fallbackProvider'],
          fallbackApiFormat: body.fallbackApiFormat as UpdateModelProviderSetting['fallbackApiFormat'],
          fallbackApiKey: typeof body.fallbackApiKey === 'string' ? body.fallbackApiKey : '',
          fallbackBaseUrl: typeof body.fallbackBaseUrl === 'string' ? body.fallbackBaseUrl : '',
          fallbackModel: typeof body.fallbackModel === 'string' ? body.fallbackModel : '',
        }));
      } catch (cause) {
        return json(res, 400, { error: cause instanceof Error ? cause.message : 'Model Provider settings could not be saved.' });
      }
    }

    if (req.method === 'POST' && url === '/settings/ai/embedding/test') {
      let provider: Awaited<ReturnType<typeof resolveSavedEmbeddingProvider>>;
      try {
        provider = await resolveSavedEmbeddingProvider(auth!.client, ownerId);
      } catch {
        return json(res, 409, { status: 'fail', message: 'The source-indexing provider configuration is incomplete.' });
      }
      if (!provider) return json(res, 409, { status: 'fail', message: 'Configure the source-indexing provider before testing it.' });
      const started = Date.now();
      try {
        const result = await createEmbedding(provider, 'Centinel source-indexing connection test.');
        await new SupabaseCentinelStore(auth!.client).saveModelUsage({
          projectId: null, reviewSessionId: null, ownerId,
          stage: 'embedding-provider-test', attempt: 1, provider: 'custom', model: result.model, outcome: 'success',
          inputTokens: result.inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
          durationMs: Date.now() - started, errorCode: null, cost: null,
          metadata: { apiFormat: 'openai-compatible', callKind: 'test', scope: 'embedding' },
        });
        return json(res, 200, { status: 'pass', message: 'Source indexing returned a valid 1536-dimensional vector.' });
      } catch (cause) {
        const code = cause instanceof EmbeddingProviderError ? cause.code : 'provider_unavailable';
        return json(res, 502, { status: 'fail', message: cause instanceof EmbeddingProviderError ? cause.message : 'Source-indexing provider could not be tested.', code });
      }
    }

    if (req.method === 'POST' && (url === '/settings/ai/text/test' || url === '/settings/ai/vision/test')) {
      const id = url === '/settings/ai/text/test' ? 'text' : 'vision';
      const screenshotPath = path.join(evidenceDir, 'playwright-screenshot.png');
      // Optional body of form-state overrides so Test reflects what the user
      // just typed (not just what's persisted). Empty body / no body is fine —
      // we fall through to using the saved setting.
      let overrides: Partial<UpdateModelProviderSetting> & { useFallback?: boolean } = {};
      try {
        const raw = await parseJsonBody(req);
        if (raw && typeof raw === 'object') overrides = raw as Partial<UpdateModelProviderSetting> & { useFallback?: boolean };
      } catch {
        // Empty or malformed body — use the saved setting.
      }
      const provider = await resolveSavedProviderForTest(auth!.client, ownerId, id, overrides, overrides.useFallback === true);
      const result = id === 'vision' ? await testVisionProvider(provider, screenshotPath) : await testTextProvider(provider);
      // Record test-call usage. Real tokens were spent on this round-trip,
      // and the Settings page shows test vs review breakdown.
      if (result.usage && result.status === 'pass') {
        try {
          await new SupabaseCentinelStore(auth!.client).saveModelUsage({
            projectId: null, reviewSessionId: null, ownerId,
            stage: id === 'text' ? 'provider-test' : 'vision-provider-test', attempt: 1,
            provider: provider.provider, model: provider.model, outcome: 'success',
            inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
            cacheReadTokens: result.usage.cacheReadTokens ?? 0,
            cacheCreationTokens: result.usage.cacheCreationTokens ?? 0,
            durationMs: null, errorCode: null, cost: null,
            metadata: { apiFormat: provider.apiFormat, callKind: 'test', scope: id },
          });
        } catch (err) {
          console.error('[settings] failed to record test token usage:', err);
        }
      }
      return json(res, 200, result);
    }

    // AI Token Usage summary (read-only). Returns aggregated totals + the
    // most recent calls so the Settings page can render the dashboard
    // without paging through the full row set. Supports optional filters
    // via query string: ?scope=text|vision|embedding, ?callKind=review|test|dynamic,
    // ?sessionId=<uuid>, ?projectId=<uuid>.
    if (req.method === 'GET' && url === '/settings/ai/usage') {
      const scopeParam = requestUrl.searchParams.get('scope');
      const callKindParam = requestUrl.searchParams.get('callKind');
      const sessionId = requestUrl.searchParams.get('sessionId') ?? undefined;
      const projectId = requestUrl.searchParams.get('projectId') ?? undefined;
      if (sessionId) {
        if (!projectId) return json(res, 400, { error: 'projectId is required when filtering usage by sessionId.' });
        await authGateway.requireProjectMember(auth!, projectId);
        const review = await reviewRepository(auth!.client).getReview(sessionId);
        if (!review || review.projectId !== projectId) return json(res, 404, { error: 'Session not found' });
      }
      else if (projectId) await authGateway.requireProjectMember(auth!, projectId);
      const summary = await getSupabaseModelUsageSummary(auth!.client, ownerId, {
        scope: scopeParam === 'text' || scopeParam === 'vision' || scopeParam === 'embedding' ? scopeParam : undefined,
        callKind: callKindParam === 'review' || callKindParam === 'test' || callKindParam === 'dynamic' ? callKindParam : undefined,
        sessionId,
        projectId,
      });
      return json(res, 200, summary);
    }

    // Projects
    if (req.method === 'GET' && url === '/projects') {
      return json(res, 200, await applicationRepository!.listProjects());
    }

    if (req.method === 'POST' && url === '/projects') {
      const body = await parseJsonBody(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const workspacePath = typeof body.workspacePath === 'string' ? body.workspacePath.trim() : '';
      const source = body.source && typeof body.source === 'object' ? body.source as Record<string, unknown> : null;
      const sourceType = source?.type === 'github' ? 'github' : 'local-repository';
      const repoUrl = typeof source?.repoUrl === 'string' ? source.repoUrl.trim() : '';
      if (!name) return json(res, 400, { error: 'Project name is required' });
      if (name.length > 80) return json(res, 400, { error: 'Project name must be 80 characters or less' });
      if (description.length > 500) return json(res, 400, { error: 'Description must be 500 characters or less' });
      if (sourceType === 'local-repository' && !workspacePath) return json(res, 400, { error: 'Workspace path is required' });
      if (sourceType === 'github' && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/i.test(repoUrl)) {
        return json(res, 400, { error: 'A valid GitHub repository URL is required' });
      }
      try {
        if (sourceType === 'local-repository' && !fs.statSync(workspacePath).isDirectory()) {
          return json(res, 400, { error: 'Workspace path must be a directory.' });
        }
        const githubImporter = sourceType === 'github' ? connectedSourceImporter(auth!) : null;
        if (githubImporter && !(await githubImporter.status(ownerId, 'github')).connected) {
          return json(res, 409, { error: 'Connect GitHub repository access before importing a GitHub project.' });
        }
        const project = await applicationRepository!.createProject({ name, description, workspacePath });
        if (sourceType === 'local-repository') {
          await applicationRepository!.saveSource({
            projectId: project.id, integrationId: null, kind: 'local_repository',
            name, remoteId: null, remoteUrl: null, syncStatus: 'idle', lastSyncedAt: null,
          });
          await importLocalRepositoryArtifacts(applicationRepository!, project.id, workspacePath);
        } else if (githubImporter) {
          const remoteId = new URL(repoUrl).pathname.replace(/^\//, '').replace(/\/$/, '').replace(/\.git$/i, '');
          await githubImporter.importSource({
            ownerId, projectId: project.id, provider: 'github', kind: 'github_repository',
            remoteId, remoteUrl: repoUrl,
            name: remoteId.split('/')[1] || name, sync: true,
          });
        }
        return json(res, 201, project);
      } catch (error) {
        return json(res, 400, { error: String(error) });
      }
    }

    // Dynamic sessions - list
    const dsMatch = matchDynamicSessions(url);
    if (dsMatch && req.method === 'GET') {
      return json(res, 200, await listDynamicSessions(dsMatch.projectId));
    }

    // Dynamic sessions - create
    if (dsMatch && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const targetUrl = typeof body.targetUrl === 'string' ? body.targetUrl.trim() : '';
      const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
      const missionType = body.missionType === 'smoke' ? 'smoke' : 'user_journey';
      const maxSteps = Math.min(25, Math.max(1, typeof body.maxSteps === 'number' ? body.maxSteps : 15));

      if (!targetUrl) return json(res, 400, { error: 'targetUrl is required' });
      try { new URL(targetUrl); } catch { return json(res, 400, { error: 'targetUrl must be a valid URL' }); }
      if (!goal) return json(res, 400, { error: 'goal is required' });

      const active = await getActiveSession(dsMatch.projectId);
      if (active) return json(res, 409, { error: 'A dynamic session is already running' });

      const project = await getProject(dsMatch.projectId);
      if (!project) return json(res, 404, { error: 'Project not found' });

      const session = await createDynamicSession(dsMatch.projectId, targetUrl, goal, missionType, maxSteps);

      // Run asynchronously
      runDynamicSession(session, project.workspacePath).catch(err => {
        console.error('[runner] error:', err);
        updateDynamicSessionStatus(session.id, 'failure', '', String(err)).catch(() => {});
      });

      return json(res, 201, session);
    }

    // Dynamic session - cancel (must be before get)
    const dcMatch = matchDynamicCancel(url);
    if (dcMatch && req.method === 'POST') {
      const session = await getDynamicSession(dcMatch.projectId, dcMatch.sessionId);
      if (!session) return json(res, 404, { error: 'Session not found' });
      if (session.status !== 'running' && session.status !== 'queued') {
        return json(res, 400, { error: 'Session is not active' });
      }
      cancelSession(dcMatch.sessionId);
      await updateDynamicSessionStatus(dcMatch.sessionId, 'cancelled', '', 'Cancelled by user');
      return json(res, 200, { ok: true });
    }

    // Dynamic session - evidence
    const deMatch = matchDynamicEvidence(url);
    if (deMatch && req.method === 'GET') {
      return json(res, 200, await listDynamicEvidence(deMatch.projectId, deMatch.sessionId));
    }

    // Dynamic session - get
    const dMatch = matchDynamicSession(url);
    if (dMatch && req.method === 'GET') {
      const session = await getDynamicSession(dMatch.projectId, dMatch.sessionId);
      if (!session) return json(res, 404, { error: 'Session not found' });
      return json(res, 200, session);
    }

    // GitHub collaboration status and search. These routes only return
    // repository metadata and user handles; the configured token remains in
    // the sidecar process and is never included in a response or log.
    const collaborationStatusProjectId = matchCollaborationStatus(url);
    if (collaborationStatusProjectId && req.method === 'GET') {
      try {
        return json(res, 200, await new SupabaseGithubCollaborationService(auth!.client, ownerId, accessToken!).status(collaborationStatusProjectId));
      } catch (cause) {
        if (cause instanceof CollaborationError) return json(res, cause.httpStatus, { error: cause.message, code: cause.code });
        throw cause;
      }
    }

    const projectCollaboratorsId = matchProjectCollaborators(url);
    if (projectCollaboratorsId && req.method === 'GET') {
      try {
        return json(res, 200, await new SupabaseGithubCollaborationService(auth!.client, ownerId, accessToken!).listCollaborators(projectCollaboratorsId));
      } catch (cause) {
        if (cause instanceof CollaborationError) return json(res, cause.httpStatus, { error: cause.message, code: cause.code });
        return json(res, 502, { error: 'Saved GitHub collaborators could not be loaded' });
      }
    }

    const collaboratorSyncProjectId = matchCollaboratorSync(url);
    if (collaboratorSyncProjectId && req.method === 'POST') {
      try {
        return json(res, 200, await new SupabaseGithubCollaborationService(auth!.client, ownerId, accessToken!).syncCollaborators(collaboratorSyncProjectId));
      } catch (cause) {
        if (cause instanceof CollaborationError) return json(res, cause.httpStatus, { error: cause.message, code: cause.code });
        return json(res, 502, { error: 'GitHub collaborators could not be synced' });
      }
    }

    const collaboratorSearchProjectId = matchCollaboratorSearch(url);
    if (collaboratorSearchProjectId && req.method === 'GET') {
      const email = requestUrl.searchParams.get('email')?.trim() ?? '';
      if (!email) return json(res, 400, { error: 'email is required' });
      try {
        return json(res, 200, await new SupabaseGithubCollaborationService(auth!.client, ownerId, accessToken!).searchUsers(collaboratorSearchProjectId, email));
      } catch (cause) {
        if (cause instanceof CollaborationError) return json(res, cause.httpStatus, { error: cause.message, code: cause.code });
        return json(res, 502, { error: 'GitHub search failed' });
      }
    }

    const collaboratorInviteProjectId = matchCollaboratorInvite(url);
    if (collaboratorInviteProjectId && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      if (!username) return json(res, 400, { error: 'username is required' });
      try {
        return json(res, 201, await new SupabaseGithubCollaborationService(auth!.client, ownerId, accessToken!).invite(collaboratorInviteProjectId, username));
      } catch (cause) {
        if (cause instanceof CollaborationError) return json(res, cause.httpStatus, { error: cause.message, code: cause.code });
        return json(res, 502, { error: 'GitHub invitation failed' });
      }
    }

    const pullRequestProjectId = matchPullRequests(url);
    if (pullRequestProjectId && req.method === 'GET') {
      try {
        return json(res, 200, await new SupabaseGithubCollaborationService(auth!.client, ownerId, accessToken!).listPullRequests(pullRequestProjectId));
      } catch (cause) {
        if (cause instanceof CollaborationError) return json(res, cause.httpStatus, { error: cause.message, code: cause.code });
        return json(res, 502, { error: 'GitHub pull request lookup failed' });
      }
    }

    // Project get/update/delete
    const projectId = matchProjectId(url);
    if (projectId && req.method === 'GET') {
      const project = await applicationRepository!.getProject(projectId);
      if (!project) return json(res, 404, { error: 'Project not found' });
      return json(res, 200, project);
    }

    if (projectId && req.method === 'PUT') {
      const body = await parseJsonBody(req);
      const name = body.name === undefined ? undefined : typeof body.name === 'string' ? body.name.trim() : '';
      const description = body.description === undefined ? undefined : typeof body.description === 'string' ? body.description.trim() : '';
      const workspacePath = body.workspacePath === undefined ? undefined : typeof body.workspacePath === 'string' ? body.workspacePath.trim() : '';
      if (name !== undefined && !name) return json(res, 400, { error: 'Project name is required' });
      if (name !== undefined && name.length > 80) return json(res, 400, { error: 'Project name must be 80 characters or less' });
      if (description !== undefined && description.length > 500) return json(res, 400, { error: 'Description must be 500 characters or less' });
      if (workspacePath !== undefined && !workspacePath) return json(res, 400, { error: 'Workspace path is required' });
      try {
        const updated = await applicationRepository!.updateProject(projectId, { name, description, workspacePath });
        if (!updated) return json(res, 404, { error: 'Project not found' });
        return json(res, 200, updated);
      } catch (cause) {
        return json(res, 400, { error: cause instanceof Error ? cause.message : 'Project could not be updated' });
      }
    }

    // Project delete
    if (projectId && req.method === 'DELETE') {
      const deleted = await applicationRepository!.deleteProject(projectId);
      if (!deleted) return json(res, 404, { error: 'Project not found' });
      return json(res, 200, { ok: true });
    }

    // === Artifacts ===

    // Import artifacts from repo path
    const importMatch = matchImportRepo(url);
    if (importMatch && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const repoPath = typeof body.repoPath === 'string' ? body.repoPath.trim() : '';
      if (!repoPath) return json(res, 400, { error: 'repoPath is required' });
      try {
        const result = await importLocalRepositoryArtifacts(applicationRepository!, importMatch.projectId, repoPath);
        return json(res, 200, result);
      } catch (e) {
        return json(res, 400, { error: String(e) });
      }
    }

    // List artifacts
    const artMatch = matchArtifacts(url);
    if (artMatch && req.method === 'GET') {
      return json(res, 200, await listClientArtifacts(applicationRepository!, artMatch.projectId));
    }

    // Upload artifact
    if (artMatch && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
      const content = typeof body.content === 'string' ? body.content : '';
      const type = typeof body.type === 'string' ? body.type.trim() : '';
      if (!fileName) return json(res, 400, { error: 'fileName is required' });
      if (!content) return json(res, 400, { error: 'content is required (base64 encoded)' });
      const artifactType = type || detectArtifactType(fileName);
      const buffer = Buffer.from(content, 'base64');
      const artifact = await uploadClientArtifact(applicationRepository!, { projectId: artMatch.projectId, type: artifactType as any, fileName, content: buffer });
      return json(res, 201, artifact);
    }

    // Preview a frozen private artifact version.
    const artifactContentMatch = matchArtifactContent(url);
    if (artifactContentMatch && req.method === 'GET') {
      const { projectId, artifactId } = artifactContentMatch;
      await authGateway.requireProjectMember(auth!, projectId);
      const artifact = await getClientArtifact(auth!.client, ownerId, artifactId);
      if (!artifact || artifact.projectId !== projectId) return json(res, 404, { error: 'Artifact not found.' });
      const versionId = requestUrl.searchParams.get('versionId') || artifact.versionId;
      if (!versionId) return json(res, 404, { error: 'Artifact has no stored version.' });
      const version = await applicationRepository!.getArtifactVersion(projectId, versionId);
      if (!version || version.artifactId !== artifactId) return json(res, 404, { error: 'Artifact version not found.' });
      const content = await applicationRepository!.downloadArtifactVersion(projectId, versionId);
      return json(res, 200, { versionId, content: content.toString('base64'), contentHash: version.contentHash, mimeType: version.contentType });
    }

    // Delete artifact
    const artIdMatch = matchArtifact(url);
    if (artIdMatch && req.method === 'DELETE') {
      const deleted = await applicationRepository!.deleteArtifact(artIdMatch.projectId, artIdMatch.artifactId);
      if (!deleted) return json(res, 404, { error: 'Artifact not found' });
      return json(res, 200, { ok: true });
    }

    // === Static Sessions ===

    // List static sessions
    const ssMatch = matchStaticSessions(url);
    if (ssMatch && req.method === 'GET') {
      await authGateway.requireProjectMember(auth!, ssMatch.projectId);
      const sessions = await reviewRepository(auth!.client).listReviews(ssMatch.projectId);
      return json(res, 200, sessions.map(toClientStaticSession));
    }

    // List active static sessions across all projects (for toast polling)
    if (req.method === 'GET' && matchStaticActive(url)) {
      const sessions = await reviewRepository(auth!.client).listActiveReviews();
      return json(res, 200, sessions.map(toClientStaticSession));
    }

    if (ssMatch && req.method === 'POST') {
      await authGateway.requireProjectMember(auth!, ssMatch.projectId);
      const body = await parseJsonBody(req);
      const scopeBody = body.scope && typeof body.scope === 'object' ? body.scope as Record<string, unknown> : {};
      const stringArray = (value: unknown): string[] => Array.isArray(value)
        ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)))
        : [];
      const scope = {
        artifactIds: stringArray(scopeBody.artifactIds ?? body.artifactIds ?? body.selectedArtifactIds),
        requirementIds: stringArray(scopeBody.requirementIds ?? body.requirementIds ?? body.selectedRequirementIds),
        standardIds: stringArray(scopeBody.standardIds ?? body.standardIds ?? body.selectedStandardIds),
      };
      if (scope.artifactIds.length === 0 && scope.requirementIds.length === 0 && scope.standardIds.length === 0) {
        return json(res, 400, { error: 'Select at least one artifact, requirement, or coding standard.' });
      }
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Static Review';
      const reviewType = typeof body.reviewType === 'string' ? body.reviewType : 'code_review';
      const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;
      const result = await (await reviewRuntime(auth!)).start({
        projectId: ssMatch.projectId,
        name,
        reviewType,
        scope,
        idempotencyKey,
        validateScopeBeforeCreate: () => applicationRepository!.validateReviewScope(ssMatch.projectId, scope),
        config: {
          instructions: typeof body.instructions === 'string' ? body.instructions.trim() : '',
          reviewer: typeof body.reviewer === 'string' ? body.reviewer.trim() : '',
          reviewMode: typeof body.reviewMode === 'string' ? body.reviewMode : 'regular',
          baseRef: typeof body.baseRef === 'string' ? body.baseRef.trim() : '',
          headRef: typeof body.headRef === 'string' ? body.headRef.trim() : '',
          pullRequest: typeof body.pullRequest === 'string' ? body.pullRequest.trim() : '',
        },
      });
      void result.completion.catch(error => console.error('[review] background execution failed:', error));
      return json(res, result.reused ? 200 : 201, toClientStaticSession(result.review));
    }

    const srMatch = matchStaticRetry(url);
    if (srMatch && req.method === 'POST') {
      await authGateway.requireProjectMember(auth!, srMatch.projectId);
      const targetReview = await reviewRepository(auth!.client).getReview(srMatch.sessionId);
      if (!targetReview || targetReview.projectId !== srMatch.projectId) return json(res, 404, { error: 'Session not found' });
      if (!['failed', 'blocked', 'cancelled'].includes(targetReview.status)) {
        return json(res, 409, { error: `Review cannot be retried from status ${targetReview.status}`, code: 'review_lifecycle_conflict' });
      }
      const body = await parseJsonBody(req);
      const result = await (await reviewRuntime(auth!)).retry({
        reviewId: srMatch.sessionId,
        refreshSourceManifest: body.refreshSourceManifest === true,
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined,
      });
      if (result.review.projectId !== srMatch.projectId) return json(res, 404, { error: 'Session not found' });
      void result.completion.catch(error => console.error('[review] retry execution failed:', error));
      return json(res, result.reused ? 200 : 201, toClientStaticSession(result.review));
    }

    // Static session - cancel (must be before get)
    const scMatch = matchStaticCancel(url);
    if (scMatch && req.method === 'POST') {
      await authGateway.requireProjectMember(auth!, scMatch.projectId);
      const targetReview = await reviewRepository(auth!.client).getReview(scMatch.sessionId);
      if (!targetReview || targetReview.projectId !== scMatch.projectId) return json(res, 404, { error: 'Session not found' });
      if (targetReview.status === 'cancelled') return json(res, 200, { ok: true });
      if (!['prepared', 'queued', 'running'].includes(targetReview.status)) {
        return json(res, 409, { error: `Review cannot be cancelled from status ${targetReview.status}`, code: 'review_lifecycle_conflict' });
      }
      const session = await (await reviewRuntime(auth!)).cancel({ reviewId: scMatch.sessionId });
      if (session.projectId !== scMatch.projectId) return json(res, 404, { error: 'Session not found' });
      return json(res, 200, { ok: true });
    }

    // Static session - findings
    const sfMatch = matchStaticFindings(url);
    if (sfMatch && req.method === 'GET') {
      await authGateway.requireProjectMember(auth!, sfMatch.projectId);
      const review = await reviewRepository(auth!.client).getReview(sfMatch.sessionId);
      if (!review || review.projectId !== sfMatch.projectId) return json(res, 404, { error: 'Session not found' });
      const findings = await new SupabaseCentinelStore(auth!.client).listFindings(sfMatch.projectId, sfMatch.sessionId);
      return json(res, 200, findings.map(finding => ({
        ...finding,
        sessionId: finding.reviewSessionId,
        filePath: typeof finding.location.filePath === 'string' ? finding.location.filePath : '',
        lineNumber: typeof finding.location.lineNumber === 'number' ? finding.location.lineNumber : null,
        fromRemarks: false,
      })));
    }

    // Immutable Review evidence snapshots used by Review Overview,
    // Traceability, Assessment, and exports.
    const rsmMatch = matchReviewSourceManifest(url);
    if (rsmMatch && req.method === 'GET') {
      await authGateway.requireProjectMember(auth!, rsmMatch.projectId);
      const review = await reviewRepository(auth!.client).getReview(rsmMatch.sessionId);
      if (!review || review.projectId !== rsmMatch.projectId) return json(res, 404, { error: 'Session not found' });
      const { data, error } = await auth!.client.from('review_source_snapshots').select('*').eq('project_id', rsmMatch.projectId).eq('review_session_id', rsmMatch.sessionId).maybeSingle();
      if (error) throw new Error(`Supabase source manifest query failed: ${error.message}`);
      if (!data) return json(res, 200, { sessionId: rsmMatch.sessionId, projectId: rsmMatch.projectId, status: 'unavailable', sources: [], artifactCount: null });
      const snapshot = data.snapshot && typeof data.snapshot === 'object' ? data.snapshot as Record<string, unknown> : {};
      const capturedAt = typeof snapshot.capturedAt === 'string' ? snapshot.capturedAt : String(data.created_at ?? '');
      const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : [];
      return json(res, 200, {
        sessionId: rsmMatch.sessionId,
        projectId: rsmMatch.projectId,
        status: data.status ?? 'available',
        capturedAt,
        sources: artifacts.map(item => ({
          id: String(item.id ?? ''), sessionId: rsmMatch.sessionId, sourceId: String(item.id ?? ''),
          sourceKind: item.kind === 'source_code' ? 'repository' : 'document', label: String(item.name ?? item.path ?? 'Artifact'),
          artifactIds: [String(item.id ?? '')], filesReviewed: 1,
          contentHashes: typeof (item.metadata as Record<string, unknown> | undefined)?.contentHash === 'string' ? [String((item.metadata as Record<string, unknown>).contentHash)] : [],
          capturedAt,
        })),
        artifactCount: artifacts.length,
      });
    }
    const rtsMatch = matchReviewTraceability(url);
    if (rtsMatch && req.method === 'GET') {
      await authGateway.requireProjectMember(auth!, rtsMatch.projectId);
      const review = await reviewRepository(auth!.client).getReview(rtsMatch.sessionId);
      if (!review || review.projectId !== rtsMatch.projectId) return json(res, 404, { error: 'Session not found' });
      const { data, error } = await auth!.client.from('review_traceability_snapshots').select('*').eq('project_id', rtsMatch.projectId).eq('review_session_id', rtsMatch.sessionId).maybeSingle();
      if (error) throw new Error(`Supabase traceability query failed: ${error.message}`);
      return json(res, 200, data ? {
        sessionId: rtsMatch.sessionId,
        projectId: rtsMatch.projectId,
        status: data.status ?? 'available',
        records: data.records ?? [],
        summary: data.summary ?? null,
        capturedAt: data.created_at,
      } : { sessionId: rtsMatch.sessionId, projectId: rtsMatch.projectId, status: 'unavailable', records: [], summary: null });
    }

    // Static session - get (with current decision embedded for the dashboard)
    const ssIdMatch = matchStaticSession(url);
    if (ssIdMatch && req.method === 'GET') {
      await authGateway.requireProjectMember(auth!, ssIdMatch.projectId);
      const session = await reviewRepository(auth!.client).getReview(ssIdMatch.sessionId);
      if (!session || session.projectId !== ssIdMatch.projectId) return json(res, 404, { error: 'Session not found' });
      const decisions = await new SupabaseCentinelStore(auth!.client).listDecisions(ssIdMatch.sessionId);
      const latest = decisions.at(-1);
      const currentDecision = latest ? {
        id: latest.id, sessionId: latest.reviewSessionId, projectId: latest.projectId,
        decision: latest.decision, comment: latest.comment, reviewer: latest.reviewer,
        attachments: [], createdAt: latest.createdAt,
      } : null;
      return json(res, 200, { ...toClientStaticSession(session), currentDecision });
    }

    // === Unified Findings ===

    // List all findings for project
    const fMatch = matchFindings(url);
    if (fMatch && req.method === 'GET') {
      await authGateway.requireProjectMember(auth!, fMatch.projectId);
      const findings = await new SupabaseCentinelStore(auth!.client).listFindings(fMatch.projectId);
      return json(res, 200, findings.map(finding => ({
        ...finding,
        sessionId: finding.reviewSessionId,
        filePath: typeof finding.location.filePath === 'string' ? finding.location.filePath : '',
        lineNumber: typeof finding.location.lineNumber === 'number' ? finding.location.lineNumber : null,
        fromRemarks: false,
      })));
    }

    const assessmentMatch = url.match(/^\/projects\/([^/]+)\/assessment$/);
    if (assessmentMatch && req.method === 'GET') {
      await authGateway.requireProjectMember(auth!, assessmentMatch[1]);
      try {
        return json(res, 200, await applicationRepository!.getProjectAssessment(assessmentMatch[1]));
      } catch {
        return json(res, 503, { projectId: assessmentMatch[1], status: 'unavailable', error: 'Project assessment is temporarily unavailable.' });
      }
    }

    // Update finding status
    const fIdMatch = matchFinding(url);
    if (fIdMatch && req.method === 'PUT') {
      const body = await parseJsonBody(req);
      const status = typeof body.status === 'string' ? body.status : '';
      const validStatuses = ['new', 'accepted', 'dismissed', 'fixed'];
      if (!validStatuses.includes(status)) return json(res, 400, { error: 'Invalid status' });
      await applicationRepository!.updateFindingStatus(fIdMatch.projectId, fIdMatch.findingId, status as 'new' | 'accepted' | 'dismissed' | 'fixed', auth!.userId);
      return json(res, 200, { ok: true });
    }

    // === Reports ===

    // Export project report
    const rMatch = matchReportExport(url);
    if (rMatch && req.method === 'POST') {
      await authGateway.requireProjectMember(auth!, rMatch.projectId);
      try {
        const result = await generateProjectReport(rMatch.projectId, ownerId, accessToken);
        return json(res, 200, result);
      } catch (e) {
        return json(res, 400, { error: String(e) });
      }
    }

    const reportHistoryMatch = matchReportHistory(url);
    if (reportHistoryMatch && req.method === 'GET') {
      await authGateway.requireProjectMember(auth!, reportHistoryMatch.projectId);
      return json(res, 200, await applicationRepository!.listProjectReportHistory(reportHistoryMatch.projectId));
    }

    const reportLinksMatch = matchReportLinks(url);
    if (reportLinksMatch && req.method === 'POST') {
      await authGateway.requireProjectMember(auth!, reportLinksMatch.projectId);
      return json(res, 200, await applicationRepository!.renewProjectReportLinks(reportLinksMatch.projectId, reportLinksMatch.reportId));
    }

    // === Requirements ===

    // List requirements
    const reqListMatch = matchRequirements(url);
    if (reqListMatch && req.method === 'GET') {
      return json(res, 200, await applicationRepository!.listRequirements(reqListMatch.projectId));
    }

    // Create requirement
    if (reqListMatch && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const category = typeof body.category === 'string' ? body.category.trim() : '';
      const priority = typeof body.priority === 'string' ? body.priority.trim() : 'medium';
      if (!title) return json(res, 400, { error: 'title is required' });
      const requirement = await applicationRepository!.saveRequirement({ projectId: reqListMatch.projectId, title, description, category, priority });
      return json(res, 201, requirement);
    }

    // Add mapping to requirement (must be before single requirement get)
    const reqMapMatch = matchRequirementMap(url);
    if (reqMapMatch && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const fileId = typeof body.fileId === 'string' ? body.fileId : null;
      const symbolId = typeof body.symbolId === 'string' ? body.symbolId : null;
      const coverageStatus = typeof body.coverageStatus === 'string' ? body.coverageStatus : 'unknown';
      const confidence = typeof body.confidence === 'number' ? body.confidence : 0;
      if (confidence < 0 || confidence > 1) return json(res, 400, { error: 'confidence must be between 0 and 1' });
      const mapping = await applicationRepository!.saveRequirementMapping({
        projectId: reqMapMatch.projectId,
        requirementId: reqMapMatch.reqId, standardId: null, artifactId: fileId,
        fileId, symbolId, coverageStatus, confidence,
      });
      return json(res, 201, mapping);
    }

    // List mappings for requirement (must be before single requirement get)
    const reqMappingsMatch = matchRequirementMappings(url);
    if (reqMappingsMatch && req.method === 'GET') {
      return json(res, 200, await applicationRepository!.listRequirementMappings(reqMappingsMatch.projectId, reqMappingsMatch.reqId));
    }

    // Update requirement
    const reqUpdateMatch = matchRequirement(url);
    if (reqUpdateMatch && req.method === 'PUT') {
      const body = await parseJsonBody(req);
      const updates: Record<string, string> = {};
      if (typeof body.title === 'string') updates.title = body.title;
      if (typeof body.description === 'string') updates.description = body.description;
      if (typeof body.category === 'string') updates.category = body.category;
      if (typeof body.priority === 'string') updates.priority = body.priority;
      try {
        const updated = await applicationRepository!.updateRequirement(reqUpdateMatch.projectId, reqUpdateMatch.reqId, updates);
        if (!updated) return json(res, 404, { error: 'Requirement not found' });
        return json(res, 200, updated);
      } catch (e) {
        return json(res, 404, { error: String(e) });
      }
    }

    // Delete requirement
    if (reqUpdateMatch && req.method === 'DELETE') {
      const deleted = await applicationRepository!.deleteRequirement(reqUpdateMatch.projectId, reqUpdateMatch.reqId);
      if (!deleted) return json(res, 404, { error: 'Requirement not found' });
      return json(res, 200, { ok: true });
    }

    // Get single requirement
    if (reqUpdateMatch && req.method === 'GET') {
      const requirement = await applicationRepository!.getRequirement(reqUpdateMatch.projectId, reqUpdateMatch.reqId);
      if (!requirement) return json(res, 404, { error: 'Requirement not found' });
      return json(res, 200, requirement);
    }

    // Evidence file serving
    if (req.method === 'GET' && url.startsWith('/evidence-file')) {
      const filePath = requestUrl.searchParams.get('path');

      if (!filePath) {
        return json(res, 400, { error: 'Missing path parameter' });
      }

      // Validate the path exists in evidence table (prevents arbitrary file access)
      const isEvidence = await isEvidenceFilePath(filePath);
      if (!isEvidence) {
        return json(res, 403, { error: 'File not registered as evidence', path: filePath });
      }

      // Validate file exists on disk
      if (!fs.existsSync(filePath)) {
        return json(res, 404, { error: 'File not found on disk', path: filePath });
      }

      // Validate it's an image file
      const ext = path.extname(filePath).toLowerCase();
      const allowedExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
      if (!allowedExts.includes(ext)) {
        return json(res, 403, { error: 'Only image files are allowed', ext });
      }

      // Set content type based on extension
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      // Stream the file
      try {
        const fileStream = fs.createReadStream(filePath);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        fileStream.pipe(res);
        fileStream.on('error', (err) => {
          console.error('[server] Error streaming file:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Error reading file' }));
          }
        });
      } catch (err) {
        console.error('[server] Error serving file:', err);
        return json(res, 500, { error: 'Error serving file' });
      }
      return;
    }

    json(res, 404, { error: 'Not found' });
  } catch (e) {
    if (e instanceof AuthGatewayError) {
      return json(res, e.statusCode, { error: e.message, code: e.code });
    }
    if (e instanceof ApplicationRepositoryAuthorizationError) {
      return json(res, e.statusCode, { error: e.message, code: e.code });
    }
    if (e instanceof SupabaseMigrationRequiredError) {
      return json(res, e.statusCode, { error: e.message, code: e.code });
    }
    if (e instanceof ApplicationRepositoryError && e.statusCode < 500) {
      return json(res, e.statusCode, { error: e.message, code: e.code });
    }
    if (e instanceof ReviewLifecycleConflictError) {
      return json(res, 409, { error: e.message, code: 'review_lifecycle_conflict' });
    }
    console.error('[server] error:', e);
    json(res, 500, { error: 'Internal server error' });
  }
  });
}

// Importing this module for authenticated HTTP tests must not open the fixed
// desktop port or initialize local-only Dynamic Testing state.
const launchedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (launchedDirectly) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  // Dynamic Testing initializes its local database when a Dynamic route needs it.
  const server = createSidecarServer();
  server.listen(Number(PORT), HOST, () => {
    console.error(`[server] Centinel sidecar listening on ${HOST}:${PORT}`);
  });
  process.on('SIGTERM', () => { server.close(); process.exit(0); });
}
