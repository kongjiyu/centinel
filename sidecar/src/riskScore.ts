/**
 * Risk scoring engine for static analysis findings.
 *
 * This legacy numeric score remains available to the static-rule pipeline for
 * prioritising model context. User-facing Risk Level is now derived by the
 * canonical Severity + Priority policy in `riskPolicy.ts`.
 *
 * Each factor is normalized to [0, 1], producing a final score in [0, 1].
 */

import { deriveRiskLevel, normalizeRiskPriority, type RiskLevel, type RiskPriority } from './riskPolicy.js';

export type RiskInput = {
  severity: string;
  priority?: string;
  confidence: string;
  category: string;
  filePath: string;
  dependencies?: number;  // how many files depend on this file
  totalFiles?: number;    // total files in project
};

export type RiskScore = {
  score: number;           // 0-1
  level: RiskLevel | 'info';
  /** Canonical policy output when independent priority is available. */
  policyLevel?: RiskLevel | null;
  priority?: RiskPriority | null;
  factors: {
    severity: number;
    confidence: number;
    moduleImportance: number;
    securityBoost: number;
  };
};

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 1.0,
  high: 0.8,
  medium: 0.5,
  low: 0.3,
  info: 0.1,
};

const CONFIDENCE_WEIGHTS: Record<string, number> = {
  high: 1.0,
  medium: 0.7,
  low: 0.4,
};

const SECURITY_CATEGORIES = new Set([
  'security_concern',
  'secrets-api-key',
  'secrets-aws-key',
  'secrets-private-key',
  'secrets-jwt-token',
  'secrets-bearer-token',
  'sec-eval',
  'sec-innerhtml',
  'sec-sql-injection',
  'sec-disabled-headers',
  'sec-hardcoded-url-creds',
  'sec-math-random',
]);

const HIGH_RISK_PATHS = /auth|login|payment|checkout|admin|api|middleware|security|crypto|token|session|user|password/i;

/**
 * Calculate module importance based on dependency count.
 * Files that many other files depend on are more important.
 */
function moduleImportance(dependencies: number, totalFiles: number): number {
  if (totalFiles === 0) return 0.5;
  const ratio = dependencies / totalFiles;
  // Clamp to [0.3, 1.0] — even leaf files get some importance
  return Math.min(1.0, Math.max(0.3, ratio * 3 + 0.3));
}

/**
 * Check if the file path suggests security-sensitive code.
 */
function securityBoost(filePath: string, category: string): number {
  if (SECURITY_CATEGORIES.has(category)) return 1.0;
  if (HIGH_RISK_PATHS.test(filePath)) return 0.7;
  return 0.0;
}

/**
 * Map numeric score to a risk level.
 */
function scoreToLevel(score: number): RiskScore['level'] {
  if (score >= 0.8) return 'critical';
  if (score >= 0.6) return 'high';
  if (score >= 0.4) return 'medium';
  if (score >= 0.2) return 'low';
  return 'info';
}

/**
 * Calculate risk score for a single finding.
 */
export function calculateRisk(input: RiskInput): RiskInput & { risk: RiskScore } {
  const severity = SEVERITY_WEIGHTS[input.severity] ?? 0.5;
  const confidence = CONFIDENCE_WEIGHTS[input.confidence] ?? 0.5;
  const module = moduleImportance(input.dependencies ?? 0, input.totalFiles ?? 1);
  const security = securityBoost(input.filePath, input.category);

  // Weighted combination
  const score = (
    severity * 0.40 +
    confidence * 0.20 +
    module * 0.25 +
    security * 0.15
  );

  // Numeric scoring may still be used to order model context, but it must not
  // manufacture a canonical Priority (or Risk Level) when a finding did not
  // supply one. Rule-based findings get an explicit persisted priority at
  // their own service boundary; historical/AI omissions remain unclassified.
  const priority = normalizeRiskPriority(input.priority);
  const policyLevel = deriveRiskLevel(input.severity, priority);
  return {
    ...input,
    risk: {
      score: Math.round(score * 100) / 100,
      // Keep the numeric score's old level for callers that use it to order
      // model context, while exposing the deterministic policy result for
      // persistence/reporting consumers.
      level: scoreToLevel(score),
      policyLevel,
      priority,
      factors: {
        severity,
        confidence,
        moduleImportance: module,
        securityBoost: security,
      },
    },
  };
}

/**
 * Score a batch of findings.
 */
export function scoreFindings(
  findings: RiskInput[],
  totalFiles: number,
  dependencyCounts?: Record<string, number>
): (RiskInput & { risk: RiskScore })[] {
  return findings.map(f => calculateRisk({
    ...f,
    totalFiles,
    dependencies: dependencyCounts?.[f.filePath] ?? 0,
  }));
}
