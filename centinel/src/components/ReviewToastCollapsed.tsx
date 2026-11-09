import { ChevronUp, Loader } from 'lucide-react';
import type { ActiveReviewSnapshot } from '../context/ActiveReviewContext';
import { REVIEW_TOAST_STAGES, reviewToastStageIndex, reviewToastStageLabel } from './reviewToastStages';

export function ReviewToastCollapsed({ snapshot, onClick }: {
  snapshot: ActiveReviewSnapshot;
  onClick: () => void;
}) {
  const active = snapshot.progress.stages.find(s => s.status === 'active');
  const currentStageId = active?.id ?? snapshot.progress.currentStage;
  const stageIndex = reviewToastStageIndex(currentStageId);
  const latestActivity = active && active.thoughts.length > 0 ? active.thoughts[active.thoughts.length - 1] : '';

  return (
    <button type="button" className="review-toast-collapsed" onClick={onClick} aria-expanded="false" aria-label={`Open review progress for ${snapshot.name}`}>
      <span className="review-toast-header">
        <Loader size={16} className="review-toast-spin" aria-hidden="true" />
        <span className="review-toast-title">{snapshot.name}</span>
        <ChevronUp size={16} className="review-toast-chevron" aria-hidden="true" />
      </span>
      <span className="review-toast-progress" aria-hidden="true">
        {REVIEW_TOAST_STAGES.map(s => {
          const stage = snapshot.progress.stages.find(x => x.id === s);
          const status = stage?.status ?? (s === currentStageId ? 'active' : 'pending');
          return <span key={s} className={`review-toast-segment stage-${status}`} title={reviewToastStageLabel(s)} />;
        })}
      </span>
      <span className="review-toast-current">
        <span className="review-toast-step">
          {stageIndex >= 0 ? `Step ${stageIndex + 1} of ${REVIEW_TOAST_STAGES.length} · ` : ''}{reviewToastStageLabel(currentStageId)}
        </span>
        {latestActivity && <span className="review-toast-activity">{latestActivity}</span>}
      </span>
    </button>
  );
}
