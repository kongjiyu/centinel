import type { Artifact, ReviewSourceManifest, StaticSession } from './types';

export type ReviewSourceCurrencyStatus = 'changed' | 'added' | 'current' | 'unverified';

export type ReviewSourceCurrencyAssessment = {
  status: ReviewSourceCurrencyStatus;
  changedCount: number;
  addedCount: number;
  fullyVerified: boolean;
};

function reviewTimestamp(review: StaticSession): number {
  const completedAt = Date.parse(review.completedAt ?? '');
  if (Number.isFinite(completedAt)) return completedAt;
  try {
    const progress = JSON.parse(review.progressJson) as { completedAt?: unknown };
    if (typeof progress.completedAt === 'string') {
      const progressCompletedAt = Date.parse(progress.completedAt);
      if (Number.isFinite(progressCompletedAt)) return progressCompletedAt;
    }
  } catch { /* Older rows may not have structured progress. */ }
  const createdAt = Date.parse(review.createdAt);
  return Number.isFinite(createdAt) ? createdAt : Number.NEGATIVE_INFINITY;
}

const EXECUTED_REVIEW_STATUSES = new Set<StaticSession['status']>([
  'success', 'pending_approval', 'completed', 'approved', 'changes_requested',
]);

/** Returns the latest completed Review execution, independent of later human decisions. */
export function latestSuccessfulReview(sessions: StaticSession[]): StaticSession | null {
  return sessions
    .filter(session => EXECUTED_REVIEW_STATUSES.has(session.status)
      && session.modelStatus !== 'partial'
      && session.modelStatus !== 'failed'
      && session.modelStatus !== 'cancelled')
    .sort((left, right) => reviewTimestamp(right) - reviewTimestamp(left) || right.id.localeCompare(left.id))[0] ?? null;
}

/**
 * Compares only artifact versions named by the saved Review manifest. Extra
 * current artifacts may be outside the Review's scope, so they cannot make a
 * scoped Review appear stale.
 */
export function assessReviewSourceCurrency(
  review: Pick<StaticSession, 'id' | 'projectId'>,
  manifest: ReviewSourceManifest | null,
  currentArtifacts: Artifact[] | null,
): ReviewSourceCurrencyAssessment {
  if (!manifest || !currentArtifacts || manifest.sessionId !== review.id || manifest.projectId !== review.projectId || manifest.status === 'unavailable') {
    return { status: 'unverified', changedCount: 0, addedCount: 0, fullyVerified: false };
  }

  if (currentArtifacts.some(artifact => artifact.projectId !== review.projectId)) {
    return { status: 'unverified', changedCount: 0, addedCount: 0, fullyVerified: false };
  }

  const currentById = new Map<string, Artifact>();
  currentArtifacts.forEach(artifact => {
    if (!currentById.has(artifact.id)) currentById.set(artifact.id, artifact);
  });

  const frozenById = new Map<string, string>();
  let fullyVerified = manifest.status === 'available';
  const capturedAt = Date.parse(manifest.capturedAt ?? '');
  if (!Number.isFinite(capturedAt)) fullyVerified = false;
  const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
  if (sources.length === 0) fullyVerified = false;

  for (const source of sources) {
    const ids = Array.isArray(source.artifactIds) ? source.artifactIds : [];
    const hashes = Array.isArray(source.contentHashes) ? source.contentHashes : [];
    if (ids.length === 0 || hashes.length !== ids.length) fullyVerified = false;

    for (let index = 0; index < ids.length; index += 1) {
      const artifactId = typeof ids[index] === 'string' ? ids[index].trim() : '';
      const contentHash = typeof hashes[index] === 'string' ? hashes[index].trim() : '';
      if (!artifactId || !contentHash) {
        fullyVerified = false;
        continue;
      }
      const existingHash = frozenById.get(artifactId);
      if (existingHash && existingHash !== contentHash) fullyVerified = false;
      else frozenById.set(artifactId, contentHash);
    }
  }

  if (manifest.artifactCount == null || !Number.isFinite(manifest.artifactCount) || manifest.artifactCount !== frozenById.size) {
    fullyVerified = false;
  }

  let changedCount = 0;
  for (const [artifactId, frozenHash] of frozenById) {
    const current = currentById.get(artifactId);
    if (!current) {
      changedCount += 1;
      continue;
    }
    const currentHash = typeof current.contentHash === 'string' ? current.contentHash.trim() : '';
    if (!currentHash) {
      fullyVerified = false;
      continue;
    }
    if (currentHash !== frozenHash) changedCount += 1;
  }

  let addedCount = 0;
  for (const artifact of currentArtifacts) {
    if (frozenById.has(artifact.id)) continue;
    const createdAt = Date.parse(artifact.createdAt);
    if (!Number.isFinite(createdAt)) {
      fullyVerified = false;
      continue;
    }
    if (Number.isFinite(capturedAt) && createdAt > capturedAt) {
      addedCount += 1;
      if (typeof artifact.contentHash !== 'string' || !artifact.contentHash.trim()) fullyVerified = false;
    }
  }

  return {
    status: changedCount > 0 ? 'changed' : addedCount > 0 ? 'added' : fullyVerified ? 'current' : 'unverified',
    changedCount,
    addedCount,
    fullyVerified,
  };
}
