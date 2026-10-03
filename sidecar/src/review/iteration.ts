import crypto from 'node:crypto';
import type { StaticReviewRepository, StaticReviewRecord, ReviewIterationSourceChoice, StaticReviewIteration } from './types.js';

export type PrepareReviewIterationInput = {
  reviewId: string;
  /** Must be chosen explicitly so source reuse/refresh is auditable. */
  sourceChoice: ReviewIterationSourceChoice;
  actorId: string;
  /** Must match the stored decision feedback when the latter is non-empty. */
  feedback?: string;
  idempotencyKey?: string;
};

export type StartPreparedIterationInput = {
  reviewId: string;
  idempotencyKey?: string;
  /** Optional frozen artifacts supplied by an adapter after explicit refresh. */
  artifacts?: import('../artifacts.js').Artifact[];
};

export type PrepareReviewIterationOptions = {
  now?: () => Date;
  idGenerator?: () => string;
};

function keyFor(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Create a prepared child from the latest persisted Request Changes decision.
 * This method only writes immutable lineage/preparation state; it never starts
 * deterministic analysis or a Model Provider call.
 */
export async function prepareReviewIteration(
  repository: StaticReviewRepository,
  input: PrepareReviewIterationInput,
  options: PrepareReviewIterationOptions = {},
): Promise<StaticReviewRecord> {
  const parent = await repository.getReview(input.reviewId);
  if (!parent) throw new Error('Review not found');
  if (!input.actorId.trim()) throw new Error('The authenticated reviewer identity is required to prepare a child Review');
  if (!['pending_approval', 'completed', 'changes_requested'].includes(parent.status)) {
    throw new Error(`Review cannot be revised from status ${parent.status}`);
  }
  if (input.sourceChoice !== 'reuse' && input.sourceChoice !== 'refresh') {
    throw new Error('Choose whether the child Review should reuse or refresh its source manifest');
  }
  const decision = await repository.getLatestDecision?.(parent.id);
  if (!decision) throw new Error('The latest Request Changes decision could not be verified');
  if (decision.decision !== 'changes_requested') throw new Error('A child Review can only be prepared from the latest Request Changes decision');
  const decisionFeedback = decision.comment.trim();
  const suppliedFeedback = input.feedback?.trim() ?? '';
  if (suppliedFeedback && decisionFeedback && suppliedFeedback !== decisionFeedback) {
    throw new Error('Prepared feedback must match the persisted Request Changes comment');
  }
  const feedback = decisionFeedback || suppliedFeedback;
  if (!feedback) throw new Error('Request Changes feedback is required to prepare a child Review');
  if (input.sourceChoice === 'reuse' && !parent.sourceManifestId) {
    throw new Error('The parent Review has no frozen source manifest to reuse');
  }
  const idempotencyKey = input.idempotencyKey?.trim() || keyFor({
    operation: 'prepare_iteration', parentReviewId: parent.id, decisionId: decision.id,
    sourceChoice: input.sourceChoice, feedback,
  });
  const existingOperation = await repository.findOperation?.('prepare_iteration', idempotencyKey, parent.projectId);
  if (existingOperation) {
    const existing = await repository.getReview(existingOperation.reviewId);
    if (existing) return existing;
  }
  const existingReview = await repository.findReviewByIdempotencyKey?.(parent.projectId, idempotencyKey);
  if (existingReview) {
    const metadata = existingReview.iteration;
    if (metadata) await repository.saveReviewIteration?.(existingReview.id, parent.projectId, metadata);
    await repository.saveOperation?.({ operation: 'prepare_iteration', idempotencyKey, projectId: parent.projectId, reviewId: existingReview.id, createdAt: existingReview.createdAt });
    return existingReview;
  }

  const now = (options.now ?? (() => new Date()))().toISOString();
  const id = (options.idGenerator ?? (() => crypto.randomUUID()))();
  const iteration: StaticReviewIteration = {
    parentReviewId: parent.id,
    decisionId: decision.id,
    feedback,
    reviewer: decision.reviewer,
    createdBy: input.actorId,
    sourceChoice: input.sourceChoice,
    sourceManifestId: input.sourceChoice === 'reuse' ? parent.sourceManifestId : null,
    preparedAt: now,
  };
  const child = await repository.createReview({
    id,
    projectId: parent.projectId,
    name: `${parent.name} (Revision)`,
    reviewType: parent.reviewType,
    status: 'prepared',
    idempotencyKey,
    scope: structuredClone(parent.scope),
    config: structuredClone(parent.config),
    lineage: {
      parentReviewId: parent.id,
      lineageRootId: parent.lineage.lineageRootId,
      reusedSourceManifest: input.sourceChoice === 'reuse',
    },
    sourceManifestId: iteration.sourceManifestId,
    iteration,
    createdAt: now,
    updatedAt: now,
  });
  await repository.saveReviewIteration?.(child.id, child.projectId, iteration);
  await repository.saveOperation?.({ operation: 'prepare_iteration', idempotencyKey, projectId: parent.projectId, reviewId: child.id, createdAt: now });
  return child;
}

/** Guard the explicit start action; a prepared child cannot run implicitly. */
export function assertPreparedIteration(review: StaticReviewRecord): void {
  if (review.status !== 'prepared') throw new Error(`Review is not awaiting explicit start (status ${review.status})`);
  if (!review.iteration || !review.lineage.parentReviewId) throw new Error('Prepared Review is missing its immutable iteration lineage');
}
