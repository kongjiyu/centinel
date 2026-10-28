import { describe, expect, it } from 'vitest';
import { evidenceConfidence, rankEvidenceCandidates, withCitationEvidence } from '../../src/review/evidenceCandidates.js';
import type { AssessmentSourceSegment } from '../../src/review/assessmentBatches.js';
import type { StaticFindingInput } from '../../src/review/types.js';
import { findingFingerprint, normalizeAndDeduplicateFindings } from '../../src/review/findings.js';

function source(content: string, filePath = 'src/pay.ts', lineStart = 40): AssessmentSourceSegment {
  return { artifact: { id: filePath, projectId: 'p', type: 'source_code', source: 'repository',
    fileName: filePath, filePath, contentHash: 'frozen-hash', versionId: 'version-1', originalPath: null, createdAt: '2026-10-27T00:00:00Z' },
    state: 'available', content, lineStart, lineEnd: lineStart + content.split('\n').length - 1 };
}
const finding: StaticFindingInput = { title: 'Duplicate transaction risk', description: 'An observation requiring causal validation.',
  severity: 'high', category: 'business', filePath: 'src/pay.ts', lineNumber: 40, evidence: 'commit(payment);',
  recommendation: 'Inspect transaction uniqueness.', confidence: 'high', source: 'model' };

describe('frozen citation match confidence', () => {
  it('recomputes the occurrence fingerprint after relocation and never suppresses verified evidence', () => {
    const original = { ...finding, lineNumber: 1, fingerprint: 'model-pre-normalization-fingerprint' };
    const verified = withCitationEvidence(original, [source('commit(payment);')]);
    const uncertain = withCitationEvidence(original, [source('commit(payment);')], true);
    expect(verified.fingerprint).toBe(findingFingerprint(verified));
    expect(verified.fingerprint).not.toBe(original.fingerprint);
    expect(normalizeAndDeduplicateFindings([], [uncertain, verified]).model).toHaveLength(2);
    const deterministic = { ...verified, source: 'deterministic' as const, confidence: 'low' };
    const result = normalizeAndDeduplicateFindings([deterministic], [{ ...uncertain, confidence: 'high' }]);
    expect(result.deterministic).toHaveLength(1);
    expect(result.model).toHaveLength(1);
  });
  it('scores exact original locations without changing frozen identity', () => {
    const result = withCitationEvidence(finding, [source('commit(payment);')]);
    expect(result).toMatchObject({ artifactId: 'src/pay.ts', sourceVersion: 'frozen-hash', evidence: 'commit(payment);', lineNumber: 40,
      sourceLocator: { citationEvidence: { verification: 'verified', candidates: [{ score: 100, confidence: 'high', match: 'exact' }] } } });
  });
  it('relocates unique quotations but marks ambiguous quotations medium', () => {
    expect(rankEvidenceCandidates({ ...finding, lineNumber: 1 }, [source('commit(payment);')])[0]).toMatchObject({ score: 95, lineNumber: 40 });
    const matches = rankEvidenceCandidates({ ...finding, lineNumber: 1 }, [source('commit(payment);\ncommit(payment);')]);
    expect(matches).toHaveLength(2);
    expect(matches.every(match => match.confidence === 'medium')).toBe(true);
  });
  it('does not treat duplicate overlapping packets as different locations', () => {
    const packet = source('commit(payment);');
    expect(rankEvidenceCandidates({ ...finding, lineNumber: 1 }, [packet, packet])[0].score).toBe(95);
  });
  it('never turns approximate or mismatched-version candidates into verified proof', () => {
    const result = withCitationEvidence({ ...finding, evidence: 'commit(payment, again);' }, [source('commit(payment);')]);
    expect(result.sourceLocator?.citationEvidence).toMatchObject({ verification: 'needs_verification' });
    expect(result.evidence).toBe('commit(payment);');
    expect(rankEvidenceCandidates({ ...finding, sourceVersion: 'wrong-hash' }, [source('commit(payment);')])[0].score).toBe(80);
  });
  it('retains semantic uncertainty even with an exact source match', () => {
    const result = withCitationEvidence(finding, [source('commit(payment);')], true);
    expect(result.sourceLocator?.citationEvidence).toMatchObject({ verification: 'needs_verification', reason: 'support_unverified',
      candidates: [{ score: 100 }] });
  });
  it('never copies unmatched model text into evidence and counts missing related citations', () => {
    const result = withCitationEvidence({ ...finding, evidence: 'PRIVATE_UNKNOWN_QUOTE', relatedLocations: [{
      filePath: 'missing.ts', lineNumber: 1, evidence: 'ANOTHER_UNKNOWN_QUOTE' }] }, [source('return value;')]);
    expect(result.evidence).toBe('');
    expect(result.relatedLocations).toEqual([]);
    expect(result.sourceLocator?.citationEvidence).toMatchObject({ verification: 'needs_verification', unmatchedReferences: 2, candidates: [] });
    expect(JSON.stringify(result.sourceLocator)).not.toContain('PRIVATE_UNKNOWN_QUOTE');
  });
  it('excludes unavailable/out-of-packet content and bounds candidates', () => {
    expect(rankEvidenceCandidates(finding, [{ ...source('commit(payment);'), state: 'inaccessible' }])).toEqual([]);
    const candidates = rankEvidenceCandidates(finding, [source(Array(500).fill('commit(payment);').join('\n'))]);
    expect(candidates).toHaveLength(3);
    expect(candidates[0].score).toBe(100);
  });
  it('uses the published confidence thresholds', () => {
    expect([59, 60, 89, 90, 100].map(evidenceConfidence)).toEqual(['low', 'medium', 'medium', 'high', 'high']);
  });
});
