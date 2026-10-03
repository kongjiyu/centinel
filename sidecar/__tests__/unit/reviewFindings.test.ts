import { describe, expect, it } from 'vitest';
import { findingFingerprint, normalizeAndDeduplicateFindings, normalizeModelFinding } from '../../src/review/findings.js';
import type { StaticFindingInput } from '../../src/review/types.js';

const deterministic: StaticFindingInput = {
  source: 'deterministic', title: 'SQL injection', description: 'Parameterized query missing',
  severity: 'high', priority: 'high', category: 'security', filePath: 'src/db.ts', lineNumber: 10,
  evidence: 'query = "SELECT " + input', recommendation: 'Use parameters', confidence: 'high',
};

describe('review finding normalization', () => {
  it('normalizes model fields and derives risk policy values', () => {
    const value = normalizeModelFinding({ title: 'Issue', severity: 'HIGH', category: 'security', confidence: 'unexpected', lineNumber: '7' });
    expect(value).toMatchObject({ severity: 'high', priority: 'high', confidence: 'medium', lineNumber: 7, riskLevel: 'critical' });
  });

  it('deduplicates equivalent model findings while deterministic wins ties', () => {
    const model: StaticFindingInput = {
      ...deterministic, source: 'model', confidence: 'high', fingerprint: findingFingerprint(deterministic),
    };
    const merged = normalizeAndDeduplicateFindings([deterministic], [model]);
    expect(merged.all).toHaveLength(1);
    expect(merged.droppedModel).toHaveLength(1);
    expect(merged.all[0].source).toBe('deterministic');
  });

  it('allows a strictly higher-confidence model result to replace a rule result', () => {
    const lowStatic = { ...deterministic, confidence: 'medium' };
    const highModel = { ...deterministic, source: 'model' as const, confidence: 'high' };
    const merged = normalizeAndDeduplicateFindings([lowStatic], [highModel]);
    expect(merged.all).toHaveLength(1);
    expect(merged.all[0].source).toBe('model');
  });
});

