import type { Finding } from './staticDomainTypes.js';
import { deriveRiskLevel, normalizeRiskSeverity, priorityRank, riskLevelRank, type RiskLevel } from './riskPolicy.js';

function fingerprint(finding: Finding): string {
  // Historical rows without a stable source identity must remain distinct.
  const identity = finding.artifactId || finding.filePath || finding.id;
  return [
    identity,
    (finding.category || '').trim().toLowerCase(),
    (finding.title || '').trim().toLowerCase().replace(/\s+/g, ' '),
  ].join('|');
}

export function calculateProjectRisk(findings: Finding[]): {
  summary: { critical: number; high: number; medium: number; low: number; classified: number; unclassified: number };
  riskItems: Array<Finding & { riskLevel: RiskLevel }>;
} {
  const byFingerprint = new Map<string, Finding>();
  findings
    .filter(finding => finding.source === 'static' && !['dismissed', 'fixed'].includes(finding.status))
    .forEach(finding => {
      const key = fingerprint(finding);
      const existing = byFingerprint.get(key);
      if (!existing || (existing.status === 'carryover' && finding.status !== 'carryover')) byFingerprint.set(key, finding);
    });
  const current = Array.from(byFingerprint.values());
  const classified = current
    .map(finding => ({ ...finding, riskLevel: deriveRiskLevel(finding.severity, finding.priority) }))
    .filter((finding): finding is Finding & { riskLevel: RiskLevel } => Boolean(finding.riskLevel));
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  classified.forEach(finding => { counts[finding.riskLevel] += 1; });
  const unclassified = current.filter(finding =>
    normalizeRiskSeverity(finding.severity) !== 'info' && !deriveRiskLevel(finding.severity, finding.priority)).length;
  const riskItems = classified
    .sort((a, b) => riskLevelRank(a.riskLevel) - riskLevelRank(b.riskLevel)
      || priorityRank(a.priority) - priorityRank(b.priority)
      || riskLevelRank(a.severity) - riskLevelRank(b.severity)
      || Date.parse(b.createdAt) - Date.parse(a.createdAt)
      || a.title.localeCompare(b.title)
      || a.id.localeCompare(b.id))
    .slice(0, 5);
  return { summary: { ...counts, classified: classified.length, unclassified }, riskItems };
}
