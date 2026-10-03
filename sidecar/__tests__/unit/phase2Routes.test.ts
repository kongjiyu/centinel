import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { InMemoryGroundingRepository } from '../../src/review/grounding.js';
import { handlePhase2ReviewRoute, type Phase2RouteDependencies } from '../../src/review/phase2Routes.js';
import type { StaticReviewRecord } from '../../src/review/types.js';

const projectId = 'project-1';
const artifact: Artifact = {
  id: 'artifact-1', projectId, type: 'requirement', source: 'documents', fileName: 'requirements.md',
  filePath: '/workspace/artifacts/requirements.md', originalPath: null, contentHash: 'v1', createdAt: '2026-09-21T00:00:00.000Z',
};

function routeRequest(method: string, pathname: string, body: Record<string, unknown> = {}, query = '') {
  return {
    method,
    pathname,
    searchParams: new URLSearchParams(query),
    readBody: async () => body,
  };
}

function groundingDeps(grounding = new InMemoryGroundingRepository()): Phase2RouteDependencies {
  const repository = grounding as unknown as Phase2RouteDependencies['repository'];
  return {
    actorId: 'actor-1',
    repository,
    orchestrator: {} as Phase2RouteDependencies['orchestrator'],
    requireProjectMember: vi.fn(async () => {}),
    getArtifact: vi.fn(async id => id === artifact.id ? artifact : null),
    readArtifactContent: vi.fn(async () => '# Requirements\n- Users must be able to reset a password securely.'),
    modelProvider: {
      analyze: vi.fn(async () => ({
        result: { requirements: [{ title: 'Password reset', statement: 'Users must be able to reset a password securely.', confidence: 0.94 }] },
        settings: { provider: 'mimo', apiFormat: 'openai-compatible', model: 'test-model' },
      })),
    },
  };
}

