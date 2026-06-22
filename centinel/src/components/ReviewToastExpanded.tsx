import { ChevronDown, ChevronRight, Loader } from 'lucide-react';
import type { ActiveReviewSnapshot } from '../context/ActiveReviewContext';
import { api } from '../api/client';

const STAGE_LABELS: Record<string, string> = {
  understanding_context: 'Understanding Context',
  code_review: 'Code Review',
  requirement_validation: 'Requirement Validation',
  summarizing: 'Summarizing',
};

const ALL_STAGES = ['understanding_context', 'code_review', 'requirement_validation', 'summarizing'] as const;

export function ReviewToastExpanded({ snapshot, onCancel }: {
  snapshot: ActiveReviewSnapshot;
  onCancel: () => void;
}) {
  const handleCancel = async () => {
    try { await api.cancelStaticSession(snapshot.projectId, snapshot.id); } catch {}
  };

  return (
    <div className="review-toast-expanded">
      <div className="review-toast-stages">
        {ALL_STAGES.map(stageId => {
          const stage = snapshot.progress.stages.find(s => s.id === stageId);
          const status = stage?.status ?? 'pending';
          const label = STAGE_LABELS[stageId] ?? stageId;
          const Icon = status === 'done' ? ChevronDown : status === 'active' ? Loader : ChevronRight;
          return (
            <div key={stageId} className={`review-toast-stage stage-${status}`}>
              <div className="review-toast-stage-header">
                <Icon size={12} className={status === 'active' ? 'spin' : ''} />
                <span>{label}</span>
                <span className="review-toast-stage-status">({status})</span>
              </div>
              {stage && stage.thoughts.length > 0 && (
                <ul className="review-toast-thoughts">
                  {stage.thoughts.slice(-3).map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {(snapshot.status === 'running' || snapshot.status === 'queued') && (
        <div className="review-toast-actions">
          <button className="btn-secondary" onClick={handleCancel}>Cancel Review</button>
        </div>
      )}
    </div>
  );
}
