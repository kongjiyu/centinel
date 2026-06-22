import type { ReviewProgress } from '../types';
import { Check } from 'lucide-react';

type Props = {
  progress: ReviewProgress | null;
};

function StepIcon({ status }: { status: string }) {
  if (status === 'done') return <Check className="step-check" size={12} aria-label="Completed" />;
  if (status === 'active') return <span className="step-spinner" />;
  return <span className="step-dot-pending" />;
}

export function ReviewProgressView({ progress }: Props) {
  if (!progress) {
    return (
      <div className="review-progress">
        <div className="review-progress-header">
          <span className="step-spinner" />
          <span>Initializing review...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="review-progress">
      <div className="review-stepper">
        {progress.stages.map((stage, i) => (
          <div key={stage.id} className={`stage stage-${stage.status}`}>
            <div className="stage-header">
              <div className="step-indicator">
                <StepIcon status={stage.status} />
                {i < progress.stages.length - 1 && <div className={`step-line step-line-${stage.status}`} />}
              </div>
              <span className="stage-label">{stage.label}</span>
              {stage.status === 'done' && stage.summary && (
                <span className="stage-summary">{stage.summary}</span>
              )}
              {stage.status === 'active' && (
                <span className="step-spinner thought-inline-spinner" aria-label="In progress" />
              )}
            </div>

            {/* Latest thought — visible for the active stage AND for any stage that has thoughts persisted */}
            {stage.thoughts.length > 0 && (
              <div className="stage-thoughts">
                <div className="thought-line">
                  <span className="thought-bullet">›</span>
                  <span className="thought-text">{stage.thoughts[stage.thoughts.length - 1]}</span>
                </div>
                {stage.thoughts.length > 1 && stage.status === 'done' && (
                  <details className="thought-history">
                    <summary>{stage.thoughts.length - 1} earlier thought(s)</summary>
                    {stage.thoughts.slice(0, -1).map((t, idx) => (
                      <div className="thought-line" key={idx}>
                        <span className="thought-bullet">›</span>
                        <span className="thought-text">{t}</span>
                      </div>
                    ))}
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
