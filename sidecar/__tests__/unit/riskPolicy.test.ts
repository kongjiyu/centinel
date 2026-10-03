import { describe, expect, it } from 'vitest';
import { deriveRiskLevel, normalizeRiskPriority, normalizeRiskSeverity, RISK_POLICY_VERSION } from '../../src/riskPolicy.js';

describe('riskPolicy', () => {
  it.each([
    ['critical', 'high', 'critical'],
    ['critical', 'medium', 'critical'],
    ['critical', 'low', 'high'],
    ['high', 'high', 'critical'],
    ['high', 'medium', 'high'],
    ['high', 'low', 'medium'],
    ['medium', 'high', 'high'],
    ['medium', 'medium', 'medium'],
    ['medium', 'low', 'low'],
    ['low', 'high', 'medium'],
    ['low', 'medium', 'low'],
    ['low', 'low', 'low'],
  ])('derives %s + %s as %s', (severity, priority, expected) => {
    expect(deriveRiskLevel(severity, priority)).toBe(expected);
  });

  it('normalizes canonical values at the service boundary', () => {
    expect(normalizeRiskSeverity(' CRITICAL ')).toBe('critical');
    expect(normalizeRiskPriority(' Medium ')).toBe('medium');
    expect(deriveRiskLevel('HIGH', 'LOW')).toBe('medium');
  });

  it('keeps informational and incomplete findings unclassified', () => {
    expect(deriveRiskLevel('info', 'low')).toBeNull();
    expect(deriveRiskLevel('high', null)).toBeNull();
    expect(deriveRiskLevel('high', 'urgent')).toBeNull();
    expect(deriveRiskLevel('high', 'high', 'future-policy')).toBeNull();
  });

  it('exposes a named policy version', () => {
    expect(RISK_POLICY_VERSION).toBe('centinel-risk-v1');
  });
});
