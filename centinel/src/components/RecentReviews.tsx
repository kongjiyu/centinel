import "./RecentReviews.css";
import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { api } from '../api/client';
import { StatusBadge } from './CommandUI';
import { projectActivityLifecycle, projectActivityLifecycleTone } from '../reviewViewModel';
import type { Screen, StaticSession } from '../types';

const formatted = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/** The project's latest Reviews, so earlier results stay one click away from the start form. */
export function RecentReviews({ projectId, onNavigate, limit = 5 }: { projectId: string; onNavigate: (screen: Screen) => void; limit?: number }) {
  const [reviews, setReviews] = useState<StaticSession[] | null>(null);
  useEffect(() => {
    let current = true;
    setReviews(null);
    Promise.resolve(api.listStaticSessions(projectId, { summary: true }))
      .then(items => { if (current) setReviews(Array.isArray(items) ? [...items].sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt)) : []); })
      .catch(() => { if (current) setReviews([]); });
    return () => { current = false; };
  }, [projectId]);
  if (!reviews?.length) return null;
  return (
    <section className="recent-reviews" aria-labelledby="recent-reviews-heading">
      <h2 id="recent-reviews-heading"><History size={16} aria-hidden="true" /> Recent Reviews in this project</h2>
      <ul>
        {reviews.slice(0, limit).map(review => {
          const state = projectActivityLifecycle(review, 'review');
          return <li key={review.id}>
            <button type="button" className="recent-reviews-link" onClick={() => onNavigate({ name: 'review-activity', projectId, sessionId: review.id, reviewName: review.name })}>
              <span className="recent-reviews-name">{review.name}</span>
              <small>{formatted(review.updatedAt || review.createdAt)}</small>
            </button>
            <StatusBadge label={state} tone={projectActivityLifecycleTone(state)} />
          </li>;
        })}
      </ul>
    </section>
  );
}
