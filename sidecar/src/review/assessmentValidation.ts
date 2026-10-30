import crypto from 'node:crypto';
import { findingsWithinBatch, type AssessmentSourceSegment } from './assessmentBatches.js';
import type { EvidenceArtifact } from './evidenceSufficiency.js';
import { applyFeatureDomainAssessments, type ReviewAnalysisMap, type ReviewDomain } from './featurePathAnalysis.js';
import type { StaticFindingInput } from './types.js';
import { specializeAssessmentSchema } from './assessmentResponseSchema.js';

export const ASSESSMENT_VALIDATION_VERSION = 'static-assessment-2026-10-30-bounded-line-windows.3';
export const MAX_SUPPORT_CANDIDATES = 32;
export const MAX_SUPPORT_CANDIDATE_TEXT = 2_000;
export const MAX_SUPPORT_AUTHORITIES = 128;
const nullableString = { type: ['string', 'null'] };
const domainSchema = { type: 'string', enum: ['security', 'business', 'technical', 'personnel'] };
function closedObject(properties: Record<string, unknown>) {
  // Strict structured-output providers require every declared key, including
  // nullable optional metadata, and disallow undeclared keys at every depth.
  return { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) };
}
export const STATIC_ASSESSMENT_SCHEMA = closedObject({
  findings: { type: 'array', items: closedObject({
    title: { type: 'string' }, description: { type: 'string' }, category: { type: 'string' },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
    filePath: { type: 'string' }, lineNumber: { type: 'integer', minimum: 1 },
    evidence: { type: 'string' }, recommendation: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    domain: domainSchema, issueType: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,79}$' },
    logicFlow: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 500 } },
    relatedLocations: { type: 'array', maxItems: 16, items: closedObject({
      filePath: { type: 'string' }, lineNumber: { type: 'integer', minimum: 1 }, evidence: { type: 'string' },
      artifactId: nullableString, sourceVersion: nullableString,
    }) },
    artifactId: nullableString, requirementId: nullableString, standardId: nullableString, standardRuleId: nullableString,
    ruleId: nullableString, sourceIdentity: nullableString, sourceVersion: nullableString,
    sourceLocator: { ...closedObject({ analysis: { ...closedObject({ featureId: { type: 'string' }, pathId: { type: 'string' }, domain: domainSchema }), type: ['object', 'null'] } }), type: ['object', 'null'] },
  }) },
  featureAssessments: { type: 'array', items: closedObject({
    featureId: { type: 'string' },
    assessments: { type: 'array', minItems: 4, maxItems: 4, items: closedObject({
      domain: domainSchema, status: { type: 'string', enum: ['assessed', 'unverified'] },
      outcome: { type: 'string', enum: ['potential_gap', 'no_issue_identified', 'not_applicable', 'unverified'] },
      summary: { type: 'string', minLength: 1 }, evidence: { type: 'array', items: closedObject({
        artifactId: { type: 'string' }, filePath: { type: 'string' }, lineNumber: { type: 'integer' }, sourceVersion: nullableString,
      }) },
    }) },
  }) },
});
const supportReferenceSchema = closedObject({
  role: { type: 'string', enum: ['entry', 'guard', 'sink', 'counterevidence', 'contract'] },
  artifactId: { type: 'string' }, filePath: { type: 'string' }, sourceVersion: { type: 'string' },
  lineNumber: { type: 'integer', minimum: 1 }, evidence: { type: 'string', maxLength: 2_000 },
});
const supportAuthorityReferenceSchema = closedObject({
  kind: { type: 'string', enum: ['requirement', 'standard_rule', 'reviewer_disposition', 'traceability_mapping'] },
  id: { type: 'string' }, version: nullableString, secondaryVersion: nullableString,
  reviewedVersionId: nullableString, reviewedContentHash: nullableString,
});
export const CANDIDATE_SUPPORT_SCHEMA = closedObject({ candidates: { type: 'array', maxItems: MAX_SUPPORT_CANDIDATES, items: closedObject({
  candidateId: { type: 'string' }, claimBoundary: { type: 'string', enum: ['local_source', 'selected_call_path', 'runtime_dependent'] },
  disposition: { type: 'string', enum: ['supported', 'contradicted', 'insufficient'] },
  trigger: { type: 'string', maxLength: 500 }, consequence: { type: 'string', maxLength: 500 },
  references: { type: 'array', maxItems: 12, items: supportReferenceSchema },
  authorityReferences: { type: 'array', maxItems: 16, items: supportAuthorityReferenceSchema }, limitation: nullableString,
}) } });
/** Keep provider identifiers inside the actual bounded request inventory. */
export function schemaForAssessmentMap(map: ReviewAnalysisMap, options: { exactReferences?: boolean } = {}) {
  return specializeAssessmentSchema(STATIC_ASSESSMENT_SCHEMA, map, options);
}
const domains = ['security', 'business', 'technical', 'personnel'];
const outcomes = ['potential_gap', 'no_issue_identified', 'not_applicable', 'unverified'];
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export type AssessmentCoverageRepairIssue = {
  featureId: string;
  domain: ReviewDomain;
  code: 'domain_row_incomplete' | 'local_domain_unverified' | 'reference_not_confirmed';
};
const MAX_COVERAGE_REPAIR_ISSUES = 32;

