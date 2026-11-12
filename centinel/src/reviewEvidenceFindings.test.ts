import { describe, it, expect } from 'vitest';
import { reviewEvidenceFindings } from './reviewEvidenceFindings';
import type { EvidenceSufficiencyAssessment, StaticSession } from './types';
const session = { id: 'r1', projectId: 'p1' } as StaticSession;
const assessment = { id: 'a1', reviewId: 'r1', projectId: 'p1', confirmedRequirementCount: 0, assessedAt: '2026-10-18T00:00:00Z', gaps: [] } as unknown as EvidenceSufficiencyAssessment;
describe('saved document gaps as findings', () => {
  it('retains requirement identity and all related source references', () => {
    const refs = [{ artifactId: 'doc', filePath: 'requirements.md', lineNumber: 3, sourceVersion: 'v1', relation: 'requirement' as const }, { artifactId: 'code', filePath: 'payment.ts', relation: 'code' as const }];
    const findings = reviewEvidenceFindings(session, { ...assessment, confirmedRequirementCount: 1, gaps: [{ id: 'coverage', code: 'traceability_mappings_incomplete', title: 'Incomplete Requirement Coverage', detail: 'Mapping incomplete.', remediation: 'Review the criterion.', severity: 'warning', affectedStages: [], requirementId: 'pay-once', references: refs }] });
    expect(findings[0]).toMatchObject({ requirementId: 'pay-once', relatedSources: refs });
  });
  it('keeps the absence of confirmed requirements out of the findings list', () => {
    expect(reviewEvidenceFindings(session, assessment)).toEqual([]);
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
