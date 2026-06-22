import { X } from 'lucide-react';
import { useActiveReviewState } from '../context/ActiveReviewContext';
import { ReviewToastCollapsed } from './ReviewToastCollapsed';
import { ReviewToastExpanded } from './ReviewToastExpanded';
import { ReviewToastComplete } from './ReviewToastComplete';

export function ReviewToast() {
  const { state, controls } = useActiveReviewState();
  if (!state) return null;
  if (state.dismissed) return null;
  if (state.connectionLost) {
    return (
      <div className="review-toast review-toast-connection-lost">
        <span>Connection lost</span>
        <button className="btn-secondary" onClick={controls.retry}>Retry</button>
      </div>
    );
  }

  const { session, expanded } = state;
  const isTerminal = session.status === 'success' || session.status === 'failure' || session.status === 'cancelled';

  return (
    <div className={`review-toast ${expanded ? 'expanded' : 'collapsed'} status-${session.status}`}>
      <button
        className="review-toast-close"
        onClick={(e) => { e.stopPropagation(); controls.setDismissed(true); }}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>

      {isTerminal ? (
        <ReviewToastComplete snapshot={session} />
      ) : expanded ? (
        <ReviewToastExpanded snapshot={session} onCancel={() => controls.setExpanded(false)} />
      ) : (
        <ReviewToastCollapsed snapshot={session} onClick={() => controls.setExpanded(true)} />
      )}
    </div>
  );
}
