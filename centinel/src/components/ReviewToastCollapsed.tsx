import { ChevronRight, Loader } from 'lucide-react';
import type { ActiveReviewSnapshot } from '../context/ActiveReviewContext';

const STAGE_LABELS: Record<string, string> = {
  understanding_context: 'Context',
  code_review: 'Code',
  requirement_validation: 'Req',
  summarizing: 'Summary',
};

function stageLabel(stageId: string): string {
  return STAGE_LABELS[stageId] ?? stageId;
}

export function ReviewToastCollapsed({ snapshot, onClick }: {
  snapshot: ActiveReviewSnapshot;
  onClick: () => void;
}) {
  const stages = ['understanding_context', 'code_review', 'requirement_validation', 'summarizing'] as const;
  const active = snapshot.progress.stages.find(s => s.status === 'active');
  const currentStageId = active?.id ?? snapshot.progress.currentStage;

  return (
    <div className="review-toast-collapsed" onClick={onClick} role="button" tabIndex={0}>
      <div className="review-toast-header">
        <Loader size={14} className="spin" />
        <span className="review-toast-title">{snapshot.name}</span>
        <span className="review-toast-review-type">{snapshot.reviewType.replace(/_/g, ' ')}</span>
        <ChevronRight size={14} />
      </div>
      <div className="review-toast-progress">
        {stages.map(s => {
          const stage = snapshot.progress.stages.find(x => x.id === s);
          const status = stage?.status ?? (s === currentStageId ? 'active' : 'pending');
          return <span key={s} className={`stage-dot stage-${status}`} title={stageLabel(s)} />;
        })}
      </div>
      <div className="review-toast-current">
        {stageLabel(currentStageId)}
        {active && active.thoughts.length > 0 ? ` · ${active.thoughts[active.thoughts.length - 1]}` : '…'}
      </div>
    </div>
  );
}
