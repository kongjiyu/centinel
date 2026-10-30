import './LoadingSkeleton.css';

export type LoadingSkeletonProps = {
  variant?: 'panel' | 'rows';
  rows?: number;
  label: string;
  className?: string;
};

/** Accessible, data-free placeholder used while a panel's first read is pending. */
export function LoadingSkeleton({ variant = 'panel', rows = 3, label, className = '' }: LoadingSkeletonProps) {
  const safeRows = Math.max(1, Math.min(12, Math.floor(rows)));
  const classes = ['loading-skeleton', `loading-skeleton-${variant}`, className].filter(Boolean).join(' ');

  return (
    <div className={classes} role="status" aria-label={label} aria-busy="true">
      <span className="loading-skeleton-label">{label}</span>
      <div className="loading-skeleton-visual" aria-hidden="true">
        {variant === 'rows'
          ? Array.from({ length: safeRows }, (_, index) => (
            <div className="loading-skeleton-row" key={index}>
              <span className="loading-skeleton-bar loading-skeleton-row-primary" />
              <span className="loading-skeleton-bar loading-skeleton-row-secondary" />
              <span className="loading-skeleton-bar loading-skeleton-row-tertiary" />
            </div>
          ))
          : <>
            <div className="loading-skeleton-panel-heading">
              <span className="loading-skeleton-bar loading-skeleton-heading-primary" />
              <span className="loading-skeleton-bar loading-skeleton-heading-secondary" />
            </div>
            <div className="loading-skeleton-panel-body">
              <span className="loading-skeleton-bar loading-skeleton-body-primary" />
              <span className="loading-skeleton-bar loading-skeleton-body-secondary" />
              <span className="loading-skeleton-bar loading-skeleton-body-tertiary" />
            </div>
          </>}
      </div>
    </div>
  );
}
