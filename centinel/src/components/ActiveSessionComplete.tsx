import { useState, useCallback, useEffect } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import type { Finding, ReviewDecisionRecord } from '../types';
import { ReviewDecisionBar } from './ReviewDecisionBar';
import { api } from '../api/client';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

export function ActiveSessionComplete({ projectId, sessionId, findings }: {
  projectId: string;
  sessionId: string;
  findings: Finding[];
}) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['critical']));
  // Owns the decision state so the verdict pill above the bar stays in sync
  // after a submit without the parent having to refetch the whole session.
  const [currentDecision, setCurrentDecision] = useState<ReviewDecisionRecord | null>(null);

  // Fetch the latest decision on mount. The session GET also embeds it,
  // but the bar is sometimes mounted before the parent refetches; this
  // keeps it self-sufficient.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await api.getStaticSession(projectId, sessionId);
        if (!cancelled) setCurrentDecision(session.currentDecision ?? null);
      } catch {
        // Non-fatal: bar still works, just no current pill.
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, sessionId]);

  const handleDecisionChange = useCallback((next: ReviewDecisionRecord) => {
    setCurrentDecision(next);
  }, []);

  const grouped = SEVERITY_ORDER.map(severity => ({
    severity,
    items: findings.filter(f => f.severity.toLowerCase() === severity),
  }));

  const toggle = (severity: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return next;
    });
  };

  return (
    <div className="active-session-complete">
      <div className="active-session-complete-summary">
        <CheckCircle2 size={12} className="success" />
        <span>{findings.length} finding{findings.length === 1 ? '' : 's'}</span>
        {SEVERITY_ORDER.map(sev => {
          const count = grouped.find(g => g.severity === sev)?.items.length ?? 0;
          if (count === 0) return null;
          return (
            <span key={sev} className={`severity-count ${sev}`}>
              {count} {sev}
            </span>
          );
        })}
      </div>
      <div className="active-session-complete-groups">
        {grouped.filter(g => g.items.length > 0).map(g => (
          <div key={g.severity} className="finding-group">
            <button
              className="finding-group-header"
              onClick={() => toggle(g.severity)}
            >
              {openGroups.has(g.severity) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className={`severity-label ${g.severity}`}>
                {g.severity} ({g.items.length})
              </span>
            </button>
            {openGroups.has(g.severity) && (
              <ul className="finding-list">
                {g.items.map(f => (
                  <li key={f.id} className="finding-item">
                    {g.severity === 'critical' && <AlertTriangle size={12} className="severity-icon critical" />}
                    <span className="finding-title">{f.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <ReviewDecisionBar
        projectId={projectId}
        sessionId={sessionId}
        currentDecision={currentDecision}
        onChange={handleDecisionChange}
      />
    </div>
  );
}
