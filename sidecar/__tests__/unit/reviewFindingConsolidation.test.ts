import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { ASSESSMENT_VALIDATION_VERSION } from '../../src/review/assessmentValidation.js';
import { findingFingerprint, MAX_MERGED_OBSERVATIONS, mergedObservationsOf, mergedObservationTotal, normalizeAndDeduplicateFindings } from '../../src/review/findings.js';
import { correlateProjectReview } from '../../src/review/projectCorrelation.js';
import type { PersistedReviewFinding, StaticFindingInput, StaticReviewRecord } from '../../src/review/types.js';

const consolidate = { consolidateReviewObservations: true } as const;

function citation(verification: 'verified' | 'needs_verification', lineNumber: number) {
  return { version: 1, verification, reason: verification === 'verified' ? 'source_match' : 'support_unverified', unmatchedReferences: 0,
    candidates: [{ artifactId: 'validators', sourceVersion: 'v1', filePath: 'backend/validators.ts', lineNumber, excerpt: 'amount: Joi.number()', score: verification === 'verified' ? 100 : 70,
      confidence: verification === 'verified' ? 'high' : 'medium', match: verification === 'verified' ? 'exact' : 'approximate', referenceIndex: 0 }] };
}

function observation(title: string, patch: Partial<StaticFindingInput> = {}, verification: 'verified' | 'needs_verification' = 'verified'): StaticFindingInput {
  const finding: StaticFindingInput = {
    source: 'model', domain: 'business', issueType: 'non_positive_payment_amount', title,
    description: `${title}: the payment schema accepts zero or negative amounts.`, severity: 'high', category: 'business_logic',
    filePath: 'backend/validators.ts', lineNumber: 87, artifactId: 'validators', sourceVersion: 'v1',
    evidence: 'amount: Joi.number()', recommendation: 'Require a positive amount.', confidence: 'high',
    sourceLocator: { citationEvidence: citation(verification, patch.lineNumber ?? 87) },
    ...patch,
  };
  return { ...finding, fingerprint: findingFingerprint(finding) };
}

