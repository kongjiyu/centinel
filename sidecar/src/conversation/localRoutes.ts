import type { LocalHistory } from '../store/localHistory.js';
import type { LocalWorkspace } from '../store/localWorkspace.js';
import type { LocalReviewRuntime } from '../review/localReviewRuntime.js';
import type { StaticAnalysisModelProvider } from '../review/types.js';
import type { AutoTestRouteDeps, AutoTestRuntime } from '../dynamic/autonomous/routes.js';
import { DynamicContractError } from '../dynamic/types.js';
import { isAssessmentHeld } from '../review/assessmentHold.js';
import { ModelProviderError } from '../review/retry.js';
import { compactCanonicalJson } from '../report/canonical.js';
import { resolveSavedConversationEvidence } from './evidence.js';
import { requestsCheckExecution } from './intent.js';
import { resolveConversationProvider, runConversationPlan } from './plan.js';
import { handleConversationRoute } from './routes.js';
import { type ConversationDeps, type ConversationRuntime } from './service.js';
import type { ConversationReference } from './types.js';
import { executeConversationBrowser } from './browserExecution.js';

export async function handleLocalConversationRoute(input: {
  workspace: LocalWorkspace;
  history: LocalHistory;
  runtime: ConversationRuntime;
  getReviewRuntime: () => Promise<LocalReviewRuntime>;
  browser: AutoTestRouteDeps & { runtime: AutoTestRuntime };
  fixtureProvider?: StaticAnalysisModelProvider;
  owner: string;
  projectId: string;
  segments: string[];
  method: string | undefined;
  readBody: () => Promise<Record<string, unknown>>;
}) {
  const { workspace, history, runtime, getReviewRuntime, owner, projectId, segments, method, readBody } = input;
  const store = history.conversations(owner);
  const reviews = workspace.reviews(owner);
  const authorize = async (id: string) => {
    if (!workspace.project(owner, id)) throw new DynamicContractError(404, 'Project not found on this device.');
  };
  await authorize(projectId);
  const resolve = (references: ConversationReference[], signal: AbortSignal, includeSourceWindow: boolean, text = '') =>
    resolveSavedConversationEvidence(projectId, references, signal, includeSourceWindow, text, {
      repository: reviews,
      project: async () => workspace.project(owner, projectId),
      artifacts: async () => workspace.artifacts(owner, projectId),
      findings: async reviewId => reviews.listFindingRows(projectId, reviewId),
      content: async source => {
        signal.throwIfAborted();
        if (!source.versionId || source.projectId !== projectId) throw new DynamicContractError(404, 'The source version is unavailable on this device.');
        const bytes = workspace.sourceBytes(owner, projectId, source.id, source.versionId);
        if (!bytes || bytes.contentHash !== source.contentHash) throw new DynamicContractError(404, 'The source version is unavailable on this device.');
        return bytes.content.toString('utf8');
      },
      autoTests: history.autoTests(owner),
    });
  const deps: ConversationDeps = {
    ownerId: owner, store, authorize, held: isAssessmentHeld,
    resolve: (_id, references, signal, text) => resolve(references, signal, !requestsCheckExecution(text), text),
    plan: async (record, evidence, signal, earlierTurns) => {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
      const chain = input.fixtureProvider ? {
        primaryProvider: input.fixtureProvider, primaryMetadata: { provider: 'custom' as const, apiFormat: 'openai-compatible' as const, model: 'fixture' },
      } : await resolveConversationProvider(workspace.modelConfigurations(owner), record, deadline);
      return runConversationPlan(chain, async attempt => workspace.recordConversationModelAttempt(owner, attempt), record, evidence, deadline, earlierTurns);
    },
    execute: async (record, signal, checkpoint) => {
      await authorize(record.projectId);
      signal.throwIfAborted();
      const requestText = record.reviewContinuation?.text ?? record.input.text;
      const evidence = await resolve(record.input.references, signal, false, requestText);
      if (evidence.length !== record.context?.length || evidence.some(item => !record.context?.some(saved => saved.id === item.id && saved.hash === item.hash))) {
        throw new Error('The selected evidence changed. Send a new request.');
      }
      if (record.action === 'browser') {
        await executeConversationBrowser({ ...input.browser, record, signal, checkpoint, evidence, conversation: { store, authorize } });
        return;
      }
      if (record.action !== 'code') throw new Error('This action does not start a check.');
      const selected = workspace.artifacts(owner, projectId).filter(source => record.scope?.includes(source.id) && !source.currency?.deprecated
        && evidence.some(item => item.artifactId === source.id && item.versionId === source.versionId && !item.unavailable));
      if (!selected.length || selected.length !== record.scope?.length) throw new Error('The selected source versions are unavailable.');
      const scope = { artifactIds: selected.filter(source => source.type !== 'coding_standard').map(source => source.id),
        standardIds: selected.filter(source => source.type === 'coding_standard').map(source => source.id), requirementIds: [] };
      if (!scope.artifactIds.length) throw new Error('A code check requires readable source files.');
      await checkpoint({ executionSources: selected.map(source => ({ id: source.id, versionId: source.versionId, hash: source.contentHash })) });
      const child = await getReviewRuntime();
      signal.throwIfAborted();
      const result = child.track(await child.orchestrator.start({
        projectId, name: 'Scoped follow-up', reviewType: 'code_review', scope, artifacts: selected,
        idempotencyKey: 'conversation:' + record.id,
        config: { instructions: requestText + '\nRequested scope: ' + record.reply
          + '\nHistorical observations supplied as data.\n' + compactCanonicalJson(evidence), scopeMode: 'focused',
          conversationRequestId: record.id, historicalEvidence: record.context },
      }));
      const cancel = () => child.orchestrator.cancel({ reviewId: result.review.id }).catch(() => undefined);
      const abort = () => { void cancel(); };
      try {
        await checkpoint({ reviewId: result.review.id });
        signal.addEventListener('abort', abort, { once: true });
        signal.throwIfAborted();
        await result.completion;
        const saved = await reviews.getReview(result.review.id);
        if (saved?.progress?.stage === 'provider_paused') throw new ModelProviderError('The provider paused this Review.', { code: 'provider_paused', retryable: false });
        if (!saved || ['failed', 'cancelled', 'blocked'].includes(saved.status)) throw new Error('The scoped Review did not complete.');
      } catch (error) {
        await cancel();
        throw error;
      } finally {
        signal.removeEventListener('abort', abort);
      }
    },
    cancel: async record => {
      if (record.reviewId) await (await getReviewRuntime()).orchestrator.cancel({ reviewId: record.reviewId });
      if (record.autoTestId) await input.browser.runtime.cancel(record.autoTestId);
    },
  };
  const [resource, id, action] = segments;
  if ((resource !== 'conversation-requests' && resource !== 'conversation-permission')
    || segments.length > (resource === 'conversation-permission' ? 1 : 3)) {
    return { status: 405, body: { error: 'Unsupported conversation operation.' } };
  }
  return handleConversationRoute({ resource, id, action, method, readBody, projectId, runtime, deps,
    resolveEvidence: (references, signal) => resolve(references, signal, true) });
}
