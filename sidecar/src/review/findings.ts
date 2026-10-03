import crypto from 'node:crypto';
import { deriveRiskLevel, inferPriority, normalizeRiskSeverity, normalizeRiskPriority } from '../riskPolicy.js';
import type { Finding as DeterministicFinding } from '../staticEngine.js';
import type { StaticFindingInput } from './types.js';

export type ModelFindingLike = {
  title?: unknown;
  description?: unknown;
  severity?: unknown;
  priority?: unknown;
  category?: unknown;
  filePath?: unknown;
  lineNumber?: unknown;
  artifactReference?: unknown;
  evidence?: unknown;
  recommendation?: unknown;
  confidence?: unknown;
  artifactId?: unknown;
  stableFindingId?: unknown;
  ruleId?: unknown;
  standardRuleId?: unknown;
  standardId?: unknown;
  requirementId?: unknown;
  sourceIdentity?: unknown;
  sourceVersion?: unknown;
  sourceLocator?: unknown;
};

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function lineNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeConfidence(value: unknown): string {
  const result = text(value, 'medium').toLowerCase();
  return result === 'high' || result === 'low' || result === 'medium' ? result : 'medium';
}

function normalizeSeverity(value: unknown): string {
  const normalized = normalizeRiskSeverity(value);
  return normalized ?? 'medium';
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/\W+/).filter(token => token.length > 2));
}

function overlap(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / Math.min(a.size, b.size);
}

