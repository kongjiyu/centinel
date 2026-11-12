import { ChevronUp, Loader } from 'lucide-react';
import type { ActiveReviewSnapshot } from '../context/ActiveReviewContext';
import { reviewToastStages } from './reviewToastStages';

export function ReviewToastCollapsed({ snapshot, onClick }: {
  snapshot: ActiveReviewSnapshot;
  onClick: () => void;
}) {
  const stages = reviewToastStages(snapshot.progress);
  const stageIndex = stages.findIndex(stage => stage.status === 'active');
  const active = stages[stageIndex];
  const latestActivity = active && active.thoughts.length > 0 ? active.thoughts[active.thoughts.length - 1] : '';

  return (
    <button type="button" className="review-toast-collapsed" onClick={onClick} aria-expanded="false" aria-label={`Open review progress for ${snapshot.name}`}>
      <span className="review-toast-header">
        <Loader size={16} className="review-toast-spin" aria-hidden="true" />
        <span className="review-toast-title">{snapshot.name}</span>
        <ChevronUp size={16} className="review-toast-chevron" aria-hidden="true" />
      </span>
      <span className="review-toast-progress" aria-hidden="true">
        {stages.map(stage => <span key={stage.id} className={`review-toast-segment stage-${stage.status}`} title={stage.label} />)}
      </span>
      <span className="review-toast-current">
        <span className="review-toast-step">
          {active ? `Step ${stageIndex + 1} of ${stages.length} · ${active.label}` : snapshot.status === 'queued' ? 'Queued' : 'Waiting for progress'}
        </span>
        {latestActivity && <span className="review-toast-activity">{latestActivity}</span>}
      </span>
    </button>
  );
}
