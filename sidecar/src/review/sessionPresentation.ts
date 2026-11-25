import type { PersistedReviewFinding, StaticReviewRecord } from './types.js';
import type { StoreFinding } from '../store/types.js';

export function toClientLocalReviewFinding(finding: PersistedReviewFinding,
  disposition?: { status: StoreFinding['status']; updatedAt: string }): StoreFinding & {
    sessionId: string; fromRemarks: boolean; filePath: string; lineNumber: number | null;
  } {
  return {
    ...finding,
    source: 'static',
    sessionId: finding.reviewId,
    reviewSessionId: finding.reviewId,
    dynamicSessionId: null,
    artifactId: finding.artifactId ?? null,
    status: disposition?.status ?? 'new',
    priority: finding.priority ?? null,
    requirementId: finding.requirementId ?? null,
    standardId: finding.standardId ?? null,
    evidenceId: null,
    evidenceText: finding.evidence,
    artifactVersionId: finding.sourceVersion ?? null,
    correlationFingerprint: finding.fingerprint ?? null,
    verifier: finding.source,
    updatedAt: disposition?.updatedAt ?? finding.createdAt,
    fromRemarks: false,
    location: {
      domain: finding.domain ?? null, issueType: finding.issueType ?? null, logicFlow: finding.logicFlow ?? [],
      relatedLocations: finding.relatedLocations ?? [], filePath: finding.filePath, lineNumber: finding.lineNumber,
      ruleId: finding.ruleId ?? null, sourceIdentity: finding.sourceIdentity ?? null,
      sourceVersion: finding.sourceVersion ?? null, sourceLocator: finding.sourceLocator ?? null,
    },
  };
}

export function toClientStaticSession(review: StaticReviewRecord) {
  const config = review.config ?? {};
  const scope = review.scope ?? {};
  return {
    id: review.id,
    projectId: review.projectId,
    name: review.name,
    reviewType: review.reviewType,
    status: review.status,
    configJson: JSON.stringify(config),
    progressJson: JSON.stringify(review.progress ?? {}),
    remarks: typeof config.remarks === 'string' ? config.remarks : '',
    finalSummary: review.summary,
    failureReason: review.failureReason,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    completedAt: review.progress?.stage === 'complete' ? review.progress.updatedAt : null,
    sourceManifestId: review.sourceManifestId ?? null,
    modelStatus: review.modelStatus,
    deterministicFindingCount: review.deterministicFindingCount,
    modelFindingCount: review.modelFindingCount,
    baseRef: typeof config.baseRef === 'string' ? config.baseRef : '',
    headRef: typeof config.headRef === 'string' ? config.headRef : '',
    changedFilesJson: JSON.stringify([]),
    parentSessionId: review.lineage.parentReviewId ?? '',
    reviewDiffJson: '',
    scope,
  };
}
