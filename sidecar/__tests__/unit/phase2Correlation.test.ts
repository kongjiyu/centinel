import { describe, expect, it } from 'vitest';
import { correlateReviewFindings, type CorrelatableFinding, type FindingResolutionContext } from '../../src/review/correlation.js';

function finding(overrides: Partial<CorrelatableFinding> = {}): CorrelatableFinding {
  return {
    id: 'finding-1',
    source: 'model',
    title: 'Authorization check is missing',
    description: 'The account handler returns private data without checking ownership.',
    severity: 'high',
    priority: 'high',
    category: 'security',
    filePath: 'src/account.ts',
    lineNumber: 20,
    artifactId: 'artifact-1',
    evidence: 'return account before ownership validation',
    recommendation: 'Validate account ownership first.',
    confidence: 'high',
    sourceIdentity: 'src/account.ts',
    sourceVersion: 'sha256:old-version',
    ...overrides,
  };
}

const compare = (previous: CorrelatableFinding[], current: CorrelatableFinding[]) => correlateReviewFindings({
  parentReviewId: 'parent-review', childReviewId: 'child-review', previous, current,
});

const resolutionContext = (overrides: Partial<FindingResolutionContext> = {}): FindingResolutionContext => ({
  modelStatus: 'succeeded',
  parentSourceManifestId: 'manifest-parent',
  sourceManifestId: 'manifest-child',
  allSourcesReadable: true,
  parentSourceArtifacts: [{ artifactId: 'artifact-1', sourceIdentity: 'src/account.ts', filePath: 'src/account.ts', sourceVersion: 'sha256:old-version' }],
  childSourceArtifacts: [{ artifactId: 'artifact-1', sourceIdentity: 'src/account.ts', filePath: 'src/account.ts', sourceVersion: 'sha256:new-version' }],
  parentReviewType: 'code_review',
  childReviewType: 'code_review',
  parentScope: { artifactIds: ['artifact-1'], sourceIds: ['source-1'] },
  childScope: { artifactIds: ['artifact-1'], sourceIds: ['source-1'] },
  parentConfig: { instructions: 'Inspect authorization behavior', checks: ['security'] },
  childConfig: { instructions: 'Inspect authorization behavior', checks: ['security'] },
  parentIterationFeedback: '',
  childIterationFeedback: '',
  ...overrides,
});

