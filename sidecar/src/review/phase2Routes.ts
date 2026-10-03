import type { Artifact } from '../artifacts.js';
import {
  extractRequirementCandidates,
  ingestStandardRules,
  type GroundingCandidateStatus,
  type GroundingRepository,
} from './grounding.js';
import type { StaticReviewOrchestrator, StaticReviewRecord, StaticReviewRepository, StaticReviewStartResult } from './types.js';

type Phase2ReviewRepository = StaticReviewRepository & GroundingRepository;

export type Phase2RouteResponse = { status: number; body: unknown };

export type Phase2RouteDependencies = {
  actorId: string;
  repository: Phase2ReviewRepository;
  orchestrator: StaticReviewOrchestrator;
  requireProjectMember(projectId: string): Promise<void>;
  getArtifact(artifactId: string): Promise<Artifact | null>;
  readArtifactContent(artifactId: string): Promise<string>;
  modelProvider: Parameters<typeof extractRequirementCandidates>[1];
  presentReview?(review: StaticReviewRecord): unknown;
  onReviewCompletion?(completion: Promise<StaticReviewRecord>, label: string): void;
};

export type Phase2RouteRequest = {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  readBody(): Promise<Record<string, unknown>>;
};

export function isPhase2ReviewRoutePath(pathname: string): boolean {
  return [
    /^\/projects\/[^/]+\/requirement-candidates\/extract$/,
    /^\/projects\/[^/]+\/requirement-candidates$/,
    /^\/projects\/[^/]+\/requirement-candidates\/[^/]+\/(?:confirm|reject)$/,
    /^\/projects\/[^/]+\/standards$/,
    /^\/projects\/[^/]+\/standards\/rules\/[^/]+$/,
    /^\/projects\/[^/]+\/static-sessions\/[^/]+\/evidence-sufficiency$/,
    /^\/projects\/[^/]+\/static-sessions\/[^/]+\/iterations$/,
    /^\/projects\/[^/]+\/static-sessions\/[^/]+\/start$/,
    /^\/projects\/[^/]+\/static-sessions\/[^/]+\/correlations$/,
  ].some(pattern => pattern.test(pathname));
}

class Phase2RouteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'Phase2RouteError';
  }
}

