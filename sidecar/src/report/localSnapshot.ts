import type { StaticSession } from '../staticDomainTypes.js';
import type { LocalWorkspace } from '../store/localWorkspace.js';
import type { AutoTestStore } from '../dynamic/autonomous/store.js';
import { loadLocalProjectAssessment, loadLocalProjectFindings } from '../review/localProjectFindings.js';
import { toClientStaticSession } from '../review/sessionPresentation.js';
import { getLocalModelUsageSummary } from '../model/localUsage.js';
import { reportCurrentFinding, runReportActions, runReportSession } from './supabaseSnapshot.js';
import type { ReportSnapshotSource } from './snapshot.js';

export function createLocalReportSnapshotSource(workspace: LocalWorkspace, owner: string, project: string,
  autoTests: AutoTestStore): ReportSnapshotSource {
  const reviews = workspace.reviews(owner);
  const requirements = workspace.requirements(owner, project);
  const dynamic = workspace.dynamicHistory(owner);
  const legacy = workspace.legacyDynamic(owner);
  const getReview = async (id: string) => {
    const review = await reviews.getReview(id);
    return review?.projectId === project ? review : null;
  };
  return {
    getProject: async id => {
      const record = id === project ? workspace.project(owner, id) : null;
      if (!record) return null;
      const { ownerId: _, ...input } = record;
      return input;
    },
    listStaticSessions: async () => (await reviews.listReviews(project)).map(review => ({ ...toClientStaticSession(review),
      status: review.status as StaticSession['status'], reviewType: review.reviewType as StaticSession['reviewType'],
      finalSummary: review.summary ?? '', failureReason: review.failureReason ?? '',
    })),
    listDynamicSessions: async () => {
      const runs = dynamic.listRuns(project);
      const mirrored = new Set(runs.map(run => run.legacySessionId));
      return [...runs.map(runReportSession), ...legacy.list(project).filter(session => !mirrored.has(session.id))];
    },
    listDynamicEvidence: async (_project, id) => dynamic.run(project, id) ? [] : legacy.listEvidence(project, id),
    listDynamicActions: async (_project, id) => {
      const run = dynamic.run(project, id);
      return run ? runReportActions(run) : legacy.listActions(project, id);
    },
    listAllFindings: async () => reviews.listFindingRows(project),
    listStaticFindings: async (_project, review) => reviews.listFindingRows(project, review),
    listArtifacts: async () => workspace.artifacts(owner, project),
    listRequirements: async () => {
      requirements.requireImported();
      return requirements.list();
    },
    getRequirementMappings: async id => requirements.mappings(id),
    getProjectAssessment: () => loadLocalProjectAssessment(reviews, project),
    getProjectAssessmentWithCurrentFindings: async () => {
      const saved = reviews.listFindingRows(project);
      const projected = loadLocalProjectFindings(reviews, project, saved);
      const [assessment, findings] = await Promise.all([loadLocalProjectAssessment(reviews, project, projected), projected]);
      const original = new Map(saved.map(item => [item.id, item]));
      return { ...assessment, currentFindings: { status: 'available', reason: null,
        items: findings.map(item => reportCurrentFinding(item, original.get(item.id)!)) } };
    },
    getReviewSourceManifest: async (_project, id) => {
      const review = await getReview(id);
      return review ? workspace.reviewManifest(owner, review) : null;
    },
    getReviewTraceabilitySnapshot: async (_project, id) => await getReview(id) ? reviews.getTraceabilitySnapshot(id) : null,
    getCurrentDecision: async (_project, id) => await getReview(id)
      ? reviews.listDecisions(id).find(item => item.decision !== 'commented') ?? null : null,
    getTokenUsageSummary: async (_project, review) => getLocalModelUsageSummary(workspace, owner, { projectId: project, sessionId: review, callKind: 'review' }),
    getCorrelations: async (_project, id) => {
      const saved = await getReview(id) ? await reviews.getFindingCorrelationSnapshot(id) : null;
      return (saved?.correlations ?? []).map(({ detail, resolutionEligibility, ...item }) => ({ ...item,
        detail: { ...(detail ? { summary: detail } : {}), ...(resolutionEligibility ? { resolutionEligibility } : {}) },
        createdAt: saved!.createdAt,
      }));
    },
    listAutoTests: () => autoTests.list(project, 30),
  };
}
