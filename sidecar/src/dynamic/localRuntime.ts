import { isAssessmentHeld } from '../review/assessmentHold.js';
import { resolveModelProviderChain } from '../review/modelProviderResolver.js';
import type { LocalWorkspace } from '../store/localWorkspace.js';
import { autoTestLiveRuns } from './autonomous/store.js';
import type { DownloadVault } from './environment/downloadVault.js';
import { checkEnvironment, environmentReady } from './environment/preflight.js';
import { sessionSensitiveValues, type EnvironmentSessionVault, type LocalSessionRecord } from './environment/sessionVault.js';
import type { EnvironmentProfile } from './environment/types.js';
import type { UploadVault } from './environment/uploadVault.js';
import { containsLocalValue } from './environment/secrets.js';
import type { EnvironmentVault } from './environment/vault.js';
import type { DynamicRouteDependencies } from './routes.js';
import { executeMissionRun } from './runnerBridge.js';
import type { DynamicService } from './service.js';
import { DynamicContractError, type DynamicRun } from './types.js';

export function localBrowserExecution(deps: {
  workspace: LocalWorkspace; owner: string; service: DynamicService;
  vault: EnvironmentVault; sessions: EnvironmentSessionVault; uploads: UploadVault; downloads: DownloadVault;
  privateValues(project: string, profile: EnvironmentProfile): string[];
  uploadsReady(project: string, profile: EnvironmentProfile): boolean;
  captureActive(project: string, profile: EnvironmentProfile): boolean;
  codexReady(): Promise<boolean>;
  headless?: boolean;
  cleanup?(run: DynamicRun): Promise<void>;
}): DynamicRouteDependencies['prepareExecution'] {
  const { workspace, owner, service } = deps;
  const environments = workspace.environments(owner);
  return async (project, revisionId, environmentId) => {
    await workspace.unitRuns(owner).recover(project);
    await workspace.hooks(owner).recover(project);
    await workspace.sessionCaptures(owner).recover(project);
    if (isAssessmentHeld(project)) throw new DynamicContractError(409, 'Model-backed Browser Runs are paused for this project.');
    const revision = await service.assertRunnable(project, revisionId ?? '');
    const profile = environmentId ? await environments.get(project, environmentId) : null;
    if (profile) {
      if (new URL(profile.targetUrl).origin !== new URL(revision.targetUrl).origin) {
        throw new DynamicContractError(400, 'Environment and test must use the same website origin.');
      }
      if (containsLocalValue({ revision, profile }, deps.privateValues(project, profile))) {
        throw new DynamicContractError(400, 'Keep local variable values out of test and environment fields.');
      }
    }
    let session: LocalSessionRecord | null = null;
    let sessionInfo: Parameters<typeof checkEnvironment>[5];
    if (profile?.sessionReference) {
      try {
        session = deps.sessions.read(owner, project, profile.id, profile.sessionReference, profile.allowedOrigins);
        sessionInfo = session ? { availability: 'available', version: session.version, expiresAt: session.expiresAt } : { availability: 'missing' };
      } catch (error) {
        sessionInfo = { availability: 'unavailable', reason: error instanceof DynamicContractError ? error.message : 'Local session unavailable.' };
      }
      sessionInfo.captureActive = deps.captureActive(project, profile);
    }
    const variables = profile ? deps.vault.read(owner, project, profile.id) : {};
    const vision = await resolveModelProviderChain(workspace.modelConfigurations(owner), { ownerId: owner, projectId: project, purpose: 'vision' })
      .then(chain => chain.primary).catch(() => null);
    const providerReady = Boolean(vision && (vision.provider === 'codex'
      ? await deps.codexReady().catch(() => false) : vision.apiKey || vision.geminiOAuthProject));
    if (!profile && !providerReady) throw new DynamicContractError(409, 'Configure and connect a Dynamic screenshot provider in Settings.');
    const environment = profile && await checkEnvironment(profile, Object.keys(variables), providerReady, fetch,
      await environments.data(project, profile.id), sessionInfo, deps.uploadsReady(project, profile));
    const execute = async (run: DynamicRun) => {
      if (!vision || !providerReady || (environment && !environmentReady(environment))) {
        await service.stop(project, run.id, 'blocked', 'Environment preflight failed. Inspect the saved checks and startup instructions.');
        return;
      }
      if (profile?.sessionReference && session) {
        const current = deps.sessions.status(owner, project, profile.id, profile.sessionReference, profile.allowedOrigins);
        if (current.availability !== 'available' || current.version !== session.version || deps.captureActive(project, profile)) {
          await service.stop(project, run.id, 'blocked', 'The saved sign-in session changed or expired. Repeat preflight.');
          return;
        }
      }
      try {
        await executeMissionRun(service, run, workspace.dynamicRunFiles(owner, project), {
        vision, storageState: session?.state, sensitiveValues: [...Object.values(variables), ...(session ? sessionSensitiveValues(session) : [])],
        live: autoTestLiveRuns.get(run.idempotencyKey),
        sensitiveSelectors: run.actionPolicy?.privateInputs?.map(grant => grant.selector),
        resolvePrivateValue: name => profile?.requiredVariables.includes(name) ? variables[name] : undefined,
        retainDownload: (receipt, bytes) => deps.downloads.retain(owner, project, run.id, receipt, bytes),
        ...(profile ? { resolveUpload: grant => deps.uploads.resolve(owner, project, profile.id, grant) } : {}),
      }, {
        headless: deps.headless,
        recordUsage: async usage => workspace.saveDynamicUsage(owner, project, run.id, {
          stage: usage.stage ?? 'dynamic-action', attempt: 1, provider: usage.provider, model: usage.model, outcome: 'success',
          inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null, cacheReadTokens: usage.cacheReadTokens ?? null,
          cacheCreationTokens: usage.cacheCreationTokens ?? null, durationMs: null, errorCode: null, cost: null,
          metadata: { scope: usage.scope, apiFormat: usage.apiFormat, usageObservation: usage.usageObservation,
            providerReportedTotalTokens: usage.providerReportedTotalTokens, normalizedTotalTokens: usage.totalTokens,
            normalizedTotalTokensSource: usage.totalTokensSource },
        }),
        });
      } finally {
        if (run.environment) await deps.cleanup?.(run);
      }
    };
    return environment ? { environment, execute } : execute;
  };
}
