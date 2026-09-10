import type { ReviewProgress } from '../types';
import { normalizeReviewStages, truncateReviewSourceName } from '../reviewViewModel';

type Props = {
  progress: ReviewProgress | null;
};

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
  const activeStage = stages.find(stage => stage.status === 'active');
  const liveText = activeStage
    ? `${activeStage.label}: ${activeStage.summary || 'In progress.'}`
    : undefined;

  return (
    <div className="review-progress" aria-label="Review activity stages">
      {liveText && <p className="review-activity-live" aria-live="polite">{liveText}</p>}
      <ol className="review-activity-timeline" aria-label="Review stages">
        {stages.map((stage, index) => {
          const activity = stage.details.activity.filter(item => !/fetch failed|request failed|http\s*[45]\d\d|authentication_error|rate_limit_error/i.test(item));
          return (
            <li key={`${stage.id}-${index}`} className={`stage stage-${stage.status}`}>
              <h3 className="stage-label">{stage.label}</h3>
              {activity.map((item, itemIndex) => <p className="review-reasoning" key={`${item}-${itemIndex}`}>{item}</p>)}
              {stage.details.evidence.length > 0 && (
                <div className="review-source-tags" role="group" aria-label={`Sources for ${stage.label}`}>
                  {stage.details.evidence.map(source => <span className="review-source-tag" key={source} title={source} aria-label={source}>{truncateReviewSourceName(source)}</span>)}
                </div>
              )}
              {stage.details.assessment && <p className="review-reasoning">{stage.details.assessment}</p>}
              {stage.details.outcome && <p className="review-reasoning">{stage.details.outcome}</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
