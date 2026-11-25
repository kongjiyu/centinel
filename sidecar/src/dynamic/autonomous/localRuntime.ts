import { join } from 'node:path';
import { isAssessmentHeld } from '../../review/assessmentHold.js';
import { resolveModelProviderChain } from '../../review/modelProviderResolver.js';
import type { LocalHistory } from '../../store/localHistory.js';
import type { LocalWorkspace } from '../../store/localWorkspace.js';
import type { DynamicRouteDependencies } from '../routes.js';
import { DynamicContractError } from '../types.js';
import type { AutoTestRouteDeps, AutoTestRuntime } from './routes.js';
import { createAutoTestDeps } from './runtimeDeps.js';

export function localAutoTestRouteDeps(workspace: LocalWorkspace, history: LocalHistory,
  routes: DynamicRouteDependencies, runtime: AutoTestRuntime): AutoTestRouteDeps & { runtime: AutoTestRuntime } {
  const owner = routes.actorId;
  const store = history.autoTests(owner);
  return {
    ownerId: owner, store, runtime, requireMember: routes.requireProjectMember,
    defaultFolder: async id => {
      const project = workspace.project(owner, id);
      if (!project) return null;
      const local = await workspace.projectWorkspace(owner, project);
      return local.workspacePath || (local.managedWorkspaceReady ? local.managedWorkspacePath ?? null : null);
    },
    createDeps: async (projectId, session) => {
      const requireExecution = async () => {
        await routes.requireProjectMember(projectId);
        if (isAssessmentHeld(projectId)) throw new DynamicContractError(409, 'Model-backed Browser Runs are paused for this project.');
      };
      await requireExecution();
      const deps = await createAutoTestDeps({
        projectId, ownerId: owner, session, store, environments: workspace.environments(owner),
        service: routes.service, dynamicRouteDeps: routes,
        home: join(workspace.dynamicRunFiles(owner, projectId), 'autotest-home'),
        modelChain: () => resolveModelProviderChain(workspace.modelConfigurations(owner), { ownerId: owner, projectId, purpose: 'vision' }),
        recordUsage: async usage => workspace.saveDynamicUsage(owner, projectId, session.id, {
          id: usage.id, stage: usage.stage, provider: usage.provider, model: usage.model,
          outcome: usage.outcome === 'failure' ? 'permanent_error' : usage.outcome, attempt: 1,
          inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null, cacheReadTokens: usage.cacheReadTokens ?? null,
          cacheCreationTokens: null, durationMs: usage.durationMs, errorCode: usage.errorCode ?? null, cost: null, metadata: {},
        }),
      });
      return { ...deps, beforeAction: requireExecution };
    },
  };
}
