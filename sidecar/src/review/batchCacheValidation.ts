import crypto from 'node:crypto';
import type { ValidatedBatchCacheRecord } from './batchCheckpoint.js';
import type { Artifact } from '../artifacts.js';
import type { StaticFindingInput, StaticModelRequest } from './types.js';
import type { ReviewAnalysisMap } from './featurePathAnalysis.js';
import type { AssessmentBatch } from './assessmentBatches.js';
import type { EvidenceArtifact } from './evidenceSufficiency.js';
import { STATIC_ASSESSMENT_SCHEMA, ASSESSMENT_VALIDATION_VERSION, candidateSemanticKey, candidateSupportId, partitionFindingCandidates,
  validateAssessmentResponse, validateCandidateSupportResponse, validateFindingEvidence, type CandidateSupportAuthority } from './assessmentValidation.js';
import { needsCitationVerification, withCitationEvidence } from './evidenceCandidates.js';
import { normalizeAndDeduplicateFindings, normalizeModelFindings } from './findings.js';

export class BatchCachePersistenceError extends Error {
  constructor() { super('Validated batch cache persistence is unavailable. Saved evidence must be checked before continuing.'); }
}
export type BatchCacheBasis = { reviewId: string; projectId: string; analysisMap: ReviewAnalysisMap; findings: StaticFindingInput[] };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
/** Exact semantic request identity. Execution IDs/attempt counters are outside
 * the supplied prompts and are deliberately not a source of cache misses. */
export function batchRequestIdentity(input: { request: StaticModelRequest; providerFingerprint: string; ownerId: string; policyVersion: string;
  lineageRootId: string; batchId: string; artifacts: Artifact[]; authorities: CandidateSupportAuthority[] }): string {
  return crypto.createHash('sha256').update(canonical({ version: 1, ownerId: input.ownerId, projectId: input.request.projectId,
    lineageRootId: input.lineageRootId, policyVersion: input.policyVersion, validationVersion: ASSESSMENT_VALIDATION_VERSION, providerFingerprint: input.providerFingerprint,
    batchId: input.batchId, systemPrompt: input.request.systemPrompt, prompt: input.request.prompt, schema: input.request.outputSchema,
    authorities: input.authorities, sources: input.artifacts.map(artifact => ({ id: artifact.id, versionId: artifact.versionId,
      path: artifact.filePath, hash: artifact.contentHash, type: artifact.type, source: artifact.source })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  })).digest('hex');
}
/** Copy schema-declared public final fields only. Never cache transport raw,
 * usage, prompts, private reasoning, credentials or arbitrary metadata. */
export function projectPublicAssessment(input: unknown): unknown | null {
  const project = (schema: any, value: unknown, depth: number): unknown => {
    if (depth > 12) throw new Error('Cache depth');
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (Array.isArray(value)) {
      if (!schema.items || value.length > 1024) throw new Error('Cache array');
      return value.map(item => project(schema.items, item, depth + 1));
    }
    if (!value || typeof value !== 'object' || !schema.properties) throw new Error('Cache object');
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(schema.properties)) if (Object.hasOwn(value, key))
      out[key] = project(child, (value as Record<string, unknown>)[key], depth + 1);
    return out;
  };
  try { return project(STATIC_ASSESSMENT_SCHEMA, input, 0); } catch { return null; }
}
type ValidationOptions = {
  projectId: string; ownerId: string; requestHash: string; providerFingerprint: string; policyVersion: string;
  batch: AssessmentBatch; map: ReviewAnalysisMap; evidence: EvidenceArtifact[]; authorities: CandidateSupportAuthority[];
  allowedOrigins: Set<string>; basis: BatchCacheBasis;
  ground(findings: StaticFindingInput[]): { findings: StaticFindingInput[]; rejectedRequirementReferences: number; rejectedStandardReferences: number };
};
/** A historical candidate is not a cache hit merely because its bytes match.
 * Require current validators AND the direct parent's retained conclusions.
 * Later parent contradictions, exclusions or uncertainty therefore veto reuse. */
export function validateCachedBatch(record: ValidatedBatchCacheRecord, options: ValidationOptions): ValidatedBatchCacheRecord {
  if (record.version !== 1 || record.projectId !== options.projectId || record.ownerId !== options.ownerId
    || record.requestHash !== options.requestHash || record.providerFingerprint !== options.providerFingerprint
    || record.policyVersion !== options.policyVersion || record.validationVersion !== ASSESSMENT_VALIDATION_VERSION
    || !options.allowedOrigins.has(record.originReviewId) || options.basis.projectId !== options.projectId
    || canonical(projectPublicAssessment(record.generation)) !== canonical(record.generation)) throw new Error('Cache identity');
  const candidates = partitionFindingCandidates(record.generation);
  if (candidates.rejectedCount) throw new Error('Cache finding shape');
  const validated = validateAssessmentResponse(record.generation, options.map, { requireCompleteLocalDomains: true, sources: options.batch.sources });
  for (const feature of validated.features) {
    const retained = options.basis.analysisMap.features.find(item => item.id === feature.id);
    if (!retained || canonical(retained.assessments) !== canonical(feature.assessments)) throw new Error('Cache conclusion superseded');
  }
  const findings = normalizeModelFindings({ findings: candidates.findings }).map(finding => {
    const source = options.evidence.find(item => item.artifact.id === finding.artifactId)
      ?? options.evidence.find(item => item.artifact.filePath.replace(/\\/g, '/').toLowerCase() === finding.filePath.replace(/\\/g, '/').toLowerCase());
    return { ...finding, artifactId: finding.artifactId ?? source?.artifact.id ?? null,
      sourceIdentity: finding.sourceIdentity ?? null, sourceVersion: finding.sourceVersion ?? null };
  });
  const grounding = options.ground(findings);
  if (grounding.rejectedRequirementReferences || grounding.rejectedStandardReferences) throw new Error('Cache authority');
  const ranked = grounding.findings.map(finding => withCitationEvidence(finding, options.batch.sources));
  if (ranked.some(needsCitationVerification)) throw new Error('Cache uncertain citation');
  const evidence = validateFindingEvidence(ranked, options.evidence);
  if (evidence.rejectedCount) throw new Error('Cache evidence');
  const normalized = normalizeAndDeduplicateFindings([], evidence.findings).model;
  for (const finding of normalized) {
    const key = candidateSemanticKey(finding);
    const retained = options.basis.findings.filter(item => item.source === 'model' && candidateSemanticKey(item) === key);
    if (!retained.length || retained.some(needsCitationVerification)) throw new Error('Cache finding superseded');
  }
  const support = validateCandidateSupportResponse({ candidates: record.supportRecords }, normalized.map(finding => ({
    candidateId: candidateSupportId(options.batch.id, finding), finding,
  })), options.batch.sources, options.authorities);
  if (!support.complete || support.records.some(item => item.disposition !== 'supported')) throw new Error('Cache support');
  return { ...record, supportRecords: support.records };
}
