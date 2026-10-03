import { describe, expect, it } from 'vitest';
import { correlateReviewFindings, type CorrelatableFinding } from '../../src/review/correlation.js';

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
    ...overrides,
  };
}

const compare = (previous: CorrelatableFinding[], current: CorrelatableFinding[], evaluatedArtifactIds = ['artifact-1']) => correlateReviewFindings({
  parentReviewId: 'parent-review', childReviewId: 'child-review', previous, current, evaluatedArtifactIds,
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

  it('classifies new, resolved, and carried-over findings without mutating parent findings', () => {
    const snapshot = compare(
      [
        finding({ id: 'resolved', artifactId: 'artifact-in-scope', stableFindingId: 'old-resolved' }),
        finding({ id: 'carry', artifactId: 'artifact-outside-scope', stableFindingId: 'old-carry' }),
      ],
      [finding({ id: 'new', artifactId: 'artifact-1', stableFindingId: 'brand-new' })],
      ['artifact-in-scope', 'artifact-1'],
    );
    expect(snapshot.counts).toMatchObject({ new: 1, resolved: 1, carried_over: 1 });
    expect(snapshot.correlations.map(item => item.classification)).toEqual(['new', 'resolved', 'carried_over']);
  });
});
