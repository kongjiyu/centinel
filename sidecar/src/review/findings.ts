import crypto from 'node:crypto';
import { deriveRiskLevel, inferPriority, normalizeRiskSeverity, normalizeRiskPriority } from '../riskPolicy.js';
import type { Finding as DeterministicFinding } from '../staticEngine.js';
import type { StaticFindingInput } from './types.js';

export type ModelFindingLike = {
  domain?: unknown;
  issueType?: unknown;
  logicFlow?: unknown;
  relatedLocations?: unknown;
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
    recommendation: finding.recommendation ?? `Review and address this ${text(finding.category, 'static analysis').replace(/_/g, ' ')} finding.`,
    confidence: finding.confidence ?? 'high',
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
    ...(['security', 'business', 'technical', 'personnel'].includes(String(finding.domain)) ? { domain: finding.domain as StaticFindingInput['domain'] } : {}),
    ...(typeof finding.issueType === 'string' && /^[a-z][a-z0-9_]{1,79}$/.test(finding.issueType) ? { issueType: finding.issueType } : {}),
    ...(Array.isArray(finding.logicFlow) ? { logicFlow: finding.logicFlow.filter((value): value is string => typeof value === 'string').slice(0, 10) } : {}),
    ...(Array.isArray(finding.relatedLocations) ? { relatedLocations: structuredClone(finding.relatedLocations).slice(0,16) as StaticFindingInput['relatedLocations'] } : {}),
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

function citationVerification(finding: StaticFindingInput): 'verified' | 'needs_verification' | 'unrecorded' {
  const evidence = finding.sourceLocator?.citationEvidence;
  if (!evidence || typeof evidence !== 'object' || !('verification' in evidence)) return 'unrecorded';
  return evidence.verification === 'needs_verification' ? 'needs_verification' : evidence.verification === 'verified' ? 'verified' : 'unrecorded';
}

const needsVerification = (finding: StaticFindingInput) => citationVerification(finding) === 'needs_verification';
const normalizedPath = (value: string) => value.replace(/\\/g, '/');

/** Identity dimensions that must never conflict for two observations to describe one issue. */
function compatibleIdentity(left: StaticFindingInput, right: StaticFindingInput): boolean {
  if (left.artifactId && right.artifactId && left.artifactId !== right.artifactId) return false;
  if (left.sourceIdentity && right.sourceIdentity && left.sourceIdentity !== right.sourceIdentity) return false;
  if (normalizedPath(left.filePath) !== normalizedPath(right.filePath)) return false;
  for (const key of ['ruleId', 'standardRuleId', 'requirementId'] as const) {
    if (left[key] && right[key] && left[key] !== right[key]) return false;
  }
  return true;
}

function duplicates(left: StaticFindingInput, right: StaticFindingInput, allowVerificationMismatch = false): boolean {
  // Keep uncertainty from suppressing an independently validated observation
  // (or deterministic rule), even when the model assigned itself high confidence.
  if (!allowVerificationMismatch && needsVerification(left) !== needsVerification(right)) return false;
  if (left.category !== right.category) return false;
  if (!compatibleIdentity(left, right)) return false;
  if (left.fingerprint && left.fingerprint === right.fingerprint) return true;
  if (!left.filePath || !right.filePath || left.filePath !== right.filePath) return false;
  if (left.lineNumber == null || right.lineNumber == null || Math.abs(left.lineNumber - right.lineNumber) > 2) return false;
  return overlap(left.evidence, right.evidence) >= 0.3 && overlap(left.title, right.title) >= 0.5;
}

/**
 * Bounded, allowlisted record of one observation merged into another finding
 * of the same Review. Stored under `sourceLocator.mergedObservations` (existing
 * findings JSON; no migration).
 */
export type MergedObservation = {
  version: 1;
  reason: 'duplicate' | 'same_location_and_type' | 'uncertain_copy_of_verified';
  source: StaticFindingInput['source'];
  title: string;
  description: string;
  severity: string;
  confidence: string;
  category: string;
  issueType: string | null;
  filePath: string;
  lineNumber: number | null;
  evidence: string;
  requirementId: string | null;
  fingerprint: string | null;
  verification: 'verified' | 'needs_verification' | 'unrecorded';
  citationEvidence?: Record<string, unknown>;
  relatedLocations?: NonNullable<StaticFindingInput['relatedLocations']>;
  analysis?: Record<string, unknown>;
};

export const MAX_MERGED_OBSERVATIONS = 32;
const OBSERVATION_TEXT_LIMIT = 4000;

function clip(value: string, limit = OBSERVATION_TEXT_LIMIT): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

export function mergedObservationsOf(finding: Pick<StaticFindingInput, 'sourceLocator'>): MergedObservation[] {
  const value = finding.sourceLocator?.mergedObservations;
  return Array.isArray(value) ? value as MergedObservation[] : [];
}

/** Total observations merged into this finding, including any beyond the stored bound. */
export function mergedObservationTotal(finding: Pick<StaticFindingInput, 'sourceLocator'>): number {
  const total = finding.sourceLocator?.mergedObservationTotal;
  return typeof total === 'number' && Number.isInteger(total) && total >= 0 ? total : mergedObservationsOf(finding).length;
}

function observationOf(finding: StaticFindingInput, reason: MergedObservation['reason']): MergedObservation {
  const citation = finding.sourceLocator?.citationEvidence;
  const analysis = finding.sourceLocator?.analysis;
  return {
    version: 1,
    reason,
    source: finding.source,
    title: clip(finding.title, 240),
    description: clip(finding.description),
    severity: finding.severity,
    confidence: finding.confidence,
    category: finding.category,
    issueType: finding.issueType ?? null,
    filePath: finding.filePath,
    lineNumber: finding.lineNumber,
    evidence: clip(finding.evidence),
    requirementId: finding.requirementId ?? null,
    fingerprint: finding.fingerprint ?? null,
    verification: citationVerification(finding),
    ...(citation && typeof citation === 'object' && !Array.isArray(citation) ? { citationEvidence: structuredClone(citation as Record<string, unknown>) } : {}),
    ...(finding.relatedLocations?.length ? { relatedLocations: structuredClone(finding.relatedLocations).slice(0, 16) } : {}),
    ...(analysis && typeof analysis === 'object' && !Array.isArray(analysis) ? { analysis: structuredClone(analysis as Record<string, unknown>) } : {}),
  };
}

/**
 * Keep the absorbed observation (and anything it had absorbed) as evidence on
 * the retained finding. The retained finding's own title, evidence, location
 * and fingerprint are unchanged, so its correlation identity stays stable.
 */
function absorb(target: StaticFindingInput, absorbed: StaticFindingInput, reason: MergedObservation['reason']): StaticFindingInput {
  const observations = [...mergedObservationsOf(target), observationOf(absorbed, reason), ...mergedObservationsOf(absorbed)];
  const total = mergedObservationTotal(target) + 1 + mergedObservationTotal(absorbed);
  const { mergedObservations: _observations, mergedObservationTotal: _total, ...locator } = target.sourceLocator ?? {};
  return {
    ...target,
    sourceLocator: { ...locator, mergedObservations: observations.slice(0, MAX_MERGED_OBSERVATIONS), mergedObservationTotal: total },
  };
}

const SEVERITY_RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

/** Representative order for one issue: verified, then more severe, then requirement-linked, then more confident; ties keep the earlier one. */
function preferred(candidate: StaticFindingInput, kept: StaticFindingInput): boolean {
  const rank = (finding: StaticFindingInput) => [needsVerification(finding) ? 0 : 1, SEVERITY_RANK[finding.severity] ?? 0,
    finding.requirementId ? 1 : 0, confidenceRank(finding.confidence)];
  const a = rank(candidate);
  const b = rank(kept);
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] > b[index];
  return false;
}

