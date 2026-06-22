import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { ActiveReviewSnapshot } from '../context/ActiveReviewContext';

function countBySeverity(findings: ActiveReviewSnapshot['findings']) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    const s = f.severity.toLowerCase();
    if (s in counts) counts[s as keyof typeof counts]++;
  }
  return counts;
}

export function ReviewToastComplete({ snapshot }: { snapshot: ActiveReviewSnapshot }) {
  if (snapshot.status === 'failure') {
    return (
      <div className="review-toast-complete review-toast-failure">
        <XCircle size={14} />
        <span>Review failed — {snapshot.failureReason || 'Unknown error'}</span>
      </div>
    );
  }
  if (snapshot.status === 'cancelled') {
    return (
      <div className="review-toast-complete review-toast-cancelled">
        <span>Review cancelled</span>
      </div>
    );
  }
  const counts = countBySeverity(snapshot.findings);
  return (
    <div className="review-toast-complete">
      <div className="review-toast-header">
        <CheckCircle2 size={14} className="success" />
        <span className="review-toast-title">{snapshot.name}</span>
      </div>
      <div className="review-toast-severity-counts">
        <span className="severity-count critical"><AlertTriangle size={12} /> {counts.critical} critical</span>
        <span className="severity-count high">{counts.high} high</span>
        <span className="severity-count medium">{counts.medium} medium</span>
        <span className="severity-count low">{counts.low} low</span>
      </div>
    </div>
  );
}
