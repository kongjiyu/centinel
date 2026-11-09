import { CheckCircle2, ChevronDown, Circle, Loader } from 'lucide-react';
import type { ActiveReviewSnapshot } from '../context/ActiveReviewContext';
import { api } from '../api/client';
import { REVIEW_TOAST_STAGES, reviewToastStageLabel, reviewToastStageStatus } from './reviewToastStages';

export function ReviewToastExpanded({ snapshot, onCancel }: {
  snapshot: ActiveReviewSnapshot;
  /** Collapses the toast back to its one-line summary. */
  onCancel: () => void;
}) {
  const handleCancel = async () => {
    try { await api.cancelStaticSession(snapshot.projectId, snapshot.id); } catch {}
  };

  return (
    <div className="review-toast-expanded">
      <button type="button" className="review-toast-header review-toast-collapse" onClick={onCancel} aria-expanded="true" aria-label={`Hide review progress details for ${snapshot.name}`}>
        <Loader size={16} className="review-toast-spin" aria-hidden="true" />
        <span className="review-toast-title">{snapshot.name}</span>
        <ChevronDown size={16} className="review-toast-chevron" aria-hidden="true" />
      </button>
      <ol className="review-toast-stages">
        {REVIEW_TOAST_STAGES.map(stageId => {
          const stage = snapshot.progress.stages.find(s => s.id === stageId);
          const status = stage?.status ?? 'pending';
          const Icon = status === 'done' ? CheckCircle2 : status === 'active' ? Loader : Circle;
          return (
            <li key={stageId} className={`review-toast-stage stage-${status}`}>
              <div className="review-toast-stage-header">
                <Icon size={16} className={status === 'active' ? 'review-toast-spin' : undefined} aria-hidden="true" />
                <span className="review-toast-stage-label">{reviewToastStageLabel(stageId)}</span>
                <span className="review-toast-stage-status">{reviewToastStageStatus(status)}</span>
              </div>
              {stage && stage.thoughts.length > 0 && (
                <ul className="review-toast-thoughts">
                  {stage.thoughts.slice(-3).map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {(snapshot.status === 'running' || snapshot.status === 'queued') && (
        <div className="review-toast-actions">
          <button type="button" className="btn-secondary" onClick={handleCancel}>Cancel review</button>
        </div>
      )}
    </div>
  );
}
