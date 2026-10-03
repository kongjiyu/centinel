/** Client display helpers for the service-owned Centinel Risk Matrix v1.
 * The API returns `riskLevel`; this parity helper is used for local fixtures
 * and legacy responses that predate the derived field. */

export const RISK_POLICY_VERSION = 'centinel-risk-v1';
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

const MATRIX: Record<string, Record<string, RiskLevel>> = {
  critical: { high: 'critical', medium: 'critical', low: 'high' },
  high: { high: 'critical', medium: 'high', low: 'medium' },
  medium: { high: 'high', medium: 'medium', low: 'low' },
  low: { high: 'medium', medium: 'low', low: 'low' },
};

export function deriveRiskLevel(severity: unknown, priority: unknown, policyVersion = RISK_POLICY_VERSION): RiskLevel | null {
  if (policyVersion !== RISK_POLICY_VERSION) return null;
  const normalizedSeverity = typeof severity === 'string' ? severity.trim().toLowerCase() : '';
  const normalizedPriority = typeof priority === 'string' ? priority.trim().toLowerCase() : '';
  if (normalizedSeverity === 'info') return null;
  if (!MATRIX[normalizedSeverity] || !['high', 'medium', 'low'].includes(normalizedPriority)) return null;
  return MATRIX[normalizedSeverity][normalizedPriority];
}

/**
 * Display fallback for legacy findings that predate persisted Priority.
 * A recorded Risk Level or valid Priority always takes precedence. We only
 * infer urgency when it is absent, never when an explicit value is unknown.
 */
export function deriveRiskLevelWithFallback(severity: unknown, priority: unknown, policyVersion = RISK_POLICY_VERSION): RiskLevel | null {
  const derived = deriveRiskLevel(severity, priority, policyVersion);
  if (derived) return derived;

  const normalizedPriority = typeof priority === 'string' ? priority.trim() : '';
  if (normalizedPriority) return null;

  const normalizedSeverity = typeof severity === 'string' ? severity.trim().toLowerCase() : '';
  const fallbackPriority = ({ critical: 'high', high: 'high', medium: 'medium', low: 'low' } as Record<string, string>)[normalizedSeverity];
  return fallbackPriority ? deriveRiskLevel(normalizedSeverity, fallbackPriority, policyVersion) : null;
}

export function riskLevelRank(level: unknown): number {
  return ({ critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>)[String(level || '').toLowerCase()] ?? 99;
}

export function priorityRank(priority: unknown): number {
  return ({ high: 0, medium: 1, low: 2 } as Record<string, number>)[String(priority || '').toLowerCase()] ?? 99;
}

export const RISK_MATRIX_ROWS = [
  { severity: 'Critical', high: 'Critical', medium: 'Critical', low: 'High' },
  { severity: 'High', high: 'Critical', medium: 'High', low: 'Medium' },
  { severity: 'Medium', high: 'High', medium: 'Medium', low: 'Low' },
  { severity: 'Low', high: 'Medium', medium: 'Low', low: 'Low' },
] as const;