/**
 * Same-Review issue identity, used only when consolidating the final finding
 * list of one Review. Returns why two model observations describe one issue,
 * or null when they must stay separate.
 * - Same verification state: exact/near duplicates, or the same file, the same
 *   stable issue type and the same line (or lines at most two apart with mostly
 *   overlapping evidence), however the title is worded.
 * - Mixed state: a needs-verification observation is only ever absorbed by a
 *   verified one (see `preferred`), at the same file, an overlapping line range
 *   (at most two lines apart) and the same issue type.
 * Conflicting artifact, source, rule, standard, requirement or domain
 * identities always keep observations separate.
 */
function sameReviewIssue(left: StaticFindingInput, right: StaticFindingInput): MergedObservation['reason'] | null {
  if (left.source !== 'model' || right.source !== 'model') return null;
  if (!left.filePath || !compatibleIdentity(left, right)) return null;
  if (left.domain && right.domain && left.domain !== right.domain) return null;
  const mixed = needsVerification(left) !== needsVerification(right);
  if (duplicates(left, right, true)) return mixed ? 'uncertain_copy_of_verified' : 'duplicate';
  if (left.lineNumber == null || right.lineNumber == null) return null;
  if (!left.issueType || left.issueType !== right.issueType) return null;
  const distance = Math.abs(left.lineNumber - right.lineNumber);
  if (mixed) return distance <= 2 ? 'uncertain_copy_of_verified' : null;
  if (distance === 0 || distance <= 2 && overlap(left.evidence, right.evidence) >= 0.5) return 'same_location_and_type';
  return null;
}

