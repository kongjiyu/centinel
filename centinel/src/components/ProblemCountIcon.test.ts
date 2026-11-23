import { describe, expect, it } from 'vitest';
import { problemCountTone } from './ProblemCountIcon';

describe('problem count severity', () => {
  it.each([
    [{ problemCount: 1, problemRisk: 'critical' }, 'critical'],
    [{ problemCount: 6, problemRisk: 'high', highProblemCount: 4 }, 'critical'],
    [{ problemCount: 6, problemRisk: 'high', highProblemCount: 3 }, 'high'],
    [{ problemCount: 2, problemRisk: 'high', highProblemCount: 2 }, 'high'],
    [{ problemCount: 1, problemRisk: 'medium' }, 'medium'],
    [{ problemCount: 1, problemRisk: 'low' }, 'low'],
    [{ problemCount: 8 }, 'unknown'],
    [{ problemCount: 0 }, 'none'],
  ] as const)('uses %j to pick %s', (summary, expected) => {
    expect(problemCountTone(summary)).toBe(expected);
  });
});