function presentReview(review: StaticReviewRecord, deps: Phase2RouteDependencies): unknown {
  return deps.presentReview?.(review) ?? review;
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function iterationError(error: unknown): never {
  if (error instanceof Error && /^Supabase /.test(error.message)) throw error;
  throw new Phase2RouteError(409, error instanceof Error ? error.message : String(error));
}

function staticReviewResponse(result: StaticReviewStartResult, deps: Phase2RouteDependencies, label: string): Phase2RouteResponse {
  deps.onReviewCompletion?.(result.completion, label);
  return { status: result.reused ? 200 : 201, body: presentReview(result.review, deps) };
}

/**
 * HTTP route adapter for Phase 2 static-review grounding and iteration. It is
 * kept independent from the server module so route behavior can be exercised
 * with an authenticated repository fake while production always supplies the
 * user's RLS-scoped Supabase repository.
 */
export async function handlePhase2ReviewRoute(
  request: Phase2RouteRequest,
  deps: Phase2RouteDependencies,
): Promise<Phase2RouteResponse | null> {
  if (!isPhase2ReviewRoutePath(request.pathname)) return null;
  const candidateExtract = request.pathname.match(/^\/projects\/([^/]+)\/requirement-candidates\/extract$/);
  const candidates = request.pathname.match(/^\/projects\/([^/]+)\/requirement-candidates$/);
  const candidateAction = request.pathname.match(/^\/projects\/([^/]+)\/requirement-candidates\/([^/]+)\/(confirm|reject)$/);
  const standards = request.pathname.match(/^\/projects\/([^/]+)\/standards$/);
  const standardRule = request.pathname.match(/^\/projects\/([^/]+)\/standards\/rules\/([^/]+)$/);
  const evidence = request.pathname.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/evidence-sufficiency$/);
  const iterationPrepare = request.pathname.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/iterations$/);
  const iterationStart = request.pathname.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/start$/);
  const correlations = request.pathname.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/correlations$/);

  const projectId = candidateExtract?.[1] ?? candidates?.[1] ?? candidateAction?.[1]
    ?? standards?.[1] ?? standardRule?.[1] ?? evidence?.[1] ?? iterationPrepare?.[1]
    ?? iterationStart?.[1] ?? correlations?.[1];
  if (!projectId) return null;

  try {
    await deps.requireProjectMember(projectId);

    if (candidateExtract && request.method === 'POST') {
      const body = await request.readBody();
      const artifactId = string(body.artifactId);
      if (!artifactId) throw new Phase2RouteError(400, 'artifactId is required');
      const artifact = await deps.getArtifact(artifactId);
      if (!artifact || artifact.projectId !== projectId) throw new Phase2RouteError(404, 'Artifact not found');
      const content = await deps.readArtifactContent(artifact.id);
      const saved = await extractRequirementCandidates({
        projectId,
        artifact,
        content,
        ...(string(body.sourceVersion) ? { sourceVersion: string(body.sourceVersion) } : {}),
      }, deps.modelProvider, deps.repository);
      return { status: 201, body: saved };
    }

    if (candidates && request.method === 'GET') {
      const statusValue = request.searchParams.get('status') ?? undefined;
      const validStatuses: GroundingCandidateStatus[] = ['pending_confirmation', 'confirmed', 'rejected'];
      if (statusValue && !validStatuses.includes(statusValue as GroundingCandidateStatus)) {
        throw new Phase2RouteError(400, 'Invalid requirement-candidate status');
      }
      return { status: 200, body: await deps.repository.listRequirementCandidates(projectId, statusValue as GroundingCandidateStatus | undefined) };
    }

    if (candidateAction && request.method === 'POST') {
      const candidateId = candidateAction[2];
      const action = candidateAction[3];
      const candidate = (await deps.repository.listRequirementCandidates(projectId)).find(item => item.id === candidateId);
      if (!candidate) throw new Phase2RouteError(404, 'Requirement candidate not found');
      if (action === 'confirm') {
        return { status: 200, body: await deps.repository.confirmRequirementCandidate(candidateId, deps.actorId) };
      }
      return { status: 200, body: await deps.repository.rejectRequirementCandidate(candidateId, deps.actorId) };
    }

    if (standards && request.method === 'GET') {
      const standardIds = (request.searchParams.get('standardIds') ?? '').split(',').map(value => value.trim()).filter(Boolean);
      return { status: 200, body: await deps.repository.listStandardRules(projectId, standardIds.length ? standardIds : undefined) };
    }

    if (standards && request.method === 'POST') {
      const body = await request.readBody();
      const artifactId = string(body.artifactId);
      if (!artifactId) throw new Phase2RouteError(400, 'artifactId is required');
      const artifact = await deps.getArtifact(artifactId);
      if (!artifact || artifact.projectId !== projectId) throw new Phase2RouteError(404, 'Artifact not found');
      const content = await deps.readArtifactContent(artifact.id);
      const rules = await ingestStandardRules({
        projectId,
        artifact,
        content,
        ...(string(body.label) ? { label: string(body.label) } : {}),
        ...(string(body.sourceVersion) ? { sourceVersion: string(body.sourceVersion) } : {}),
        ...(string(body.standardVersion) ? { standardVersion: string(body.standardVersion) } : {}),
      }, deps.repository);
      return { status: 201, body: rules };
    }

    if (standardRule && request.method === 'PUT') {
      const body = await request.readBody();
      if (typeof body.enabled !== 'boolean') throw new Phase2RouteError(400, 'enabled must be a boolean');
      const ruleId = standardRule[2];
      const scopedRule = (await deps.repository.listStandardRules(projectId)).find(item => item.id === ruleId);
      if (!scopedRule) throw new Phase2RouteError(404, 'Standard rule not found');
      return { status: 200, body: await deps.repository.setStandardRuleEnabled(ruleId, body.enabled) };
    }

    if (evidence && request.method === 'GET') {
      const review = await deps.repository.getReview(evidence[2]);
      if (!review || review.projectId !== projectId) throw new Phase2RouteError(404, 'Review not found');
      const assessment = await deps.repository.getEvidenceSufficiency?.(review.id);
      if (!assessment) throw new Phase2RouteError(404, 'Evidence sufficiency assessment is not available yet');
      const dispositions = await deps.repository.listContradictionDispositions?.(projectId) ?? [];
      const byId = new Map(dispositions.map(item => [item.contradictionId, item]));
      return { status: 200, body: {
        ...assessment,
        contradictions: assessment.contradictions.map(item => ({
          ...item,
          ...(byId.has(item.id) ? { disposition: byId.get(item.id) } : {}),
        })),
      } };
    }

    if (iterationPrepare && request.method === 'POST') {
      const parent = await deps.repository.getReview(iterationPrepare[2]);
      if (!parent || parent.projectId !== projectId) throw new Phase2RouteError(404, 'Review not found');
      const body = await request.readBody();
      const sourceChoice = body.sourceChoice;
      if (sourceChoice !== 'reuse' && sourceChoice !== 'refresh') {
        throw new Phase2RouteError(400, 'sourceChoice must be "reuse" or "refresh"');
      }
      try {
        const child = await deps.orchestrator.prepareReviewIteration({
          reviewId: parent.id,
          sourceChoice,
          actorId: deps.actorId,
          ...(string(body.feedback) ? { feedback: string(body.feedback) } : {}),
          ...(string(body.idempotencyKey) ? { idempotencyKey: string(body.idempotencyKey) } : {}),
        });
        return { status: 201, body: presentReview(child, deps) };
      } catch (error) {
        iterationError(error);
      }
    }

    if (iterationStart && request.method === 'POST') {
      const child = await deps.repository.getReview(iterationStart[2]);
      if (!child || child.projectId !== projectId) throw new Phase2RouteError(404, 'Review not found');
      const body = await request.readBody();
      try {
        const result = await deps.orchestrator.startPreparedIteration({
          reviewId: child.id,
          ...(string(body.idempotencyKey) ? { idempotencyKey: string(body.idempotencyKey) } : {}),
        });
        return staticReviewResponse(result, deps, 'Review iteration execution failed');
      } catch (error) {
        iterationError(error);
      }
    }

    if (correlations && request.method === 'GET') {
      const child = await deps.repository.getReview(correlations[2]);
      if (!child || child.projectId !== projectId) throw new Phase2RouteError(404, 'Review not found');
      const snapshot = await deps.repository.getFindingCorrelationSnapshot?.(child.id);
      if (!snapshot) throw new Phase2RouteError(404, 'Review correlation comparison is not available yet');
      return { status: 200, body: snapshot };
    }

    return null;
  } catch (error) {
    if (error instanceof Phase2RouteError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}
