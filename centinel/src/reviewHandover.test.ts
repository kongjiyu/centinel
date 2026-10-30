import { describe, expect, it } from 'vitest';
import { reviewHandover } from './reviewHandover';
import type { Finding } from './types';

const base = { findings: [] as Finding[], findingsError: null, state: 'Completed', manifest: null, traceability: null, assessment: null };
const finding = { id: 'f1', status: 'new', severity: 'High', verifier: 'model', evidenceText: 'exact saved evidence' } as Finding;
describe('saved-evidence handover', () => {
  it('never infers readiness from an empty findings list or completed execution', () => {
    expect(reviewHandover(base).recommendation).toBe('Insufficient evidence');
    expect(reviewHandover({ ...base, state: 'Failed' }).reasons).toContain('The review has not completed its assessment.');
  });
  it('prioritizes confirmed high severity blockers while keeping lower risks visible', () => {
    const result = reviewHandover({ ...base, findings: [finding, { ...finding, id: 'f2', severity: 'Low' }] });
    expect(result.recommendation).toBe('Changes needed');
    expect(result.blockers.map(item => item.id)).toEqual(['f1']);
    expect(result.risks.map(item => item.id)).toEqual(['f2']);
  });
  it('keeps uncertain citations as evidence gaps, not confirmed blockers', () => {
    const uncertain = { ...finding, location: { sourceLocator: { citationEvidence: { verification: 'needs_verification' } } } } as Finding;
    const result = reviewHandover({ ...base, findings: [uncertain] });
    expect(result.blockers).toEqual([]);
    expect(result.gaps).toEqual([uncertain]);
    expect(result.recommendation).toBe('Insufficient evidence');
  });
  it('uses recorded priority before stable source ordering within a severity', () => {
    const result = reviewHandover({ ...base, findings: [{ ...finding, id: 'low', filePath: 'a.ts', priority: 'Low' }, { ...finding, id: 'urgent', filePath: 'z.ts', priority: 'High' }] });
    expect(result.blockers.map(item => item.id)).toEqual(['urgent', 'low']);
  });
  it('excludes individually resolved and dismissed findings without treating approval as resolution', () => {
    expect(reviewHandover({ ...base, findings: [{ ...finding, status: 'fixed' }, { ...finding, status: 'dismissed' }] }).blockers).toEqual([]);
    expect(reviewHandover({ ...base, findings: [{ ...finding, status: 'accepted' }] }).blockers).toHaveLength(1);
  });
  it('requires affirmative evidence in every readiness gate', () => {
    const verified = { ...base,
      manifest: { status: 'available', artifacts: [{ artifactVersionId: 'v1', contentHash: 'hash' }] },
      assessment: { readiness: 'ready', gaps: [], contradictions: [] },
      traceability: { status: 'available', records: [{ state: 'complete', evidenceStatus: 'verified' }] },
      map: { status: 'assessed', coverage: { unsupportedArtifacts: [], unresolvedEdgeCount: 0, limitations: [] }, features: [{ unresolved: [], assessments: Array.from({ length: 4 }, () => ({ status: 'assessed' })) }] },
    } as unknown as Parameters<typeof reviewHandover>[0];
    expect(reviewHandover(verified).recommendation).toBe('Ready within scope');
    expect(reviewHandover({ ...verified, findingsError: 'unavailable' }).recommendation).toBe('Insufficient evidence');
    expect(reviewHandover({ ...verified, state: 'Failed' }).recommendation).toBe('Insufficient evidence');
    expect(reviewHandover({ ...verified, state: 'Completed', executionStatus: 'failed' }).recommendation).toBe('Insufficient evidence');
    expect(reviewHandover({ ...verified, evidenceReady: false }).recommendation).toBe('Insufficient evidence');
    expect(reviewHandover({ ...verified, modelStatus: 'partial' }).recommendation).toBe('Insufficient evidence');
  });
});
