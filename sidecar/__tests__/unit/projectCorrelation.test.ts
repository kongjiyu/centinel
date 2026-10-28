import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { correlateProjectReview } from '../../src/review/projectCorrelation.js';
import { ASSESSMENT_VALIDATION_VERSION } from '../../src/review/assessmentValidation.js';
import { reconcileProjectFindings } from '../../src/review/findingReconciliation.js';
import type { PersistedReviewFinding, StaticReviewRecord } from '../../src/review/types.js';

const policy = 'test-policy';
const artifact = (hash: string, id = 'a1', path = 'src/account.ts'): Artifact => ({ id, projectId: 'p1', type: 'source_code', source: 'repository',
  fileName: path, filePath: path, originalPath: path, contentHash: hash, createdAt: '2026-10-01T00:00:00Z' });
const review = (id: string, day: number, patch: Partial<StaticReviewRecord> = {}): StaticReviewRecord => ({
  id, projectId: 'p1', name: id, reviewType: 'code_review', status: 'completed', modelStatus: 'succeeded',
  scope: { artifactIds: ['a1'] }, config: { instructions: 'Check ownership', modelPolicyVersion: policy },
  lineage: { parentReviewId: null, lineageRootId: id, reusedSourceManifest: false }, iteration: null,
  sourceManifestId: `manifest-${id}`, idempotencyKey: id, deterministicFindingCount: 0, modelFindingCount: 0,
  summary: '', failureReason: '', revision: 1,
  progress: { stage: 'complete', completedStages: [], updatedAt: `2026-10-0${day}T01:00:00Z` },
  createdAt: `2026-10-0${day}T00:00:00Z`, updatedAt: `2026-10-0${day}T01:00:00Z`, ...patch,
});
const r1 = review('r1', 1), r2 = review('r2', 2), r3 = review('r3', 3);
const finding = (r: StaticReviewRecord, id: string, patch: Partial<PersistedReviewFinding> = {}): PersistedReviewFinding => ({
  id, reviewId: r.id, projectId: r.projectId, source: 'model', title: 'Ownership check missing', description: 'Returns private account without checking ownership.',
  category: 'security', severity: 'high', priority: 'high', filePath: 'src/account.ts', lineNumber: 12, artifactId: 'a1',
  sourceIdentity: 'src/account.ts', sourceVersion: `hash-${r.id}`, evidence: 'return account', recommendation: 'Check ownership.',
  confidence: 'high', stableFindingId: 'ownership-check', createdAt: r.createdAt, ...patch,
});
const old = finding(r1, 'old');
type Input = Parameters<typeof correlateProjectReview>[0];
function input(patch: Partial<Input> = {}): Input {
  const targetReview = patch.review ?? r3;
  return { review: r3, modelStatus: 'succeeded', sourceManifestId: r3.sourceManifestId, reviews: [r1], previous: [old], current: [],
    snapshots: [], manifests: new Map([[r1.sourceManifestId!, [artifact('hash-r1')]]]),
    evaluated: [{ artifact: artifact('hash-r3'), readable: true }], modelPolicyVersion: policy,
    assessmentValidation: { version: ASSESSMENT_VALIDATION_VERSION, artifactIds: ['a1','a2'], inspectedReferences: ['a1','a2'].map((artifactId, index) => ({ artifactId, filePath: index === 0 ? 'src/account.ts' : 'src/billing.ts', lineNumber: 12, sourceVersion: `hash-${targetReview.id}`, featureId: 'operation', domain: 'security' })) }, ...patch };
}
function present(args: Input, snapshot: NonNullable<ReturnType<typeof correlateProjectReview>>) {
  return reconcileProjectFindings({
    findings: [...args.previous, ...args.current].map(f => ({ ...f, source: 'static' as const, status: 'new' as const, sessionId: f.reviewId, artifactId: f.artifactId ?? null })),
    reviews: [...args.reviews, args.review],
    manifests: [...args.reviews, args.review].map(r => ({ id: r.sourceManifestId!, reviewId: r.id, status: 'available',
      artifacts: r.id === args.review.id ? args.evaluated.map(item => item.artifact) : args.manifests.get(r.sourceManifestId!) ?? [] })),
    correlations: [...args.snapshots, snapshot].flatMap(s => s.correlations), snapshotChildReviewIds: [...args.snapshots, snapshot].map(s => s.childReviewId),
    ambiguities: [...args.snapshots, snapshot].flatMap(s => s.ambiguities.map(a => ({ childReviewId: s.childReviewId, candidateParentFindingIds: a.candidateParentFindingIds }))),
  });
}

