import crypto from 'node:crypto';
import type { PersistedReviewFinding, StaticFindingInput, StaticReviewScope } from './types.js';

export type CorrelationClass = 'new' | 'recurring' | 'carried_over' | 'resolved' | 'regressed';
export type CorrelationMethod = 'stable_id' | 'fingerprint' | 'heuristic' | 'unmatched';

export type CorrelatableFinding = Partial<PersistedReviewFinding> & StaticFindingInput & {
  id?: string;
  stableFindingId?: string | null;
  ruleId?: string | null;
  standardRuleId?: string | null;
  requirementId?: string | null;
  sourceIdentity?: string | null;
  sourceVersion?: string | null;
};

export type FindingCorrelation = {
  id: string;
  parentReviewId: string;
  childReviewId: string;
  parentFindingId: string | null;
  childFindingId: string | null;
  classification: CorrelationClass;
  method: CorrelationMethod;
  score: number;
  stableFingerprint: string;
  detail?: string;
  /** Versioned evidence contract. Legacy snapshots without this never resolve project findings. */
  resolutionEligibility?: FindingResolutionEligibility;
};

export type FindingResolutionEligibility = {
  version: 1;
  basis: 'not_reproduced_in_comparable_review';
  parentSourceManifestId: string;
  sourceManifestId: string;
  reviewedArtifactId: string;
  parentArtifactId: string;
  sourceIdentityHash: string;
  parentSourceVersion: string;
  reviewedSourceVersion: string;
};

export type EvaluatedFindingSource = {
  artifactId: string;
  sourceIdentity?: string | null;
  filePath: string;
  sourceVersion?: string | null;
};

export type FindingResolutionContext = {
  modelStatus: 'not_requested' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
  parentSourceManifestId: string | null;
  sourceManifestId: string | null;
  allSourcesReadable: boolean;
  parentSourceArtifacts: EvaluatedFindingSource[];
  childSourceArtifacts: EvaluatedFindingSource[];
  parentReviewType: string;
  childReviewType: string;
  parentScope: StaticReviewScope;
  childScope: StaticReviewScope;
  parentConfig: Record<string, unknown>;
  childConfig: Record<string, unknown>;
  parentIterationFeedback: string;
  childIterationFeedback: string;
};

export type CorrelationAmbiguity = {
  childFindingId: string;
  candidateParentFindingIds: string[];
  scores: number[];
  reason: 'close_candidates' | 'critical_requires_confirmation' | 'candidate_already_matched';
};

export type FindingCorrelationInput = {
  parentReviewId: string;
  childReviewId: string;
  previous: CorrelatableFinding[];
  current: CorrelatableFinding[];
  /** Artifact IDs/identities actually evaluated by the child Review. */
  evaluatedArtifactIds?: string[];
  evaluatedSourceIdentities?: string[];
  /** Only artifacts whose frozen content was read successfully. */
  evaluatedSources?: EvaluatedFindingSource[];
  /** Full-review conditions required before absence can be recorded as a re-check. */
  resolutionContext?: FindingResolutionContext;
};

export type FindingCorrelationSnapshot = {
  parentReviewId: string;
  childReviewId: string;
  correlations: FindingCorrelation[];
  ambiguities: CorrelationAmbiguity[];
  counts: Record<CorrelationClass, number>;
  createdAt: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\\/g, '/').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function words(value: string): Set<string> {
  return new Set(normalize(value).split(' ').filter(token => token.length > 2));
}

function overlap(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common++;
  return common / (a.size + b.size - common);
}

function idOf(finding: CorrelatableFinding): string {
  return text(finding.id);
}

function sourceOf(finding: CorrelatableFinding): string {
  return text(finding.sourceIdentity) || text(finding.artifactId) || normalize(finding.filePath);
}

type SourceIdentityInput = {
  artifactId?: string | null;
  sourceIdentity?: string | null;
  filePath?: string | null;
};

function sourceIdentityKey(finding: SourceIdentityInput): string {
  const identity = text(finding.sourceIdentity);
  if (identity) return normalize(identity);
  const filePath = normalize(text(finding.filePath));
  if (filePath) return filePath;
  const artifactId = text(finding.artifactId);
  if (artifactId) return `artifact:${artifactId}`;
  return '';
}

