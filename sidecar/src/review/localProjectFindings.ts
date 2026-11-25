import { calculateProjectRisk } from '../projectRisk.js';
import { RISK_POLICY_VERSION } from '../riskPolicy.js';
import type { ProjectAssessment } from '../staticDomainTypes.js';
import { projectCurrentFindings } from './currentProjectFindings.js';
import type { LocalReviewRecords } from './localReviewRecords.js';
import type { StoreFinding } from '../store/types.js';

export function loadLocalProjectFindings(reviews: LocalReviewRecords, project: string, saved: StoreFinding[] = reviews.listFindingRows(project)) {
  return projectCurrentFindings(reviews, project, saved,
    (review, manifest) => reviews.getReconciliationManifest(project, review, manifest));
}

export async function loadLocalProjectAssessment(reviews: LocalReviewRecords, project: string,
  projected = loadLocalProjectFindings(reviews, project)): Promise<ProjectAssessment> {
  const [findings, sessions] = await Promise.all([projected, reviews.listReviews(project)]);
  const risk = calculateProjectRisk(findings.map(finding => ({
    ...finding, status: (finding.status === 'new' || finding.status === 'carryover')
      && finding.resolutionEvidence?.basis === 'not_reproduced_in_comparable_review' ? 'fixed' : finding.status,
  })));
  const latest = sessions.find(review => ['completed', 'pending_approval', 'approved', 'changes_requested'].includes(review.status));
  const traceability = latest ? await reviews.getTraceabilitySnapshot(latest.id) : null;
  return { projectId: project, status: 'available', policyVersion: RISK_POLICY_VERSION, ...risk,
    traceability: { status: traceability?.status ?? 'unavailable', reviewId: latest?.id ?? null, summary: traceability?.summary ?? null } };
}
