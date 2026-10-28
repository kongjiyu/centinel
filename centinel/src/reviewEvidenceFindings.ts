import type { EvidenceSufficiencyAssessment, Finding, StaticSession } from './types';

/** Present saved assessment gaps alongside code findings without altering history. */
export function reviewEvidenceFindings(session: StaticSession, assessment: EvidenceSufficiencyAssessment | null): Finding[] {
  if (!assessment || assessment.reviewId !== session.id || assessment.projectId !== session.projectId) return [];
  const gaps = [...assessment.gaps];
  if (assessment.confirmedRequirementCount === 0 && !gaps.some(gap => /requirement/i.test(gap.code))) gaps.push({
    id: 'unconfirmed-requirements', code: 'unconfirmed_requirements', severity: 'warning',
    title: 'Business requirements need confirmation',
    detail: 'No confirmed business requirements were available for this review. Behaviour could not be checked against agreed business rules.',
    remediation: 'Add or confirm the business requirements, then start a new review to check them.', affectedStages: ['source_freeze'],
  });
  return [...new Map(gaps.map(gap => [gap.id, gap])).values()].map(gap => ({
    id: `document-gap-${session.id}-${gap.id}`, projectId: session.projectId, sessionId: session.id,
    source: 'static', verifier: 'evidence_assessment', category: 'Review documents',
    severity: gap.severity === 'blocking' ? 'high' : 'medium', priority: gap.severity === 'blocking' ? 'High' : 'Medium',
    title: gap.title, description: gap.detail, recommendation: gap.remediation,
    evidenceText: `Document check saved at ${assessment.assessedAt}. ${gap.detail}`,
    evidenceGap: { assessmentId: assessment.id, code: gap.code }, status: 'new', confidence: 'high',
    requirementId: gap.requirementId, relatedSources: gap.references,
    createdAt: assessment.assessedAt, artifactId: gap.artifactId ?? null, filePath: '', lineNumber: null, fromRemarks: false,
  }));
}

export function mergeReviewFindings(findings: Finding[], gaps: Finding[]): Finding[] {
  return [...new Map([...gaps, ...findings].map(finding => [finding.id, finding])).values()];
}
