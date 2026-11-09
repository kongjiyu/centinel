import { CheckCircle2, AlertTriangle, CircleSlash, XCircle } from 'lucide-react';
import type { ActiveReviewSnapshot } from '../context/ActiveReviewContext';
import { reviewFailureMessage } from '../utils/userFacingError';

function countBySeverity(findings: ActiveReviewSnapshot['findings']) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    const s = f.severity.toLowerCase();
    if (s in counts) counts[s as keyof typeof counts]++;
  }
  return counts;
}

export function ReviewToastComplete({ snapshot }: { snapshot: ActiveReviewSnapshot }) {
  if (snapshot.status === 'blocked') {
    return (
      <div className="review-toast-complete review-toast-blocked" role="status">
        <div className="review-toast-header">
          <AlertTriangle size={16} aria-hidden="true" />
          <span className="review-toast-title">{snapshot.progress?.stage === 'provider_paused' ? 'Review paused' : 'Review needs attention'}</span>
        </div>
        <p className="review-toast-message">{reviewFailureMessage(snapshot.failureReason)}</p>
      </div>
    );
  }
  if (snapshot.status === 'failure' || snapshot.status === 'failed') {
    return (
      <div className="review-toast-complete review-toast-failure" role="status">
        <div className="review-toast-header">
          <XCircle size={16} aria-hidden="true" />
          <span className="review-toast-title">Review failed</span>
        </div>
        <p className="review-toast-message">{reviewFailureMessage(snapshot.failureReason)}</p>
      </div>
    );
  }
  if (snapshot.status === 'cancelled') {
    return (
      <div className="review-toast-complete review-toast-cancelled" role="status">
        <div className="review-toast-header">
          <CircleSlash size={16} aria-hidden="true" />
          <span className="review-toast-title">Review cancelled</span>
        </div>
        <p className="review-toast-message">{snapshot.name}</p>
      </div>
    );
  }
  const counts = countBySeverity(snapshot.findings);
  return (
    <div className="review-toast-complete review-toast-finished" role="status">
      <div className="review-toast-header">
        <CheckCircle2 size={16} aria-hidden="true" />
        <span className="review-toast-title">{snapshot.name}</span>
      </div>
      <div className="review-toast-severity-counts">
        <span className="severity-count critical">{counts.critical} critical</span>
        <span className="severity-count high">{counts.high} high</span>
        <span className="severity-count medium">{counts.medium} medium</span>
        <span className="severity-count low">{counts.low} low</span>
      </div>
    </div>
  );
}