function domainCoverageFeedback(map: ReviewAnalysisMap, featureId?: string, domain?: ReviewDomain, code: AssessmentCoverageRepairIssue['code'] = 'domain_row_incomplete'): AssessmentCoverageRepairIssue[] {
  const features = featureId === undefined ? map.features : map.features.filter(feature => feature.id === featureId);
  const result: AssessmentCoverageRepairIssue[] = [];
  for (const feature of features) {
    for (const currentDomain of domain ? [domain] : domains as ReviewDomain[]) {
      result.push({ featureId: feature.id, domain: currentDomain, code });
      if (result.length >= MAX_COVERAGE_REPAIR_ISSUES) return result;
    }
  }
  return result;
}

function invalidDomainCoverage(map: ReviewAnalysisMap, featureId?: string, domain?: ReviewDomain): InvalidModelAssessmentError {
  return new InvalidModelAssessmentError('domain_coverage', 0, [], domainCoverageFeedback(map, featureId, domain));
}

/** Errors deliberately contain no provider payload, source bodies or claimed findings. */
export type AssessmentRepairIssue = {
  findingIndex: number;
  field: 'filePath' | 'artifactId' | 'sourceVersion' | 'lineNumber' | 'evidence';
  code: 'path_not_unique' | 'source_unavailable' | 'artifact_mismatch' | 'version_mismatch' | 'line_out_of_range' | 'excerpt_mismatch';
  relatedLocationIndex?: number;
};
export class InvalidModelAssessmentError extends Error {
  constructor(
    readonly reason: 'response_shape' | 'finding_shape' | 'domain_coverage' | 'source_evidence' | 'semantic_support',
    readonly rejectedCount = 0,
    readonly feedback: AssessmentRepairIssue[] = [],
    readonly coverageFeedback: AssessmentCoverageRepairIssue[] = [],
  ) {
    super('The model assessment could not be validated. Inspect the saved limitations and retry the review manually.');
    this.name = 'InvalidModelAssessmentError';
  }
}

export type CandidateSupportBoundary = 'local_source' | 'selected_call_path' | 'runtime_dependent';
export type CandidateSupportDisposition = 'supported' | 'contradicted' | 'insufficient';
export type CandidateSupportRole = 'entry' | 'guard' | 'sink' | 'counterevidence' | 'contract';
export type CandidateSupportReference = {
  role: CandidateSupportRole;
  artifactId: string;
  filePath: string;
  sourceVersion: string;
  lineNumber: number;
  evidence: string;
};
export type CandidateSupportAuthorityKind = 'requirement' | 'standard_rule' | 'reviewer_disposition' | 'traceability_mapping';
export type CandidateSupportAuthority = {
  kind: CandidateSupportAuthorityKind;
  id: string;
  version: string | null;
  secondaryVersion: string | null;
  reviewedVersionId: string | null;
  reviewedContentHash: string | null;
  title: string;
  statement: string;
};
export type CandidateSupportAuthorityReference = Pick<CandidateSupportAuthority,
  'kind' | 'id' | 'version' | 'secondaryVersion' | 'reviewedVersionId' | 'reviewedContentHash'>;
export type CandidateSupportRecord = {
  candidateId: string;
  claimBoundary: CandidateSupportBoundary;
  disposition: CandidateSupportDisposition;
  trigger: string;
  consequence: string;
  references: CandidateSupportReference[];
  authorityReferences: CandidateSupportAuthorityReference[];
  limitation: string | null;
};
export const SUPPORT_REFERENCE_FAILURE_CODES = [
  'reference_shape', 'path_not_unique', 'source_unavailable', 'artifact_mismatch', 'version_mismatch', 'line_out_of_range', 'excerpt_mismatch',
] as const;
export type CandidateSupportReferenceFailure = typeof SUPPORT_REFERENCE_FAILURE_CODES[number];
export type CandidateSupportRepairIssue = {
  candidateIndex: number;
  code: 'response_shape' | 'unknown_candidate' | 'missing_candidate' | 'duplicate_candidate' | 'candidate_shape'
    | 'reference_invalid' | 'reference_outside_batch' | 'reference_required' | 'counterevidence_required'
    | 'selected_path_incomplete' | 'authority_reference_invalid' | 'authority_reference_required';
  /** One-based position in the rejected candidate row's references array. */
  referenceIndex?: number;
  /** One-based position in the trusted AssessmentSourceSegment packet. */
  sourceIndex?: number;
  /** Original one-based source line, present only when sourceIndex is safe. */
  lineNumber?: number;
  referenceFailure?: CandidateSupportReferenceFailure;
};
export type CandidateSupportCandidate = { candidateId: string; finding: StaticFindingInput };

