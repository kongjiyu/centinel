#!/usr/bin/env node
import { analysisMapFromEvents } from './review/assessmentBatches.js';
import {UnitRepository} from './dynamic/unit/repository.js';
import {handleUnitRoute} from './dynamic/unit/routes.js';
import {executeUnit,cancelUnit} from './dynamic/unit/executor.js';
import {UnitReportRepository,handleUnitReportRoute} from './dynamic/unit/reports.js';
import {SupabaseDynamicReportRepository} from './dynamic/reports/repository.js';
import {handleDynamicReportRoute} from './dynamic/reports/routes.js';
import {SharedEvidenceRepository} from './dynamic/sharedEvidence/repository.js';
import {handleEvidenceCopyRoute} from './dynamic/sharedEvidence/routes.js';
import {evidenceStorageClient} from './dynamic/sharedEvidence/client.js';
import {handleFindingRoute} from './dynamic/findings/routes.js';
import {SupabaseFindingRepository} from './dynamic/findings/repository.js';
import {DownloadVault} from './dynamic/environment/downloadVault.js';
import {handleDownloadRoute} from './dynamic/environment/downloadRoutes.js';
import { HookRepository } from './dynamic/workspace/hookRepository.js';
import { handleHookRoute } from './dynamic/workspace/hookRoutes.js';
import { executeHook, attemptAutomaticCleanup } from './dynamic/workspace/hookExecutor.js';
import { WorkspaceRegistry } from './dynamic/workspace/registry.js';
import { handleWorkspaceRoute } from './dynamic/workspace/routes.js';
import { containsLocalValue } from './dynamic/environment/secrets.js';
import { EnvironmentRepository } from './dynamic/environment/repository.js';
import {EnvironmentSessionVault,sessionSensitiveValues,type LocalSessionRecord} from './dynamic/environment/sessionVault.js';
import {EnvironmentSessionBroker} from './dynamic/environment/sessionBroker.js';
import {SessionCaptureRepository} from './dynamic/environment/captureRepository.js';
import {handleSessionRoute} from './dynamic/environment/sessionRoutes.js';
import {UploadVault} from './dynamic/environment/uploadVault.js';
import {handleUploadRoute} from './dynamic/environment/uploadRoutes.js';
import { EnvironmentVault } from './dynamic/environment/vault.js';
import { handleEnvironmentRoute } from './dynamic/environment/routes.js';
import { checkEnvironment, environmentReady } from './dynamic/environment/preflight.js';
import { handleDynamicRoute } from './dynamic/routes.js';
import { DynamicService } from './dynamic/service.js';
import { DynamicContractError } from './dynamic/types.js';
import { SupabaseDynamicRepository } from './dynamic/supabaseRepository.js';
import { executeMissionRun } from './dynamic/runnerBridge.js';

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config as readEnv } from 'dotenv';
import { getProject, ensureDynamicWorkspace } from './projects';
import { CollaborationError } from './githubTypes.js';
import { SupabaseGithubCollaborationService } from './githubCollaboration.js';
import { getCodexBackend, closeCodexBackends, type CodexBackend } from './model/codex.js';
import { testCodexProvider } from './model/codexTest.js';
import { ModelProviderError } from './review/retry.js';
import { ModelConfigurationError, resolveModelProviderChain, SupabaseModelConfigurationRepository } from './review/modelProviderResolver.js';
import { testTextProvider, testVisionProvider } from './aiClient';
import {
  listDynamicSessions,
  getDynamicSession,
  listDynamicEvidence,
  updateDynamicSessionStatus,
  getEvidenceProjectId,
} from './dynamicSessions';
import { cancelSession } from './dynamicRunner';
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
import { listModelProviderSettings, resolveSavedProviderForTest, saveModelProviderSetting, SupabaseMigrationRequiredError, type UpdateModelProviderSetting } from './modelSettings.js';
import { getEmbeddingSettingsCatalog } from './embeddingSettings.js';
import { testSavedEmbeddingModel } from './embeddingConnectionTest.js';
import { getSupabaseModelUsageSummary } from './modelUsageSummary.js';
import { ApplicationRepositoryAuthorizationError, ApplicationRepositoryError, CentinelApplicationRepository } from './applicationRepository.js';
import { getClientArtifact, readClientArtifactBytes, importLocalRepositoryArtifacts, listClientArtifacts, readClientArtifactContent, uploadClientArtifact } from './applicationApi.js';
import { getLatestLocalImportCoverage, inspectLocalRepository, recordLocalImportCoverageBaseline } from './applicationApi.js';
import { readFrozenReviewSource } from './review/frozenSourceContent.js';
import { accessTokenFingerprint, createRefreshableStaticReviewRuntime, RefreshableSupabaseRuntime, type RefreshableStaticReviewRuntime } from './runtime/index.js';
import { indexFrozenArtifacts, retrieveFrozenContext, describeRepositoryIndex, DEFAULT_REPOSITORY_INDEX_CACHE_ROOT } from './review/localRepositoryIndex.js';
import { inspectPublishedRepositoryIndex, syncPublishedRepositoryIndex } from './review/repositoryIndexSync.js';
import { handleRepositoryIndexSyncRoute } from './review/repositoryIndexSyncRoutes.js';
import { SourceIndexCoordinator } from './review/sourceIndexJobs.js';
import { SupabaseSourceIndexJobStore } from './review/sourceIndexJobStore.js';
import { LocalRepositoryReconciliationCoordinator } from './integrations/localRepositoryReconciliation.js';
import { optionalValidatedBatchCache } from './review/batchCheckpoint.js';
import { createGroundingModelProvider } from './review/groundingProvider.js';
import { runStaticAnalysis } from './staticEngine.js';
import { REVIEW_HARNESS } from './review/harness.js';
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
import { queueGitHubProjectImport } from './integrations/projectImport.js';
import { ConnectedSourceWorkerCoordinator } from './integrations/sourceWorker.js';
import { isSupabaseJwtIssuedAtFuture } from './supabase.js';
import { createProjectReadinessCoordinator } from './readiness/runtime.js';
import { handleProjectReadinessRoute } from './readiness/routes.js';
import type { ProjectReadinessCoordinator } from './readiness/service.js';
import { loadCurrentProjectFindings } from './review/currentProjectFindings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
readEnv({ path: path.resolve(__dirname, '../../.env') });
logRuntimeConfigStatus();

const evidenceDir = path.resolve(__dirname, '../../evidence/phase-0');
const dataDir = path.resolve(__dirname, '../../data');
const FUTURE_JWT_MESSAGE = 'Supabase rejected the signed session as not yet valid. Verify that the device date and time are correct, then retry. If the device time is correct, this may be a temporary Supabase Auth/PostgREST time-validation issue.';

function sendConnectionStatusUnavailable(res: http.ServerResponse, cause: unknown): void {
  if (isSupabaseJwtIssuedAtFuture(cause)) {
    json(res, 503, { code: 'supabase_jwt_future', error: FUTURE_JWT_MESSAGE });
    return;
  }
  json(res, 503, {
    code: 'connection_status_unavailable',
    error: 'Connection status could not be verified. Your saved connection has not been changed. Retry shortly.',
  });
}