/** A safe identity proof for the reviewed source, without exposing its path in metadata. */
export function findingSourceIdentityHash(finding: SourceIdentityInput): string {
  const identity = sourceIdentityKey(finding);
  return identity ? hash(identity) : '';
}

function normalizedVersion(value: unknown): string {
  return text(value).replace(/^sha256:/i, '').toLowerCase();
}

function sameIds(left?: string[], right?: string[]): boolean {
  return JSON.stringify([...new Set((left ?? []).filter(Boolean))].sort())
    === JSON.stringify([...new Set((right ?? []).filter(Boolean))].sort());
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function comparableConfig(value: Record<string, unknown>): string {
  return canonical(value);
}

function sourceCoverage(sources: EvaluatedFindingSource[]): string[] | null {
  if (!sources.length) return null;
  const identities = sources.map(source => findingSourceIdentityHash(source));
  if (identities.some(identity => !identity)) return null;
  const unique = [...new Set(identities)].sort();
  return unique.length === identities.length ? unique : null;
}

function resolutionContextIsEligible(context: FindingResolutionContext | undefined): context is FindingResolutionContext {
  return Boolean(context
    && context.modelStatus === 'succeeded'
    && context.parentSourceManifestId?.trim()
    && context.sourceManifestId?.trim()
    && context.allSourcesReadable
    && sourceCoverage(context.parentSourceArtifacts) !== null
    && JSON.stringify(sourceCoverage(context.parentSourceArtifacts)) === JSON.stringify(sourceCoverage(context.childSourceArtifacts))
    && context.parentReviewType === context.childReviewType
    && sameIds(context.parentScope.artifactIds, context.childScope.artifactIds)
    && sameIds(context.parentScope.requirementIds, context.childScope.requirementIds)
    && sameIds(context.parentScope.standardIds, context.childScope.standardIds)
    && sameIds(context.parentScope.sourceIds, context.childScope.sourceIds)
    && text(context.parentScope.label) === text(context.childScope.label)
    && comparableConfig(context.parentConfig) === comparableConfig(context.childConfig)
    && text(context.parentIterationFeedback) === text(context.childIterationFeedback));
}

function evaluatedSourceFor(previous: CorrelatableFinding, sources: EvaluatedFindingSource[]): EvaluatedFindingSource | undefined {
  const previousIdentity = sourceIdentityKey(previous);
  return sources.find(source => {
    if (previous.artifactId && previous.artifactId === source.artifactId) return true;
    const candidateIdentity = sourceIdentityKey({
      ...previous,
      artifactId: source.artifactId,
      sourceIdentity: source.sourceIdentity,
      filePath: source.filePath,
    });
    return Boolean(previousIdentity && candidateIdentity && previousIdentity === candidateIdentity);
  });
}

function stableKey(finding: CorrelatableFinding): string {
  return hash({
    rule: text(finding.ruleId) || text(finding.standardRuleId),
    standard: text(finding.standardRuleId),
    source: sourceOf(finding),
    path: normalize(finding.filePath),
    line: finding.lineNumber ?? null,
    requirement: text(finding.requirementId),
    evidence: normalize(finding.evidence).slice(0, 1000),
  });
}

/** Stable lineage fingerprint from the comparison dimensions in the spec. */
export function findingCorrelationFingerprint(finding: CorrelatableFinding): string {
  return stableKey(finding);
}

function severityRank(value: unknown): number {
  switch (normalize(text(value))) {
    case 'critical': return 5;
    case 'high': return 4;
    case 'medium': return 3;
    case 'low': return 2;
    case 'info': return 1;
    default: return 0;
  }
}

function priorityRank(value: unknown): number {
  const normalized = text(value).toLowerCase();
  if (normalized === 'high' || normalized === 'p1') return 3;
  if (normalized === 'medium' || normalized === 'p2') return 2;
  if (normalized === 'low' || normalized === 'p3' || normalized === 'p4') return 1;
  if (normalized === 'p0' || normalized === 'urgent' || normalized === 'critical') return 4;
  return 0;
}

function isCritical(finding: CorrelatableFinding): boolean {
  return severityRank(finding.severity) >= 5 || priorityRank(finding.priority) >= 4;
}

function regression(previous: CorrelatableFinding, current: CorrelatableFinding): boolean {
  return severityRank(current.severity) > severityRank(previous.severity)
    || priorityRank(current.priority) > priorityRank(previous.priority);
}

function candidateScore(previous: CorrelatableFinding, current: CorrelatableFinding): number {
  let score = 0;
  const previousRule = text(previous.ruleId);
  const currentRule = text(current.ruleId);
  const previousStandard = text(previous.standardRuleId);
  const currentStandard = text(current.standardRuleId);
  const previousRequirement = text(previous.requirementId);
  const currentRequirement = text(current.requirementId);
  const previousSource = sourceOf(previous);
  const currentSource = sourceOf(current);

  if (previousRule && previousRule === currentRule) score += 0.29;
  if (previousStandard && previousStandard === currentStandard) score += 0.18;
  if (previousRequirement && previousRequirement === currentRequirement) score += 0.13;
  if (previousSource && previousSource === currentSource) score += 0.22;
  else if (normalize(previous.filePath) && normalize(previous.filePath) === normalize(current.filePath)) score += 0.17;
  else if (normalize(previous.filePath).split('/').at(-1) && normalize(previous.filePath).split('/').at(-1) === normalize(current.filePath).split('/').at(-1)) score += 0.07;

  if (previous.lineNumber != null && current.lineNumber != null) {
    const distance = Math.abs(previous.lineNumber - current.lineNumber);
    score += distance === 0 ? 0.13 : distance <= 3 ? 0.10 : distance <= 10 ? 0.04 : 0;
  }
  const evidenceSimilarity = overlap(`${previous.evidence} ${previous.description}`, `${current.evidence} ${current.description}`);
  score += 0.13 * evidenceSimilarity;
  score += 0.12 * overlap(previous.title, current.title);
  return Math.min(1, score);
}

function correlation(input: {
  parentReviewId: string;
  childReviewId: string;
  previous: CorrelatableFinding | null;
  current: CorrelatableFinding | null;
  classification: CorrelationClass;
  method: CorrelationMethod;
  score: number;
  detail?: string;
  resolutionEligibility?: FindingResolutionEligibility;
}): FindingCorrelation {
  const parentId = input.previous ? idOf(input.previous) || null : null;
  const childId = input.current ? idOf(input.current) || null : null;
  const fingerprint = input.current ? stableKey(input.current) : input.previous ? stableKey(input.previous) : '';
  return {
    id: hash({ childReviewId: input.childReviewId, parentFindingId: parentId, childFindingId: childId, classification: input.classification, fingerprint }),
    parentReviewId: input.parentReviewId,
    childReviewId: input.childReviewId,
    parentFindingId: parentId,
    childFindingId: childId,
    classification: input.classification,
    method: input.method,
    score: Number(input.score.toFixed(4)),
    stableFingerprint: fingerprint,
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.resolutionEligibility ? { resolutionEligibility: input.resolutionEligibility } : {}),
  };
}

