import { reviewLifecycleState, type ReviewLifecycleState } from './reviewViewModel';
import type { StaticSession } from './types';

/**
 * View model for a project's full Reviews list. Lifecycle labels come from the
 * shared `reviewLifecycleState` mapper so the list agrees with Review detail,
 * including "Completed with gaps". Lineage follows the directory rule: a Review
 * with a later retry or iteration child is superseded by that child.
 */

export type ReviewListFilter =
  | 'all'
  | 'active'
  | 'need_approval'
  | 'gaps'
  | 'completed'
  | 'paused'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export const REVIEW_LIST_FILTERS: Array<{ value: ReviewListFilter; label: string }> = [
  { value: 'all', label: 'All states' },
  { value: 'active', label: 'Queued or in progress' },
  { value: 'need_approval', label: 'Need Approval' },
  { value: 'gaps', label: 'Completed with gaps' },
  { value: 'completed', label: 'Completed' },
  { value: 'paused', label: 'Paused' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function isReviewListFilter(value: unknown): value is ReviewListFilter {
  return typeof value === 'string' && REVIEW_LIST_FILTERS.some(option => option.value === value);
}

export type ReviewLink = { id: string; name: string };

export type ReviewListEntry = {
  review: StaticSession;
  state: ReviewLifecycleState;
  /** Findings saved when the Review finished; null when not available. */
  findingCount: number | null;
  /** The earlier Review this one retried or followed. */
  parent: ReviewLink | null;
  /** The latest later Review that retried or followed this one. */
  supersededBy: ReviewLink | null;
};

export function reviewListFilterFor(state: ReviewLifecycleState): Exclude<ReviewListFilter, 'all'> {
  switch (state) {
    case 'Queued':
    case 'In progress': return 'active';
    case 'Need Approval': return 'need_approval';
    case 'Completed with gaps': return 'gaps';
    case 'Completed': return 'completed';
    case 'Paused': return 'paused';
    case 'Blocked': return 'blocked';
    case 'Failed': return 'failed';
    case 'Cancelled': return 'cancelled';
  }
}

const NOT_FINISHED = new Set(['queued', 'prepared', 'running']);
const STOPPED = new Set(['failed', 'failure', 'cancelled', 'blocked']);

/**
 * Uses the counts the Review recorded at the end of execution. Older services
 * do not send them, and a Review that never finished has no meaningful total.
 */
export function reviewFindingCount(review: StaticSession): number | null {
  const { deterministicFindingCount: deterministic, modelFindingCount: model } = review;
  if (typeof deterministic !== 'number' && typeof model !== 'number') return null;
  if (NOT_FINISHED.has(review.status)) return null;
  const total = (typeof deterministic === 'number' && Number.isFinite(deterministic) ? deterministic : 0)
    + (typeof model === 'number' && Number.isFinite(model) ? model : 0);
  // A stopped Review with nothing saved was not assessed; do not show a clean zero.
  if (total === 0 && STOPPED.has(review.status)) return null;
  return total;
}

function timestamp(review: StaticSession): number {
  const value = Date.parse(review.createdAt || review.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

/** Newest first, with lifecycle state, finding totals and lineage resolved. */
export function buildReviewListEntries(reviews: StaticSession[]): ReviewListEntry[] {
  const byId = new Map(reviews.map(review => [review.id, review]));
  const latestChild = new Map<string, StaticSession>();
  for (const review of reviews) {
    const parentId = review.parentSessionId;
    if (!parentId || parentId === review.id) continue;
    const current = latestChild.get(parentId);
    if (!current || timestamp(review) > timestamp(current)) latestChild.set(parentId, review);
  }
  return [...reviews]
    .sort((a, b) => timestamp(b) - timestamp(a) || b.id.localeCompare(a.id))
    .map(review => {
      const parent = review.parentSessionId && review.parentSessionId !== review.id ? byId.get(review.parentSessionId) : undefined;
      const child = latestChild.get(review.id);
      return {
        review,
        state: reviewLifecycleState(review),
        findingCount: reviewFindingCount(review),
        // A parent outside the loaded list is still named by ID so lineage is not hidden.
        parent: review.parentSessionId && review.parentSessionId !== review.id
          ? { id: review.parentSessionId, name: parent?.name || 'Earlier Review' }
          : null,
        supersededBy: child ? { id: child.id, name: child.name || 'Later Review' } : null,
      };
    });
}

export function filterReviewListEntries(entries: ReviewListEntry[], filter: ReviewListFilter): ReviewListEntry[] {
  if (filter === 'all') return entries;
  return entries.filter(entry => reviewListFilterFor(entry.state) === filter);
}

export function reviewListFilterCounts(entries: ReviewListEntry[]): Record<ReviewListFilter, number> {
  const counts = Object.fromEntries(REVIEW_LIST_FILTERS.map(option => [option.value, 0])) as Record<ReviewListFilter, number>;
  counts.all = entries.length;
  for (const entry of entries) counts[reviewListFilterFor(entry.state)] += 1;
  return counts;
}
