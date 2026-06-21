import type { MouseEvent, ReactNode } from 'react';
import { ArrowLeft, type LucideIcon } from 'lucide-react';

export type StatusTone = 'neutral' | 'running' | 'success' | 'warning' | 'danger';

export function statusTone(status: string): StatusTone {
  if (['success', 'passed', 'accepted', 'fixed', 'implemented', 'configured', 'online'].includes(status)) return 'success';
  if (['running', 'queued', 'new', 'partial'].includes(status)) return 'running';
  if (['blocked', 'warning', 'medium', 'high'].includes(status)) return 'warning';
  if (['failure', 'failed', 'critical', 'missing', 'offline'].includes(status)) return 'danger';
  return 'neutral';
}

export function StatusBadge({ label, tone = statusTone(label.toLowerCase()) }: { label: string; tone?: StatusTone }) {
  return <span className={`command-status command-status-${tone}`}>{label}</span>;
}

type HeaderProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  status?: { label: string; tone?: StatusTone };
  onBack?: () => void;
  actions?: ReactNode;
  meta?: ReactNode;
};

export function CommandPageHeader({ title, eyebrow, description, status, onBack, actions, meta }: HeaderProps) {
  return (
    <header className="command-page-header">
      <div className="command-page-heading">
        {onBack && (
          <button className="command-back" onClick={onBack} aria-label="Go back">
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="command-page-copy">
          {eyebrow && <span className="command-eyebrow">{eyebrow}</span>}
          <div className="command-title-row">
            <h1>{title}</h1>
            {status && <StatusBadge label={status.label} tone={status.tone} />}
          </div>
          {description && <p>{description}</p>}
          {meta && <div className="command-page-meta">{meta}</div>}
        </div>
      </div>
      {actions && <div className="command-page-actions">{actions}</div>}
    </header>
  );
}

export function IconButton({ icon: Icon, label, tone = 'neutral', onClick, disabled }: {
  icon: LucideIcon;
  label: string;
  tone?: 'neutral' | 'danger';
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
}) {
  return (
    <button className={`command-icon-button ${tone === 'danger' ? 'danger' : ''}`} onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      <Icon size={15} />
    </button>
  );
}

export function CommandEmptyState({ icon: Icon, title, description, action }: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="command-empty-state">
      <Icon size={34} strokeWidth={1.3} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
