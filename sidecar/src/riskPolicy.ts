/**
 * Canonical project-risk vocabulary and deterministic policy.
 *
 * Risk Level is intentionally derived from the independently persisted
 * Severity and remediation Priority.  This module is the service-side source
 * of truth; consumers should never reimplement the matrix in a screen.
 */

export const RISK_POLICY_VERSION = 'centinel-risk-v1';

export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low';
export type RiskPriority = 'high' | 'medium' | 'low';
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

const SEVERITIES = new Set<RiskSeverity>(['critical', 'high', 'medium', 'low']);
const PRIORITIES = new Set<RiskPriority>(['high', 'medium', 'low']);

const MATRIX: Record<RiskSeverity, Record<RiskPriority, RiskLevel>> = {
  critical: { high: 'critical', medium: 'critical', low: 'high' },
  high: { high: 'critical', medium: 'high', low: 'medium' },
  medium: { high: 'high', medium: 'medium', low: 'low' },
  low: { high: 'medium', medium: 'low', low: 'low' },
};

export function normalizeRiskSeverity(value: unknown): RiskSeverity | 'info' | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'info') return 'info';
  return SEVERITIES.has(normalized as RiskSeverity) ? normalized as RiskSeverity : null;
}

export function normalizeRiskPriority(value: unknown): RiskPriority | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return PRIORITIES.has(normalized as RiskPriority) ? normalized as RiskPriority : null;
}

/**
 * Derive Risk Level from independent canonical inputs. `Info` and incomplete
 * historical findings intentionally remain unclassified.
 */
export function deriveRiskLevel(severity: unknown, priority: unknown, policyVersion = RISK_POLICY_VERSION): RiskLevel | null {
  if (policyVersion !== RISK_POLICY_VERSION) return null;
  const normalizedSeverity = normalizeRiskSeverity(severity);
  const normalizedPriority = normalizeRiskPriority(priority);
  if (!normalizedSeverity || normalizedSeverity === 'info' || !normalizedPriority) return null;
  return MATRIX[normalizedSeverity][normalizedPriority];
}

/**
 * Static rules do not have a human-entered urgency. This conservative,
 * category-aware fallback gives newly generated rule findings a persisted
 * priority without simply copying Severity. AI findings may override it with
 * their explicit priority.
 */
export function inferPriority(severity: unknown, category: unknown): RiskPriority | null {
  const normalizedSeverity = normalizeRiskSeverity(severity);
  const normalizedCategory = typeof category === 'string' ? category.toLowerCase() : '';
  if (!normalizedSeverity || normalizedSeverity === 'info') return 'low';
  if (normalizedSeverity === 'critical') return 'high';
  if (normalizedSeverity === 'high') {
    return /security|secret|auth|payment|integrity/.test(normalizedCategory) ? 'high' : 'medium';
  }
  if (normalizedSeverity === 'medium') return 'medium';
  return 'low';
}

export function riskLevelRank(level: unknown): number {
  switch (String(level || '').toLowerCase()) {
    case 'critical': return 0;
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
    default: return 99;
  }
}

export function priorityRank(priority: unknown): number {
  switch (String(priority || '').toLowerCase()) {
    case 'high': return 0;
    case 'medium': return 1;
    case 'low': return 2;
    default: return 99;
  }
}
