import crypto from 'node:crypto';
import { detectArtifactType, type Artifact, type ArtifactType } from '../artifacts.js';
import type { ConfirmedRequirement, RequirementCandidate, SourceLocator, StandardRule } from './grounding.js';
import type { ReviewTraceabilityRecord } from './evidenceTypes.js';

export type EvidenceSourceState = 'available' | 'stale' | 'inaccessible' | 'deleted';
export type EvidenceReadiness = 'ready' | 'ready_with_warnings' | 'blocked';
export type EvidenceGapSeverity = 'warning' | 'blocking';

export type EvidenceArtifact = {
  artifact: Artifact;
  state?: EvidenceSourceState;
  detail?: string;
  content?: string;
};

export type EvidenceClaim = {
  id: string;
  text: string;
  artifactId?: string;
  locator?: SourceLocator;
};

export type EvidenceGap = {
  id: string;
  code: string;
  severity: EvidenceGapSeverity;
  title: string;
  detail: string;
  remediation: string;
  affectedStages: string[];
  artifactId?: string;
  requirementId?: string;
  references?: Array<{ artifactId?: string; filePath: string; lineNumber?: number; sourceVersion?: string | null; excerpt?: string; relation: 'code' | 'document' | 'requirement' }>;
};

export type EvidenceContradiction = {
  id: string;
  left: EvidenceClaim;
  right: EvidenceClaim;
  detail: string;
  affectedStages: string[];
  disposition?: EvidenceContradictionDisposition;
};

export type EvidenceContradictionDisposition = {
  contradictionId: string;
  decision: 'authoritative_left' | 'authoritative_right' | 'not_conflict';
  rationale: string;
  actorId: string;
  updatedAt: string;
};

export type EvidenceSufficiencyAssessment = {
  id: string;
  reviewId: string;
  projectId: string;
  reviewType: string;
  readiness: EvidenceReadiness;
  gaps: EvidenceGap[];
  contradictions: EvidenceContradiction[];
  artifactCount: number;
  availableArtifactCount: number;
  staleArtifactCount: number;
  confirmedRequirementCount: number;
  enabledStandardRuleCount: number;
  assessedAt: string;
};

export type EvidenceSufficiencyInput = {
  reviewId: string;
  projectId: string;
  reviewType: string;
  artifacts: EvidenceArtifact[];
  confirmedRequirements?: ConfirmedRequirement[];
  pendingRequirementCandidates?: RequirementCandidate[];
  enabledStandardRules?: StandardRule[];
  standardIds?: string[];
  requiredArtifactTypes?: ArtifactType[];
  traceability?: Array<Pick<ReviewTraceabilityRecord, 'requirementId' | 'state'> & Partial<ReviewTraceabilityRecord>>;
  claims?: EvidenceClaim[];
  dispositions?: EvidenceContradictionDisposition[];
  now?: Date;
};

const BLOCKING_SOURCE_STATES = new Set<EvidenceSourceState>(['inaccessible', 'deleted']);
const GENERIC_STAGES = ['source_freeze', 'deterministic_analysis', 'model_analysis'];