function parseJsonBody(req: http.IncomingMessage, maximumBytes?:number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';let bytes=0;let oversized=false;
    req.on('data', chunk => {if(oversized)return;bytes+=Buffer.byteLength(chunk);if(maximumBytes!==undefined&&bytes>maximumBytes){oversized=true;body='';reject(new DynamicContractError(400,'Local upload request exceeds its size limit.'));return;}body += chunk; });
    req.on('end', () => {
      if(oversized)return;
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

const PORT = Number(process.env.CENTINEL_SIDECAR_PORT || 37701);
const HOST = 'localhost';
type CachedReviewRuntime = {
  authRuntime: RefreshableSupabaseRuntime;
  staticRuntime: RefreshableStaticReviewRuntime;
  orchestrator: StaticReviewOrchestratorService;
  recoveryPromise: Promise<void>;
};
function adoptVerifiedReviewSession(auth: AuthenticatedRequest, reviewRuntimes: Map<string, CachedReviewRuntime>): void {
  const existing = reviewRuntimes.get(auth.userId);
  if (existing && existing.authRuntime.state().tokenFingerprint !== accessTokenFingerprint(auth.accessToken)) {
    existing.authRuntime.adoptVerifiedSession(auth);
  }
}

function reviewRepository(client: SupabaseClient): SupabaseStaticReviewRepository {
  return new SupabaseStaticReviewRepository(client);
}

async function reviewRuntime(auth: AuthenticatedRequest, indexes: SourceIndexCoordinator, reviewRuntimes: Map<string, CachedReviewRuntime>): Promise<StaticReviewOrchestratorService> {
  const existing = reviewRuntimes.get(auth.userId);
  if (existing) {
    adoptVerifiedReviewSession(auth, reviewRuntimes);
    await existing.recoveryPromise;
    return existing.orchestrator;
  }
  const authRuntime = new RefreshableSupabaseRuntime({ userId: auth.userId, accessToken: auth.accessToken, client: auth.client, verifiedIssuedAt: auth.verifiedIssuedAt });
  const staticRuntime = createRefreshableStaticReviewRuntime(authRuntime);
  const orchestrator = createStaticReviewOrchestrator({
    ...staticRuntime.dependencies,
    batchCache: optionalValidatedBatchCache(() => authRuntime.client, auth.userId),
    cacheOwnerId: auth.userId,
    artifacts: (projectId, signal) => authRuntime.withClient(async client => {
      if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
      return listClientArtifacts(new CentinelApplicationRepository(client, auth.userId), projectId, signal);
    }),
    readArtifactBytes: (artifact, signal) => authRuntime.withClient(client => readClientArtifactBytes(client, auth.userId, artifact, signal)),
    readArtifactContent: (artifact, signal) => authRuntime.withClient(async client => {
      if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
      return readClientArtifactContent(client, auth.userId, artifact.id, artifact.versionId, signal, artifact.projectId);
    }),
    index: (projectId, artifacts, signal, reviewId, frozenReader) =>
      indexes.ensure(auth, projectId, artifacts, signal, reviewId, frozenReader),
    context: (projectId, _reviewType, maxTokens, signal, artifacts, reviewId, queryText, frozenReader) =>
      retrieveFrozenContext(() => authRuntime.client, auth.userId, projectId, artifacts ?? [], maxTokens, signal, reviewId, queryText, frozenReader),
    deterministic: (projectId, artifacts, reviewId, signal, harness, frozenReader) => authRuntime.withClient(async client => ({
      findings: await runStaticAnalysis(projectId, artifacts, reviewId, {
        signal,
        harness,
        contentReader: frozenReader ?? ((artifact, contentSignal) => readClientArtifactContent(client, auth.userId, artifact.id, artifact.versionId, contentSignal, artifact.projectId)),
      }),
      persisted: false,
    })),
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
    completedAt: review.progress?.stage === 'complete' ? review.progress.updatedAt : null,
    modelStatus: review.modelStatus,
    baseRef: typeof config.baseRef === 'string' ? config.baseRef : '',
    headRef: typeof config.headRef === 'string' ? config.headRef : '',
    changedFilesJson: JSON.stringify([]),
    parentSessionId: review.lineage.parentReviewId ?? '',
    reviewDiffJson: '',
    scope,
  };
}

export function createSidecarServer(authGateway: AuthGateway = createAuthGateway(), options: { codexBackend?: (ownerId: string) => CodexBackend; readinessCoordinator?: ProjectReadinessCoordinator } = {}): http.Server {
  const codexBackend = options.codexBackend ?? getCodexBackend;
  const readiness = options.readinessCoordinator ?? createProjectReadinessCoordinator();
  const reviewRuntimes = new Map<string, CachedReviewRuntime>();
  const sourceIndexes = new SourceIndexCoordinator({
    store: context => new SupabaseSourceIndexJobStore(context.client, context.userId),
    artifacts: (context, projectId, signal) => listClientArtifacts(new CentinelApplicationRepository(context.client, context.userId), projectId, signal),
    describe: (context, projectId, artifacts, signal) => describeRepositoryIndex(context.client, context.userId, projectId, artifacts, signal),
    build: (context, projectId, artifacts, signal, guard, reviewId, reader) => indexFrozenArtifacts(() => context().client,
      context().userId, projectId, artifacts, signal, reviewId, reader, DEFAULT_REPOSITORY_INDEX_CACHE_ROOT, guard),
    onError: code => console.error('[source-index]', code),
  });
  const queueSourceIndex = async (context: AuthenticatedRequest, projectId: string) => {
    try { await sourceIndexes.notify(context, projectId); }
    catch { console.error('[source-index] source event could not be queued; explicit indexing is required.'); }
  };
  const localRepositoryChanges = new LocalRepositoryReconciliationCoordinator({
    sources: (context, projectId) => new CentinelApplicationRepository(context.client, context.userId).listSources(projectId),
    project: (context, projectId) => new CentinelApplicationRepository(context.client, context.userId).getProject(projectId),
    artifacts: (context, projectId) => listClientArtifacts(new CentinelApplicationRepository(context.client, context.userId), projectId),
    inspect: inspectLocalRepository,
    coverage: (context, projectId, rootHash) => getLatestLocalImportCoverage(new CentinelApplicationRepository(context.client, context.userId), projectId, rootHash),
    recordBaseline: (context, projectId, coverage, inventory) => recordLocalImportCoverageBaseline(
      new CentinelApplicationRepository(context.client, context.userId), projectId, coverage, inventory),
    importRepository: async (context, projectId, repoPath, inventory, priorCoverage, pruneArtifactIds) => {
      const result = await importLocalRepositoryArtifacts(new CentinelApplicationRepository(context.client, context.userId), projectId, repoPath,
        { observedInventory: inventory, priorCoverage: priorCoverage ?? undefined, pruneArtifactIds });
      return { complete: result.complete };
    },
    onChanged: async (context, projectId) => {
      readiness.notify(context, projectId, 'repository_imported');
      await queueSourceIndex(context, projectId);
    },
    onError: code => console.error('[local-repository]', code),
  });
  const sessionVault=new EnvironmentSessionVault(path.join(dataDir,'dynamic-browser-sessions'));const sessionBroker=new EnvironmentSessionBroker(sessionVault);
  const sourceWorker = new ConnectedSourceWorkerCoordinator({
    createImporter: connectedSourceImporter,
    onRunFinished: async (auth, job, run) => {
      readiness.notify(auth, job.projectId, 'source_sync_finished');
      if (run.status === 'success') await queueSourceIndex(auth, job.projectId);
    },
    onRunFailed: (auth, job) => readiness.notify(auth, job.projectId, 'source_sync_failed'),
    onUnexpectedError: cause => {
      const record = cause && typeof cause === 'object' ? cause as { code?: unknown; name?: unknown } : {};
      const code = typeof record.code === 'string' ? record.code : typeof record.name === 'string' ? record.name : 'source_worker_error';
      console.error('[sources] background import stopped:', code);
    },
  });
  const server=http.createServer(async (req, res) => {
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
      return json(res, 200, { status: 'ok', service: 'centinel-sidecar', workspace: path.resolve(__dirname, '../..') });
    }

    // Provider callbacks are authenticated by their short-lived OAuth state.
    // Every other sidecar route derives identity exclusively from the verified
    // Supabase bearer token. X-Centinel-User-Id remains a renderer diagnostic
    // and can never grant access.
    const oauthCallback = req.method === 'GET' && Boolean(matchIntegrationCallback(url));
    const auth = oauthCallback ? null : await authGateway.authenticate(req.headers);
    // Ordinary authenticated polling carries refreshed credentials too. Do
    // not require another Start/Retry POST to renew a running owner's client.
    if (auth) adoptVerifiedReviewSession(auth, reviewRuntimes);
    if (auth) sourceWorker.adoptSession(auth);
    if (auth) readiness.adoptSession(auth);
    if (auth) sourceIndexes.adoptSession(auth);
    const accessToken = auth?.accessToken ?? null;
    const ownerId = auth?.userId ?? '';
    const applicationRepository = auth ? new CentinelApplicationRepository(auth.client, auth.userId) : null;
    const sourceIndexBuildMatch = url.match(/^\/projects\/([^/]+)\/repository-index\/build$/);
    if (auth && sourceIndexBuildMatch && ['GET', 'POST'].includes(req.method ?? '')) {
      const projectId = sourceIndexBuildMatch[1];
      await authGateway.requireProjectMember(auth, projectId);
      const job = req.method === 'POST' ? await sourceIndexes.resume(auth, projectId) : await sourceIndexes.recover(auth, projectId);
      // Lease capabilities stay server-side.
      return json(res, 200, job ? { state: job.state, fingerprint: job.fingerprint, updatedAt: job.updatedAt, errorCode: job.errorCode } : { state: 'none' });
    }
    if (auth && /^\/projects\/[^/]+\/repository-index\/sync$/.test(url)) {
      await authGateway.requireProjectMember(auth, url.split('/')[2]);
      await sourceIndexes.recover(auth, url.split('/')[2]);
      const transfer = new AbortController();
      const stopTransfer = () => transfer.abort();
      res.once('close', stopTransfer);
      const indexSyncResponse = await handleRepositoryIndexSyncRoute({ method: req.method ?? 'GET', pathname: url, auth, signal: transfer.signal }, {
        requireMember: (context, projectId) => authGateway.requireProjectMember(context, projectId),
        listArtifacts: (context, projectId, signal) => listClientArtifacts(new CentinelApplicationRepository(context.client, context.userId), projectId, signal),
        describe: (context, projectId, artifacts, signal) => describeRepositoryIndex(context.client, context.userId, projectId, artifacts, signal),
        inspect: (context, projectId, identity, signal) => inspectPublishedRepositoryIndex(context.client, context.userId, projectId, identity, DEFAULT_REPOSITORY_INDEX_CACHE_ROOT, signal),
        sync: (context, projectId, identity, signal) => syncPublishedRepositoryIndex(context.client, context.userId, projectId, identity, DEFAULT_REPOSITORY_INDEX_CACHE_ROOT, signal),
      }).finally(() => res.removeListener('close', stopTransfer));
      if (indexSyncResponse) return json(res, indexSyncResponse.status, indexSyncResponse.body);
    }
    if (auth) {
      const readinessResponse = await handleProjectReadinessRoute({ method: req.method ?? 'GET', pathname: url, auth }, {
        coordinator: readiness, requireMember: (context, projectId) => authGateway.requireProjectMember(context, projectId),
        recoverSources: options.readinessCoordinator ? undefined : async (context, projectId) => {
          const sources = await new SupabaseConnectedSourceRepository(context.client).listSources(projectId);
          sourceWorker.recoverProject(context, projectId, sources);
        },
      });
      if (readinessResponse) return json(res, readinessResponse.status, readinessResponse.body);
    }

    if (auth && /^\/projects\/[^/]+\/dynamic\//.test(url)) {
      const environments = new EnvironmentRepository(auth.client);
      const vault = new EnvironmentVault(path.join(dataDir, 'dynamic-environment-values'));
      const uploads=new UploadVault(path.join(dataDir,'dynamic-uploads'));
      const uploadResponse=await handleUploadRoute({method:req.method??'GET',pathname:url,readBody:()=>parseJsonBody(req,1_500_000)}, {ownerId,vault:uploads,repository:environments,requireMember:projectId=>authGateway.requireProjectMember(auth,projectId),secretValues:async projectId=>(await environments.list(projectId)).flatMap(profile=>[...Object.values(vault.read(ownerId,projectId,profile.id)),...(profile.sessionReference?sessionVault.knownValues(ownerId,projectId,profile.id,profile.sessionReference):[])])});if(uploadResponse)return json(res,uploadResponse.status,uploadResponse.body);
      const privateValues=(projectId:string,profile:import('./dynamic/environment/types.js').EnvironmentProfile)=>[...Object.values(vault.read(ownerId,projectId,profile.id)),...uploads.list(ownerId,projectId,profile.id).map(file=>file.name),...(profile.sessionReference?sessionVault.knownValues(ownerId,projectId,profile.id,profile.sessionReference):[])];
      const uploadsReady=(projectId:string,profile:import('./dynamic/environment/types.js').EnvironmentProfile)=>{try{for(const grant of profile.actionPolicy?.uploads??[])uploads.resolve(ownerId,projectId,profile.id,grant);return true;}catch{return false;}};
      const sessionStatus=(projectId:string,profile:import('./dynamic/environment/types.js').EnvironmentProfile)=>({...profile.sessionReference?sessionVault.status(ownerId,projectId,profile.id,profile.sessionReference,profile.allowedOrigins):{availability:'not_configured'},captureActive:['open','opening'].includes(sessionBroker.status(ownerId,projectId,profile.id)?.state??'')});
      const downloadedFiles=new DownloadVault(path.join(dataDir,'dynamic-downloads'));
      const service = new DynamicService(new SupabaseDynamicRepository(auth.client));
      const downloadResponse=await handleDownloadRoute({method:req.method??'GET',pathname:url,readBody:()=>parseJsonBody(req,100_000)},{ownerId,vault:downloadedFiles,environments,service,requireMember:projectId=>authGateway.requireProjectMember(auth,projectId),privateValues:async projectId=>(await environments.list(projectId)).flatMap(profile=>privateValues(projectId,profile))});if(downloadResponse)return json(res,downloadResponse.status,downloadResponse.body);
      const sessionResponse=await handleSessionRoute({method:req.method??'GET',pathname:url,readBody:()=>parseJsonBody(req)},{ownerId,repository:environments,vault:sessionVault,broker:sessionBroker,captures:new SessionCaptureRepository(auth.client),requireMember:projectId=>authGateway.requireProjectMember(auth,projectId)});if(sessionResponse)return json(res,sessionResponse.status,sessionResponse.body);
      const workspaceRegistry=new WorkspaceRegistry(path.join(dataDir,'dynamic-workspaces'));
      const hooks=new HookRepository(auth.client);const receiptRoot=path.join(dataDir,'dynamic-hook-output');
      const hookResponse=await handleHookRoute({method:req.method??'GET',pathname:url,readBody:()=>parseJsonBody(req)}, {
        ownerId,repository:hooks,registry:workspaceRegistry,receiptRoot,requireMember:projectId=>authGateway.requireProjectMember(auth,projectId),requireEnvironment:(projectId,id)=>environments.get(projectId,id),
        execute:async operation=>{try{await executeHook({ownerId,operation,repository:hooks,registry:workspaceRegistry,vault,receiptRoot});}finally{if(operation.kind==='setup')await attemptAutomaticCleanup({ownerId,projectId:operation.projectId,profileId:operation.environmentId,sourceId:operation.id,sourceKind:'setup',repository:hooks,registry:workspaceRegistry,vault,receiptRoot,environmentRepository:environments});}},
      });
      if(hookResponse)return json(res,hookResponse.status,hookResponse.body);
      const unitResponse=await handleUnitRoute({method:req.method??'GET',pathname:url,readBody:()=>parseJsonBody(req,10000)},{ownerId,registry:workspaceRegistry,repository:new UnitRepository(auth.client),requireMember:projectId=>authGateway.requireProjectMember(auth,projectId),cancel:cancelUnit,prepare:async(projectId,profileId)=>{const profile=await environments.get(projectId,profileId),values=vault.read(ownerId,projectId,profileId);if(profile.requiredVariables.some(name=>!values[name]))throw new DynamicContractError(409,'Configure this environment’s required local variables before unit execution.');},execute:async run=>{try{await executeUnit({ownerId,run,registry:workspaceRegistry,repository:new UnitRepository(auth.client),vault,receiptRoot:path.join(dataDir,'dynamic-unit-output')});}finally{await attemptAutomaticCleanup({ownerId,projectId:run.projectId,profileId:run.environmentId,sourceId:run.id,sourceKind:'unit',repository:hooks,registry:workspaceRegistry,vault,receiptRoot,environmentRepository:environments});}}});
      if(unitResponse)return json(res,unitResponse.status,unitResponse.body);
      const unitReportResponse=await handleUnitReportRoute({method:req.method??'GET',pathname:url,readBody:()=>parseJsonBody(req,10000)},{repository:new UnitReportRepository(auth.client),requireMember:projectId=>authGateway.requireProjectMember(auth,projectId)});
      if(unitReportResponse){if('mimeType' in unitReportResponse&&Buffer.isBuffer(unitReportResponse.body)){res.writeHead(200,{'Content-Type':unitReportResponse.mimeType,'Content-Length':unitReportResponse.body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="${unitReportResponse.filename}"`,'X-Centinel-SHA256':unitReportResponse.sha256,'Access-Control-Expose-Headers':'X-Centinel-SHA256, Content-Disposition'});res.end(unitReportResponse.body);return;}return json(res,unitReportResponse.status,unitReportResponse.body);}
      const workspaceResponse=await handleWorkspaceRoute({method:req.method??'GET',pathname:url,readBody:()=>parseJsonBody(req)}, {
        ownerId,registry:workspaceRegistry,requireMember:projectId=>authGateway.requireProjectMember(auth,projectId),requireEnvironment:(projectId,id)=>environments.get(projectId,id),secretValues:async(projectId,id)=>privateValues(projectId,await environments.get(projectId,id)),
      });
      if(workspaceResponse)return json(res,workspaceResponse.status,workspaceResponse.body);
      const environmentResponse = await handleEnvironmentRoute({method:req.method??'GET',pathname:url,readBody:()=>parseJsonBody(req)}, {
        ownerId,repository:environments,vault,privateValues,sessionStatus,uploadsReady,requireMember:projectId=>authGateway.requireProjectMember(auth,projectId),
        providerReady:async projectId=>{try {
          const chain=await resolveModelProviderChain(new SupabaseModelConfigurationRepository(auth.client),{ownerId,projectId,purpose:'vision'});
          return chain.primary.provider==='codex' ? (await getCodexBackend(ownerId).status()).connected : Boolean(chain.primary.apiKey);
        }catch{return false;}},
      });
      if(environmentResponse)return json(res,environmentResponse.status,environmentResponse.body);
      const evidenceResponse=await handleEvidenceCopyRoute({method:req.method??'GET',pathname:url},{ownerId,downloadVault:downloadedFiles,privateValues:async projectId=>(await environments.list(projectId)).flatMap(profile=>privateValues(projectId,profile)),repository:new SharedEvidenceRepository(auth.client,evidenceStorageClient(auth.accessToken)),service,requireMember:projectId=>authGateway.requireProjectMember(auth,projectId),workspace:async projectId=>{const project=await getProject(projectId);if(!project)throw new DynamicContractError(409,'This device has no local execution workspace for the project.');return project.workspacePath;}});
      if(evidenceResponse){if('mimeType' in evidenceResponse&&Buffer.isBuffer(evidenceResponse.body)){res.writeHead(200,{'Content-Type':evidenceResponse.mimeType,'Content-Length':evidenceResponse.body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...('attachment' in evidenceResponse&&evidenceResponse.attachment?{'Content-Disposition':'attachment; filename="captured-test-file.bin"'}:{})});res.end(evidenceResponse.body);return;}return json(res,evidenceResponse.status,evidenceResponse.body);}
      const reportResponse=await handleDynamicReportRoute({method:req.method??'GET',pathname:url,readBody:()=>parseJsonBody(req,10000)},{repository:new SupabaseDynamicReportRepository(auth.client),requireMember:projectId=>authGateway.requireProjectMember(auth,projectId)});
      if(reportResponse){if('mimeType' in reportResponse&&Buffer.isBuffer(reportResponse.body)){res.writeHead(200,{'Content-Type':reportResponse.mimeType,'Content-Length':reportResponse.body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="${reportResponse.filename}"`,'X-Centinel-SHA256':reportResponse.sha256,'Access-Control-Expose-Headers':'X-Centinel-SHA256, Content-Disposition'});res.end(reportResponse.body);return;}return json(res,reportResponse.status,reportResponse.body);}
      const findingResponse=await handleFindingRoute({method:req.method??'GET',pathname:url,readBody:()=>parseJsonBody(req,100_000)},{repository:new SupabaseFindingRepository(auth.client),requireMember:projectId=>authGateway.requireProjectMember(auth,projectId),validatePrivate:async(projectId,value)=>{const secrets=(await environments.list(projectId)).flatMap(profile=>privateValues(projectId,profile));if(containsLocalValue(value,secrets))throw new DynamicContractError(400,'Keep private local values out of shared finding decisions.');}});
      if(findingResponse)return json(res,findingResponse.status,findingResponse.body);
      const response = await handleDynamicRoute({ method: req.method ?? 'GET', pathname: url, readBody: () => parseJsonBody(req) }, {
        actorId: ownerId,
        validateAuthoring: async (projectId,body)=>{
          const profiles=await environments.list(projectId);
          const secrets=profiles.flatMap(profile=>privateValues(projectId,profile));
          if(containsLocalValue(body,secrets))throw new DynamicContractError(400,'Keep local variable values out of shared test fields.');
        },
        service,
        requireProjectMember: projectId => authGateway.requireProjectMember(auth, projectId),
        cancelExecution: run => { if (['cancelled', 'interrupted'].includes(run.state) && run.legacySessionId) cancelSession(run.legacySessionId); },
        prepareExecution: async (projectId, revisionId, environmentId) => {
          const sharedProject = await applicationRepository!.getProject(projectId);
          if (!sharedProject) throw new AuthGatewayError('Project not found.', 404, 'not_found');
          const profile = environmentId ? await environments.get(projectId, environmentId) : null;
          if (profile) {
            const revision = await service.repository.getRevision(projectId, revisionId!);
            if (!revision || new URL(revision.targetUrl).origin !== new URL(profile.targetUrl).origin) throw new DynamicContractError(400, 'Environment and test must use the same website origin.');
            const secrets = privateValues(projectId,profile);
            if (containsLocalValue({revision,profile},secrets)) throw new DynamicContractError(400, 'Keep local variable values out of test and shared environment fields.');
          }
          if(!profile){const revision=await service.repository.getRevision(projectId,revisionId!);if(revision){const targetOrigin=new URL(revision.targetUrl).origin;for(const candidate of await environments.list(projectId)){if(candidate.dataResourceKey&&new URL(candidate.targetUrl).origin===targetOrigin&&(await environments.data(projectId,candidate.id)).resource?.reserved)throw new DynamicContractError(409,'Choose a saved environment for this reserved target data. Finish the owning environment cleanup first.');}}}
          let localSession:LocalSessionRecord|null=null;let sessionInfo:{availability:string;reason?:string;captureActive?:boolean;version?:string;expiresAt?:string}|undefined;
          if(profile?.sessionReference){try{localSession=sessionVault.read(ownerId,projectId,profile.id,profile.sessionReference,profile.allowedOrigins);sessionInfo=localSession?{availability:'available',version:localSession.version,expiresAt:localSession.expiresAt}:{availability:'missing'};}catch(error){sessionInfo={availability:'unavailable',reason:error instanceof DynamicContractError?error.message:'Local session unavailable.'};}sessionInfo.captureActive=['open','opening'].includes(sessionBroker.status(ownerId,projectId,profile.id)?.state??'');}
          const frozenVariables=profile?vault.read(ownerId,projectId,profile.id):{};const frozenValues=Object.values(frozenVariables);
          const modelRepository = new SupabaseModelConfigurationRepository(auth.client);
          let vision;
          try { vision = await resolveModelProviderChain(modelRepository, { ownerId, projectId, purpose: 'vision' }); }
          catch {
            if (profile) { const environment = await checkEnvironment(profile,vault.names(ownerId,projectId,profile.id),false,fetch,await environments.data(projectId,profile.id),sessionInfo,uploadsReady(projectId,profile));
              return {environment,execute: async run=>{await service.stop(projectId,run.id,'blocked','Environment preflight failed: configure a screenshot provider.');}};
            }
            throw new DynamicContractError(409, 'Configure and connect a Dynamic screenshot provider in Settings.');
          }
          const project = await ensureDynamicWorkspace(sharedProject);
          const browserExecute = async(run: import('./dynamic/types.js').DynamicRun) => {if(localSession&&Date.parse(localSession.expiresAt)<=Date.now()){await service.stop(projectId,run.id,'blocked','Local session expired before browser execution. Renew it on this device.');return;}return executeMissionRun(service, run, project.workspacePath, {
            vision: vision.primary,
            resolvePrivateValue:name=>profile?.requiredVariables.includes(name)?frozenVariables[name]:undefined,
            sensitiveSelectors:run.actionPolicy?.privateInputs?.map(grant=>grant.selector),
            retainDownload:(metadata,buffer)=>downloadedFiles.retain(ownerId,projectId,run.id,metadata,buffer),
            ...(run.environment?{resolveUpload:(grant:import('./dynamic/browser/fileTypes.js').UploadGrant)=>uploads.resolve(ownerId,projectId,run.environment!.id,grant)}:{}),
            sensitiveValues:[...frozenValues,...(localSession?sessionSensitiveValues(localSession):[])],
            storageState:localSession?.state,
            recordUsage: usage => new SupabaseCentinelStore(auth.client).saveModelUsage({
              ownerId, projectId, reviewSessionId: null, stage: usage.stage ?? 'dynamic-action', attempt: 1,
              provider: usage.provider, model: usage.model, outcome: 'success', inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens ?? null,
              cacheCreationTokens: usage.cacheCreationTokens ?? null, durationMs: null, errorCode: null, cost: null,
              metadata: { callKind: 'dynamic', runId: run.id, scope: usage.scope, apiFormat: usage.apiFormat },
            }),
          });};
          const execute=async(run:import('./dynamic/types.js').DynamicRun)=>{
            try{await browserExecute(run);}finally{
              await service.recover(projectId).catch(()=>{});
              if(run.environment)await attemptAutomaticCleanup({ownerId,projectId,profileId:run.environment.id,sourceId:run.id,sourceKind:'browser',repository:hooks,registry:workspaceRegistry,vault,receiptRoot,environmentRepository:environments});
            }
          };
          if (!profile) return execute;
          const ready = vision.primary.provider === 'codex' ? await getCodexBackend(ownerId).status().then(status=>status.connected).catch(()=>false) : Boolean(vision.primary.apiKey);
          const environment = await checkEnvironment(profile, vault.names(ownerId, projectId, profile.id), ready,fetch,await environments.data(projectId,profile.id),sessionInfo,uploadsReady(projectId,profile));
          return {environment, execute: async run => {
            if (!environmentReady(environment)) { await service.stop(projectId,run.id,'blocked','Environment preflight failed. Inspect the saved checks and startup instructions.'); return; }
            await execute(run);
          }};
        },
      });
      if (response) return json(res, response.status, response.body);
    }

    if (auth && isPhase2ReviewRoutePath(url)) {
      const phase2ReviewRoute = await handlePhase2ReviewRoute({
        method: req.method ?? 'GET',
        pathname: url,
        searchParams: requestUrl.searchParams,
        readBody: () => parseJsonBody(req),
      }, {
        actorId: ownerId,
        repository: reviewRepository(auth.client),
        orchestrator: await reviewRuntime(auth, sourceIndexes, reviewRuntimes),
        requireProjectMember: projectId => authGateway.requireProjectMember(auth, projectId),
        getArtifact: artifactId => getClientArtifact(auth.client, ownerId, artifactId),
        readArtifactContent: artifactId => readClientArtifactContent(auth.client, ownerId, artifactId),
        modelProvider: createGroundingModelProvider(auth.client, ownerId),
        presentReview: toClientStaticSession,
        onReviewCompletion: (completion, label) => {
          void completion.catch(error => console.error(`[review] ${label}:`, error));
        },
      });
      if (phase2ReviewRoute) {
        if (phase2ReviewRoute.status < 300 && req.method === 'POST' && /\/requirement-candidates\/[^/]+\/confirm$/.test(url)) readiness.notify(auth, url.split('/')[2], 'requirements_changed');
        return json(res, phase2ReviewRoute.status, phase2ReviewRoute.body);
      }
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
      try {
        const integration = await getIntegration('github', ownerId, accessToken);
        if (integration?.status === 'connected') {
          return json(res, 200, { connected: true, login: integration.accountLabel.replace(/^@/, ''), message: `Connected to GitHub as ${integration.accountLabel}.` });
        }
        return json(res, 200, { connected: false, login: null, message: integration ? 'GitHub repository access expired. Reconnect it in Settings.' : 'GitHub repository access is not connected.' });
      } catch (cause) {
        sendConnectionStatusUnavailable(res, cause);
        return;
      }
    }

    // External integrations. Tokens stay encrypted in the sidecar database;
    // these routes return metadata or an OAuth URL only.
    if (req.method === 'GET' && url === '/integrations') {
      try {
        return json(res, 200, await listIntegrations(ownerId, accessToken));
      } catch (cause) {
        sendConnectionStatusUnavailable(res, cause);
        return;
      }
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
        onSourcesRead: (context, projectId, sources) => sourceWorker.recoverProject(context, projectId, sources),
      },
    );
    if (connectedSourceResponse) {
      const responseBody = connectedSourceResponse.body && typeof connectedSourceResponse.body === 'object'
        ? connectedSourceResponse.body as Record<string, unknown>
        : {};
      const syncResult = responseBody.syncResult && typeof responseBody.syncResult === 'object'
        ? responseBody.syncResult as Record<string, unknown>
        : {};
      const run = (responseBody.run ?? syncResult.run) && typeof (responseBody.run ?? syncResult.run) === 'object'
        ? (responseBody.run ?? syncResult.run) as Record<string, unknown>
        : {};
      const projectSourcesMatch = url.match(/^\/projects\/([^/]+)\/sources(?:\/([^/]+)(?:\/(?:sync|sync-runs\/[^/]+\/resume))?)?$/);
      const source = responseBody.source && typeof responseBody.source === 'object'
        ? responseBody.source as Record<string, unknown>
        : {};
      const sourceId = projectSourcesMatch?.[2] ?? (typeof source.id === 'string' ? source.id : '');
      const runId = typeof run.id === 'string' ? run.id : '';
      if (projectSourcesMatch && auth && connectedSourceResponse.statusCode < 300
        && (req.method === 'POST' || req.method === 'DELETE')) readiness.notify(auth, projectSourcesMatch[1], 'source_changed');
      if (projectSourcesMatch && auth && connectedSourceResponse.statusCode < 300
        && (req.method === 'DELETE' || req.method === 'POST' && run.status === 'success')) await queueSourceIndex(auth, projectSourcesMatch[1]);
      if (req.method === 'POST' && connectedSourceResponse.statusCode < 300 && run.status === 'partial'
        && !run.errorCode && projectSourcesMatch && sourceId && runId && auth) {
        json(res, connectedSourceResponse.statusCode, connectedSourceResponse.body);
        sourceWorker.enqueue(auth, { projectId: projectSourcesMatch[1], sourceId, runId });
        return;
      }
      return json(res, connectedSourceResponse.statusCode, connectedSourceResponse.body);
    }

    const integrationMatch = matchIntegration(url);
    if (integrationMatch) {
      const provider = normalizeProvider(integrationMatch.provider);
      if (!provider) return json(res, 404, { error: 'Unsupported integration provider' });
      if (req.method === 'GET') return json(res, 200, await getIntegration(provider, ownerId, accessToken));
    }

    // Local Codex credentials are selected only by verified Centinel identity.
    if (url.startsWith('/settings/codex')) {
      const backend = codexBackend(ownerId);
      if (url === '/settings/codex' && req.method === 'GET') return json(res, 200, await backend.status());
      if (url === '/settings/codex/login' && req.method === 'POST') return json(res, 200, await backend.login());
      if (url === '/settings/codex/logout' && req.method === 'POST') { await backend.logout(); return json(res, 200, { ok: true }); }
      if (url === '/settings/codex/login/cancel' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (typeof body.loginId !== 'string' || !body.loginId.trim()) return json(res, 400, { error: 'loginId is required' });
        await backend.cancelLogin(body.loginId); return json(res, 200, { ok: true });
      }
      if (url === '/settings/codex/models' && req.method === 'GET') return json(res, 200, await backend.models(true));
      if (url === '/settings/codex/test' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (typeof body.model !== 'string' || !body.model.trim()) return json(res, 400, { error: 'model is required' });
        const controller = new AbortController();
        const disconnected = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', disconnected);
        try {
          const result = await testCodexProvider(backend, body.model, body.vision === true, controller.signal);
          await new SupabaseCentinelStore(auth!.client).saveModelUsage({
            projectId: null, reviewSessionId: null, ownerId, stage: body.vision === true ? 'vision-provider-test' : 'provider-test',
            attempt: 1, provider: 'codex', model: body.model, outcome: result.status === 'pass' ? 'success' : 'failure',
            inputTokens: result.usage?.inputTokens ?? null, outputTokens: result.usage?.outputTokens ?? null,
            cacheReadTokens: result.usage?.cacheReadTokens ?? null, cacheCreationTokens: null, durationMs: null, errorCode: null, cost: null,
            metadata: { apiFormat: 'codex-app-server', callKind: 'test', scope: body.vision === true ? 'vision' : 'text' },
          }).catch(() => {});
          return json(res, 200, result);
        } finally { res.removeListener('close', disconnected); }
      }
    }

    // AI Settings
    if (req.method === 'GET' && url === '/settings/ai') {
      return json(res, 200, await listModelProviderSettings(auth!.client, ownerId));
    }

    if (req.method === 'GET' && url === '/settings/ai/embedding/models') {
      return json(res, 200, await getEmbeddingSettingsCatalog(auth!.client, ownerId));
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
          embeddingProvider: body.embeddingProvider as UpdateModelProviderSetting['embeddingProvider'],
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
      const test = await testSavedEmbeddingModel(auth!.client, ownerId);
      // A completed diagnostic has a pass/fail outcome, just like text/vision
      // tests. Keep its safe message and usage warning available to the form.
      return json(res, 200, test.result);
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
      const startedAt = Date.now();
      let result: any;
      let providerFailure: unknown;
      try {
        result = provider.provider === 'codex'
          ? await testCodexProvider(codexBackend(ownerId), provider.model, id === 'vision')
          : id === 'vision' ? await testVisionProvider(provider, screenshotPath) : await testTextProvider(provider);
      } catch (error) {
        providerFailure = error;
      }
      const errorRecord = providerFailure && typeof providerFailure === 'object' ? providerFailure as Record<string, unknown> : {};
      const rawUsage = result?.usage ?? errorRecord.usage;
      const usageRecord = rawUsage && typeof rawUsage === 'object' && !Array.isArray(rawUsage)
        ? rawUsage as Record<string, unknown> : {};
      const safeCount = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
      const usageObservationRecord = (value: unknown): Record<string, unknown> | undefined => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        const item = value as Record<string, unknown>;
        const sources = new Set(['provider_response', 'provider_error_response', 'codex_thread_total', 'codex_turn_last']);
        if (!sources.has(String(item.source)) || item.completeness !== 'complete' && item.completeness !== 'partial') return undefined;
        const allowedCounters = new Set(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'totalTokens']);
        const missingCounters = Array.isArray(item.missingCounters)
          ? [...new Set(item.missingCounters.filter((counter): counter is string => typeof counter === 'string' && allowedCounters.has(counter)))] : [];
        return { source: item.source, completeness: item.completeness, ...(missingCounters.length ? { missingCounters } : {}) };
      };
      const observation = usageObservationRecord(usageRecord.usageObservation ?? errorRecord.usageObservation);
      const inputTokens = safeCount(usageRecord.inputTokens);
      const outputTokens = safeCount(usageRecord.outputTokens);
      const cacheReadTokens = safeCount(usageRecord.cacheReadTokens);
      const cacheCreationTokens = safeCount(usageRecord.cacheCreationTokens);
      const providerReportedTotalTokens = safeCount(usageRecord.providerReportedTotalTokens);
      const totalTokens = safeCount(usageRecord.totalTokens);
      const totalTokensSource = usageRecord.totalTokensSource === 'provider_reported' || usageRecord.totalTokensSource === 'adapter_derived'
        ? usageRecord.totalTokensSource : undefined;
      const hasUsage = inputTokens !== undefined || outputTokens !== undefined || cacheReadTokens !== undefined
        || cacheCreationTokens !== undefined || providerReportedTotalTokens !== undefined || totalTokens !== undefined || observation !== undefined;
      const usage = hasUsage ? { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
        providerReportedTotalTokens, totalTokens, totalTokensSource, usageObservation: observation } : undefined;
      const statusCode = safeCount(errorRecord.statusCode);
      const responseReceived = typeof result?.responseReceived === 'boolean' ? result.responseReceived
        : typeof errorRecord.responseReceived === 'boolean' ? errorRecord.responseReceived
          : result?.status === 'pass' || statusCode !== undefined || hasUsage ? true : undefined;
      const usageAccounting = responseReceived === false && !hasUsage
        ? { basis: 'assumed_zero_no_response', accountedTokens: 0 } : undefined;
      // Provider errors can include a billable error response, or no response
      // at all. Record only counters and bounded diagnostics, never the body.
      if (typeof responseReceived === 'boolean') {
        try {
          await new SupabaseCentinelStore(auth!.client).saveModelUsage({
            projectId: null, reviewSessionId: null, ownerId,
            stage: id === 'text' ? 'provider-test' : 'vision-provider-test', attempt: 1,
            provider: provider.provider, model: provider.model, outcome: result?.status === 'pass' ? 'success' : 'permanent_error',
            inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null,
            cacheReadTokens: usage?.cacheReadTokens ?? null,
            cacheCreationTokens: usage?.cacheCreationTokens ?? null,
            durationMs: Date.now() - startedAt,
            errorCode: typeof errorRecord.code === 'string' && /^[a-z0-9_]{1,64}$/i.test(errorRecord.code) ? errorRecord.code : null,
            cost: null,
            metadata: { apiFormat: provider.apiFormat, callKind: 'test', scope: id, responseReceived,
              ...(observation ? { usageObservation: observation } : {}),
              ...(providerReportedTotalTokens !== undefined ? { providerReportedTotalTokens } : {}),
              ...(totalTokens !== undefined ? { normalizedTotalTokens: totalTokens,
                normalizedTotalTokensSource: totalTokensSource === 'adapter_derived' ? 'adapter_derived' : 'provider_reported' } : {}),
              ...(usageAccounting ? { usageAccounting } : {}),
              statusCode: statusCode !== undefined && statusCode >= 100 && statusCode <= 599 ? statusCode : null },
          });
        } catch (err) {
          console.error('[settings] failed to record test token usage:', err);
        }
      }
      if (providerFailure) throw providerFailure;
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
      let usageCallKind: 'review' | 'test' | 'dynamic' | undefined = callKindParam === 'review' || callKindParam === 'test' || callKindParam === 'dynamic' ? callKindParam : undefined;
      if (sessionId) {
        if (!projectId) return json(res, 400, { error: 'projectId is required when filtering usage by sessionId.' });
        await authGateway.requireProjectMember(auth!, projectId);
        const review = await reviewRepository(auth!.client).getReview(sessionId);
        if (!review || review.projectId !== projectId) {
          if (usageCallKind !== 'dynamic') return json(res, 404, { error: 'Session not found' });
          const dynamic = await getDynamicSession(projectId, sessionId);
          if (!dynamic || (usageCallKind && usageCallKind !== 'dynamic')) return json(res, 404, { error: 'Session not found' });
          usageCallKind = 'dynamic';
        }
      }
      else if (projectId) await authGateway.requireProjectMember(auth!, projectId);
      const summary = await getSupabaseModelUsageSummary(auth!.client, ownerId, {
        scope: scopeParam === 'text' || scopeParam === 'vision' || scopeParam === 'embedding' ? scopeParam : undefined,
        callKind: usageCallKind,
        sessionId,
        projectId,
      });
      return json(res, 200, summary);
    }

    // Projects
    if (req.method === 'GET' && url === '/projects') {
      const projects = await applicationRepository!.listProjects();
      localRepositoryChanges.observe(auth!, projects);
      return json(res, 200, projects);
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
        if (githubImporter) {
          try {
            if (!(await githubImporter.status(ownerId, 'github')).connected) {
              return json(res, 409, { error: 'Connect GitHub repository access before importing a GitHub project.' });
            }
          } catch (cause) {
            sendConnectionStatusUnavailable(res, cause);
            return;
          }
        }
        if (sourceType === 'local-repository') {
          const project = await applicationRepository!.createProject({ name, description, workspacePath });
          await applicationRepository!.saveSource({
            projectId: project.id, integrationId: null, kind: 'local_repository',
            name, remoteId: null, remoteUrl: null, syncStatus: 'idle', lastSyncedAt: null,
          });
          const localImport = await importLocalRepositoryArtifacts(applicationRepository!, project.id, workspacePath);
          readiness.notify(auth!, project.id, 'project_created');
          if (localImport.complete) await queueSourceIndex(auth!, project.id);
          return json(res, 201, project);
        }
        if (githubImporter) {
          const handoff = await queueGitHubProjectImport({
            project: { name, description, workspacePath, repoUrl },
            ownerId,
            createProject: project => applicationRepository!.createProject(project),
            importer: githubImporter,
          });
          json(res, 201, handoff.project);
          sourceWorker.enqueue(auth!, { projectId: handoff.project.id, sourceId: handoff.source.id, runId: handoff.run.id });
          readiness.notify(auth!, handoff.project.id, 'project_created');
          return;
        }
        return json(res, 400, { error: 'A supported project source is required.' });
      } catch (error) {
        if (isSupabaseJwtIssuedAtFuture(error)) {
          sendConnectionStatusUnavailable(res, error);
          return;
        }
        return json(res, 400, { error: String(error) });
      }
    }

    // Local Dynamic records never confer access: verify shared project membership first.
    const dynamicScope = url.match(/^\/projects\/([a-f0-9-]+)\/dynamic-sessions(?:\/|$)/);
    if (dynamicScope && !await applicationRepository!.getProject(dynamicScope[1])) return json(res, 404, { error: 'Project not found' });

    // Dynamic sessions - list
    const dsMatch = matchDynamicSessions(url);
    if (dsMatch && req.method === 'GET') {
      return json(res, 200, await listDynamicSessions(dsMatch.projectId));
    }

    // Keep authenticated legacy reads/cancellation; new execution requires a
    // durable Mission/Run, frozen policy, worker lease and independent checks.
    if (dsMatch && req.method === 'POST') {
      return json(res, 409, {error:'Save a test and start a Run in Dynamic Testing. Direct session execution is no longer available.',code:'legacy_dynamic_start_disabled',replacement:`/projects/${dsMatch.projectId}/dynamic/missions`});
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
        readiness.notify(auth!, projectId, 'project_updated');
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
        readiness.notify(auth!, importMatch.projectId, 'repository_imported');
        if (result.complete) await queueSourceIndex(auth!, importMatch.projectId);
        return json(res, 200, result);
      } catch (e) {
        return json(res, 400, { error: String(e) });
      }
    }

    // List artifacts
    const artMatch = matchArtifacts(url);
    if (artMatch && req.method === 'GET') {
      if (requestUrl.searchParams.get('view') === 'presence') {
        return json(res, 200, { hasSources: await applicationRepository!.hasArtifacts(artMatch.projectId) });
      }
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
      readiness.notify(auth!, artMatch.projectId, 'document_uploaded');
      await queueSourceIndex(auth!, artMatch.projectId);
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
      readiness.notify(auth!, artIdMatch.projectId, 'source_removed');
      await queueSourceIndex(auth!, artIdMatch.projectId);
      return json(res, 200, { ok: true });
    }

    // === Static Sessions ===

    const harnessMatch = url.match(/^\/projects\/([a-f0-9-]+)\/static-sessions\/([a-f0-9-]+)\/harness$/);
    if (harnessMatch && req.method === 'GET') {
      const [, projectId, reviewId] = harnessMatch;
      await authGateway.requireProjectMember(auth!, projectId);
      const repository = reviewRepository(auth!.client);
      const review = await repository.getReview(reviewId);
      if (!review || review.projectId !== projectId) return json(res, 404, { error: 'Review not found' });
      const events = await repository.getHarnessEvents(projectId, reviewId);
      const analysisMap = analysisMapFromEvents(events);
      return json(res, 200, { workflow: REVIEW_HARNESS, review: { id: review.id, name: review.name, status: review.status, progress: review.progress, modelStatus: review.modelStatus, updatedAt: review.updatedAt }, events, analysisMap });
    }

    // List static sessions
    const ssMatch = matchStaticSessions(url);
    if (ssMatch && req.method === 'GET') {
      await authGateway.requireProjectMember(auth!, ssMatch.projectId);
      const repository = reviewRepository(auth!.client);
      const sessions = requestUrl.searchParams.get('view') === 'summary'
        ? await repository.listReviewSummaries(ssMatch.projectId)
        : await repository.listReviews(ssMatch.projectId);
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
      let comparisonParentReviewId: string | undefined;
      if (Object.prototype.hasOwnProperty.call(body, 'comparisonParentReviewId')) {
        if (typeof body.comparisonParentReviewId !== 'string' || !body.comparisonParentReviewId.trim()) {
          return json(res, 400, { error: 'comparisonParentReviewId must be a non-empty Review id when supplied.', code: 'invalid_comparison_parent' });
        }
        comparisonParentReviewId = body.comparisonParentReviewId.trim();
      }
      const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;
      const result = await (await reviewRuntime(auth!, sourceIndexes, reviewRuntimes)).start({
        projectId: ssMatch.projectId,
        name,
        reviewType,
        scope,
        comparisonParentReviewId,
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
      if (Object.hasOwn(body, 'reuseValidatedBatches') && typeof body.reuseValidatedBatches !== 'boolean') {
        return json(res, 400, { error: 'reuseValidatedBatches must be a boolean.', code: 'invalid_batch_reuse' });
      }
      const result = await (await reviewRuntime(auth!, sourceIndexes, reviewRuntimes)).retry({
        reviewId: srMatch.sessionId,
        refreshSourceManifest: body.refreshSourceManifest === true,
        reuseValidatedBatches: body.reuseValidatedBatches === true,
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
      const session = await (await reviewRuntime(auth!, sourceIndexes, reviewRuntimes)).cancel({ reviewId: scMatch.sessionId });
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
    const frozenSourceMatch = url.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/source-artifacts\/([^/]+)\/content$/);
    if (frozenSourceMatch && req.method === 'GET') {
      const [, projectId, reviewId, artifactId] = frozenSourceMatch;
      await authGateway.requireProjectMember(auth!, projectId);
      const repository = reviewRepository(auth!.client);
      const review = await repository.getReview(reviewId);
      if (!review || review.projectId !== projectId || !review.sourceManifestId) return json(res, 404, { error: 'Frozen Review source unavailable.' });
      const { data, error } = await auth!.client.from('review_source_snapshots').select('id').eq('project_id', projectId).eq('id', review.sourceManifestId).maybeSingle();
      if (error) throw error;
      if (!data) return json(res, 404, { error: 'Frozen Review source unavailable.' });
      const artifacts = await repository.loadSourceManifestArtifacts(review.sourceManifestId);
      try { return json(res, 200, await readFrozenReviewSource(projectId, review, artifacts ?? [], artifactId, applicationRepository!)); }
      catch { return json(res, 404, { error: 'The exact saved source version is unavailable. Current content was not substituted.' }); }
    }
    const rsmMatch = matchReviewSourceManifest(url);
    if (rsmMatch && req.method === 'GET') {
      await authGateway.requireProjectMember(auth!, rsmMatch.projectId);
      const review = await reviewRepository(auth!.client).getReview(rsmMatch.sessionId);
      if (!review || review.projectId !== rsmMatch.projectId) return json(res, 404, { error: 'Session not found' });
      const { data, error } = review.sourceManifestId ? await auth!.client.from('review_source_snapshots').select('*').eq('project_id', rsmMatch.projectId).eq('id', review.sourceManifestId).maybeSingle()
        : await auth!.client.from('review_source_snapshots').select('*').eq('project_id', rsmMatch.projectId).eq('review_session_id', rsmMatch.sessionId).maybeSingle();
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
        artifacts: artifacts.map(item => ({ id: String(item.id ?? ''), fileName: String(item.name ?? ''), filePath: String(item.path ?? ''),
          artifactVersionId: typeof item.version_id === 'string' ? item.version_id : null,
          contentHash: typeof (item.metadata as Record<string, unknown> | undefined)?.contentHash === 'string' ? String((item.metadata as Record<string, unknown>).contentHash) : '' })),
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
        summary: data.summary && typeof data.summary === 'object' ? Object.fromEntries(['complete', 'incomplete', 'missing', 'attention', 'unavailable'].filter(key => typeof (data.summary as Record<string, unknown>)[key] === 'number').map(key => [key, (data.summary as Record<string, unknown>)[key]])) : null,
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
      let projectFindings: unknown[] = findings.map(finding => ({
        ...finding,
        sessionId: finding.reviewSessionId,
        filePath: typeof finding.location.filePath === 'string' ? finding.location.filePath : '',
        lineNumber: typeof finding.location.lineNumber === 'number' ? finding.location.lineNumber : null,
        fromRemarks: false,
      }));
      try {
        projectFindings = await loadCurrentProjectFindings(auth!.client, fMatch.projectId, findings);
      } catch {
        // Lineage is presentation evidence only. If any durable source or
        // correlation input is unavailable, show the saved finding rows as-is.
        console.warn('[findings] Review lineage evidence unavailable; showing saved finding states only.');
      }
      return json(res, 200, projectFindings);
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
      readiness.notify(auth!, reqListMatch.projectId, 'requirements_changed');
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
        readiness.notify(auth!, reqUpdateMatch.projectId, 'requirements_changed');
        return json(res, 200, updated);
      } catch (e) {
        return json(res, 404, { error: String(e) });
      }
    }

    // Delete requirement
    if (reqUpdateMatch && req.method === 'DELETE') {
      const deleted = await applicationRepository!.deleteRequirement(reqUpdateMatch.projectId, reqUpdateMatch.reqId);
      if (!deleted) return json(res, 404, { error: 'Requirement not found' });
      readiness.notify(auth!, reqUpdateMatch.projectId, 'requirements_changed');
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
      const evidenceProjectId = await getEvidenceProjectId(filePath);
      if (!evidenceProjectId) {
        return json(res, 403, { error: 'File not registered as evidence', path: filePath });
      }

      await authGateway.requireProjectMember(auth!, evidenceProjectId);

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
    if (e instanceof ModelProviderError) return json(res, 409, { error: e.message, code: e.code });
    if (isSupabaseJwtIssuedAtFuture(e)) {
      return json(res, 503, { code: 'supabase_jwt_future', error: FUTURE_JWT_MESSAGE });
    }
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
  server.on('close',()=>{sourceIndexes.close();localRepositoryChanges.close();readiness.close();void sessionBroker.dispose();});return server;
}

// Importing this module for authenticated HTTP tests must not open the fixed
// desktop port or initialize local-only Dynamic Testing state.
const launchedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (launchedDirectly) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  // Dynamic Testing initializes its local database when a Dynamic route needs it.
  const server = createSidecarServer();
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(error.code === 'EADDRINUSE'
      ? `[server] Port ${PORT} is already occupied. Use pnpm dev to reuse healthy development services, or stop the existing sidecar before starting it directly.`
      : `[server] Could not start: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(Number(PORT), HOST, () => {
    console.error(`[server] Centinel sidecar listening on ${HOST}:${PORT}`);
  });
  process.on('SIGTERM', () => { closeCodexBackends(); server.close(); process.exit(0); });
}