/**
 * Correlate a child Review with its immutable parent. Exact identifiers win;
 * heuristic candidates require a clear score margin and Critical findings
 * always require explicit confirmation instead of an automatic merge.
 */
export function correlateReviewFindings(input: FindingCorrelationInput): FindingCorrelationSnapshot {
  const usedPrevious = new Set<number>();
  const correlations: FindingCorrelation[] = [];
  const ambiguities: CorrelationAmbiguity[] = [];
  const threshold = 0.57;
  const margin = 0.09;

  for (const current of input.current) {
    const currentId = idOf(current);
    const allByStableId = input.previous
      .map((finding, index) => ({ finding, index }))
      .filter(({ finding }) => text(current.stableFindingId) && text(current.stableFindingId) === text(finding.stableFindingId));
    const allByFingerprint = input.previous
      .map((finding, index) => ({ finding, index }))
      .filter(({ finding }) => text(current.fingerprint) && text(current.fingerprint) === text(finding.fingerprint));
    const allExact = allByStableId.length ? allByStableId : allByFingerprint;
    const exactByStableId = allByStableId.filter(({ index }) => !usedPrevious.has(index));
    const exactByFingerprint = allByFingerprint.filter(({ index }) => !usedPrevious.has(index));
    const exact = exactByStableId.length ? exactByStableId : exactByFingerprint;
    const exactAlreadyUsed = allExact.filter(({ index }) => usedPrevious.has(index));
    if (exactAlreadyUsed.length) {
      const candidates = [...exactAlreadyUsed, ...exact].map(({ finding }) => idOf(finding));
      ambiguities.push({
        childFindingId: currentId,
        candidateParentFindingIds: candidates,
        scores: candidates.map(() => 1),
        reason: 'candidate_already_matched',
      });
      correlations.push(correlation({
        parentReviewId: input.parentReviewId, childReviewId: input.childReviewId,
        previous: null, current, classification: 'new', method: 'unmatched', score: 0,
        detail: 'An exact parent identifier is already correlated to another child finding; no duplicate merge was made.',
      }));
      continue;
    }
    if (exact.length === 1) {
      const { finding, index } = exact[0];
      usedPrevious.add(index);
      const classification: CorrelationClass = regression(finding, current) ? 'regressed' : 'recurring';
      correlations.push(correlation({
        parentReviewId: input.parentReviewId, childReviewId: input.childReviewId,
        previous: finding, current, classification,
        method: exactByStableId.length ? 'stable_id' : 'fingerprint', score: 1,
      }));
      continue;
    }
    if (exact.length > 1) {
      ambiguities.push({ childFindingId: currentId, candidateParentFindingIds: exact.map(({ finding }) => idOf(finding)), scores: exact.map(() => 1), reason: 'close_candidates' });
      correlations.push(correlation({ parentReviewId: input.parentReviewId, childReviewId: input.childReviewId, previous: null, current, classification: 'new', method: 'unmatched', score: 0, detail: 'Duplicate exact identifiers require reviewer confirmation.' }));
      continue;
    }

    const allScored = input.previous.map((finding, index) => ({ finding, index, score: candidateScore(finding, current) }))
      .filter(candidate => candidate.score >= threshold)
      .sort((left, right) => right.score - left.score || idOf(left.finding).localeCompare(idOf(right.finding)));
    const matchedCandidates = allScored.filter(candidate => usedPrevious.has(candidate.index));
    const scored = allScored
      .filter(candidate => !usedPrevious.has(candidate.index) && candidate.score >= threshold)
      .sort((left, right) => right.score - left.score || idOf(left.finding).localeCompare(idOf(right.finding)));
    const top = scored[0];
    const second = scored[1];
    const matchedTop = matchedCandidates[0];
    if (matchedTop && (!top || matchedTop.score >= top.score - margin)) {
      const candidates = [matchedTop, ...(top ? [top] : [])];
      ambiguities.push({
        childFindingId: currentId,
        candidateParentFindingIds: candidates.map(candidate => idOf(candidate.finding)),
        scores: candidates.map(candidate => candidate.score),
        reason: isCritical(current) || isCritical(matchedTop.finding) ? 'critical_requires_confirmation' : 'candidate_already_matched',
      });
      correlations.push(correlation({
        parentReviewId: input.parentReviewId, childReviewId: input.childReviewId,
        previous: null, current, classification: 'new', method: 'unmatched', score: matchedTop.score,
        detail: 'The plausible parent finding is already correlated elsewhere; reviewer confirmation is required.',
      }));
      continue;
    }
    if (top && second && top.score - second.score < margin) {
      ambiguities.push({ childFindingId: currentId, candidateParentFindingIds: [idOf(top.finding), idOf(second.finding)], scores: [top.score, second.score], reason: 'close_candidates' });
      correlations.push(correlation({ parentReviewId: input.parentReviewId, childReviewId: input.childReviewId, previous: null, current, classification: 'new', method: 'unmatched', score: top.score, detail: 'Multiple parent findings are similarly plausible; no automatic correlation was made.' }));
      continue;
    }
    if (top && isCritical(current) || top && isCritical(top.finding)) {
      ambiguities.push({ childFindingId: currentId, candidateParentFindingIds: [idOf(top.finding)], scores: [top.score], reason: 'critical_requires_confirmation' });
      correlations.push(correlation({ parentReviewId: input.parentReviewId, childReviewId: input.childReviewId, previous: null, current, classification: 'new', method: 'unmatched', score: top.score, detail: 'Potential Critical match surfaced for reviewer confirmation; it was not merged heuristically.' }));
      continue;
    }
    if (top) {
      usedPrevious.add(top.index);
      const classification: CorrelationClass = regression(top.finding, current) ? 'regressed' : 'recurring';
      correlations.push(correlation({ parentReviewId: input.parentReviewId, childReviewId: input.childReviewId, previous: top.finding, current, classification, method: 'heuristic', score: top.score }));
      continue;
    }
    correlations.push(correlation({ parentReviewId: input.parentReviewId, childReviewId: input.childReviewId, previous: null, current, classification: 'new', method: 'unmatched', score: 0 }));
  }

  const evaluatedSources = input.evaluatedSources ?? [];
  const resolutionEligible = resolutionContextIsEligible(input.resolutionContext);
  for (let index = 0; index < input.previous.length; index++) {
    if (usedPrevious.has(index)) continue;
    const previous = input.previous[index];
    const evaluatedSource = evaluatedSourceFor(previous, evaluatedSources);
    const parentManifestSource = input.resolutionContext
      ? evaluatedSourceFor(previous, input.resolutionContext.parentSourceArtifacts)
      : undefined;
    const previousSourceVersion = normalizedVersion(parentManifestSource?.sourceVersion);
    const recordedPreviousVersion = normalizedVersion(previous.sourceVersion);
    const reviewedSourceVersion = normalizedVersion(evaluatedSource?.sourceVersion);
    const parentVersionConsistent = !recordedPreviousVersion || recordedPreviousVersion === previousSourceVersion;
    const sourceChanged = Boolean(previousSourceVersion && parentVersionConsistent && reviewedSourceVersion && previousSourceVersion !== reviewedSourceVersion);
    const resolved = Boolean(resolutionEligible && evaluatedSource && sourceChanged
      && parentManifestSource && text(previous.artifactId)
      && text(parentManifestSource.artifactId) === text(previous.artifactId)
      && findingSourceIdentityHash({
        ...previous,
        sourceIdentity: previous.sourceIdentity ?? parentManifestSource.sourceIdentity,
        filePath: previous.filePath || parentManifestSource.filePath,
      }));
    const eligibility: FindingResolutionEligibility | undefined = resolved && evaluatedSource && input.resolutionContext
      ? {
        version: 1,
        basis: 'not_reproduced_in_comparable_review',
        parentSourceManifestId: input.resolutionContext.parentSourceManifestId!,
        sourceManifestId: input.resolutionContext.sourceManifestId!,
        reviewedArtifactId: evaluatedSource.artifactId,
        parentArtifactId: text(previous.artifactId),
        sourceIdentityHash: findingSourceIdentityHash({
          ...previous,
          sourceIdentity: previous.sourceIdentity ?? parentManifestSource?.sourceIdentity,
          filePath: previous.filePath || parentManifestSource?.filePath || '',
        }),
        parentSourceVersion: text(parentManifestSource?.sourceVersion),
        reviewedSourceVersion: text(evaluatedSource.sourceVersion),
      }
      : undefined;
    correlations.push(correlation({
      parentReviewId: input.parentReviewId,
      childReviewId: input.childReviewId,
      previous,
      current: null,
      classification: resolved ? 'resolved' : 'carried_over',
      method: 'unmatched',
      score: 0,
      detail: resolved
        ? 'This finding was not reproduced in a comparable re-review of the same source after its version changed.'
        : evaluatedSource && !sourceChanged
          ? 'The source was evaluated, but its version did not change; absence alone does not establish resolution.'
          : 'Comparable successful source coverage was not established; the finding remains carried over.',
      ...(eligibility ? { resolutionEligibility: eligibility } : {}),
    }));
  }

  const counts: Record<CorrelationClass, number> = { new: 0, recurring: 0, carried_over: 0, resolved: 0, regressed: 0 };
  for (const item of correlations) counts[item.classification]++;
  return { parentReviewId: input.parentReviewId, childReviewId: input.childReviewId, correlations, ambiguities, counts, createdAt: new Date().toISOString() };
}