export type NormalizedFindings = {
  deterministic: StaticFindingInput[];
  model: StaticFindingInput[];
  droppedModel: StaticFindingInput[];
  all: StaticFindingInput[];
  /** Observations kept as evidence on another finding instead of their own row (consolidated mode only). */
  mergedObservationCount: number;
};

export type DeduplicationOptions = {
  /**
   * Final persistence for one Review: merge reworded/uncertain copies of the
   * same issue into one finding and keep every merged observation as evidence
   * on it. Batch-level calls leave this off so support prompts are unchanged.
   */
  consolidateReviewObservations?: boolean;
};

/** Normalize provider output and deduplicate overlapping deterministic/model
 * results. Deterministic findings win ties; a model finding only suppresses a
 * rule finding when it carries strictly higher confidence. */
export function normalizeAndDeduplicateFindings(
  deterministic: StaticFindingInput[],
  model: StaticFindingInput[],
  options: DeduplicationOptions = {},
): NormalizedFindings {
  const consolidate = options.consolidateReviewObservations === true;
  let mergedObservationCount = 0;
  const merge = (target: StaticFindingInput, absorbed: StaticFindingInput, reason: MergedObservation['reason']) => {
    mergedObservationCount += 1;
    return absorb(target, absorbed, reason);
  };
  const normalizedDeterministic = deterministic.map(item => ({
    ...item,
    fingerprint: item.fingerprint ?? findingFingerprint(item),
  }));
  const keptDeterministic: StaticFindingInput[] = [];
  for (const candidate of normalizedDeterministic) {
    const match = keptDeterministic.findIndex(item => duplicates(item, candidate));
    if (match < 0) keptDeterministic.push(candidate);
    else if (confidenceRank(candidate.confidence) > confidenceRank(keptDeterministic[match].confidence)) keptDeterministic[match] = candidate;
  }
  const keptModel: StaticFindingInput[] = [];
  const droppedModel: StaticFindingInput[] = [];
  for (const candidate of model.map(item => ({ ...item, fingerprint: item.fingerprint ?? findingFingerprint(item) }))) {
    const staticIndex = keptDeterministic.findIndex(item => duplicates(item, candidate));
    let current: StaticFindingInput = candidate;
    if (staticIndex >= 0) {
      const staticMatch = keptDeterministic[staticIndex];
      if (confidenceRank(staticMatch.confidence) >= confidenceRank(candidate.confidence)) {
        droppedModel.push(candidate);
        if (consolidate) keptDeterministic[staticIndex] = merge(staticMatch, candidate, 'duplicate');
        continue;
      }
      // An explicitly higher-confidence model result replaces the rule result
      // in the normalized output. The original deterministic row remains in
      // the immutable provider audit/source tables when an adapter persisted
      // it before this merge.
      keptDeterministic.splice(staticIndex, 1);
      if (consolidate) current = merge(candidate, staticMatch, 'duplicate');
    }
    if (consolidate) {
      let reason: MergedObservation['reason'] | null = null;
      const modelIndex = keptModel.findIndex(item => (reason = sameReviewIssue(item, current)) !== null);
      if (modelIndex >= 0 && reason) {
        const kept = keptModel[modelIndex];
        if (preferred(current, kept)) {
          keptModel[modelIndex] = merge(current, kept, reason);
          droppedModel.push(kept);
        } else {
          keptModel[modelIndex] = merge(kept, current, reason);
          droppedModel.push(candidate);
        }
        continue;
      }
      keptModel.push(current);
      continue;
    }
    const modelMatch = keptModel.find(item => duplicates(item, current));
    if (modelMatch) {
      if (confidenceRank(modelMatch.confidence) >= confidenceRank(current.confidence)) droppedModel.push(current);
      else {
        keptModel.splice(keptModel.indexOf(modelMatch), 1, current);
        droppedModel.push(modelMatch);
      }
      continue;
    }
    keptModel.push(current);
  }
  return {
    deterministic: keptDeterministic,
    model: keptModel,
    droppedModel,
    all: [...keptDeterministic, ...keptModel],
    mergedObservationCount,
  };
}

export function retainCorroboratedRuleFindings(rules: StaticFindingInput[], assessed: StaticFindingInput[]) {
  return rules.filter(rule => assessed.some(finding =>
    duplicates(rule, finding) || sameReviewIssue(rule, finding) !== null));
}
