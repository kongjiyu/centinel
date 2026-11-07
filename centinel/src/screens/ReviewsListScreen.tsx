import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileCheck2, Plus, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import { CommandEmptyState, CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Select } from '../components/Select';
import { setVisibleInterval } from '../hooks/usePageVisible';
import {
  REVIEW_LIST_FILTERS,
  buildReviewListEntries,
  filterReviewListEntries,
  isReviewListFilter,
  reviewListFilterCounts,
  type ReviewListFilter,
} from '../reviewList';
import { reviewLifecycleTone } from '../reviewViewModel';
import type { Project, Screen, StaticSession } from '../types';
import { userFacingError } from '../utils/userFacingError';
import './ReviewsListScreen.css';

export const REVIEWS_PAGE_SIZE = 20;
const ACTIVE_POLL_MS = 5000;

function formatCreated(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

type Props = {
  projectId: string;
  projects: Project[];
  initialStatus?: string;
  onNavigate: (screen: Screen) => void;
};

/** Every Review in one project, newest first, with status filter and retry lineage. */
export function ReviewsListScreen({ projectId, projects, initialStatus, onNavigate }: Props) {
  const project = projects.find(item => item.id === projectId) ?? null;
  const [reviews, setReviews] = useState<StaticSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewListFilter>(isReviewListFilter(initialStatus) ? initialStatus : 'all');
  const [visibleCount, setVisibleCount] = useState(REVIEWS_PAGE_SIZE);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const items = await api.listStaticSessions(projectId, { summary: true });
      if (sequence !== requestSequence.current) return;
      setReviews(Array.isArray(items) ? items : []);
      setError(null);
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      setError(userFacingError(cause, 'Reviews could not be loaded. Try again.'));
    }
  }, [projectId]);

  useEffect(() => {
    setReviews(null);
    setError(null);
    setVisibleCount(REVIEWS_PAGE_SIZE);
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  useEffect(() => {
    setFilter(isReviewListFilter(initialStatus) ? initialStatus : 'all');
  }, [initialStatus]);

  const entries = useMemo(() => buildReviewListEntries(reviews ?? []), [reviews]);
  const counts = useMemo(() => reviewListFilterCounts(entries), [entries]);
  const filtered = useMemo(() => filterReviewListEntries(entries, filter), [entries, filter]);
  const shown = filtered.slice(0, visibleCount);
  const hasActive = counts.active > 0;

  // Keep running Reviews current without polling while the window is hidden.
  useEffect(() => {
    if (!hasActive) return undefined;
    return setVisibleInterval(() => { void load(); }, ACTIVE_POLL_MS);
  }, [hasActive, load]);

  const changeFilter = (value: string) => {
    const next = isReviewListFilter(value) ? value : 'all';
    setFilter(next);
    setVisibleCount(REVIEWS_PAGE_SIZE);
    onNavigate({ name: 'reviews', projectId, ...(next === 'all' ? {} : { status: next }) });
  };

  const openReview = (id: string, name?: string) => onNavigate({ name: 'review-activity', projectId, sessionId: id, ...(name ? { reviewName: name } : {}) });
  const startReview = () => onNavigate({ name: 'review-entry', projectId });

  return (
    <div className="screen reviews-list-screen animate-fade-in">
      <CommandPageHeader
        eyebrow={project?.name ?? 'Project'}
        title="Reviews"
        onBack={() => onNavigate({ name: 'project-detail', projectId })}
        actions={<button type="button" className="btn-primary" onClick={startReview}><Plus size={14} aria-hidden="true" /> Start Review</button>}
      />

      {reviews === null && !error && <LoadingSkeleton variant="rows" rows={6} label="Loading Reviews" />}

      {reviews === null && error && (
        <div className="reviews-list-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {reviews !== null && entries.length === 0 && (
        <CommandEmptyState
          icon={FileCheck2}
          title="No Reviews yet"
          description="Reviews you start in this project appear here with their status and findings."
          action={<button type="button" className="btn-primary" onClick={startReview}><Plus size={16} aria-hidden="true" /> Start Review</button>}
        />
      )}

      {reviews !== null && entries.length > 0 && (
        <section className="reviews-list" aria-labelledby="reviews-list-heading">
          <div className="reviews-list-heading">
            <h2 id="reviews-list-heading">All Reviews</h2>
            <span>{counts.all} {counts.all === 1 ? 'Review' : 'Reviews'}</span>
          </div>

          <div className="reviews-list-filters" role="search" aria-label="Review filters">
            <label htmlFor="reviews-list-status">
              <span>Status</span>
              <Select
                id="reviews-list-status"
                value={filter}
                onChange={changeFilter}
                options={REVIEW_LIST_FILTERS.map(option => ({ value: option.value, label: `${option.label} (${counts[option.value]})` }))}
              />
            </label>
            {filter !== 'all' && <button type="button" className="reviews-list-clear" onClick={() => changeFilter('all')}>Clear filter</button>}
          </div>

          {error && (
            <div className="reviews-list-alert" role="status">
              <span>{error}</span>
              <button type="button" onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="reviews-list-message">
              <strong>No Reviews match this status.</strong>
              <span>Choose another status or clear the filter.</span>
            </div>
          ) : (
            <>
              <div className="reviews-list-table-shell">
                <table className="reviews-list-table" aria-label="Reviews">
                  <thead>
                    <tr>
                      <th scope="col">Review</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="reviews-list-numeric">Findings</th>
                      <th scope="col">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(entry => (
                      <tr key={entry.review.id} className={entry.supersededBy ? 'reviews-list-row-superseded' : undefined}>
                        <td>
                          <button type="button" className="reviews-list-name" onClick={() => openReview(entry.review.id, entry.review.name)}>
                            {entry.review.name || 'Untitled Review'}
                          </button>
                          {(entry.parent || entry.supersededBy) && (
                            <div className="reviews-list-lineage">
                              {entry.parent && <span>Follows <button type="button" onClick={() => openReview(entry.parent!.id, entry.parent!.name)}>{entry.parent.name}</button></span>}
                              {entry.supersededBy && <span>Superseded by <button type="button" onClick={() => openReview(entry.supersededBy!.id, entry.supersededBy!.name)}>{entry.supersededBy.name}</button></span>}
                            </div>
                          )}
                        </td>
                        <td><StatusBadge label={entry.state} tone={reviewLifecycleTone(entry.state)} /></td>
                        <td className="reviews-list-numeric">{entry.findingCount === null ? <span aria-label="Not available">—</span> : entry.findingCount}</td>
                        <td><time dateTime={entry.review.createdAt}>{formatCreated(entry.review.createdAt)}</time></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="reviews-list-footer">
                <span aria-live="polite">Showing {shown.length} of {filtered.length}</span>
                {shown.length < filtered.length && (
                  <button type="button" className="btn-secondary" onClick={() => setVisibleCount(count => count + REVIEWS_PAGE_SIZE)}>
                    Show {Math.min(REVIEWS_PAGE_SIZE, filtered.length - shown.length)} more
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
