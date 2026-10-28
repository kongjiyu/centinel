import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { deriveReviewAnalysisMap } from '../../src/review/featurePathAnalysis.js';
import { planAssessmentBatches } from '../../src/review/assessmentBatches.js';
import {
  ASSESSMENT_VALIDATION_VERSION,
  candidateSupportId,
  validateAssessmentResponse,
  validateFindingEvidence,
  type CandidateSupportAuthority,
} from '../../src/review/assessmentValidation.js';
import { batchRequestIdentity, validateCachedBatch, type BatchCacheBasis } from '../../src/review/batchCacheValidation.js';
import { normalizeAndDeduplicateFindings, normalizeModelFindings } from '../../src/review/findings.js';
import { STATIC_REVIEW_MODEL_POLICY_VERSION } from '../../src/review/orchestrator.js';
import { withCitationEvidence } from '../../src/review/evidenceCandidates.js';
import type { EvidenceArtifact } from '../../src/review/evidenceSufficiency.js';
import type { ValidatedBatchCacheRecord } from '../../src/review/batchCheckpoint.js';
import type { StaticModelRequest, StaticFindingInput } from '../../src/review/types.js';

const ownerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const originReviewId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sourceText = 'export function checkout(user) { return user.id; }\n';
const sourceHash = crypto.createHash('sha256').update(sourceText).digest('hex');

function fixture() {
  const artifact: Artifact = { id: 'checkout', projectId, versionId: 'checkout-v1', contentHash: sourceHash,
    type: 'source_code', source: 'repository', fileName: 'checkout.ts', filePath: 'src/checkout.ts', originalPath: null,
    createdAt: '2026-10-28T00:00:00.000Z' };
  const evidence: EvidenceArtifact = { artifact, content: sourceText };
  const baseMap = deriveReviewAnalysisMap([evidence]);
  const batch = planAssessmentBatches(baseMap, [evidence]).find(item => item.features.length > 0);
  if (!batch) throw new Error('Fixture did not produce a feature batch.');
  const map = { ...baseMap, features: batch.features };
  const generation = {
    findings: [{
      title: 'Checkout trusts an unverified identity',
      description: 'The function returns the supplied user ID without checking authorization.',
      severity: 'high', category: 'authorization', filePath: artifact.filePath, lineNumber: 1,
      evidence: sourceText.trimEnd(), recommendation: 'Validate authorization before returning the identity.',
      confidence: 'high', domain: 'security', issueType: 'authorization_bypass', logicFlow: [], relatedLocations: [],
      artifactId: artifact.id, requirementId: null, standardId: null, standardRuleId: null, ruleId: null,
      sourceIdentity: artifact.filePath, sourceVersion: artifact.contentHash, sourceLocator: null,
    }],
    featureAssessments: map.features.map(feature => ({ featureId: feature.id,
      assessments: ['security', 'business', 'technical', 'personnel'].map(domain => ({ domain, status: 'assessed',
        outcome: 'no_issue_identified', summary: 'The supplied local operation was inspected.', evidence: feature.entryPoints })) })),
  };
  const candidate = normalizeModelFindings({ findings: generation.findings }).map(finding => ({
    ...finding, artifactId: finding.artifactId ?? artifact.id,
    sourceIdentity: finding.sourceIdentity ?? null, sourceVersion: finding.sourceVersion ?? null,
  }))[0]!;
  const supportRecords = [{
    candidateId: candidateSupportId(batch.id, candidate), claimBoundary: 'local_source' as const, disposition: 'supported' as const,
    trigger: 'The supplied identity reaches the return operation.', consequence: 'An unchecked identity is returned to the caller.',
    references: [{ role: 'sink' as const, artifactId: artifact.id, filePath: artifact.filePath, sourceVersion: artifact.contentHash,
      lineNumber: 1, evidence: sourceText.trimEnd() }], authorityReferences: [], limitation: null,
  }];
  const validatedMap = validateAssessmentResponse(generation, map, { requireCompleteLocalDomains: true, sources: batch.sources });
  const analysisMap = { ...baseMap, features: baseMap.features.map(feature => validatedMap.features.find(item => item.id === feature.id) ?? feature) };
  const ranked = candidate ? [candidate].map(item => withCitationEvidence(item, batch.sources)) : [];
  const evidenceValidated = validateFindingEvidence(ranked, [evidence]);
  const normalized = normalizeAndDeduplicateFindings([], evidenceValidated.findings).model;
  const basis: BatchCacheBasis = { reviewId: originReviewId, projectId, analysisMap,
    findings: normalized.map(finding => ({ ...finding, source: 'model' as const })) };
  const record: ValidatedBatchCacheRecord = {
    version: 1, projectId, ownerId, originReviewId, requestHash: 'a'.repeat(64),
    policyVersion: STATIC_REVIEW_MODEL_POLICY_VERSION, validationVersion: ASSESSMENT_VALIDATION_VERSION,
    providerFingerprint: 'c'.repeat(64), generation, supportRecords,
  };
  const options = {
    projectId, ownerId, requestHash: record.requestHash, providerFingerprint: record.providerFingerprint,
    policyVersion: record.policyVersion, batch, map, evidence: [evidence], authorities: [] as CandidateSupportAuthority[],
    allowedOrigins: new Set([originReviewId]), basis,
    ground: (findings: StaticFindingInput[]) => ({ findings, rejectedRequirementReferences: 0, rejectedStandardReferences: 0 }),
  };
  return { artifact, evidence, baseMap, map, batch, generation, supportRecords, basis, record, options };
}