export function findingFingerprint(input: Pick<StaticFindingInput, 'title' | 'category' | 'filePath' | 'lineNumber' | 'evidence'>): string {
  const canonical = [
    text(input.category).toLowerCase(),
    text(input.title).toLowerCase().replace(/\s+/g, ' '),
    text(input.filePath).replace(/\\/g, '/').toLowerCase(),
    input.lineNumber == null ? '' : String(input.lineNumber),
    text(input.evidence).toLowerCase().replace(/\s+/g, ' ').slice(0, 500),
  ].join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function normalizeDeterministicFinding(finding: DeterministicFinding, artifactId?: string | null): StaticFindingInput {
  const priority = inferPriority(finding.severity, finding.category);
  return {
    source: 'deterministic',
    title: `[${finding.ruleId}] ${text(finding.message, 'Static analysis finding')}`.slice(0, 240),
    description: text(finding.message),
    severity: normalizeSeverity(finding.severity),
    priority,
    category: text(finding.category, 'static_analysis'),
    filePath: text(finding.filePath),
    lineNumber: lineNumber(finding.lineNumber),
    artifactId: artifactId ?? null,
    ruleId: text(finding.ruleId) || null,
    evidence: text(finding.evidence),
    recommendation: `Review and address this ${text(finding.category, 'static analysis').replace(/_/g, ' ')} finding.`,
    confidence: 'high',
    riskLevel: deriveRiskLevel(finding.severity, priority),
  };
}

export function normalizeModelFinding(finding: ModelFindingLike): StaticFindingInput | null {
  const title = text(finding.title);
  if (!title) return null;
  const category = text(finding.category, 'model_analysis');
  const severity = normalizeSeverity(finding.severity);
  const explicitPriority = normalizeRiskPriority(finding.priority);
  const priority = explicitPriority ?? inferPriority(severity, category);
  const normalized: StaticFindingInput = {
    source: 'model',
    title: title.slice(0, 240),
    description: text(finding.description, title),
    severity,
    priority,
    category,
    filePath: text(finding.filePath || finding.artifactReference),
    lineNumber: lineNumber(finding.lineNumber),
    artifactId: typeof finding.artifactId === 'string' ? finding.artifactId : null,
    evidence: text(finding.evidence),
    recommendation: text(finding.recommendation, 'Review this finding and determine the appropriate remediation.'),
    confidence: normalizeConfidence(finding.confidence),
    riskLevel: deriveRiskLevel(severity, priority),
    stableFindingId: typeof finding.stableFindingId === 'string' ? finding.stableFindingId : null,
    ruleId: typeof finding.ruleId === 'string' ? finding.ruleId : null,
    requirementId: typeof finding.requirementId === 'string' ? finding.requirementId : null,
    standardId: typeof finding.standardId === 'string' ? finding.standardId : null,
    standardRuleId: typeof finding.standardRuleId === 'string' ? finding.standardRuleId : null,
    sourceIdentity: typeof finding.sourceIdentity === 'string' ? finding.sourceIdentity : null,
    sourceVersion: typeof finding.sourceVersion === 'string' ? finding.sourceVersion : null,
    sourceLocator: finding.sourceLocator && typeof finding.sourceLocator === 'object' && !Array.isArray(finding.sourceLocator)
      ? structuredClone(finding.sourceLocator as Record<string, unknown>)
      : null,
  };
  normalized.fingerprint = findingFingerprint(normalized);
  return normalized;
}

export function normalizeModelFindings(value: unknown): StaticFindingInput[] {
  if (!value || typeof value !== 'object') return [];
  const object = value as Record<string, unknown>;
  const candidate = Array.isArray(value) ? value : object.findings;
  if (!Array.isArray(candidate)) return [];
  return candidate
    .map(item => item && typeof item === 'object' ? normalizeModelFinding(item as ModelFindingLike) : null)
    .filter((item): item is StaticFindingInput => item !== null);
}

function confidenceRank(value: string): number {
  return value === 'high' ? 3 : value === 'medium' ? 2 : 1;
}

function duplicates(left: StaticFindingInput, right: StaticFindingInput): boolean {
  if (left.fingerprint && left.fingerprint === right.fingerprint) return true;
  if (!left.filePath || !right.filePath || left.filePath !== right.filePath) return false;
  if (left.lineNumber == null || right.lineNumber == null || Math.abs(left.lineNumber - right.lineNumber) > 2) return false;
  return overlap(left.evidence, right.evidence) >= 0.3;
}

export type NormalizedFindings = {
  deterministic: StaticFindingInput[];
  model: StaticFindingInput[];
  droppedModel: StaticFindingInput[];
  all: StaticFindingInput[];
};

/** Normalize provider output and deduplicate overlapping deterministic/model
 * results. Deterministic findings win ties; a model finding only suppresses a
 * rule finding when it carries strictly higher confidence. */
export function normalizeAndDeduplicateFindings(
  deterministic: StaticFindingInput[],
  model: StaticFindingInput[],
): NormalizedFindings {
  const normalizedDeterministic = deterministic.map(item => ({
    ...item,
    fingerprint: item.fingerprint ?? findingFingerprint(item),
  }));
  const keptDeterministic = [...normalizedDeterministic];
  const keptModel: StaticFindingInput[] = [];
  const droppedModel: StaticFindingInput[] = [];
  for (const candidate of model.map(item => ({ ...item, fingerprint: item.fingerprint ?? findingFingerprint(item) }))) {
    const staticMatch = keptDeterministic.find(item => duplicates(item, candidate));
    if (staticMatch) {
      if (confidenceRank(staticMatch.confidence) >= confidenceRank(candidate.confidence)) {
        droppedModel.push(candidate);
        continue;
      }
      // An explicitly higher-confidence model result replaces the rule result
      // in the normalized output. The original deterministic row remains in
      // the immutable provider audit/source tables when an adapter persisted
      // it before this merge.
      keptDeterministic.splice(keptDeterministic.indexOf(staticMatch), 1);
    }
    const modelMatch = keptModel.find(item => duplicates(item, candidate));
    if (modelMatch) {
      if (confidenceRank(modelMatch.confidence) >= confidenceRank(candidate.confidence)) droppedModel.push(candidate);
      else {
        keptModel.splice(keptModel.indexOf(modelMatch), 1, candidate);
        droppedModel.push(modelMatch);
      }
      continue;
    }
    keptModel.push(candidate);
  }
  return {
    deterministic: keptDeterministic,
    model: keptModel,
    droppedModel,
    all: [...keptDeterministic, ...keptModel],
  };
}