describe('same-Review finding consolidation', () => {
  it('keeps the existing behavior unless consolidation is requested', () => {
    const verified = observation('Payment amount not validated');
    const uncertain = observation('Negative payments allowed', { lineNumber: 88 }, 'needs_verification');
    expect(normalizeAndDeduplicateFindings([], [uncertain, verified]).model).toHaveLength(2);
  });

  it('absorbs a needs-verification copy into the verified finding and keeps its evidence', () => {
    const verified = observation('Payment amount not validated');
    const uncertain = observation('Negative payments allowed', { lineNumber: 88, evidence: 'amount: Joi.number(),' }, 'needs_verification');
    const result = normalizeAndDeduplicateFindings([], [uncertain, verified], consolidate);
    expect(result.model).toHaveLength(1);
    const [kept] = result.model;
    // The verified observation represents the issue with its own identity unchanged.
    expect(kept.title).toBe('Payment amount not validated');
    expect(kept.fingerprint).toBe(verified.fingerprint);
    expect(kept.sourceLocator?.citationEvidence).toMatchObject({ verification: 'verified' });
    expect(mergedObservationsOf(kept)).toEqual([expect.objectContaining({
      reason: 'uncertain_copy_of_verified', title: 'Negative payments allowed', lineNumber: 88, evidence: 'amount: Joi.number(),',
      verification: 'needs_verification', fingerprint: uncertain.fingerprint,
      citationEvidence: expect.objectContaining({ verification: 'needs_verification' }),
    })]);
    expect(result.mergedObservationCount).toBe(1);
  });

  it('never lets an uncertain observation absorb a verified one', () => {
    const verified = observation('Payment amount not validated', { severity: 'medium' });
    const uncertain = observation('Negative payments allowed', { severity: 'critical' }, 'needs_verification');
    const [kept] = normalizeAndDeduplicateFindings([], [uncertain, verified], consolidate).model;
    expect(kept.title).toBe('Payment amount not validated');
    expect(mergedObservationsOf(kept)[0]).toMatchObject({ severity: 'critical', verification: 'needs_verification' });
  });

  it('collapses reworded rows at the same file, line and issue type into one finding', () => {
    const titles = ['Payment amount not validated', 'Negative transfer amounts accepted', 'Zero-value payments possible',
      'Amount lacks positivity check', 'Unbounded payment amount', 'Payment amount sign unchecked'];
    const rows = titles.map((title, index) => observation(title, { evidence: index % 2 ? 'amount: Joi.number(),' : 'amount: Joi.number()' }));
    const result = normalizeAndDeduplicateFindings([], rows, consolidate);
    expect(result.model).toHaveLength(1);
    expect(mergedObservationsOf(result.model[0]).map(item => item.title)).toEqual(titles.slice(1));
    expect(mergedObservationTotal(result.model[0])).toBe(5);
    expect(result.mergedObservationCount).toBe(5);
    expect(result.droppedModel).toHaveLength(5);
  });

  it('prefers the more severe, then requirement-linked observation and carries earlier merges along', () => {
    const first = observation('Payment amount not validated', { severity: 'medium' });
    const second = observation('Negative transfer amounts accepted', { severity: 'medium' });
    const linked = observation('Payments can move money backwards', { severity: 'high', requirementId: 'req-4' });
    const [kept] = normalizeAndDeduplicateFindings([], [first, second, linked], consolidate).model;
    expect(kept.title).toBe('Payments can move money backwards');
    expect(kept.requirementId).toBe('req-4');
    expect(mergedObservationsOf(kept).map(item => item.title)).toEqual(['Payment amount not validated', 'Negative transfer amounts accepted']);
  });

  it('keeps different issues separate', () => {
    const base = observation('Payment amount not validated');
    const cases: StaticFindingInput[] = [
      observation('Payment amount not validated', { issueType: 'missing_authorization', evidence: 'router.patch(' }),
      observation('Different requirement', { requirementId: 'req-9', evidence: 'x' }),
      observation('Different domain', { domain: 'security', evidence: 'x' }),
      observation('Far away', { lineNumber: 120, evidence: 'y' }),
      observation('Other file', { filePath: 'backend/database.ts', artifactId: 'database' }),
      observation('Adjacent line without shared evidence', { lineNumber: 89, evidence: 'description: Joi.string()' }),
    ];
    for (const other of cases) {
      expect(normalizeAndDeduplicateFindings([], [{ ...base, requirementId: other.requirementId ? 'req-2' : null }, other], consolidate).model, other.title).toHaveLength(2);
    }
    const uncertainFar = observation('Uncertain far away', { lineNumber: 95 }, 'needs_verification');
    expect(normalizeAndDeduplicateFindings([], [base, uncertainFar], consolidate).model).toHaveLength(2);
  });

  it('records a model observation absorbed by a rule finding instead of losing it', () => {
    const rule: StaticFindingInput = { source: 'deterministic', title: '[secrets-api-key] Possible hardcoded credential in "secret".',
      description: 'Possible hardcoded credential in "secret".', severity: 'high', category: 'secrets', filePath: 'backend/app.ts', lineNumber: 60,
      evidence: 'secret = [literal redacted]', recommendation: 'Load it from the environment.', confidence: 'high', ruleId: 'secrets-api-key' };
    const model: StaticFindingInput = { ...rule, source: 'model', ruleId: null, confidence: 'medium', fingerprint: findingFingerprint(rule),
      description: 'The session secret is a fixed literal, so sessions can be forged.', requirementId: 'req-7' };
    const result = normalizeAndDeduplicateFindings([rule], [model], consolidate);
    expect(result.all).toHaveLength(1);
    expect(result.deterministic[0].fingerprint).toBe(findingFingerprint(rule));
    expect(mergedObservationsOf(result.deterministic[0])).toEqual([expect.objectContaining({ source: 'model', requirementId: 'req-7',
      description: 'The session secret is a fixed literal, so sessions can be forged.' })]);
  });

  it('bounds stored observations while keeping the true total', () => {
    const rows = Array.from({ length: 40 }, (_, index) => observation(`Reworded title ${index}`));
    const [kept] = normalizeAndDeduplicateFindings([], rows, consolidate).model;
    expect(mergedObservationsOf(kept)).toHaveLength(MAX_MERGED_OBSERVATIONS);
    expect(mergedObservationTotal(kept)).toBe(39);
  });
});