describe('finding correlation across Review iterations', () => {
  it('prefers exact stable finding identifiers and classifies worsening severity as regressed', () => {
    const snapshot = compare(
      [finding({ stableFindingId: 'stable-1', severity: 'medium', priority: 'medium' })],
      [finding({ id: 'finding-next', stableFindingId: 'stable-1', severity: 'critical', priority: 'urgent' })],
    );
    expect(snapshot.correlations).toHaveLength(1);
    expect(snapshot.correlations[0]).toMatchObject({ classification: 'regressed', method: 'stable_id', score: 1, parentFindingId: 'finding-1', childFindingId: 'finding-next' });
  });

  it('classifies a higher remediation priority as regressed even when severity is unchanged', () => {
    const snapshot = compare(
      [finding({ stableFindingId: 'stable-priority', severity: 'medium', priority: 'low' })],
      [finding({ id: 'finding-next', stableFindingId: 'stable-priority', severity: 'medium', priority: 'high' })],
    );
    expect(snapshot.correlations[0].classification).toBe('regressed');
  });

  it('correlates a wording change and file movement when source, rule, location, and evidence remain similar', () => {
    const snapshot = compare(
      [finding({ ruleId: 'AUTH-7', filePath: 'src/old/account.ts', lineNumber: 20 })],
      [finding({
        id: 'finding-next', ruleId: 'AUTH-7', filePath: 'src/account.ts', lineNumber: 22,
        title: 'Handler should verify ownership before disclosure',
        description: 'Ownership is not checked before private account data is returned.',
        evidence: 'account returned prior to ownership check',
      })],
    );
    expect(snapshot.correlations[0].classification).toBe('recurring');
    expect(snapshot.correlations[0].method).toBe('heuristic');
    expect(snapshot.correlations[0].score).toBeGreaterThan(0.57);
  });

  it('does not silently merge a Critical heuristic match and discloses competing candidates', () => {
    const previous = [
      finding({ id: 'old-a', ruleId: 'AUTH-7' }),
      finding({ id: 'old-b', ruleId: 'AUTH-7' }),
    ];
    const critical = finding({ id: 'new-critical', ruleId: 'AUTH-7', severity: 'critical', priority: 'urgent', title: 'Authorization verification omitted' });
    const criticalSnapshot = compare(previous.slice(0, 1), [critical]);
    expect(criticalSnapshot.correlations[0]).toMatchObject({ classification: 'new', method: 'unmatched', parentFindingId: null });
    expect(criticalSnapshot.ambiguities[0].reason).toBe('critical_requires_confirmation');

    const collision = compare(previous, [finding({ id: 'new-ambiguous', ruleId: 'AUTH-7' })]);
    expect(collision.correlations[0].classification).toBe('new');
    expect(collision.ambiguities[0]).toMatchObject({ reason: 'close_candidates', candidateParentFindingIds: ['old-a', 'old-b'] });
  });

  it('classifies new and carried-over findings without treating a generic absence as resolution', () => {
    const snapshot = compare(
      [
        finding({ id: 'resolved', artifactId: 'artifact-in-scope', stableFindingId: 'old-resolved' }),
        finding({ id: 'carry', artifactId: 'artifact-outside-scope', stableFindingId: 'old-carry' }),
      ],
      [finding({ id: 'new', artifactId: 'artifact-1', stableFindingId: 'brand-new' })],
    );
    expect(snapshot.counts).toMatchObject({ new: 1, carried_over: 2, resolved: 0 });
    expect(snapshot.correlations.map(item => item.classification)).toEqual(['new', 'carried_over', 'carried_over']);
    expect(snapshot.correlations.every(item => !item.resolutionEligibility)).toBe(true);
  });

  it('marks absence as not reproduced only with changed source versions and full comparable success evidence', () => {
    const snapshot = correlateReviewFindings({
      parentReviewId: 'parent-review', childReviewId: 'child-review',
      previous: [finding({ id: 'resolved', artifactId: 'artifact-1' })],
      current: [],
      evaluatedSources: [{ artifactId: 'artifact-1', sourceIdentity: 'src/account.ts', filePath: 'src/account.ts', sourceVersion: 'sha256:new-version' }],
      resolutionContext: resolutionContext(),
    });
    expect(snapshot.correlations[0]).toMatchObject({
      classification: 'resolved', parentFindingId: 'resolved', childFindingId: null,
      resolutionEligibility: {
        version: 1,
        basis: 'not_reproduced_in_comparable_review',
        parentSourceManifestId: 'manifest-parent',
        sourceManifestId: 'manifest-child',
        parentSourceVersion: 'sha256:old-version',
        reviewedSourceVersion: 'sha256:new-version',
      },
    });
  });

  it('uses a missing old finding version only from the parent manifest source record', () => {
    const snapshot = correlateReviewFindings({
      parentReviewId: 'parent-review', childReviewId: 'child-review',
      previous: [finding({ id: 'legacy-versionless', artifactId: 'artifact-1', sourceVersion: null })],
      current: [],
      evaluatedSources: [{ artifactId: 'artifact-1', sourceIdentity: 'src/account.ts', filePath: 'src/account.ts', sourceVersion: 'sha256:new-version' }],
      resolutionContext: resolutionContext(),
    });
    expect(snapshot.correlations[0]).toMatchObject({ classification: 'resolved', resolutionEligibility: { parentSourceVersion: 'sha256:old-version' } });
  });

  it('rejects a recorded parent version that conflicts with the parent manifest', () => {
    const snapshot = correlateReviewFindings({
      parentReviewId: 'parent-review', childReviewId: 'child-review',
      previous: [finding({ id: 'mismatched-version', artifactId: 'artifact-1', sourceVersion: 'wrong-version' })],
      current: [],
      evaluatedSources: [{ artifactId: 'artifact-1', sourceIdentity: 'src/account.ts', filePath: 'src/account.ts', sourceVersion: 'sha256:new-version' }],
      resolutionContext: resolutionContext(),
    });
    expect(snapshot.correlations[0].classification).toBe('carried_over');
    expect(snapshot.correlations[0].resolutionEligibility).toBeUndefined();
  });

  it.each([
    ['model failure', { modelStatus: 'failed' as const }],
    ['partial model coverage', { modelStatus: 'partial' as const }],
    ['unreadable source', { allSourcesReadable: false }],
    ['missing parent manifest', { parentSourceManifestId: null }],
    ['missing child manifest', { sourceManifestId: null }],
    ['empty parent coverage', { parentSourceArtifacts: [] }],
    ['empty child coverage', { childSourceArtifacts: [] }],
    ['different review type', { childReviewType: 'requirement_review' }],
    ['different source scope', { childScope: { artifactIds: ['artifact-1', 'artifact-2'], sourceIds: ['source-1'] } }],
    ['different check configuration', { childConfig: { instructions: 'Inspect authorization behavior', checks: ['accessibility'] } }],
    ['different objective instructions', { childConfig: { instructions: 'Inspect performance only', checks: ['security'] } }],
    ['different iteration objective', { childIterationFeedback: 'Focus on a different issue.' }],
    ['different effective source set', { childSourceArtifacts: [
      { artifactId: 'artifact-1', sourceIdentity: 'src/account.ts', filePath: 'src/account.ts', sourceVersion: 'new-version' },
      { artifactId: 'artifact-2', sourceIdentity: 'src/other.ts', filePath: 'src/other.ts', sourceVersion: 'other-version' },
    ] }],
  ])('carries the finding over when %s', (_label, overrides) => {
    const snapshot = correlateReviewFindings({
      parentReviewId: 'parent-review', childReviewId: 'child-review',
      previous: [finding({ id: 'carry', artifactId: 'artifact-1' })],
      current: [],
      evaluatedSources: [{ artifactId: 'artifact-1', sourceIdentity: 'src/account.ts', filePath: 'src/account.ts', sourceVersion: 'sha256:new-version' }],
      resolutionContext: resolutionContext(overrides),
    });
    expect(snapshot.correlations[0].classification).toBe('carried_over');
    expect(snapshot.correlations[0].resolutionEligibility).toBeUndefined();
  });

  it('carries the finding when the source version did not change', () => {
    const snapshot = correlateReviewFindings({
      parentReviewId: 'parent-review', childReviewId: 'child-review',
      previous: [finding({ id: 'unchanged', artifactId: 'artifact-1' })],
      current: [],
      evaluatedSources: [{ artifactId: 'artifact-1', sourceIdentity: 'src/account.ts', filePath: 'src/account.ts', sourceVersion: 'old-version' }],
      resolutionContext: resolutionContext({ childSourceArtifacts: [{ artifactId: 'artifact-1', sourceIdentity: 'src/account.ts', filePath: 'src/account.ts', sourceVersion: 'old-version' }] }),
    });
    expect(snapshot.correlations[0].classification).toBe('carried_over');
    expect(snapshot.correlations[0].resolutionEligibility).toBeUndefined();
  });
});