describe('validated batch cache identity and direct-parent proof', () => {
  it('accepts only when the current validators and direct parent retain the same supported evidence', () => {
    const sample = fixture();
    expect(validateCachedBatch(sample.record, sample.options)).toMatchObject({
      requestHash: sample.record.requestHash, supportRecords: [{ candidateId: sample.supportRecords[0]!.candidateId, disposition: 'supported' }],
    });
  });

  it('vetoes cache reuse when the direct parent changed a batch assessment outcome', () => {
    const sample = fixture();
    const basis = structuredClone(sample.basis);
    basis.analysisMap.features[0]!.assessments[0]!.outcome = 'potential_gap';
    expect(() => validateCachedBatch(sample.record, { ...sample.options, basis })).toThrow('Cache conclusion superseded');
  });

  it('vetoes cache reuse when the direct parent no longer retains a verified finding', () => {
    const sample = fixture();
    const basis = { ...sample.basis, findings: [] };
    expect(() => validateCachedBatch(sample.record, { ...sample.options, basis })).toThrow('Cache finding superseded');
    const uncertainBasis = { ...sample.basis, findings: sample.basis.findings.map(finding => ({ ...finding,
      sourceLocator: { ...(finding.sourceLocator ?? {}), citationEvidence: { verification: 'needs_verification' } },
    })) };
    expect(() => validateCachedBatch(sample.record, { ...sample.options, basis: uncertainBasis })).toThrow('Cache finding superseded');
  });

  it('rejects an invalid source citation or a mutated semantic-support reference', () => {
    const sample = fixture();
    const badCitation = structuredClone(sample.record);
    (badCitation.generation as { findings: Array<{ evidence: string }> }).findings[0]!.evidence = 'not in frozen source';
    expect(() => validateCachedBatch(badCitation, sample.options)).toThrow();

    const badSupport = structuredClone(sample.record);
    badSupport.supportRecords[0]!.references[0]!.evidence = 'not in frozen source';
    expect(() => validateCachedBatch(badSupport, sample.options)).toThrow('Cache support');
  });

  it('binds request identity to provider, policy, batch, prompt, schema, ordered packet, and authority inputs', () => {
    const sample = fixture();
    const request = { projectId, systemPrompt: 'system', prompt: 'ordered packet A then B', outputSchema: { type: 'object' } } as StaticModelRequest;
    const authority: CandidateSupportAuthority = { kind: 'requirement', id: 'req-1', title: 'Requirement', statement: 'must authorize',
      version: 'v1', secondaryVersion: null, reviewedVersionId: null, reviewedContentHash: null };
    const base = { request, providerFingerprint: 'f'.repeat(64), ownerId, lineageRootId: originReviewId, policyVersion: sample.record.policyVersion,
      batchId: sample.batch.id, artifacts: [sample.artifact], authorities: [authority] };
    const identity = batchRequestIdentity(base);
    const variants = [
      batchRequestIdentity({ ...base, providerFingerprint: 'e'.repeat(64) }),
      batchRequestIdentity({ ...base, lineageRootId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
      batchRequestIdentity({ ...base, policyVersion: 'review-policy-next' }),
      batchRequestIdentity({ ...base, batchId: `${sample.batch.id}-next` }),
      batchRequestIdentity({ ...base, request: { ...request, systemPrompt: 'system next' } }),
      batchRequestIdentity({ ...base, request: { ...request, prompt: 'ordered packet B then A' } }),
      batchRequestIdentity({ ...base, request: { ...request, outputSchema: { type: 'array' } } }),
      batchRequestIdentity({ ...base, artifacts: [{ ...sample.artifact, contentHash: 'd'.repeat(64) }] }),
      batchRequestIdentity({ ...base, authorities: [{ ...authority, version: 'v2' }] }),
    ];
    expect(new Set([identity, ...variants]).size).toBe(variants.length + 1);
  });

  it('rejects records from non-ancestor Reviews and mismatched request/provider identities', () => {
    const sample = fixture();
    expect(() => validateCachedBatch({ ...sample.record, originReviewId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, sample.options)).toThrow('Cache identity');
    expect(() => validateCachedBatch({ ...sample.record, requestHash: 'b'.repeat(64) }, sample.options)).toThrow('Cache identity');
    expect(() => validateCachedBatch({ ...sample.record, providerFingerprint: 'e'.repeat(64) }, sample.options)).toThrow('Cache identity');
  });
});