function review(overrides: Partial<StaticReviewRecord> = {}): StaticReviewRecord {
  return {
    id: 'review-1', projectId, name: 'Review', reviewType: 'code_review', status: 'pending_approval',
    idempotencyKey: 'start-1', scope: {}, config: {},
    lineage: { parentReviewId: null, lineageRootId: 'root-1', reusedSourceManifest: false },
    iteration: null, sourceManifestId: 'manifest-1', deterministicFindingCount: 0, modelFindingCount: 0,
    modelStatus: 'succeeded', summary: '', failureReason: '', progress: null, revision: 1,
    createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('Phase 2 review routes', () => {
  it('extracts pending-only requirement candidates and requires the authenticated actor to confirm them', async () => {
    const deps = groundingDeps();
    const extracted = await handlePhase2ReviewRoute(routeRequest('POST', `/projects/${projectId}/requirement-candidates/extract`, { artifactId: artifact.id }), deps);
    expect(extracted?.status).toBe(201);
    expect(extracted?.body).toMatchObject([{ projectId, status: 'pending_confirmation', sourceLocator: { artifactId: artifact.id } }]);

    const candidateId = (extracted?.body as Array<{ id: string }>)[0].id;
    const listed = await handlePhase2ReviewRoute(routeRequest('GET', `/projects/${projectId}/requirement-candidates`, {}, 'status=pending_confirmation'), deps);
    expect(listed?.body).toHaveLength(1);

    const confirmed = await handlePhase2ReviewRoute(routeRequest('POST', `/projects/${projectId}/requirement-candidates/${candidateId}/confirm`), deps);
    expect(confirmed?.status).toBe(200);
    expect(confirmed?.body).toMatchObject({ projectId, sourceCandidateId: candidateId });
    expect(await deps.repository.listRequirementCandidates(projectId, 'confirmed')).toHaveLength(1);
    expect(deps.requireProjectMember).toHaveBeenCalledWith(projectId);
  });

  it('does not extract from an artifact belonging to another project', async () => {
    const deps = groundingDeps();
    vi.mocked(deps.getArtifact).mockResolvedValue({ ...artifact, projectId: 'other-project' });
    const result = await handlePhase2ReviewRoute(routeRequest('POST', `/projects/${projectId}/requirement-candidates/extract`, { artifactId: artifact.id }), deps);
    expect(result).toEqual({ status: 404, body: { error: 'Artifact not found' } });
    expect(deps.modelProvider.analyze).not.toHaveBeenCalled();
  });

  it('ingests versioned standard rules and scopes enable updates to the requested project', async () => {
    const deps = groundingDeps();
    vi.mocked(deps.getArtifact).mockResolvedValue({ ...artifact, type: 'coding_standard', fileName: 'coding-standard.md' });
    vi.mocked(deps.readArtifactContent).mockResolvedValue('# Security\n- Secrets must never be written to logs.\nExplanatory text without a rule.');
    const ingested = await handlePhase2ReviewRoute(routeRequest('POST', `/projects/${projectId}/standards`, {
      artifactId: artifact.id, label: 'Secure Coding', standardVersion: '2026.1',
    }), deps);
    expect(ingested?.status).toBe(201);
    expect(ingested?.body).toMatchObject([{ standardVersion: '2026.1', enabled: true, sourceLocator: { lineStart: 2 } }]);

    const ruleId = (ingested?.body as Array<{ id: string }>)[0].id;
    const disabled = await handlePhase2ReviewRoute(routeRequest('PUT', `/projects/${projectId}/standards/rules/${ruleId}`, { enabled: false }), deps);
    expect(disabled?.body).toMatchObject({ id: ruleId, enabled: false });
  });

  it('prepares a child without running it, starts it only on the explicit start route, and serves saved evidence/comparison', async () => {
    const parent = review();
    const child = review({
      id: 'child-1', status: 'prepared',
      lineage: { parentReviewId: parent.id, lineageRootId: 'root-1', reusedSourceManifest: true },
      iteration: {
        parentReviewId: parent.id, decisionId: 'decision-1', feedback: 'Please recheck access control.',
        reviewer: 'Reviewer', createdBy: 'actor-1', sourceChoice: 'reuse', sourceManifestId: 'manifest-1',
        preparedAt: '2026-09-21T00:01:00.000Z',
      },
    });
    const assessment = { reviewId: child.id, projectId, readiness: 'ready_with_warnings', gaps: [], contradictions: [] };
    const snapshot = { parentReviewId: parent.id, childReviewId: child.id, correlations: [], ambiguities: [], counts: { new: 0, recurring: 0, carried_over: 0, resolved: 0, regressed: 0 } };
    const repository = {
      getReview: vi.fn(async id => id === parent.id ? parent : id === child.id ? child : null),
      getEvidenceSufficiency: vi.fn(async () => assessment),
      getFindingCorrelationSnapshot: vi.fn(async () => snapshot),
    } as unknown as Phase2RouteDependencies['repository'];
    const prepareReviewIteration = vi.fn(async () => child);
    const completion = Promise.resolve(review({ ...child, status: 'pending_approval' }));
    const startPreparedIteration = vi.fn(async () => ({ review: child, completion, reused: false }));
    const onReviewCompletion = vi.fn();
    const deps: Phase2RouteDependencies = {
      ...groundingDeps(), repository,
      orchestrator: { prepareReviewIteration, startPreparedIteration } as unknown as Phase2RouteDependencies['orchestrator'],
      presentReview: value => ({ id: value.id, status: value.status, parentSessionId: value.lineage.parentReviewId }),
      onReviewCompletion,
    };

    const prepared = await handlePhase2ReviewRoute(routeRequest('POST', `/projects/${projectId}/static-sessions/${parent.id}/iterations`, {
      sourceChoice: 'reuse', feedback: 'Please recheck access control.', idempotencyKey: 'prepare-1',
    }), deps);
    expect(prepared).toMatchObject({ status: 201, body: { id: child.id, status: 'prepared', parentSessionId: parent.id } });
    expect(prepareReviewIteration).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'actor-1', sourceChoice: 'reuse' }));
    expect(startPreparedIteration).not.toHaveBeenCalled();

    const started = await handlePhase2ReviewRoute(routeRequest('POST', `/projects/${projectId}/static-sessions/${child.id}/start`, { idempotencyKey: 'start-child-1' }), deps);
    expect(started).toMatchObject({ status: 201, body: { id: child.id, status: 'prepared', parentSessionId: parent.id } });
    expect(startPreparedIteration).toHaveBeenCalledWith({ reviewId: child.id, idempotencyKey: 'start-child-1' });
    expect(onReviewCompletion).toHaveBeenCalledWith(completion, 'Review iteration execution failed');

    expect((await handlePhase2ReviewRoute(routeRequest('GET', `/projects/${projectId}/static-sessions/${child.id}/evidence-sufficiency`), deps))?.body).toEqual(assessment);
    expect((await handlePhase2ReviewRoute(routeRequest('GET', `/projects/${projectId}/static-sessions/${child.id}/correlations`), deps))?.body).toBe(snapshot);
  });

  it('requires an explicit reuse/refresh choice on the standalone preparation route', async () => {
    const deps = groundingDeps();
    const repository = { getReview: vi.fn(async () => review()) } as unknown as Phase2RouteDependencies['repository'];
    deps.repository = repository;
    const result = await handlePhase2ReviewRoute(routeRequest('POST', `/projects/${projectId}/static-sessions/review-1/iterations`), deps);
    expect(result).toEqual({ status: 400, body: { error: 'sourceChoice must be "reuse" or "refresh"' } });
  });
});
