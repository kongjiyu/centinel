import { ConfiguredTextModelProvider } from '../../review/modelProvider.js';
import type { ModelProviderSettings } from '../../review/types.js';
import { cancelSession } from '../../dynamicRunner.js';
import { discoverControls } from '../environment/controlDiscovery.js';
import type { EnvironmentRepository } from '../environment/repository.js';
import { liveHub } from '../live/liveHub.js';
import { handleDynamicRoute, type DynamicRouteDependencies } from '../routes.js';
import type { DynamicService } from '../service.js';
import { DynamicContractError, type DynamicRun } from '../types.js';
import { launchRepository } from './launcher.js';
import type { AutoTestDeps, AutoTestSession } from './orchestrator.js';
import { buildRepoDigest } from './repoDigest.js';
import { autoTestLiveRuns, type AutoTestStore } from './store.js';

export type AutoTestUsage = {
  stage: string; provider: string; model: string; outcome: 'success' | 'failure';
  inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; durationMs: number; errorCode?: string;
};

const EXPLAIN_SCHEMA = { type: 'object', additionalProperties: false, required: ['explanation'], properties: { explanation: { type: 'string' } } } as const;

/** Real side effects for one Auto test session, bound to the caller's authenticated clients. */
export function createAutoTestDeps(input: {
  projectId: string;
  ownerId: string;
  session: AutoTestSession;
  store: AutoTestStore;
  environments: EnvironmentRepository;
  service: DynamicService;
  dynamicRouteDeps: DynamicRouteDependencies;
  home: string;
  modelChain(): Promise<{ primary: ModelProviderSettings }>;
  recordUsage(usage: AutoTestUsage): Promise<unknown>;
}): Promise<AutoTestDeps> {
  const { projectId } = input;
  let provider: ConfiguredTextModelProvider | null = null;
  const model = async () => {
    if (provider) return provider;
    const chain = await input.modelChain().catch(() => { throw new DynamicContractError(409, 'Connect a model in Settings before running Auto test.'); });
    provider = new ConfiguredTextModelProvider({ settings: chain.primary, projectId, maxOutputTokens: 16_000 });
    return provider;
  };
  const analyze = async (stage: string, request: { systemPrompt: string; prompt: string; outputSchema: object; signal: AbortSignal }) => {
    const modelRequest = { ...request, outputSchema: request.outputSchema as Record<string, unknown> };
    const client = await model();
    const settings = await client.getSettings();
    const started = Date.now();
    try {
      const result = await client.analyze(modelRequest);
      await input.recordUsage({ stage, provider: result.settings?.provider ?? settings?.provider ?? 'unknown', model: result.settings?.model ?? settings?.model ?? 'unknown', outcome: 'success',
        inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens, cacheReadTokens: result.usage?.cacheReadTokens, durationMs: Date.now() - started }).catch(() => undefined);
      return result.result;
    } catch (error) {
      await input.recordUsage({ stage, provider: settings?.provider ?? 'unknown', model: settings?.model ?? 'unknown', outcome: 'failure', durationMs: Date.now() - started,
        errorCode: (error as { code?: string })?.code ?? 'model_error' }).catch(() => undefined);
      throw error;
    }
  };
  const route = async (method: string, pathname: string, body: Record<string, unknown> = {}) => {
    const response = await handleDynamicRoute({ method, pathname, readBody: async () => body }, input.dynamicRouteDeps);
    if (!response || response.status >= 400) throw new DynamicContractError(([400, 404, 409, 503] as const).find(code => code === response?.status) ?? 503, (response?.body as { error?: string })?.error ?? 'Dynamic request failed.');
    return response.body;
  };
  return Promise.resolve({
    digest: folder => buildRepoDigest(folder),
    launch: options => launchRepository({ ...options, home: input.home }),
    discover: (url, paths) => discoverControls(new URL(url), { paths, maxPaths: 19, maxControls: 60 }),
    generate: request => analyze('autotest-plan', request),
    explainFailure: async ({ test, run, excerpts, signal }) => {
      const checks = (run.checks ?? []).map(result => {
        const definition = test.checks.find(check => check.id === result.checkId);
        const expected = definition && 'expected' in definition ? String(definition.expected) : definition && 'selector' in definition ? `element ${definition.selector}` : '';
        return `- ${definition?.description ?? result.checkId}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(result.observed ?? '')} → ${result.verdict}`;
      }).join('\n');
      const prompt = [
        `A browser test failed. Explain in two or three plain sentences what is wrong in the app and where in the code it most likely comes from. Do not restate the steps. Say "likely" when unsure.`,
        `Test: ${test.name}`, `Goal: ${test.goal}`, test.requirementRef ? `Requirement: ${test.requirementRef}` : '',
        `Check results:\n${checks}`, run.reason ? `Run note: ${run.reason}` : '', excerpts ? `Related source:\n${excerpts}` : '',
      ].filter(Boolean).join('\n\n');
      const result = await analyze('autotest-explain', { systemPrompt: 'You are a QA engineer writing a short, factual bug explanation. Return JSON only.', prompt, outputSchema: EXPLAIN_SCHEMA, signal }) as { explanation?: unknown };
      return typeof result?.explanation === 'string' ? result.explanation.trim().slice(0, 1200) : null;
    },
    saveEnvironment: async (value, id) => {
      // Reuse an earlier Auto test environment with the same name instead of adding a new one per session.
      const existing = id ?? (await input.environments.list(projectId)).find(profile => profile.name === value.name)?.id;
      return input.environments.save(projectId, value, existing);
    },
    recordData: async (environmentId, kind, note) => { await input.environments.recordData(projectId, environmentId, kind, 'completed', note); },
    saveMission: async mission => {
      const revision = await input.service.saveMission(projectId, input.ownerId, mission);
      return { missionId: revision.missionId, revisionId: revision.id };
    },
    startRun: async ({ revisionId, environmentId, idempotencyKey, laneId }) => {
      autoTestLiveRuns.register(idempotencyKey, { laneId, headless: true, perStepScreenshots: true, sink: liveHub.sinkFor(projectId, input.session.id, laneId) });
      const run = await route('POST', `/projects/${projectId}/dynamic/runs`, { revisionId, environmentId, idempotencyKey }) as DynamicRun;
      return run.id;
    },
    getRun: async runId => {
      const run = await input.service.requireRun(projectId, runId);
      if (['completed', 'blocked', 'cancelled', 'interrupted'].includes(run.state)) autoTestLiveRuns.release(run.idempotencyKey);
      return run;
    },
    cancelRun: async runId => {
      const stopped = await input.service.stop(projectId, runId, 'cancelled', 'Auto test was cancelled.');
      if (stopped.legacySessionId) cancelSession(stopped.legacySessionId);
    },
    save: session => input.store.save(session),
  });
}
