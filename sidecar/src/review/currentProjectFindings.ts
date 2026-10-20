import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoreFinding } from '../store/types.js';
import { SupabaseStaticReviewRepository } from './supabaseRepository.js';
import { reconcileProjectFindings, presentReconciledProjectFindings, type ReconciliationManifest } from './findingReconciliation.js';

/** Shared current issue projection. Callers authorize project membership first.
 * Fail closed for risk/export callers when historical evidence is unavailable. */
export async function loadCurrentProjectFindings(client: SupabaseClient, projectId: string, findings: StoreFinding[]) {
  const repository = new SupabaseStaticReviewRepository(client);
  const reviews = await repository.listReviews(projectId);
  const snapshotCandidates = await Promise.all(reviews.map(async review => ({
    childReviewId: review.id,
    snapshot: await repository.getFindingCorrelationSnapshot(review.id),
  })));
  const snapshots = snapshotCandidates.flatMap(item => {
    const snapshot = item.snapshot;
    if (!snapshot || snapshot.childReviewId !== item.childReviewId
      || !reviews.some(review => review.id === snapshot.parentReviewId)
      || !snapshot.correlations.every(correlation => correlation.childReviewId === item.childReviewId && reviews.some(review => review.id === correlation.parentReviewId))) return [];
    return [{ childReviewId: item.childReviewId, snapshot }];
  });
  const correlations = snapshots.flatMap(item => item.snapshot.correlations);
  const reviewsById = new Map(reviews.map(review => [review.id, review]));
  const relevantReviewIds = new Set<string>();
  for (const correlation of correlations) {
    relevantReviewIds.add(correlation.parentReviewId);
    relevantReviewIds.add(correlation.childReviewId);
  }
  const manifests: ReconciliationManifest[] = [];
  for (const reviewId of relevantReviewIds) {
    const review = reviewsById.get(reviewId);
    if (!review?.sourceManifestId) continue;
    const { data, error } = await client.from('review_source_snapshots').select('*')
      .eq('project_id', projectId).eq('review_session_id', review.id).eq('id', review.sourceManifestId).maybeSingle();
    if (error) throw error;
    if (!data || typeof data !== 'object') continue;
    const row = data as Record<string, unknown>;
    const snapshot = row.snapshot && typeof row.snapshot === 'object' && !Array.isArray(row.snapshot)
      ? row.snapshot as Record<string, unknown>
      : {};
    const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts.flatMap(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const artifact = value as Record<string, unknown>;
      const metadata = artifact.metadata && typeof artifact.metadata === 'object' && !Array.isArray(artifact.metadata)
        ? artifact.metadata as Record<string, unknown>
        : {};
      const id = typeof artifact.id === 'string' ? artifact.id : '';
      const filePath = typeof artifact.path === 'string' ? artifact.path : typeof artifact.filePath === 'string' ? artifact.filePath : '';
      const contentHash = typeof metadata.contentHash === 'string' ? metadata.contentHash : typeof artifact.contentHash === 'string' ? artifact.contentHash : '';
      if (!id || !filePath || !contentHash) return [];
      return [{ id, filePath, originalPath: typeof metadata.originalPath === 'string' ? metadata.originalPath : null, contentHash }];
    }) : [];
    manifests.push({ id: review.sourceManifestId, reviewId: review.id, status: typeof row.status === 'string' ? row.status : 'unavailable', artifacts });
  }
  const reconciled = reconcileProjectFindings({
    findings: findings.map(finding => ({
      id: finding.id,
      projectId: finding.projectId,
      sessionId: finding.reviewSessionId,
      source: finding.source,
      status: finding.status,
      artifactId: finding.artifactId,
      sourceIdentity: typeof finding.location.sourceIdentity === 'string' ? finding.location.sourceIdentity : null,
      sourceVersion: typeof finding.location.sourceVersion === 'string' ? finding.location.sourceVersion : null,
      filePath: typeof finding.location.filePath === 'string' ? finding.location.filePath : '',
      title: finding.title,
      severity: finding.severity,
      createdAt: finding.createdAt,
      updatedAt: finding.updatedAt,
    })),
    reviews,
    manifests,
    correlations,
    snapshotChildReviewIds: snapshots.map(item => item.childReviewId),
    ambiguities: snapshots.flatMap(item => item.snapshot.ambiguities.map(ambiguity => ({
      childReviewId: item.childReviewId, candidateParentFindingIds: ambiguity.candidateParentFindingIds,
    }))),
  });
  return presentReconciledProjectFindings(findings, reconciled);
}
