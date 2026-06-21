import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api/client';
import { ReviewModal } from '../components/ReviewModal';
import type { Project, StaticSession, Finding, Screen, ReviewType } from '../types';

type Props = {
  project: Project;
  onNavigate: (screen: Screen) => void;
};

const REVIEW_TYPE_LABELS: Record<string, string> = {
  requirement_review: 'Requirement Review',
  code_review: 'Code Inspection',
  requirement_to_code_traceability: 'Traceability',
  cross_artifact_consistency: 'Consistency',
};

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Completed',
  failure: 'Failed',
  cancelled: 'Cancelled',
};

function QualityGauge({ score }: { score: number }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const tier = score >= 80 ? 'good' : score >= 50 ? 'fair' : 'poor';
  const label = score >= 80 ? 'Good' : score >= 50 ? 'Needs Work' : 'Poor';

  return (
    <div className="rv-stat-card rv-stat-score">
      <div className="rv-stat-header">
        <span className="rv-stat-icon">📊</span>
        <span className="rv-stat-label">Quality Score</span>
      </div>
      <div className="rv-score-gauge-small">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={radius} fill="none" stroke="#334155" strokeWidth="6" />
          <circle
            className={`rv-gauge-fill ${tier}`}
            cx="40" cy="40" r={radius}
            fill="none" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 40 40)"
          />
        </svg>
        <div className="rv-score-center">
          <span className="rv-score-num">{score}</span>
        </div>
      </div>
      <span className={`rv-score-tier ${tier}`}>{label}</span>
    </div>
  );
}

function StatCard({ icon, label, value, accent }: {
  icon: string; label: string; value: number | string; accent?: string;
}) {
  return (
    <div className="rv-stat-card">
      <div className="rv-stat-header">
        <span className="rv-stat-icon">{icon}</span>
        <span className="rv-stat-label">{label}</span>
      </div>
      <div className="rv-stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
    </div>
  );
}

