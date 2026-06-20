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
      <div className="review-progress-header">
        {progress.stage !== 'completed' && progress.stage !== 'failed' && <span className="step-spinner" />}
        <span className="review-progress-message">{progress.message}</span>
      </div>
      <div className="review-stepper">
        {progress.steps.map((step, i) => (
          <div key={i} className={`step step-${step.status}`}>
            <div className="step-indicator">
              <StepIcon status={step.status} />
              {i < progress.steps.length - 1 && <div className={`step-line step-line-${step.status}`} />}
            </div>
            <span className="step-label">{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
