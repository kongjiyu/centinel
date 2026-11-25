import { DynamicContractError } from '../dynamic/types.js';
import type { LocalWorkspace } from '../store/localWorkspace.js';
import { buildReviewDynamicContext } from './dynamicContextExport.js';

export async function loadLocalReviewDynamicContext(workspace: LocalWorkspace, owner: string, project: string, id: string) {
  const reviews = workspace.reviews(owner);
  const review = await reviews.getReview(id);
  if (!review || review.projectId !== project) throw new DynamicContractError(404, 'Review not found in this project.');
  if (!['pending_approval', 'completed', 'approved', 'changes_requested'].includes(review.status)) {
    throw new DynamicContractError(409, 'Only a Review that finished its analysis can supply test requirements.');
  }
  const [traceability, manifest] = await Promise.all([
    reviews.getTraceabilitySnapshot(id),
    review.sourceManifestId ? reviews.loadSourceManifestArtifacts(review.sourceManifestId) : null,
  ]);
  const frozenSources = manifest?.every(item => item.projectId === project) ? manifest : null;
  const frozenRequirements = traceability?.projectId === project && traceability.status === 'available' ? traceability : null;
  const current = workspace.artifacts(owner, project);
  const decision = reviews.listDecisions(id).find(item => item.decision !== 'commented');
  return buildReviewDynamicContext({
    projectId: project, reviewId: id, reviewName: review.name, approved: review.status === 'approved' || decision?.decision === 'approved',
    snapshotCapturedAt: frozenRequirements?.capturedAt ?? null,
    traceabilityAvailable: Boolean(frozenRequirements), traceability: frozenRequirements?.records ?? [],
    manifestAvailable: Boolean(frozenSources), manifest: (frozenSources ?? []).map(item => ({
      id: item.id, name: item.fileName, path: item.filePath, versionId: item.versionId ?? null, contentHash: item.contentHash,
    })),
    currentHashes: new Map(current.filter(item => item.contentHash).map(item => [item.id, item.contentHash])),
  });
}
