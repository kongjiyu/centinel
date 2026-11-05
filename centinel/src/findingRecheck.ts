import type { Finding, StaticSession } from './types';

/**
 * How a finding is re-checked against the current sources. Both paths reuse
 * existing linked-Review contracts; the finding's state afterwards comes from
 * project reconciliation (`effectiveFindingStatus`), never from this button.
 *
 * - `retry`: the producing Review stopped (failed/blocked/cancelled), so the
 *   linked updated-source retry is available
 *   (`POST /static-sessions/:id/retry` with `refreshSourceManifest`).
 * - `compare`: the producing Review completed. The service only retries stopped
 *   Reviews, so a completed one is re-checked by starting a Review of the
 *   updated sources with it as the comparison parent (Review entry, preselected).
 * - `open`: the Review is still queued or running; show it instead.
 */
export type FindingRecheckPlan =
  | { kind: 'retry'; review: StaticSession }
  | { kind: 'compare'; review: StaticSession }
  | { kind: 'open'; review: StaticSession };

const RETRYABLE = new Set<StaticSession['status']>(['failure', 'failed', 'blocked', 'cancelled']);
const COMPARABLE = new Set<StaticSession['status']>(['success', 'pending_approval', 'completed', 'approved', 'changes_requested']);
const ACTIVE = new Set<StaticSession['status']>(['prepared', 'queued', 'running']);

/** The Review that produced this finding's latest evidence. Review findings only. */
export function findingReviewId(finding: Finding): string | null {
  if (finding.source !== 'static' || finding.verifier === 'readiness') return null;
  return finding.latestOccurrence?.reviewId || finding.sessionId || null;
}

export function findingRecheckPlan(finding: Finding, reviews: StaticSession[]): FindingRecheckPlan | null {
  const reviewId = findingReviewId(finding);
  const review = reviewId ? reviews.find(item => item.id === reviewId && item.projectId === finding.projectId) : undefined;
  if (!review) return null;
  if (RETRYABLE.has(review.status)) return { kind: 'retry', review };
  if (COMPARABLE.has(review.status)) return { kind: 'compare', review };
  if (ACTIVE.has(review.status)) return { kind: 'open', review };
  return null;
}

export function createRecheckIdempotencyKey(reviewId: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `recheck-${reviewId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
