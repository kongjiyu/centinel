import crypto from 'node:crypto';
import type { ValidatedBatchCacheRecord } from './batchCheckpoint.js';
import type { Artifact } from '../artifacts.js';
import type { StaticFindingInput, StaticModelRequest } from './types.js';
import type { ReviewAnalysisFeature, ReviewAnalysisMap } from './featurePathAnalysis.js';
import type { ReviewAuditEvent } from './types.js';
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
type RecoveredBatch = { features: Map<string, ReviewAnalysisFeature>; supported: Set<string>; vetoed: boolean };
/** Same-Review lease recovery (user-approved, 6 November 2026): the retained
 * conclusions of each batch this Review journaled before its interruption. */
export type RecoveryBatchBasis = { kind: 'recovery'; reviewId: string; projectId: string; batches: Map<string, RecoveredBatch> };
/** Events that mark a batch as negative, uncertain, timed out or unverified in
 * this Review. Any one of them permanently vetoes same-Review reuse. */
const RECOVERY_VETO_EVENTS = new Set(['review_batch_needs_verification', 'review_analysis_batch_unverified',
  'review_candidate_support_incomplete', 'review_candidate_support_limited', 'review_candidate_support_conflict', 'review_batch_cache_rejected']);
export const RECOVERY_JOURNAL_EVENTS = ['review_lease_recovered', 'review_analysis_batch_saved', 'review_candidate_support_saved', ...RECOVERY_VETO_EVENTS] as const;
/** Builds a recovery basis only when this Review was requeued by lease
 * recovery. Must be read before the resumed run journals any batch. */
export function recoveryBasisFromJournal(events: ReviewAuditEvent[], review: { id: string; projectId: string }): RecoveryBatchBasis | null {
  const own = events.filter(event => event.reviewId === review.id && event.projectId === review.projectId);
  if (!own.some(event => event.event === 'review_lease_recovered' && event.detail?.action === 'requeued')) return null;
  const batches = new Map<string, RecoveredBatch>();
  const entry = (batchId: string) => {
    let item = batches.get(batchId);
    if (!item) batches.set(batchId, item = { features: new Map(), supported: new Set(), vetoed: false });
    return item;
  };
  for (const event of own) {
    const batchId = typeof event.detail?.batchId === 'string' ? event.detail.batchId : null;
    if (!batchId) continue;
    const item = entry(batchId);
    if (RECOVERY_VETO_EVENTS.has(event.event)) item.vetoed = true;
    else if (event.event === 'review_analysis_batch_saved') {
      if (!Array.isArray(event.detail?.features)) { item.vetoed = true; continue; }
      for (const feature of event.detail.features as ReviewAnalysisFeature[]) {
        if (!feature || typeof feature.id !== 'string') { item.vetoed = true; continue; }
        item.features.set(feature.id, feature);
      }
    } else if (event.event === 'review_candidate_support_saved') {
      const candidates = event.detail?.candidates;
      if (!Array.isArray(candidates)) { item.vetoed = true; continue; }
      for (const candidate of candidates as Array<{ candidateId?: unknown; disposition?: unknown }>) {
        if (typeof candidate?.candidateId !== 'string' || candidate.disposition !== 'supported') item.vetoed = true;
        else item.supported.add(candidate.candidateId);
      }
    }
  }
  return { kind: 'recovery', reviewId: review.id, projectId: review.projectId, batches };
}
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
  allowedOrigins: Set<string>; basis: BatchCacheBasis | RecoveryBatchBasis;
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
  const recovery = 'kind' in options.basis && options.basis.kind === 'recovery' ? options.basis : null;
  const recovered = recovery?.batches.get(options.batch.id);
  if (recovery && (record.originReviewId !== recovery.reviewId || !recovered || recovered.vetoed)) throw new Error('Cache recovery journal');
  const candidates = partitionFindingCandidates(record.generation);
  if (candidates.rejectedCount) throw new Error('Cache finding shape');
  const validated = validateAssessmentResponse(record.generation, options.map, { requireCompleteLocalDomains: true, sources: options.batch.sources });
  for (const feature of validated.features) {
    const retained = recovered ? recovered.features.get(feature.id)
      : (options.basis as BatchCacheBasis).analysisMap.features.find(item => item.id === feature.id);
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
  if (recovered) {
    // This Review's own journal must have recorded exactly these candidates
    // as fully supported before the interruption.
    const ids = new Set(normalized.map(finding => candidateSupportId(options.batch.id, finding)));
    if (ids.size !== normalized.length || ids.size !== recovered.supported.size || [...ids].some(id => !recovered.supported.has(id))) {
      throw new Error('Cache finding not journaled');
    }
  } else for (const finding of normalized) {
    const key = candidateSemanticKey(finding);
    const retained = (options.basis as BatchCacheBasis).findings.filter(item => item.source === 'model' && candidateSemanticKey(item) === key);
    if (!retained.length || retained.some(needsCitationVerification)) throw new Error('Cache finding superseded');
  }
  const support = validateCandidateSupportResponse({ candidates: record.supportRecords }, normalized.map(finding => ({
    candidateId: candidateSupportId(options.batch.id, finding), finding,
  })), options.batch.sources, options.authorities);
  if (!support.complete || support.records.some(item => item.disposition !== 'supported')) throw new Error('Cache support');
  return { ...record, supportRecords: support.records };
}
