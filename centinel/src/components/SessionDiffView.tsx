/**
 * SessionDiffView (P1-5).
 *
 * The "what changed since last review" panel shown when a re-review
 * is opened. Renders the four buckets (stillOpen / fixed / dismissed
 * / newFindings) with collapsible section per bucket. Used inside
 * ActiveSessionComplete when the session has a parent.
 */

import { useState, useEffect, useCallback } from 'react';
import { ArrowRight, Check, X, AlertCircle, Plus, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import type { SessionDiff, SessionDiffItem } from '../types';

type Props = {
  projectId: string;
  childId: string;
  parentId: string;
  parentCreatedAt: string;
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#e57a78',
  high: '#d9b45c',
  medium: '#d9b45c',
  low: '#7898a3',
  info: '#7898a3',
};

export function SessionDiffView({ projectId, childId, parentId, parentCreatedAt }: Props) {
  const [diff, setDiff] = useState<SessionDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set(['fixed', 'stillOpen', 'newFindings', 'dismissed']));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.getSessionDiff(projectId, childId, parentId);
      setDiff(d);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, childId, parentId]);

  useEffect(() => { void load(); }, [load]);

  const toggle = (bucket: string) => {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  };

  if (loading) return <div className="panel-loading">Computing diff...</div>;
  if (error) return <div className="review-decision-error" role="alert">{error}</div>;
  if (!diff) return null;

  return (
    <div className="session-diff-view" data-testid="session-diff-view">
      <div className="session-diff-header">
        <RefreshCw size={12} />
        <span>Re-review diff</span>
        <span className="session-diff-legend">
          parent {new Date(parentCreatedAt).toLocaleDateString()}
          <ArrowRight size={10} />
          child now
        </span>
      </div>

      <div className="session-diff-buckets">
        <Bucket
          label="Fixed since parent"
          count={diff.counts.fixed}
          tone="positive"
          isOpen={open.has('fixed')}
          onToggle={() => toggle('fixed')}
          items={diff.fixed}
        />
        <Bucket
          label="Dismissed"
          count={diff.counts.dismissed}
          tone="muted"
          isOpen={open.has('dismissed')}
          onToggle={() => toggle('dismissed')}
          items={diff.dismissed}
        />
        <Bucket
          label="Still open from parent"
          count={diff.counts.stillOpen}
          tone="warning"
          isOpen={open.has('stillOpen')}
          onToggle={() => toggle('stillOpen')}
          items={diff.stillOpen}
        />
        <Bucket
          label="New in this re-review"
          count={diff.counts.newFindings}
          tone="info"
          isOpen={open.has('newFindings')}
          onToggle={() => toggle('newFindings')}
          items={diff.newFindings}
        />
      </div>
    </div>
  );
}

type BucketProps = {
  label: string;
  count: number;
  tone: 'positive' | 'muted' | 'warning' | 'info';
  isOpen: boolean;
  onToggle: () => void;
  items: SessionDiffItem[];
};

function Bucket({ label, count, tone, isOpen, onToggle, items }: BucketProps) {
  return (
    <div className={`session-diff-bucket session-diff-bucket-${tone}`} data-testid={`session-diff-bucket-${tone}`}>
      <button className="session-diff-bucket-header" onClick={onToggle} type="button">
        {isOpen ? '▾' : '▸'} {label} <span className="session-diff-bucket-count">{count}</span>
      </button>
      {isOpen && (
        <ul className="session-diff-bucket-items">
          {items.length === 0 ? (
            <li className="session-diff-bucket-empty">—</li>
          ) : items.map(i => (
            <li key={i.id} className="session-diff-bucket-item">
              <span className="session-diff-bucket-dot" style={{ background: SEVERITY_COLOR[i.severity] ?? '#888' }} />
              <span className="session-diff-bucket-severity">{i.severity}</span>
              <span className="session-diff-bucket-title">{i.title}</span>
              {i.filePath && (
                <span className="session-diff-bucket-location">
                  {i.filePath}{i.lineNumber ? ':' + i.lineNumber : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Icon-picker for the bucket tone (kept simple — the bucket uses a colored left border). */
export function diffBucketIcon(tone: 'positive' | 'muted' | 'warning' | 'info') {
  switch (tone) {
    case 'positive': return <Check size={12} />;
    case 'muted': return <X size={12} />;
    case 'warning': return <AlertCircle size={12} />;
    case 'info': return <Plus size={12} />;
  }
}
