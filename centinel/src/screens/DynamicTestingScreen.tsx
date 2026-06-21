import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api/client';
import { DynamicTestForm } from './DynamicTestForm';
import type { Project, DynamicSession, DynamicEvidence, Screen } from '../types';

type Props = {
  project: Project;
  onNavigate: (screen: Screen) => void;
};

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Completed',
  failure: 'Failed',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

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

export function DynamicTestingScreen({ project, onNavigate }: Props) {
  const [sessions, setSessions] = useState<DynamicSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.listDynamicSessions(project.id);
      setSessions(data);
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
    targetUrl: string;
    goal: string;
    missionType: 'user_journey' | 'smoke';
    maxSteps: number;
  }) => {
    setError(null);
    try {
      const session = await api.createDynamicSession(project.id, data);
      setShowCreateForm(false);
      onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: session.id });
    } catch (e) {
      setError(String(e));
      throw e;
    }
  };

  // Computed stats
  const stats = useMemo(() => {
    const total = sessions.length;
    const completed = sessions.filter(s => s.status === 'success').length;
    const running = sessions.filter(s => s.status === 'running' || s.status === 'queued').length;
    const failed = sessions.filter(s => s.status === 'failure').length;
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, running, failed, successRate };
  }, [sessions]);

  // Active sessions
  const activeSessions = useMemo(() =>
    sessions.filter(s => s.status === 'running' || s.status === 'queued'),
    [sessions]
  );

  // Filtered sessions
  const filteredSessions = useMemo(() => {
    return sessions.filter(s => {
      if (filterStatus !== 'all' && s.status !== filterStatus) return false;
      if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [sessions, filterStatus, searchQuery]);

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
            <span className="rv-breadcrumb-current">Dynamic Testing</span>
          </div>
          <h1 className="rv-title">Dynamic Testing</h1>
        </div>
        <div className="rv-header-actions">
          <button className="rv-btn rv-btn-primary" onClick={() => setShowCreateForm(!showCreateForm)}>
            {showCreateForm ? 'Cancel' : '+ New Test'}
          </button>
        </div>
      </div>

      {/* Active Session Banner */}
      {activeSessions.length > 0 && (
        <div className="rv-active-banner">
          <div className="rv-active-banner-icon">⚡</div>
          <div className="rv-active-banner-content">
            <span className="rv-active-banner-title">
              {activeSessions.length} test{activeSessions.length > 1 ? 's' : ''} in progress
            </span>
            <span className="rv-active-banner-sub">
              {activeSessions.map(s => s.name).join(', ')}
            </span>
          </div>
          <button
            className="rv-btn rv-btn-primary rv-btn-sm"
            onClick={() => onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: activeSessions[0].id })}
          >
            View Live →
          </button>
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <div className="dt-create-form">
          <DynamicTestForm onSubmit={handleCreate} onCancel={() => { setShowCreateForm(false); setError(null); }} />
        </div>
      )}

      {/* Stats Dashboard */}
      <div className="rv-stats-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <StatCard icon="🧪" label="Total Tests" value={stats.total} />
        <StatCard icon="✅" label="Completed" value={stats.completed} accent="#22c55e" />
        <StatCard icon="❌" label="Failed" value={stats.failed} accent={stats.failed > 0 ? '#ef4444' : undefined} />
        <StatCard icon="📈" label="Success Rate" value={`${stats.successRate}%`} accent={stats.successRate >= 80 ? '#22c55e' : stats.successRate >= 50 ? '#f59e0b' : '#ef4444'} />
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
        <div className="rv-filter-group rv-filter-search">
          <label className="rv-filter-label">Search</label>
          <input
            className="rv-filter-input"
            type="text"
            placeholder="Search tests..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Session List */}
      <div className="rv-sessions-card">
        <div className="rv-sessions-header">
          <h2 className="rv-sessions-title">Test Sessions ({filteredSessions.length})</h2>
        </div>

        {filteredSessions.length === 0 ? (
          <div className="rv-empty">
            {sessions.length === 0
              ? 'No test sessions yet. Click "+ New Test" to start your first test.'
              : 'No sessions match the current filters.'
            }
          </div>
        ) : (
          <div className="rv-sessions-table-wrap">
            <table className="rv-sessions-table">
              <thead>
                <tr>
                  <th>Test Name</th>
                  <th>Target URL</th>
                  <th>Mission</th>
                  <th>Status</th>
                  <th>Steps</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map(s => {
                  const isActive = s.status === 'running' || s.status === 'queued';
                  return (
                    <tr key={s.id} className={`rv-session-row ${isActive ? 'rv-session-active' : ''}`}>
                      <td>
                        <span className="rv-session-name">{s.name}</span>
                      </td>
                      <td className="rv-session-date" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {s.targetUrl}
                      </td>
                      <td>
                        <span className="rv-type-badge">
                          {s.missionType === 'user_journey' ? 'User Journey' : 'Smoke Test'}
                        </span>
                      </td>
                      <td>
                        <span className={`rv-status-badge rv-status-${s.status}`}>
                          {isActive && <span className="rv-status-pulse" />}
                          {STATUS_LABELS[s.status] || s.status}
                        </span>
                      </td>
                      <td className="rv-session-date">{s.maxSteps}</td>
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
                            onClick={() => onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: s.id })}
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
    </div>
  );
}
