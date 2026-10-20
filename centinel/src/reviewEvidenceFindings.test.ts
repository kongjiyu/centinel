import { describe, it, expect } from 'vitest';
import { mergeReviewFindings, reviewEvidenceFindings } from './reviewEvidenceFindings';
import type { EvidenceSufficiencyAssessment, StaticSession } from './types';
const session = { id: 'r1', projectId: 'p1' } as StaticSession;
const assessment = { id: 'a1', reviewId: 'r1', projectId: 'p1', confirmedRequirementCount: 0, assessedAt: '2026-10-18T00:00:00Z', gaps: [] } as unknown as EvidenceSufficiencyAssessment;
describe('saved document gaps as findings', () => {
  it('includes unconfirmed business requirements with evidence and a next action', () => {
    const findings = reviewEvidenceFindings(session, assessment);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: 'Review documents', verifier: 'evidence_assessment', status: 'new', evidenceGap: { assessmentId: 'a1', code: 'unconfirmed_requirements' } });
    expect(findings[0].recommendation).toContain('new review');
    expect(mergeReviewFindings(findings, findings)).toHaveLength(1);
  });
  it('preserves recorded blocking gaps without duplicating a requirement gap', () => {
    const result = reviewEvidenceFindings(session, { ...assessment, gaps: [{ id: 'g1', code: 'missing_requirements', title: 'Requirements missing', detail: 'No requirement document.', remediation: 'Add requirements.', severity: 'blocking', affectedStages: [] }] });
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('high');
    expect(result[0].description).toBe('No requirement document.');
  });
  it('does not infer absent documents when assessment evidence is unavailable or belongs to another review', () => {
    expect(reviewEvidenceFindings(session, null)).toEqual([]);
    expect(reviewEvidenceFindings(session, { ...assessment, reviewId: 'other' })).toEqual([]);
    expect(reviewEvidenceFindings(session, { ...assessment, projectId: 'other' })).toEqual([]);
    expect(reviewEvidenceFindings(session, { ...assessment, confirmedRequirementCount: 1 })).toEqual([]);
  });
});
