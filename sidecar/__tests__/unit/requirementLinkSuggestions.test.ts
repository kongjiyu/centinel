import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import type { ConfirmedRequirement } from '../../src/review/grounding.js';
import type { ReviewAnalysisMap } from '../../src/review/featurePathAnalysis.js';
import type { StaticFindingInput } from '../../src/review/types.js';
import { isConfirmedMappingStatus, MAX_SUGGESTIONS_PER_REQUIREMENT, suggestRequirementLinks } from '../../src/review/requirementLinkSuggestions.js';
import { coverageProgress, describeUnverifiedPart, readCoverageProgress, unverifiedPartForBatch } from '../../src/review/coverageGaps.js';

const base = { projectId: 'project', source: 'repository' as const, originalPath: null, createdAt: '2026-11-05T00:00:00Z' };
const doc: Artifact = { ...base, id: 'doc', type: 'requirement', fileName: 'requirements.md', filePath: 'docs/requirements.md', contentHash: 'doc-v1' };
const code: Artifact = { ...base, id: 'code', type: 'source_code', fileName: 'checkout.ts', filePath: 'src/checkout.ts', contentHash: 'code-v1' };
const other: Artifact = { ...base, id: 'other', type: 'source_code', fileName: 'cart.ts', filePath: 'src/cart.ts', contentHash: 'cart-v1' };
const requirement: ConfirmedRequirement = {
  id: 'pay-once', projectId: 'project', title: 'Pay once', description: 'An order is charged once.', category: 'business', priority: 'high',
  sourceCandidateId: null, sourceLocator: { artifactId: doc.id, filePath: doc.filePath, lineStart: 4, lineEnd: 6 }, sourceVersion: 'doc-v1', confidence: 0.9, createdAt: '2026-11-05T00:00:00Z',
};
const finding = (overrides: Partial<StaticFindingInput>): StaticFindingInput => ({
  source: 'model', title: 'Double charge', description: 'Charged twice.', severity: 'high', category: 'business',
  filePath: code.filePath, lineNumber: 10, artifactId: code.id, evidence: 'charge()', recommendation: 'Guard.', confidence: 'high', ...overrides,
});

describe('requirement link suggestions', () => {
  it('links a requirement to the code cited by a finding that references it', () => {
    expect(suggestRequirementLinks({ requirements: [requirement], artifacts: [doc, code], findings: [finding({ requirementId: 'pay-once' })] }))
      .toEqual([{ requirementId: 'pay-once', artifactId: 'code', symbolId: null, confidence: 0.8, basis: 'finding_requirement_reference' }]);
  });
  it('links code when a finding cites the requirement lines, and ignores lines outside its range', () => {
    const cites = finding({ relatedLocations: [{ filePath: doc.filePath, artifactId: doc.id, lineNumber: 5, evidence: 'charged once' }] });
    const outside = finding({ artifactId: other.id, filePath: other.filePath, relatedLocations: [{ filePath: doc.filePath, artifactId: doc.id, lineNumber: 9, evidence: 'other' }] });
    expect(suggestRequirementLinks({ requirements: [requirement], artifacts: [doc, code, other], findings: [cites, outside] }))
      .toEqual([{ requirementId: 'pay-once', artifactId: 'code', symbolId: null, confidence: 0.7, basis: 'finding_cites_requirement' }]);
  });
  it('uses assessed feature evidence with the operation label, never unverified rows or uncertain citations', () => {
    const feature = (id: string, label: string, status: 'assessed' | 'unverified') => ({ id, label, provisional: true as const, entryPoints: [{ artifactId: code.id, filePath: code.filePath, lineNumber: 2, sourceVersion: 'code-v1' }], paths: [], unresolved: [],
      assessments: [{ domain: 'business' as const, status, outcome: status === 'assessed' ? 'no_issue_identified' as const : 'unverified' as const, summary: 'x', evidence: [{ artifactId: doc.id, filePath: doc.filePath, lineNumber: 4, sourceVersion: 'doc-v1' }] }] });
    const analysisMap = { features: [feature('f1', 'POST /checkout', 'assessed'), feature('f2', 'refund', 'unverified')] } as unknown as ReviewAnalysisMap;
    const uncertain = finding({ requirementId: 'pay-once', artifactId: other.id, filePath: other.filePath, sourceLocator: { citationEvidence: { verification: 'needs_verification' } } });
    expect(suggestRequirementLinks({ requirements: [requirement], artifacts: [doc, code, other], findings: [uncertain], analysisMap }))
      .toEqual([{ requirementId: 'pay-once', artifactId: 'code', symbolId: 'POST /checkout', confidence: 0.6, basis: 'assessment_cites_requirement' }]);
  });
  it('bounds suggestions per requirement and never targets requirement documents', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ ...code, id: `code-${index}`, filePath: `src/file${index}.ts` }));
    const findings = many.map(item => finding({ requirementId: 'pay-once', artifactId: item.id, filePath: item.filePath }));
    findings.push(finding({ requirementId: 'pay-once', artifactId: doc.id, filePath: doc.filePath, lineNumber: 1 }));
    const result = suggestRequirementLinks({ requirements: [requirement], artifacts: [doc, ...many], findings });
    expect(result).toHaveLength(MAX_SUGGESTIONS_PER_REQUIREMENT);
    expect(result.some(item => item.artifactId === doc.id)).toBe(false);
  });
  it('treats only suggested and rejected statuses as unconfirmed', () => {
    expect(isConfirmedMappingStatus('suggested')).toBe(false);
    expect(isConfirmedMappingStatus(' Suggestion_Rejected ')).toBe(false);
    expect(isConfirmedMappingStatus('unknown')).toBe(true);
    expect(isConfirmedMappingStatus('implemented')).toBe(true);
  });
});

describe('completed-with-gaps coverage progress', () => {
  const batch = { features: [{ label: 'POST /checkout' }], sources: [{ artifact: code }] } as never;
  it('merges duplicate parts and describes them in plain language', () => {
    const progress = coverageProgress([unverifiedPartForBatch(batch, 'uncertain_citation', 1), unverifiedPartForBatch(batch, 'uncertain_citation', 2), unverifiedPartForBatch(batch, 'semantic_support')]);
    expect(progress).toMatchObject({ coverage: 'partial', unverifiedPartCount: 2 });
    expect(progress.unverifiedParts[0]).toEqual({ reason: 'uncertain_citation', files: ['src/checkout.ts'], features: ['POST /checkout'], count: 2 });
    expect(describeUnverifiedPart(progress.unverifiedParts[0])).toBe('src/checkout.ts: some issues point to code that could not be matched exactly (2 issues).');
    expect(describeUnverifiedPart(progress.unverifiedParts[1])).toContain('could not be backed up with evidence');
  });
  it('reads persisted progress defensively', () => {
    expect(readCoverageProgress({ stage: 'complete' })).toBeNull();
    expect(readCoverageProgress({ coverage: 'partial', unverifiedParts: [{ reason: 'invented', files: [] }, { reason: 'source_evidence', files: ['a.ts', 3] }], unverifiedPartCount: 4 }))
      .toEqual({ coverage: 'partial', unverifiedParts: [{ reason: 'source_evidence', files: ['a.ts'], features: [] }], unverifiedPartCount: 4 });
  });
});
