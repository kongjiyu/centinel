/**
 * Risk scoring engine for static analysis findings.
 *
 * risk_score = severity_weight × confidence_weight × module_importance × security_boost
 *
 * Each factor is normalized to [0, 1], producing a final score in [0, 1].
 */

export type RiskInput = {
  severity: string;
  confidence: string;
  category: string;
  filePath: string;
  dependencies?: number;  // how many files depend on this file
  totalFiles?: number;    // total files in project
};

export type RiskScore = {
  score: number;           // 0-1
  level: 'critical' | 'high' | 'medium' | 'low' | 'info';
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

  return {
    ...input,
    risk: {
      score: Math.round(score * 100) / 100,
      level: scoreToLevel(score),
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