function stableId(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function gap(input: Omit<EvidenceGap, 'id'>): EvidenceGap {
  return { ...input, id: stableId({ code: input.code, detail: input.detail, artifactId: input.artifactId, requirementId: input.requirementId }) };
}

export function withEvidenceSufficiencyGap(
  assessment: EvidenceSufficiencyAssessment,
  input: Omit<EvidenceGap, 'id'>,
): EvidenceSufficiencyAssessment {
  const nextGap = gap(input);
  const gaps = assessment.gaps.some(item => item.id === nextGap.id) ? assessment.gaps : [...assessment.gaps, nextGap];
  const readiness = gaps.some(item => item.severity === 'blocking')
    ? 'blocked'
    : gaps.some(item => item.severity === 'warning') ? 'ready_with_warnings' : 'ready';
  return {
    ...assessment,
    id: stableId({ reviewId: assessment.reviewId, projectId: assessment.projectId, readiness, gaps, contradictions: assessment.contradictions }),
    gaps,
    readiness,
  };
}

/** Append newly discovered evidence gaps without allowing a later assessment
 * to replace the frozen source counts, contradictions, or original capture
 * time. Repository adapters enforce that this merge is only saved while the
 * Review execution remains active. */
export function mergeEvidenceSufficiencyAssessments(
  frozen: EvidenceSufficiencyAssessment,
  update: EvidenceSufficiencyAssessment,
): EvidenceSufficiencyAssessment {
  if (frozen.reviewId !== update.reviewId || frozen.projectId !== update.projectId) {
    throw new Error('Evidence sufficiency updates must belong to the frozen Review assessment.');
  }
  const gaps = [...new Map([...frozen.gaps, ...update.gaps].map(item => [item.id, item])).values()];
  const readiness = gaps.some(item => item.severity === 'blocking')
    ? 'blocked'
    : gaps.some(item => item.severity === 'warning') ? 'ready_with_warnings' : frozen.readiness;
  return {
    ...frozen,
    id: stableId({ reviewId: frozen.reviewId, projectId: frozen.projectId, readiness, gaps, contradictions: frozen.contradictions }),
    readiness,
    gaps,
  };
}

function normalizeClaim(text: string): { canonical: string; polarity: 1 | -1 } {
  let value = text.toLowerCase().replace(/[’']/g, "'");
  const negativePatterns = [
    /\b(?:must|shall|should|will|can|could|may|does|do|is|are|was|were|has|have|had)\s+not\b/g,
    /\b(?:cannot|can't|won't|never|without|excluded)\b/g,
    /\bnot\b/g,
    /\bno\s+(?=\w)/g,
  ];
  let negative = false;
  for (const pattern of negativePatterns) {
    value = value.replace(pattern, matched => {
      negative = !negative;
      return ' ';
    });
  }
  value = value
    .replace(/\b(?:disabled|disable)\b/g, () => { negative = !negative; return ' enabled '; })
    .replace(/\boptional\b/g, () => { negative = !negative; return ' required '; })
    .replace(/\b(?:absent|missing)\b/g, () => { negative = !negative; return ' present '; })
    .replace(/\bblocked\b/g, () => { negative = !negative; return ' allowed '; })
    .replace(/\b(?:forbidden|prohibited|disallowed)\b/g, () => { negative = !negative; return ' allowed '; })
    .replace(/\b(?:deny|denies|denied)\b/g, () => { negative = !negative; return ' allow '; });
  value = value
    .replace(/\b(?:must|shall|should|will|can|could|may|does|do|is|are|was|were|has|have|had|the|a|an|of|to|in|on|at|by|for|with|from|that|this|it|be|as)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { canonical: value, polarity: negative ? -1 : 1 };
}

function tokenJaccard(left: string, right: string): number {
  const a = new Set(left.split(' ').filter(token => token.length > 1));
  const b = new Set(right.split(' ').filter(token => token.length > 1));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

type NumericConstraint = { scope: string; unit: string; kind: 'minimum' | 'maximum' | 'exact'; value: number };

function numericConstraint(text: string): NumericConstraint | null {
  const match = text.match(/\b(?:must|shall|should|is|are)\s+(?:be\s+)?(at least|no less than|a minimum of|at most|no more than|a maximum of|exactly|equal to|within)\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|seconds?|minutes?|hours?|days?|percent|%)(?=$|[^\w])/i);
  if (!match) return null;
  const scope = normalizeClaim(`${text.slice(0, match.index)} ${text.slice((match.index ?? 0) + match[0].length)}`).canonical;
  if (scope.split(' ').filter(Boolean).length < 2) return null;
  let value = Number(match[2]);
  if (!Number.isFinite(value)) return null;
  const rawUnit = match[3].toLowerCase();
  const unit = rawUnit === '%' ? 'percent' : rawUnit === 'ms' ? 'millisecond' : rawUnit.replace(/s$/, '');
  const millisecondsPerUnit: Record<string, number> = {
    millisecond: 1, second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000,
  };
  const normalizedUnit = unit in millisecondsPerUnit ? 'millisecond' : unit;
  if (normalizedUnit === 'millisecond') value *= millisecondsPerUnit[unit];
  if (!Number.isFinite(value)) return null;
  const phrase = match[1].toLowerCase();
  const kind = ['at least', 'no less than', 'a minimum of'].includes(phrase) ? 'minimum'
    : ['at most', 'no more than', 'a maximum of', 'within'].includes(phrase) ? 'maximum' : 'exact';
  return { scope, unit: normalizedUnit, kind, value };
}

function incompatibleNumericBounds(left: NumericConstraint | null, right: NumericConstraint | null): boolean {
  if (!left || !right || left.unit !== right.unit || tokenJaccard(left.scope, right.scope) < 0.82) return false;
  if (left.kind === 'exact' && right.kind === 'exact') return left.value !== right.value;
  if (left.kind === 'exact') return right.kind === 'minimum' ? left.value < right.value : left.value > right.value;
  if (right.kind === 'exact') return left.kind === 'minimum' ? right.value < left.value : right.value > left.value;
  return left.kind !== right.kind && (left.kind === 'minimum' ? left.value > right.value : right.value > left.value);
}

type TemporalOrder = { first: string; second: string; direction: 'before' | 'after' };

/** Only explicit, single-clause normative ordering is eligible. A temporal
 * candidate is not a verified contradiction until a reviewer resolves it. */
function temporalOrder(text: string): TemporalOrder | null {
  if (!/\b(?:must|shall|should|required to)\b/i.test(text)) return null;
  const markers = [...text.matchAll(/\b(before|after)\b/gi)];
  if (markers.length !== 1) return null;
  const marker = markers[0];
  const first = normalizeClaim(text.slice(0, marker.index)).canonical;
  const second = normalizeClaim(text.slice((marker.index ?? 0) + marker[0].length)).canonical;
  if (first.split(' ').filter(Boolean).length < 2 || second.split(' ').filter(Boolean).length < 2) return null;
  return { first, second, direction: marker[1].toLowerCase() as TemporalOrder['direction'] };
}

function incompatibleTemporalOrder(left: TemporalOrder | null, right: TemporalOrder | null): boolean {
  if (!left || !right) return false;
  const sameEvents = tokenJaccard(left.first, right.first) >= 0.82
    && tokenJaccard(left.second, right.second) >= 0.82;
  const reversedEvents = tokenJaccard(left.first, right.second) >= 0.82
    && tokenJaccard(left.second, right.first) >= 0.82;
  return (sameEvents && left.direction !== right.direction)
    || (reversedEvents && left.direction === right.direction);
}

function discoverContradictions(claims: EvidenceClaim[]): EvidenceContradiction[] {
  const normalized = claims
    .map(claim => ({ claim, ...normalizeClaim(claim.text), numeric: numericConstraint(claim.text), temporal: temporalOrder(claim.text) }))
    .filter(item => item.canonical.split(' ').length >= 3);
  const output: EvidenceContradiction[] = [];
  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex++) {
      const left = normalized[leftIndex];
      const right = normalized[rightIndex];
      const similarity = tokenJaccard(left.canonical, right.canonical);
      const oppositePolarity = left.polarity !== right.polarity && similarity >= 0.82;
      const incompatibleBounds = incompatibleNumericBounds(left.numeric, right.numeric);
      const incompatibleOrder = incompatibleTemporalOrder(left.temporal, right.temporal);
      if (!oppositePolarity && !incompatibleBounds && !incompatibleOrder) continue;
      const pair = [left.claim.id, right.claim.id].sort();
      // A disposition names the left or right claim. Keep that orientation
      // stable even when a retry freezes the same artifacts in a new order.
      const [leftClaim, rightClaim] = left.claim.id === pair[0]
        ? [left.claim, right.claim] : [right.claim, left.claim];
      output.push({
        id: stableId({ contradiction: pair }),
        left: leftClaim,
        right: rightClaim,
        detail: incompatibleBounds
          ? 'The claims appear to set incompatible numeric bounds for the same subject and unit. A reviewer must confirm that their contexts overlap.'
          : incompatibleOrder
            ? 'The claims appear to require incompatible ordering of the same actions. A reviewer must confirm that their contexts overlap.'
          : `The claims have materially overlapping scope but opposite polarity (similarity ${similarity.toFixed(2)}). A reviewer must confirm that their contexts overlap.`,
        affectedStages: ['requirement_analysis', 'model_analysis'],
      });
    }
  }
  return output;
}

/**
 * Extract prose claims, not executable examples or test descriptions. Code
 * remains available to analysis; confirmed/manual claims are assessed separately.
 * Each sentence remains tied to its artifact and original line.
 */
export function extractEvidenceClaims(artifacts: EvidenceArtifact[]): EvidenceClaim[] {
  const claims: EvidenceClaim[] = [];
  for (const source of artifacts) {
    if (source.state === 'inaccessible' || source.state === 'deleted') continue;
    if (!source.content) continue;
    if (source.artifact.type === 'source_code'
      || detectArtifactType(source.artifact.filePath || source.artifact.fileName) === 'source_code') continue;
    if (!['requirement', 'design', 'coding_standard'].includes(source.artifact.type)
      && !/\.(?:md|txt|rst|adoc)$/i.test(source.artifact.filePath || source.artifact.fileName)) continue;
    let lineStart = 1;
    let fence: { marker: string; length: number } | undefined;
    for (const line of source.content.split(/\r?\n/)) {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
      if (marker && !fence) {
        fence = { marker: marker[1][0], length: marker[1].length };
        lineStart++;
        continue;
      }
      if (fence) {
        if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
        lineStart++;
        continue;
      }
      // Markdown indented examples are code too, including after list bullets.
      if (/^(?: {4}|\t)/.test(line)) { lineStart++; continue; }
      const headingStripped = line.replace(/^\s{0,3}#{1,6}\s+/, '').trim();
      const sentences = headingStripped.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
      for (const sentence of sentences) {
        const text = sentence.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '').trim();
        if (text.length < 20) continue;
        const id = stableId({ artifactId: source.artifact.id, lineStart, text: text.toLowerCase().replace(/\s+/g, ' ') });
        claims.push({
          id,
          text,
          artifactId: source.artifact.id,
          locator: { artifactId: source.artifact.id, filePath: source.artifact.filePath, lineStart, lineEnd: lineStart, excerpt: text.slice(0, 800) },
        });
      }
      lineStart++;
    }
  }
  return claims;
}

function requiredKinds(input: EvidenceSufficiencyInput): ArtifactType[] {
  const required = new Set(input.requiredArtifactTypes ?? []);
  if (input.reviewType === 'code_review' || input.reviewType === 'requirement_to_code_traceability') required.add('source_code');
  return [...required];
}

/** Deterministic, provider-independent evidence readiness and gap assessment. */
export function assessEvidenceSufficiency(input: EvidenceSufficiencyInput): EvidenceSufficiencyAssessment {
  const gaps: EvidenceGap[] = [];
  const artifacts = input.artifacts;
  const available = artifacts.filter(item => !item.state || item.state === 'available');
  const stale = artifacts.filter(item => item.state === 'stale');
  const usable = [...available, ...stale];
  const blockingSources = artifacts.filter(item => item.state && BLOCKING_SOURCE_STATES.has(item.state));

  if (!artifacts.length) {
    gaps.push(gap({
      code: 'no_evidence', severity: 'blocking', title: 'No review evidence is selected',
      detail: 'The Review has no frozen artifacts to analyze.',
      remediation: 'Add or select project artifacts, then start a new Review.', affectedStages: GENERIC_STAGES,
    }));
  }
  for (const item of blockingSources) {
    const state = item.state as EvidenceSourceState;
    gaps.push(gap({
      code: state === 'deleted' ? 'source_deleted' : 'source_inaccessible', severity: 'blocking',
      title: state === 'deleted' ? 'A selected source is no longer available' : 'A selected source cannot be read',
      detail: item.detail || `${item.artifact.fileName} is marked ${state}.`,
      remediation: 'Restore access or remove the unavailable source from the Review scope.',
      affectedStages: GENERIC_STAGES, artifactId: item.artifact.id,
    }));
  }
  for (const item of stale) {
    gaps.push(gap({
      code: 'source_stale', severity: 'warning', title: 'A selected source may be out of date',
      detail: item.detail || `${item.artifact.fileName} has a newer or unverifiable remote revision.`,
      remediation: 'Refresh the connected source if the latest revision should be reviewed.',
      affectedStages: ['source_freeze', 'model_analysis'], artifactId: item.artifact.id,
    }));
  }
  for (const item of artifacts.filter(source => !source.content && !source.state)) {
    gaps.push(gap({
      code: 'source_content_unverified', severity: 'warning', title: 'Artifact content could not be verified',
      detail: item.detail || `${item.artifact.fileName} is in the manifest, but its content was not available to the readiness checker.`,
      remediation: 'Verify source access or provide a readable frozen version before relying on this artifact.',
      affectedStages: ['source_freeze', 'model_analysis'], artifactId: item.artifact.id,
    }));
  }

  for (const type of requiredKinds(input)) {
    if (!usable.some(item => item.artifact.type === type)) {
      gaps.push(gap({
        code: 'required_artifact_type_missing', severity: 'blocking', title: `Required ${type.replace(/_/g, ' ')} evidence is missing`,
        detail: `This Review requires at least one available ${type.replace(/_/g, ' ')} artifact.`,
        remediation: `Add or select an available ${type.replace(/_/g, ' ')} artifact.`, affectedStages: GENERIC_STAGES,
      }));
    }
  }
  if (input.reviewType === 'cross_artifact_consistency' && usable.length < 2) {
    gaps.push(gap({
      code: 'multiple_artifacts_required', severity: 'blocking', title: 'Cross-artifact review needs at least two sources',
      detail: `Only ${usable.length} usable artifact${usable.length === 1 ? ' is' : 's are'} in scope.`,
      remediation: 'Select at least two available artifacts that should be compared.', affectedStages: GENERIC_STAGES,
    }));
  }
  if (input.reviewType === 'requirement_review' && !input.confirmedRequirements?.length && !artifacts.some(item => item.artifact.type === 'requirement')) {
    gaps.push(gap({
      code: 'confirmed_requirements_missing', severity: 'blocking', title: 'No confirmed requirements are available',
      detail: input.pendingRequirementCandidates?.length
        ? `${input.pendingRequirementCandidates.length} extracted candidate(s) are pending confirmation and are not authoritative.`
        : 'This Review has no confirmed requirements or requirement artifacts.',
      remediation: 'Confirm requirement candidates or add a requirement artifact before reviewing.',
      affectedStages: ['requirement_analysis', 'model_analysis'],
    }));
  }
  if (input.reviewType === 'requirement_to_code_traceability' && !input.confirmedRequirements?.length) {
    gaps.push(gap({
      code: 'confirmed_requirements_missing', severity: 'blocking', title: 'Traceability needs confirmed requirements',
      detail: 'Candidate-only requirements do not count as approved scope for traceability.',
      remediation: 'Confirm the requirements to trace, then start a new Review.',
      affectedStages: ['requirement_analysis', 'deterministic_analysis', 'model_analysis'],
    }));
  }
  if (input.standardIds?.length && !(input.enabledStandardRules?.length)) {
    gaps.push(gap({
      code: 'enabled_standard_rules_missing', severity: 'warning', title: 'Selected standards have no enabled rules',
      detail: 'The selected standards cannot contribute a standards-grounded check in their current state.',
      remediation: 'Enable at least one parsed rule or remove the standards from scope.',
      affectedStages: ['standard_verification', 'model_analysis'],
    }));
  }
  for (const item of input.traceability ?? []) {
    if (item.state === 'complete') continue;
    const requirement = input.confirmedRequirements?.find(requirement => requirement.id === item.requirementId);
    const references: NonNullable<EvidenceGap['references']> = [];
    if (requirement?.sourceLocator) references.push({ artifactId: requirement.sourceLocator.artifactId, filePath: requirement.sourceLocator.filePath,
      lineNumber: requirement.sourceLocator.lineStart, sourceVersion: requirement.sourceVersion, excerpt: requirement.sourceLocator.excerpt, relation: 'requirement' });
    for (const id of item.sourceArtifactIds ?? []) {
      const source = artifacts.find(source => source.artifact.id === id)?.artifact;
      if (source) references.push({ artifactId: id, filePath: source.filePath || source.fileName,
        sourceVersion: source.versionId || source.contentHash, relation: source.type === 'source_code' ? 'code' : 'document' });
    }
    gaps.push(gap({
      code: 'traceability_mappings_incomplete', severity: 'warning', title: 'Incomplete Requirement Coverage',
      requirementId: item.requirementId, references,
      detail: `${requirement?.title || item.title || item.requirementId} has ${item.state} implementation mapping evidence. This does not establish that the implementation violates the requirement.`,
      remediation: 'Clarify insufficient requirements, link the relevant versioned sources, and review each acceptance criterion. Run a new Review to verify the updated evidence.',
      affectedStages: ['deterministic_analysis', 'model_analysis'],
    }));
  }
  if (input.pendingRequirementCandidates?.length) {
    gaps.push(gap({
      code: 'requirement_candidates_pending', severity: 'warning', title: 'Requirement candidates await confirmation',
      detail: `${input.pendingRequirementCandidates.length} candidate(s) are not authoritative and will be excluded from grounding.`,
      remediation: 'Confirm or reject candidates before relying on them as project requirements.',
      affectedStages: ['requirement_analysis', 'model_analysis'],
    }));
  }

  const detected = discoverContradictions([
    ...extractEvidenceClaims(artifacts),
    ...(input.claims ?? []),
    ...(input.confirmedRequirements ?? []).map(item => ({
      id: `requirement:${item.id}`,
      text: item.description,
      ...(item.sourceLocator ? { artifactId: item.sourceLocator.artifactId, locator: item.sourceLocator } : {}),
    })),
  ]);
  const decisions = new Map((input.dispositions ?? []).map(item => [item.contradictionId, item]));
  const contradictions = detected.map(item => ({ ...item, ...(decisions.has(item.id) ? { disposition: decisions.get(item.id)! } : {}) }));
  for (const contradiction of contradictions) {
    if (contradiction.disposition) continue;
    gaps.push(gap({
      code: 'contradictory_evidence', severity: 'blocking', title: 'Possible evidence conflict needs review',
      detail: `${contradiction.left.text} ⟷ ${contradiction.right.text}`,
      remediation: 'Resolve the conflict or clarify which source is authoritative before continuing.',
      affectedStages: contradiction.affectedStages,
    }));
  }

  const hasBlocking = gaps.some(item => item.severity === 'blocking');
  const hasWarnings = gaps.some(item => item.severity === 'warning');
  return {
    id: stableId({ reviewId: input.reviewId, projectId: input.projectId, artifactIds: artifacts.map(item => item.artifact.id), gaps, contradictions }),
    reviewId: input.reviewId,
    projectId: input.projectId,
    reviewType: input.reviewType,
    readiness: hasBlocking ? 'blocked' : hasWarnings ? 'ready_with_warnings' : 'ready',
    gaps,
    contradictions,
    artifactCount: artifacts.length,
    availableArtifactCount: available.length,
    staleArtifactCount: stale.length,
    confirmedRequirementCount: input.confirmedRequirements?.length ?? 0,
    enabledStandardRuleCount: input.enabledStandardRules?.length ?? 0,
    assessedAt: (input.now ?? new Date()).toISOString(),
  };
}