/** Opaque stable identity for one normalized claim under one frozen batch. */
export function candidateSupportId(batchId: string, finding: StaticFindingInput): string {
  const identity = {
    batchId,
    artifactId: finding.artifactId,
    sourceVersion: finding.sourceVersion,
    filePath: finding.filePath.replace(/\\/g, '/'),
    lineNumber: finding.lineNumber,
    evidence: finding.evidence,
    recommendation: finding.recommendation,
    confidence: finding.confidence,
    title: finding.title,
    description: finding.description,
    category: finding.category,
    severity: finding.severity,
    domain: finding.domain ?? null,
    issueType: finding.issueType ?? null,
    logicFlow: finding.logicFlow ?? [],
    requirementId: finding.requirementId ?? null,
    standardId: finding.standardId ?? null,
    standardRuleId: finding.standardRuleId ?? null,
    relatedLocations: (finding.relatedLocations ?? []).map(reference => ({
      artifactId: reference.artifactId, sourceVersion: reference.sourceVersion,
      filePath: reference.filePath.replace(/\\/g, '/'), lineNumber: reference.lineNumber, evidence: reference.evidence,
    })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

/** Stable within one review across feature and source-only packets. */
export function candidateSemanticKey(finding: StaticFindingInput): string {
  return candidateSupportId('', finding);
}

const supportBoundaries = new Set<CandidateSupportBoundary>(['local_source', 'selected_call_path', 'runtime_dependent']);
const supportDispositions = new Set<CandidateSupportDisposition>(['supported', 'contradicted', 'insufficient']);
const supportRoles = new Set<CandidateSupportRole>(['entry', 'guard', 'sink', 'counterevidence', 'contract']);

/** Validate every challenge row and reference; return only unambiguous safe siblings on repair. */
export function validateCandidateSupportResponse(
  value: unknown,
  candidates: readonly CandidateSupportCandidate[],
  sources: readonly AssessmentSourceSegment[],
  authorities: readonly CandidateSupportAuthority[] = [],
): { records: CandidateSupportRecord[]; feedback: CandidateSupportRepairIssue[]; complete: boolean } {
  const feedback: CandidateSupportRepairIssue[] = [];
  if (!record(value) || !Array.isArray(value.candidates) || value.candidates.length > MAX_SUPPORT_CANDIDATES) {
    return { records: [], feedback: [{ candidateIndex: 0, code: 'response_shape' }], complete: false };
  }
  const expected = new Map(candidates.map((candidate, index) => [candidate.candidateId, { candidate, index: index + 1 }]));
  const authorityByKey = new Map(authorities.map(authority => [JSON.stringify(authorityReferenceKey(authority)), authority]));
  const rowsById = new Map<string, unknown[]>();
  for (const row of value.candidates) {
    const candidateId = record(row) && typeof row.candidateId === 'string' ? row.candidateId : '';
    if (!expected.has(candidateId)) {
      feedback.push({ candidateIndex: 0, code: 'unknown_candidate' });
      continue;
    }
    rowsById.set(candidateId, [...(rowsById.get(candidateId) ?? []), row]);
  }
  const records: CandidateSupportRecord[] = [];
  for (const candidate of candidates) {
    const expectedRow = expected.get(candidate.candidateId)!;
    const rows = rowsById.get(candidate.candidateId) ?? [];
    if (!rows.length) {
      feedback.push({ candidateIndex: expectedRow.index, code: 'missing_candidate' });
      continue;
    }
    if (rows.length !== 1) {
      feedback.push({ candidateIndex: expectedRow.index, code: 'duplicate_candidate' });
      continue;
    }
    const row = rows[0];
    if (!record(row) || row.candidateId !== candidate.candidateId
      || !supportBoundaries.has(row.claimBoundary as CandidateSupportBoundary)
      || !supportDispositions.has(row.disposition as CandidateSupportDisposition)
      || typeof row.trigger !== 'string' || !row.trigger.trim() || row.trigger.length > 500
      || typeof row.consequence !== 'string' || !row.consequence.trim() || row.consequence.length > 500
      || !Array.isArray(row.references) || row.references.length > 12
      || !Array.isArray(row.authorityReferences) || row.authorityReferences.length > 16
      || !(row.limitation === null || typeof row.limitation === 'string' && row.limitation.length <= 500)) {
      feedback.push({ candidateIndex: expectedRow.index, code: 'candidate_shape' });
      continue;
    }
    const validatedReferences: CandidateSupportReference[] = [];
    let referenceInvalid = false;
    let referenceOutsideBatch = false;
    let referenceIssue: Omit<CandidateSupportRepairIssue, 'candidateIndex' | 'code'> | undefined;
    for (const [referenceOffset, reference] of row.references.entries()) {
      const referenceIndex = referenceOffset + 1;
      if (!record(reference) || !supportRoles.has(reference.role as CandidateSupportRole)
        || typeof reference.artifactId !== 'string' || typeof reference.filePath !== 'string'
        || typeof reference.sourceVersion !== 'string' || typeof reference.lineNumber !== 'number' || !Number.isInteger(reference.lineNumber)
        || typeof reference.evidence !== 'string' || !reference.evidence.trim() || reference.evidence.length > 2_000) {
        referenceInvalid = true;
        referenceIssue = { referenceIndex, referenceFailure: 'reference_shape' };
        break;
      }
      const identityMatches = sources.map((source, index) => ({ source, sourceIndex: index + 1 }))
        .filter(({ source }) => source.artifact.id === reference.artifactId
          && source.artifact.filePath === reference.filePath
          && source.artifact.contentHash === reference.sourceVersion);
      if (!identityMatches.length) {
        const samePathArtifact = sources.some(source => source.artifact.filePath === reference.filePath && source.artifact.id === reference.artifactId);
        const samePathVersion = sources.some(source => source.artifact.filePath === reference.filePath && source.artifact.contentHash === reference.sourceVersion);
        referenceInvalid = true;
        referenceIssue = {
          referenceIndex,
          referenceFailure: samePathArtifact ? 'version_mismatch'
            : samePathVersion ? 'artifact_mismatch' : 'path_not_unique',
        };
        break;
      }
      const lineNumber = reference.lineNumber as number;
      const anchorMatches = identityMatches.filter(({ source }) => lineNumber >= source.lineStart && lineNumber <= source.lineEnd);
      if (!anchorMatches.length) {
        referenceOutsideBatch = true;
        referenceIssue = { referenceIndex, referenceFailure: 'line_out_of_range' };
        break;
      }
      const referenceLines = String(reference.evidence).replace(/\r\n/g, '\n').split('\n').length;
      const completeMatches = anchorMatches.filter(({ source }) => lineNumber + referenceLines - 1
        <= Math.min(source.lineEnd, source.lineStart + (typeof source.content === 'string' ? source.content.split('\n').length : 0) - 1));
      if (!completeMatches.length) {
        referenceOutsideBatch = true;
        referenceIssue = { referenceIndex, sourceIndex: anchorMatches[0]!.sourceIndex, lineNumber, referenceFailure: 'line_out_of_range' };
        break;
      }
      if (completeMatches.some(({ source }) => typeof source.content !== 'string' || source.state && source.state !== 'available' || !source.artifact.contentHash)) {
        referenceInvalid = true;
        referenceIssue = { referenceIndex, referenceFailure: 'source_unavailable' };
        break;
      }
      const validatedMatches = completeMatches.map(({ source, sourceIndex }) => ({
        source,
        sourceIndex,
        result: validateFindingEvidence([{
          source: 'model', title: 'Support reference', description: 'Support reference', severity: 'info', priority: null,
          category: 'semantic_support', filePath: reference.filePath as string, lineNumber: reference.lineNumber as number,
          artifactId: reference.artifactId as string, sourceVersion: reference.sourceVersion as string, evidence: reference.evidence as string,
          recommendation: '', confidence: 'medium', riskLevel: 'low',
        }], [source]),
      }));
      const acceptedMatch = validatedMatches.find(match => !match.result.rejectedCount && match.result.findings.length === 1);
      if (!acceptedMatch) {
        const failedMatch = validatedMatches[0]!;
        const { source, sourceIndex, result: validated } = failedMatch;
        referenceInvalid = true;
        const validationCode = validated.feedback[0]?.code;
        referenceIssue = {
          referenceIndex,
          sourceIndex,
          lineNumber,
          referenceFailure: validationCode === 'source_unavailable' ? 'source_unavailable'
            : validationCode === 'artifact_mismatch' ? 'artifact_mismatch'
              : validationCode === 'version_mismatch' ? 'version_mismatch'
                : validationCode === 'path_not_unique' ? 'path_not_unique' : 'excerpt_mismatch',
        };
        break;
      }
      const { source: matchedSource, sourceIndex } = acceptedMatch;
      const checked = acceptedMatch.result.findings[0]!;
      const checkedOriginal = { ...checked, lineNumber: reference.lineNumber as number };
      if (!findingsWithinBatch([checkedOriginal], [...sources]).length) {
        referenceOutsideBatch = true;
        referenceIssue = { referenceIndex, sourceIndex, lineNumber, referenceFailure: 'line_out_of_range' };
        break;
      }
      validatedReferences.push({
        role: reference.role as CandidateSupportRole,
        artifactId: matchedSource.artifact.id,
        filePath: matchedSource.artifact.filePath,
        sourceVersion: matchedSource.artifact.contentHash,
        lineNumber: reference.lineNumber as number,
        evidence: checked.evidence,
      });
    }
    if (referenceInvalid) {
      feedback.push({ candidateIndex: expectedRow.index, code: 'reference_invalid', ...referenceIssue });
      continue;
    }
    if (referenceOutsideBatch) {
      feedback.push({ candidateIndex: expectedRow.index, code: 'reference_outside_batch', ...referenceIssue });
      continue;
    }
    const validatedAuthorities: CandidateSupportAuthorityReference[] = [];
    const seenAuthorities = new Set<string>();
    let authorityInvalid = false;
    for (const reference of row.authorityReferences) {
      if (!record(reference) || !['requirement', 'standard_rule', 'reviewer_disposition', 'traceability_mapping'].includes(String(reference.kind))
        || typeof reference.id !== 'string' || !(reference.version === null || typeof reference.version === 'string')
        || !(reference.secondaryVersion === null || typeof reference.secondaryVersion === 'string')
        || !(reference.reviewedVersionId === null || typeof reference.reviewedVersionId === 'string')
        || !(reference.reviewedContentHash === null || typeof reference.reviewedContentHash === 'string')) {
        authorityInvalid = true;
        break;
      }
      const key = JSON.stringify(authorityReferenceKey(reference as CandidateSupportAuthorityReference));
      if (!authorityByKey.has(key) || seenAuthorities.has(key)) {
        authorityInvalid = true;
        break;
      }
      seenAuthorities.add(key);
      const { kind, id, version, secondaryVersion, reviewedVersionId, reviewedContentHash } = reference as CandidateSupportAuthorityReference;
      validatedAuthorities.push({ kind, id, version, secondaryVersion, reviewedVersionId, reviewedContentHash });
    }
    if (authorityInvalid) {
      feedback.push({ candidateIndex: expectedRow.index, code: 'authority_reference_invalid' });
      continue;
    }
    const disposition = row.disposition as CandidateSupportDisposition;
    const roles = new Set(validatedReferences.map(reference => reference.role));
    if (disposition !== 'insufficient' && !validatedReferences.length) {
      feedback.push({ candidateIndex: expectedRow.index, code: 'reference_required' });
      continue;
    }
    if (disposition === 'contradicted' && !roles.has('guard') && !roles.has('counterevidence')) {
      feedback.push({ candidateIndex: expectedRow.index, code: 'counterevidence_required' });
      continue;
    }
    if (disposition === 'supported' && row.claimBoundary === 'selected_call_path'
      && (!roles.has('entry') || !roles.has('sink'))) {
      feedback.push({ candidateIndex: expectedRow.index, code: 'selected_path_incomplete' });
      continue;
    }
    if (disposition === 'supported' && row.claimBoundary === 'runtime_dependent' && !roles.has('contract')) {
      feedback.push({ candidateIndex: expectedRow.index, code: 'reference_required' });
      continue;
    }
    if (disposition === 'supported' && candidate.finding.requirementId
      && !validatedAuthorities.some(authority => authority.kind === 'requirement' && authority.id === candidate.finding.requirementId)) {
      feedback.push({ candidateIndex: expectedRow.index, code: 'authority_reference_required' });
      continue;
    }
    if (disposition === 'supported' && candidate.finding.standardRuleId
      && !validatedAuthorities.some(authority => authority.kind === 'standard_rule' && authority.id === candidate.finding.standardRuleId)) {
      feedback.push({ candidateIndex: expectedRow.index, code: 'authority_reference_required' });
      continue;
    }
    if (disposition === 'insufficient' && (typeof row.limitation !== 'string' || !row.limitation.trim())) {
      feedback.push({ candidateIndex: expectedRow.index, code: 'candidate_shape' });
      continue;
    }
    records.push({
      candidateId: candidate.candidateId,
      claimBoundary: row.claimBoundary as CandidateSupportBoundary,
      disposition,
      trigger: row.trigger,
      consequence: row.consequence,
      references: validatedReferences,
      authorityReferences: validatedAuthorities,
      limitation: row.limitation as string | null,
    });
  }
  return { records, feedback, complete: feedback.length === 0 && records.length === candidates.length };
}

function authorityReferenceKey(authority: Pick<CandidateSupportAuthority,
  'kind' | 'id' | 'version' | 'secondaryVersion' | 'reviewedVersionId' | 'reviewedContentHash'>) {
  return {
    kind: authority.kind,
    id: authority.id,
    version: authority.version,
    secondaryVersion: authority.secondaryVersion,
    reviewedVersionId: authority.reviewedVersionId,
    reviewedContentHash: authority.reviewedContentHash,
  };
}

export function validateAssessmentResponse(
  value: unknown,
  map: ReviewAnalysisMap,
  options: { requireCompleteLocalDomains?: boolean; sources?: readonly AssessmentSourceSegment[] } = {},
): ReviewAnalysisMap {
  if (!record(value) || !Array.isArray(value.findings) || !Array.isArray(value.featureAssessments)) throw new InvalidModelAssessmentError('response_shape');
  if (value.featureAssessments.length !== map.features.length) throw invalidDomainCoverage(map);
  const seen = new Set<string>();
  for (const row of value.featureAssessments) {
    if (!record(row) || typeof row.featureId !== 'string' || seen.has(row.featureId) || !map.features.some(feature => feature.id === row.featureId)
      || !Array.isArray(row.assessments) || row.assessments.length !== domains.length) {
      const trustedFeatureId = record(row) && typeof row.featureId === 'string' && map.features.some(feature => feature.id === row.featureId)
        ? row.featureId : undefined;
      throw invalidDomainCoverage(map, trustedFeatureId);
    }
    seen.add(row.featureId);
    const seenDomains = new Set<string>();
    for (const item of row.assessments) {
      if (!record(item) || !domains.includes(String(item.domain)) || seenDomains.has(String(item.domain)) || !outcomes.includes(String(item.outcome))
        || !['assessed', 'unverified'].includes(String(item.status)) || !Array.isArray(item.evidence) || !nonempty(item.summary)
        || (item.status === 'unverified') !== (item.outcome === 'unverified')) {
        const currentDomain = record(item) && domains.includes(String(item.domain)) ? item.domain as ReviewDomain : undefined;
        throw invalidDomainCoverage(map, row.featureId, currentDomain);
      }
      seenDomains.add(String(item.domain));
    }
  }
  const applied = applyFeatureDomainAssessments(map, value);
  // Selected-file identity alone is insufficient once a packet contains only
  // specific ranges. Every claimed inspected reference must actually have
  // been supplied in this request, including responses retained as partial.
  if (options.sources) {
    for (const feature of applied.features) for (const assessment of feature.assessments) {
      if (assessment.status !== 'assessed') continue;
      if (assessment.evidence.some(reference => !options.sources!.some(source =>
        source.artifact.id === reference.artifactId
        && source.artifact.filePath === reference.filePath
        && source.artifact.contentHash === reference.sourceVersion
        && reference.lineNumber >= source.lineStart && reference.lineNumber <= source.lineEnd))) {
        throw invalidDomainCoverage(map, feature.id, assessment.domain);
      }
    }
  }
  // A claimed assessment with invented/mismatched references is invalid, not a clean omitted slot.
  for (const row of value.featureAssessments) {
    const typed = row as Record<string, unknown>;
    const feature = applied.features.find(item => item.id === typed.featureId)!;
    if ((typed.assessments as Array<Record<string, unknown>>).some(item => item.status === 'assessed'
      && feature.assessments.find(assessment => assessment.domain === item.domain)?.status !== 'assessed')) {
      const failed = feature.assessments.find(assessment => (typed.assessments as Array<Record<string, unknown>>)
        .some(item => item.domain === assessment.domain && item.status === 'assessed' && assessment.status !== 'assessed'));
      throw invalidDomainCoverage(map, feature.id, failed?.domain);
    }
  }
  if (options.requireCompleteLocalDomains) {
    const suppliedRows = value.featureAssessments;
    const incomplete = applied.features.flatMap(feature => feature.assessments
      .filter(assessment => assessment.status !== 'assessed')
      .map(assessment => {
        const row = suppliedRows.find(candidate => record(candidate) && candidate.featureId === feature.id);
        const item = record(row) && Array.isArray(row.assessments)
          ? row.assessments.find(candidate => record(candidate) && candidate.domain === assessment.domain)
          : undefined;
        const code: AssessmentCoverageRepairIssue['code'] = record(item) && (item.status === 'unverified' || item.outcome === 'unverified')
          ? 'local_domain_unverified' : 'reference_not_confirmed';
        return { featureId: feature.id, domain: assessment.domain, code };
      }));
    if (incomplete.length) {
      throw new InvalidModelAssessmentError('domain_coverage', incomplete.length, [], incomplete.slice(0, MAX_COVERAGE_REPAIR_ISSUES));
    }
  }
  return applied;
}

/** Keep valid siblings as partial evidence without turning rejected entries into defaults. */
export function partitionFindingCandidates(value: unknown): { findings: Record<string, unknown>[]; findingIndexes: number[]; rejectedCount: number } {
  const rows = record(value) && Array.isArray(value.findings) ? value.findings : [];
  const findingIndexes: number[] = [];
  const findings = rows.filter((finding, index): finding is Record<string, unknown> => {
    const valid = record(finding)
    && ['title', 'description', 'category', 'filePath', 'evidence', 'recommendation'].every(key => nonempty(finding[key]))
    && ['critical', 'high', 'medium', 'low', 'info'].includes(String(finding.severity))
    && ['high', 'medium', 'low'].includes(String(finding.confidence))
    && Number.isInteger(finding.lineNumber) && Number(finding.lineNumber) > 0
    && (finding.domain === undefined || ['security','business','technical','personnel'].includes(String(finding.domain)))
    && (finding.issueType === undefined || typeof finding.issueType === 'string' && /^[a-z][a-z0-9_]{1,79}$/.test(finding.issueType))
    && (finding.logicFlow === undefined || Array.isArray(finding.logicFlow) && finding.logicFlow.length <= 10 && finding.logicFlow.every(step => nonempty(step) && (step as string).length <= 500 && !/chain.of.thought|private reasoning|internal analysis/i.test(step as string)))
    && (finding.relatedLocations === undefined || Array.isArray(finding.relatedLocations) && finding.relatedLocations.length <= 16 && finding.relatedLocations.every(ref => record(ref) && nonempty(ref.filePath) && nonempty(ref.evidence) && Number.isInteger(ref.lineNumber) && Number(ref.lineNumber) > 0
      && (ref.artifactId == null || typeof ref.artifactId === 'string') && (ref.sourceVersion == null || typeof ref.sourceVersion === 'string')));
    if (valid) findingIndexes.push(index + 1);
    return valid;
  });
  return { findings, findingIndexes, rejectedCount: rows.length - findings.length };
}

const path = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '');
const newline = (value: string) => value.replace(/\r\n/g, '\n');

/** Anchoring validates provenance only; it does not prove the model's semantic conclusion. */
export function validateFindingEvidence(findings: StaticFindingInput[], sources: EvidenceArtifact[]) {
  const accepted: StaticFindingInput[] = [];
  const feedback: AssessmentRepairIssue[] = [];
  let rejectedCount = 0;
  for (const [index, finding] of findings.entries()) {
    const matches = sources.filter(source => [source.artifact.filePath, source.artifact.originalPath].some(value => value && path(value) === path(finding.filePath)));
    const quote = newline(finding.evidence);
    const quoteLines = quote.split('\n').length;
    const identityKeys = new Set(matches.map(source => `${source.artifact.id}\u0000${source.artifact.versionId ?? ''}\u0000${source.artifact.contentHash ?? ''}`));
    type PacketSource = EvidenceArtifact & Partial<Pick<AssessmentSourceSegment, 'lineStart' | 'lineEnd' | 'lineWindow'>>;
    const uniqueIdentitySources = identityKeys.size === 1 ? matches as PacketSource[] : [];
    const representative = uniqueIdentitySources[0];
    const failure: Omit<AssessmentRepairIssue, 'findingIndex'> | undefined = !matches.length || identityKeys.size !== 1
      ? { field: 'filePath', code: 'path_not_unique' }
      : uniqueIdentitySources.every(source => typeof source.content !== 'string' || source.state && source.state !== 'available') || !representative?.artifact.contentHash
        ? { field: 'evidence', code: 'source_unavailable' }
        : finding.artifactId && finding.artifactId !== representative.artifact.id
          ? { field: 'artifactId', code: 'artifact_mismatch' }
          : finding.sourceVersion && finding.sourceVersion !== representative.artifact.contentHash && finding.sourceVersion !== representative.artifact.versionId
            ? { field: 'sourceVersion', code: 'version_mismatch' }
            : !Number.isSafeInteger(finding.lineNumber) || finding.lineNumber! < 1 || !quote.trim()
              ? { field: !quote.trim() ? 'evidence' : 'lineNumber', code: !quote.trim() ? 'excerpt_mismatch' : 'line_out_of_range' }
              : undefined;
    let source: PacketSource | undefined;
    let sourceFailure: Omit<AssessmentRepairIssue, 'findingIndex'> | undefined;
    if (!failure && representative) {
      const candidates = uniqueIdentitySources.flatMap(candidate => {
        if (typeof candidate.content !== 'string' || candidate.state && candidate.state !== 'available') return [];
        const window = candidate.lineWindow;
        const windowValid = !window || (Number.isSafeInteger(window.startOffset) && window.startOffset >= 0
          && Number.isSafeInteger(window.endOffsetExclusive) && window.endOffsetExclusive > window.startOffset
          && Number.isSafeInteger(window.originalLineLength) && window.originalLineLength >= window.endOffsetExclusive
          && (window.startOffset > 0 || window.endOffsetExclusive < window.originalLineLength)
          && window.offsetUnit === 'utf16_code_units' && window.partialLine === true
          && candidate.lineStart === candidate.lineEnd && quoteLines === 1
          && candidate.content.length === window.endOffsetExclusive - window.startOffset);
        if (!windowValid) return [];
        const lines = newline(candidate.content).split('\n');
        const segmentStart = Number.isSafeInteger(candidate.lineStart) ? candidate.lineStart! : 1;
        const segmentEnd = Number.isSafeInteger(candidate.lineEnd) ? candidate.lineEnd! : segmentStart + lines.length - 1;
        const start = finding.lineNumber! - segmentStart;
        if (start < 0 || start >= lines.length || finding.lineNumber! < segmentStart
          || finding.lineNumber! + quoteLines - 1 > segmentEnd
          || finding.lineNumber! + quoteLines - 1 > segmentStart + lines.length - 1) return [];
        const range = lines.slice(start, start + quoteLines).join('\n');
        return [{ source: candidate, exact: range.includes(quote) }];
      });
      source = candidates.find(candidate => candidate.exact)?.source;
      if (!source) sourceFailure = candidates.length
        ? { field: 'evidence', code: 'excerpt_mismatch' }
        : { field: 'lineNumber', code: 'line_out_of_range' };
    }
    const invalid = failure ?? sourceFailure;
    if (invalid || !source) {
      rejectedCount++;
      if (feedback.length < 16) feedback.push({ findingIndex: index + 1, ...(invalid ?? { field: 'filePath', code: 'path_not_unique' }) });
      continue;
    }
    const relatedLocations: NonNullable<StaticFindingInput['relatedLocations']> = [];
    for (const [relatedIndex, ref] of (finding.relatedLocations ?? []).entries()) {
      const validated = validateFindingEvidence([{ ...finding, ...ref, artifactId: ref.artifactId ?? null, sourceVersion: ref.sourceVersion ?? null, relatedLocations: [] }], sources);
      rejectedCount += validated.rejectedCount;
      for (const issue of validated.feedback) if (feedback.length < 16) feedback.push({...issue,findingIndex:index+1,relatedLocationIndex:relatedIndex+1});
      for (const value of validated.findings) relatedLocations.push({ filePath: value.filePath, lineNumber: value.lineNumber!, evidence: value.evidence, artifactId: value.artifactId, sourceVersion: value.sourceVersion });
    }
    accepted.push({ ...finding, relatedLocations, artifactId: source.artifact.id, filePath: source.artifact.filePath,
      sourceIdentity: source.artifact.originalPath ?? source.artifact.filePath, sourceVersion: source.artifact.contentHash });
  }
  return { findings: accepted, rejectedCount, feedback };
}

/** Only fully assessed bounded local feature coverage can support a static re-check. */
export function assessedArtifactIds(map: ReviewAnalysisMap): string[] {
  if (map.status !== 'assessed' || map.coverage.featureInventoryTruncated || map.coverage.selectedModuleGraphTruncated
    || (map.coverage.exportExpansionTruncatedCount ?? 0) > 0
    || map.coverage.limitations.some(item => item.includes('omitted because'))) return [];
  const unsupported = new Set([
    ...map.coverage.unsupportedArtifacts,
    // The diagnostic unsupported-file listing is bounded. Text-logic units
    // remain ineligible even when their artifact is beyond that listing.
    ...map.features.filter(feature => feature.analysisKind === 'plain_text_logic').flatMap(feature => feature.entryPoints),
    ...(map.coverage.declarationArtifacts ?? []),
    ...(map.coverage.nonExecutableArtifacts ?? []),
  ].map(item => item.artifactId));
  // A positively identified external callback boundary is a real mapped
  // surface, but it still cannot support absence-based resolution proof.
  for (const feature of map.features) if (feature.entryPointStatus === 'external_boundary') {
    for (const reference of feature.entryPoints) unsupported.add(reference.artifactId);
  }
  const ids = new Set(map.features.flatMap(feature => feature.entryPoints.map(ref => ref.artifactId)));
  return [...ids].filter(id => !unsupported.has(id) && map.features.filter(feature => feature.entryPoints.some(ref => ref.artifactId === id))
    .every(feature => feature.assessments.every(item => item.status === 'assessed' && item.outcome !== 'potential_gap')
      // The generic bounded-syntax caveat is retained in every map. Explicit unresolved edges are different.
      && feature.unresolved.every(item => item.reason.startsWith('The map covers only syntax inside this handler;'))));
}

export function inspectedAssessmentReferences(map: ReviewAnalysisMap) {
  const eligible = new Set(assessedArtifactIds(map));
  return map.features.flatMap(feature => feature.assessments.filter(assessment => assessment.status === 'assessed' && assessment.outcome !== 'potential_gap')
    .flatMap(assessment => assessment.evidence.filter(ref => eligible.has(ref.artifactId)).map(ref => ({ ...ref, featureId: feature.id, domain: assessment.domain,
      pathId: feature.paths.find(path => path.evidence.some(evidence => evidence.artifactId === ref.artifactId && evidence.filePath === ref.filePath && evidence.lineNumber === ref.lineNumber && evidence.sourceVersion === ref.sourceVersion))?.id,
    }))));
}