export function ReviewScreen({ project, onNavigate }: Props) {
  const [sessions, setSessions] = useState<StaticSession[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([
        api.listStaticSessions(project.id),
        api.listFindings(project.id),
      ]);
      setSessions(s);
      setFindings(f);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  // Poll for active sessions
  useEffect(() => {
    const hasActive = sessions.some(s => s.status === 'running' || s.status === 'queued');
    if (!hasActive) return;
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [sessions, load]);

  const handleCreate = async (data: {
    name: string;
    reviewType: ReviewType;
    artifactIds: string[];
    remarks: string;
  }) => {
    setError(null);
    try {
      const session = await api.createStaticSession(project.id, data);
      setShowCreateModal(false);
      onNavigate({ name: 'review-session', projectId: project.id, sessionId: session.id });
    } catch (e) {
      setError(String(e));
      throw e;
    }
  };

  const handleExportReport = async () => {
    setExporting(true);
    try {
      const result = await api.exportProjectReport(project.id);
      alert(`Report exported to:\n${result.reportPath}`);
    } catch (e) {
      alert(`Export failed: ${e}`);
    } finally {
      setExporting(false);
    }
  };

  // Computed stats
  const stats = useMemo(() => {
    const openFindings = findings.filter(f => f.status === 'new');
    const critical = openFindings.filter(f => f.severity === 'critical').length;
    const high = openFindings.filter(f => f.severity === 'high').length;
    const medium = openFindings.filter(f => f.severity === 'medium').length;
    const low = openFindings.filter(f => f.severity === 'low').length;

    // Quality score (same formula as StaticSessionScreen)
    let score = 100;
    if (openFindings.length > 0) {
      score = Math.max(0, 100
        - critical * 15
        - high * 8
        - medium * 3
        - low * 1
      );
    }

    const total = sessions.length;
    const completed = sessions.filter(s => s.status === 'success').length;
    const running = sessions.filter(s => s.status === 'running' || s.status === 'queued').length;
    const failed = sessions.filter(s => s.status === 'failure').length;

    return { score, critical, high, medium, low, total, completed, running, failed, openCount: openFindings.length };
  }, [sessions, findings]);

  // Active sessions (running/queued)
  const activeSessions = useMemo(() =>
    sessions.filter(s => s.status === 'running' || s.status === 'queued'),
    [sessions]
  );

  // Filtered sessions
  const filteredSessions = useMemo(() => {
    return sessions.filter(s => {
      if (filterStatus !== 'all' && s.status !== filterStatus) return false;
      if (filterType !== 'all' && s.reviewType !== filterType) return false;
      if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [sessions, filterStatus, filterType, searchQuery]);

  // Per-session finding counts
  const sessionFindingCounts = useMemo(() => {
    const map: Record<string, { critical: number; high: number; medium: number; low: number; total: number }> = {};
    for (const f of findings) {
      if (!f.sessionId) continue;
      if (!map[f.sessionId]) map[f.sessionId] = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
      const sev = f.severity.toLowerCase();
      if (sev in map[f.sessionId]) (map[f.sessionId] as any)[sev]++;
      map[f.sessionId].total++;
    }
    return map;
  }, [findings]);

  if (loading) return <div className="screen"><p>Loading...</p></div>;

  return (
    <div className="rv-layout">
      {/* Header */}
      <div className="rv-header">
        <div className="rv-header-left">
          <div className="rv-breadcrumbs">
            <button className="rv-breadcrumb-link" onClick={() => onNavigate({ name: 'projects' })}>
              Projects
            </button>
            <span className="rv-breadcrumb-sep">›</span>
            <button className="rv-breadcrumb-link" onClick={() => onNavigate({ name: 'project-detail', projectId: project.id })}>
              {project.name}
            </button>
            <span className="rv-breadcrumb-sep">›</span>
            <span className="rv-breadcrumb-current">Reviews</span>
          </div>
          <h1 className="rv-title">Review Dashboard</h1>
        </div>
        <div className="rv-header-actions">
          <button className="rv-btn rv-btn-secondary" onClick={handleExportReport} disabled={exporting}>
            {exporting ? 'Exporting...' : '📥 Export Report'}
          </button>
          <button className="rv-btn rv-btn-primary" onClick={() => setShowCreateModal(true)}>
            + New Review
          </button>
        </div>
      </div>

      {/* Active Session Banner */}
      {activeSessions.length > 0 && (
        <div className="rv-active-banner">
          <div className="rv-active-banner-icon">⚡</div>
          <div className="rv-active-banner-content">
            <span className="rv-active-banner-title">
              {activeSessions.length} review{activeSessions.length > 1 ? 's' : ''} in progress
            </span>
            <span className="rv-active-banner-sub">
              {activeSessions.map(s => s.name).join(', ')}
            </span>
          </div>
          <button
            className="rv-btn rv-btn-primary rv-btn-sm"
            onClick={() => onNavigate({ name: 'review-session', projectId: project.id, sessionId: activeSessions[0].id })}
          >
            View Live →
          </button>
        </div>
      )}

      {/* Stats Dashboard */}
      <div className="rv-stats-row">
        <QualityGauge score={stats.score} />
        <StatCard icon="⚠️" label="Open Issues" value={stats.openCount} accent={stats.openCount > 0 ? '#ef4444' : '#22c55e'} />
        <StatCard icon="🔴" label="Critical" value={stats.critical} accent="#ef4444" />
        <StatCard icon="📁" label="Total Sessions" value={stats.total} />
        <StatCard icon="✅" label="Completed" value={stats.completed} accent="#22c55e" />
        <StatCard icon="❌" label="Failed" value={stats.failed} accent={stats.failed > 0 ? '#ef4444' : undefined} />
      </div>

      {/* Filters */}
      <div className="rv-filters">
        <div className="rv-filter-group">
          <label className="rv-filter-label">Status</label>
          <select
            className="rv-filter-select"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="success">Completed</option>
            <option value="running">Running</option>
            <option value="queued">Queued</option>
            <option value="failure">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="rv-filter-group">
          <label className="rv-filter-label">Review Type</label>
          <select
            className="rv-filter-select"
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
          >
            <option value="all">All Types</option>
            <option value="requirement_review">Requirement Review</option>
            <option value="code_review">Code Inspection</option>
            <option value="requirement_to_code_traceability">Traceability</option>
            <option value="cross_artifact_consistency">Consistency</option>
          </select>
        </div>
        <div className="rv-filter-group rv-filter-search">
          <label className="rv-filter-label">Search</label>
          <input
            className="rv-filter-input"
            type="text"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Session List */}
      <div className="rv-sessions-card">
        <div className="rv-sessions-header">
          <h2 className="rv-sessions-title">Review Sessions ({filteredSessions.length})</h2>
        </div>

        {filteredSessions.length === 0 ? (
          <div className="rv-empty">
            {sessions.length === 0
              ? 'No review sessions yet. Click "New Review" to start your first review.'
              : 'No sessions match the current filters.'
            }
          </div>
        ) : (
          <div className="rv-sessions-table-wrap">
            <table className="rv-sessions-table">
              <thead>
                <tr>
                  <th>Session Name</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Issues</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map(s => {
                  const counts = sessionFindingCounts[s.id];
                  const isActive = s.status === 'running' || s.status === 'queued';
                  return (
                    <tr key={s.id} className={`rv-session-row ${isActive ? 'rv-session-active' : ''}`}>
                      <td>
                        <span className="rv-session-name">{s.name}</span>
                        {s.remarks && <span className="rv-session-remarks">{s.remarks}</span>}
                      </td>
                      <td>
                        <span className="rv-type-badge">{REVIEW_TYPE_LABELS[s.reviewType] || s.reviewType}</span>
                      </td>
                      <td>
                        <span className={`rv-status-badge rv-status-${s.status}`}>
                          {isActive && <span className="rv-status-pulse" />}
                          {STATUS_LABELS[s.status] || s.status}
                        </span>
                      </td>
                      <td>
                        {counts ? (
                          <div className="rv-issue-pills">
                            {counts.critical > 0 && <span className="rv-pill rv-pill-critical">{counts.critical}C</span>}
                            {counts.high > 0 && <span className="rv-pill rv-pill-high">{counts.high}H</span>}
                            {counts.medium > 0 && <span className="rv-pill rv-pill-medium">{counts.medium}M</span>}
                            {counts.low > 0 && <span className="rv-pill rv-pill-low">{counts.low}L</span>}
                            {counts.total === 0 && <span className="rv-pill rv-pill-clean">Clean</span>}
                          </div>
                        ) : (
                          <span className="rv-issues-placeholder">—</span>
                        )}
                      </td>
                      <td className="rv-session-date">
                        {new Date(s.createdAt).toLocaleDateString('en-US', {
                          day: 'numeric', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td>
                        <div className="rv-row-actions">
                          <button
                            className="rv-btn rv-btn-sm rv-btn-ghost"
                            onClick={() => onNavigate({ name: 'review-session', projectId: project.id, sessionId: s.id })}
                          >
                            {isActive ? 'View Live' : 'View'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {error && <p className="rv-error">{error}</p>}

      {showCreateModal && (
        <ReviewModal
          projectId={project.id}
          onSubmit={handleCreate}
          onClose={() => { setShowCreateModal(false); setError(null); }}
        />
      )}
    </div>
  );
}