describe('merged observations and project resolution', () => {
  const policy = 'test-policy';
  const artifact = (hash: string): Artifact => ({ id: 'a1', projectId: 'p1', type: 'source_code', source: 'repository',
    fileName: 'src/account.ts', filePath: 'src/account.ts', originalPath: 'src/account.ts', contentHash: hash, createdAt: '2026-10-01T00:00:00Z' });
  const review = (id: string, day: number): StaticReviewRecord => ({
    id, projectId: 'p1', name: id, reviewType: 'code_review', status: 'completed', modelStatus: 'succeeded',
    scope: { artifactIds: ['a1'] }, config: { instructions: 'Check ownership', modelPolicyVersion: policy },
    lineage: { parentReviewId: null, lineageRootId: id, reusedSourceManifest: false }, iteration: null,
    sourceManifestId: `manifest-${id}`, idempotencyKey: id, deterministicFindingCount: 0, modelFindingCount: 0,
    summary: '', failureReason: '', revision: 1,
    progress: { stage: 'complete', completedStages: [], updatedAt: `2026-10-0${day}T01:00:00Z` },
    createdAt: `2026-10-0${day}T00:00:00Z`, updatedAt: `2026-10-0${day}T01:00:00Z`,
  });
  const r1 = review('r1', 1), r3 = review('r3', 3);
  const finding = (r: StaticReviewRecord, id: string, patch: Partial<PersistedReviewFinding> = {}): PersistedReviewFinding => ({
    id, reviewId: r.id, projectId: 'p1', source: 'model', title: 'Ownership check missing', description: 'Returns private account.',
    category: 'security', severity: 'high', priority: 'high', filePath: 'src/account.ts', lineNumber: 12, artifactId: 'a1',
    sourceIdentity: 'src/account.ts', sourceVersion: `hash-${r.id}`, evidence: 'return account', recommendation: 'Check ownership.',
    confidence: 'high', stableFindingId: 'ownership-check', createdAt: r.createdAt, ...patch,
  });
  const run = (current: PersistedReviewFinding[]) => correlateProjectReview({
    review: r3, modelStatus: 'succeeded', sourceManifestId: r3.sourceManifestId, reviews: [r1], previous: [finding(r1, 'old')], current,
    snapshots: [], manifests: new Map([[r1.sourceManifestId!, [artifact('hash-r1')]]]),
    evaluated: [{ artifact: artifact('hash-r3'), readable: true }], modelPolicyVersion: policy,
    assessmentValidation: { version: ASSESSMENT_VALIDATION_VERSION, artifactIds: ['a1'],
      inspectedReferences: [{ artifactId: 'a1', filePath: 'src/account.ts', lineNumber: 12, sourceVersion: 'hash-r3', featureId: 'operation', domain: 'security' }] },
  })!;

  it('does not resolve an old issue that a merged observation of this Review still points at', () => {
    const unrelated = finding(r3, 'other', { category: 'business_logic', stableFindingId: 'other', title: 'Totals rounding', lineNumber: 40, evidence: 'round(total)' });
    expect(run([unrelated]).counts).toMatchObject({ resolved: 1 });
    const withRepeat = { ...unrelated, sourceLocator: { mergedObservations: [{ version: 1, reason: 'duplicate', source: 'model', title: 'Account read without owner check',
      description: '', severity: 'high', confidence: 'medium', category: 'security', issueType: null, filePath: 'src/account.ts', lineNumber: 13,
      evidence: 'return account', requirementId: null, fingerprint: null, verification: 'verified' }], mergedObservationTotal: 1 } };
    const snapshot = run([withRepeat]);
    expect(snapshot.counts).toMatchObject({ resolved: 0, carried_over: 1 });
    expect(snapshot.correlations.find(item => item.parentFindingId === 'old')).not.toHaveProperty('resolutionEligibility');
  });
});
