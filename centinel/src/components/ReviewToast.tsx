import { X } from 'lucide-react';
import { useActiveReviewState } from '../context/ActiveReviewContext';
import { ReviewToastCollapsed } from './ReviewToastCollapsed';
import { ReviewToastExpanded } from './ReviewToastExpanded';
import { ReviewToastComplete } from './ReviewToastComplete';
import { reviewToastStages } from './reviewToastStages';
import './ReviewToast.css';

export function ReviewToast({ onOpenReview }: { onOpenReview?: (projectId: string, sessionId: string, reviewName: string) => void }) {
  const { state, controls } = useActiveReviewState();
  if (!state) return null;
  if (state.dismissed) return null;
  if (state.connectionLost) {
    return (
      <section className="review-toast review-toast-connection-lost" aria-label="Review progress">
        <p role="status">Connection lost. Review progress is not updating.</p>
        <button type="button" className="btn-secondary" onClick={controls.retry}>Retry</button>
      </section>
    );
  }

  const { session, expanded } = state;
  const isTerminal = session.status === 'success' || session.status === 'pending_approval' || session.status === 'failure' || session.status === 'failed' || session.status === 'blocked' || session.status === 'cancelled';
  const stages = reviewToastStages(session.progress);
  const stageIndex = stages.findIndex(stage => stage.status === 'active');
  // Announce stage changes only, never each streamed activity line. Terminal
  // states announce through their own status message.
  const announcement = !isTerminal && stageIndex >= 0
    ? `${session.name}: ${stages[stageIndex].label}, step ${stageIndex + 1} of ${stages.length}`
    : '';

  return (
    <section className={`review-toast ${expanded ? 'expanded' : 'collapsed'} status-${session.status}`} aria-label="Review progress">
      <button
        type="button"
        className="review-toast-close"
        onClick={(e) => { e.stopPropagation(); controls.setDismissed(true); }}
        aria-label="Dismiss"
        title="Dismiss"
      >
        <X size={16} aria-hidden="true" />
      </button>

      {isTerminal ? (
        <ReviewToastComplete snapshot={session} />
      ) : expanded ? (
        <ReviewToastExpanded snapshot={session} onCancel={() => controls.setExpanded(false)} />
      ) : (
        <ReviewToastCollapsed snapshot={session} onClick={() => controls.setExpanded(true)} />
      )}
      {onOpenReview && <button type="button" className="btn-link review-toast-open" onClick={() => onOpenReview(session.projectId, session.id, session.name)}>Open review</button>}
      <p className="review-toast-live" role="status">{announcement}</p>
    </section>
  );
}