describe('end-of-review project reconciliation', () => {
  it('consolidates identical older occurrences under the oldest ID when the issue is reproduced', () => {
    const args = input({ reviews: [r1, r2], previous: [{ ...old, fingerprint: 'exact-issue' }, finding(r2, 'duplicate', { fingerprint: 'exact-issue' })],
      current: [finding(r3, 'latest', { fingerprint: 'exact-issue' })],
      manifests: new Map([[r1.sourceManifestId!, [artifact('hash-r1')]], [r2.sourceManifestId!, [artifact('hash-r2')]]]) });
    const snapshot = correlateProjectReview(args)!;
    expect(snapshot.ambiguities).toHaveLength(0);
    expect(present(args, snapshot)).toMatchObject([{ id: 'old', latestOccurrence: { findingId: 'latest' } }]);
  });
  it('reuses an old issue across independent reviews without requiring iteration linkage', () => {
    const args = input({ current: [finding(r3, 'occurrence')] });
    const snapshot = correlateProjectReview(args)!;
    expect(snapshot.counts).toMatchObject({ new: 0, recurring: 1, resolved: 0 });
    expect(present(args, snapshot)).toMatchObject([{ id: 'old', sessionId: 'r3', latestOccurrence: { findingId: 'occurrence' } }]);
  });

  it('checks multiple earlier reviews in one run and keeps the correct baseline per finding', () => {
    const second = finding(r2, 'other', { stableFindingId: 'billing-limit', artifactId: 'a2', sourceIdentity: 'src/billing.ts', filePath: 'src/billing.ts' });
    const a1 = artifact('hash-r1'), a2 = artifact('hash-r1', 'a2', 'src/billing.ts');
    const scope = { artifactIds: ['a1', 'a2'] };
    const args = input({ review: { ...r3, scope }, reviews: [{ ...r1, scope }, { ...r2, scope }], previous: [old, second], current: [finding(r3, 'occurrence')],
      manifests: new Map([[r1.sourceManifestId!, [a1, a2]], [r2.sourceManifestId!, [artifact('hash-r2'), { ...a2, contentHash: 'hash-r2' }]]]),
      evaluated: [{ artifact: artifact('hash-r3'), readable: true }, { artifact: { ...a2, contentHash: 'hash-r3' }, readable: true }] });
    const snapshot = correlateProjectReview(args)!;
    expect(snapshot.counts).toMatchObject({ recurring: 1, resolved: 1, new: 0 });
    expect(snapshot.correlations.find(row => row.parentFindingId === 'old')?.parentReviewId).toBe('r1');
    expect(snapshot.correlations.find(row => row.parentFindingId === 'other')?.parentReviewId).toBe('r2');
    expect(present(args, snapshot).find(row => row.id === 'other')?.resolutionEvidence?.reviewId).toBe('r3');
  });

  it('retains an old issue through an intervening review that could not establish resolution', () => {
    const middle = correlateProjectReview(input({ review: { ...r2, config: { ...r2.config, instructions: 'Different question' } }, sourceManifestId: r2.sourceManifestId }))!;
    expect(middle.counts.carried_over).toBe(1);
    const args = input({ reviews: [r1, { ...r2, config: { ...r2.config, instructions: 'Different question' } }], snapshots: [middle],
      manifests: new Map([[r1.sourceManifestId!, [artifact('hash-r1')]], [r2.sourceManifestId!, [artifact('hash-r2')]]]) });
    const snapshot = correlateProjectReview(args)!;
    expect(snapshot.correlations).toMatchObject([{ parentFindingId: 'old', parentReviewId: 'r1', classification: 'resolved' }]);
    expect(present(args, snapshot)[0].resolutionEvidence?.reviewId).toBe('r3');
  });

  it('matches against the latest occurrence while preserving the first issue ID through three reviews', () => {
    const occurrence = finding(r2, 'middle');
    const middleArgs = input({ review: r2, sourceManifestId: r2.sourceManifestId, current: [occurrence], evaluated: [{ artifact: artifact('hash-r2'), readable: true }] });
    const middle = correlateProjectReview(middleArgs)!;
    const args = input({ reviews: [r1, r2], previous: [old, occurrence], current: [finding(r3, 'latest')], snapshots: [middle],
      manifests: new Map([[r1.sourceManifestId!, [artifact('hash-r1')]], [r2.sourceManifestId!, [artifact('hash-r2')]]]) });
    const snapshot = correlateProjectReview(args)!;
    expect(snapshot.counts).toMatchObject({ recurring: 1, new: 0, carried_over: 0 });
    expect(snapshot.correlations[0].parentFindingId).toBe('middle');
    expect(present(args, snapshot)).toMatchObject([{ id: 'old', latestOccurrence: { findingId: 'latest' } }]);
  });

  it('reopens a previously resolved issue under its original ID when it reappears', () => {
    const middle = correlateProjectReview(input({ review: r2, sourceManifestId: r2.sourceManifestId, evaluated: [{ artifact: artifact('hash-r2'), readable: true }] }))!;
    expect(middle.counts.resolved).toBe(1);
    const args = input({ reviews: [r1, r2], snapshots: [middle], current: [finding(r3, 'reappeared')],
      manifests: new Map([[r1.sourceManifestId!, [artifact('hash-r1')]], [r2.sourceManifestId!, [artifact('hash-r2')]]]) });
    const snapshot = correlateProjectReview(args)!;
    expect(snapshot.counts.regressed).toBe(1);
    const result = present(args, snapshot);
    expect(result).toMatchObject([{ id: 'old', status: 'new' }]);
    expect(result[0].resolutionEvidence).toBeUndefined();
  });

  it.each([
    ['partial model', { modelStatus: 'partial' }],
    ['unreadable content', { evaluated: [{ artifact: artifact('hash-r3'), readable: false }] }],
    ['unchanged source', { evaluated: [{ artifact: artifact('hash-r1'), readable: true }] }],
    ['changed rules', { review: { ...r3, config: { ...r3.config, instructions: 'Different checks' } } }],
    ['changed scope', { review: { ...r3, scope: { artifactIds: ['a1', 'a2'] } } }],
  ])('does not resolve an old finding with %s', (_label, patch) => {
    const snapshot = correlateProjectReview(input(patch as Partial<Input>))!;
    expect(snapshot.counts.resolved).toBe(0);
    expect(snapshot.counts.carried_over).toBe(1);
  });

  it('can reuse a confident duplicate under a different objective without claiming absent issues resolved', () => {
    const args = input({ review: { ...r3, config: { ...r3.config, instructions: 'Different checks' } }, current: [finding(r3, 'occurrence')] });
    const snapshot = correlateProjectReview(args)!;
    expect(present(args, snapshot)).toMatchObject([{ id: 'old', latestOccurrence: { findingId: 'occurrence' } }]);
  });

  it('retains uncertain matches without closing the old issues', () => {
    const args = input({ previous: [old, { ...old, id: 'another-old' }], current: [finding(r3, 'uncertain')] });
    const snapshot = correlateProjectReview(args)!;
    expect(snapshot.counts).toMatchObject({ resolved: 0, recurring: 0, carried_over: 2, new: 1 });
    expect(snapshot.ambiguities).toHaveLength(1);
  });

  it('excludes other projects and non-successful earlier executions from resolution baselines', () => {
    expect(correlateProjectReview(input({ reviews: [{ ...r1, projectId: 'other' }] }))).toBeNull();
    expect(correlateProjectReview(input({ reviews: [{ ...r1, modelStatus: 'partial' }] }))).toBeNull();
    expect(correlateProjectReview(input({ reviews: [{ ...r1, progress: null }] }))).toBeNull();
  });
});
