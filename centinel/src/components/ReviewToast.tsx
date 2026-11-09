import { X } from 'lucide-react';
import { useActiveReviewState } from '../context/ActiveReviewContext';
import { ReviewToastCollapsed } from './ReviewToastCollapsed';
import { ReviewToastExpanded } from './ReviewToastExpanded';
import { ReviewToastComplete } from './ReviewToastComplete';
import { REVIEW_TOAST_STAGES, reviewToastStageIndex, reviewToastStageLabel } from './reviewToastStages';
import './ReviewToast.css';

export function ReviewToast() {
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
  const activeStage = session.progress.stages.find(stage => stage.status === 'active')?.id ?? session.progress.currentStage;
  const stageIndex = reviewToastStageIndex(activeStage);
  // Announce stage changes only, never each streamed activity line. Terminal
  // states announce through their own status message.
  const announcement = isTerminal
    ? ''
    : `${session.name}: ${reviewToastStageLabel(activeStage)}${stageIndex >= 0 ? `, step ${stageIndex + 1} of ${REVIEW_TOAST_STAGES.length}` : ''}`;

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
      <p className="review-toast-live" role="status">{announcement}</p>
    </section>
  );
}
