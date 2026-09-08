import { AlertCircle, Check, ChevronDown, CircleDot } from 'lucide-react';
import type { ReviewProgress } from '../types';
import { formatReviewTimestamp, normalizeReviewStages } from '../reviewViewModel';

type Props = {
  progress: ReviewProgress | null;
};

function StepIcon({ status }: { status: string }) {
  if (status === 'done') return <Check className="step-check" size={14} aria-label="Completed" />;
  if (status === 'failed') return <AlertCircle className="step-failed" size={14} aria-label="Needs attention" />;
  if (status === 'active') return <span className="step-spinner" aria-label="In progress" />;
  return <span className="step-dot-pending" aria-hidden="true" />;
}
function StageStatus({ status }: { status: string }) {
  if (status === 'done') return <span className="activity-stage-status activity-stage-status-done">Completed</span>;
  if (status === 'active') return <span className="activity-stage-status activity-stage-status-active">In progress</span>;
  if (status === 'failed') return <span className="activity-stage-status activity-stage-status-failed">Needs attention</span>;
  return <span className="activity-stage-status">Not started</span>;
}

export function ReviewProgressView({ progress }: Props) {
  if (!progress) {
    return (
      <div className="review-progress" aria-label="Review activity">
        <div className="review-progress-header">
          <span className="step-spinner" aria-hidden="true" />
          <span>Initializing review activity…</span>
        </div>
      </div>
    );
  }

  const stages = normalizeReviewStages(progress);
  const updatedAt = formatReviewTimestamp(progress.updatedAt);
  const activeStage = stages.find(stage => stage.status === 'active');
  const liveText = activeStage
    ? `${activeStage.label}: ${activeStage.summary || 'In progress.'}`
    : undefined;

  return (
    <div className="review-progress" aria-label="Centinel activity timeline">
      {liveText && <p className="review-activity-live" aria-live="polite">{liveText}</p>}
      <ol className="review-activity-timeline">
        {stages.map((stage, index) => {
          const detailsAvailable = stage.details.activity.length > 0
            || stage.details.evidence.length > 0
            || Boolean(stage.details.assessment)
            || Boolean(stage.details.outcome);
          const stageTime = formatReviewTimestamp(stage.updatedAt);
          return (
            <li key={`${stage.id}-${index}`} className={`stage stage-${stage.status}`}>
              <div className="stage-header">
                <div className="step-indicator">
                  <StepIcon status={stage.status} />
                  {index < stages.length - 1 && <div className={`step-line step-line-${stage.status}`} aria-hidden="true" />}
                </div>
                <div className="review-activity-message-heading">
                  <div className="review-activity-message-meta">
                    <span className="activity-actor"><CircleDot size={12} aria-hidden="true" />Centinel</span>
                    {(stageTime || updatedAt) && <time dateTime={stage.updatedAt || progress.updatedAt}>Updated {stageTime || updatedAt}</time>}
                  </div>
                  <div className="review-activity-stage-title">
                    <span className="stage-label">{stage.label}</span>
                    <StageStatus status={stage.status} />
                  </div>
                </div>
              </div>

              {stage.summary && <p className="stage-summary">{stage.summary}</p>}

              {detailsAvailable && (
                <details className="activity-details">
                  <summary><ChevronDown size={14} aria-hidden="true" /><span>View activity details</span></summary>
                  <div className="activity-details-body">
                    {stage.details.activity.length > 0 && (
                      <div className="activity-detail-group">
                        <h4>Activity</h4>
                        <ul>{stage.details.activity.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}</ul>
                      </div>
                    )}
                    {stage.details.evidence.length > 0 && (
                      <div className="activity-detail-group">
                        <h4>Evidence examined</h4>
                        <ul>{stage.details.evidence.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}</ul>
                      </div>
                    )}
                    {stage.details.assessment && <div className="activity-detail-group"><h4>Assessment</h4><p>{stage.details.assessment}</p></div>}
                    {stage.details.outcome && <div className="activity-detail-group"><h4>Outcome</h4><p>{stage.details.outcome}</p></div>}
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
