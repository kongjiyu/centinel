import crypto from 'node:crypto';
import type { Artifact } from '../artifacts.js';
import { correlateReviewFindings, type FindingCorrelationSnapshot, type FindingResolutionContext } from './correlation.js';
import { reconcileProjectFindings, type ReconciliationManifest } from './findingReconciliation.js';
import type { PersistedReviewFinding, StaticReviewRecord } from './types.js';

const EXECUTED = new Set(['pending_approval', 'completed', 'approved', 'changes_requested']);

/** Reconcile against the project's existing issue registry, not just an
 * iteration parent. Per-review occurrences remain immutable evidence. */
export function correlateProjectReview(input: {
  review: StaticReviewRecord;
  modelStatus: StaticReviewRecord['modelStatus'];
  sourceManifestId: string | null;
  current: PersistedReviewFinding[];
  reviews: StaticReviewRecord[];
  previous: PersistedReviewFinding[];
  snapshots: FindingCorrelationSnapshot[];
  manifests: Map<string, Artifact[] | null>;
  evaluated: Array<{ artifact: Artifact; readable: boolean }>;
  modelPolicyVersion: string;
  assessmentValidation?: FindingResolutionContext['assessmentValidation'];
}): FindingCorrelationSnapshot | null {
  const { review } = input;
  const explicitParentId = review.iteration?.parentReviewId ?? review.lineage.parentReviewId;
  const priors = input.reviews.filter(item => item.id !== review.id && item.projectId === review.projectId
    && EXECUTED.has(item.status) && (item.modelStatus === 'succeeded' && item.progress?.stage === 'complete' || item.id === explicitParentId)
    && (item.id === explicitParentId || Number.isFinite(Date.parse(item.createdAt)) && Date.parse(item.createdAt) <= Date.parse(review.createdAt)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  if (!priors.length) return null;
  const reviewsById = new Map(priors.map(item => [item.id, item]));
  const primary = reviewsById.get(review.iteration?.parentReviewId ?? review.lineage.parentReviewId ?? '') ?? priors[0];
  const previous = input.previous.filter(finding => finding.projectId === review.projectId && reviewsById.has(finding.reviewId)).map(finding => {
    const baseline = reviewsById.get(finding.reviewId)!;
    const artifact = baseline.sourceManifestId ? input.manifests.get(baseline.sourceManifestId)?.find(item => item.id === finding.artifactId) : undefined;
    return { ...finding, sourceIdentity: finding.sourceIdentity ?? artifact?.originalPath ?? artifact?.filePath,
      sourceVersion: finding.sourceVersion ?? artifact?.contentHash };
  });
  const previousById = new Map(previous.map(item => [item.id, item]));
  const snapshots = input.snapshots.filter(snapshot => reviewsById.has(snapshot.childReviewId)
    && reviewsById.has(snapshot.parentReviewId)
    && snapshot.correlations.every(item => item.childReviewId === snapshot.childReviewId && reviewsById.has(item.parentReviewId)));
  const manifests: ReconciliationManifest[] = priors.flatMap(item => {
    const artifacts = item.sourceManifestId ? input.manifests.get(item.sourceManifestId) : null;
    return item.sourceManifestId && artifacts ? [{ id: item.sourceManifestId, reviewId: item.id, status: 'available', artifacts }] : [];
  });
  const registry = reconcileProjectFindings({
    findings: previous.map(finding => ({ ...finding, source: 'static' as const, sessionId: finding.reviewId, status: 'new' as const, artifactId: finding.artifactId ?? null })),
    reviews: priors, manifests, correlations: snapshots.flatMap(item => item.correlations),
    snapshotChildReviewIds: snapshots.map(item => item.childReviewId),
    ambiguities: snapshots.flatMap(item => item.ambiguities.map(ambiguity => ({ childReviewId: item.childReviewId, candidateParentFindingIds: ambiguity.candidateParentFindingIds }))),
  });
  const representatives = registry.map(item => previousById.get(item.latestOccurrence?.findingId ?? item.id)!).filter(Boolean);
  const formerlyResolved = new Set(registry.filter(item => item.resolutionEvidence).map(item => item.latestOccurrence?.findingId ?? item.id));
  const snapshot = correlateReviewFindings({ parentReviewId: primary.id, childReviewId: review.id,
    previous: representatives, current: input.current.filter(item => item.projectId === review.projectId && item.reviewId === review.id) });
  const uncertain = new Set(snapshot.ambiguities.flatMap(item => item.candidateParentFindingIds));
  const source = (artifact: Artifact) => ({ artifactId: artifact.id, sourceIdentity: artifact.originalPath ?? artifact.filePath,
    filePath: artifact.filePath, sourceVersion: artifact.contentHash });
  snapshot.correlations = snapshot.correlations.map(item => {
    const old = item.parentFindingId ? previousById.get(item.parentFindingId) : undefined;
    const parent = old ? reviewsById.get(old.reviewId)! : primary;
    let result = item;
    if (old && item.classification === 'carried_over' && !uncertain.has(old.id)) {
      const context: FindingResolutionContext | undefined = parent.modelStatus === 'succeeded' && parent.progress?.stage === 'complete'
        && parent.config.modelPolicyVersion === input.modelPolicyVersion
        && review.config.modelPolicyVersion === input.modelPolicyVersion ? {
          assessmentValidation: input.assessmentValidation,
          modelStatus: input.modelStatus, parentSourceManifestId: parent.sourceManifestId, sourceManifestId: input.sourceManifestId,
          allSourcesReadable: input.evaluated.length > 0 && input.evaluated.every(item => item.readable),
          parentSourceArtifacts: (parent.sourceManifestId ? input.manifests.get(parent.sourceManifestId) ?? [] : []).map(source),
          childSourceArtifacts: input.evaluated.map(item => source(item.artifact)),
          parentReviewType: parent.reviewType, childReviewType: review.reviewType,
          parentScope: parent.scope, childScope: review.scope, parentConfig: parent.config, childConfig: review.config,
          parentIterationFeedback: parent.iteration?.feedback ?? '', childIterationFeedback: review.iteration?.feedback ?? '',
        } : undefined;
      result = correlateReviewFindings({ parentReviewId: parent.id, childReviewId: review.id, previous: [old], current: [],
        evaluatedSources: input.evaluated.filter(item => item.readable).map(item => source(item.artifact)), resolutionContext: context }).correlations[0];
    }
    if (old && result.childFindingId && formerlyResolved.has(old.id)) result = { ...result, classification: 'regressed' };
    return { ...result, parentReviewId: parent.id,
      id: crypto.createHash('sha256').update(JSON.stringify([parent.id, review.id, result.parentFindingId, result.childFindingId, result.classification])).digest('hex') };
  });
  snapshot.counts = { new: 0, recurring: 0, regressed: 0, resolved: 0, carried_over: 0 };
  for (const item of snapshot.correlations) snapshot.counts[item.classification]++;
  return snapshot;
}
