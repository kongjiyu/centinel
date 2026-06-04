import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type { Finding } from '../types';

type Props = {
  projectId: string;
};

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge badge-severity-${severity}`}>{severity}</span>;
}

export function FindingsPanel({ projectId }: Props) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<'all' | 'static' | 'dynamic'>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const loadFindings = useCallback(async () => {
    try {
      const data = await api.listFindings(projectId);
      setFindings(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadFindings();
  }, [loadFindings]);

  const handleUpdateStatus = async (findingId: string, status: string) => {
    try {
      await api.updateFinding(projectId, findingId, status);
      setFindings(prev => prev.map(f => f.id === findingId ? { ...f, status: status as Finding['status'] } : f));
    } catch {
      // ignore
    }
  };

  const filtered = findings.filter(f => {
    if (filterSource !== 'all' && f.source !== filterSource) return false;
    if (filterSeverity !== 'all' && f.severity !== filterSeverity) return false;
    if (filterStatus !== 'all' && f.status !== filterStatus) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return (order[a.severity] ?? 99) - (order[b.severity] ?? 99);
  });

  if (loading) return <div className="panel-loading">Loading findings...</div>;

  return (
    <div className="findings-panel">
      <div className="panel-header">
        <h3>Findings ({findings.length})</h3>
      </div>

      {findings.length > 0 && (
        <div className="findings-filters">
          <select value={filterSource} onChange={e => setFilterSource(e.target.value as any)}>
            <option value="all">All Sources</option>
            <option value="static">Static</option>
            <option value="dynamic">Dynamic</option>
          </select>
          <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}>
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="info">Info</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="new">New</option>
            <option value="accepted">Accepted</option>
            <option value="dismissed">Dismissed</option>
            <option value="fixed">Fixed</option>
          </select>
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="card-empty">
          {findings.length === 0
            ? 'No findings yet. Run a static review or dynamic test to generate findings.'
            : 'No findings match the current filters.'}
        </p>
      ) : (
        <div className="findings-list">
          {sorted.map((f, i) => (
            <div key={f.id} className={`finding-row finding-${f.status}`}>
              <div
                className="finding-header"
                onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
              >
                <span className="finding-index">{i + 1}</span>
                <SeverityBadge severity={f.severity} />
                <span className="finding-title">{f.title}</span>
                <span className={`badge badge-source-${f.source}`}>{f.source}</span>
                {f.category && <span className="finding-category">{f.category.replace(/_/g, ' ')}</span>}
                <span className={`finding-status finding-status-${f.status}`}>{f.status}</span>
              </div>

              {expandedId === f.id && (
                <div className="finding-detail">
                  <p className="finding-description">{f.description}</p>

                  {f.evidenceText && (
                    <div className="finding-evidence">
                      <strong>Evidence:</strong>
                      <pre>{f.evidenceText}</pre>
                    </div>
                  )}

                  {f.recommendation && (
                    <div className="finding-recommendation">
                      <strong>Recommendation:</strong> {f.recommendation}
                    </div>
                  )}

                  <div className="finding-meta">
                    {f.confidence && <span>Confidence: {f.confidence}</span>}
                    <span>Source: {f.source}</span>
                    <span>Created: {new Date(f.createdAt).toLocaleString()}</span>
                  </div>

                  <div className="finding-actions">
                    {f.status !== 'accepted' && (
                      <button className="btn-accept" onClick={() => handleUpdateStatus(f.id, 'accepted')}>
                        Accept
                      </button>
                    )}
                    {f.status !== 'dismissed' && (
                      <button className="btn-dismiss" onClick={() => handleUpdateStatus(f.id, 'dismissed')}>
                        Dismiss
                      </button>
                    )}
                    {f.status !== 'fixed' && (
                      <button className="btn-fix" onClick={() => handleUpdateStatus(f.id, 'fixed')}>
                        Mark Fixed
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
