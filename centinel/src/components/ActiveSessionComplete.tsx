import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import type { Finding } from '../types';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

export function ActiveSessionComplete({ projectId, sessionId, findings }: {
  projectId: string;
  sessionId: string;
  findings: Finding[];
}) {
  void projectId; void sessionId;
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['critical']));

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
    </div>
  );
}
